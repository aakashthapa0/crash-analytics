import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyView, readView, viewQuery } from '../src/utils/filters.js';
import { endpoint } from '../src/api/urls.js';
import { buildCSVContent, buildCSVFilename } from '../src/utils/csv.js';
import { chartScale, countySlices, monthlyProfile } from '../src/utils/charts.js';
import { isPartialYear, formatDate } from '../src/utils/format.js';

// Verify pure helpers without mounting React or calling the API.

// Verify that full URL search params round-trip cleanly into structured state and back
test('shared URL restores filters without leaking an API granularity into filter state', () => {
  const view = readView('?county=hale&year=2021&severity=K&severity=A&severity=K&granularity=year');
  assert.deepEqual(view, { county: 'HALE', year: '2021', severity: ['A', 'K'] });
  assert.deepEqual(readView('?' + viewQuery(view)), view);
});

// Confirm that shared filters propagate to all 3 endpoints, but granularity is isolated to /trends
test('all analytical URLs carry the same filters without leaking trend parameters', () => {
  const view = readView('?county=LUBBOCK&year=2026&severity=K&severity=A&granularity=year');
  const urls = ['severity', 'factors', 'trends', 'counties'].map(name => new URL(endpoint(name, view), 'https://example.org'));
  for (const url of urls) {
    assert.equal(url.searchParams.get('county'), 'LUBBOCK');
    assert.equal(url.searchParams.get('year'), '2026');
    assert.deepEqual(url.searchParams.getAll('severity'), ['A', 'K']);
  }
  assert.equal(urls[0].searchParams.has('granularity'), false);
  assert.equal(urls[1].searchParams.has('granularity'), false);
  assert.equal(urls[2].searchParams.get('granularity'), 'month');
  assert.equal(urls[3].searchParams.has('granularity'), false);
  for (const granularity of ['year', 'month', 'day_of_week']) {
    const url = new URL(endpoint('trends', view, granularity), 'https://example.org');
    assert.equal(url.searchParams.get('granularity'), granularity);
    assert.equal(url.searchParams.get('county'), 'LUBBOCK');
    assert.equal(url.searchParams.get('year'), '2026');
    assert.deepEqual(url.searchParams.getAll('severity'), ['A', 'K']);
  }
});

test('chart scales include every API value and keep integer ticks for sparse selections', () => {
  for (const values of [[], [0], [1], [3971, 2654], [500, 620], [1, 10000]]) {
    const scale = chartScale(values);
    assert.ok(scale.maximum >= Math.max(0, ...values));
    assert.ok(scale.maximum > 0);
    assert.ok(scale.ticks.every(Number.isInteger));
    assert.equal(scale.ticks.at(-1), scale.maximum);
  }
});

test('monthly profile totals the same month across years and preserves reporting coverage', () => {
  const results = [
    { period: '2025-01', crashes: 10, partial_period: false },
    { period: '2026-01', crashes: 20, partial_period: false },
    { period: '2025-10', crashes: 5, partial_period: false },
    { period: '2026-10', crashes: 7, partial_period: true },
    { period: '2025-11', crashes: 0, partial_period: false },
  ];
  const rows = monthlyProfile(results);
  assert.equal(rows.length, 12);
  assert.deepEqual(rows.map(row => row.period), ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);
  assert.equal(rows[0].crashes, 30);
  assert.equal(rows[9].crashes, 12);
  assert.equal(rows[9].partial_period, true);
  assert.equal(rows[10].crashes, 0);
  assert.deepEqual(rows[10].years.map(row => row.crashes), [0, null]);
  assert.deepEqual(rows[0].years.map(row => row.year), ['2025', '2026']);
  assert.equal(rows[0].years[0].percentage, 100 * 10 / 15);
  assert.equal(rows[0].years[1].percentage, 100 * 20 / 27);
  assert.deepEqual(rows[10].years.map(row => row.percentage), [0, null]);
  assert.equal(rows[11].crashes, null);
  assert.equal(rows.reduce((sum, row) => sum + (row.crashes ?? 0), 0), results.reduce((sum, row) => sum + row.crashes, 0));
  const single = monthlyProfile(results.filter(row => row.period.startsWith('2026')));
  assert.equal(single[0].crashes, 20);
  assert.equal(single[9].crashes, 7);
  assert.equal(single[10].crashes, null);
  for (const year of ['2025', '2026']) {
    const totalPercentage = rows.reduce((sum, row) => sum + (row.years.find(item => item.year === year).percentage ?? 0), 0);
    assert.ok(Math.abs(totalPercentage - 100) < 0.00001);
  }
  const zero = monthlyProfile([{ period: '2030-01', crashes: 0, partial_period: false }]);
  assert.equal(zero[0].years[0].percentage, 0);
  assert.equal(zero[1].years[0].percentage, null);
  assert.deepEqual(monthlyProfile([]), []);
});

