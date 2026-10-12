# Smart Slides

Upload a CSV, let an AI agent find the trends worth presenting, then build and refine a slide deck by chatting with it. Export to PowerPoint.

> Proof of concept. No auth, no database, single-user.

## Quick start

**Requirements:** Node.js 20+ (tested on 24) and an LLM API key. The default is a free [Gemini API key](https://aistudio.google.com/apikey); Anthropic and any OpenAI-compatible endpoint (OpenRouter, Groq, Ollama) also work.

```bash
npm install
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
# edit .env and set GEMINI_API_KEY=...
npm run dev
```

Open **http://localhost:5173**. The backend runs on port 8787 (Vite proxies `/api` to it).

Two sample datasets are built into the UI, in `web/public/sample/` (regenerate with `npm run sample`). Both have planted trends so you can check the agent finds them:
- `social_posts.csv` (single table): e.g. Brazil's "angry" share jumps in 2024.
- `customers.csv` + `products.csv` + `orders.csv` (multi-table): e.g. Enterprise customers buy far more Hardware, and big discounts lift Accessories quantity. These need joins across files.

### Other scripts

| Command             | What it does                          |
| ------------------- | ------------------------------------- |
| `npm run dev`       | Backend + frontend with hot reload    |
| `npm run typecheck` | Type-checks all workspaces            |
| `npm run build`     | Production build of the frontend      |

### Configuration (`.env`)

| Variable            | Default                | Notes                                                    |
| ------------------- | ---------------------- | -------------------------------------------------------- |
| `LLM_PROVIDER`      | `gemini`               | `gemini`, `nanogpt`, `anthropic`, or `openai-compatible`            |
| `GEMINI_API_KEY`    |                        | Free key from Google AI Studio                           |
| `GEMINI_MODEL`      | `gemini-3.8-flash`     | Any Gemini model id                                      |
| `NANOGPT_API_KEY` / `NANOGPT_MODEL` |        | For `LLM_PROVIDER=nanogpt` (subscription endpoint); `npm run models` lists ids |
| `ANTHROPIC_API_KEY` |                        | Used when `LLM_PROVIDER=anthropic`                       |
| `ANTHROPIC_MODEL`   | `claude-sonnet-5-5`    |                                                          |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` |       | For `openai-compatible` (OpenRouter, Groq, Ollama, ...)  |
| `PORT`              | `8787`                 | Backend port                                             |

Only the backend reads these. Free tiers are rate-limited and smaller models are less reliable at structured tool calls, so
if insight generation or edits occasionally fail, retry or switch to a stronger model.

## How it works

```
Browser (React + TS)  ──NDJSON streams──▶  Node/Express  ──▶  Gemini / Anthropic / OpenAI-compatible
 wizard · chat · slides                    in-memory session
 undo · IndexedDB save                     sql.js (SQLite/WASM) holds the CSV
 PPTX export (pptxgenjs)
```

1. **Upload.** One or more CSVs are parsed with PapaParse, types are inferred (number / date / text), and each file becomes a table in an in-memory SQLite database (table name = file name). Join keys between files are auto-detected (matching `*_id`-style columns whose values overlap by 80%+). A compact *profile* (columns, ranges, top values, sample rows, relationships) is built.
2. **Insights.** The model never sees raw rows. It (a) proposes hypotheses with SQL from the profile, (b) the server runs every query, (c) the model writes up only the findings the real result rows support. Numbers on slides therefore come from queries, not from the model's memory.
3. **Style.** Six curated presets; the agent recommends one.
4. **Scaffold.** An intro slide, one slide per chosen insight (chart + key points + big numbers), and a summary slide.
5. **Refine.** Chat edits go through tool calls on a JSON deck model (add/update/move/remove elements, change layout/theme, reorder slides, re-query charts, suggest new insights). One prompt = one undo step.
6. **Save / export.** Decks (plus the source CSV) are saved to IndexedDB in the browser. Export produces a `.pptx` with **native, editable PowerPoint charts**.

### Layout model
Slides use three layouts (`title`, `split`, `full`) with named regions (`header`, `left`, `right`, `main`, `footer`). "Move the chart to the right" changes an element's region. Free-form pixel positioning is intentionally not supported. The same geometry code (`shared/src/layout.ts`) drives both the web renderer and the PPTX export, so they match.

### API key handling
- The key lives only in the server's environment (`.env`, git-ignored). It is never sent to or bundled into the browser, and never logged.
- The browser only talks to `/api/*` on the local backend.
- Note that data aggregates and a few sample rows are sent to the configured LLM provider as part of analysis (free tiers may log or train on prompts, so use non-sensitive data).

## Project layout

```
shared/   types, themes, layout geometry (used by web + server)
server/   Express API: CSV → SQLite, insight pipeline, scaffold, chat agent
web/      Vite + React + Tailwind UI, slide renderer, PPTX export
scripts/  sample data generator
```

## Known limitations (POC)
- CSV only: up to 8 files, ~200k rows per file (500k total). Join keys are guessed from column names and value overlap, so unusual keys may not be detected.
- Chart types: bar, stacked bar, line, area, pie, scatter (the subset that exists both in the browser and as native PPTX charts).
- Fonts are limited to common ones (Arial, Calibri, Georgia, Verdana, Trebuchet MS) so PPTX matches the web view.
- Sessions live in server memory; restarting the server drops them. Reopening a saved deck re-uploads its stored CSV automatically.
- No direct editing; changes are made by conversing with the agent (by design).

## TODO / follow-ups
- **Demo mode**: bundled sample data plus a mocked LLM so reviewers can run the full flow with no API key.
- More file formats (xlsx, json, parquet).
- Optional UI key entry for non-local deployments.
- PDF export; speaker notes.
- Automated tests for the profiler, SQL guard, and layout geometry.
