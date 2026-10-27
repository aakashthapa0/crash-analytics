# Data Pipeline & Cleaning

This directory contains the dataset snapshot and the data cleaning/processing pipeline.

## Files

- `clean.py`: Main data cleaning and validation pipeline.
- `schema.sql`: Declarative SQLite DDL defining tables, constraints, and analytical indexes.
- `crashes.sqlite`: Validated, crash-grain SQLite runtime database.
- Public source: [district_crashes.csv](https://d9tany0cdnjow.cloudfront.net/data/district_crashes.csv), an Excel-readable CSV stored in a separate S3 bucket and served through CloudFront.
- `raw/` (optional, gitignored): Directory for raw source exports (e.g. `district_crashes.csv`).

## Data Cleaning & Transformation

Raw TxDOT CRIS exports are person-grain (multiple rows per crash) and may contain inconsistent casing, missing sentinels, or duplicate lines.

`clean.py` performs the following transformations:
1. **Header Detection & Validation**: Locates the header line dynamically, handles an optional UTF-8 BOM, and verifies all required columns (`Crash ID`, `Crash Date`, `Crash Year`, `Crash Severity`, `County`, `Contributing Factors`, `Latitude`, `Longitude`).
2. **Crash-Grain Deduplication**: Aggregates person-level rows into distinct crashes by `Crash ID`. Conflicting repeated attributes raise `DataQualityError` to stop the build.
3. **Data Normalization**: Cleans whitespace and casing and applies missing-value rules by field. Missing counties become `UNKNOWN`; county names are not checked against a district allowlist. Factor sentinels are blank, `NO DATA`, `N/A`, `NULL`, `UNKNOWN`, and `-1`; `0` is not a factor sentinel.
4. **Factor Extraction**: Splits multi-value contributing factors on semicolons, deduplicates, and separates `NONE` / missing values from ranked factors.
5. **Coordinate Validation**: Requires finite coordinates inside a broad Texas rectangle (lat 25–37, lon -107 to -93). This rejects coordinate sentinels such as `0` and `-1`, but does not establish district membership. Uncoordinated crashes remain in statistical totals.
6. **Atomic SQLite Generation**: Inserts and commits indexed tables (`crashes`, `factors`) in a randomly named temporary `.sqlite` file in the destination directory. SQLite key and required-value constraints are enforced before atomic replacement. There is no separate integrity-check pass or reconciliation against source-preamble counts.

## Usage

```bash
# Download the public CSV, clean it, and rebuild crashes.sqlite (no AWS credentials)
python -m data.clean

# Download and clean into a different destination
python -m data.clean --output /path/to/output.sqlite

# Clean an existing local export without downloading
python -m data.clean /path/to/district_crashes.csv

# Or write to a specific destination
python -m data.clean /path/to/district_crashes.csv --output /path/to/output.sqlite
```

The download is approximately 74 MiB and contains the original 67,906 person-level
rows. It is streamed to a temporary file, validated by the existing cleaner, and
removed after processing. An internet connection is needed only for downloading;
the cleaning pipeline uses the Python standard library and runs locally. Download
failures and responses whose size differs from a supplied `Content-Length` do
not replace an existing SQLite database. Structurally valid truncation without
a detectable length mismatch still needs independent completeness verification.

See [EDA.md](../EDA.md) for exploratory data analysis findings and full dataset documentation.
