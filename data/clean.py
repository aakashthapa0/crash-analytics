"""Validate the person-grain CRIS export and build a crash-grain SQLite snapshot.

Usage: python -m data.clean [path/to/district_crashes.csv]
With no source path, download the public source CSV before cleaning it.
Only the standard library is needed for processing. Raw person fields never
enter the runtime database. Conflicting crash attributes stop the build.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import shutil
import sqlite3
import tempfile
from collections import Counter
from datetime import date
from pathlib import Path
from urllib.request import urlopen

DEFAULT_DB = Path(__file__).resolve().parent / 'crashes.sqlite'
DEFAULT_SOURCE_URL = 'https://d9tany0cdnjow.cloudfront.net/data/district_crashes.csv'
MISSING = {'', 'NO DATA', 'N/A', 'NULL', 'UNKNOWN', '-1'}
SEVERITIES = {'K': 'Fatal injury', 'A': 'Suspected serious injury',
              'B': 'Suspected minor injury', 'C': 'Possible injury'}
REQUIRED = ('Crash ID', 'Crash Date', 'Crash Year', 'Crash Severity', 'County',
            'Contributing Factors', 'Latitude', 'Longitude')

# Path to the SQLite DDL schema defining tables, relations, and indexes
SCHEMA_PATH = Path(__file__).resolve().parent / 'schema.sql'


class DataQualityError(ValueError):
    """A structural error makes the snapshot unsafe to publish."""


def normalize(value: str) -> str:
    # Collapse whitespace and uppercase so identical values match across rows
    return ' '.join(value.strip().upper().split())


def factor_values(value: str) -> tuple[tuple[str, ...], str]:
    # Contributing factors are semicolon-separated; strip sentinels and NONE,
    # and tag the status so we can report missing vs explicit NONE in metadata.
    tokens = {normalize(v) for v in value.split(';')}
    actual = tuple(sorted(tokens - MISSING - {'NONE'}))
    return actual, ('recorded' if actual else 'none' if 'NONE' in tokens else 'missing')


def usable_coordinates(latitude: str, longitude: str) -> bool:
    # Check whether coordinates are finite numbers inside a broad Texas rectangle;
    # 0 and -1 sentinels are treated as uncoordinated.
    try:
        lat, lon = float(latitude), float(longitude)
        return (math.isfinite(lat) and math.isfinite(lon) and 25 <= lat <= 37
                and -107 <= lon <= -93)
    except ValueError:
        return False


def build(source: Path, destination: Path = DEFAULT_DB) -> dict:
    """Build atomically. Invalid dates stay in severity/factor totals as NULL.

    Reject missing identifiers, unexpected severities, date/year mismatches,
    malformed records and inconsistent repeated crash attributes. A previous
    valid database is never replaced when validation fails.
    """
    quality = Counter()
    records, row_hashes, preamble = {}, set(), []

    # Record exact input lineage in the cleaning report.
    source_hash = hashlib.sha256()
    with source.open('rb') as raw:
        for chunk in iter(lambda: raw.read(1024 * 1024), b''):
            source_hash.update(chunk)
    # CRIS exports often contain metadata/disclaimer lines before the table.
    # Scan until we identify the actual column header row.
    with source.open(encoding='utf-8-sig', newline='') as stream:
        reader = csv.reader(stream)
        for header in reader:
            if 'Crash ID' in header and 'Crash Severity' in header:
                break
            preamble.append(header)
        else:
            raise DataQualityError('CSV header with Crash ID and Crash Severity not found')
        if len(header) != len(set(header)):
            raise DataQualityError('Duplicate column names')
        missing = set(REQUIRED) - set(header)
        if missing:
            raise DataQualityError(f'Missing columns: {sorted(missing)}')
        header_line = reader.line_num

        # Iterate rows: aggregate person/unit records into distinct crash events
        for values in reader:
            if not values or not any(v.strip() for v in values):
                continue
            quality['source_rows'] += 1
            if len(values) != len(header):
                raise DataQualityError(f'Malformed row at line {reader.line_num}')

            # Track identical full rows for quality reporting without deduplicating crashes
            digest = hashlib.sha256(json.dumps(values).encode()).digest()
            quality['identical_rows'] += digest in row_hashes
            row_hashes.add(digest)

            row = dict(zip(header, values))
            crash_id = row['Crash ID'].strip()
            if normalize(crash_id) in MISSING:
                raise DataQualityError(f'Missing Crash ID at line {reader.line_num}')

            # Dates must be valid ISO; invalid dates are kept as NULL in crash totals
            raw_date = row['Crash Date'].strip()
            try:
                parsed_date = date.fromisoformat(raw_date).isoformat()
            except ValueError:
                parsed_date = None

            # Cross-check year with date to catch data corruption
            raw_year = row['Crash Year'].strip()
            try:
                year = int(raw_year)
                if not 1900 <= year <= 2100:
                    raise ValueError
            except ValueError:
                year = int(parsed_date[:4]) if parsed_date else None
            if parsed_date and year != int(parsed_date[:4]):
                raise DataQualityError(f'Date/year mismatch for Crash ID {crash_id}')

            # Severity is K, A, B, or C; discard text suffix (e.g. 'K - FATAL')
            severity = normalize(row['Crash Severity']).split(' - ')[0]
            if severity not in SEVERITIES:
                raise DataQualityError(f'Unexpected severity for Crash ID {crash_id}: {severity!r}')

            # Standardize county, replacing missing values with UNKNOWN
            county = normalize(row['County'])
            county = 'UNKNOWN' if county in MISSING else county

            factors, status = factor_values(row['Contributing Factors'])
            coordinates = usable_coordinates(row['Latitude'], row['Longitude'])
            lat = round(float(row['Latitude']), 6) if coordinates else None
            lon = round(float(row['Longitude']), 6) if coordinates else None
            record = (crash_id, parsed_date, year, county, severity, int(coordinates), lat, lon, status)

            # Deduplicate by Crash ID: verify all person rows agree on crash attributes
            signature = (record, factors, raw_date if parsed_date is None else '',
                         raw_year if year is None else '',
                         normalize(row['Latitude']), normalize(row['Longitude']))
            if crash_id in records:
                if records[crash_id][2] != signature:
                    raise DataQualityError(f'Conflicting crash attributes for Crash ID {crash_id}')
            else:
                records[crash_id] = (record, factors, signature)
                quality['invalid_dates'] += parsed_date is None
                quality['missing_years'] += year is None
                quality['missing_counties'] += county == 'UNKNOWN'
                quality['unusable_coordinates'] += not coordinates
                quality['no_recorded_factor'] += status == 'none'
                quality['missing_factor'] += status == 'missing'
    if not records:
        raise DataQualityError('No crash records found')

    dates = sorted(r[0][1] for r in records.values() if r[0][1])
    metadata = {
        'dataset_version': source_hash.hexdigest(), 'schema_version': 1,
        'source_filename': source.name, 'source_columns': len(header),
        'header_line': header_line, 'source_preamble': preamble,
        'crashes': len(records), 'quality': dict(quality),
        'coverage': {'first_date': dates[0] if dates else None,
                     'last_date': dates[-1] if dates else None},
        'scope': 'Supplied Lubbock TxDOT district K/A/B/C injury-crash export',
        'definitions': {
            'counting_unit': 'One distinct Crash ID, not persons or vehicles',
            'factors': 'Distinct crashes recording each normalized contributing factor; NONE excluded',
            'factor_percentage': 'Factor crash count / all filtered crashes, including NONE and missing; percentages may exceed 100% in total',
            'coverage': 'Observed dates, not proof of complete reporting. Boundary periods may be partial; 2026 and October 2026 are incomplete in this export',
        },
    }

    # Atomic write: build into a temporary file first so a broken run never replaces a good database
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(dir=destination.parent, suffix='.sqlite')
    os.close(fd)
    try:
        with sqlite3.connect(temp_name) as db:
            # Create crashes and factors tables and indexes from schema.sql
            db.executescript(SCHEMA_PATH.read_text(encoding='utf-8'))
            for record, factors, _ in sorted(records.values(), key=lambda r: r[0][0]):
                db.execute('INSERT INTO crashes VALUES (?,?,?,?,?,?,?,?,?)', record)
                db.executemany('INSERT INTO factors VALUES (?,?)', [(record[0], f) for f in factors])
        # Publish only after all input validation and SQLite inserts commit successfully.
        os.replace(temp_name, destination)
    finally:
        Path(temp_name).unlink(missing_ok=True)
    return metadata


def summarize(database: Path) -> dict:
    """Compute the three required statistics without starting the REST server."""
    # Query database directly to compute official reference totals for verification
    with sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True) as db:
        severity = dict(db.execute('SELECT severity, COUNT(*) FROM crashes GROUP BY severity'))
        factors = [{'factor': factor, 'crashes': count} for factor, count in db.execute(
            'SELECT factor, COUNT(*) AS n FROM factors GROUP BY factor ORDER BY n DESC, factor ASC LIMIT 5')]
        yearly = [{'year': int(year), 'crashes': count} for year, count in db.execute(
            'SELECT substr(crash_date,1,4), COUNT(*) FROM crashes WHERE crash_date IS NOT NULL GROUP BY 1 ORDER BY 1')]
    return {'severity_counts': {s: severity.get(s, 0) for s in SEVERITIES},
            'top_five_factors': factors, 'yearly_crash_counts': yearly}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, nargs='?', help='Local CSV; omit to download the public dataset')
    parser.add_argument('--output', type=Path, default=DEFAULT_DB)
    args = parser.parse_args()
    if args.source is not None:
        metadata = build(args.source, args.output)
    else:
        with tempfile.TemporaryDirectory(prefix='crash-source-') as temporary:
            source = Path(temporary) / 'district_crashes.csv'
            try:
                with urlopen(DEFAULT_SOURCE_URL, timeout=60) as response, source.open('wb') as target:
                    shutil.copyfileobj(response, target)
                    expected = response.headers.get('Content-Length')
                if expected is not None and source.stat().st_size != int(expected):
                    raise OSError('Incomplete source download; try again')
            except OSError as exc:
                parser.exit(1, f'Could not download the source CSV: {exc}\n')
            metadata = build(source, args.output)
    print(json.dumps({'metadata': metadata, 'statistics': summarize(args.output)},
                     indent=2, allow_nan=False))


if __name__ == '__main__':
    main()
