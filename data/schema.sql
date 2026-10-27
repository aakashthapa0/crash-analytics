-- SQLite schema for the crash-grain analytics database.
-- Builds normalized tables and analytical indexes over validated CRIS exports.

PRAGMA foreign_keys = ON;

-- Core crash entity: deduplicated by Crash ID from raw person/unit records
CREATE TABLE crashes (
    crash_id TEXT PRIMARY KEY,
    crash_date TEXT,                      -- ISO 8601 (YYYY-MM-DD); NULL for unparseable dates
    year INTEGER,                         -- Calendar year for filtering
    county TEXT NOT NULL,                 -- Standardized county name
    severity TEXT NOT NULL,               -- K, A, B, or C injury classification
    has_coordinates INTEGER NOT NULL,     -- 1 if finite lat/lon within broad Texas bounds, else 0
    latitude REAL,                        -- Latitude (WGS84); NULL if missing/unusable
    longitude REAL,                       -- Longitude (WGS84); NULL if missing/unusable
    factor_status TEXT NOT NULL           -- 'recorded', 'none', or 'missing'
);

-- Contributing factors normalized into a 1-to-many relationship
CREATE TABLE factors (
    crash_id TEXT REFERENCES crashes(crash_id),
    factor TEXT NOT NULL,                 -- Normalized, uppercase factor name
    PRIMARY KEY (crash_id, factor)
);

-- Performance indexes for analytical filter combinations
CREATE INDEX crashes_filters ON crashes(county, year, severity);
CREATE INDEX crashes_year ON crashes(year);
CREATE INDEX crashes_severity ON crashes(severity);
CREATE INDEX factors_name ON factors(factor);
