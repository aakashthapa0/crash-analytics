"""Small fixtures target counting mistakes; real-snapshot tests prevent regressions."""
import csv
import io
import json
import sqlite3
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.api import app, handler
from data.clean import DEFAULT_DB, DataQualityError, REQUIRED, build, summarize
from data import clean


# Helper to synthesize miniature CRIS export files with preambles and arbitrary rows
def write_csv(path, rows):
    with path.open('w', encoding='utf-8-sig', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['Export metadata'])
        writer.writerow([])
        writer.writerow([*REQUIRED, 'Person Age'])
        for r in rows:
            writer.writerow([r.get(c, '') for c in [*REQUIRED, 'Person Age']])


# Baseline row template with clean sample data
def row(crash_id='1', **changes):
    base = dict(zip(REQUIRED, [crash_id, '2020-01-01', '2020', 'K - FATAL INJURY',
                ' Lubbock ', ' Speed ;SPEED; speed ;NONE', '33.5', '-101.8']))
    return base | changes


def test_clean_cli_downloads_public_source(tmp_path, monkeypatch, capsys):
    source = tmp_path / 'source.csv'
    write_csv(source, [row()])
    content = source.read_bytes()
    response = io.BytesIO(content)
    response.headers = {'Content-Length': str(len(content))}

    def download(url, timeout):
        assert url == clean.DEFAULT_SOURCE_URL
        assert timeout == 60
        return response

    destination = tmp_path / 'downloaded.sqlite'
    monkeypatch.setattr(clean, 'urlopen', download)
    monkeypatch.setattr(sys, 'argv', ['data.clean', '--output', str(destination)])
    clean.main()
    report = json.loads(capsys.readouterr().out)
    assert report['metadata']['source_filename'] == 'district_crashes.csv'
    assert report['metadata']['crashes'] == 1
    assert report['statistics']['severity_counts'] == {'K': 1, 'A': 0, 'B': 0, 'C': 0}
    assert summarize(destination)['severity_counts']['K'] == 1


def test_clean_cli_incomplete_download_preserves_database(tmp_path, monkeypatch):
    source = tmp_path / 'source.csv'
    write_csv(source, [row()])
    destination = tmp_path / 'existing.sqlite'
    build(source, destination)
    original = destination.read_bytes()
    response = io.BytesIO(source.read_bytes())
    response.headers = {'Content-Length': str(source.stat().st_size + 1)}
    monkeypatch.setattr(clean, 'urlopen', lambda *args, **kwargs: response)
    monkeypatch.setattr(sys, 'argv', ['data.clean', '--output', str(destination)])
    with pytest.raises(SystemExit) as error:
        clean.main()
    assert error.value.code == 1
    assert destination.read_bytes() == original


# Pytest fixture: builds an isolated test SQLite database containing key edge cases
# (person repetition, malformed dates, NONE factors, and missing coordinates)
@pytest.fixture
def fixture_data(tmp_path, monkeypatch):
    rows = [row(), row(**{'Person Age': '20'}), row(**{'Person Age': '21'}),
            row('2', **{'Crash Severity': 'A', 'County': 'Hale', 'Crash Date': 'bad',
                        'Crash Year': '2021', 'Contributing Factors': 'NONE', 'Latitude': 'No Data'}),
            row('3', **{'Crash Severity': 'B', 'County': 'Hale', 'Crash Date': '2021-02-01',
                        'Crash Year': '2021', 'Contributing Factors': 'No Data'}),
            row('4', **{'Crash Severity': 'C', 'Crash Date': '2020-03-01', 'Contributing Factors': 'Unsafe Speed'}),
            row('5', **{'County': 'Hale', 'Crash Date': '2020-02-01', 'Contributing Factors': 'Speed; Unsafe Speed'}),
            row('6', **{'Crash Severity': 'C', 'Crash Date': '2020-03-02', 'Contributing Factors': 'Unsafe Speed; speed'})]
    source, db = tmp_path / 'source.csv', tmp_path / 'crashes.sqlite'
    write_csv(source, rows)
    meta = build(source, db)
    # Direct FastAPI test client to use the temporary database instead of production
    monkeypatch.setenv('CRASH_DB_PATH', str(db))
    with TestClient(app) as client:
        yield client, meta, source, db


