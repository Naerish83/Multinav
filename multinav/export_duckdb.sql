-- export_duckdb.sql
-- Run with: duckdb -c ".read export_duckdb.sql"
-- Set a variable DB and OUT if your DuckDB supports it, or edit paths inline.

ATTACH 'ai_runs.duckdb' AS mem (READ_ONLY FALSE);
-- Import from SQLite directly into DuckDB
INSTALL sqlite;
LOAD sqlite;

-- Change path to your SQLite DB
CREATE OR REPLACE TABLE mem.sessions AS SELECT * FROM sqlite_scan('./ai_runs.db', 'sessions');
CREATE OR REPLACE TABLE mem.runs     AS SELECT * FROM sqlite_scan('./ai_runs.db', 'runs');

-- Export Parquet snapshots
COPY (SELECT * FROM mem.sessions) TO 'sessions.parquet' (FORMAT PARQUET);
COPY (SELECT * FROM mem.runs)     TO 'runs.parquet'     (FORMAT PARQUET);

-- Canned materialized views for speed
CREATE OR REPLACE TABLE mem.runs_wide AS
SELECT r.*, s.topic, s.intent
FROM mem.runs r LEFT JOIN mem.sessions s USING(session_id);

COPY (SELECT * FROM mem.runs_wide) TO 'runs_wide.parquet' (FORMAT PARQUET);

SELECT 'Export complete' AS status, COUNT(*) AS runs_rows FROM mem.runs;
