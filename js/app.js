/* ================= PilotLog ================= */
"use strict";

// ---------- constants ----------

const STORAGE_KEY = "pilotlog-data-v1";

const FLAGS = [
  { key: "pic",  label: "Pilot in Command" },
  { key: "dual", label: "Dual" },
  { key: "solo", label: "Solo" },
  { key: "xc",   label: "Cross Country" },
  { key: "day",  label: "Day" },
  { key: "night",label: "Night" },
  { key: "vfr",  label: "VFR" },
  { key: "ifr",  label: "IFR" },
];

const FLAG_SHORT = {
  pic: "PIC", dual: "Dual", solo: "Solo", xc: "XC",
  day: "Day", night: "Night", vfr: "VFR", ifr: "IFR",
};

const BUILTIN_TYPES = [
  "Wheels", "Floats", "Amphibious", "Skis", "Tailwheel",
  "Single-Engine", "Multi-Engine", "Piston", "Turbine", "Jet",
  "Helicopter", "Glider",
];

// ---------- state ----------

let state = loadState();
let currentView = "log";
let editingFlightId = null;
let editingAircraftId = null;

function emptyState() {
  return { version: 2, aircraft: [], flights: [], customTypes: [], deleted: { aircraft: {}, flights: {} } };
}

function loadState() {
  const empty = emptyState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const data = JSON.parse(raw);
    return normalizeState(data) ?? empty;
  } catch {
    return empty;
  }
}

function normalizeState(data) {
  if (!data || typeof data !== "object") return null;
  if (!Array.isArray(data.aircraft) || !Array.isArray(data.flights)) return null;
  const tombs = data.deleted && typeof data.deleted === "object" ? data.deleted : {};
  return {
    version: 2,
    aircraft: data.aircraft.filter(a => a && a.id && a.reg != null),
    flights: data.flights.filter(f => f && f.id && f.date).map(migrateFlight),
    customTypes: Array.isArray(data.customTypes) ? data.customTypes.filter(t => typeof t === "string") : [],
    deleted: {
      aircraft: cleanTombstones(tombs.aircraft),
      flights: cleanTombstones(tombs.flights),
    },
  };
}

function cleanTombstones(obj) {
  const out = {};
  if (obj && typeof obj === "object") {
    for (const [id, ts] of Object.entries(obj)) {
      if (typeof ts === "number" && ts > 0) out[id] = ts;
    }
  }
  return out;
}

// v1 stored per-category booleans in `flags`; v2 stores hours in `hoursBy`.
// A checked v1 flag becomes the flight's full hours in that category.
function migrateFlight(f) {
  const hoursBy = {};
  for (const fl of FLAGS) {
    if (f.hoursBy && typeof f.hoursBy === "object") {
      const v = Number(f.hoursBy[fl.key]);
      hoursBy[fl.key] = Number.isFinite(v) && v > 0 ? Math.round(v * 10) / 10 : 0;
    } else {
      hoursBy[fl.key] = f.flags?.[fl.key] ? f.hours : 0;
    }
  }
  const { flags, ...rest } = f;
  const count = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : 0);
  return { ...rest, hoursBy, nightTakeoffs: count(f.nightTakeoffs), nightLandings: count(f.nightLandings) };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  schedulePushSync();
}

function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    ("id-" + Math.random().toString(36).slice(2) + "-" + performance.now().toString(36));
}

// ---------- helpers ----------

const $ = sel => document.querySelector(sel);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function fmtHours(h) {
  return (Math.round(h * 10) / 10).toLocaleString(undefined, {
    minimumFractionDigits: 1, maximumFractionDigits: 1,
  });
}

function fmtDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

function yearOf(flight) {
  return flight.date.slice(0, 4);
}

function aircraftById(id) {
  return state.aircraft.find(a => a.id === id) || null;
}

function aircraftLabel(a) {
  if (!a) return "(deleted aircraft)";
  return `${a.reg} — ${a.make} ${a.model}`;
}

function allTypes() {
  return [...BUILTIN_TYPES, ...state.customTypes];
}

function sortedFlights() {
  return [...state.flights].sort((x, y) =>
    y.date.localeCompare(x.date) || (y.created || 0) - (x.created || 0));
}

// Aircraft ordered by most recent flight first; never-flown aircraft last
// (newest added first), so the picker leads with what you actually fly.
function sortedAircraft({ includeArchived = false } = {}) {
  const lastFlown = {};
  for (const f of state.flights) {
    if (!lastFlown[f.aircraftId] || f.date > lastFlown[f.aircraftId]) {
      lastFlown[f.aircraftId] = f.date;
    }
  }
  return state.aircraft
    .filter(a => includeArchived || !a.archived)
    .sort((x, y) => {
      const lx = lastFlown[x.id] || "", ly = lastFlown[y.id] || "";
      if (lx !== ly) return ly.localeCompare(lx);
      return (y.updated || 0) - (x.updated || 0) || x.reg.localeCompare(y.reg);
    });
}