# Verify that 8 person-level rows correctly aggregate into 6 distinct crash records
def test_crash_grain_and_quality(fixture_data):
    client, meta, _, database = fixture_data
    with sqlite3.connect(database) as db:
        assert {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")} == {'crashes', 'factors'}
    assert meta['quality']['source_rows'] == 8
    assert meta['crashes'] == 6
    assert meta['quality']['invalid_dates'] == 1
    assert meta['quality']['no_recorded_factor'] == 1
    assert meta['quality']['missing_factor'] == 1
    counts = client.get('/api/v1/severity').json()
    assert set(counts) == {'filters', 'total_crashes', 'results'}
    assert counts['filters'] == {'county': None, 'year': None, 'severity': []}
    assert [r['crashes'] for r in counts['results']] == [2, 1, 1, 2]
    assert counts['total_crashes'] == 6


# Test semicolon splitting, casing normalization, deduplication within a crash, and tie sorting
def test_factor_split_normalization_and_stable_tie(fixture_data):
    client, *_ = fixture_data
    data = client.get('/api/v1/factors').json()
    assert set(data) == {'filters', 'total_crashes', 'results', 'no_recorded_factor', 'missing_factor'}
    assert [(r['factor'], r['crashes']) for r in data['results']] == [('SPEED', 3), ('UNSAFE SPEED', 3)]
    assert data['results'][0]['percentage'] == 50
    assert data['no_recorded_factor'] == data['missing_factor'] == 1
    limited = client.get('/api/v1/factors?limit=1').json()
    assert limited['total_crashes'] == data['total_crashes'] == 6
    assert limited['results'] == data['results'][:1]
    assert limited['no_recorded_factor'] == limited['missing_factor'] == 1


def test_offline_processing_produces_all_required_statistics(fixture_data):
    report = summarize(fixture_data[3])
    assert report['severity_counts'] == {'K': 2, 'A': 1, 'B': 1, 'C': 2}
    assert report['top_five_factors'] == [{'factor':'SPEED', 'crashes':3}, {'factor':'UNSAFE SPEED', 'crashes':3}]
    assert report['yearly_crash_counts'] == [{'year':2020, 'crashes':4}, {'year':2021, 'crashes':1}]


# Ensure combining multiple filters works with AND logic, and empty queries return clean 200 with 0s
def test_filters_combine_and_empty_selection(fixture_data):
    client, *_ = fixture_data
    query = '?county=lubbock&year=2020&severity=K&severity=C'
    for endpoint in ['severity', 'factors', 'trends', 'counties']:
        data = client.get('/api/v1/' + endpoint + query).json()
        assert data['total_crashes'] == 3
    empty = '?county=LUBBOCK&year=2021&severity=K'
    for endpoint in ['severity', 'factors', 'trends', 'counties']:
        response = client.get('/api/v1/' + endpoint + empty)
        assert response.status_code == 200
        data = response.json()
        assert data['total_crashes'] == 0
        assert all(r['crashes'] == 0 for r in data['results'])
        if endpoint == 'factors':
            assert data['no_recorded_factor'] == data['missing_factor'] == 0
        json.dumps(data, allow_nan=False)


def test_counties_include_unmapped_and_undated_crashes(fixture_data):
    client, *_ = fixture_data
    data = client.get('/api/v1/counties').json()
    assert set(data) == {'filters', 'total_crashes', 'results'}
    assert data['total_crashes'] == 6
    assert data['results'] == [{'county': 'HALE', 'crashes': 3}, {'county': 'LUBBOCK', 'crashes': 3}]
    assert len(client.get('/api/v1/points').json()['results']) == 5
    filtered = client.get('/api/v1/counties?county=HALE&year=2021&severity=A&severity=B').json()
    assert filtered['results'] == [{'county': 'HALE', 'crashes': 2}]
    assert filtered['total_crashes'] == 2
    assert client.get('/api/v1/counties?year=2020&year=2021').status_code == 422
    assert client.get('/api/v1/counties?granularity=year').status_code == 422


# Check that malicious, unknown, or malformed parameters are rejected with HTTP 422
@pytest.mark.parametrize('url', [
    '/api/v1/severity?county=nonexistent', '/api/v1/severity?severity=Z',
    '/api/v1/severity?year=1999', '/api/v1/severity?year=abc',
    '/api/v1/severity?county=', '/api/v1/factors?limit=0',
    '/api/v1/factors?limit=1001', '/api/v1/trends?granularity=decade',
    '/api/v1/severity?typo=2020', '/api/v1/severity?year=2020&year=2021',
    '/api/v1/severity?county=%27%20OR%201=1--',
])
def test_invalid_parameters_are_json_422(fixture_data, url):
    response = fixture_data[0].get(url)
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'invalid_parameter'


# Ensure time trends fill missing periods with zeros, mark boundary periods, and isolate invalid dates
def test_trend_zero_filling_partial_and_invalid_dates(fixture_data):
    client, *_ = fixture_data
    data = client.get('/api/v1/trends').json()
    expected_fields = {'filters', 'total_crashes', 'results', 'granularity', 'excluded_invalid_dates'}
    assert set(data) == expected_fields
    assert data['granularity'] == 'month'
    assert data['excluded_invalid_dates'] == 1
    assert data['total_crashes'] == 6
    assert sum(r['crashes'] for r in data['results']) == 5
    assert data['results'][-1]['partial_period'] is True
    assert data['results'][3] == {'period': '2020-04', 'crashes': 0, 'partial_period': False}
    yearly = client.get('/api/v1/trends?granularity=year').json()
    assert set(yearly) == expected_fields
    assert yearly['excluded_invalid_dates'] == 1
    assert [r['crashes'] for r in yearly['results']] == [4, 1]
    dow = client.get('/api/v1/trends?granularity=day_of_week').json()
    assert set(dow) == expected_fields
    assert dow['total_crashes'] == 6
    assert dow['excluded_invalid_dates'] == 1
    assert dow['granularity'] == 'day_of_week'
    assert len(dow['results']) == 7
    assert [r['period'] for r in dow['results']] == ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    assert [r['crashes'] for r in dow['results']] == [2, 0, 1, 0, 0, 1, 1]
    assert dow['results'][0]['percentage'] == 40.0
    # The redundant 'week' alias is rejected; clients must request 'day_of_week'.
    removed_alias = client.get('/api/v1/trends?granularity=week')
    assert removed_alias.status_code == 422
    error = removed_alias.json()['error']
    assert error['code'] == 'invalid_parameter'
    assert error['details'][0]['parameter'] == 'query.granularity'
    assert error['details'][0]['message'] == "Input should be 'month', 'year' or 'day_of_week'"


@pytest.mark.parametrize('granularity', ['month', 'year', 'day_of_week'])
def test_trends_empty_and_only_invalid_dates(fixture_data, granularity):
    client, *_ = fixture_data
    # The fixture's only A crash has an invalid date: counted in the total, not the periods.
    invalid = client.get('/api/v1/trends', params={'severity': 'A', 'granularity': granularity}).json()
    assert invalid['total_crashes'] == invalid['excluded_invalid_dates'] == 1
    assert all(r['crashes'] == 0 for r in invalid['results'])
    empty = client.get('/api/v1/trends', params={
        'county': 'LUBBOCK', 'year': 2021, 'granularity': granularity,
    }).json()
    assert empty['total_crashes'] == empty['excluded_invalid_dates'] == 0
    assert all(r['crashes'] == 0 for r in empty['results'])


# Atomic safety test: if new data contains conflicting crash attributes, the existing database must remain untouched
@pytest.mark.parametrize('changes', [
    {'County': 'HALE'}, {'Contributing Factors': 'DIFFERENT'},
    {'Crash Date': '2020-02-01'}, {'Latitude': '34.0'},
])
def test_conflicts_preserve_previous_database(tmp_path, changes):
    source, db = tmp_path / 'source.csv', tmp_path / 'db.sqlite'
    write_csv(source, [row()])
    build(source, db)
    original = db.read_bytes()
    write_csv(source, [row(), row(**changes)])
    with pytest.raises(DataQualityError, match='Conflicting'):
        build(source, db)
    assert db.read_bytes() == original


# Structural checks: reject rows with empty Crash ID, invalid years, or unknown severity codes
@pytest.mark.parametrize('changes', [{'Crash ID': ''}, {'Crash Year': '2021'}, {'Crash Severity': 'Q'}])
def test_invalid_structural_records_fail(tmp_path, changes):
    source = tmp_path / 'source.csv'
    write_csv(source, [row(**changes)])
    with pytest.raises(DataQualityError):
        build(source, tmp_path / 'db.sqlite')


# Malformed files: reject files missing required headers or rows with wrong column count
def test_missing_header_and_malformed_rows(tmp_path):
    source = tmp_path / 'source.csv'
    source.write_text('invalid header\n1,2,3\n')
    with pytest.raises(DataQualityError, match='header'):
        build(source, tmp_path / 'db.sqlite')
    write_csv(source, [row()])
    with source.open('a') as f:
        f.write('too,few,columns\n')
    with pytest.raises(DataQualityError, match='Malformed'):
        build(source, tmp_path / 'db.sqlite')


# Sentinels & cleaning: verify 'No Data', 'NaN', and '-1' are treated as missing without breaking the build
def test_missing_fields_case_and_sentinels(tmp_path):
    source, db = tmp_path / 'source.csv', tmp_path / 'db.sqlite'
    write_csv(source, [row(**{'Crash Year': '', 'County': 'No Data', 'Latitude': 'NaN',
                             'Contributing Factors': ' ; No data ; -1; '})])
    meta = build(source, db)
    assert meta['quality']['missing_counties'] == 1
    assert meta['quality']['missing_factor'] == 1
    assert meta['quality']['unusable_coordinates'] == 1
    with sqlite3.connect(db) as conn:
        assert conn.execute('SELECT year FROM crashes').fetchone()[0] == 2020


# Endpoint verification: metadata, health, docs, and frontend paths excluded from the API.
def test_metadata_unknown_routes_and_health(fixture_data):
    client, *_ = fixture_data
    metadata = client.get('/api/v1/metadata').json()
    assert set(metadata) == {'scope', 'crashes', 'coverage', 'quality', 'definitions', 'available_filters'}
    assert metadata['crashes'] == 6
    assert metadata['coverage'] == {'first_date': '2020-01-01', 'last_date': '2021-02-01'}
    assert metadata['quality']['unusable_coordinates'] == 1
    assert metadata['available_filters']['counties'] == ['HALE', 'LUBBOCK']
    assert metadata['available_filters']['years'] == [2020, 2021]
    assert set(metadata['available_filters']['severities']) == {'K', 'A', 'B', 'C'}
    assert set(metadata['definitions']) == {'counting_unit', 'factors', 'factor_percentage', 'coverage'}
    assert '2026' not in metadata['definitions']['coverage']
    health = client.get('/health')
    assert health.status_code == 200
    assert health.json() == {'status': 'ok'}
    assert client.get('/missing').status_code == 404
    assert client.get('/missing').json()['error']['code'] == 'not_found'
    for path in ['/', '/static/index.html', '/static/assets/index.js']:
        response = client.get(path)
        assert response.status_code == 404
        assert response.json()['error']['code'] == 'not_found'
    assert client.get('/docs').status_code == 200
    schema = client.get('/openapi.json')
    assert schema.status_code == 200
    assert schema.json()['info']['title'] == 'Crash Analytics API'


# Test the Mangum adapter by simulating an AWS Lambda Function URL payload
def test_lambda_function_url_adapter(fixture_data):
    event = {'version': '2.0', 'routeKey': '$default', 'rawPath': '/api/v1/severity',
             'rawQueryString': 'severity=K&severity=A',
             'headers': {'host': 'example.lambda-url.us-east-1.on.aws', 'x-forwarded-proto': 'https'},
             'requestContext': {'http': {'method': 'GET', 'path': '/api/v1/severity',
                                         'sourceIp': '127.0.0.1', 'protocol': 'HTTP/1.1'}},
             'isBase64Encoded': False}
    result = handler(event, {})
    assert result['statusCode'] == 200
    assert json.loads(result['body'])['total_crashes'] == 3


# Baseline regression test: confirms the production SQLite snapshot matches official benchmark figures
def test_supplied_snapshot_reference_totals(monkeypatch):
    monkeypatch.setenv('CRASH_DB_PATH', str(DEFAULT_DB))
    with TestClient(app) as client:
        assert [r['crashes'] for r in client.get('/api/v1/severity').json()['results']] == [624, 1546, 7224, 14867]
        factors = client.get('/api/v1/factors').json()
        assert [(r['factor'], r['crashes']) for r in factors['results'][:5]] == [
            ('FAILED TO CONTROL SPEED', 5559),
            ('FAILED TO YIELD RIGHT OF WAY - STOP SIGN', 2428),
            ('FAILED TO YIELD RIGHT OF WAY - TURNING LEFT', 2346),
            ('FAILED TO DRIVE IN SINGLE LANE', 2334), ('UNSAFE SPEED', 2034)]
        assert len(factors['results']) == 73
        assert factors['no_recorded_factor'] == 104
        assert [r['crashes'] for r in client.get('/api/v1/trends?granularity=year').json()['results']] == [3351, 3971, 3716, 3673, 3452, 3444, 2654]
        assert sum(r['crashes'] for r in client.get('/api/v1/trends').json()['results']) == 24261
        assert [r['crashes'] for r in client.get('/api/v1/trends?granularity=day_of_week').json()['results']] == [3396, 3452, 3532, 3614, 3903, 3510, 2854]
        for query in ['?county=HALE&year=2021&severity=K&severity=A', '?county=LUBBOCK&year=2026', '?severity=K']:
            sev = client.get('/api/v1/severity' + query).json()
            tr = client.get('/api/v1/trends' + query).json()
            dow = client.get('/api/v1/trends?granularity=day_of_week' + query.replace('?', '&')).json()
            assert sum(r['crashes'] for r in sev['results']) == sum(r['crashes'] for r in tr['results']) == sum(r['crashes'] for r in dow['results']) == sev['total_crashes']


# Spatial points test: verifies that coordinates and severities match filter parameters
def test_points_limits_and_missing_coordinates(fixture_data):
    client, *_ = fixture_data
    data = client.get('/api/v1/points').json()
    assert set(data) == {'filters', 'total_crashes', 'results', 'total_points'}
    assert data['total_crashes'] == 6
    assert data['total_points'] == len(data['results']) == 5
    assert all(set(p) == {'lat', 'lon', 'severity', 'id', 'date', 'county', 'factor'} for p in data['results'])
    assert next(p for p in data['results'] if p['id'] == '3')['factor'] == 'No factor recorded'

    limited = client.get('/api/v1/points?county=hale&year=2021&limit=1').json()
    assert limited['filters'] == {'county': 'HALE', 'year': 2021, 'severity': []}
    assert limited['total_crashes'] == 2
    assert limited['total_points'] == len(limited['results']) == 1
    assert limited['results'][0]['id'] == '3'

    # Crashes without coordinates remain in the selection total even when no point can be plotted.
    unmappable = client.get('/api/v1/points?severity=A').json()
    assert unmappable['total_crashes'] == 1
    assert unmappable['total_points'] == 0
    assert unmappable['results'] == []
    empty = client.get('/api/v1/points?county=LUBBOCK&year=2021').json()
    assert empty['total_crashes'] == empty['total_points'] == 0
    assert empty['results'] == []


def test_points_endpoint_filters_and_coordinates(monkeypatch):
    monkeypatch.setenv('CRASH_DB_PATH', str(DEFAULT_DB))
    with TestClient(app) as client:
        res = client.get('/api/v1/points?county=LUBBOCK&year=2026&severity=K')
        assert res.status_code == 200
        data = res.json()
        assert data['total_points'] == 33
        assert len(data['results']) == 33
        pt = data['results'][0]
        assert 'lat' in pt and 'lon' in pt and 'severity' in pt
        assert pt['severity'] == 'K'
        assert pt['county'] == 'LUBBOCK'


