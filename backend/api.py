"""Read-only API over the validated, packaged crash snapshot."""
from __future__ import annotations

import calendar
import os
import sqlite3
from contextlib import contextmanager
from datetime import date
from pathlib import Path
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from mangum import Mangum
from starlette.exceptions import HTTPException as StarletteHTTPException

from data.clean import DEFAULT_DB, SEVERITIES

app = FastAPI(title='Crash Analytics API', version='1.0.0',
              description='Distinct crash counts in the supplied Lubbock TxDOT district K/A/B/C injury-crash export. '
              'All analytical endpoints share county, year and repeated severity filters.')


# Open the SQLite database in read-only mode to guard against writes or empty file creation.
# CRASH_DB_PATH allows test fixtures to point to a temporary test database.
@contextmanager
def connection():
    path = Path(os.environ.get('CRASH_DB_PATH', str(DEFAULT_DB))).resolve()
    db = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    try:
        yield db
    finally:
        db.close()


FACTOR_PERCENTAGE_DEF = 'Factor crash count / all filtered crashes, including NONE and missing; percentages may exceed 100% in total'
COVERAGE_NOTE = 'Observed dates, not proof of complete reporting. Boundary periods may be partial'
COUNTING_UNIT = 'One distinct Crash ID, not persons or vehicles'


def dataset_coverage(db):
    row = db.execute("SELECT MIN(crash_date), MAX(crash_date) FROM crashes WHERE crash_date IS NOT NULL").fetchone()
    return {'first_date': row[0], 'last_date': row[1]} if row and row[0] else {'first_date': None, 'last_date': None}


# Format validation errors into consistent, user-friendly JSON {error: {code, message, details}}
@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    return JSONResponse(status_code=422, content={'error': {'code': 'invalid_parameter',
        'message': 'Check query parameters', 'details': [
            {'parameter': '.'.join(str(x) for x in e['loc']), 'message': e['msg']}
            for e in exc.errors()]}})


@app.exception_handler(StarletteHTTPException)
async def http_error(request, exc):
    return JSONResponse(status_code=exc.status_code, content={'error': {
        'code': 'invalid_parameter' if exc.status_code == 422 else 'not_found' if exc.status_code == 404 else 'http_error',
        'message': str(exc.detail)}})


# Inject defensive browser security headers on every response
@app.middleware('http')
async def headers(request: Request, call_next):
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Cache-Control'] = 'public, max-age=60' if response.status_code == 200 else 'no-store'
    return response


# Shared filter validator across analytical endpoints: validates county, year, and severities
def filters(request: Request, county: str | None = None,
            year: int | None = None,
            severity: Annotated[list[str] | None, Query(description='Repeat for multiple codes, e.g. severity=K&severity=A')] = None):
    # Strict allowlist: reject unknown query parameters (catches typos and bad inputs)
    allowed = {'county', 'year', 'severity'}
    allowed |= {'limit'} if request.url.path.endswith(('/factors', '/points')) else set()
    allowed |= {'granularity'} if request.url.path.endswith('/trends') else set()
    unknown = set(request.query_params) - allowed
    if unknown:
        raise HTTPException(422, f'Unknown parameters: {sorted(unknown)}')

    # Disallow repeated scalar parameters (e.g. ?county=A&county=B)
    for name in allowed - {'severity'}:
        if len(request.query_params.getlist(name)) > 1:
            raise HTTPException(422, f'{name} may only be specified once')

    county = ' '.join(county.upper().split()) if county is not None else None
    severity = sorted(set(s.strip().upper() for s in severity)) if severity is not None else []
    if set(severity) - set(SEVERITIES):
        raise HTTPException(422, 'severity must be one or more of K, A, B, C')

    # Confirm county and year actually exist in the dataset; return 422 if unknown
    with connection() as db:
        if county is not None and not db.execute('SELECT 1 FROM crashes WHERE county=? LIMIT 1', (county,)).fetchone():
            raise HTTPException(422, 'Unknown county; see /api/v1/metadata')
        if year is not None and not db.execute('SELECT 1 FROM crashes WHERE year=? LIMIT 1', (year,)).fetchone():
            raise HTTPException(422, 'Unknown year; see /api/v1/metadata')
    return {'county': county, 'year': year, 'severity': severity}


Filter = Annotated[dict, Depends(filters)]


