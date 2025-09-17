#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os, json, sqlite3, datetime, pathlib
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from muse_log import _connect, upsert_run, write_ndjson, init_db

DB_PATH = os.environ.get("MUSE_DB", "./ai_runs.db")
LOGDIR  = os.environ.get("MUSE_LOGDIR", "./logs")

# one-time ensure DB exists
if not pathlib.Path(DB_PATH).exists():
    init_db(DB_PATH)

app = FastAPI(title="Muse Ingest", version="1.0")

@app.post("/log")
async def log_event(req: Request):
    try:
        event = await req.json()
    except Exception:
        return JSONResponse({"ok": False, "err": "invalid json"}, status_code=400)

    # minimal safety defaults
    event.setdefault("ts", datetime.datetime.utcnow().isoformat() + "Z")
    if "model" not in event: event["model"] = {}
    if "response" not in event: event["response"] = {}
    if "user_input" not in event: event["user_input"] = {}
    if "task_context" not in event: event["task_context"] = {}
    if "client" not in event: event["client"] = {}

    con = _connect(DB_PATH)
    try:
        upsert_run(con, event)
    finally:
        con.close()

    write_ndjson(LOGDIR, event)
    return JSONResponse({"ok": True})
