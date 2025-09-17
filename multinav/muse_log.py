#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
muse_log.py
Unified logging for multi-model runs:
- Appends newline-delimited JSON (NDJSON)
- Upserts into SQLite (sessions + runs tables)
- Provides small CLI for init and import
- Includes canned analytics queries

Usage (Bash):
  python muse_log.py --db ./ai_runs.db --init
  python muse_log.py --db ./ai_runs.db --logdir ./logs --ingest event.json
  cat event.jsonl | python muse_log.py --db ./ai_runs.db --logdir ./logs --ingest -

Usage (PowerShell):
  py .\muse_log.py --db .\ai_runs.db --init
  py .\muse_log.py --db .\ai_runs.db --logdir .\logs --ingest .\event.json
  Get-Content .\batch.ndjson | py .\muse_log.py --db .\ai_runs.db --logdir .\logs --ingest -

Emit one event per model response. Schema keys expected are documented below.
"""

import argparse, json, os, sys, sqlite3, pathlib, datetime, typing, uuid

DB_PRAGMAS = [
    "PRAGMA journal_mode=WAL;",
    "PRAGMA synchronous=NORMAL;",
    "PRAGMA foreign_keys=ON;",
]

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  started_at TEXT,
  topic TEXT,
  intent TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS runs (
  event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ts TEXT NOT NULL,

  input_text TEXT,
  tags TEXT,

  provider TEXT,
  model_name TEXT,
  mode TEXT,
  context_tokens INTEGER,
  temperature REAL,

  resp_text TEXT,
  resp_tokens INTEGER,
  finish_reason TEXT,
  latency_ms INTEGER,

  contains_code INTEGER,
  has_citations INTEGER,
  ui_broke INTEGER,

  label_quality TEXT,
  label_actionable INTEGER,
  label_hallucination INTEGER,
  label_kept INTEGER,

  score_overall REAL,
  score_accuracy REAL,
  score_style REAL,
  score_speed REAL,

  input_tokens INTEGER,
  output_tokens INTEGER,
  usd_estimate REAL,

  source_urls TEXT,
  attachments_saved TEXT,

  UNIQUE(event_id),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

CREATE INDEX IF NOT EXISTS runs_idx_session ON runs(session_id);
CREATE INDEX IF NOT EXISTS runs_idx_model   ON runs(provider, model_name);
CREATE INDEX IF NOT EXISTS runs_idx_time    ON runs(ts);
"""

CANNED_QUERIES = {
    "winners_by_topic": """
SELECT s.topic,
       r.provider||'/'||r.model_name AS model,
       ROUND(AVG(r.score_overall),3) AS avg_score,
       COUNT(*) AS n
FROM runs r
JOIN sessions s USING(session_id)
GROUP BY s.topic, model
HAVING n >= 5
ORDER BY avg_score DESC, n DESC;
""",
    "score_per_1k_tokens": """
SELECT r.provider||'/'||r.model_name AS model,
       ROUND(AVG(r.score_overall / NULLIF((r.input_tokens + r.output_tokens)/1000.0,0)),3) AS score_per_k,
       COUNT(*) AS n
FROM runs r
GROUP BY model
HAVING n >= 5
ORDER BY score_per_k DESC;
""",
    "latency_vs_quality": """
SELECT r.provider||'/'||r.model_name AS model,
       ROUND(AVG(r.latency_ms),0) AS avg_ms,
       ROUND(AVG(r.score_overall),3) AS avg_score,
       COUNT(*) AS n
FROM runs r
GROUP BY model
HAVING n >= 5
ORDER BY avg_score DESC;
""",
    "hallucination_rate": """
SELECT r.provider,
       SUM(COALESCE(r.label_hallucination,0)) AS hallucinations,
       COUNT(*) AS n,
       ROUND(100.0*SUM(COALESCE(r.label_hallucination,0))/COUNT(*),2) AS pct
FROM runs r
GROUP BY r.provider
ORDER BY pct DESC;
""",
}

def _connect(db_path: str) -> sqlite3.Connection:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    for p in DB_PRAGMAS:
        con.execute(p)
    return con

def init_db(db_path: str) -> None:
    con = _connect(db_path)
    try:
        con.executescript(SCHEMA_SQL)
        con.commit()
    finally:
        con.close()

def _ulid_like() -> str:
    # Stable, URL-safe-ish unique id (UUID4 here — fine for logging)
    return uuid.uuid4().hex

def _ensure_session(con: sqlite3.Connection, event: dict) -> None:
    session_id = event.get("session_id")
    if not session_id:
        # If missing, synthesize from timestamp + short id
        sid = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%S") + "-" + _ulid_like()[:8]
        event["session_id"] = sid
        session_id = sid
    # Minimal session fields if provided
    tc = event.get("task_context", {})
    started_at = event.get("ts") or datetime.datetime.utcnow().isoformat() + "Z"
    topic = tc.get("topic")
    intent = tc.get("intent")
    notes = None
    con.execute(
        "INSERT OR IGNORE INTO sessions(session_id, started_at, topic, intent, notes) VALUES (?,?,?,?,?)",
        (session_id, started_at, topic, intent, notes)
    )

def _bool(x) -> typing.Optional[int]:
    if x is None: return None
    return 1 if bool(x) else 0