# Construct SQL WHERE clause using parameterized ? bindings to prevent SQL injection
def selection(applied):
    conditions, params = [], []
    for key in ('county', 'year'):
        if applied[key] is not None:
            conditions.append(f'c.{key}=?')
            params.append(applied[key])
    if applied['severity']:
        conditions.append('c.severity IN (' + ','.join('?' for _ in applied['severity']) + ')')
        params.extend(applied['severity'])
    return (' WHERE ' + ' AND '.join(conditions)) if conditions else '', params


# Question 1: How severe were crashes? Returns counts & percentages for K, A, B, C
@app.get('/api/v1/severity', tags=['Analysis'])
def severity_counts(applied: Filter):
    """K/A/B/C crash counts, including zero buckets. Percent is of filtered crashes."""
    where, params = selection(applied)
    with connection() as db:
        # Tally crashes by severity; zero-fill severities with no matches
        counts = dict(db.execute('SELECT severity, COUNT(*) FROM crashes c' + where + ' GROUP BY severity', params).fetchall())
        total = sum(counts.values())
        results = [{'severity': s, 'label': label, 'crashes': counts.get(s, 0),
                    'percentage': round(100 * counts.get(s, 0) / total, 4) if total else 0.0}
                   for s, label in SEVERITIES.items()]
        return {'filters': applied, 'total_crashes': total, 'results': results}


# Question 2: What contributing factors were recorded? Ranks top factors by distinct crashes
@app.get('/api/v1/factors', tags=['Analysis'])
def contributing_factors(applied: Filter, limit: Annotated[int | None, Query(ge=1, le=1000)] = None):
    """Distinct crashes per factor. NONE/missing excluded from ranking, not denominator."""
    where, params = selection(applied)
    with connection() as db:
        # Join factors table to rank factors by crash count descending (highest first)
        sql = ('SELECT factor, COUNT(*) AS crashes FROM crashes c '
               'JOIN factors f USING(crash_id)' + where +
               ' GROUP BY factor ORDER BY crashes DESC, factor ASC')
        if limit is not None:
            sql += ' LIMIT ?'
            rows = db.execute(sql, [*params, limit]).fetchall()
        else:
            rows = db.execute(sql, params).fetchall()
        # Count explicit NONE vs missing factors for data transparency
        absent = dict(db.execute('SELECT factor_status, COUNT(*) FROM crashes c' + where +
                                 ' GROUP BY factor_status', params).fetchall())
        # All filtered crashes remain in the denominator, independent of the ranking limit.
        total = sum(absent.values())
        results = [dict(r) | {'percentage': round(100 * r['crashes'] / total, 4) if total else 0.0} for r in rows]
        return {'filters': applied, 'total_crashes': total, 'results': results,
                'no_recorded_factor': absent.get('none', 0), 'missing_factor': absent.get('missing', 0)}


# Question 3: When did crashes occur? Continuous chronological trend or day-of-week distribution
@app.get('/api/v1/trends', tags=['Analysis'])
def trends(applied: Filter, granularity: Literal['month', 'year', 'day_of_week'] = 'month'):
    """Chronological zero-filled periods or day-of-week distribution. Missing dates are explicitly excluded."""
    where, params = selection(applied)
    with connection() as db:
        stats = db.execute('SELECT COUNT(*), COUNT(*) - COUNT(crash_date) FROM crashes c' + where, params).fetchone()
        response = {'filters': applied, 'total_crashes': stats[0], 'granularity': granularity,
                    'excluded_invalid_dates': stats[1]}
        if granularity == 'day_of_week':
            counts = dict(db.execute("SELECT strftime('%w', crash_date), COUNT(*) FROM crashes c" + where +
                                     (' AND ' if where else ' WHERE ') + 'crash_date IS NOT NULL GROUP BY 1', params).fetchall())
            total = sum(counts.values())
            day_order = [
                ('1', 'Monday'), ('2', 'Tuesday'), ('3', 'Wednesday'),
                ('4', 'Thursday'), ('5', 'Friday'), ('6', 'Saturday'), ('0', 'Sunday')
            ]
            results = [{
                'period': name,
                'crashes': counts.get(code, 0),
                'percentage': round(100 * counts.get(code, 0) / total, 4) if total else 0.0,
                'partial_period': False,
            } for code, name in day_order]
            response['results'] = results
            return response

        width = 7 if granularity == 'month' else 4
        counts = dict(db.execute(f'SELECT substr(crash_date,1,{width}), COUNT(*) FROM crashes c' + where +
                                 (' AND ' if where else ' WHERE ') + 'crash_date IS NOT NULL GROUP BY 1', params).fetchall())
        coverage = dataset_coverage(db)
        results = []
        # Zero-fill missing months/years so frontend graphs show a continuous timeline
        if coverage['first_date'] and coverage['last_date']:
            first, last = date.fromisoformat(coverage['first_date']), date.fromisoformat(coverage['last_date'])
            years = [applied['year']] if applied['year'] else range(first.year, last.year + 1)
            for year in years:
                for month in (range(1, 13) if granularity == 'month' else [1]):
                    start = date(year, month, 1)
                    end = date(year, month, calendar.monthrange(year, month)[1]) if granularity == 'month' else date(year, 12, 31)
                    if end < first or start > last:
                        continue
                    period = start.isoformat()[:width]
                    # Flag boundary periods (like October 2026) as partial so users know counts are incomplete
                    results.append({'period': period, 'crashes': counts.get(period, 0),
                                    'partial_period': start < first or end > last})
        response['results'] = results
        return response


