#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
muse_labeler.py
Fast labeling UI over your SQLite 'runs' table.

Hotkeys:
  K = keep (good)
  J = junk (bad)
  1..5 = set overall score (0.2 .. 1.0)
  H = toggle hallucination flag
  A = toggle actionable

Usage (Bash):
  export MUSE_DB=./ai_runs.db
  uvicorn muse_labeler:app --host 127.0.0.1 --port 8088 --reload

Usage (PowerShell):
  setx MUSE_DB ".\\ai_runs.db"
  $env:MUSE_DB=".\ai_runs.db"
  uvicorn muse_labeler:app --host 127.0.0.1 --port 8088 --reload
"""

import os, sqlite3, html
from fastapi import FastAPI, Request, Form
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

DB_PATH = os.environ.get("MUSE_DB", "./ai_runs.db")

app = FastAPI(title="Muse Labeler", version="1.0")

def connect():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con

HTML_PAGE = """
<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Muse Labeler</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 20px; }
    .wrap { max-width: 1100px; margin: auto; }
    .meta { color: #666; font-size: 14px; margin-bottom: 8px; }
    textarea { width: 100%; height: 220px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .controls { margin-top: 10px; }
    button { padding: 8px 12px; margin-right: 6px; }
    .pill { display:inline-block; padding:2px 8px; border-radius:12px; background:#eee; margin-right:6px; }
    .k { background:#d6f5d6; }
    .j { background:#ffd6d6; }
  </style>
</head>
<body>
<div class="wrap">
  <h2>Muse Labeler</h2>
  <div id="info" class="meta">Loading…</div>
  <div class="row">
    <div>
      <h3>Input</h3>
      <textarea id="input_text" readonly></textarea>
    </div>
    <div>
      <h3>Response <span id="model" class="pill"></span><span id="lat" class="pill"></span></h3>
      <textarea id="resp_text" readonly></textarea>
    </div>
  </div>
  <div class="controls">
    <span class="pill k">K = keep</span>
    <span class="pill j">J = junk</span>
    <span class="pill">1..5 = score</span>
    <span class="pill">H = hallucination</span>
    <span class="pill">A = actionable</span>
    <button onclick="postLabel('keep')">Keep (K)</button>
    <button onclick="postLabel('junk')">Junk (J)</button>
  </div>
</div>
<script>
let current = null;

async function fetchNext() {
  const r = await fetch('/api/next');
  const d = await r.json();
  current = d;
  if (!d || !d.event_id) {
    document.getElementById('info').textContent = 'No unlabeled runs 🎉';
    document.getElementById('input_text').value = '';
    document.getElementById('resp_text').value = '';
    document.getElementById('model').textContent = '';
    document.getElementById('lat').textContent = '';
    return;
  }
  document.getElementById('info').textContent =
    `${d.event_id} — ${d.provider}/${d.model_name} — ${d.ts}`;
  document.getElementById('input_text').value = d.input_text || '';
  document.getElementById('resp_text').value = d.resp_text || '';
  document.getElementById('model').textContent = d.provider + '/' + d.model_name;
  document.getElementById('lat').textContent = (d.latency_ms||'?') + ' ms';
}

async function postLabel(action, score=null) {
  if (!current || !current.event_id) return;
  const body = { action, score };
  const r = await fetch('/api/label', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ event_id: current.event_id, action, score })
  });
  await fetchNext();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'k' || e.key === 'K') postLabel('keep');
  if (e.key === 'j' || e.key === 'J') postLabel('junk');
  if (e.key === 'h' || e.key === 'H') postLabel('toggle_hallucination');
  if (e.key === 'a' || e.key === 'A') postLabel('toggle_actionable');
  if (['1','2','3','4','5'].includes(e.key)) {
    const score = ({'1':0.2,'2':0.4,'3':0.6,'4':0.8,'5':1.0})[e.key];
    postLabel('score', score);
  }
});

fetchNext();
</script>
</body>
</html>
"""

@app.get("/", response_class=HTMLResponse)
def home():
    return HTML_PAGE

@app.get("/api/next")
def api_next():
    con = connect()
    try:
        row = con.execute("""
        SELECT event_id, ts, provider, model_name, latency_ms,
               input_text, resp_text,
               label_quality, label_kept, score_overall
        FROM runs
        WHERE label_quality IS NULL AND (label_kept IS NULL OR label_kept=0)
        ORDER BY ts ASC
        LIMIT 1
        """).fetchone()
        if not row:
            return JSONResponse({})
        return JSONResponse(dict(row))
    finally:
        con.close()

@app.post("/api/label")
async def api_label(req: Request):
    data = await req.json()
    event_id = data.get("event_id")
    action = data.get("action")
    score = data.get("score")

    if not event_id or not action:
        return JSONResponse({"ok": False, "err": "missing event_id/action"}, status_code=400)

    con = connect()
    try:
        if action == "keep":
            con.execute("UPDATE runs SET label_kept=1, label_quality='good' WHERE event_id=?", (event_id,))
        elif action == "junk":
            con.execute("UPDATE runs SET label_kept=0, label_quality='bad' WHERE event_id=?", (event_id,))
        elif action == "toggle_hallucination":
            con.execute("""
                UPDATE runs
                SET label_hallucination = CASE WHEN COALESCE(label_hallucination,0)=1 THEN 0 ELSE 1 END
                WHERE event_id=?""", (event_id,))
        elif action == "toggle_actionable":
            con.execute("""
                UPDATE runs
                SET label_actionable = CASE WHEN COALESCE(label_actionable,0)=1 THEN 0 ELSE 1 END
                WHERE event_id=?""", (event_id,))
        elif action == "score":
            try:
                s = float(score)
            except:
                s = None
            if s is not None:
                con.execute("UPDATE runs SET score_overall=? WHERE event_id=?", (s, event_id))
        else:
            return JSONResponse({"ok": False, "err": "unknown action"}, status_code=400)

        con.commit()
        return JSONResponse({"ok": True})
    finally:
        con.close()
