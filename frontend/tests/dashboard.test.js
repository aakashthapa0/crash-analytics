import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
import * as filters from '../src/utils/filters.js';
import * as format from '../src/utils/format.js';
import * as charts from '../src/utils/charts.js';
import * as csv from '../src/utils/csv.js';
import * as urls from '../src/api/urls.js';
import * as constants from '../src/constants/dashboard.js';
import * as mapConstants from '../src/constants/map.js';

// Exercise the composed dashboard with controlled API responses and browser APIs.
const helpers = { ...filters, ...format, ...charts, ...csv, ...urls, ...constants };

const hooks = { React, useState, useEffect, useRef, useMemo, useCallback, ...helpers };
// Compile JSX with the installed Vite transformer so these tests do not need a browser.
const compile = async (source, name, context) => {
  const { code } = await transformWithOxc(source, 'test.jsx', { jsx: { runtime: 'classic' } });
  return new Function(...Object.keys(context), `${code}\nreturn ${name};`)(...Object.values(context));
};

const readSource = async path => (await readFile(new URL(`../src/${path}`, import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace('export default ', '');
const load = async (path, name, context) => compile(await readSource(path), name, context);

const testMetadata = {
  scope: 'API test dataset', crashes: 20,
  coverage: { first_date: '2028-04-03', last_date: '2029-09-12' },
  quality: { unusable_coordinates: 3 },
  definitions: { counting_unit: 'API counting unit', coverage: 'API coverage explanation' },
  available_filters: { counties: ['HALE', 'TEST COUNTY'], years: [2028, 2029],
    severities: { K: 'API fatal injury', A: 'API serious injury' } },
};

test('dashboard hides statistics and disables export while loading or failed', async () => {
  let response = { status: 'loading', data: null, error: '' };
  let metadataResponse = { status: 'ready', data: [testMetadata], error: '' };
  const urls = [];
  const metadataUrls = [];
  const context = {
    ...hooks,
    window: { location: { search: '?county=HALE&year=2021&severity=K' }, matchMedia: () => ({ matches: false }) },
    useApiData: requests => {
      if (requests[0] === '/api/v1/metadata') { metadataUrls.push(requests); return metadataResponse; }
      urls.push(requests); return response;
    },
    Icon: () => null, AnimatedNumber: ({ value }) => value,
    CountyMap: () => React.createElement('section', { id: 'district-map' }), FactorExplorer: () => null,
    CrashTimeline: () => React.createElement('section', { id: 'timeline' }),
    CountyPie: () => React.createElement('section', { id: 'top-counties' }),
    usePageReveal: () => {},
  };
  for (const name of ['Sidebar', 'DashboardHeader', 'DashboardFilters', 'SummaryMetrics', 'SeverityPanel']) {
    context[name] = await load(`components/${name}.jsx`, name, context);
  }
  for (const name of ['useFilters', 'useNavigation', 'useDashboardData']) {
    context[name] = await load(`hooks/${name}.js`, name, context);
  }
  context.Dashboard = await load('pages/Dashboard.jsx', 'Dashboard', context);
  const App = await load('App.jsx', 'App', context);
  let html = renderToStaticMarkup(React.createElement(App));
  assert.match(html, /<h1>Crash Analytics<\/h1>/);
  assert.match(html, /disabled=""/);
  assert.match(html, /Loading crash statistics/);
  assert.match(html, /<main id="overview" aria-busy="true">/);
  assert.doesNotMatch(html, /Distinct injury crashes/);
  assert.deepEqual(metadataUrls[0], ['/api/v1/metadata']);
  assert.match(html, /All 2 counties/);
  assert.match(html, /value="TEST COUNTY">Test County/);
  assert.match(html, /2028 · partial/);
  assert.match(html, /2029 · partial/);
  assert.match(html, /Apr 3, 2028 — Sep 12, 2029/);
  assert.match(html, /API coverage explanation/);
  assert.match(html, /API fatal injury/);
  assert.doesNotMatch(html, /All 17 counties|JAN 2020|OCT 2026|value="2026"/);
  assert.equal(urls[0].length, 6);
  for (const request of urls[0].slice(3)) {
    const url = new URL(request, 'https://example.org');
    assert.equal(url.searchParams.get('county'), 'HALE');
    assert.equal(url.searchParams.get('severity'), 'K');
    assert.equal(url.searchParams.get('year'), '2021');
  }
  assert.deepEqual(urls[0].slice(3, 6).map(url => new URL(url, 'https://example.org').searchParams.get('granularity')), ['year', 'month', 'day_of_week']);
  assert.match(urls[0][2], /\/counties\?/);
  assert.match(html, /aria-label="Top 5 counties"/);

  response = { status: 'error', data: null, error: 'Unknown county' };
  html = renderToStaticMarkup(React.createElement(App));
  assert.match(html, /role="alert"/);
  assert.match(html, /Unknown county/);
  assert.doesNotMatch(html, /Distinct injury crashes/);

  response = { status: 'ready', error: '', data: [
    { total_crashes: 10, results: [{ severity: 'K', crashes: 10, percentage: 100 }] },
    { no_recorded_factor: 4, missing_factor: 1, results: [] },
    { total_crashes: 10, results: [{ county: 'HALE', crashes: 10 }] },
    { results: [] }, { results: [] }, { results: [] },
  ] };
  html = renderToStaticMarkup(React.createElement(App));
  assert.doesNotMatch(html, /disabled=""/);
  assert.match(html, /<main id="overview" aria-busy="false">/);
  const summary = html.match(/<section class="metrics"[^>]*>(.*?)<\/section>/s)[1];
  assert.deepEqual([...summary.matchAll(/<span>(.*?)<\/span><strong>(.*?)<\/strong>/g)]
    .map(([, label, value]) => [label, value]), [
    ['Distinct injury crashes', '10'], ['Fatal + serious injury crashes', '10'],
    ['Fatal injury crashes', '10'], ['Without a recorded factor', '5'],
  ]);
  assert.doesNotMatch(summary, /<p|<i|of selected crashes|explicit NONE|individual fatalities|API counting unit/);
  assert.doesNotMatch(html, /Not supplied by severity/);
  assert.match(html, /class="time-county-row"><section id="timeline"><\/section><section id="top-counties"><\/section><\/div><section id="district-map">/);
  assert.ok(html.indexOf('aria-label="Top 5 counties"') < html.indexOf('aria-label="Crash map"'));

  metadataResponse = { status: 'error', data: null, error: 'Network unavailable' };
  html = renderToStaticMarkup(React.createElement(App));
  assert.match(html, /Dataset information unavailable: Network unavailable/);
  assert.match(html, /Dataset unavailable/);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /Distinct injury crashes|All 17 counties|2020|2026/);

  metadataResponse = { status: 'loading', data: null, error: '' };
  html = renderToStaticMarkup(React.createElement(App));
  assert.match(html, /Loading dataset information/);
  assert.doesNotMatch(html, /Distinct injury crashes|API test dataset|2020|2026/);
});

test('entrance reveals visible cards in page order and respects reduced motion', async () => {
  let effect, notify, disconnected = false;
  const observed = [], revealed = [];
  const elements = ['filters', 'metrics', 'map'].map(name => {
    const classes = new Set(), properties = new Map();
    return { name, classes, properties,
      classList: {
        add: value => { classes.add(value); if (value === 'is-visible') revealed.push(name); },
        remove: (...values) => values.forEach(value => classes.delete(value)),
      },
      style: { setProperty: (key, value) => properties.set(key, value), removeProperty: key => properties.delete(key) },
    };
  });
  class Observer {
    constructor(callback) { notify = callback; }
    observe(element) { observed.push(element); }
    unobserve(element) { observed.splice(observed.indexOf(element), 1); }
    disconnect() { disconnected = true; }
  }
  const setup = new Function('useLayoutEffect', 'window', 'document', 'IntersectionObserver', 'status',
    `${await readSource('hooks/usePageReveal.js')}\nusePageReveal(status);`);
  const window = { matchMedia: () => ({ matches: false }), IntersectionObserver: Observer };
  const document = { querySelectorAll: () => elements };
  setup(callback => { effect = callback; }, window, document, Observer, 'ready');
  const cleanup = effect();
  assert.ok(elements.every(element => element.classes.has('load-reveal')));
  assert.deepEqual(revealed, []);
  notify([
    { target: elements[1], isIntersecting: true },
    { target: elements[2], isIntersecting: false },
    { target: elements[0], isIntersecting: true },
  ]);
  assert.deepEqual(revealed, ['filters', 'metrics']);
  assert.equal(elements[0].properties.get('--reveal-delay'), '0ms');
  assert.equal(elements[1].properties.get('--reveal-delay'), '70ms');
  assert.deepEqual(observed, [elements[2]]);
  notify([{ target: elements[2], isIntersecting: true }]);
  assert.equal(elements[2].properties.get('--reveal-delay'), '0ms');
  cleanup();
  assert.equal(disconnected, true);
  assert.ok(elements.every(element => !element.classes.size && !element.properties.size));

  for (const fallback of [{ matchMedia: () => ({ matches: true }), IntersectionObserver: Observer },
    { matchMedia: () => ({ matches: false }) }]) {
    revealed.length = 0;
    setup(callback => { effect = callback; }, fallback, document, Observer, 'ready');
    assert.equal(effect(), undefined);
    assert.deepEqual(revealed, ['filters', 'metrics', 'map']);
    elements.forEach(element => element.classes.clear());
  }
});

test('scroll navigation handles adjacent chart panels, stacked panels and the map below', async () => {
  let active = 'top-counties', onScroll;
  const frames = [];
  const tops = { factors: 500, severity: 500, timeline: 1000, 'top-counties': 1000, 'district-map': 2400 };
  const window = { scrollY: 1000, innerHeight: 1000, innerWidth: 1440,
    requestAnimationFrame: callback => frames.push(callback),
    matchMedia: () => ({ matches: false }),
    addEventListener: (name, handler) => { if (name === 'scroll') onScroll = handler; }, removeEventListener() {} };
  const context = { window, document: { documentElement: { scrollHeight: 5000 },
    getElementById: id => ({ getBoundingClientRect: () => ({ top: tops[id] - window.scrollY }) }) },
    useEffect: callback => callback(), useRef: value => ({ current: value }),
    useState: initial => [typeof initial === 'function' ? initial() : active,
      value => { active = typeof value === 'function' ? value(active) : value; }] };
  const useNavigation = await load('hooks/useNavigation.js', 'useNavigation', context);
  useNavigation();
  frames.shift()();
  assert.equal(active, 'top-counties');
  active = 'overview';
  onScroll(); frames.shift()();
  assert.equal(active, 'timeline');
  tops['top-counties'] = 1700;
  window.scrollY = 1500;
  onScroll(); frames.shift()();
  assert.equal(active, 'top-counties');
  window.scrollY = 2400;
  onScroll(); frames.shift()();
  assert.equal(active, 'district-map');
  window.scrollY = 4000;
  onScroll(); frames.shift()();
  assert.equal(active, 'district-map');
});

test('timeline displays year, month and weekday API counts in order without clipping high counts', async () => {
  const source = (await readFile(new URL('../src/components/CrashTimeline.jsx', import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '').replace('export default ', '');
  const props = {
    yearData: { results: [{ period: '2022', crashes: 0, partial_period: false }, { period: '2023', crashes: 3971, partial_period: true }], excluded_invalid_dates: 1 },
    monthData: { results: [{ period: '2023-06', crashes: 502, partial_period: true }] },
    weekdayData: { results: [{ period: 'Monday', crashes: 700, percentage: 100 }] },
  };
  for (const [mode, expected] of [['year', '3,971'], ['month', '502'], ['day_of_week', '700']]) {
    const CrashTimeline = await compile(source, 'CrashTimeline', hooks);
    const html = renderToStaticMarkup(React.createElement(CrashTimeline, { ...props, mode }));
    assert.match(html, new RegExp(expected));
    assert.ok(html.indexOf('>Year</option>') < html.indexOf('>Months</option>'));
    assert.ok(html.indexOf('>Months</option>') < html.indexOf('>Day of the week</option>'));
    assert.doesNotMatch(html, /<option value="comparison"/);
    assert.equal((html.match(/<option /g) || []).length, 3);
    assert.doesNotMatch(html, /(?:cy|y|height)="(?:NaN|-\d)/);
    assert.match(html, /viewBox="0 0 1000 320"/);
    const bars = [...html.matchAll(/<rect\b([^>]*)><title>([^<]*)<\/title><\/rect>/g)];
    assert.equal(bars.length, mode === 'year' ? 2 : 1);
    for (const [, attributes] of bars) {
      const height = Number(attributes.match(/height="([^"]+)"/)[1]);
      const top = Number(attributes.match(/\by="([^"]+)"/)[1]);
      assert.ok(height >= 0 && height <= 255);
      assert.ok(top >= 35 && Math.abs(top + height - 290) < 0.001);
    }
    assert.doesNotMatch(html, /<circle|<polyline|timeline-line|Open points/);
    assert.doesNotMatch(html, /Percentage of dated crashes|January–December totals across|Highest total:|class="timeline-caption">Dashed bar outlines/);
    assert.match(html, /aria-label="What do dashed bars mean\?" aria-describedby="timeline-reporting-tooltip"/);
    assert.match(html, /id="timeline-reporting-tooltip" class="info-tooltip-popover" role="tooltip"/);
    assert.match(html, /Dashed bar outlines mark incomplete reporting periods/);
    if (mode === 'year') {
      assert.match(html, /1 crashes with invalid dates are excluded/);
      assert.match(bars[0][1], /height="0"/);
      assert.equal(bars[1][2], '2023: 3,971 crashes (includes partial reporting)');
      assert.match(bars[1][1], /stroke-dasharray="4 3"/);
    }
    if (mode === 'month') {
      assert.match(html, /aria-label="June crash counts by year"/);
      assert.match(html, /2023/);
    }
  }
});

test('Months shows January–December totals, highlights the busiest month and lists every year', async () => {
  const source = (await readFile(new URL('../src/components/CrashTimeline.jsx', import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '').replace('export default ', '');
  const props = { mode: 'month', monthData: { results: [
    { period: '2025-01', crashes: 10, partial_period: false },
    { period: '2026-01', crashes: 20, partial_period: false },
    { period: '2025-10', crashes: 5, partial_period: false },
    { period: '2026-10', crashes: 7, partial_period: true },
    { period: '2025-11', crashes: 0, partial_period: false },
  ] } };
  const render = async selected => {
    const CrashTimeline = await compile(source, 'CrashTimeline', {
      ...hooks,
      useState: initial => useState(selected ?? initial),
    });
    return renderToStaticMarkup(React.createElement(CrashTimeline, props));
  };
  const january = await render();
  assert.doesNotMatch(january, /Highest total:/);
  assert.match(january, /aria-label="January crash counts by year"/);
  assert.match(january, /<span>2025<\/span><strong><span>10<\/span><span class="month-share-bracket">\(66.67%\)/);
  assert.match(january, /<span>2026<\/span><strong><span>20<\/span><span class="month-share-bracket">\(74.07%\)/);
  assert.doesNotMatch(january, /years have data|Totals use the supplied months|January by year|Each percentage/);
  assert.equal((january.match(/class="timeline-axis">(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)<\/text>/g) || []).length, 12);
  const october = await render(9);
  assert.match(october, /aria-label="October crash counts by year"/);
  assert.match(october, /Partial month/);
  assert.match(october, /stroke-dasharray="4 3"/);
  const november = await render(10);
  assert.match(november, /aria-label="November crash counts by year"/);
  assert.match(november, /<span>2025<\/span><strong><span>0<\/span><span class="month-share-bracket">\(0.00%\)/);
  assert.match(november, /Not supplied/);
  const december = await render(11);
  assert.equal((december.match(/<small>Not supplied<\/small>/g) || []).length, 2);
  assert.match(december, /aria-valuetext="December, not supplied"/);
  assert.doesNotMatch(december, /NaN|(?:cy|y|height)="-\d/);
});

test('county pie presents full counts and handles empty and single-county selections', async () => {
  const source = (await readFile(new URL('../src/components/CountyPie.jsx', import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '').replace('export default ', '');
  const CountyPie = await compile(source, 'CountyPie', hooks);
  const html = renderToStaticMarkup(React.createElement(CountyPie, { data: {
    total_crashes: 10, results: [{ county: 'HALE', crashes: 10 }],
  } }));
  assert.match(html, /id="top-counties"/);
  assert.match(html, /<circle/);
  assert.match(html, /r="170"/);
  assert.match(html, /aria-label="County legend"/);
  assert.match(html, /Hale crash details/);
  assert.doesNotMatch(html, /Hover or select|matching crashes, including|Other counties combines/);
  assert.doesNotMatch(html, /<table|marker-end|<marker|<tspan|role="tooltip"/);
  assert.doesNotMatch(html, /NaN|undefined/);
  const empty = renderToStaticMarkup(React.createElement(CountyPie, { data: { total_crashes: 0, results: [] } }));
  assert.match(empty, /No crashes in this selection/);
  assert.doesNotMatch(empty, /<svg/);
  const full = renderToStaticMarkup(React.createElement(CountyPie, { data: { total_crashes: 100,
    results: ['LUBBOCK', 'HALE', 'GAINES', 'HOCKLEY', 'DAWSON', 'LAMB'].map((county, index) => ({ county, crashes: index ? 4 : 80 })) } }));
  assert.equal((full.match(/class="county-pie-slice"/g) || []).length, 6);
  assert.match(full, /Other Counties/);
  assert.doesNotMatch(full, /NaN|undefined/);
});

test('pie and legend show county counts and percentages on hover, focus and selection', async () => {
  const source = (await readFile(new URL('../src/components/CountyPie.jsx', import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '').replace('export default ', '');
  let active = null;
  const CountyPie = await compile(source, 'CountyPie', {
    ...hooks, useState: () => [active, value => { active = value; }],
  });
  const data = { total_crashes: 100, results: [{ county: 'LUBBOCK', crashes: 80 }, { county: 'HALE', crashes: 20 }] };
  const tree = () => CountyPie({ data });
  const nodes = value => Array.isArray(value) ? value.flatMap(nodes)
    : React.isValidElement(value) ? [value, ...nodes(value.props.children)] : [];
  const slices = () => nodes(tree()).filter(node => node.props.className === 'county-pie-slice');
  const tooltip = () => nodes(tree()).find(node => node.props.role === 'tooltip');
  assert.equal(tooltip(), undefined);
  slices()[0].props.onMouseEnter();
  let html = renderToStaticMarkup(tree());
  assert.match(html, /role="tooltip"/);
  assert.match(html, /80 crashes · 80.00%/);
  assert.match(html, /aria-describedby="county-pie-tooltip"/);
  slices()[0].props.onMouseLeave({ currentTarget: { matches: () => false } });
  assert.equal(tooltip(), undefined);
  slices()[1].props.onFocus();
  slices()[1].props.onMouseLeave({ currentTarget: { matches: () => true } });
  assert.match(renderToStaticMarkup(tooltip()), /Hale.*20 crashes · 20.00%/);
  let stopped = false;
  slices()[1].props.onKeyDown({ key: 'Escape', stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(tooltip(), undefined);
  let prevented = false;
  slices()[1].props.onKeyDown({ key: ' ', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.match(renderToStaticMarkup(tooltip()), /20 crashes · 20.00%/);
  slices()[1].props.onBlur();
  assert.equal(tooltip(), undefined);
  const legend = nodes(tree()).filter(node => node.type === 'button');
  legend[0].props.onClick();
  assert.match(renderToStaticMarkup(tooltip()), /Lubbock.*80 crashes · 80.00%/);
  legend[1].props.onMouseEnter();
  assert.match(renderToStaticMarkup(tooltip()), /Hale.*20 crashes · 20.00%/);
  legend[1].props.onBlur();
  assert.equal(tooltip(), undefined);
});

test('map coverage uses its own response and popup fields remain text', async () => {
  const source = await readFile(new URL('../src/components/CountyMap.jsx', import.meta.url), 'utf8');
  const effects = [];
  const fields = new Map();
  const popup = { innerHTML: '', querySelector(selector) {
    if (selector.startsWith('[data-field=')) {
      assert.ok(this.innerHTML.includes(selector.slice(1, -1)));
    }
    if (!fields.has(selector)) fields.set(selector, { style: {} });
    return fields.get(selector);
  } };
  const payload = '<img src=x onerror=alert(1)>';
  let boundPopup, tileOptions, ref = 0;
  const refs = [{}, null, null, null];
  const map = { fitBounds() {}, invalidateSize() {}, remove() {} };
  const layerGroup = { clearLayers() {}, addLayer() {} };
  const CountyMap = await compile(source.replace(/^import .*;\n/gm, '').replaceAll('export ', '').replace('default function', 'function'), 'CountyMap', {
    ...mapConstants, severityColors: mapConstants.mapSeverityColors,
    React, useState, useMemo, useCallback, endpoint: helpers.endpoint, isPartialYear: helpers.isPartialYear, titleCase: helpers.titleCase,
    useEffect: effect => effects.push(effect), useRef: () => ({ current: refs[ref++] }),
    useApiData: () => ({ status: 'ready', data: [{ total_crashes: 2, results: [
      { lat: 33.5, lon: -101.8, severity: 'K', date: '2020-01-01', county: payload, factor: payload, id: payload },
    ] }] }),
    document: { createElement: () => popup },
    ResizeObserver: class { observe() {} disconnect() {} },
    L: {
      map: () => map, canvas: () => ({}), layerGroup: () => ({ addTo: () => layerGroup }),
      tileLayer: (url, options) => { tileOptions = options; return { addTo() {} }; },
      circleMarker: () => ({ bindPopup: create => { boundPopup = create(); } }),
    },
  });
  const html = renderToStaticMarkup(React.createElement(CountyMap, { metadata: testMetadata }));
  assert.match(html, /1 CRASHES \(50.00%\)/);
  assert.match(html, /All 2 Counties/);
  assert.match(html, /2028 \(partial\)/);
  assert.match(html, /2029 \(partial\)/);
  assert.match(html, /API FATAL INJURY/);
  assert.match(html, /Dataset-wide, 3 of 20 crashes/);
  assert.doesNotMatch(html, /2020|2026|96.5%|All 17/);
  effects[0]();
  assert.equal(tileOptions.referrerPolicy, 'strict-origin-when-cross-origin');
  effects[1]();
  assert.equal(boundPopup, popup);
  assert.ok(!popup.innerHTML.includes(payload));
  assert.equal(fields.get('[data-field="id"]').textContent, `Crash ID: #${payload}`);
  assert.equal(fields.get('[data-field="county"]').textContent, `${payload} County`);
  assert.equal(fields.get('[data-field="factor"]').textContent, payload);
  assert.equal(fields.get('[data-field="label"]').textContent, 'API fatal injury');
});
