"""Verify an unauthenticated local or remote deployment against the supplied snapshot.

Usage: python scripts/smoke.py https://YOUR_CLOUDFRONT_DOMAIN/
       python scripts/smoke.py https://YOUR_API_FUNCTION_URL/ --api-only
Uses only the standard library. Exits nonzero on a regression or snapshot count mismatch.
"""
import json
import re
import argparse
from urllib.error import HTTPError
from urllib.request import urlopen

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url')
    parser.add_argument('--api-only', action='store_true', help='Check the API origin without frontend page and asset checks')
    args = parser.parse_args()
    base = args.url.rstrip('/')
    checks = []

    # Helper to make GET requests and verify HTTP 200.
    def get(path):
        with urlopen(base + path, timeout=30) as response:
            assert response.status == 200
            body = json.load(response)
            checks.append(path)
            return body

    # Verify baseline crash counts by injury severity (K, A, B, C)
    assert get('/health') == {'status': 'ok'}
    severity = get('/api/v1/severity')
    assert severity['total_crashes'] == 24261
    assert [r['crashes'] for r in severity['results']] == [624, 1546, 7224, 14867]

    # Verify top contributing factors and count of crashes with explicit NONE factors
    factors = get('/api/v1/factors')
    assert [(r['factor'], r['crashes']) for r in factors['results'][:5]] == [
        ('FAILED TO CONTROL SPEED', 5559), ('FAILED TO YIELD RIGHT OF WAY - STOP SIGN', 2428),
        ('FAILED TO YIELD RIGHT OF WAY - TURNING LEFT', 2346),
        ('FAILED TO DRIVE IN SINGLE LANE', 2334), ('UNSAFE SPEED', 2034)]
    assert factors['no_recorded_factor'] == 104

    # Verify the map endpoint preserves selection totals when the result count is limited.
    points = get('/api/v1/points?limit=2')
    assert points['total_crashes'] == severity['total_crashes']
    assert points['total_points'] == len(points['results']) == 2
    assert all('lat' in p and 'lon' in p and 'id' in p for p in points['results'])

    # Verify chronological trends: check yearly counts, partial boundary flags, and monthly sum
    trends = get('/api/v1/trends?granularity=year')
    assert [r['crashes'] for r in trends['results']] == [3351, 3971, 3716, 3673, 3452, 3444, 2654]
    assert trends['results'][-1]['partial_period'] is True
    assert sum(r['crashes'] for r in get('/api/v1/trends')['results']) == 24261
    weekdays = get('/api/v1/trends?granularity=day_of_week')
    assert [r['period'] for r in weekdays['results']] == ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    assert sum(r['crashes'] for r in weekdays['results']) == weekdays['total_crashes'] - weekdays['excluded_invalid_dates']

    counties = get('/api/v1/counties')
    assert counties['total_crashes'] == sum(r['crashes'] for r in counties['results']) == severity['total_crashes']
    assert len(counties['results']) == 17
    assert counties['results'] == sorted(counties['results'], key=lambda row: (-row['crashes'], row['county']))

    # Verify dataset metadata: check all 17 counties are listed and unusable coordinates are tracked
    metadata = get('/api/v1/metadata')
    assert len(metadata['available_filters']['counties']) == 17
    assert metadata['quality']['unusable_coordinates'] == 849

    # Verify cross-endpoint consistency: filtered results must report identical crash totals
    for query in ['?county=LUBBOCK&year=2026', '?county=HALE&year=2021&severity=K&severity=A']:
        s, f, t, c = [get('/api/v1/' + name + query) for name in ['severity', 'factors', 'trends', 'counties']]
        assert s['total_crashes'] == f['total_crashes'] == t['total_crashes'] == c['total_crashes']
        assert sum(r['crashes'] for r in c['results']) == s['total_crashes']
        assert sum(r['crashes'] for r in s['results']) == sum(r['crashes'] for r in t['results']) == s['total_crashes']
        assert s['filters'] == f['filters'] == t['filters']
    assert get('/api/v1/severity?severity=K&severity=A')['total_crashes'] == 2170

    # Verify defensive error handling: bad inputs must return 422 and missing routes 404
    for path, expected in [('/api/v1/severity?severity=Z', 422), ('/api/v1/factors?limit=0', 422),
                           ('/api/v1/trends?granularity=week', 422), ('/api/v1/missing', 404)]:
        try:
            urlopen(base + path, timeout=30)
            raise AssertionError('Expected error')
        except HTTPError as exc:
            assert exc.code == expected
            assert 'error' in json.load(exc)
            checks.append(path)

    # Verify documentation and static frontend assets: check HTML, JS/CSS bundles, and cache headers
    for path in (['/docs', '/openapi.json'] if args.api_only else ['/', '/docs', '/openapi.json']):
        with urlopen(base + path, timeout=30) as response:
            assert response.status == 200
            checks.append(path)
            if path == '/':
                html = response.read().decode()
                assert '<title>Crash Analytics</title>' in html
                assert '<meta name="application-name" content="Crash Analytics"' in html
                assets = re.findall(r'(?:src|href)="(/static/assets/[^\"]+)"', html)
                assert any(p.endswith('.js') for p in assets)
                assert any(p.endswith('.css') for p in assets)
                for asset in assets:
                    with urlopen(base + asset, timeout=30) as static_response:
                        assert static_response.status == 200
                        assert 'immutable' in static_response.headers.get('Cache-Control', '')
                        checks.append(asset)
            elif path == '/openapi.json':
                assert json.load(response)['info']['title'] == 'Crash Analytics API'
    print(json.dumps({'status': 'passed', 'base_url': base, 'checks': len(checks)}, indent=2))


if __name__ == '__main__':
    main()
