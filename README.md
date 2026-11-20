# Runway OS

A Win95-style desktop in the browser for working with the [Runway API](https://docs.dev.runwayml.com/): generate images, video and audio with every model in Runway's API, and track each job's real credit cost, task ID and output file.

## Run

```sh
python3 server.py        # then open http://localhost:8765
```

Python 3 standard library only. `ffmpeg` is optional (video thumbnails).

Add your Runway API key from **Start → Runway API key…**, or put it in a file named `.runway_key` next to `server.py` (ignored by git), or set `RUNWAYML_API_SECRET`.

## Files

- `server.py`: local server. Serves the page, syncs jobs and the credit balance with Runway, downloads outputs, builds the Generate forms from Runway's OpenAPI spec.
- `index.html`: the page shell and the inline SVG icon symbols; it loads `css/` and `js/main.js`.
- `css/`: `base.css` (fonts, tokens, themes, controls), `wm.css` (desktop, windows), `apps.css` (window contents, menus, taskbar, boot). Loaded in that order: the cascade depends on it.
- `js/`: native ES modules, no build step. `main.js` imports everything, calls each module's `init()` in a fixed order (listener order matters), then starts up. `core/` (store `S` in `state.js`, DOM/time/API helpers, morph, job status), `wm/` (`kinds.js`: window kinds, `APP_KEYS`, the `RENDER`/`SIG` registries apps fill in; windows, sheets, selection, taskbar, persistence), `desktop/icons.js`, `apps/` (one file per window kind), and the global handlers (`menus`, `shortcuts`, `dnd`, `desk-clicks`, `boot`, `live`). Modules only declare at top level; anything reassigned lives in `S`.
- `fonts/`: bundled fonts (MS Sans Serif pixel font from 98.css, MIT; IBM Plex Sans and Atkinson Hyperlegible, SIL OFL).
- `runs.json`: your job log (created on first job, not committed).
- `tests/`: the smoke test.

## Smoke test

Run `tests/smoke.sh` (macOS; needs Google Chrome, Node and Python 3; about 40 s). It starts its own `server.py` copies on free ports in a temp folder: one empty, like a fresh clone (no job log, no model list, no key), and one with a read-only copy of your `runs.json`, notes and media (from this checkout, else the main git worktree, or `SMOKE_DATA_DIR`). It never touches your data, never uses your API key and never submits a job. In headless Chrome it passes the boot screen, then for each theme (Dark, Classic, Storm, Eggplant, Marine, Pumpkin, high contrast and a large Scale) opens every window, plus Viewer and Properties for real jobs, the Start menu and right-click menus, and checks the keyboard shortcuts (Alt+letter apps, Alt+W, F1, Cmd+,, Cmd+I, Ctrl+Esc) through your keyboard layout. It exits non-zero, naming the theme and window, on any uncaught error, unhandled rejection, `console.error`, failed request, empty window or window bigger than the screen. Screenshots go to `tests/out/` (not committed).