// ---------- tabs / views ----------

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => switchView(tab.dataset.view));
});

function switchView(view) {
  currentView = view;
  document.querySelectorAll(".tab").forEach(t => {
    const active = t.dataset.view === view;
    t.classList.toggle("active", active);
    t.setAttribute("aria-selected", String(active));
  });
  $("#view-log").hidden = view !== "log";
  $("#view-aircraft").hidden = view !== "aircraft";
  $("#view-totals").hidden = view !== "totals";
  $("#fab").hidden = view === "totals";
  render();
}

// ---------- render dispatch ----------

function render() {
  if (currentView === "log") renderLog();
  else if (currentView === "aircraft") renderAircraft();
  else renderTotals();
}

// ---------- logbook view ----------

function renderLog() {
  const yearSel = $("#filter-year");
  const acSel = $("#filter-aircraft");

  const years = [...new Set(state.flights.map(yearOf))].sort().reverse();
  const yearVal = yearSel.value;
  yearSel.innerHTML = `<option value="">All years</option>` +
    years.map(y => `<option value="${y}">${y}</option>`).join("");
  if (years.includes(yearVal)) yearSel.value = yearVal;

  const acVal = acSel.value;
  acSel.innerHTML = `<option value="">All aircraft</option>` +
    sortedAircraft({ includeArchived: true }).map(a =>
      `<option value="${esc(a.id)}">${esc(a.reg)}${a.archived ? " (archived)" : ""}</option>`).join("");
  if (state.aircraft.some(a => a.id === acVal)) acSel.value = acVal;

  let flights = sortedFlights();
  if (yearSel.value) flights = flights.filter(f => yearOf(f) === yearSel.value);
  if (acSel.value) flights = flights.filter(f => f.aircraftId === acSel.value);

  const totalH = flights.reduce((s, f) => s + f.hours, 0);
  $("#log-count").textContent = flights.length
    ? `${flights.length} flight${flights.length === 1 ? "" : "s"} · ${fmtHours(totalH)} h`
    : "";

  $("#log-empty").hidden = state.flights.length > 0;

  $("#flight-list").innerHTML = flights.map(f => {
    const a = aircraftById(f.aircraftId);
    const chips = FLAGS.filter(fl => f.hoursBy[fl.key] > 0)
      .map(fl => {
        const v = f.hoursBy[fl.key];
        const partial = v < f.hours - 0.05; // show hours when only part of the flight applies
        return `<span class="chip">${FLAG_SHORT[fl.key]}${partial ? " " + fmtHours(v) : ""}</span>`;
      }).join("");
    return `
      <div class="card" data-id="${esc(f.id)}">
        <div class="card-top">
          <span class="flight-route">${esc(f.from)}<span class="arrow">&rarr;</span>${esc(f.to)}</span>
          <span class="flight-hours">${fmtHours(f.hours)} <span class="unit">h</span></span>
        </div>
        <div class="card-sub">
          <span>${fmtDate(f.date)}</span>
          <span>${esc(a ? a.reg : "(deleted aircraft)")}</span>
          <span>${f.takeoffs} T/O &middot; ${f.landings} Ldg${
            f.nightTakeoffs || f.nightLandings
              ? ` &middot; night ${f.nightTakeoffs} T/O &middot; ${f.nightLandings} Ldg`
              : ""}</span>
        </div>
        ${chips ? `<div class="chips">${chips}</div>` : ""}
        ${f.remarks ? `<div class="remarks">${esc(f.remarks)}</div>` : ""}
        <div class="card-actions">
          <button data-action="edit-flight">Edit</button>
          <button data-action="delete-flight" class="delete">Delete</button>
        </div>
      </div>`;
  }).join("");
}

$("#flight-list").addEventListener("click", e => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id = btn.closest(".card").dataset.id;
  if (btn.dataset.action === "edit-flight") openFlightDialog(id);
  else if (btn.dataset.action === "delete-flight") {
    const f = state.flights.find(x => x.id === id);
    if (f && confirm(`Delete flight ${f.from} → ${f.to} on ${fmtDate(f.date)}?`)) {
      state.flights = state.flights.filter(x => x.id !== id);
      state.deleted.flights[id] = Date.now();
      saveState();
      render();
    }
  }
});

$("#filter-year").addEventListener("change", renderLog);
$("#filter-aircraft").addEventListener("change", renderLog);

// ---------- aircraft view ----------

