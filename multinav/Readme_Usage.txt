you’ve got the rig. here’s your **README-style usage drop** so you can light it up, test, and start banking data.

# Multinav Logging — Quickstart

## 0) What you now have

* **Electron app** (your multinav) patched to:

  * send **full prompt** (`control:prompt`) at dispatch
  * auto-scrape **assistant-only** replies in each pane (ChatGPT / Gemini / Grok / fallback), de-junked
  * emit unified events to an HTTP ingestor
* **Python side**:

  * `muse_ingest_server.py` — receives `/log` and writes SQLite + NDJSON
  * `muse_log.py` — SQLite schema + canned queries + NDJSON ingest
  * `muse_labeler.py` — tiny FastAPI UI to rate outputs (J/K/1..5)
  * `export_duckdb.sql` — Parquet snapshots (optional)

---

## 1) Install deps

### Bash (Linux/macOS)

```bash
python -m venv .venv && source .venv/bin/activate
python -m pip install --upgrade pip
pip install fastapi uvicorn[standard] duckdb
# node-fetch already added to Electron main; ensure it's installed in your app:
npm i node-fetch@3
```

### PowerShell (Windows)

```powershell
py -m venv .venv; .\.venv\Scripts\Activate.ps1
py -m pip install --upgrade pip
pip install fastapi uvicorn[standard] duckdb
npm i node-fetch@3
```

---

## 2) Start the local ingestor

```bash
# from your project root
export MUSE_DB=./ai_runs.db
export MUSE_LOGDIR=./logs
uvicorn muse_ingest_server:app --host 127.0.0.1 --port 8787 --reload
```

(Windows PowerShell)

```powershell
$env:MUSE_DB=".\ai_runs.db"
$env:MUSE_LOGDIR=".\logs"
uvicorn muse_ingest_server:app --host 127.0.0.1 --port 8787 --reload
```

This creates (on first hit):

* `ai_runs.db` (SQLite)
* `logs/YYYY-MM-DD.ndjson`

---

## 3) Launch Electron and run a test

1. Start your Electron app as usual.
2. In the left prompt box, paste a test prompt (e.g. “explain vector databases in 3 bullets”).
3. Send (your usual action).
4. Each pane renders; the preload scrapers detect the **latest assistant message** and POST a log event to `127.0.0.1:8787/log`.

---

## 4) Verify data landed

### Quick query (winners by topic)

```bash
python muse_log.py --db ./ai_runs.db --query winners_by_topic
```

### Peek raw NDJSON

```bash
tail -n 5 logs/$(date +%F).ndjson
```

You should see one event per pane with your prompt text + assistant reply.

---

## 5) Label a few (J/K + score)

```bash
export MUSE_DB=./ai_runs.db
uvicorn muse_labeler:app --host 127.0.0.1 --port 8088 --reload
```

Open `http://127.0.0.1:8088`

* **K** = keep (good)
* **J** = junk (bad)
* **1..5** = score overall (0.2 .. 1.0)
* **H** = toggle hallucination flag
* **A** = toggle actionable

---

## 6) Optional: export snapshots

```bash
duckdb -c ".read export_duckdb.sql"
# creates: sessions.parquet, runs.parquet, runs_wide.parquet
```

Open them in anything (DuckDB, Pandas, Athena, etc.) for deeper analysis.

---

## 7) Latency (optional toggle)

If you enabled the latency snippet in `main.ts`, you’ll get `response.latency_ms` = time from **prompt dispatch** to **first assistant text seen** per pane.
If you didn’t, add it later; nothing else changes.

---

## 8) Where to tweak scrapers

**`preload_view.ts`** has these functions:

* `scrapeChatGPT()` — targets assistant blocks on chatgpt.com/chat.openai.com
* `scrapeGemini()` — targets assistant blocks on gemini.google.com
* `scrapeGrok()` — targets assistant blocks on grok.com (tight selectors)
* `scrapeGeneric()` — fallback; strips obvious chrome

If a site’s DOM shifts, update the two arrays in that scraper:

* `ASSISTANT_SEL` (what to capture)
* `JUNK_SEL` (what to strip)

Everything else just keeps working.

---

## 9) Reliability knobs (already baked)

* **Queue + retry:** renderer batches unsent events in `localStorage`. If ingestor is down, logs flush next send.
* **Redaction:** trivial redactor hides `api key|password|token` patterns before send. Tune if needed.
* **Session IDs:** new `session_id` per prompt dispatch → easy analysis by experiment block.

---

## 10) Minimal contract (if you add panes later)

Each pane ultimately sends a JSON with:

```json
{
  "session_id": "<same id for the run>",
  "ts": "ISO timestamp",
  "user_input": { "text": "your prompt", "tags": ["multinav"] },
  "task_context": { "topic": "ad-hoc", "intent": "compare" },
  "client": { "surface": "multinav-app", "pane_id": "pane-1", "browser": "electron", "os": "win32", "device": "desktop" },
  "model": { "provider": "chatgpt|gemini|grok|copilot|...", "name": "best-effort", "mode": "chat" },
  "response": { "text": "assistant reply", "raw_tokens": null, "latency_ms": 1234, "finish_reason": "stop" },
  "observations": { "contains_code": true, "has_citations": false, "ui_broke": false },
  "costing": {}
}
```

If you don’t have some fields, omit them. The ingestor fills safe defaults.

---

## 11) Troubleshooting

* **No rows in DB**

  * Check the ingestor console; you should see POST hits.
  * Confirm Electron’s `main.ts` has the `ipcMain.handle("muse.logEvent"...` or direct fetch in `view:content` handler.
  * CORS isn’t a factor (local POST). Wrong port is.

* **Dupes**

  * The scrapers cache last text and only emit on change. If you still see dupes, you can add a short debounce (300–500ms) in `oncePerChange()`.

* **Selector drift**

  * If ChatGPT/Gemini/Grok change markup, update `ASSISTANT_SEL`/`JUNK_SEL`.
  * Use devtools in that pane: `document.activeElement`, `getSelection()`, and `$$('[data-message-author-role="assistant"]')` to check matches.

---

## 12) Daily flow (the way you actually use it)

1. Start ingestor.
2. Fire Electron, run your usual multi-pane tests.
3. Let scrapers log silently; you keep working.
4. Between tasks, open labeler and J/K/score a handful.
5. End of day, run a canned query or export Parquet.

You’ll have a living dataset of **which model wins which tasks**, with real latency/quality stats and clean text bodies ready for retrieval or reruns.

—

want me to bundle all of this into a single `docs/README.md` and a couple of npm scripts (`"ingest"`, `"labeler"`) so it’s one command per step?
