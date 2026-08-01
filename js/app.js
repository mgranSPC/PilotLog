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
  return { ...rest, hoursBy };
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
    state.aircraft.map(a => `<option value="${esc(a.id)}">${esc(a.reg)}</option>`).join("");
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
          <span>${f.takeoffs} T/O &middot; ${f.landings} Ldg</span>
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

  $("#aircraft-list").innerHTML = state.aircraft.map(a => {
    const flights = state.flights.filter(f => f.aircraftId === a.id);
    const hours = flights.reduce((s, f) => s + f.hours, 0);
    const chips = (a.types || []).map(t => `<span class="chip">${esc(t)}</span>`).join("");
    return `
      <div class="card" data-id="${esc(a.id)}">
        <div class="card-top">
          <span class="aircraft-name">${esc(a.reg)} &mdash; ${esc(a.make)} ${esc(a.model)}</span>
          <span class="aircraft-hours">${fmtHours(hours)} h &middot; ${flights.length} flight${flights.length === 1 ? "" : "s"}</span>
        </div>
        ${chips ? `<div class="chips">${chips}</div>` : ""}
        <div class="card-actions">
          <button data-action="edit-aircraft">Edit</button>
          <button data-action="delete-aircraft" class="delete">Delete</button>
        </div>
      </div>`;
  }).join("");
}