function renderAircraft() {
  $("#aircraft-empty").hidden = state.aircraft.length > 0;

  const card = a => {
    const flights = state.flights.filter(f => f.aircraftId === a.id);
    const hours = flights.reduce((s, f) => s + f.hours, 0);
    const chips = (a.types || []).map(t => `<span class="chip">${esc(t)}</span>`).join("");
    return `
      <div class="card${a.archived ? " archived" : ""}" data-id="${esc(a.id)}">
        <div class="card-top">
          <span class="aircraft-name">${esc(a.reg)} &mdash; ${esc(a.make)} ${esc(a.model)}</span>
          <span class="aircraft-hours">${fmtHours(hours)} h &middot; ${flights.length} flight${flights.length === 1 ? "" : "s"}</span>
        </div>
        ${chips ? `<div class="chips">${chips}</div>` : ""}
        <div class="card-actions">
          <button data-action="toggle-archive">${a.archived ? "Unarchive" : "Archive"}</button>
          <button data-action="edit-aircraft">Edit</button>
          <button data-action="delete-aircraft" class="delete">Delete</button>
        </div>
      </div>`;
  };

  const active = sortedAircraft();
  const archived = sortedAircraft({ includeArchived: true }).filter(a => a.archived);
  $("#aircraft-list").innerHTML =
    active.map(card).join("") +
    (archived.length
      ? `<h2 class="list-heading">Archived <span class="sub">(kept in totals, hidden when logging)</span></h2>` +
        archived.map(card).join("")
      : "");
}

$("#aircraft-list").addEventListener("click", e => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id = btn.closest(".card").dataset.id;
  if (btn.dataset.action === "edit-aircraft") openAircraftDialog(id);
  else if (btn.dataset.action === "toggle-archive") {
    const a = aircraftById(id);
    if (a) {
      a.archived = !a.archived;
      if (!a.archived) delete a.archived;
      a.updated = Date.now();
      saveState();
      render();
    }
  }
  else if (btn.dataset.action === "delete-aircraft") {
    const a = aircraftById(id);
    const n = state.flights.filter(f => f.aircraftId === id).length;
    const msg = n
      ? `Delete ${a.reg}? Its ${n} logged flight${n === 1 ? "" : "s"} will be kept but shown as "(deleted aircraft)".`
      : `Delete ${a.reg}?`;
    if (a && confirm(msg)) {
      state.aircraft = state.aircraft.filter(x => x.id !== id);
      state.deleted.aircraft[id] = Date.now();
      saveState();
      render();
    }
  }
});

// ---------- totals view ----------

function computeTotals(flights) {
  const t = {
    flights: flights.length,
    hours: 0, takeoffs: 0, landings: 0,
    nightTakeoffs: 0, nightLandings: 0,
    byFlag: {},   // key -> {hours, flights}
    byAircraft: {}, // id -> {hours, flights, takeoffs, landings}
    byType: {},   // type -> {hours, flights}
  };
  for (const fl of FLAGS) t.byFlag[fl.key] = { hours: 0, flights: 0 };

  for (const f of flights) {
    t.hours += f.hours;
    t.takeoffs += f.takeoffs;
    t.landings += f.landings;
    t.nightTakeoffs += f.nightTakeoffs || 0;
    t.nightLandings += f.nightLandings || 0;

    for (const fl of FLAGS) {
      const h = f.hoursBy[fl.key];
      if (h > 0) {
        t.byFlag[fl.key].hours += h;
        t.byFlag[fl.key].flights += 1;
      }
    }

    const acc = t.byAircraft[f.aircraftId] ||= { hours: 0, flights: 0, takeoffs: 0, landings: 0 };
    acc.hours += f.hours;
    acc.flights += 1;
    acc.takeoffs += f.takeoffs;
    acc.landings += f.landings;

    const a = aircraftById(f.aircraftId);
    for (const type of (a?.types || [])) {
      const tt = t.byType[type] ||= { hours: 0, flights: 0 };
      tt.hours += f.hours;
      tt.flights += 1;
    }
  }
  return t;
}

