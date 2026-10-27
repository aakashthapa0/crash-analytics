import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { endpoint } from '../api/urls.js';
import { isPartialYear, titleCase } from '../utils/format.js';
import { countyCentroids, LUBBOCK_DISTRICT_BOUNDS, LUBBOCK_DISTRICT_CENTER, mapSeverityColors as severityColors } from '../constants/map.js';
import useApiData from '../hooks/useApiData.js';

const fmt = n => (typeof n === 'number' && !isNaN(n) ? n.toLocaleString('en-US') : '0');

const EMPTY_POINTS = [];

/**
 * CountyMap renders an interactive OpenStreetMap GIS crash visualization.
 * It plots GPS coordinates from TxDOT CRIS records on a clean basemap
 * with canvas circle markers, color-coded by crash severity.
 */
export default function CountyMap({
  metadata,
  selectedCounty = '',
  onCountySelect = () => {},
  selectedYear = 'all',
  onYearSelect = () => {},
  selectedSeverities = [],
  onSeveritySelect = () => {},
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const layerGroupRef = useRef(null);
  const canvasRendererRef = useRef(null);
  const { counties, years, severities: severityLabels } = metadata.available_filters;
  const allSeverities = Object.keys(severityLabels);

  // Normalize active filter state for map-level controls
  const activeCounty = selectedCounty && selectedCounty !== 'all' ? selectedCounty.toUpperCase() : '';
  const activeYear = selectedYear && selectedYear !== 'all' ? String(selectedYear) : '';
  const activeSeverities = selectedSeverities && selectedSeverities.length > 0 ? selectedSeverities : allSeverities;

  // Initialize Leaflet map instance once centered on Lubbock District
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    // Center on Lubbock District initially
    const map = L.map(mapContainerRef.current, {
      center: LUBBOCK_DISTRICT_CENTER,
      zoom: 8,
      minZoom: 6,
      maxZoom: 18,
      zoomControl: false,
      attributionControl: false,
    });

    // Ensure all 17 Lubbock District counties are visible immediately
    map.fitBounds(LUBBOCK_DISTRICT_BOUNDS, { padding: [16, 16], maxZoom: 8.5 });

    // Official OpenStreetMap tile layer - 100% free & open source, no API key required
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      // OSM requires a referrer; send only the origin, never selection parameters.
      referrerPolicy: 'strict-origin-when-cross-origin',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }).addTo(map);

    // High performance HTML5 Canvas renderer for 20,000+ points
    const canvasRenderer = L.canvas({ padding: 0.5 });
    canvasRendererRef.current = canvasRenderer;

    const layerGroup = L.layerGroup().addTo(map);
    layerGroupRef.current = layerGroup;

    mapInstanceRef.current = map;

    // Resize observer to ensure map canvas and tiles always fill the full height of the section
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    if (mapContainerRef.current) {
      resizeObserver.observe(mapContainerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  const [retry, setRetry] = useState(0);
  const { status, data, error } = useApiData([endpoint('points', {
    county: activeCounty, year: activeYear, severity: activeSeverities,
  })], retry);
  const points = data?.[0].results || EMPTY_POINTS;
  const loading = status === 'loading';

  // Render points on the canvas layer
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layerGroup = layerGroupRef.current;
    const renderer = canvasRendererRef.current;
    if (!map || !layerGroup || !renderer) return;

    layerGroup.clearLayers();

    // Decision: Dynamic dot sizing based on point density.
    // When filtered (< 5,000 points), slightly larger markers improve clickability.
    // When rendering all 23,000+ points across 17 counties, smaller markers prevent visual overcrowding.
    const isFiltered = points.length < 5000;
    points.forEach(pt => {
      const color = severityColors[pt.severity] || '#ea7a35';
      const radius = isFiltered
        ? (pt.severity === 'K' ? 4.5 : pt.severity === 'A' ? 3.8 : 3.0)
        : (pt.severity === 'K' ? 3.2 : pt.severity === 'A' ? 2.5 : 2.0);

      const marker = L.circleMarker([pt.lat, pt.lon], {
        renderer,
        radius,
        fillColor: color,
        color: '#ffffff',
        weight: isFiltered ? 0.5 : 0.25,
        opacity: isFiltered ? 0.9 : 0.8,
        fillOpacity: isFiltered ? 0.85 : 0.72,
      });

      marker.bindPopup(() => {
        const popup = document.createElement('div');
        popup.className = 'crash-map-popup';
        popup.innerHTML = `
          <div class="popup-header">
            <span class="popup-badge" data-field="severity"></span><b data-field="label"></b>
          </div>
          <div class="popup-body">
            <div><span class="popup-label">Date:</span> <strong data-field="date"></strong></div>
            <div><span class="popup-label">County:</span> <strong data-field="county"></strong></div>
            <div><span class="popup-label">Factor:</span> <em data-field="factor"></em></div>
            <div><span class="popup-label">Lat / Long:</span> <strong data-field="coordinates"></strong></div>
            <div class="popup-id" data-field="id"></div>
          </div>
        `;
        // Dataset text must never be interpreted as HTML.
        for (const [field, text] of Object.entries({
          severity: pt.severity, label: severityLabels[pt.severity] || pt.severity,
          date: pt.date || 'Unknown', county: `${pt.county} County`, factor: pt.factor,
          coordinates: `${pt.lat.toFixed(5)}, ${pt.lon.toFixed(5)}`, id: `Crash ID: #${pt.id}`,
        })) {
          popup.querySelector(`[data-field="${field}"]`).textContent = text;
        }
        popup.querySelector('.popup-badge').style.backgroundColor = color;
        return popup;
      }, {
        closeButton: true,
        className: 'custom-crash-popup',
        offset: [0, -4],
      });

      layerGroup.addLayer(marker);
    });
  }, [points, severityLabels]);

  // Decision: Smoothly animate the map view to the specific county centroid when selected;
  // otherwise, reset to the entire 17-county Lubbock district bounding box.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (activeCounty && countyCentroids[activeCounty]) {
      map.flyTo(countyCentroids[activeCounty], 10, { duration: 0.8 });
    } else {
      map.fitBounds(LUBBOCK_DISTRICT_BOUNDS, { padding: [16, 16], maxZoom: 8.5 });
    }
  }, [activeCounty]);

  const handleResetZoom = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    map.fitBounds(LUBBOCK_DISTRICT_BOUNDS, { padding: [16, 16], maxZoom: 8.5 });
  }, []);

  // Severity counts breakdown of currently plotted points
  const pointStats = useMemo(() => {
    const counts = Object.fromEntries(allSeverities.map(code => [code, 0]));
    points.forEach(pt => {
      if (counts[pt.severity] !== undefined) {
        counts[pt.severity]++;
      }
    });
    return counts;
  }, [points, severityLabels]);

  // Handlers for Year Checkboxes
  const isAllYears = !activeYear;
  const handleToggleYear = yr => {
    if (activeYear === yr) {
      onYearSelect('all');
    } else {
      onYearSelect(yr);
    }
  };

  // Handlers for Severity Checkboxes
  const isAllSeverities = activeSeverities.length === allSeverities.length;
  const handleToggleSeverity = sevCode => {
    if (activeSeverities.includes(sevCode)) {
      const next = activeSeverities.filter(c => c !== sevCode);
      onSeveritySelect(next.length === 0 ? allSeverities : next);
    } else {
      onSeveritySelect([...activeSeverities, sevCode].sort());
    }
  };

  const handleSelectAllSeverities = () => {
    if (isAllSeverities) {
      onSeveritySelect(allSeverities.slice(0, 2));
    } else {
      onSeveritySelect(allSeverities);
    }
  };

  // Calculate percentage of crashes with valid GPS coordinates.
  const totalInSelection = data?.[0].total_crashes ?? 0;
  const pct = totalInSelection > 0
    ? ((points.length / totalInSelection) * 100).toFixed(2)
    : '0.00';

  return (
    <section className="map-panel county-map-card" id="district-map" aria-label="Interactive Texas Crash Coordinates Map">
      <div className="map-top">
        <div>
          <span className="eyebrow">District crash map</span>
          <h2>Incident coordinates & severity</h2>
        </div>
        <div className="map-top-tools">
          <div className="locator-badge">
            <span className="locator-badge-text">
              {loading ? 'Loading…' : status === 'error' ? 'Unavailable' : `${fmt(points.length)} CRASHES (${pct}%)`}
            </span>
            <div className="info-tooltip-anchor">
              <button
                type="button"
                className="info-icon-btn locator-info-btn"
                aria-label="Crash coordinate mapping explanation"
                aria-describedby="map-coverage-tooltip"
              >
                <span className="notice-mark" aria-hidden="true">i</span>
              </button>
              <div id="map-coverage-tooltip" className="info-tooltip-popover map-tooltip-popover" role="tooltip">
                <span className="info-tooltip-arrow" aria-hidden="true" />
                <b className="info-tooltip-title">Why isn't this 100%?</b>
                <p className="info-tooltip-desc">
                  Crashes require valid coordinates to appear on the map. Dataset-wide, {fmt(metadata.quality.unusable_coordinates)} of {fmt(metadata.crashes)} crashes have unusable coordinates and remain included in crash totals. The badge reflects the current selection.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="county-map-layout">
        {/* Left: OpenStreetMap Interactive Basemap Container */}
        <div className="county-map-canvas">
          <div className="map-viewport">
            <div
              ref={mapContainerRef}
              id="crash-osm-map"
              className="osm-map-viewport"
              style={{ width: '100%', height: '100%', background: '#e5e3df' }}
            />

            {/* Floating on-map zoom controls */}
            <div className="map-zoom-tools" role="toolbar" aria-label="Map zoom controls">
              <button
                type="button"
                onClick={() => mapInstanceRef.current?.zoomIn()}
                aria-label="Zoom in"
                title="Zoom in (+)"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => mapInstanceRef.current?.zoomOut()}
                aria-label="Zoom out"
                title="Zoom out (−)"
              >
                −
              </button>
              <button
                type="button"
                className="map-reset-view"
                onClick={handleResetZoom}
                aria-label="Reset map zoom to Lubbock District"
                title={`Home view (all ${counties.length} counties)`}
              >
                Home
              </button>
            </div>

            {status !== 'ready' && (
              <div className="map-loading-overlay" role={status === 'error' ? 'alert' : 'status'}>
                {loading ? <><span className="map-spinner" /><span>Loading crash coordinates…</span></> : (
                  <><span>{error}</span><button type="button" onClick={() => setRetry(n => n + 1)}>Retry map</button></>
                )}
              </div>
            )}
          </div>

          <div className="map-osm-footer">
            <span>© OpenStreetMap contributors</span>
            <span>Click any crash dot to view incident details</span>
          </div>
        </div>

        {/* Right: Map Filter Panel */}
        <div className="map-controls-panel">
          {/* TxDOT District / County Selector */}
          <div className="map-panel-group">
            <label htmlFor="map-county-select" className="map-panel-title">
              County
            </label>
            <select
              id="map-county-select"
              className="map-select"
              value={activeCounty ? activeCounty : 'all'}
              onChange={e => onCountySelect(e.target.value === 'all' ? 'all' : e.target.value)}
            >
              <option value="all">All {counties.length} Counties (District)</option>
              {counties.map(name => (
                <option key={name} value={name}>
                  {titleCase(name)} County
                </option>
              ))}
            </select>
          </div>

          {/* Crash Year Filter Checkboxes */}
          <div className="map-panel-group">
            <span className="map-panel-title">Crash Year</span>
            <div className="map-checkbox-list">
              <label className="map-checkbox-item">
                <input
                  type="checkbox"
                  checked={isAllYears}
                  onChange={() => onYearSelect('all')}
                />
                <span>(All)</span>
              </label>
              {years.map(value => {
                const yr = String(value);
                return (
                <label key={yr} className="map-checkbox-item">
                  <input
                    type="checkbox"
                    checked={activeYear === yr}
                    onChange={() => handleToggleYear(yr)}
                  />
                  <span>
                    {yr}
                    {isPartialYear(yr, metadata.coverage) ? ' (partial)' : ''}
                  </span>
                </label>
                );
              })}
            </div>
          </div>

          {/* Crash Severity Filter Checkboxes with counts and divider */}
          <div className="map-panel-group map-severity-group">
            <span className="map-panel-title">Crash Severity</span>
            <div className="map-checkbox-list">
              <label className="map-checkbox-item map-severity-item">
                <input
                  type="checkbox"
                  checked={isAllSeverities}
                  onChange={handleSelectAllSeverities}
                />
                <span className="map-severity-name">(All)</span>
                <strong className="map-severity-count">{fmt(points.length)}</strong>
              </label>
              {allSeverities.map(code => {
                const isChecked = activeSeverities.includes(code);
                return (
                  <label
                    key={code}
                    className={`map-checkbox-item map-severity-item${!isChecked ? ' is-unchecked' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleToggleSeverity(code)}
                    />
                    <span
                      className="map-severity-swatch"
                      style={{ background: severityColors[code] }}
                    />
                    <span className="map-severity-name">
                      {severityLabels[code].toUpperCase()}
                    </span>
                    <strong className="map-severity-count">{fmt(pointStats[code])}</strong>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