def _json_join(val) -> typing.Optional[str]:
    if val is None:
        return None
    if isinstance(val, (list, tuple)):
        return json.dumps(val, ensure_ascii=False)
    if isinstance(val, str):
        return val
    return json.dumps(val, ensure_ascii=False)

def upsert_run(con: sqlite3.Connection, event: dict) -> None:
    # Fill defaults
    event_id = event.get("event_id") or _ulid_like()
    event["event_id"] = event_id
    ts = event.get("ts") or datetime.datetime.utcnow().isoformat() + "Z"
    user_input = event.get("user_input", {}) or {}
    task_context = event.get("task_context", {}) or {}
    client = event.get("client", {}) or {}
    model = event.get("model", {}) or {}
    response = event.get("response", {}) or {}
    observations = event.get("observations", {}) or {}
    labels = event.get("labels", {}) or {}
    metrics = event.get("metrics", {}) or {}
    costing = event.get("costing", {}) or {}
    links = event.get("links", {}) or {}

    # Ensure session row exists
    _ensure_session(con, event)

    con.execute("""
    INSERT OR REPLACE INTO runs(
      event_id, session_id, ts,
      input_text, tags,
      provider, model_name, mode, context_tokens, temperature,
      resp_text, resp_tokens, finish_reason, latency_ms,
      contains_code, has_citations, ui_broke,
      label_quality, label_actionable, label_hallucination, label_kept,
      score_overall, score_accuracy, score_style, score_speed,
      input_tokens, output_tokens, usd_estimate,
      source_urls, attachments_saved
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        event["event_id"],
        event["session_id"],
        ts,

        user_input.get("text"),
        _json_join(user_input.get("tags")),

        model.get("provider"),
        model.get("name"),
        model.get("mode"),
        model.get("context_tokens"),
        model.get("temperature"),

        response.get("text"),
        response.get("raw_tokens"),
        response.get("finish_reason"),
        response.get("latency_ms"),

        _bool(observations.get("contains_code")),
        _bool(observations.get("has_citations")),
        _bool(observations.get("ui_broke")),

        labels.get("quality"),
        _bool(labels.get("actionable")),
        _bool(labels.get("hallucination_flag")),
        _bool(labels.get("kept")),

        metrics.get("score_overall"),
        metrics.get("score_accuracy"),
        metrics.get("score_style"),
        metrics.get("score_speed"),

        costing.get("input_tokens"),
        costing.get("output_tokens"),
        costing.get("usd_estimate"),

        _json_join(links.get("source_urls")),
        _json_join(links.get("attachments_saved")),
    ))
    con.commit()

def write_ndjson(logdir: str, event: dict) -> None:
    pathlib.Path(logdir).mkdir(parents=True, exist_ok=True)
    day = datetime.datetime.utcnow().strftime("%Y-%m-%d")
    path = pathlib.Path(logdir) / f"{day}.ndjson"
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")

def ingest_stream(db: str, logdir: str, stream) -> int:
    con = _connect(db)
    count = 0
    try:
        for line in stream:
            line = line.strip()
            if not line:
                continue
            event = json.loads(line)
            upsert_run(con, event)
            if logdir:
                write_ndjson(logdir, event)
            count += 1
    finally:
        con.close()
    return count

def ingest_file(db: str, logdir: str, path: str) -> int:
    if path == "-":
        return ingest_stream(db, logdir, sys.stdin)
    data = pathlib.Path(path).read_text(encoding="utf-8")
    try:
        # single JSON object
        event = json.loads(data)
        con = _connect(db)
        try:
            upsert_run(con, event)
        finally:
            con.close()
        if logdir:
            write_ndjson(logdir, event)
        return 1
    except json.JSONDecodeError:
        # maybe NDJSON
        return ingest_stream(db, logdir, data.splitlines())

def run_query(db: str, name: str) -> None:
    q = CANNED_QUERIES.get(name)
    if not q:
        print("Available queries:", ", ".join(CANNED_QUERIES.keys()))
        sys.exit(2)
    con = _connect(db)
    try:
        cur = con.execute(q)
        cols = [d[0] for d in cur.description]
        rows = cur.fetchall()
        # print as pretty table
        colw = [max(len(c), *(len(str(r[i])) for r in rows)) for i, c in enumerate(cols)]
        def fmt_row(vals):
            return " | ".join(str(v).ljust(colw[i]) for i, v in enumerate(vals))
        print(fmt_row(cols))
        print("-+-".join("-"*w for w in colw))
        for r in rows:
            print(fmt_row([r[c] for c in cols]))
    finally:
        con.close()

def main():
    ap = argparse.ArgumentParser(description="Muse unified logger")
    ap.add_argument("--db", required=True, help="SQLite path")
    ap.add_argument("--init", action="store_true", help="Create tables and exit")
    ap.add_argument("--ingest", help="Path to JSON/NDJSON or '-' for stdin")
    ap.add_argument("--logdir", help="Directory for NDJSON daily logs (optional)")
    ap.add_argument("--query", help=f"Run a canned query: {', '.join(CANNED_QUERIES.keys())}")
    args = ap.parse_args()

    if args.init:
        init_db(args.db)
        print(f"Initialized: {args.db}")
        return

    if args.query:
        run_query(args.db, args.query)
        return

    if args.ingest:
        n = ingest_file(args.db, args.logdir, args.ingest)
        print(f"Ingested {n} event(s).")
        return

    ap.print_help()

if __name__ == "__main__":
    main()