// n months before today, as a local YYYY-MM-DD string (day clamped so
// e.g. "6 months before Aug 31" doesn't spill into the next month).
function monthsAgoISO(n) {
  const now = new Date();
  const day = now.getDate();
  const d = new Date(now.getFullYear(), now.getMonth() - n, 1);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  const pad = v => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function keepSelect(sel, optionsHtml) {
  const prev = sel.value;
  sel.innerHTML = optionsHtml;
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}

function renderTotals() {
  const periodSel = $("#totals-period");
  const catSel = $("#totals-cat");
  const typeSel = $("#totals-type");
  const fromInp = $("#totals-from");
  const toInp = $("#totals-to");

  const years = [...new Set(state.flights.map(yearOf))].sort().reverse();
  keepSelect(periodSel,
    `<option value="">All time</option>` +
    `<option value="6m">Last 6 months</option>` +
    `<option value="12m">Last 12 months</option>` +
    years.map(y => `<option value="${y}">${y}</option>`).join("") +
    `<option value="custom">Custom range&hellip;</option>`);
  keepSelect(catSel,
    `<option value="">All categories</option>` +
    FLAGS.map(fl => `<option value="${fl.key}">${fl.label}</option>`).join(""));
  keepSelect(typeSel,
    `<option value="">All aircraft types</option>` +
    allTypes().map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join(""));

  const custom = periodSel.value === "custom";
  fromInp.hidden = toInp.hidden = $("#totals-range-sep").hidden = !custom;

  let from = "", to = "";
  if (periodSel.value === "6m") from = monthsAgoISO(6);
  else if (periodSel.value === "12m") from = monthsAgoISO(12);
  else if (custom) { from = fromInp.value || ""; to = toInp.value || ""; }
  else if (periodSel.value) { from = periodSel.value + "-01-01"; to = periodSel.value + "-12-31"; }

  const cat = catSel.value;
  const type = typeSel.value;
  const matchesKind = f =>
    (!cat || f.hoursBy[cat] > 0) &&
    (!type || (aircraftById(f.aircraftId)?.types || []).includes(type));

  const hasFlights = state.flights.length > 0;
  $("#totals-empty").hidden = hasFlights;

  const flights = state.flights.filter(f =>
    (!from || f.date >= from) && (!to || f.date <= to) && matchesKind(f));
  const filtered = periodSel.value || cat || type;
  $("#totals-count").textContent = filtered
    ? (flights.length === 1 ? "1 flight matches" : `${flights.length} flights match`)
    : "";
  const t = computeTotals(flights);

  // --- stat tiles ---
  $("#stat-row").innerHTML = [
    [fmtHours(t.hours), "Total hours"],
    [t.flights, "Flights"],
    [t.takeoffs, "Takeoffs"],
    [t.landings, "Landings"],
    [t.nightTakeoffs, "Night T/O"],
    [t.nightLandings, "Night ldgs"],
  ].map(([v, l]) => `
    <div class="stat">
      <div class="stat-value">${v}</div>
      <div class="stat-label">${l}</div>
    </div>`).join("");

  // --- by category ---
  $("#table-category tbody").innerHTML = FLAGS.map(fl => {
    const c = t.byFlag[fl.key];
    return `<tr><td>${fl.label}</td><td class="num">${fmtHours(c.hours)}</td><td class="num">${c.flights}</td></tr>`;
  }).join("");

  // --- by aircraft ---
  const acRows = Object.entries(t.byAircraft)
    .map(([id, c]) => ({ label: aircraftLabel(aircraftById(id)), ...c }))
    .sort((x, y) => y.hours - x.hours);
  $("#table-aircraft tbody").innerHTML = acRows.map(r => `
    <tr>
      <td>${esc(r.label)}</td>
      <td class="num">${fmtHours(r.hours)}</td>
      <td class="num">${r.flights}</td>
      <td class="num">${r.takeoffs}</td>
      <td class="num">${r.landings}</td>
    </tr>`).join("") || `<tr><td colspan="5">&mdash;</td></tr>`;

  // --- by aircraft type ---
  const typeRows = Object.entries(t.byType).sort((x, y) => y[1].hours - x[1].hours);
  $("#table-type tbody").innerHTML = typeRows.map(([type, c]) => `
    <tr><td>${esc(type)}</td><td class="num">${fmtHours(c.hours)}</td><td class="num">${c.flights}</td></tr>`
  ).join("") || `<tr><td colspan="3">&mdash;</td></tr>`;

  // --- year by year with running total (all years, oldest first; honours
  // the category/type filters but not the period, since it spans all years) ---
  const byYear = {};
  for (const f of state.flights.filter(matchesKind)) (byYear[yearOf(f)] ||= []).push(f);
  const yearKeys = Object.keys(byYear).sort();
  let cumul = 0;
  $("#table-years tbody").innerHTML = yearKeys.map(y => {
    const yt = computeTotals(byYear[y]);
    cumul += yt.hours;
    return `
      <tr>
        <td>${y}</td>
        <td class="num">${yt.flights}</td>
        <td class="num">${fmtHours(yt.hours)}</td>
        <td class="num">${fmtHours(yt.byFlag.solo.hours)}</td>
        <td class="num">${fmtHours(yt.byFlag.xc.hours)}</td>
        <td class="num">${fmtHours(yt.byFlag.day.hours)}</td>
        <td class="num">${fmtHours(yt.byFlag.night.hours)}</td>
        <td class="num">${fmtHours(yt.byFlag.pic.hours)}</td>
        <td class="num">${fmtHours(yt.byFlag.dual.hours)}</td>
        <td class="num">${fmtHours(yt.byFlag.ifr.hours)}</td>
        <td class="num">${fmtHours(yt.byFlag.vfr.hours)}</td>
        <td class="num">${yt.takeoffs}</td>
        <td class="num">${yt.landings}</td>
        <td class="num">${yt.nightTakeoffs}</td>
        <td class="num">${yt.nightLandings}</td>
        <td class="num">${fmtHours(cumul)}</td>
      </tr>`;
  }).join("") || `<tr><td colspan="16">&mdash;</td></tr>`;
}

for (const id of ["totals-period", "totals-cat", "totals-type", "totals-from", "totals-to"]) {
  document.getElementById(id).addEventListener("change", renderTotals);
}

// ---------- flight dialog ----------

const flightDialog = $("#flight-dialog");
const flightForm = $("#flight-form");

function buildCategoryInputs(hoursBy = {}) {
  $("#flight-cats").innerHTML = "<legend>Time by category (hours)</legend>" +
    FLAGS.map(fl => {
      const v = hoursBy[fl.key] > 0 ? hoursBy[fl.key] : "";
      return `
        <div class="cat-row">
          <label>
            <input type="checkbox" data-cat="${fl.key}" ${v !== "" ? "checked" : ""}>
            <span>${fl.label}</span>
          </label>
          <input type="number" name="cat-${fl.key}" min="0" step="0.1" inputmode="decimal"
                 value="${v}" aria-label="${fl.label} hours">
        </div>`;
    }).join("");
}

// Checkbox = quick-fill: check to copy the total, uncheck to clear.
// Typing hours directly keeps the checkbox in sync.
$("#flight-cats").addEventListener("change", e => {
  const cb = e.target.closest("input[type=checkbox][data-cat]");
  if (!cb) return;
  const numInput = flightForm.elements["cat-" + cb.dataset.cat];
  if (cb.checked) {
    const total = parseFloat(flightForm.elements.hours.value);
    if (total > 0) numInput.value = Math.round(total * 10) / 10;
    else { cb.checked = false; flightForm.elements.hours.focus(); }
  } else {
    numInput.value = "";
  }
});
$("#flight-cats").addEventListener("input", e => {
  const num = e.target.closest("input[type=number]");
  if (!num) return;
  const key = num.name.replace("cat-", "");
  $(`#flight-cats input[data-cat="${key}"]`).checked = parseFloat(num.value) > 0;
});

function openFlightDialog(flightId = null) {
  editingFlightId = flightId;
  const f = flightId ? state.flights.find(x => x.id === flightId) : null;

  let choices = sortedAircraft(); // most recently flown first, archived hidden
  // Editing a flight on an archived aircraft: keep it selectable for this flight.
  const own = f ? aircraftById(f.aircraftId) : null;
  if (own && !choices.includes(own)) choices = [own, ...choices];

  if (!choices.length) {
    alert(state.aircraft.length
      ? "All your aircraft are archived. Unarchive one or add a new aircraft first (Aircraft tab)."
      : "Add an aircraft first (Aircraft tab).");
    switchView("aircraft");
    return;
  }

  $("#flight-dialog-title").textContent = f ? "Edit flight" : "New flight";
  flightForm.querySelector(".form-error").hidden = true;

  const acSel = flightForm.elements.aircraftId;
  acSel.innerHTML = choices
    .map(a => `<option value="${esc(a.id)}">${esc(aircraftLabel(a))}${a.archived ? " (archived)" : ""}</option>`).join("");

  flightForm.elements.date.value = f ? f.date : new Date().toISOString().slice(0, 10);
  acSel.value = f ? f.aircraftId : choices[0].id;
  flightForm.elements.from.value = f ? f.from : "";
  flightForm.elements.to.value = f ? f.to : "";
  flightForm.elements.hours.value = f ? f.hours : "";
  flightForm.elements.takeoffs.value = f ? f.takeoffs : 1;
  flightForm.elements.landings.value = f ? f.landings : 1;
  flightForm.elements.nightTakeoffs.value = f ? (f.nightTakeoffs || 0) : 0;
  flightForm.elements.nightLandings.value = f ? (f.nightLandings || 0) : 0;
  flightForm.elements.remarks.value = f ? (f.remarks || "") : "";
  buildCategoryInputs(f ? f.hoursBy : {});

  flightDialog.showModal();
}

flightForm.addEventListener("submit", e => {
  e.preventDefault();
  const el = flightForm.elements;
  const errBox = flightForm.querySelector(".form-error");

  const date = el.date.value;
  const from = el.from.value.trim().toUpperCase();
  const to = el.to.value.trim().toUpperCase();
  const hours = parseFloat(el.hours.value);
  const takeoffs = parseInt(el.takeoffs.value, 10);
  const landings = parseInt(el.landings.value, 10);
  const nightTakeoffs = parseInt(el.nightTakeoffs.value, 10) || 0;
  const nightLandings = parseInt(el.nightLandings.value, 10) || 0;

  const problems = [];
  if (!date) problems.push("date");
  if (!from) problems.push("departure");
  if (!to) problems.push("destination");
  if (!(hours > 0)) problems.push("hours (must be more than 0)");
  if (!(takeoffs >= 0)) problems.push("takeoffs");
  if (!(landings >= 0)) problems.push("landings");
  if (problems.length) {
    errBox.textContent = "Please fill in: " + problems.join(", ") + ".";
    errBox.hidden = false;
    return;
  }
  if (nightTakeoffs > takeoffs || nightLandings > landings || nightTakeoffs < 0 || nightLandings < 0) {
    errBox.textContent = "Night takeoffs/landings can't exceed the flight's total takeoffs/landings.";
    errBox.hidden = false;
    return;
  }

  const roundedHours = Math.round(hours * 10) / 10;
  const hoursBy = {};
  for (const fl of FLAGS) {
    const v = parseFloat(el["cat-" + fl.key].value);
    hoursBy[fl.key] = Number.isFinite(v) && v > 0 ? Math.round(v * 10) / 10 : 0;
    if (hoursBy[fl.key] > roundedHours + 0.001) {
      errBox.textContent = `${fl.label} time (${fmtHours(hoursBy[fl.key])}) can't exceed the flight's total hours (${fmtHours(roundedHours)}).`;
      errBox.hidden = false;
      return;
    }
  }

  const flight = {
    id: editingFlightId || uid(),
    created: editingFlightId
      ? (state.flights.find(x => x.id === editingFlightId)?.created ?? Date.now())
      : Date.now(),
    updated: Date.now(),
    date,
    aircraftId: el.aircraftId.value,
    from, to,
    hours: roundedHours,
    takeoffs, landings, nightTakeoffs, nightLandings, hoursBy,
    remarks: el.remarks.value.trim(),
  };

  if (editingFlightId) {
    state.flights = state.flights.map(x => (x.id === editingFlightId ? flight : x));
  } else {
    state.flights.push(flight);
  }
  saveState();
  flightDialog.close();
  render();
});

// ---------- aircraft dialog ----------

const aircraftDialog = $("#aircraft-dialog");
const aircraftForm = $("#aircraft-form");

function buildTypeCheckboxes(checked = []) {
  $("#aircraft-types").innerHTML = "<legend>Type &amp; equipment</legend>" +
    allTypes().map(t => `
      <label><input type="checkbox" name="type" value="${esc(t)}" ${checked.includes(t) ? "checked" : ""}> ${esc(t)}</label>
    `).join("");
}

function openAircraftDialog(aircraftId = null) {
  editingAircraftId = aircraftId;
  const a = aircraftId ? aircraftById(aircraftId) : null;

  $("#aircraft-dialog-title").textContent = a ? "Edit aircraft" : "New aircraft";
  aircraftForm.querySelector(".form-error").hidden = true;

  aircraftForm.elements.reg.value = a ? a.reg : "";
  aircraftForm.elements.make.value = a ? a.make : "";
  aircraftForm.elements.model.value = a ? a.model : "";
  $("#new-type").value = "";
  buildTypeCheckboxes(a ? a.types : []);

  aircraftDialog.showModal();
}

$("#add-type-btn").addEventListener("click", () => {
  const input = $("#new-type");
  const name = input.value.trim();
  if (!name) return;
  const exists = allTypes().some(t => t.toLowerCase() === name.toLowerCase());
  const checked = [...aircraftForm.querySelectorAll('input[name="type"]:checked')].map(c => c.value);
  if (!exists) {
    state.customTypes.push(name);
    saveState();
  }
  buildTypeCheckboxes([...checked, name]);
  input.value = "";
});

$("#new-type").addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    $("#add-type-btn").click();
  }
});