@app.get('/api/v1/counties', tags=['Analysis'])
def county_counts(applied: Filter):
    """Rank counties by distinct crashes, including crashes without coordinates or valid dates."""
    where, params = selection(applied)
    with connection() as db:
        rows = db.execute('SELECT county, COUNT(*) AS crashes FROM crashes c' + where +
                          ' GROUP BY county ORDER BY crashes DESC, county ASC', params).fetchall()
        return {'filters': applied, 'total_crashes': sum(r['crashes'] for r in rows),
                'results': [dict(r) for r in rows]}


# Question 4: Spatial coordinates and severity for interactive OpenStreetMap visualization
@app.get('/api/v1/points', tags=['Analysis'])
def crash_points(applied: Filter, limit: Annotated[int | None, Query(ge=1, le=50000)] = None):
    """Crash coordinates, severity, and attributes for spatial mapping. Excludes uncoordinated crashes."""
    where, params = selection(applied)
    coord_clause = (' AND ' if where else ' WHERE ') + 'c.latitude IS NOT NULL AND c.longitude IS NOT NULL'
    sql = (
        'SELECT c.latitude, c.longitude, c.severity, c.crash_id, c.crash_date, c.county, '
        '(SELECT f.factor FROM factors f WHERE f.crash_id = c.crash_id ORDER BY f.factor ASC LIMIT 1) AS primary_factor '
        'FROM crashes c' + where + coord_clause + ' ORDER BY c.crash_date DESC'
    )
    if limit is not None:
        sql += ' LIMIT ?'
    with connection() as db:
        total = db.execute('SELECT COUNT(*) FROM crashes c' + where, params).fetchone()[0]
        rows = db.execute(sql, [*params, limit] if limit is not None else params).fetchall()
        points = [
            {
                'lat': r[0],
                'lon': r[1],
                'severity': r[2],
                'id': r[3],
                'date': r[4],
                'county': r[5],
                'factor': r[6] or 'No factor recorded',
            }
            for r in rows
        ]
        return {'filters': applied, 'total_crashes': total, 'results': points, 'total_points': len(points)}


# Dataset metadata and available filter values (counties, years, severities) for UI dropdowns
@app.get('/api/v1/metadata', tags=['Dataset'])
def metadata():
    with connection() as db:
        unusable_coords = db.execute('SELECT COUNT(*) FROM crashes WHERE has_coordinates = 0').fetchone()[0]
        total_crashes = db.execute('SELECT COUNT(*) FROM crashes').fetchone()[0]
        return {
            'scope': 'Supplied Lubbock TxDOT district K/A/B/C injury-crash export',
            'crashes': total_crashes,
            'coverage': dataset_coverage(db),
            'quality': {
                'unusable_coordinates': unusable_coords,
            },
            'definitions': {
                'counting_unit': COUNTING_UNIT,
                'factors': 'Distinct crashes recording each normalized contributing factor; NONE excluded',
                'factor_percentage': FACTOR_PERCENTAGE_DEF,
                'coverage': COVERAGE_NOTE,
            },
            'available_filters': {
                'counties': [r[0] for r in db.execute('SELECT DISTINCT county FROM crashes ORDER BY county')],
                'years': [r[0] for r in db.execute('SELECT DISTINCT year FROM crashes WHERE year IS NOT NULL ORDER BY year')],
                'severities': SEVERITIES,
            },
        }


@app.get('/health', include_in_schema=False)
def health():
    return {'status': 'ok'}


# Mangum ASGI adapter allows FastAPI to run inside AWS Lambda Function URLs
handler = Mangum(app, lifespan='off')