test('county pie ranks five counties and keeps the remaining share in the denominator', () => {
  const rows = [['HALE', 30], ['LUBBOCK', 80], ['LYNN', 4], ['HOCKLEY', 15], ['CROSBY', 3], ['TERRY', 10], ['BAILEY', 3]]
    .map(([county, crashes]) => ({ county, crashes }));
  const total = rows.reduce((sum, row) => sum + row.crashes, 0);
  const slices = countySlices(rows, total);
  assert.deepEqual(slices.map(row => row.county), ['LUBBOCK', 'HALE', 'HOCKLEY', 'TERRY', 'LYNN', 'Other counties']);
  assert.equal(slices.at(-1).crashes, 6);
  assert.ok(Math.abs(slices.reduce((sum, row) => sum + row.percentage, 0) - 100) < 0.00001);
  assert.deepEqual(countySlices([], 0), []);
  assert.equal(countySlices([{ county: 'HALE', crashes: 2 }], 2)[0].percentage, 100);
  assert.equal(rows[0].county, 'HALE');
});

// Ensure default filter state produces clean, query-free URLs
test('reset removes filters and default state has a clean shareable URL', () => {
  assert.equal(viewQuery(emptyView()), '');
  assert.equal(endpoint('severity', emptyView()), '/api/v1/severity');
});

test('invalid filters reach API validation while chart granularity stays monthly', () => {
  for (const granularity of ['year', 'day_of_week', 'week']) {
    const view = readView(`?severity=Z&granularity=${granularity}`);
    assert.match(endpoint('trends', view), /severity=Z/);
    assert.match(endpoint('trends', view), /granularity=month/);
    assert.doesNotMatch(viewQuery(view), /granularity/);
  }
});

// Verify dynamic, filter-aware CSV export generation with active filters
test('dynamic CSV export generates filter-aware headers, counts, percentages, and filename', () => {
  const view = { county: 'HALE', year: 2023, severity: ['K', 'A'] };
  const visibleSeverity = [
    { code: 'K', label: 'Fatal injury', count: 10 },
    { code: 'A', label: 'Suspected serious injury', count: 40 },
  ];
  const factorData = {
    results: [
      { factor: 'SPEEDING', crashes: 25 },
      { factor: 'DISTRACTION', crashes: 15 },
    ],
    no_recorded_factor: 2,
    missing_factor: 1,
  };
  const metadata = { scope: 'API export scope', coverage: { first_date: '2028-04-03', last_date: '2029-09-12' },
    definitions: { counting_unit: 'API counting unit' }, available_filters: { counties: ['HALE', 'LUBBOCK'],
      years: [2028, 2029], severities: { K: 'Fatal injury', A: 'Suspected serious injury' } } };
  const csv = buildCSVContent({ view, visibleSeverity, viewTotal: 50, factorData, metadata });
  assert.ok(csv.startsWith('"Crash Analytics Data Export",""\n'));
  assert.match(csv, /"County Filter","Hale County"/);
  assert.match(csv, /"Year Filter","2023"/);
  assert.match(csv, /"Severity Filter","Fatal injury \+ Suspected serious injury"/);
  assert.match(csv, /"Total Distinct Injury Crashes in Selection","50"/);
  assert.match(csv, /"Fatal injury","10","20.00%"/);
  assert.match(csv, /"Suspected serious injury","40","80.00%"/);
  assert.match(csv, /"Explicit NONE Recorded","2","4.00%"/);
  assert.match(csv, /"Missing Factor Field","1","2.00%"/);
  assert.match(csv, /"SPEEDING","25","50.00%"/);
  assert.match(csv, /"DISTRACTION","15","30.00%"/);

  assert.equal(buildCSVFilename(view), 'crashes-hale-2023.csv');
  assert.match(csv, /2028-04-03 through 2029-09-12 \(2028, 2029 partial\)/);
  assert.match(csv, /"Dataset Scope","API export scope"/);
  assert.match(csv, /"Counting Unit","API counting unit"/);
  const all = buildCSVContent({ metadata });
  assert.match(all, /"County Filter","All 2 Counties \(District\)"/);
  assert.match(all, /"Year Filter","All Years \(2028-2029\)"/);
  assert.doesNotMatch(all.split('\n').filter(line => !line.startsWith('"Export Date"')).join('\n'), /2020|2026|17 Counties/);
  assert.equal(buildCSVFilename(emptyView(), metadata), 'crashes-all-counties-2028-2029.csv');
  assert.equal(buildCSVFilename(emptyView()), 'crashes-all-counties-all-years.csv');
});

test('partial years follow observed coverage instead of a fixed final year', () => {
  const coverage = { first_date: '2028-04-03', last_date: '2030-12-31' };
  assert.equal(isPartialYear(2028, coverage), true);
  assert.equal(isPartialYear(2029, coverage), false);
  assert.equal(isPartialYear('2030', coverage), false);
  assert.equal(isPartialYear(2031, coverage), true);
  assert.equal(isPartialYear(2029, { first_date: null, last_date: null }), false);
  assert.equal(formatDate('2029-09-12'), 'Sep 12, 2029');
  assert.equal(formatDate(null), 'Not supplied');
});