aircraftForm.addEventListener("submit", e => {
  e.preventDefault();
  const el = aircraftForm.elements;
  const errBox = aircraftForm.querySelector(".form-error");

  const reg = el.reg.value.trim().toUpperCase();
  const make = el.make.value.trim();
  const model = el.model.value.trim();
  if (!reg || !make || !model) {
    errBox.textContent = "Registration, make and model are all required.";
    errBox.hidden = false;
    return;
  }

  const types = [...aircraftForm.querySelectorAll('input[name="type"]:checked')].map(c => c.value);
  const aircraft = { id: editingAircraftId || uid(), reg, make, model, types, updated: Date.now() };
  if (editingAircraftId && aircraftById(editingAircraftId)?.archived) aircraft.archived = true;

  if (editingAircraftId) {
    state.aircraft = state.aircraft.map(x => (x.id === editingAircraftId ? aircraft : x));
  } else {
    state.aircraft.push(aircraft);
  }
  saveState();
  aircraftDialog.close();
  render();
});

// ---------- dialog plumbing ----------

document.querySelectorAll("dialog [data-close]").forEach(btn => {
  btn.addEventListener("click", () => btn.closest("dialog").close());
});
document.querySelectorAll("dialog").forEach(d => {
  d.addEventListener("click", e => {
    if (e.target === d) d.close(); // click on backdrop
  });
});

