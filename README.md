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
- `index.html`, `app.js`: the desktop (window manager, Generate, Jobs, galleries, Terminal, Options).
- `fonts/`: bundled fonts (MS Sans Serif pixel font from 98.css, MIT; IBM Plex Sans and Atkinson Hyperlegible, SIL OFL).
- `runs.json`: your job log (created on first job, not committed).