$("#aircraft-list").addEventListener("click", e => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id = btn.closest(".card").dataset.id;
  if (btn.dataset.action === "edit-aircraft") openAircraftDialog(id);
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
    byFlag: {},   // key -> {hours, flights}
    byAircraft: {}, // id -> {hours, flights, takeoffs, landings}
    byType: {},   // type -> {hours, flights}
  };
  for (const fl of FLAGS) t.byFlag[fl.key] = { hours: 0, flights: 0 };

  for (const f of flights) {
    t.hours += f.hours;
    t.takeoffs += f.takeoffs;
    t.landings += f.landings;

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

function renderTotals() {
  const periodSel = $("#totals-period");
  const years = [...new Set(state.flights.map(yearOf))].sort().reverse();
  const prev = periodSel.value;
  periodSel.innerHTML = `<option value="">All time</option>` +
    years.map(y => `<option value="${y}">${y}</option>`).join("");
  if (years.includes(prev)) periodSel.value = prev;

  const hasFlights = state.flights.length > 0;
  $("#totals-empty").hidden = hasFlights;

  const period = periodSel.value;
  const flights = period ? state.flights.filter(f => yearOf(f) === period) : state.flights;
  const t = computeTotals(flights);

  // --- stat tiles ---
  $("#stat-row").innerHTML = [
    [fmtHours(t.hours), "Total hours"],
    [t.flights, "Flights"],
    [t.takeoffs, "Takeoffs"],
    [t.landings, "Landings"],
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

  // --- year by year with running total (always all data, oldest first) ---
  const byYear = {};
  for (const f of state.flights) (byYear[yearOf(f)] ||= []).push(f);
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
        <td class="num">${fmtHours(cumul)}</td>
      </tr>`;
  }).join("") || `<tr><td colspan="14">&mdash;</td></tr>`;
}

$("#totals-period").addEventListener("change", renderTotals);

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
  if (!state.aircraft.length) {
    alert("Add an aircraft first (Aircraft tab).");
    switchView("aircraft");
    return;
  }
  editingFlightId = flightId;
  const f = flightId ? state.flights.find(x => x.id === flightId) : null;

  $("#flight-dialog-title").textContent = f ? "Edit flight" : "New flight";
  flightForm.querySelector(".form-error").hidden = true;

  const acSel = flightForm.elements.aircraftId;
  acSel.innerHTML = state.aircraft
    .map(a => `<option value="${esc(a.id)}">${esc(aircraftLabel(a))}</option>`).join("");

  const last = sortedFlights()[0];
  flightForm.elements.date.value = f ? f.date : new Date().toISOString().slice(0, 10);
  acSel.value = f ? f.aircraftId : (last && aircraftById(last.aircraftId) ? last.aircraftId : state.aircraft[0].id);
  flightForm.elements.from.value = f ? f.from : "";
  flightForm.elements.to.value = f ? f.to : "";
  flightForm.elements.hours.value = f ? f.hours : "";
  flightForm.elements.takeoffs.value = f ? f.takeoffs : 1;
  flightForm.elements.landings.value = f ? f.landings : 1;
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
    takeoffs, landings, hoursBy,
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
    ...FLAGS.map(fl => FLAG_SHORT[fl.key]), "Remarks"];
  const rows = [...sortedFlights()].reverse().map(f => {
    const a = aircraftById(f.aircraftId);
    return [
      f.date, a?.reg ?? "", a?.make ?? "", a?.model ?? "", f.from, f.to,
      f.hours, f.takeoffs, f.landings,
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
  const note = getSyncConfig()
    ? "\n\nNote: sync is on, so your data will be restored from the sync repository on the next sync. Turn off sync first for a true fresh start."
    : "";
  if (!confirm("Erase ALL aircraft and flights on this device? This cannot be undone." + note)) return;
  if (!confirm("Really erase everything? Consider exporting a backup first.")) return;
  state = emptyState();
  saveState();
  render();
});

// ---------- sync (GitHub-backed) ----------
//
// The logbook is mirrored to a JSON file in a private GitHub repository via
// the contents API. Each device merges before it writes: records win by
// newest `updated` timestamp, deletions are tracked as tombstones so they
// propagate instead of resurrecting. The token lives only in this device's
// localStorage (separate key, never part of exports/backups).

const SYNC_KEY = "pilotlog-sync-v1";
const API_BASE = "https://api.github.com";

let syncing = false;
let pushTimer = null;
let lastSyncAt = 0;

function getSyncConfig() {
  try {
    const cfg = JSON.parse(localStorage.getItem(SYNC_KEY));
    return cfg && cfg.token && cfg.repo && cfg.path ? cfg : null;
  } catch {
    return null;
  }
}

function setSyncConfig(cfg) {
  if (cfg) localStorage.setItem(SYNC_KEY, JSON.stringify(cfg));
  else localStorage.removeItem(SYNC_KEY);
  updateSyncIndicator();
}

// --- merge ---

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

// --- GitHub contents API ---

function b64encodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function b64decodeUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function ghRequest(cfg, method, body) {
  const url = `${API_BASE}/repos/${cfg.repo}/contents/${encodeURIComponent(cfg.path).replace(/%2F/g, "/")}`;
  const resp = await fetch(url, {
    method,
    headers: {
      "Authorization": `Bearer ${cfg.token}`,
      "Accept": "application/vnd.github+json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return resp;
}

async function fetchRemote(cfg) {
  const resp = await ghRequest(cfg, "GET");
  if (resp.status === 404) return { sha: null, data: null }; // file (or repo) doesn't exist yet
  if (resp.status === 401 || resp.status === 403) throw new Error("GitHub rejected the token. Check that it has Contents read/write access to " + cfg.repo + ".");
  if (!resp.ok) throw new Error("GitHub error " + resp.status + " while reading.");
  const json = await resp.json();
  const data = normalizeState(JSON.parse(b64decodeUtf8(json.content)));
  if (!data) throw new Error("The sync file exists but isn't a PilotLog logbook.");
  return { sha: json.sha, data };
}

async function pushRemote(cfg, sha, data) {
  const body = {
    message: "PilotLog sync",
    content: b64encodeUtf8(JSON.stringify(data)),
  };
  if (sha) body.sha = sha;
  const resp = await ghRequest(cfg, "PUT", body);
  if (resp.status === 404) throw new Error("Repository " + cfg.repo + " not found. Create it (private) and check the token's repository access.");
  if (resp.status === 401 || resp.status === 403) throw new Error("GitHub rejected the token. Check that it has Contents read/write access to " + cfg.repo + ".");
  if (resp.status === 409 || resp.status === 422) return false; // raced another device — caller re-merges
  if (!resp.ok) throw new Error("GitHub error " + resp.status + " while writing.");
  return true;
}

// --- sync driver ---

async function syncNow({ silent = false } = {}) {
  const cfg = getSyncConfig();
  if (!cfg) {
    if (!silent) openSyncDialog();
    return false;
  }
  if (syncing) return false;
  syncing = true;
  updateSyncIndicator("busy");
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { sha, data: remote } = await fetchRemote(cfg);
      const merged = remote ? mergeStates(state, remote) : normalizeState(state);
      const mergedJson = JSON.stringify(merged);

      if (mergedJson !== JSON.stringify(state)) {
        state = merged;
        localStorage.setItem(STORAGE_KEY, mergedJson); // save without re-triggering push
        render();
      }
      if (remote && JSON.stringify(remote) === mergedJson) {
        finishSync(cfg);
        return true; // nothing new to write
      }
      if (await pushRemote(cfg, sha, merged)) {
        finishSync(cfg);
        return true;
      }
      // write conflict: loop to re-fetch and re-merge
    }
    throw new Error("Couldn't sync after several attempts — try again.");
  } catch (err) {
    updateSyncIndicator("error");
    setSyncStatusText("Sync failed: " + (navigator.onLine === false ? "you're offline." : err.message));
    if (!silent) alert("Sync failed: " + (navigator.onLine === false ? "You appear to be offline." : err.message));
    return false;
  } finally {
    syncing = false;
  }
}

function finishSync(cfg) {
  lastSyncAt = Date.now();
  cfg.lastSync = lastSyncAt;
  setSyncConfig(cfg);
  updateSyncIndicator("ok");
  setSyncStatusText("Last synced: " + new Date(lastSyncAt).toLocaleString());
}

function schedulePushSync() {
  if (!getSyncConfig()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => syncNow({ silent: true }), 1500);
}

// --- sync UI ---

const syncDialog = $("#sync-dialog");
const syncForm = $("#sync-form");

function updateSyncIndicator(mode) {
  const btn = $("#sync-btn");
  const cfg = getSyncConfig();
  btn.classList.remove("sync-off", "sync-ok", "sync-busy", "sync-error");
  if (!cfg) {
    btn.classList.add("sync-off");
    btn.title = "Sync is off — tap to set up";
  } else if (mode === "busy") {
    btn.classList.add("sync-busy");
    btn.title = "Syncing…";
  } else if (mode === "error") {
    btn.classList.add("sync-error");
    btn.title = "Sync failed — tap to retry";
  } else {
    btn.classList.add("sync-ok");
    btn.title = "Synced" + (cfg.lastSync ? " " + new Date(cfg.lastSync).toLocaleString() : "");
  }
}

function setSyncStatusText(text) {
  $("#sync-status").textContent = text;
}

function openSyncDialog() {
  const cfg = getSyncConfig();
  syncForm.elements.token.value = cfg?.token || "";
  syncForm.elements.repo.value = cfg?.repo || "";
  syncForm.elements.path.value = cfg?.path || "pilotlog.json";
  $("#sync-disconnect").hidden = !cfg;
  syncForm.querySelector(".form-error").hidden = true;
  setSyncStatusText(cfg?.lastSync ? "Last synced: " + new Date(cfg.lastSync).toLocaleString() : "");
  syncDialog.showModal();
}

syncForm.addEventListener("submit", async e => {
  e.preventDefault();
  const errBox = syncForm.querySelector(".form-error");
  const token = syncForm.elements.token.value.trim();
  const repo = syncForm.elements.repo.value.trim().replace(/^https:\/\/github\.com\//, "").replace(/\/+$/, "");
  const path = syncForm.elements.path.value.trim() || "pilotlog.json";

  if (!token || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    errBox.textContent = "Enter a token and a repository in owner/name form (e.g. yourname/pilotlog-data).";
    errBox.hidden = false;
    return;
  }
  setSyncConfig({ token, repo, path });
  setSyncStatusText("Connecting…");
  errBox.hidden = true;
  const ok = await syncNow({ silent: true });
  if (ok) {
    syncDialog.close();
  } else {
    errBox.textContent = $("#sync-status").textContent;
    errBox.hidden = false;
  }
});

$("#sync-disconnect").addEventListener("click", () => {
  if (!confirm("Turn off sync on this device? Your data stays on this device and in the repository; the token is removed from this device.")) return;
  setSyncConfig(null);
  setSyncStatusText("");
  syncDialog.close();
});

$("#sync-btn").addEventListener("click", () => {
  if (getSyncConfig()) syncNow();
  else openSyncDialog();
});
$("#sync-now").addEventListener("click", () => {
  menuDropdown.hidden = true;
  syncNow();
});
$("#sync-settings").addEventListener("click", () => {
  menuDropdown.hidden = true;
  openSyncDialog();
});

// pull fresh data when the app comes back to the foreground
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && getSyncConfig() && Date.now() - lastSyncAt > 60_000) {
    syncNow({ silent: true });
  }
});

// ---------- service worker ----------

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => { /* offline support unavailable */ });
  });
}

// ---------- go ----------

render();
updateSyncIndicator();
if (getSyncConfig()) syncNow({ silent: true });