// ---------- FAB ----------

$("#fab").addEventListener("click", () => {
  if (currentView === "aircraft") openAircraftDialog();
  else openFlightDialog();
});

// ---------- menu / import / export ----------

const menuBtn = $("#menu-btn");
const menuDropdown = $("#menu-dropdown");

menuBtn.addEventListener("click", e => {
  e.stopPropagation();
  const open = menuDropdown.hidden;
  menuDropdown.hidden = !open;
  menuBtn.setAttribute("aria-expanded", String(open));
});
document.addEventListener("click", () => {
  menuDropdown.hidden = true;
  menuBtn.setAttribute("aria-expanded", "false");
});
menuDropdown.addEventListener("click", e => e.stopPropagation());

function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

$("#export-json").addEventListener("click", () => {
  download(`pilotlog-backup-${today()}.json`, JSON.stringify(state, null, 2), "application/json");
  menuDropdown.hidden = true;
});

$("#export-csv").addEventListener("click", () => {
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["Date", "Registration", "Make", "Model", "From", "To", "Hours", "Takeoffs", "Landings",
    "Night Takeoffs", "Night Landings",
    ...FLAGS.map(fl => FLAG_SHORT[fl.key]), "Remarks"];
  const rows = [...sortedFlights()].reverse().map(f => {
    const a = aircraftById(f.aircraftId);
    return [
      f.date, a?.reg ?? "", a?.make ?? "", a?.model ?? "", f.from, f.to,
      f.hours, f.takeoffs, f.landings, f.nightTakeoffs || 0, f.nightLandings || 0,
      ...FLAGS.map(fl => (f.hoursBy[fl.key] > 0 ? f.hoursBy[fl.key] : "")),
      f.remarks ?? "",
    ].map(q).join(",");
  });
  download(`pilotlog-flights-${today()}.csv`, [header.map(q).join(","), ...rows].join("\n"), "text/csv");
  menuDropdown.hidden = true;
});

