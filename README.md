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

- Data is stored **on the device** (browser `localStorage`). With sync off,
  nothing is sent anywhere.
- Use the **⋮ menu → Export backup (JSON)** for backups, and **Import backup**
  to restore one (import replaces the data on that device).
- **Export flights (CSV)** and **Export aircraft (CSV)** produce
  spreadsheet-friendly copies; **Import from CSV** reads the same formats
  back (columns matched by header name). Flights already present are
  skipped, and unknown registrations in a flights file create the aircraft
  automatically.
- **Medical & licence** (⋮ menu) stores your medical expiry and licence
  renewal dates; a brief pop-up on launch shows the days remaining,
  highlighted when 30 days or fewer (or overdue). The dates sync across
  devices like everything else.

## Sync across devices

Tap the **⟳ button** and **sign in with Google** — that's the whole per-device
setup. The logbook is stored in Cloud Firestore (your own Firebase project)
and pushed to every signed-in device in real time.

How it behaves:

- Changes appear on other devices within seconds while they're open, and on
  launch otherwise.
- Devices **merge by entry** (newest edit wins per flight/aircraft), and
  deletions carry across via tombstones — so logging on your phone and your
  desktop in the same afternoon combines cleanly.
- Offline is fine: changes stay local and sync next time you're connected.
- Only your Google account can read the data, enforced by Firestore security
  rules (below).

### Firebase project setup (owner, one time)

1. Create a project at https://console.firebase.google.com, add a **Web app**,
   and put its config in `js/cloud-src.mjs` (the config is not a secret).
2. Enable **Authentication → Sign-in method → Google**, and add your hosting
   domain (e.g. `yourname.github.io`) under Authentication → Settings →
   **Authorized domains**.
3. Create a **Firestore database** (production mode) and publish these rules
   (Firestore → Rules):

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{userId}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
       }
     }
   }
   ```

4. Rebuild the bundled sync module after any change to `js/cloud-src.mjs`:
   `npm install firebase esbuild && node tools/build-cloud.mjs` (the Firebase
   SDK is bundled into `js/cloud.js` so the app has no runtime CDN dependency
   and works offline).

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
