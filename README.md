# PilotLog

A personal pilot logbook that runs as a **web app and installs on Android** (and iOS)
as a Progressive Web App — one codebase, no app store, works offline.

## Features

**Aircraft**
- Maintain a list of aircraft by registration, make, and model.
- Tag each aircraft with type & equipment by checking items from a list:
  Wheels, Floats, Amphibious, Skis, Tailwheel, Single-Engine, Multi-Engine,
  Piston, Turbine, Jet, Helicopter, Glider — plus any custom types you add.

**Logbook**
- Each flight records: date, start location, end location, total hours,
  takeoffs, and landings.
- Hours are split per category like a paper logbook: Solo, Cross Country,
  Day, Night, Pilot in Command, Dual, IFR, VFR each have their own hours
  column. Ticking a category's box copies the flight's total into it; adjust
  the number when only part of the flight applies (e.g. 1.2 night out of 3.0).
- Optional remarks, edit/delete, and filtering by year and aircraft.

**Totals**
- Summary tiles: total hours, flights, takeoffs, landings — for any year or all time.
- Hours and flight counts per category (Solo, XC, Day, Night, PIC, Dual, IFR, VFR).
- Totals per aircraft and per aircraft type (e.g. all your float time).
- Year-by-year breakdown across every category with a **running (cumulative)
  hours total**.

Older backups (v1, where categories were simple checkboxes) import cleanly:
a checked category becomes the flight's full hours in that category.

## Running it

It's a static site — no build step, no server-side code.

- **Locally:** open a terminal in this folder and run any static server, e.g.
  `npx http-server` or `python3 -m http.server`, then browse to the shown URL.
- **On the web:** host the folder anywhere static files can live. The easiest is
  **GitHub Pages**: repository *Settings → Pages → Deploy from a branch*, pick your
  branch and `/ (root)`. Your log will be at `https://<user>.github.io/PilotLog/`.

## Installing on Android

1. Open the hosted URL in Chrome on your phone.
2. Tap the **⋮** menu → **Add to Home screen** (or the "Install app" prompt).
3. PilotLog opens full-screen like a native app and works with no connection —
   the service worker caches everything.

## Your data

- Data is stored **on the device** (browser `localStorage`) — nothing is sent
  anywhere. Phone and desktop each keep their own copy.
- Use the **⋮ menu → Export backup (JSON)** regularly, and **Import backup** to
  move your log between devices (import replaces the data on that device).
- **Export flights (CSV)** produces a spreadsheet-friendly copy of the logbook.

## Project layout

| Path | Purpose |
|---|---|
| `index.html` | App shell: tabs, dialogs, tables |
| `css/style.css` | Styling, light & dark mode |
| `js/app.js` | All app logic: storage, CRUD, totals, import/export |
| `sw.js` | Service worker (offline caching) |
| `manifest.webmanifest` | PWA install metadata |
| `icons/` | App icons (SVG + generated PNGs) |
| `tools/generate-icons.mjs` | Regenerates the PNG icons (`node tools/generate-icons.mjs`) |