$("#import-json").addEventListener("click", () => {
  menuDropdown.hidden = true;
  $("#import-file").click();
});

$("#import-file").addEventListener("change", async e => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = normalizeState(JSON.parse(await file.text()));
    if (!data) throw new Error("bad shape");
    const hasData = state.flights.length || state.aircraft.length;
    if (hasData && !confirm(
      `Import "${file.name}" (${data.flights.length} flights, ${data.aircraft.length} aircraft)?\n\nThis REPLACES your current data. Export a backup first if unsure.`)) {
      return;
    }
    state = data;
    saveState();
    render();
    alert("Import complete.");
  } catch {
    alert("That file doesn't look like a PilotLog backup (JSON export).");
  }
});

$("#erase-all").addEventListener("click", () => {
  menuDropdown.hidden = true;
  const note = isSignedIn()
    ? "\n\nNote: sync is on, so your data will be restored from the cloud on the next sync. Sign out of sync first for a true fresh start."
    : "";
  if (!confirm("Erase ALL aircraft and flights on this device? This cannot be undone." + note)) return;
  if (!confirm("Really erase everything? Consider exporting a backup first.")) return;
  state = emptyState();
  saveState();
  render();
});

// ---------- sync core (cloud-agnostic) ----------
//
// Merge logic + UI plumbing. The Firebase module (js/cloud.js, bundled from
// js/cloud-src.mjs) plugs in via window.PilotLogCloud and calls back into
// window.PilotLogCore. Records win by newest `updated` timestamp; deletions
// are tracked as tombstones so they propagate instead of resurrecting.

function isSignedIn() {
  return !!window.PilotLogCloud?.isSignedIn();
}

function mergeTombstones(a = {}, b = {}) {
  const out = { ...a };
  for (const [id, ts] of Object.entries(b)) {
    if (!(out[id] >= ts)) out[id] = ts;
  }
  return out;
}

function mergeRecords(localArr, remoteArr, tombstones) {
  const byId = new Map();
  for (const r of [...remoteArr, ...localArr]) {
    const prev = byId.get(r.id);
    if (!prev || (r.updated || r.created || 0) > (prev.updated || prev.created || 0)) {
      byId.set(r.id, r);
    }
  }
  const out = [];
  for (const r of byId.values()) {
    const ts = tombstones[r.id];
    if (ts && ts >= (r.updated || r.created || 0)) continue; // stays deleted
    if (ts) delete tombstones[r.id]; // edited after deletion elsewhere → record wins
    out.push(r);
  }
  return out;
}

function mergeStates(local, remote) {
  const deleted = {
    aircraft: mergeTombstones(local.deleted.aircraft, remote.deleted.aircraft),
    flights: mergeTombstones(local.deleted.flights, remote.deleted.flights),
  };
  return {
    version: 2,
    aircraft: mergeRecords(local.aircraft, remote.aircraft, deleted.aircraft),
    flights: mergeRecords(local.flights, remote.flights, deleted.flights),
    customTypes: [...new Set([...remote.customTypes, ...local.customTypes])],
    deleted,
  };
}

function schedulePushSync() {
  window.PilotLogCloud?.schedulePush();
}

// --- sync UI ---

const syncDialog = $("#sync-dialog");

function updateSyncIndicator(mode) {
  const btn = $("#sync-btn");
  btn.classList.remove("sync-off", "sync-ok", "sync-busy", "sync-error");
  if (!isSignedIn()) {
    btn.classList.add("sync-off");
    btn.title = "Sync is off — tap to sign in";
  } else if (mode === "busy") {
    btn.classList.add("sync-busy");
    btn.title = "Syncing…";
  } else if (mode === "error") {
    btn.classList.add("sync-error");
    btn.title = "Sync problem — tap for details";
  } else {
    btn.classList.add("sync-ok");
    btn.title = "Synced";
  }
}

function setSyncStatusText(text) {
  $("#sync-status").textContent = text;
}

function refreshSyncDialog() {
  const cloud = window.PilotLogCloud;
  const signedIn = isSignedIn();
  $("#sync-signin").hidden = signedIn;
  $("#sync-signout").hidden = !signedIn;
  $("#sync-account").textContent = !cloud
    ? "Cloud sync isn't available — the sync module failed to load. Check your connection and reload the app."
    : signedIn
      ? "Signed in as " + cloud.userEmail() + ". This device syncs automatically."
      : "Not signed in. Sign in with the same Google account on each device to keep your logbook in sync.";
}

function openSyncDialog() {
  refreshSyncDialog();
  syncDialog.showModal();
}

$("#sync-signin").addEventListener("click", () => window.PilotLogCloud?.signIn());
$("#sync-signout").addEventListener("click", async () => {
  if (!confirm("Sign out of sync on this device? Your logbook stays on this device and in the cloud.")) return;
  await window.PilotLogCloud?.signOutUser();
});

$("#sync-btn").addEventListener("click", () => {
  if (isSignedIn()) window.PilotLogCloud.syncNow();
  else openSyncDialog();
});
$("#sync-now").addEventListener("click", () => {
  menuDropdown.hidden = true;
  if (isSignedIn()) window.PilotLogCloud.syncNow();
  else openSyncDialog();
});
$("#sync-settings").addEventListener("click", () => {
  menuDropdown.hidden = true;
  openSyncDialog();
});

// --- bridge for the cloud module ---

window.PilotLogCore = {
  getState: () => normalizeState(state),
  // Merge a remote snapshot into local state. Applies + renders if anything
  // changed locally; reports whether the merged result still differs from
  // the remote copy (meaning a push is needed).
  mergeRemote(remoteObj) {
    const remote = normalizeState(remoteObj);
    if (!remote) throw new Error("Remote data isn't a PilotLog logbook.");
    const merged = mergeStates(state, remote);
    const mergedJson = JSON.stringify(merged);
    if (mergedJson !== JSON.stringify(state)) {
      state = merged;
      localStorage.setItem(STORAGE_KEY, mergedJson); // save without re-triggering push
      render();
    }
    return { merged, differsFromRemote: mergedJson !== JSON.stringify(remote) };
  },
  updateSyncIndicator,
  setSyncStatusText,
  refreshSyncDialog,
};

// ---------- service worker ----------

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", async () => {
    let reg;
    try {
      reg = await navigator.serviceWorker.register("sw.js");
    } catch {
      return; // offline support unavailable
    }

    const banner = $("#update-banner");
    const showBannerIfWaiting = () => { if (reg.waiting) banner.hidden = false; };

    showBannerIfWaiting();
    reg.addEventListener("updatefound", () => {
      const sw = reg.installing;
      sw?.addEventListener("statechange", () => {
        // "installed" with an existing controller = an update is parked
        // and waiting (a first-ever install has no controller).
        if (sw.state === "installed" && navigator.serviceWorker.controller) {
          banner.hidden = false;
        }
      });
    });

    // Look for updates when the app comes back to the foreground (and
    // hourly while it stays open). Browsers also check on every launch.
    const check = () => reg.update().catch(() => {});
    document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
    setInterval(check, 60 * 60 * 1000);

    $("#update-reload").addEventListener("click", () => {
      reg.waiting?.postMessage("SKIP_WAITING");
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  });
}

// ---------- go ----------

render();
updateSyncIndicator();
