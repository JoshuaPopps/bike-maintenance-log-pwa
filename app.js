/* Bike Maintenance Log PWA — phone face for the bike-maintenance-log CLI.
 *
 * No build step, no dependencies, no account, no server. Data lives in
 * this device's localStorage and moves as one plain JSON file.
 *
 * The data model is deliberately identical to the CLI's data.json:
 *   { bikes: {...}, tasks: {...}, entries: [...] }
 * so a logbook exported here imports straight into the CLI (and back).
 * Field keys (odometer, every_miles, every_months, baseline_odo, ...)
 * match the CLI exactly.
 *
 * Spec rule: the app ships factory service schedules ONLY where they
 * are sourced from a published manual — right now, the 1984–1999 Evo
 * Softail schedule from FSM #99482-98 and the 1986–2003 Sportster
 * schedule from FSM #99484-98 (see FACTORY_SCHEDULES; every
 * filled-in task names its source). Models without a sourced schedule
 * get no auto-fill at all, and the example logbook's intervals are
 * placeholders, clearly labelled as such, never presented as factory
 * specs. Auto-filled tasks are plain tasks with a source note, so the
 * CLI data model is untouched and the JSON trades back and forth the
 * same as ever.
 */
'use strict';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */
var STORAGE_KEY = 'bike-maintenance-log-v1';
var SOON_MILES = 500;   /* "due soon" warning window, miles — same as CLI */
var SOON_DAYS = 30;     /* "due soon" warning window, days — same as CLI */
var QUICK_TASKS = [
  'Engine oil', 'Primary fluid', 'Transmission fluid', 'Spark plugs',
  'Tires', 'Brake fluid', 'Drive belt', 'Air filter', 'Battery',
  'Coolant', 'Fork oil', 'Clutch adjustment'
];

/* Common production bikes, by brand, grouped by family — so adding a
 * bike is a pick, not typing. Model names only: no years, no trims
 * invented, no specs attached. Anything not listed is still a free
 * text entry in the form. */
var COMMON_BIKES = [
  { brand: 'Harley-Davidson', families: [
    { family: 'Sportster', models: ['883', '883 Custom', '883 Deluxe', '883 Hugger', '1100', '1200', '1200 Custom', '1200 Sport', 'Iron 883', 'Forty-Eight', 'Roadster', 'SuperLow', 'Custom 1200', 'Nightster', 'Sportster S'] },
    { family: 'Softail', models: ['Standard', 'Street Bob', 'Fat Bob', 'Fat Boy', 'Heritage Classic', 'Low Rider S', 'Low Rider ST', 'Breakout'] },
    { family: 'Dyna', models: ['Street Bob', 'Low Rider', 'Wide Glide', 'Super Glide', 'Fat Bob'] },
    { family: 'Touring', models: ['Street Glide', 'Road Glide', 'Road King', 'Electra Glide Classic', 'Ultra Limited'] },
    { family: 'Adventure & electric', models: ['Pan America 1250', 'LiveWire'] }
  ] },
  { brand: 'Triumph', families: [
    { family: 'Bonneville', models: ['T100', 'T120', 'Street Twin', 'Speed Twin', 'Bobber', 'Speedmaster', 'Thruxton'] },
    { family: 'Tiger', models: ['Tiger 900', 'Tiger 1200', 'Tiger Sport 660'] },
    { family: 'Triple', models: ['Street Triple', 'Speed Triple 1200'] },
    { family: 'Scrambler', models: ['Scrambler 900', 'Scrambler 1200'] },
    { family: 'Other', models: ['Trident 660', 'Rocket 3', 'Daytona 660'] }
  ] },
  { brand: 'Honda', families: [
    { family: 'CB', models: ['CB500F', 'CB650R', 'CB1000R', 'CB1100'] },
    { family: 'CBR', models: ['CBR500R', 'CBR600RR', 'CBR1000RR Fireblade'] },
    { family: 'Gold Wing', models: ['Gold Wing', 'Gold Wing Tour'] },
    { family: 'Africa Twin', models: ['Africa Twin', 'Africa Twin Adventure Sports'] },
    { family: 'Rebel', models: ['Rebel 300', 'Rebel 500', 'Rebel 1100'] },
    { family: 'Other', models: ['Grom', 'Monkey', 'NC750X'] }
  ] },
  { brand: 'Suzuki', families: [
    { family: 'GSX-R', models: ['GSX-R600', 'GSX-R750', 'GSX-R1000'] },
    { family: 'GSX-S', models: ['GSX-S750', 'GSX-S1000', 'Katana'] },
    { family: 'V-Strom', models: ['V-Strom 650', 'V-Strom 1050'] },
    { family: 'Boulevard', models: ['Boulevard M109R', 'Boulevard C50'] },
    { family: 'Other', models: ['SV650', 'DR650S', 'DR-Z400S'] }
  ] },
  { brand: 'Kawasaki', families: [
    { family: 'Ninja', models: ['Ninja 400', 'Ninja 650', 'Ninja ZX-6R', 'Ninja ZX-10R'] },
    { family: 'Z', models: ['Z400', 'Z650', 'Z900', 'Z H2'] },
    { family: 'Vulcan', models: ['Vulcan S', 'Vulcan 900', 'Vulcan 1700 Vaquero'] },
    { family: 'Versys', models: ['Versys 650', 'Versys 1000'] },
    { family: 'Other', models: ['KLR650', 'W800'] }
  ] },
  { brand: 'Yamaha', families: [
    { family: 'MT', models: ['MT-03', 'MT-07', 'MT-09', 'MT-10'] },
    { family: 'YZF-R', models: ['YZF-R3', 'YZF-R6', 'YZF-R7', 'YZF-R1'] },
    { family: 'Other', models: ['FJR1300', 'Bolt', 'Bolt R-Spec', 'Tracer 9 GT', 'Ténéré 700', 'XSR700', 'XSR900', 'V Star 650', 'V Star 1300'] }
  ] }
];

function commonBrands() {
  return COMMON_BIKES.map(function (b) { return b.brand; });
}

/* Flat list of { family, model } for one brand, in catalog order. */
function commonModels(brand) {
  var out = [];
  COMMON_BIKES.forEach(function (b) {
    if (b.brand !== brand) return;
    b.families.forEach(function (f) {
      f.models.forEach(function (m) { out.push({ family: f.family, model: m }); });
    });
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Factory schedules (sourced only — never invented)                   */
/* ------------------------------------------------------------------ */

/* Factory service schedules, one entry per platform. Intervals come
 * ONLY from the published manual named in `source` — the first
 * service at 500 mi, then the listed miles interval, per FSM
 * #99482-98 §1 "Service Intervals". The schedule is miles-only: the
 * manual gives no months interval for these jobs, so every_months
 * stays empty and the miles leg drives the due date.
 *
 * Scope is deliberately narrow: the manuals on the shelf cover the
 * 1984–1999 Evo Softails (FLSTC, FLSTF, FLSTS, FXSTC, FXSTS,
 * FXSTSB, FXST) and the 1986–2003 Sportsters (XL/XLH 883, 1100,
 * 1200). Of the picker's Softail names, Fat Boy (FLSTF) and
 * Heritage Classic (FLSTC) are named in #99482-98 itself; Standard
 * (FXST) is the base model of the same platform, covered by the
 * 1984–99 Softail Repair Manual's maintenance schedule (Table 2) —
 * same 5,000 / 10,000 / 20,000 mi pattern, corroborated in the
 * repair manual text (wheel bearings and spark plugs at 10,000 mi).
 * Springer models are not in the picker, so the springer-only items
 * (rocker bearings, greasing the steering head at every interval)
 * are not in this schedule. Dealer-inspection-only lines from the
 * manual's table (engine mounts, fasteners, road test, …) are left
 * out on purpose — auto-fill is the owner-serviceable jobs; anything
 * else the user adds by hand.
 *
 * The Sportster entry comes from the factory 1998 XLH Service
 * Manual #99484-98 §1, "Regular Maintenance Intervals — XLH
 * Sportster Models" (p.1-2), corroborated line-for-line by the
 * 1986–2003 Sportster Service Manual (Clymer) Ch. 3, Table 1,
 * which is what carries the 1986–2003 year range — the factory
 * manual itself is the 1998 book. Where the Sportster table and
 * the Softail table disagree, the Sportster task's note says so in
 * plain words ("SPORTSTER value … the Softail schedule says …"),
 * so a Sportster number is never mistaken for a Softail one. The
 * Sportster first service is 500 mi in the factory table (Clymer
 * says an initial 1,000 mi — noted, not resolved here; the
 * repeating interval is what the clock uses). Four rows carry the
 * factory footnote "*Also perform prior to storage or annually"
 * (engine oil, brake fluid, wheel bearings, rear fork bearings):
 * the schedule stays miles-only like the Softail one — the manual
 * gives no months leg for these jobs as a schedule — and the
 * footnote is printed in the task note instead. Checked Nov 25,
 * 2026 against both manuals: neither table has a months column
 * and neither prints "12 months" anywhere (softail-97-98 §1,
 * pp.1-38–1-48; softail-84-99 Ch. 3 Table 2, p.122). The footnote
 * is a "prior to storage OR annually" trigger, not a repeating
 * 12-month interval from the last service — and on the Softail
 * table the starred set is SIX rows (engine oil, engine oil
 * filter, transmission lubricant, wheel bearings, front fork oil,
 * brake fluid), not four; rear fork bearings is starred only on
 * the Sportster table. Turning "annually" into every_months: 12
 * would be an interpretation, not a published interval, so it is
 * NOT wired — it needs Joshua's call.
 *
 * One Clymer-only line lives here too: the chain-drive Sportster
 * "Drive chain lubrication" task (every 300 mi) comes from the
 * 1986–2003 Sportster Service Manual (Clymer) Ch. 3, Table 1 —
 * NOT from the Evo Clymer manual, which has no chain-lube
 * interval at all (its Table 1 lists only chain tension checks).
 * It carries a per-task `years: [1986, 1990]` scope — the all-
 * chain-drive years — so applyFactorySchedule and wearClocks
 * skip it for belt-drive bikes. 1991–92 Sportsters came both
 * ways (chain and belt); the manual gives no clean model split,
 * so a 1991–92 chain-drive bike adds this task by hand — the
 * note says so. A task with no `years` applies to the whole
 * schedule range, as before.
 *
 * Every task's `notes` names its source, so the filled-in list shows
 * where each interval came from in the UI. A model with no entry
 * here gets NO auto-fill — never an invented interval. */
var FACTORY_SCHEDULES = [
  {
    make: 'Harley-Davidson',
    models: ['Fat Boy', 'Heritage Classic', 'Standard'],
    years: [1984, 1999],
    label: 'Evo Softail (1984–1999)',
    shortSource: 'FSM #99482-98',
    source: 'Harley-Davidson Softail FSM #99482-98 (1997–98), Service Intervals §1; corroborated by the 1984–99 Softail Repair Manual',
    tasks: [
      { name: 'Engine oil', every_miles: 5000, notes: 'Factory schedule — FSM #99482-98: replace engine oil + filter every 5,000 mi.' },
      { name: 'Primary fluid', every_miles: 5000, notes: 'Factory schedule — FSM #99482-98: replace primary chaincase lubricant every 5,000 mi.' },
      { name: 'Transmission fluid', every_miles: 5000, notes: 'Factory schedule — FSM #99482-98: replace transmission lubricant every 5,000 mi.' },
      { name: 'Clutch adjustment', every_miles: 5000, notes: 'Factory schedule — FSM #99482-98: check/adjust every 5,000 mi.' },
      { name: 'Drive belt', every_miles: 5000, notes: 'Factory schedule — FSM #99482-98: inspect every 5,000 mi (deflection 3/8–1/2 in).' },
      { name: 'Brake fluid', every_miles: 5000, notes: 'Factory schedule — FSM #99482-98: inspect level/condition every 5,000 mi (DOT 5 only).' },
      { name: 'Tires', every_miles: 5000, notes: 'Factory schedule — FSM #99482-98: inspect every 5,000 mi.' },
      { name: 'Air filter', every_miles: 5000, notes: 'Factory schedule — FSM #99482-98: inspect air cleaner every 5,000 mi.' },
      { name: 'Battery', every_miles: 5000, notes: 'Factory schedule — FSM #99482-98: inspect every 5,000 mi.' },
      { name: 'Primary chain', every_miles: 5000, notes: 'Factory schedule — FSM #99482-98: inspect/adjust every 5,000 mi.' },
      { name: 'Fork oil', every_miles: 10000, notes: 'Factory schedule — FSM #99482-98: replace every 10,000 mi (hydraulic forks).' },
      { name: 'Wheel bearings', every_miles: 10000, notes: 'Factory schedule — FSM #99482-98: remove, inspect, repack every 10,000 mi.' },
      { name: 'Fuel tank filter', every_miles: 10000, notes: 'Factory schedule — FSM #99482-98: replace every 10,000 mi.' },
      { name: 'Throttle cables', every_miles: 10000, notes: 'Factory schedule — FSM #99482-98: lubricate every 10,000 mi.' },
      { name: 'Spark plugs', every_miles: 20000, notes: 'Factory schedule — FSM #99482-98: replace every 20,000 mi (inspect at 10,000).' },
      { name: 'Steering head bearings', every_miles: 20000, notes: 'Factory schedule — FSM #99482-98: remove, inspect, repack every 20,000 mi.' }
    ]
  },
  {
    make: 'Harley-Davidson',
    models: ['883', '883 Custom', '883 Deluxe', '883 Hugger', '1100', '1200', '1200 Custom', '1200 Sport'],
    years: [1986, 2003],
    label: 'Sportster XL/XLH (1986–2003)',
    shortSource: 'FSM #99484-98',
    source: 'Harley-Davidson Sportster FSM #99484-98 (1998), Regular Maintenance Intervals §1 (p.1-2); corroborated by the 1986–2003 Sportster Service Manual (Clymer) Ch. 3, Table 1',
    tasks: [
      { name: 'Engine oil', every_miles: 5000, notes: 'Factory schedule — Sportster FSM #99484-98 §1: replace engine oil + filter every 5,000 mi (first service 500 mi). *Also perform prior to storage or annually.' },
      { name: 'Primary / transmission fluid', every_miles: 5000, notes: 'Factory schedule — Sportster FSM #99484-98 §1: replace primary chaincase/transmission lubricant every 5,000 mi (first service 500 mi). A Sportster runs one shared sump — this is ONE job, not the Softail\'s two separate fluids.' },
      { name: 'Primary chain', every_miles: 5000, notes: 'Factory schedule — Sportster FSM #99484-98 §1: inspect primary chain every 5,000 mi (Clymer Table 1: inspect + check tension, every 5,000 mi).' },
      { name: 'Clutch adjustment', every_miles: 5000, notes: 'Factory schedule — Sportster FSM #99484-98 §1: adjust every 5,000 mi (first service 500 mi).' },
      { name: 'Drive belt', every_miles: 5000, notes: 'Factory schedule — Sportster FSM #99484-98 §1: inspect every 5,000 mi (first inspect 2,500 mi; adjust at the 500-mi first service).' },
      { name: 'Drive chain lubrication', every_miles: 300, years: [1986, 1990], notes: 'Clymer — SPORTSTER value, chain-drive models ONLY: 1986–2003 Sportster Service Manual (Clymer) Ch. 3, Table 1: lubricate drive chain every 300 mi (480 km) (models so equipped). Belt-drive Sportsters (1991-on) have no drive chain — do not use this task on a belt-drive bike. 1991–92 came both chain and belt; a 1991–92 chain-drive bike adds this task by hand.' },
      { name: 'Brake fluid', every_miles: 5000, notes: 'Factory schedule — Sportster FSM #99484-98 §1: inspect level/condition every 5,000 mi (first 2,500 mi; DOT 5 only). *Also perform prior to storage or annually.' },
      { name: 'Tires', every_miles: 2500, notes: 'Factory schedule — SPORTSTER value: FSM #99484-98 §1: inspect tire pressure and wear/damage every 2,500 mi (and pre-ride). The Softail schedule says 5,000 mi — do not use the Softail number on a Sportster. Replace on condition/wear, not on mileage.' },
      { name: 'Air filter', every_miles: 5000, notes: 'Factory schedule — Sportster FSM #99484-98 §1: inspect air cleaner every 5,000 mi (first 2,500 mi; Clymer Table 1: inspect and clean, every 5,000 mi).' },
      { name: 'Battery', every_miles: 5000, notes: 'Factory schedule — Sportster FSM #99484-98 §1: tighten battery connections every 5,000 mi. Clymer Table 1: check fluid level every 2,500 mi.' },
      { name: 'Fork oil', every_miles: 10000, notes: 'Factory schedule — Sportster FSM #99484-98 §1: replace front fork oil every 10,000 mi.' },
      { name: 'Wheel bearings', every_miles: 10000, notes: 'Factory schedule — Sportster FSM #99484-98 §1: inspect/lubricate wheel bearings every 10,000 mi. *Also perform prior to storage or annually.' },
      { name: 'Fuel tank filter screen', every_miles: 5000, notes: 'Factory schedule — Sportster FSM #99484-98 §1: inspect fuel tank filter screen every 5,000 mi. This is a screen inspection, NOT the Softail\'s 10,000-mi filter replacement.' },
      { name: 'Throttle cables', every_miles: 5000, notes: 'Factory schedule — SPORTSTER value: FSM #99484-98 §1: lubricate throttle/clutch cables and throttle control sleeve every 5,000 mi. The Softail schedule says 10,000 mi — do not use the Softail number on a Sportster.' },
      { name: 'Spark plugs', every_miles: 10000, notes: 'Factory schedule — SPORTSTER value: FSM #99484-98 §1: inspect at 5,000 mi, replace every 10,000 mi. The Softail schedule says replace at 20,000 mi — do not use the Softail number on a Sportster.' },
      { name: 'Steering head bearing adjustment', every_miles: 5000, notes: 'Factory schedule — SPORTSTER value: FSM #99484-98 §1: front fork bearing adjustment — inspect at 2,500 mi, inspect/lubricate every 5,000 mi. NOT the Softail 20,000-mi remove/inspect/repack.' },
      { name: 'Brake pads', every_miles: 2500, notes: 'Factory schedule — Sportster FSM #99484-98 §1: inspect brake pad linings and discs for wear every 2,500 mi (Clymer Table 1 agrees). Minimum pad thickness 0.062 in. (Clymer Table 7). Replace on wear, not on mileage.' },
      { name: 'Rear fork bearings', every_miles: 5000, notes: 'Factory schedule — Sportster FSM #99484-98 §1: inspect at 2,500 mi, inspect/lubricate rear fork (swing arm) bearings every 5,000 mi. *Also perform prior to storage or annually.' },
      { name: 'Jiffy stand', every_miles: 5000, notes: 'Factory schedule — Sportster FSM #99484-98 §1: lubricate jiffy stand every 5,000 mi.' }
    ]
  }
];

/* The schedule for a make/model regardless of year (picker hint). */
function factoryScheduleModel(make, model) {
  var m = String(make || '').trim().toLowerCase();
  var mo = String(model || '').trim().toLowerCase();
  for (var i = 0; i < FACTORY_SCHEDULES.length; i++) {
    var s = FACTORY_SCHEDULES[i];
    if (m !== s.make.toLowerCase()) continue;
    var hit = false;
    s.models.forEach(function (name) { if (name.toLowerCase() === mo) hit = true; });
    if (hit) return s;
  }
  return null;
}

/* The schedule for a make/model/year — null when the year is missing,
 * out of the covered range, or the model has no sourced schedule. */
function factoryScheduleFor(make, model, year) {
  var y = year == null || year === '' ? null : Number(year);
  if (y == null || isNaN(y)) return null;
  var s = factoryScheduleModel(make, model);
  if (!s) return null;
  if (y < s.years[0] || y > s.years[1]) return null;
  return s;
}

/* True when a schedule task applies to a bike of this year. A task
 * with no `years` applies to the whole schedule range; a task with
 * `years: [lo, hi]` applies only inside it (the chain-drive
 * Sportster chain-lube task, 1986–1990 only). */
function scheduleTaskApplies(st, year) {
  if (!st.years) return true;
  var y = Number(year);
  if (isNaN(y)) return false;
  return y >= st.years[0] && y <= st.years[1];
}

/* Fill a bike's task list from its factory schedule. Adds only tasks
 * the bike does not already have (matched by name, case-insensitive)
 * — a task the user set keeps its own interval and notes, and
 * re-running adds nothing. Returns { added, skipped, schedule }. */
function applyFactorySchedule(store, bikeId) {
  var b = store.bikes[bikeId];
  if (!b) throw new Error('Bike not found.');
  var sched = factoryScheduleFor(b.make, b.model, b.year);
  if (!sched) return { added: 0, skipped: 0, schedule: null };
  var added = 0, skipped = 0;
  sched.tasks.forEach(function (st) {
    if (!scheduleTaskApplies(st, b.year)) return; /* year-scoped task: not this bike */
    var exists = Object.keys(store.tasks).some(function (id) {
      var t = store.tasks[id];
      return t.bike_id === bikeId && t.name.toLowerCase() === st.name.toLowerCase();
    });
    if (exists) { skipped++; return; }
    addTask(store, {
      bike_id: bikeId, name: st.name,
      every_miles: st.every_miles, every_months: '',
      notes: st.notes
    });
    added++;
  });
  return { added: added, skipped: skipped, schedule: sched };
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */
var _memFallback = null;

function _storage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch (e) { /* private mode / non-browser: fall through */ }
  if (!_memFallback) {
    _memFallback = {
      _d: {},
      getItem: function (k) { return this._d[k] || null; },
      setItem: function (k, v) { this._d[k] = String(v); },
      removeItem: function (k) { delete this._d[k]; }
    };
  }
  return _memFallback;
}

function emptyStore() {
  return { bikes: {}, tasks: {}, entries: [], expenses: [], rides: [] };
}

function loadStore() {
  var raw = _storage().getItem(STORAGE_KEY);
  if (!raw) return emptyStore();
  try {
    var data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return emptyStore();
    data.bikes = data.bikes || {};
    data.tasks = data.tasks || {};
    /* Logbooks saved before tire dates existed have no `tire_made`
     * key on their bikes — that means "no date entered", never an
     * error. */
    Object.keys(data.bikes).forEach(function (id) {
      var b = data.bikes[id];
      if (b && typeof b === 'object' && !('tire_made' in b)) b.tire_made = null;
    });
    data.entries = Array.isArray(data.entries) ? data.entries : [];
    /* Logbooks saved before expenses existed have no key at all. */
    data.expenses = Array.isArray(data.expenses) ? data.expenses : [];
    /* Logbooks saved before rides existed have no key at all. */
    data.rides = Array.isArray(data.rides) ? data.rides : [];
    /* Expenses saved before receipt photos existed have no `photo`
     * key — that means "no photo", never an error. */
    data.expenses.forEach(function (x) {
      if (!x || typeof x !== 'object') return;
      if (!('photo' in x)) x.photo = null;
    });
    return data;
  } catch (e) {
    return emptyStore();
  }
}

function saveStore(store) {
  _storage().setItem(STORAGE_KEY, JSON.stringify(store));
}

function uid(prefix, existing) {
  var n = 1, id;
  do { id = prefix + n; n++; } while (existing && existing[id]);
  return id;
}

/* Next id from the highest numeric suffix in use — same rule as the
 * CLI, so the two stay in lockstep (an id freed by a delete can be
 * reused; entries are never referenced from anywhere else). */
function nextEntryId(entries) {
  var max = 0;
  entries.forEach(function (e) {
    var m = /^e(\d+)$/.exec(e.id || '');
    if (m && parseInt(m[1], 10) > max) max = parseInt(m[1], 10);
  });
  return 'e' + (max + 1);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ------------------------------------------------------------------ */
/* Dates and formatting (local calendar dates, YYYY-MM-DD)            */
/* ------------------------------------------------------------------ */
function todayISO() {
  var d = new Date();
  return fmtISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function fmtISO(y, m, d) {
  return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
}

function parseISO(iso) {
  var parts = String(iso).split('-');
  return { y: parseInt(parts[0], 10), m: parseInt(parts[1], 10), d: parseInt(parts[2], 10) };
}

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/* Add whole months, clamping the day (Jan 31 + 1 mo -> Feb 28). */
function addMonths(dateISO, months) {
  var p = parseISO(dateISO);
  var total = (p.m - 1) + months;
  var y = p.y + Math.floor(total / 12);
  var m = (((total % 12) + 12) % 12) + 1; /* JS % keeps the sign */
  var d = Math.min(p.d, daysInMonth(y, m));
  return fmtISO(y, m, d);
}

function daysBetween(startISO, endISO) {
  var a = parseISO(startISO), b = parseISO(endISO);
  var ms = Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
  return Math.round(ms / 86400000);
}

function fmtDate(dateISO) {
  if (!dateISO) return '';
  var p = parseISO(dateISO);
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[p.m - 1] + ' ' + p.d + ', ' + p.y;
}

function fmtMiles(miles) {
  var n = Number(miles);
  if (isNaN(n)) return '0 mi';
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' mi';
}

/* Ride miles keep one decimal — a 12.5-mile loop is not 13 miles.
 * Whole miles still print without a trailing ".0". */
function fmtRideMiles(miles) {
  var n = Number(miles);
  if (isNaN(n)) return '0 mi';
  return n.toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' mi';
}

function fmtMoney(cost) {
  if (cost == null) return '';
  return '$' + Number(cost).toFixed(2);
}

function intervalLabel(t) {
  var parts = [];
  if (t.every_miles) parts.push('every ' + Number(t.every_miles).toLocaleString('en-US') + ' mi');
  if (t.every_months) parts.push('every ' + t.every_months + ' mo');
  return parts.join(' / ');
}

/* ------------------------------------------------------------------ */
/* Core logbook logic (pure over the store — this is what gets tested) */
/* ------------------------------------------------------------------ */
function addBike(store, fields) {
  if (!fields.name || !fields.name.trim()) throw new Error('Bike name is required.');
  var name = fields.name.trim();
  var clash = Object.keys(store.bikes).some(function (id) {
    return store.bikes[id].name.toLowerCase() === name.toLowerCase();
  });
  if (clash) throw new Error('A bike named "' + name + '" already exists.');
  var odo = fields.odometer === '' || fields.odometer == null
    ? 0 : Number(fields.odometer);
  if (isNaN(odo) || odo < 0) throw new Error('Odometer must be zero or more.');
  var id = uid('b', store.bikes);
  store.bikes[id] = {
    name: name,
    year: fields.year ? parseInt(fields.year, 10) || null : null,
    make: fields.make || '',
    model: fields.model || '',
    notes: fields.notes || '',
    odometer: odo,
    odometer_date: todayISO(),
    /* Tire manufacture date (YYYY-MM-DD) for the tire-age clock —
     * one date per bike; null until the user enters one. Old
     * logbooks have no key at all, which loadStore normalises to
     * null. Deleting the bike deletes this date with it. */
    tire_made: fields.tire_made || null,
    /* Pocket Garage handoff pin: the shared roster key (b1/b2/b3)
     * this bike was confirmed as. Null until a confirmed handoff
     * pins it — never set by a name match alone. */
    rosterKey: fields.rosterKey || null
  };
  return store.bikes[id];
}

function removeBike(store, bikeId) {
  if (!store.bikes[bikeId]) throw new Error('Bike not found.');
  /* The tire manufacture date lives on the bike object, so it goes
   * with the bike — no separate cleanup. */
  delete store.bikes[bikeId];
  Object.keys(store.tasks).forEach(function (tid) {
    if (store.tasks[tid].bike_id === bikeId) delete store.tasks[tid];
  });
  store.entries = store.entries.filter(function (e) { return e.bike_id !== bikeId; });
  store.expenses = (store.expenses || []).filter(function (x) { return x.bike_id !== bikeId; });
  store.rides = (store.rides || []).filter(function (r) { return r.bike_id !== bikeId; });
}

/* Returns { warned: true } when the new reading is lower than recorded
 * (odometer swap?) — recorded anyway, never rewound silently. */
function setOdometer(store, bikeId, miles, date) {
  var b = store.bikes[bikeId];
  if (!b) throw new Error('Bike not found.');
  var m = Number(miles);
  if (isNaN(m) || m < 0) throw new Error('Odometer must be zero or more.');
  var warned = m < b.odometer;
  b.odometer = m;
  b.odometer_date = date || todayISO();
  return { warned: warned };
}

function addTask(store, fields) {
  var b = store.bikes[fields.bike_id];
  if (!b) throw new Error('Pick a bike first.');
  if (!fields.name || !fields.name.trim()) throw new Error('Task name is required.');
  var name = fields.name.trim();
  var clash = Object.keys(store.tasks).some(function (id) {
    var t = store.tasks[id];
    return t.bike_id === fields.bike_id && t.name.toLowerCase() === name.toLowerCase();
  });
  if (clash) throw new Error('Task "' + name + '" already exists on this bike.');
  var everyMiles = fields.every_miles === '' || fields.every_miles == null
    ? null : Number(fields.every_miles);
  var everyMonths = fields.every_months === '' || fields.every_months == null
    ? null : Number(fields.every_months);
  if (everyMiles != null && (isNaN(everyMiles) || everyMiles <= 0))
    throw new Error('Miles interval must be positive.');
  if (everyMonths != null && (isNaN(everyMonths) || everyMonths <= 0))
    throw new Error('Months interval must be positive.');
  if (everyMiles == null && everyMonths == null)
    throw new Error('Give at least one interval — miles or months.');
  var id = uid('t', store.tasks);
  store.tasks[id] = {
    bike_id: fields.bike_id,
    name: name,
    every_miles: everyMiles,
    every_months: everyMonths,
    notes: fields.notes || '',
    baseline_odo: b.odometer,
    baseline_date: todayISO()
  };
  return store.tasks[id];
}

function removeTask(store, taskId) {
  if (!store.tasks[taskId]) throw new Error('Task not found.');
  delete store.tasks[taskId];
  store.entries = store.entries.filter(function (e) { return e.task_id !== taskId; });
}

function lastService(store, taskId) {
  var matches = store.entries.filter(function (e) { return e.task_id === taskId; });
  if (!matches.length) return null;
  matches.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.odometer - b.odometer;
  });
  return matches[matches.length - 1];
}

/* Status of one task, mirroring the CLI exactly: last service if any,
 * else the task-creation baseline; worst leg (miles vs months) wins. */
function taskStatus(store, bikeId, taskId, asOf) {
  var t = store.tasks[taskId];
  var b = store.bikes[bikeId];
  if (!t || !b) throw new Error('Task or bike not found.');
  asOf = asOf || todayISO();
  var entry = lastService(store, taskId);
  var baseOdo, baseDate, baseLabel;
  if (entry) {
    baseOdo = entry.odometer;
    baseDate = entry.date;
    baseLabel = 'last done ' + fmtDate(baseDate) + ' @ ' + fmtMiles(baseOdo);
  } else {
    baseOdo = t.baseline_odo || 0;
    baseDate = t.baseline_date || asOf;
    baseLabel = 'not logged yet — counting from task creation';
  }
  var legs = [];
  if (t.every_miles) {
    var dueOdo = baseOdo + t.every_miles;
    var left = dueOdo - b.odometer;
    /* The "due soon" window is capped at half the interval: a fixed
     * 500-mi window is wider than a 300-mi interval (chain lube),
     * so that clock could never read ok. Intervals of 1,000 mi or
     * more keep the plain 500-mi window, as before. */
    var soonMiles = Math.min(SOON_MILES, Math.floor(t.every_miles / 2));
    if (left <= 0) legs.push({ status: 'overdue', text: fmtMiles(-left) + ' overdue' });
    else if (left <= soonMiles) legs.push({ status: 'due-soon', text: 'due in ' + fmtMiles(left) });
    else legs.push({ status: 'ok', text: 'due in ' + fmtMiles(left) + ' (@ ' + fmtMiles(dueOdo) + ')' });
  }
  if (t.every_months) {
    var dueDate = addMonths(baseDate, t.every_months);
    var daysLeft = daysBetween(asOf, dueDate);
    if (daysLeft < 0) legs.push({ status: 'overdue', text: (-daysLeft) + ' days overdue (was ' + fmtDate(dueDate) + ')' });
    else if (daysLeft <= SOON_DAYS) legs.push({ status: 'due-soon', text: 'due in ' + daysLeft + ' days (' + fmtDate(dueDate) + ')' });
    else legs.push({ status: 'ok', text: 'due ' + fmtDate(dueDate) + ' (' + daysLeft + ' days)' });
  }
  var order = { 'overdue': 0, 'due-soon': 1, 'ok': 2 };
  var worst = 'ok';
  legs.forEach(function (leg) {
    if (order[leg.status] < order[worst]) worst = leg.status;
  });
  return {
    status: worst,
    details: [baseLabel].concat(legs.map(function (leg) { return leg.text; }))
  };
}

function tasksForBike(store, bikeId) {
  return Object.keys(store.tasks)
    .filter(function (tid) { return store.tasks[tid].bike_id === bikeId; })
    .sort(function (a, b) {
      return store.tasks[a].name.localeCompare(store.tasks[b].name);
    });
}

/* Due rows for one bike (or all bikes when bikeId is null), worst first. */
function dueRows(store, bikeId, asOf) {
  asOf = asOf || todayISO();
  var order = { 'overdue': 0, 'due-soon': 1, 'ok': 2 };
  var bikeIds = bikeId ? [bikeId]
    : Object.keys(store.bikes).sort(function (a, b) {
        return store.bikes[a].name.localeCompare(store.bikes[b].name);
      });
  var rows = [];
  bikeIds.forEach(function (bid) {
    if (!store.bikes[bid]) return;
    tasksForBike(store, bid).forEach(function (tid) {
      var st = taskStatus(store, bid, tid, asOf);
      rows.push({ bike_id: bid, task_id: tid, status: st.status, details: st.details });
    });
  });
  rows.sort(function (a, b) {
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    var byBike = store.bikes[a.bike_id].name.localeCompare(store.bikes[b.bike_id].name);
    if (byBike) return byBike;
    return store.tasks[a.task_id].name.localeCompare(store.tasks[b.task_id].name);
  });
  return rows;
}

/* Due reminders: only the tasks that need attention — overdue and
 * due-soon — surfaced on open, worst first. "ok" tasks are left out
 * (the full list is still on the Due tab below). Read-only: it
 * never adds, changes, or overwrites any task, factory-filled or
 * user-set. */
function dueReminders(store, bikeId, asOf) {
  asOf = asOf || todayISO();
  var rows = dueRows(store, bikeId, asOf).filter(function (row) {
    return row.status === 'overdue' || row.status === 'due-soon';
  });
  var overdue = rows.filter(function (row) { return row.status === 'overdue'; });
  var dueSoon = rows.filter(function (row) { return row.status === 'due-soon'; });
  return {
    rows: rows,
    overdue: overdue,
    dueSoon: dueSoon,
    overdueCount: overdue.length,
    dueSoonCount: dueSoon.length,
    total: rows.length
  };
}

/* ------------------------------------------------------------------ */
/* Wear clocks — one clock per wear component, Loam-style. Each       */
/* component's clock IS its task's due state (taskStatus): the miles  */
/* and time legs, the last logged service, the due-soon/overdue      */
/* badge. The registry below is the only new data — component name,  */
/* which task names count as that component on each platform, and    */
/* what the clock means. Intervals are NEVER stored here: they come  */
/* from the bike's own task (set by the factory auto-fill, which     */
/* cites its manual) or, for a bike with no such task yet, from its  */
/* factory schedule. A component with no published interval anywhere */
/* gets NO clock: coolant (air-cooled Harleys have no cooling        */
/* system) and brake-pad replacement (inspect interval only —        */
/* replace on wear). Tire replacement is the date-based exception:   */
/* both manuals say replace on condition/wear, not on mileage, so   */
/* the Tires clock stays the inspect interval — and the separate      */
/* 'Tire age' clock below runs off the DOT manufacture date          */
/* (Michelin/Dunlop 5/10 rule) instead of any task. Drive chain is   */
/* the one scoped exception: it HAS a clock, but only for            */
/* chain-drive Sportsters (1986–1990, Clymer every 300 mi) — the     */
/* factory tables are belt-drive, so a belt-drive bike shows         */
/* no-interval for it, never an invented chain job.                  */
/*                                                                    */
/* Status values: 'ok' / 'due-soon' / 'overdue' (tracked, from the  */
/* task), 'not-tracked' (published interval exists for this bike     */
/* but no task yet — add it to start the clock), 'no-interval'       */
/* (no published interval on file for this bike at all — the clock   */
/* needs the user's manual).                                          */
/*                                                                    */
/* One component is date-based, not task-based: 'Tire age' runs off  */
/* the DOT manufacture date stored on the bike (tire_made), not off   */
/* a service interval — the manuals say replace tires on condition    */
/* /wear, never on mileage, so no task interval could drive it.       */
/* Its clock is tireAgeClock below; wearClocks delegates to it.       */
/* ------------------------------------------------------------------ */
/* Tire age — a date-based wear clock, per bike.                       */
/*                                                                     */
/* Rule (Michelin/Dunlop motorcycle guidance, repeated by            */
/* Harley-Davidson — NOT the 6-year car-tire figure): annual          */
/* professional inspection after 5 years of use; replace at 10       */
/* years from the date of manufacture, even with tread left.          */
/* Source: Tire & helmet standards research, Nov 21, 2026            */
/* (~/workspace/research_notes/tire-helmet-standards-20261121/        */
/* report.md §1): Michelin USA "When Should I Change my Motorcycle   */
/* Tires?" and Dunlop Care & Maintenance §24 Tire Age; Harley-        */
/* Davidson "When to Replace Motorcycle Tires" repeats the 5/10       */
/* guidance. The 6-year number comes from car-tire makers (Goodyear  */
/* /Cooper, counted from in-service date) and car owner's manuals —   */
/* it does not apply to motorcycle tires.                              */
/*                                                                     */
/* Bands: green under 5 years, amber 5–10 years ("get a professional  */
/* inspection every year"), red at 10+ years ("replace"). The clock   */
/* names the rule it applies, in its source line.                      */
/*                                                                     */
/* Storage: one manufacture date per bike, `tire_made` (YYYY-MM-DD)   */
/* on the bike object — the logbook tracks tires per bike, not per     */
/* position, so there is no front/rear split. Old logbooks have no    */
/* key at all: that means "no date entered", same as an unset clock.   */
/* Deleting the bike deletes its tire date with it.                    */
/*                                                                     */
/* Input: a plain manufacture date (the app's established date-input   */
/* style) or a DOT date code — the same decode the Evo Diagnostic's    */
/* tire reader uses (last 3 or 4 digits of the TIN, WWYY, 49 CFR      */
/* 574.5). A 3-digit code is pre-2000 (WWY, read as the 1990s, as in  */
/* the reader); any 3-digit-code tire is 26+ years old and red on     */
/* sight either way. The decoded date is the first day of that         */
/* manufacture week.                                                   */
/* ------------------------------------------------------------------ */
var TIRE_INSPECT_YEARS = 5;
var TIRE_REPLACE_YEARS = 10;
var TIRE_AGE_SOURCE = 'Michelin/Dunlop motorcycle rule, repeated by Harley-Davidson: professional inspection every year after 5 years of use; replace at 10 years from manufacture, even with tread left. (Tire & helmet standards research, Nov 21, 2026.)';

function isDateISO(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var p = parseISO(s);
  if (p.m < 1 || p.m > 12 || p.d < 1 || p.d > daysInMonth(p.y, p.m)) return false;
  return true;
}

/* Decode a DOT date code (last 3 or 4 digits of the TIN) to the
 * manufacture date — the first day of that week. Same rules as the
 * Evo Diagnostic's tire reader (tire.js): 4 digits WWYY, post-2000;
 * 3 digits WWY, read as the 1990s. Returns { week, year, madeISO }
 * or { error }. */
function decodeDotDate(code) {
  var c = String(code == null ? '' : code).replace(/[^0-9]/g, '');
  if (c.length !== 4 && c.length !== 3) {
    return { error: 'A tire date code is 3 or 4 digits — the last digits of the DOT code on the sidewall.' };
  }
  var week, year;
  if (c.length === 4) {
    week = parseInt(c.slice(0, 2), 10);
    year = 2000 + parseInt(c.slice(2), 10);
  } else {
    week = parseInt(c.slice(0, 2), 10);
    year = 1990 + parseInt(c.slice(2), 10);
  }
  if (week < 1 || week > 53)
    return { error: 'Week ' + week + ' is not a real week — re-read the code (first two digits are the week).' };
  if (year > new Date().getFullYear())
    return { error: 'That code reads as ' + year + ', which is in the future — re-read the code.' };
  var d = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  return {
    week: week, year: year,
    madeISO: fmtISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  };
}

/* Set (or clear) a bike's tire manufacture date. `value` is a
 * YYYY-MM-DD date, a 3–4 digit DOT date code (decoded the same way
 * the Evo Diagnostic's tire reader does it), or '' to clear.
 * Returns the bike. A future date is refused — a tire cannot be
 * made tomorrow. */
function setTireDate(store, bikeId, value) {
  var b = store.bikes[bikeId];
  if (!b) throw new Error('Bike not found.');
  var v = value == null ? '' : String(value).trim();
  if (!v) { b.tire_made = null; return b; }
  var madeISO;
  if (/^\d{3,4}$/.test(v)) {
    var decoded = decodeDotDate(v);
    if (decoded.error) throw new Error(decoded.error);
    madeISO = decoded.madeISO;
  } else if (isDateISO(v)) {
    madeISO = v;
  } else {
    throw new Error('Enter a manufacture date (YYYY-MM-DD) or a 3–4 digit DOT date code.');
  }
  if (daysBetween(madeISO, todayISO()) < 0)
    throw new Error('That manufacture date is in the future — re-check it.');
  b.tire_made = madeISO;
  return b;
}

/* The tire-age clock for one bike: same shape as a wearClocks entry
 * (component / about / tracked / taskId / taskName / status /
 * interval / source / details), so the Due tab renders it like any
 * other clock. Read-only: it never adds or changes anything. */
function tireAgeClock(store, bikeId, asOf) {
  var b = store.bikes[bikeId];
  if (!b) throw new Error('Bike not found.');
  asOf = asOf || todayISO();
  var about = 'Age from the DOT manufacture date, not tread depth — a tire can look fine and still be past its life.';
  var base = {
    component: 'Tire age', about: about,
    taskId: null, taskName: null,
    interval: 'replace ' + TIRE_REPLACE_YEARS + ' years from manufacture',
    source: TIRE_AGE_SOURCE
  };
  var made = b.tire_made || null;
  if (!made) {
    base.tracked = false;
    base.status = 'not-tracked';
    base.details = ['No date entered — add the tire manufacture date (or DOT code) on the Bikes & Tasks tab to start this clock.'];
    return base;
  }
  /* The stored date is the first day of the manufacture week, so
   * the week/year line reads back from it. */
  var p = parseISO(made);
  var jan1 = Date.UTC(p.y, 0, 1);
  var madeMs = Date.UTC(p.y, p.m - 1, p.d);
  var week = Math.floor((madeMs - jan1) / (7 * 86400000)) + 1;
  var ageYears = Math.floor((daysBetween(made, asOf) / 365.25) * 10) / 10;
  var inspectBy = addMonths(made, TIRE_INSPECT_YEARS * 12);
  var replaceBy = addMonths(made, TIRE_REPLACE_YEARS * 12);
  var status, advice;
  if (asOf < inspectBy) {
    status = 'ok';
    advice = 'Under 5 years — good. Have it inspected by a pro once it passes 5 years of use.';
  } else if (asOf < replaceBy) {
    status = 'due-soon';
    advice = '5 to 10 years — get a professional inspection every year; plan the replacement.';
  } else {
    status = 'overdue';
    advice = '10+ years from manufacture — replace the tire, even if the tread looks fine.';
  }
  base.tracked = true;
  base.status = status;
  base.details = [
    'Made week ' + week + ' of ' + p.y + ' (' + fmtDate(made) + ') — ' + ageYears + ' years old.',
    advice,
    'Replace by ' + fmtDate(replaceBy) + ' — 10 years from manufacture.'
  ];
  return base;
}

var WEAR_COMPONENTS = [
  { component: 'Engine oil', tasks: ['Engine oil'],
    about: 'Oil + filter — the wear item the whole schedule hangs on.' },
  { component: 'Primary + transmission fluid', tasks: ['Primary fluid', 'Transmission fluid', 'Primary / transmission fluid'],
    about: 'One clock per fluid on a Softail; one shared sump — one job — on a Sportster.' },
  { component: 'Spark plugs', tasks: ['Spark plugs'],
    about: 'Replace on the book interval — 20,000 mi Softail, 10,000 mi Sportster.' },
  { component: 'Drive belt', tasks: ['Drive belt'],
    about: 'Inspect on the book interval; adjust at the first service.' },
  { component: 'Drive chain', tasks: ['Drive chain lubrication'],
    about: 'Lubricate every 300 mi — chain-drive Sportsters (1986–1990) only, Clymer. Belt-drive bikes have no drive chain.' },
  { component: 'Brake fluid', tasks: ['Brake fluid'],
    about: 'Inspect level/condition — DOT 5 silicone only, never mix with DOT 3/4.' },
  { component: 'Brake pads', tasks: ['Brake pads'],
    about: 'Inspect interval only — replace when worn to minimum thickness, not on mileage.' },
  { component: 'Tires', tasks: ['Tires'],
    about: 'Inspect interval only — pressure and wear every check; replace on condition, not mileage.' },
  { component: 'Tire age', dateBased: true,
    about: 'Age from the DOT manufacture date, not tread depth — a tire can look fine and still be past its life.' },
  { component: 'Fork oil', tasks: ['Fork oil'],
    about: 'Replace on the book interval.' },
  { component: 'Wheel bearings', tasks: ['Wheel bearings'],
    about: 'Remove, inspect, repack/lubricate on the book interval.' },
  { component: 'Air filter', tasks: ['Air filter'],
    about: 'Inspect (and clean) on the book interval.' },
  { component: 'Clutch adjustment', tasks: ['Clutch adjustment'],
    about: 'Check/adjust on the book interval.' },
  { component: 'Primary chain', tasks: ['Primary chain'],
    about: 'Inspect/adjust on the book interval.' },
  { component: 'Battery', tasks: ['Battery'],
    about: 'Inspect connections (and fluid, where the manual calls for it) on the book interval.' },
  { component: 'Steering head bearings', tasks: ['Steering head bearings', 'Steering head bearing adjustment'],
    about: 'Repack on the Softail book, adjust/lubricate on the Sportster book — different jobs, different intervals.' },
  { component: 'Fuel filter', tasks: ['Fuel tank filter', 'Fuel tank filter screen'],
    about: 'Replace on the Softail book, inspect the screen on the Sportster book — different jobs.' },
  { component: 'Throttle cables', tasks: ['Throttle cables'],
    about: 'Lubricate on the book interval — 10,000 mi Softail, 5,000 mi Sportster.' }
];

/* One wear clock per registry component for one bike. Read-only: it
 * never adds or changes a task. */
function wearClocks(store, bikeId, asOf) {
  var b = store.bikes[bikeId];
  if (!b) throw new Error('Bike not found.');
  asOf = asOf || todayISO();
  var sched = factoryScheduleFor(b.make, b.model, b.year);
  return WEAR_COMPONENTS.map(function (entry) {
    /* Date-based clock: no task drives it — the DOT manufacture
     * date on the bike does. */
    if (entry.dateBased) return tireAgeClock(store, bikeId, asOf);
    var taskId = null;
    Object.keys(store.tasks).some(function (tid) {
      var t = store.tasks[tid];
      if (t.bike_id !== bikeId) return false;
      return entry.tasks.some(function (name) {
        return t.name.toLowerCase() === name.toLowerCase();
      }) ? (taskId = tid, true) : false;
    });
    if (taskId) {
      var t = store.tasks[taskId];
      var st = taskStatus(store, bikeId, taskId, asOf);
      return {
        component: entry.component, about: entry.about,
        tracked: true, taskId: taskId, taskName: t.name,
        status: st.status, interval: intervalLabel(t),
        source: t.notes || '', details: st.details
      };
    }
    /* No task yet: the published interval, if the bike's factory
     * schedule has one for this component. */
    var schedTask = null;
    if (sched) {
      sched.tasks.some(function (st) {
        if (!scheduleTaskApplies(st, b.year)) return false;
        return entry.tasks.some(function (name) {
          return st.name.toLowerCase() === name.toLowerCase();
        }) ? (schedTask = st, true) : false;
      });
    }
    if (schedTask) {
      return {
        component: entry.component, about: entry.about,
        tracked: false, taskId: null, taskName: schedTask.name,
        status: 'not-tracked',
        interval: 'every ' + Number(schedTask.every_miles).toLocaleString('en-US') + ' mi',
        source: schedTask.notes,
        details: ['No task yet — add "' + schedTask.name + '" to start this clock.']
      };
    }
    return {
      component: entry.component, about: entry.about,
      tracked: false, taskId: null, taskName: null,
      status: 'no-interval', interval: '', source: '',
      details: ['No published interval on file for this bike — add the task from your manual.']
    };
  });
}

/* Per-bike service history export (JSON shape). Completed service
 * records for ONE bike only — its tasks and its entries, newest
 * first, with the total spent. Plain data, no store internals, so
 * the file reads on its own. */
function bikeHistoryExport(store, bikeId) {
  var b = store.bikes[bikeId];
  if (!b) throw new Error('Pick a bike first.');
  var entries = historyEntries(store, bikeId, null);
  var expenses = expensesForBike(store, bikeId, null);
  var rides = ridesForBike(store, bikeId);
  var servicesTotal = historyTotal(entries);
  var expensesTotal = expenseTotal(expenses);
  var ridesTotal = rideTotalMiles(rides);
  return {
    bike: {
      name: b.name,
      year: b.year == null ? null : b.year,
      make: b.make || '',
      model: b.model || '',
      odometer: b.odometer,
      odometer_date: b.odometer_date || null
    },
    exported: todayISO(),
    service_count: entries.length,
    total_spent: servicesTotal,
    tasks: tasksForBike(store, bikeId).map(function (tid) {
      var t = store.tasks[tid];
      return {
        name: t.name,
        every_miles: t.every_miles == null ? null : t.every_miles,
        every_months: t.every_months == null ? null : t.every_months,
        notes: t.notes || ''
      };
    }),
    services: entries.map(function (e) {
      var t = store.tasks[e.task_id];
      return {
        date: e.date,
        task: t ? t.name : '?',
        odometer: e.odometer,
        cost: e.cost == null ? null : e.cost,
        notes: e.notes || ''
      };
    }),
    /* Expenses ride along in the same per-bike history file: they are
     * the bike's money out that is not a logged service (parts bought
     * ahead of a job, shop labor, …). The services shape above is
     * unchanged; expenses are their own section, newest first. */
    expense_count: expenses.length,
    expenses_total: expensesTotal,
    grand_total: Math.round((servicesTotal + expensesTotal) * 100) / 100,
    expenses: expenses.map(function (x) {
      return {
        date: x.date,
        category: x.category,
        description: x.description,
        odometer: x.odometer == null ? null : x.odometer,
        cost: x.cost == null ? null : x.cost,
        notes: x.notes || '',
        /* The photo itself stays in the full logbook backup, not in
         * this per-bike report — the flag says one is attached. */
        has_photo: !!x.photo
      };
    }),
    /* Rides ride along in the same per-bike history file, the same
     * way expenses do: their own section, newest first. Rides are
     * the only miles source in the logbook, so the grand total of
     * miles is the rides total — it mirrors grand_total's role as
     * the headline figure, it just has nothing to add to. */
    ride_count: rides.length,
    rides_total_miles: ridesTotal,
    grand_total_miles: ridesTotal,
    rides: rides.map(function (r) {
      return {
        date: r.date,
        route: r.route,
        miles: r.miles,
        notes: r.notes || ''
      };
    })
  };
}

/* The same per-bike history as readable plain text — one line per
 * service, newest first, with the bike, its tasks, and the total. */
function bikeHistoryText(store, bikeId) {
  var data = bikeHistoryExport(store, bikeId);
  var b = data.bike;
  var spec = [b.year || '', b.make || '', b.model || ''].join(' ')
    .replace(/\s+/g, ' ').trim();
  var lines = [];
  lines.push('Service history — ' + b.name + (spec ? ' (' + spec + ')' : ''));
  lines.push('Odometer: ' + fmtMiles(b.odometer) +
    (b.odometer_date ? ' (as of ' + fmtDate(b.odometer_date) + ')' : ''));
  lines.push('Exported: ' + fmtDate(data.exported));
  lines.push('');
  if (data.tasks.length) {
    lines.push('Tasks on this bike:');
    data.tasks.forEach(function (t) {
      var parts = [];
      if (t.every_miles) parts.push('every ' + Number(t.every_miles).toLocaleString('en-US') + ' mi');
      if (t.every_months) parts.push('every ' + t.every_months + ' mo');
      lines.push('  - ' + t.name + (parts.length ? ' (' + parts.join(' / ') + ')' : ''));
    });
    lines.push('');
  }
  if (!data.services.length) {
    lines.push('No services logged yet for this bike.');
  } else {
    lines.push(data.service_count + ' service' + (data.service_count === 1 ? '' : 's') +
      ' — total ' + fmtMoney(data.total_spent) + ':');
    data.services.forEach(function (s) {
      lines.push(fmtDate(s.date) + ' — ' + s.task + ' @ ' + fmtMiles(s.odometer) +
        (s.cost != null ? ' — ' + fmtMoney(s.cost) : ''));
      if (s.notes) lines.push('    ' + s.notes);
    });
  }
  lines.push('');
  if (!data.expenses.length) {
    lines.push('No expenses logged yet for this bike.');
  } else {
    lines.push(data.expense_count + ' expense' + (data.expense_count === 1 ? '' : 's') +
      ' — total ' + fmtMoney(data.expenses_total) + ':');
    data.expenses.forEach(function (x) {
      lines.push(fmtDate(x.date) + ' — ' + expenseCategoryLabel(x.category) + ' — ' + x.description +
        (x.odometer != null ? ' @ ' + fmtMiles(x.odometer) : '') +
        ' — ' + fmtMoney(x.cost) +
        (x.has_photo ? ' (receipt photo attached)' : ''));
      if (x.notes) lines.push('    ' + x.notes);
    });
    lines.push('Grand total (services + expenses): ' + fmtMoney(data.grand_total));
  }
  lines.push('');
  if (!data.rides.length) {
    lines.push('No rides logged yet for this bike.');
  } else {
    lines.push(data.ride_count + ' ride' + (data.ride_count === 1 ? '' : 's') +
      ' — total ' + fmtRideMiles(data.rides_total_miles) + ':');
    data.rides.forEach(function (r) {
      lines.push(fmtDate(r.date) + ' — ' + r.route +
        ' — ' + fmtRideMiles(r.miles));
      if (r.notes) lines.push('    ' + r.notes);
    });
    lines.push('Grand total miles: ' + fmtRideMiles(data.grand_total_miles));
  }
  return lines.join('\n') + '\n';
}

/* Download filename for a per-bike history export, slugged from the
 * bike name: "Example 1995 Softail" -> bike-log-example-1995-softail-history.json */
function historyExportFilename(bikeName, ext) {
  var slug = String(bikeName || 'bike').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'bike';
  return 'bike-log-' + slug + '-history.' + ext;
}

/* Returns { warned } — same rule as the CLI: a service logged above the
 * recorded odometer advances it; below it warns and never rewinds. */
function logService(store, fields) {
  var b = store.bikes[fields.bike_id];
  var t = store.tasks[fields.task_id];
  if (!b) throw new Error('Pick a bike first.');
  if (!t || t.bike_id !== fields.bike_id) throw new Error('Pick a task on that bike.');
  var date = fields.date || todayISO();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date must be YYYY-MM-DD.');
  var odo = fields.odometer === '' || fields.odometer == null
    ? b.odometer : Number(fields.odometer);
  if (isNaN(odo) || odo < 0) throw new Error('Odometer must be zero or more.');
  var cost = fields.cost === '' || fields.cost == null ? null : Number(fields.cost);
  if (cost != null && (isNaN(cost) || cost < 0)) throw new Error('Cost cannot be negative.');
  var warned = odo < b.odometer;
  if (odo > b.odometer) { b.odometer = odo; b.odometer_date = date; }
  var entry = {
    id: nextEntryId(store.entries),
    bike_id: fields.bike_id,
    task_id: fields.task_id,
    date: date,
    odometer: odo,
    cost: cost == null ? null : Math.round(cost * 100) / 100,
    notes: fields.notes || ''
  };
  store.entries.push(entry);
  return { entry: entry, warned: warned };
}

function historyEntries(store, bikeId, taskId) {
  var list = store.entries.slice();
  if (bikeId) list = list.filter(function (e) { return e.bike_id === bikeId; });
  if (taskId) list = list.filter(function (e) { return e.task_id === taskId; });
  list.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return b.odometer - a.odometer;
  });
  return list;
}

function historyTotal(list) {
  var total = 0;
  list.forEach(function (e) { if (e.cost != null) total += e.cost; });
  return Math.round(total * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* Expenses — money out, per bike. User-entered only: the app never  */
/* invents a part price or a labor rate, and never shows a "typical  */
/* shop cost". An expense is what Joshua actually spent, in one of   */
/* four buckets (parts / labor / service / other). It is NOT a       */
/* service entry: buying parts ahead of a job, paying a shop, or    */
/* any other spend that is not a logged service goes here. Service  */
/* entries keep their own cost field for what that job cost.        */
/* ------------------------------------------------------------------ */
var EXPENSE_CATEGORIES = ['parts', 'labor', 'service', 'other'];

function expenseCategoryLabel(cat) {
  if (cat === 'parts') return 'Parts';
  if (cat === 'labor') return 'Labor';
  if (cat === 'service') return 'Service';
  return 'Other';
}

/* Next id from the highest numeric suffix in use — same rule as
 * entries, so ids stay stable and predictable. */
function nextExpenseId(expenses) {
  var max = 0;
  expenses.forEach(function (x) {
    var m = /^x(\d+)$/.exec(x.id || '');
    if (m && parseInt(m[1], 10) > max) max = parseInt(m[1], 10);
  });
  return 'x' + (max + 1);
}

function addExpense(store, fields) {
  var b = store.bikes[fields.bike_id];
  if (!b) throw new Error('Pick a bike first.');
  var description = fields.description == null ? '' : String(fields.description).trim();
  if (!description) throw new Error('Say what the money was for.');
  var date = fields.date || todayISO();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date must be YYYY-MM-DD.');
  var category = fields.category == null || fields.category === ''
    ? 'other' : String(fields.category);
  if (EXPENSE_CATEGORIES.indexOf(category) === -1)
    throw new Error('Unknown expense category: ' + category + '.');
  if (fields.cost === '' || fields.cost == null)
    throw new Error('Cost is required — enter what you actually spent.');
  var cost = Number(fields.cost);
  if (isNaN(cost) || cost < 0) throw new Error('Cost cannot be negative.');
  var odo = fields.odometer === '' || fields.odometer == null
    ? null : Number(fields.odometer);
  if (odo != null && (isNaN(odo) || odo < 0)) throw new Error('Odometer must be zero or more.');
  var photo = null;
  if (fields.photo != null) {
    if (!isExpensePhoto(fields.photo))
      throw new Error('That receipt photo is not a usable image (must be an image under ~1 MB).');
    photo = { name: fields.photo.name || 'receipt', type: fields.photo.type || '', dataUrl: fields.photo.dataUrl };
  }
  var expense = {
    id: nextExpenseId(store.expenses || []),
    bike_id: fields.bike_id,
    date: date,
    category: category,
    description: description,
    cost: Math.round(cost * 100) / 100,
    odometer: odo,
    notes: fields.notes || '',
    photo: photo
  };
  store.expenses.push(expense);
  return expense;
}

function removeExpense(store, expenseId) {
  var found = (store.expenses || []).some(function (x) { return x.id === expenseId; });
  if (!found) throw new Error('Expense not found.');
  store.expenses = store.expenses.filter(function (x) { return x.id !== expenseId; });
}

/* Receipt photos — attach-only, no OCR (the vision box is down).
 * A photo is { name, type, dataUrl } stored on the expense itself,
 * in the same localStorage JSON as the rest of the logbook, so it
 * rides along in the backup and the CLI-shaped import. The UI
 * downscales to a phone-photo thumbnail before calling attach, but
 * the cap is enforced here too: a data URL over ~1.1 MB is refused
 * rather than risking a blown localStorage quota mid-save. Old
 * expenses have no `photo` key at all — that means "no photo",
 * never an error. */
var MAX_PHOTO_CHARS = 1500000;

function isExpensePhoto(photo) {
  return !!photo && typeof photo === 'object' &&
    typeof photo.dataUrl === 'string' &&
    photo.dataUrl.indexOf('data:image/') === 0 &&
    photo.dataUrl.length <= MAX_PHOTO_CHARS;
}

function attachExpensePhoto(store, expenseId, photo) {
  var x = (store.expenses || []).filter(function (e) { return e.id === expenseId; })[0];
  if (!x) throw new Error('Expense not found.');
  if (!isExpensePhoto(photo))
    throw new Error('That receipt photo is not a usable image (must be an image under ~1 MB).');
  x.photo = { name: photo.name || 'receipt', type: photo.type || '', dataUrl: photo.dataUrl };
  return x;
}

/* True when a photo was removed, false when there was none to remove. */
function removeExpensePhoto(store, expenseId) {
  var x = (store.expenses || []).filter(function (e) { return e.id === expenseId; })[0];
  if (!x) throw new Error('Expense not found.');
  if (!x.photo) return false;
  x.photo = null;
  return true;
}

/* Expenses for one bike (or all bikes when bikeId is null),
 * optionally filtered to one category, newest first. */
function expensesForBike(store, bikeId, category) {
  var list = (store.expenses || []).slice();
  if (bikeId) list = list.filter(function (x) { return x.bike_id === bikeId; });
  if (category) list = list.filter(function (x) { return x.category === category; });
  list.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    var na = parseInt((/^x(\d+)$/.exec(a.id || '') || [0, 0])[1], 10);
    var nb = parseInt((/^x(\d+)$/.exec(b.id || '') || [0, 0])[1], 10);
    return nb - na;
  });
  return list;
}

function expenseTotal(list) {
  var total = 0;
  list.forEach(function (x) { if (x.cost != null) total += x.cost; });
  return Math.round(total * 100) / 100;
}

/* Total spent per category over a list of expenses. */
function expensesByCategory(list) {
  var out = { parts: 0, labor: 0, service: 0, other: 0 };
  list.forEach(function (x) {
    if (x.cost == null) return;
    if (out[x.category] == null) out[x.category] = 0;
    out[x.category] = Math.round((out[x.category] + x.cost) * 100) / 100;
  });
  return out;
}

/* Per-bike expenses export (JSON shape) — the expenses-only file the
 * Expenses tab downloads. Same one-bike-at-a-time rule as the
 * service history export. */
function bikeExpensesExport(store, bikeId) {
  var b = store.bikes[bikeId];
  if (!b) throw new Error('Pick a bike first.');
  var expenses = expensesForBike(store, bikeId, null);
  return {
    bike: {
      name: b.name,
      year: b.year == null ? null : b.year,
      make: b.make || '',
      model: b.model || '',
      odometer: b.odometer,
      odometer_date: b.odometer_date || null
    },
    exported: todayISO(),
    expense_count: expenses.length,
    total_spent: expenseTotal(expenses),
    by_category: expensesByCategory(expenses),
    expenses: expenses.map(function (x) {
      return {
        date: x.date,
        category: x.category,
        description: x.description,
        odometer: x.odometer == null ? null : x.odometer,
        cost: x.cost == null ? null : x.cost,
        notes: x.notes || '',
        /* The photo itself stays in the full logbook backup, not in
         * this per-bike report — the flag says one is attached. */
        has_photo: !!x.photo
      };
    })
  };
}

/* The same per-bike expenses as readable plain text. */
function bikeExpensesText(store, bikeId) {
  var data = bikeExpensesExport(store, bikeId);
  var b = data.bike;
  var spec = [b.year || '', b.make || '', b.model || ''].join(' ')
    .replace(/\s+/g, ' ').trim();
  var lines = [];
  lines.push('Expenses — ' + b.name + (spec ? ' (' + spec + ')' : ''));
  lines.push('Odometer: ' + fmtMiles(b.odometer) +
    (b.odometer_date ? ' (as of ' + fmtDate(b.odometer_date) + ')' : ''));
  lines.push('Exported: ' + fmtDate(data.exported));
  lines.push('');
  if (!data.expenses.length) {
    lines.push('No expenses logged yet for this bike.');
  } else {
    lines.push(data.expense_count + ' expense' + (data.expense_count === 1 ? '' : 's') +
      ' — total ' + fmtMoney(data.total_spent) + ':');
    EXPENSE_CATEGORIES.forEach(function (cat) {
      if (data.by_category[cat]) {
        lines.push('  ' + expenseCategoryLabel(cat) + ': ' + fmtMoney(data.by_category[cat]));
      }
    });
    data.expenses.forEach(function (x) {
      lines.push(fmtDate(x.date) + ' — ' + expenseCategoryLabel(x.category) + ' — ' + x.description +
        (x.odometer != null ? ' @ ' + fmtMiles(x.odometer) : '') +
        ' — ' + fmtMoney(x.cost) +
        (x.has_photo ? ' (receipt photo attached)' : ''));
      if (x.notes) lines.push('    ' + x.notes);
    });
  }
  return lines.join('\n') + '\n';
}

/* Download filename for a per-bike expenses export, slugged from the
 * bike name: "Example 1995 Softail" -> bike-log-example-1995-softail-expenses.json */
function expenseExportFilename(bikeName, ext) {
  var slug = String(bikeName || 'bike').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'bike';
  return 'bike-log-' + slug + '-expenses.' + ext;
}

/* ------------------------------------------------------------------ */
/* Rides — a ride journal, per bike. User-entered only: the app never */
/* invents a route or a distance. A ride is a date, a route in your   */
/* own words, the miles you rode, and optional notes. It is NOT a    */
/* service entry and it never moves the odometer — the logbook has    */
/* no way to know whether the miles were on this bike's clock, and   */
/* guessing would corrupt the service intervals. The pattern is the  */
/* Expenses one: same id rule, same newest-first list, same          */
/* per-bike totals, same per-entry delete, same ride-along in the    */
/* per-bike history export, same old-logbook migration.              */
/* ------------------------------------------------------------------ */

/* Next id from the highest numeric suffix in use — same rule as
 * entries and expenses, so ids stay stable and predictable. */
function nextRideId(rides) {
  var max = 0;
  rides.forEach(function (r) {
    var m = /^r(\d+)$/.exec(r.id || '');
    if (m && parseInt(m[1], 10) > max) max = parseInt(m[1], 10);
  });
  return 'r' + (max + 1);
}

function addRide(store, fields) {
  var b = store.bikes[fields.bike_id];
  if (!b) throw new Error('Pick a bike first.');
  var route = fields.route == null ? '' : String(fields.route).trim();
  if (!route) throw new Error('Say where you rode.');
  var date = fields.date || todayISO();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date must be YYYY-MM-DD.');
  if (fields.miles === '' || fields.miles == null)
    throw new Error('Miles is required — enter what you actually rode.');
  var miles = Number(fields.miles);
  if (isNaN(miles) || miles < 0) throw new Error('Miles cannot be negative.');
  var ride = {
    id: nextRideId(store.rides || []),
    bike_id: fields.bike_id,
    date: date,
    route: route,
    miles: Math.round(miles * 10) / 10,
    notes: fields.notes || ''
  };
  store.rides.push(ride);
  return ride;
}

function removeRide(store, rideId) {
  var found = (store.rides || []).some(function (r) { return r.id === rideId; });
  if (!found) throw new Error('Ride not found.');
  store.rides = store.rides.filter(function (r) { return r.id !== rideId; });
}

/* Rides for one bike (or all bikes when bikeId is null), newest
 * first — same ordering rule as expenses. */
function ridesForBike(store, bikeId) {
  var list = (store.rides || []).slice();
  if (bikeId) list = list.filter(function (r) { return r.bike_id === bikeId; });
  list.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    var na = parseInt((/^r(\d+)$/.exec(a.id || '') || [0, 0])[1], 10);
    var nb = parseInt((/^r(\d+)$/.exec(b.id || '') || [0, 0])[1], 10);
    return nb - na;
  });
  return list;
}

/* Total miles over a list of rides, kept to one decimal so a
 * 12.5-mile loop plus a 45.6-mile run does not come out 58.10000000000001. */
function rideTotalMiles(list) {
  var total = 0;
  list.forEach(function (r) { if (r.miles != null) total += r.miles; });
  return Math.round(total * 10) / 10;
}

/* Per-bike rides export (JSON shape) — the rides-only file the
 * Rides tab downloads. Same one-bike-at-a-time rule as the
 * service history and expenses exports. */
function bikeRidesExport(store, bikeId) {
  var b = store.bikes[bikeId];
  if (!b) throw new Error('Pick a bike first.');
  var rides = ridesForBike(store, bikeId);
  return {
    bike: {
      name: b.name,
      year: b.year == null ? null : b.year,
      make: b.make || '',
      model: b.model || '',
      odometer: b.odometer,
      odometer_date: b.odometer_date || null
    },
    exported: todayISO(),
    ride_count: rides.length,
    total_miles: rideTotalMiles(rides),
    rides: rides.map(function (r) {
      return {
        date: r.date,
        route: r.route,
        miles: r.miles,
        notes: r.notes || ''
      };
    })
  };
}

/* The same per-bike rides as readable plain text. */
function bikeRidesText(store, bikeId) {
  var data = bikeRidesExport(store, bikeId);
  var b = data.bike;
  var spec = [b.year || '', b.make || '', b.model || ''].join(' ')
    .replace(/\s+/g, ' ').trim();
  var lines = [];
  lines.push('Rides — ' + b.name + (spec ? ' (' + spec + ')' : ''));
  lines.push('Odometer: ' + fmtMiles(b.odometer) +
    (b.odometer_date ? ' (as of ' + fmtDate(b.odometer_date) + ')' : ''));
  lines.push('Exported: ' + fmtDate(data.exported));
  lines.push('');
  if (!data.rides.length) {
    lines.push('No rides logged yet for this bike.');
  } else {
    lines.push(data.ride_count + ' ride' + (data.ride_count === 1 ? '' : 's') +
      ' — total ' + fmtRideMiles(data.total_miles) + ':');
    data.rides.forEach(function (r) {
      lines.push(fmtDate(r.date) + ' — ' + r.route +
        ' — ' + fmtRideMiles(r.miles));
      if (r.notes) lines.push('    ' + r.notes);
    });
  }
  return lines.join('\n') + '\n';
}

/* Download filename for a per-bike rides export, slugged from the
 * bike name: "Example 1995 Softail" -> bike-log-example-1995-softail-rides.json */
function rideExportFilename(bikeName, ext) {
  var slug = String(bikeName || 'bike').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'bike';
  return 'bike-log-' + slug + '-rides.' + ext;
}

/* Validate an imported logbook (CLI data.json shape). Throws on garbage
 * or on entries pointing at bikes/tasks that are not in the file. */
function validateImport(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('Import must be a JSON object.');
  if (!data.bikes || typeof data.bikes !== 'object' || Array.isArray(data.bikes))
    throw new Error('Import is missing "bikes".');
  if (!data.tasks || typeof data.tasks !== 'object' || Array.isArray(data.tasks))
    throw new Error('Import is missing "tasks".');
  if (!Array.isArray(data.entries))
    throw new Error('Import is missing "entries".');
  Object.keys(data.bikes).forEach(function (id) {
    if (!data.bikes[id] || !data.bikes[id].name)
      throw new Error('Bike "' + id + '" has no name.');
    /* A tire manufacture date, when present, must be a real
     * calendar date; a missing key is an old logbook, not an error. */
    var made = data.bikes[id].tire_made;
    if (made != null && !isDateISO(made))
      throw new Error('Bike "' + id + '" has a bad tire manufacture date.');
  });
  Object.keys(data.tasks).forEach(function (id) {
    var t = data.tasks[id];
    if (!t || !t.name) throw new Error('Task "' + id + '" has no name.');
    if (!data.bikes[t.bike_id])
      throw new Error('Task "' + t.name + '" points at a missing bike.');
  });
  data.entries.forEach(function (e, i) {
    if (!data.bikes[e.bike_id])
      throw new Error('Entry #' + (i + 1) + ' points at a missing bike.');
    if (!data.tasks[e.task_id])
      throw new Error('Entry #' + (i + 1) + ' points at a missing task.');
  });
  /* Expenses are this app's own key — the CLI's data.json never has
   * one, so a missing key is an old logbook, not an error. When
   * present it must be a list of expenses on bikes in the file. */
  var expenses = Array.isArray(data.expenses) ? data.expenses : [];
  expenses.forEach(function (x, i) {
    if (!x || typeof x !== 'object')
      throw new Error('Expense #' + (i + 1) + ' is not an object.');
    if (!data.bikes[x.bike_id])
      throw new Error('Expense #' + (i + 1) + ' points at a missing bike.');
    if (x.category != null && EXPENSE_CATEGORIES.indexOf(x.category) === -1)
      throw new Error('Expense #' + (i + 1) + ' has an unknown category.');
    if (x.cost != null && (isNaN(Number(x.cost)) || Number(x.cost) < 0))
      throw new Error('Expense #' + (i + 1) + ' has a bad cost.');
    /* A receipt photo is optional; when present it must be a usable
     * image, and a missing key is an old expense, not an error. */
    if (x.photo != null && !isExpensePhoto(x.photo))
      throw new Error('Expense #' + (i + 1) + ' has a bad receipt photo.');
  });
  /* Rides are this app's own key too — the CLI's data.json never has
   * one, so a missing key is an old logbook, not an error. When
   * present it must be a list of rides on bikes in the file. */
  var rides = Array.isArray(data.rides) ? data.rides : [];
  rides.forEach(function (r, i) {
    if (!r || typeof r !== 'object')
      throw new Error('Ride #' + (i + 1) + ' is not an object.');
    if (!data.bikes[r.bike_id])
      throw new Error('Ride #' + (i + 1) + ' points at a missing bike.');
    if (r.miles != null && (isNaN(Number(r.miles)) || Number(r.miles) < 0))
      throw new Error('Ride #' + (i + 1) + ' has bad miles.');
  });
  return { bikes: data.bikes, tasks: data.tasks, entries: data.entries, expenses: expenses, rides: rides };
}

/* Example logbook — dates relative to today so the OVERDUE / DUE SOON /
 * ok spread stays true whenever it is loaded. The example intervals are
 * the factory numbers for the Evo Softail platform, from the 1997–98
 * Softail Factory Service Manual #99482-98 §1 (mileage-based only — the
 * manual has no months legs and brake fluid is inspect-only). The
 * example bike is a 1995 Fat Boy on the same platform, so the intervals
 * and fluid types carry over; year-specific capacities are not printed
 * here as 1995 specs. */
function sampleStore() {
  var store = emptyStore();
  var now = todayISO();
  var bike = addBike(store, {
    name: 'Example 1995 Softail', year: '1995',
    make: 'Harley-Davidson', model: 'Fat Boy', odometer: '42300'
  });
  var bid = Object.keys(store.bikes)[0];
  bike = store.bikes[bid];
  function monthsAgo(n) { return addMonths(now, -n); }
  var oil = addTask(store, { bike_id: bid, name: 'Engine oil', every_miles: '5000', every_months: '', notes: 'FSM #99482-98 §1: first service 500 mi, then every 5,000 mi (oil + filter).' });
  var primary = addTask(store, { bike_id: bid, name: 'Primary fluid', every_miles: '5000', every_months: '', notes: 'Example interval — use your manual.' });
  var brakes = addTask(store, { bike_id: bid, name: 'Brake fluid (inspect)', every_miles: '5000', every_months: '', notes: 'Inspect only — DOT 5 silicone ONLY, never mix with DOT 3/4. FSM #99482-98 §1, p.1-42.' });
  var tires = addTask(store, { bike_id: bid, name: 'Tires (inspect)', every_miles: '5000', every_months: '', notes: 'Inspect at every 5,000-mi service — replace on condition/wear, not on mileage. FSM #99482-98 §1.' });
  var oilId = Object.keys(store.tasks).filter(function (id) { return store.tasks[id].name === 'Engine oil'; })[0];
  var primaryId = Object.keys(store.tasks).filter(function (id) { return store.tasks[id].name === 'Primary fluid'; })[0];
  var brakesId = Object.keys(store.tasks).filter(function (id) { return store.tasks[id].name === 'Brake fluid (inspect)'; })[0];
  void oil; void primary; void brakes; void tires;
  /* Oil: 4,800 mi ago -> 200 mi left (due soon). */
  logService(store, { bike_id: bid, task_id: oilId, date: monthsAgo(5), odometer: '37500', cost: '48.50', notes: '20W-50, new filter' });
  /* Primary: 1,000 mi ago, 1 month ago -> comfortably ok. */
  logService(store, { bike_id: bid, task_id: primaryId, date: monthsAgo(1), odometer: '41300', cost: '18.00', notes: '' });
  /* Brakes: last inspected 15,000 mi ago -> overdue on the miles leg. */
  logService(store, { bike_id: bid, task_id: brakesId, date: monthsAgo(14), odometer: '27300', cost: '12.00', notes: 'DOT 5 silicone ONLY, bled both calipers' });
  /* Tires: never logged -> counts from task creation, ok. */
  /* Restore the bike odometer the services advanced past the sample's
   * headline reading: services logged at 37,500 / 41,300 / 27,300 must
   * not drag the bike backwards, so pin it to the headline value. */
  bike.odometer = 42300;
  bike.odometer_date = now;
  return store;
}

/* Merge a sample logbook into a live one, remapping ids so nothing
 * collides with bikes/tasks the user already has. Entries are copied
 * with remapped bike/task references and fresh entry ids. */
function mergeSample(store, sample) {
  var bikeMap = {}, taskMap = {};
  Object.keys(sample.bikes).forEach(function (oldId) {
    var newId = uid('b', store.bikes);
    bikeMap[oldId] = newId;
    store.bikes[newId] = sample.bikes[oldId];
  });
  Object.keys(sample.tasks).forEach(function (oldId) {
    var newId = uid('t', store.tasks);
    taskMap[oldId] = newId;
    var copy = {};
    Object.keys(sample.tasks[oldId]).forEach(function (k) { copy[k] = sample.tasks[oldId][k]; });
    copy.bike_id = bikeMap[sample.tasks[oldId].bike_id] || sample.tasks[oldId].bike_id;
    store.tasks[newId] = copy;
  });
  sample.entries.forEach(function (e) {
    var copy = {};
    Object.keys(e).forEach(function (k) { copy[k] = e[k]; });
    copy.id = nextEntryId(store.entries);
    copy.bike_id = bikeMap[e.bike_id] || e.bike_id;
    copy.task_id = taskMap[e.task_id] || e.task_id;
    store.entries.push(copy);
  });
  (sample.expenses || []).forEach(function (x) {
    var copy = {};
    Object.keys(x).forEach(function (k) { copy[k] = x[k]; });
    copy.id = nextExpenseId(store.expenses || []);
    copy.bike_id = bikeMap[x.bike_id] || x.bike_id;
    store.expenses.push(copy);
  });
  (sample.rides || []).forEach(function (r) {
    var copy = {};
    Object.keys(r).forEach(function (k) { copy[k] = r[k]; });
    copy.id = nextRideId(store.rides || []);
    copy.bike_id = bikeMap[r.bike_id] || r.bike_id;
    store.rides.push(copy);
  });
  return { bikes: Object.keys(bikeMap).length, tasks: Object.keys(taskMap).length };
}
/* ------------------------------------------------------------------ */
/* Pocket Garage handoff (receiving side) — see HANDOFF-FORMAT.md.    */
/* This app accepts kinds "diagnosis-to-task" and "timing-to-task",   */
/* delivered as a ?handoff=<base64url(JSON)> URL parameter (or pasted */
/* JSON on the Data tab). The payload is validated, the bike is       */
/* resolved by roster key first / name match second, and NOTHING is   */
/* written until the user confirms on the card. A diagnosis carries   */
/* no service interval, so a new task asks the user for one — it is   */
/* never invented. A timing job carries the factory 5,000-mile check  */
/* interval as a cited suggestion, pre-filled and editable. If the    */
/* task already exists, no duplicate is made: the confirm pre-fills   */
/* the log-service form for it instead.                               */
/* ------------------------------------------------------------------ */
var HANDOFF_FORMAT = 'pocket-garage-handoff';
var HANDOFF_VERSION = 1;
var HANDOFF_KIND_DIAGNOSIS = 'diagnosis-to-task';
var HANDOFF_KIND_TIMING = 'timing-to-task';
var HANDOFF_KIND = HANDOFF_KIND_DIAGNOSIS; /* the original kind */
var HANDOFF_KINDS = [HANDOFF_KIND_DIAGNOSIS, HANDOFF_KIND_TIMING];
var HANDOFF_MAX_CHARS = 8000;

function b64urlEncode(str) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  var s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  if (typeof Buffer !== 'undefined') return Buffer.from(s, 'base64').toString('utf8');
  return decodeURIComponent(escape(atob(s)));
}
function encodePocketHandoff(obj) {
  return b64urlEncode(JSON.stringify(obj));
}
function handoffIsNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }

function validateTimingPayload(p) {
  if (!p.timing || typeof p.timing !== 'object' || Array.isArray(p.timing)) {
    throw new Error('That handoff has no timing job in it.');
  }
  var t = p.timing;
  if (typeof t.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t.date)) {
    throw new Error('That timing job has no usable date (YYYY-MM-DD).');
  }
  if (t.ignition !== 'stock' && t.ignition !== 'dyna-2000i') {
    throw new Error('That timing job names an unknown ignition: ' + t.ignition + '.');
  }
  if (t.method !== 'static' && t.method !== 'dynamic' && t.method !== 'check') {
    throw new Error('That timing job names an unknown method: ' + t.method + '.');
  }
  var curve = (t.curve === undefined || t.curve === null) ? null : t.curve;
  if (curve !== null && (curve !== 1 && curve !== 2 && curve !== 3 && curve !== 4)) {
    throw new Error('Dyna curve in a log entry must be 1–4.');
  }
  if (curve !== null && t.ignition !== 'dyna-2000i') {
    throw new Error('That timing job has a Dyna curve on a stock ignition.');
  }
  var finalAdvance = (t.finalAdvanceDeg === undefined || t.finalAdvanceDeg === null)
    ? null : t.finalAdvanceDeg;
  if (finalAdvance !== null && (typeof finalAdvance !== 'number' || isNaN(finalAdvance))) {
    throw new Error('That timing job has a bad final advance figure.');
  }
  if (typeof t.result !== 'string') throw new Error('That handoff is missing "result".');
  if (typeof t.notes !== 'string') throw new Error('That handoff is missing "notes".');
  if (!handoffIsNonEmptyString(t.source)) throw new Error('That handoff is missing "source".');
  if (!handoffIsNonEmptyString(p.suggestedTaskName)) throw new Error('That handoff is missing "suggestedTaskName".');
  if (p.suggestedTaskName.trim().length > 80) throw new Error('That handoff\'s suggested task name is too long (max 80 characters).');
  if (typeof p.suggestedIntervalMiles !== 'number' || !(p.suggestedIntervalMiles > 0) ||
      Math.floor(p.suggestedIntervalMiles) !== p.suggestedIntervalMiles) {
    throw new Error('That handoff has no usable suggested interval in miles.');
  }
  if (!handoffIsNonEmptyString(p.intervalSource)) throw new Error('That handoff is missing "intervalSource".');
  return {
    timing: {
      date: t.date, ignition: t.ignition, method: t.method, curve: curve,
      finalAdvanceDeg: finalAdvance, result: t.result, notes: t.notes, source: t.source
    },
    suggestedTaskName: p.suggestedTaskName.trim(),
    suggestedIntervalMiles: p.suggestedIntervalMiles,
    intervalSource: p.intervalSource
  };
}

function validateDiagnosisPayload(p) {
  ['treeId', 'treeTitle', 'topCause', 'cause', 'test', 'fix', 'urgency', 'safeToRide', 'suggestedTaskName'].forEach(function (k) {
    if (!handoffIsNonEmptyString(p[k])) throw new Error('That handoff is missing "' + k + '".');
  });
  if (['low', 'medium', 'high', 'critical'].indexOf(p.urgency) === -1) throw new Error('That handoff has an unknown urgency: ' + p.urgency + '.');
  if (p.suggestedTaskName.trim().length > 80) throw new Error('That handoff\'s suggested task name is too long (max 80 characters).');
  return {
    treeId: p.treeId, treeTitle: p.treeTitle, topCause: p.topCause,
    cause: p.cause, test: p.test, fix: p.fix, urgency: p.urgency,
    safeToRide: p.safeToRide,
    suggestedTaskName: p.suggestedTaskName.trim()
  };
}

function validatePocketHandoff(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('That link is not a Pocket Garage handoff.');
  if (obj.format !== HANDOFF_FORMAT) throw new Error('That link is not a Pocket Garage handoff (wrong format).');
  if (obj.version !== HANDOFF_VERSION) throw new Error('That handoff is version ' + obj.version + ' — this app only takes version ' + HANDOFF_VERSION + '.');
  if (HANDOFF_KINDS.indexOf(obj.kind) === -1) throw new Error('This app takes diagnosis and timing handoffs, not "' + obj.kind + '".');
  if (!handoffIsNonEmptyString(obj.sentAt) || isNaN(Date.parse(obj.sentAt))) throw new Error('That handoff has no usable sent date.');
  if (!handoffIsNonEmptyString(obj.from)) throw new Error('That handoff does not say which app sent it.');
  if (!obj.bike || !handoffIsNonEmptyString(obj.bike.rosterKey)) throw new Error('That handoff does not say which bike it is for.');
  if (!handoffIsNonEmptyString(obj.bike.name)) throw new Error('That handoff has no bike name.');
  var p = obj.payload;
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('That handoff has no payload in it.');
  var payload = obj.kind === HANDOFF_KIND_TIMING ? validateTimingPayload(p) : validateDiagnosisPayload(p);
  return {
    format: obj.format, version: obj.version, kind: obj.kind,
    sentAt: obj.sentAt, from: obj.from,
    bike: { rosterKey: obj.bike.rosterKey.trim(), name: obj.bike.name.trim() },
    payload: payload
  };
}

function parsePocketHandoff(text) {
  if (text == null) throw new Error('Nothing to read — no handoff there.');
  var raw = String(text).trim();
  if (!raw) throw new Error('Nothing to read — no handoff there.');
  if (raw.length > HANDOFF_MAX_CHARS * 2) throw new Error('That handoff is too big — handoffs are one record at a time.');
  var json;
  try {
    json = raw.charAt(0) === '{' ? raw : b64urlDecode(raw);
  } catch (e) {
    throw new Error('That link is not a readable handoff — the code in it is garbled.');
  }
  if (json.length > HANDOFF_MAX_CHARS) throw new Error('That handoff is too big — handoffs are one record at a time.');
  var obj;
  try { obj = JSON.parse(json); } catch (e) { throw new Error('That link is not a Pocket Garage handoff (not JSON).'); }
  return validatePocketHandoff(obj);
}

function normalizeBikeName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function namesMatch(a, b) {
  var na = normalizeBikeName(a), nb = normalizeBikeName(b);
  if (na.length < 4 || nb.length < 4) return false;
  return na.indexOf(nb) !== -1 || nb.indexOf(na) !== -1;
}

function resolvePocketHandoffBike(store, handoff) {
  var key = handoff.bike.rosterKey;
  var ids = Object.keys(store.bikes);
  var i, b;
  for (i = 0; i < ids.length; i++) {
    b = store.bikes[ids[i]];
    /* Bikes here carry no id field of their own — the key IS the id,
     * so the resolution returns it explicitly. */
    if (b.rosterKey && b.rosterKey === key) return { status: 'matched', via: 'roster', bike: b, bikeId: ids[i] };
  }
  var hits = ids.filter(function (id) { return namesMatch(store.bikes[id].name, handoff.bike.name); });
  if (hits.length === 1) return { status: 'matched', via: 'name', bike: store.bikes[hits[0]], bikeId: hits[0] };
  return { status: 'unknown', via: null, bike: null, candidates: hits.length };
}

function pinPocketRosterKey(store, rosterKey, bikeId) {
  var bike = store.bikes[bikeId];
  if (!bike) throw new Error('Bike not found.');
  var clash = Object.keys(store.bikes).some(function (id) {
    return id !== bikeId && store.bikes[id].rosterKey === rosterKey;
  });
  if (clash) throw new Error('That roster key already belongs to another bike in this logbook.');
  bike.rosterKey = rosterKey;
  return bike;
}

/* The citation written into a task's notes (and into the log-service
 * notes when the fix is logged). Verbatim from the diagnosis, or
 * from the timing job for a timing handoff. */
function handoffCitation(handoff) {
  var p = handoff.payload;
  if (handoff.kind === HANDOFF_KIND_TIMING) {
    var t = p.timing;
    var out = 'From the Ignition Timing Helper, ' + t.date + ': ' + t.ignition + ', ' + t.method;
    if (t.curve !== null && t.curve !== undefined) out += ', curve ' + t.curve;
    if (t.finalAdvanceDeg !== null && t.finalAdvanceDeg !== undefined) out += ', ' + t.finalAdvanceDeg + '° final advance';
    out += '.';
    if (t.result) out += ' Result: ' + t.result + '.';
    if (t.notes) out += ' Notes: ' + t.notes + '.';
    out += ' Source: ' + t.source + '.';
    return out;
  }
  var date = '';
  try { date = new Date(handoff.sentAt).toISOString().slice(0, 10); } catch (e) { date = handoff.sentAt; }
  return 'From the Evo Diagnostic, ' + date + ': ' + p.treeTitle + ' — ' + p.topCause +
    '. Test: ' + p.test + '. Fix: ' + p.fix + '. Safe to ride: ' + p.safeToRide + '.';
}

/* Work out what confirming this handoff does on this bike — WITHOUT
 * writing anything. Returns { name, notes, existingTaskId } where
 * existingTaskId is set when a task with that name is already on the
 * bike (case-insensitive): then no duplicate is created and the
 * confirm pre-fills the log-service form for that task instead. */
function taskFromHandoff(store, handoff, bikeId, nameOverride) {
  var b = store.bikes[bikeId];
  if (!b) throw new Error('Pick a bike first.');
  var name = nameOverride && nameOverride.trim() ? nameOverride.trim() : handoff.payload.suggestedTaskName;
  var existingId = null;
  Object.keys(store.tasks).forEach(function (tid) {
    var t = store.tasks[tid];
    if (t.bike_id === bikeId && t.name.toLowerCase() === name.toLowerCase()) existingId = tid;
  });
  return { name: name, notes: handoffCitation(handoff), existingTaskId: existingId };
}

if (typeof document !== 'undefined') {
  var store = loadStore();
  /* Service-worker update button (sw-update.js): hidden until a new
   * version is waiting. Lives in the header — the bottom nav is fixed
   * and would cover a body-end button. Guarded so the logbook keeps
   * working if the module ever fails to load. */
  var swUpdate = (typeof PG_SWUpdate !== 'undefined')
    ? PG_SWUpdate.init({ container: document.querySelector('header.top') }) : null;
  var toastTimer = null;
  /* A validated handoff waiting on the user's confirm. In memory
   * only — never persisted, never applied without a tap. */
  var pendingHandoff = null;
  /* A receipt photo picked on the expense form, waiting for the
   * form to be submitted. In memory only until the expense saves. */
  var pendingExpensePhoto = null;

  /* Downscale a picked image to a phone-friendly receipt thumbnail
   * (longest side 1200px, JPEG) so the data URL stays small enough
   * for localStorage; retry smaller if it is still over the cap.
   * Calls done(err, photo|null) — photo is { name, type, dataUrl }.
   * Browser-only (FileReader + canvas); the cap itself is enforced
   * in the pure attachExpensePhoto, which is what gets tested. */
  function downscaleReceipt(file, done) {
    if (!file || !file.type || file.type.indexOf('image/') !== 0) {
      done(new Error('Pick an image file for the receipt photo.'));
      return;
    }
    function attempt(maxSide, quality, next) {
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          var w = Math.max(1, Math.round(img.width * scale));
          var h = Math.max(1, Math.round(img.height * scale));
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          var dataUrl = canvas.toDataURL('image/jpeg', quality);
          if (dataUrl.length > MAX_PHOTO_CHARS && next) { next(); return; }
          if (dataUrl.length > MAX_PHOTO_CHARS) {
            done(new Error('That photo is still too big after shrinking — try a closer crop.'));
            return;
          }
          done(null, { name: file.name || 'receipt', type: 'image/jpeg', dataUrl: dataUrl });
        };
        img.onerror = function () { done(new Error('Could not read that image.')); };
        img.src = reader.result;
      };
      reader.onerror = function () { done(new Error('Could not read that file.')); };
      reader.readAsDataURL(file);
    }
    attempt(1200, 0.82, function () { attempt(800, 0.70, null); });
  }

  function toast(msg, isError) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show' + (isError ? ' error' : '');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 3500);
  }

  function bikeLabel(b) {
    var label = b.name;
    var spec = [b.year || '', b.make || '', b.model || ''].join(' ').replace(/\s+/g, ' ').trim();
    if (spec) label += ' — ' + spec;
    return label;
  }

  function statusBadge(status) {
    if (status === 'overdue') return '<span class="badge overdue">OVERDUE</span>';
    if (status === 'due-soon') return '<span class="badge soon">DUE SOON</span>';
    if (status === 'not-tracked') return '<span class="badge idle">NOT TRACKED</span>';
    if (status === 'no-interval') return '<span class="badge idle">NO INTERVAL</span>';
    return '<span class="badge ok">ok</span>';
  }

  function fillBikeSelects() {
    var ids = Object.keys(store.bikes).sort(function (a, b) {
      return store.bikes[a].name.localeCompare(store.bikes[b].name);
    });
    var opts = ids.map(function (id) {
      return '<option value="' + esc(id) + '">' + esc(bikeLabel(store.bikes[id])) + '</option>';
    }).join('');
    [['due-bike', true], ['log-bike', false], ['odo-bike', false],
     ['task-bike', false], ['history-bike', true],
     ['expense-bike', true], ['expense-form-bike', false],
     ['ride-bike', true], ['ride-form-bike', false]].forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      if (!el) return;
      var keep = el.value;
      el.innerHTML = (pair[1] ? '<option value="">All bikes</option>' : '') + opts;
      if (keep && store.bikes[keep]) el.value = keep;
    });
    fillTaskSelects();
  }

  function fillTaskSelects() {
    var logBike = document.getElementById('log-bike').value;
    var histBike = document.getElementById('history-bike').value;
    function optsFor(bikeId, includeAll) {
      var ids = bikeId ? tasksForBike(store, bikeId)
        : Object.keys(store.tasks).sort(function (a, b) {
            return store.tasks[a].name.localeCompare(store.tasks[b].name);
          });
      var out = ids.map(function (id) {
        var t = store.tasks[id];
        return '<option value="' + esc(id) + '">' + esc(t.name) +
          (bikeId ? '' : ' (' + esc(store.bikes[t.bike_id] ? store.bikes[t.bike_id].name : '?') + ')') + '</option>';
      }).join('');
      return (includeAll ? '<option value="">All tasks</option>' : '') + out;
    }
    var logTask = document.getElementById('log-task');
    var keepLog = logTask.value;
    logTask.innerHTML = optsFor(logBike, false);
    if (keepLog && store.tasks[keepLog]) logTask.value = keepLog;
    var histTask = document.getElementById('history-task');
    var keepHist = histTask.value;
    histTask.innerHTML = optsFor(histBike, true);
    if (keepHist && store.tasks[keepHist]) histTask.value = keepHist;
  }

  /* Shared by the reminders card and the full Due list: a Log button
   * pre-fills the service form for that bike + task. */
  function wireLogButtons(box) {
    box.querySelectorAll('[data-log-task]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.getElementById('log-bike').value = btn.getAttribute('data-log-bike');
        fillTaskSelects();
        document.getElementById('log-task').value = btn.getAttribute('data-log-task');
        document.getElementById('log-date').value = todayISO();
        var b = store.bikes[btn.getAttribute('data-log-bike')];
        document.getElementById('log-odometer').value = b ? Math.round(b.odometer) : '';
        document.querySelector('[data-view="due"]').scrollIntoView();
        document.getElementById('log-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
        document.getElementById('log-notes').focus();
      });
    });
  }

  /* Reminders, shown at the top of the Due tab on open: only the
   * overdue and due-soon tasks, worst first, with the counts up
   * front. The full list (including ok tasks) is still below. */
  function renderReminders() {
    var box = document.getElementById('reminders');
    if (!box) return;
    if (!Object.keys(store.bikes).length) {
      box.innerHTML = '';
      return;
    }
    var bikeId = document.getElementById('due-bike').value || null;
    var rem = dueReminders(store, bikeId, todayISO());
    if (!rem.total) {
      box.innerHTML = '<div class="card reminders"><h3>Reminders</h3>' +
        '<p><span class="badge ok">all caught up</span> Nothing overdue or due soon.</p></div>';
      return;
    }
    var html = '<div class="card reminders' + (rem.overdueCount ? ' attention' : '') + '"><h3>Reminders</h3>' +
      '<p>' +
      (rem.overdueCount ? '<span class="badge overdue">' + rem.overdueCount + ' overdue</span> ' : '') +
      (rem.dueSoonCount ? '<span class="badge soon">' + rem.dueSoonCount + ' due soon</span>' : '') +
      '</p>';
    rem.rows.forEach(function (row) {
      var b = store.bikes[row.bike_id];
      var t = store.tasks[row.task_id];
      html += '<div class="taskrow">' + statusBadge(row.status) + ' <b>' + esc(t.name) + '</b>' +
        ' <span class="muted">on ' + esc(b.name) + ' (' + esc(intervalLabel(t)) + ')</span>' +
        ' <button class="mini secondary" data-log-bike="' + esc(row.bike_id) +
        '" data-log-task="' + esc(row.task_id) + '">Log</button>';
      row.details.forEach(function (d) {
        html += '<div class="detail">' + esc(d) + '</div>';
      });
      html += '</div>';
    });
    html += '</div>';
    box.innerHTML = html;
    wireLogButtons(box);
  }

  function renderDue() {
    var bikeId = document.getElementById('due-bike').value || null;
    var box = document.getElementById('due-list');
    if (!Object.keys(store.bikes).length) {
      box.innerHTML = '<p class="card">No bikes yet — add one on the <b>Bikes &amp; Tasks</b> tab.</p>';
      return;
    }
    var rows = dueRows(store, bikeId, todayISO());
    if (!rows.length) {
      box.innerHTML = '<p class="card">No tasks yet — add one on the <b>Bikes &amp; Tasks</b> tab.</p>';
      return;
    }
    var html = '';
    var currentBike = null;
    rows.forEach(function (row) {
      var b = store.bikes[row.bike_id];
      var t = store.tasks[row.task_id];
      if (row.bike_id !== currentBike) {
        if (currentBike !== null) html += '</div>';
        currentBike = row.bike_id;
        html += '<div class="card"><h4>' + esc(b.name) + ' — odo ' + fmtMiles(b.odometer) + '</h4>';
      }
      html += '<div class="taskrow">' + statusBadge(row.status) + ' <b>' + esc(t.name) + '</b>' +
        ' <span class="muted">(' + esc(intervalLabel(t)) + ')</span>' +
        ' <button class="mini secondary" data-log-bike="' + esc(row.bike_id) +
        '" data-log-task="' + esc(row.task_id) + '">Log</button>';
      row.details.forEach(function (d) {
        html += '<div class="detail">' + esc(d) + '</div>';
      });
      if (t.notes) html += '<div class="detail">' + esc(t.notes) + '</div>';
      html += '</div>';
    });
    html += '</div>';
    box.innerHTML = html;
    wireLogButtons(box);
  }

  /* Wear clocks — one clock per wear component for the bike(s) the
   * Due tab is filtered to. Tracked clocks show the live due state
   * from the logged services; not-tracked ones show the published
   * interval and how to start the clock. */
  function renderWearClocks() {
    var box = document.getElementById('wear-clocks');
    if (!box) return;
    if (!Object.keys(store.bikes).length) { box.innerHTML = ''; return; }
    var picked = document.getElementById('due-bike').value || null;
    var bikeIds = picked ? [picked]
      : Object.keys(store.bikes).sort(function (a, b) {
          return store.bikes[a].name.localeCompare(store.bikes[b].name);
        });
    var html = '';
    bikeIds.forEach(function (bid) {
      if (!store.bikes[bid]) return;
      var b = store.bikes[bid];
      var clocks = wearClocks(store, bid, todayISO());
      html += '<div class="card"><h4>Wear clocks — ' + esc(b.name) + '</h4>' +
        '<p class="muted">One clock per wear part, from the factory interval in your manual. ' +
        'A clock runs off the services you logged; add the task to start one that is not tracked yet.</p>';
      clocks.forEach(function (c) {
        html += '<div class="taskrow">' + statusBadge(c.status) + ' <b>' + esc(c.component) + '</b>' +
          (c.interval ? ' <span class="muted">(' + esc(c.interval) + ')</span>' : '');
        if (c.taskId) {
          html += ' <button class="mini secondary" data-log-bike="' + esc(bid) +
            '" data-log-task="' + esc(c.taskId) + '">Log</button>';
        }
        c.details.forEach(function (d) {
          html += '<div class="detail">' + esc(d) + '</div>';
        });
        html += '<div class="detail">' + esc(c.about) + '</div>';
        if (c.source) html += '<div class="detail">' + esc(c.source) + '</div>';
        html += '</div>';
      });
      html += '<p class="muted">The tire-age clock runs off the DOT manufacture date you enter on the ' +
        'Bikes &amp; Tasks tab — set it once per bike and the clock counts from there. ' +
        'No clock for parts with no published interval: drive chain ' +
        '(the factory tables are belt-drive — add a task from your manual if yours has a chain), ' +
        'coolant (air-cooled — no cooling system).</p></div>';
    });
    box.innerHTML = html;
    wireLogButtons(box);
  }

  function renderBikes() {
    var box = document.getElementById('bikes-list');
    var ids = Object.keys(store.bikes).sort(function (a, b) {
      return store.bikes[a].name.localeCompare(store.bikes[b].name);
    });
    if (!ids.length) {
      box.innerHTML = '<p class="card">No bikes yet — add your first one below.</p>';
      return;
    }
    var html = '';
    ids.forEach(function (bid) {
      var b = store.bikes[bid];
      html += '<div class="card"><div class="bikerow"><b>' + esc(bikeLabel(b)) + '</b>' +
        ' <button class="mini danger" data-del-bike="' + esc(bid) + '">Delete</button>' +
        '<div class="detail">odo ' + fmtMiles(b.odometer) + ' (as of ' + fmtDate(b.odometer_date) + ')</div>';
      if (b.notes) html += '<div class="detail">' + esc(b.notes) + '</div>';
      /* Tire manufacture date for the tire-age clock: one date per
       * bike. A date input, or a 3–4 digit DOT code (decoded the
       * same way the Evo Diagnostic's tire reader does it) — a DOT
       * code wins over the date field when both are filled, so
       * typing a code over a stored date replaces it. */
      var tireClock = tireAgeClock(store, bid, todayISO());
      html += '<div class="detail"><b>Tire age:</b> ' +
        (b.tire_made ? esc(tireClock.details[0]) + ' ' + statusBadge(tireClock.status)
          : 'no date entered') + '</div>' +
        '<div class="detail"><label>Tire manufacture date ' +
        '<input type="date" data-tire-date="' + esc(bid) + '" value="' + esc(b.tire_made || '') + '"></label> ' +
        '<label>or DOT code <input type="text" data-tire-dot="' + esc(bid) + '" inputmode="numeric" placeholder="e.g. 5107" maxlength="4" size="6"></label> ' +
        '<button class="mini secondary" data-save-tire="' + esc(bid) + '">Save tire date</button>' +
        (b.tire_made ? ' <button class="mini secondary" data-clear-tire="' + esc(bid) + '">Clear</button>' : '') + '</div>';
      html += '</div>';
      var tids = tasksForBike(store, bid);
      if (!tids.length) {
        html += '<div class="detail">No tasks yet for this bike.</div>';
      }
      tids.forEach(function (tid) {
        var t = store.tasks[tid];
        var st = taskStatus(store, bid, tid, todayISO());
        html += '<div class="taskrow">' + statusBadge(st.status) + ' <b>' + esc(t.name) + '</b>' +
          ' <span class="muted">(' + esc(intervalLabel(t)) + ')</span>' +
          ' <button class="mini danger" data-del-task="' + esc(tid) + '">Delete</button>' +
          '<div class="detail">' + esc(st.details.join(' · ')) + '</div>';
        if (t.notes) html += '<div class="detail">' + esc(t.notes) + '</div>';
        html += '</div>';
      });
      html += '</div>';
    });
    box.innerHTML = html;
    box.querySelectorAll('[data-del-bike]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var bid = btn.getAttribute('data-del-bike');
        if (!window.confirm('Delete "' + store.bikes[bid].name + '" and ALL its tasks and history?')) return;
        removeBike(store, bid);
        saveStore(store);
        renderAll();
        toast('Bike deleted.');
      });
    });
    box.querySelectorAll('[data-save-tire]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var bid = btn.getAttribute('data-save-tire');
        var dateEl = box.querySelector('[data-tire-date="' + bid + '"]');
        var dotEl = box.querySelector('[data-tire-dot="' + bid + '"]');
        /* A DOT code wins when both are filled, so typing a code
         * over a stored date replaces it. */
        var val = (dotEl && dotEl.value.trim()) || (dateEl && dateEl.value) || '';
        if (!val) { toast('Enter a manufacture date or a DOT code first.', true); return; }
        try {
          setTireDate(store, bid, val);
          saveStore(store);
          renderAll();
          toast('Tire date saved.');
        } catch (e) { toast(e.message, true); }
      });
    });
    box.querySelectorAll('[data-clear-tire]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var bid = btn.getAttribute('data-clear-tire');
        setTireDate(store, bid, '');
        saveStore(store);
        renderAll();
        toast('Tire date cleared.');
      });
    });
  }

  function renderHistory() {
    var bikeId = document.getElementById('history-bike').value || null;
    var taskId = document.getElementById('history-task').value || null;
    var list = historyEntries(store, bikeId, taskId);
    var totalEl = document.getElementById('history-total');
    if (!list.length) {
      totalEl.textContent = 'No service history yet.';
      document.getElementById('history-list').innerHTML = '';
      return;
    }
    var total = historyTotal(list);
    totalEl.innerHTML = list.length + ' service' + (list.length === 1 ? '' : 's') +
      (total ? ' — total ' + fmtMoney(total) : '');
    var html = '<div class="card">';
    list.forEach(function (e) {
      var b = store.bikes[e.bike_id];
      var t = store.tasks[e.task_id];
      html += '<div class="entry"><header><b>' + fmtDate(e.date) + '</b> — ' +
        esc(t ? t.name : '?') + ' on ' + esc(b ? b.name : '?') +
        ' @ ' + fmtMiles(e.odometer) +
        (e.cost != null ? ' — ' + fmtMoney(e.cost) : '') + '</header>';
      if (e.notes) html += '<div class="detail">' + esc(e.notes) + '</div>';
      html += '</div>';
    });
    html += '</div>';
    document.getElementById('history-list').innerHTML = html;
  }

  function renderExpenses() {
    var bikeId = document.getElementById('expense-bike').value || null;
    var category = document.getElementById('expense-category').value || null;
    var list = expensesForBike(store, bikeId, category);
    var totalEl = document.getElementById('expense-total');
    var allForBike = expensesForBike(store, bikeId, null);
    var total = expenseTotal(allForBike);
    var byCat = expensesByCategory(allForBike);
    var catParts = [];
    EXPENSE_CATEGORIES.forEach(function (cat) {
      if (byCat[cat]) catParts.push(expenseCategoryLabel(cat) + ' ' + fmtMoney(byCat[cat]));
    });
    if (!Object.keys(store.bikes).length) {
      totalEl.textContent = 'No bikes yet — add one on the Bikes & Tasks tab.';
      document.getElementById('expense-list').innerHTML = '';
      return;
    }
    totalEl.innerHTML = allForBike.length + ' expense' + (allForBike.length === 1 ? '' : 's') +
      (total ? ' — total ' + fmtMoney(total) : ' — nothing spent yet') +
      (catParts.length ? ' <span class="muted">(' + esc(catParts.join(' · ')) + ')</span>' : '');
    if (!list.length) {
      document.getElementById('expense-list').innerHTML =
        '<p class="card">No expenses match — log one below.</p>';
      return;
    }
    var html = '<div class="card">';
    list.forEach(function (x) {
      var b = store.bikes[x.bike_id];
      html += '<div class="entry"><header><b>' + fmtDate(x.date) + '</b> — ' +
        esc(expenseCategoryLabel(x.category)) + ' — ' + esc(x.description) +
        ' — ' + fmtMoney(x.cost) + '</header>' +
        '<div class="detail">' + esc(b ? b.name : '?') +
        (x.odometer != null ? ' @ ' + fmtMiles(x.odometer) : '') + '</div>';
      if (x.notes) html += '<div class="detail">' + esc(x.notes) + '</div>';
      /* Receipt photo: attach-only, no OCR. A thumbnail + full-size
       * view + remove when one is attached; an attach picker when
       * there is not. The photo lives on the expense in localStorage. */
      if (x.photo) {
        html += '<div class="receipt-thumb"><a href="' + esc(x.photo.dataUrl) +
          '" target="_blank" rel="noopener"><img src="' + esc(x.photo.dataUrl) +
          '" alt="Receipt photo for ' + esc(x.description) + '"></a></div>' +
          '<div class="detail">Receipt photo attached' +
          (x.photo.name ? ' — ' + esc(x.photo.name) : '') +
          ' (<a href="' + esc(x.photo.dataUrl) + '" target="_blank" rel="noopener">view full size</a>)</div>' +
          '<button class="mini secondary" data-remove-photo="' + esc(x.id) + '">Remove photo</button>';
      } else {
        html += '<div class="detail"><label>Receipt photo ' +
          '<input type="file" accept="image/*" capture="environment" data-attach-photo="' + esc(x.id) + '"></label></div>';
      }
      html += '<button class="mini danger" data-del-expense="' + esc(x.id) + '">Delete</button>';
      html += '</div>';
    });
    html += '</div>';
    var box = document.getElementById('expense-list');
    box.innerHTML = html;
    box.querySelectorAll('[data-del-expense]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var xid = btn.getAttribute('data-del-expense');
        var x = (store.expenses || []).filter(function (e) { return e.id === xid; })[0];
        if (!x) return;
        if (!window.confirm('Delete this expense — ' + x.description + ' (' + fmtMoney(x.cost) + ')?')) return;
        removeExpense(store, xid);
        saveStore(store);
        renderAll();
        toast('Expense deleted.');
      });
    });
  }

  function renderRides() {
    var bikeId = document.getElementById('ride-bike').value || null;
    var list = ridesForBike(store, bikeId);
    var totalEl = document.getElementById('ride-total');
    var total = rideTotalMiles(list);
    if (!Object.keys(store.bikes).length) {
      totalEl.textContent = 'No bikes yet — add one on the Bikes & Tasks tab.';
      document.getElementById('ride-list').innerHTML = '';
      return;
    }
    totalEl.innerHTML = list.length + ' ride' + (list.length === 1 ? '' : 's') +
      (total ? ' — total ' + fmtRideMiles(total) : ' — no miles logged yet');
    if (!list.length) {
      document.getElementById('ride-list').innerHTML =
        '<p class="card">No rides match — log one below.</p>';
      return;
    }
    var html = '<div class="card">';
    list.forEach(function (r) {
      var b = store.bikes[r.bike_id];
      html += '<div class="entry"><header><b>' + fmtDate(r.date) + '</b> — ' +
        esc(r.route) + ' — ' + fmtRideMiles(r.miles) + '</header>' +
        '<div class="detail">' + esc(b ? b.name : '?') + '</div>';
      if (r.notes) html += '<div class="detail">' + esc(r.notes) + '</div>';
      html += '<button class="mini danger" data-del-ride="' + esc(r.id) + '">Delete</button>';
      html += '</div>';
    });
    html += '</div>';
    var box = document.getElementById('ride-list');
    box.innerHTML = html;
    box.querySelectorAll('[data-del-ride]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var rid = btn.getAttribute('data-del-ride');
        var r = (store.rides || []).filter(function (e) { return e.id === rid; })[0];
        if (!r) return;
        if (!window.confirm('Delete this ride — ' + r.route + ' (' + fmtRideMiles(r.miles) + ')?')) return;
        removeRide(store, rid);
        saveStore(store);
        renderAll();
        toast('Ride deleted.');
      });
    });
  }

  function renderData() {
    var bikes = Object.keys(store.bikes).length;
    var tasks = Object.keys(store.tasks).length;
    var entries = store.entries.length;
    var spent = historyTotal(store.entries);
    var expenses = (store.expenses || []).length;
    var expenseSpent = expenseTotal(store.expenses || []);
    var rides = (store.rides || []).length;
    var rideMiles = rideTotalMiles(store.rides || []);
    document.getElementById('data-counts').textContent =
      bikes + ' bike' + (bikes === 1 ? '' : 's') + ', ' +
      tasks + ' task' + (tasks === 1 ? '' : 's') + ', ' +
      entries + ' service' + (entries === 1 ? '' : 's') + ' logged' +
      (spent ? ', ' + fmtMoney(spent) + ' total spent' : '') +
      (expenses ? ', ' + expenses + ' expense' + (expenses === 1 ? '' : 's') +
        ' logged (' + fmtMoney(expenseSpent) + ')' : '') +
      (rides ? ', ' + rides + ' ride' + (rides === 1 ? '' : 's') +
        ' logged (' + fmtRideMiles(rideMiles) + ')' : '') + '.';
  }

  function renderAll() {
    fillBikeSelects();
    renderReminders();
    renderDue();
    renderWearClocks();
    renderBikes();
    renderHistory();
    renderExpenses();
    renderRides();
    renderData();
  }

  /* ---------------------------------------------------------------- */
  /* Handoff UI — confirm card + URL / paste intake. Nothing is      */
  /* written until the user taps confirm.                             */
  /* ---------------------------------------------------------------- */
  function handoffSentDate(handoff) {
    try {
      var iso = new Date(handoff.sentAt).toISOString().slice(0, 10);
      return fmtDate(iso);
    } catch (e) { return handoff.sentAt; }
  }

  function renderHandoffBox() {
    var box = document.getElementById('handoff-box');
    if (!box) return;
    if (!pendingHandoff) { box.innerHTML = ''; return; }
    if (pendingHandoff.error) {
      box.innerHTML = '<div class="card"><h3>Handoff could not be read</h3>' +
        '<p>' + esc(pendingHandoff.error) + '</p>' +
        '<p class="muted">Nothing was changed. Ask the sending app for a fresh link.</p>' +
        '<button type="button" class="secondary" data-handoff-dismiss>Dismiss</button></div>';
      return;
    }
    var handoff = pendingHandoff.handoff;
    var p = handoff.payload;
    var res = pendingHandoff.resolution;
    var isTiming = handoff.kind === HANDOFF_KIND_TIMING;
    var html;
    if (isTiming) {
      var t = p.timing;
      html = '<div class="card"><h3>Timing job arrived — from the Ignition Timing Helper</h3>' +
        '<p><b>' + esc(t.ignition === 'dyna-2000i' ? 'Dyna 2000i' : 'Stock module') + ' · ' + esc(t.method) + '</b> · ' + esc(t.date) + ' · sent ' + esc(handoffSentDate(handoff)) + '</p>' +
        (t.curve !== null ? '<p><b>Curve:</b> ' + esc(t.curve) + (t.finalAdvanceDeg !== null ? ' · <b>Final advance:</b> ' + esc(t.finalAdvanceDeg) + '°' : '') + '</p>' : '') +
        (t.curve === null && t.finalAdvanceDeg !== null ? '<p><b>Final advance:</b> ' + esc(t.finalAdvanceDeg) + '°</p>' : '') +
        (t.result ? '<p><b>Result:</b> ' + esc(t.result) + '</p>' : '') +
        (t.notes ? '<p class="muted">' + esc(t.notes) + '</p>' : '') +
        '<p class="muted">Source: ' + esc(t.source) + '</p>';
    } else {
      html = '<div class="card"><h3>Diagnosis arrived — from the Evo Diagnostic</h3>' +
        '<p><b>' + esc(p.topCause) + '</b></p>' +
        '<p>' + esc(p.treeTitle) + ' · sent ' + esc(handoffSentDate(handoff)) + '</p>' +
        '<p><b>Test:</b> ' + esc(p.test) + '</p>' +
        '<p><b>Fix:</b> ' + esc(p.fix) + '</p>' +
        '<p><b>Safe to ride?</b> ' + esc(p.safeToRide) + '</p>';
    }
    var bikeId = null, draft = null;
    if (res.status === 'matched') {
      bikeId = res.bikeId;
      html += '<p><b>For:</b> ' + esc(res.bike.name) + ' <span class="muted">(matched by ' +
        (res.via === 'roster' ? 'roster key ' + esc(handoff.bike.rosterKey) : 'name') + ')</span></p>';
      draft = taskFromHandoff(store, handoff, bikeId);
    } else {
      var bikeIds = Object.keys(store.bikes).sort(function (a, b) {
        return store.bikes[a].name.localeCompare(store.bikes[b].name);
      });
      if (!bikeIds.length) {
        html += '<p class="muted">No bikes in this logbook yet — add the bike under Bikes &amp; Tasks first, then open the link again.</p>';
        box.innerHTML = html + '<button type="button" class="secondary" data-handoff-dismiss>Dismiss</button></div>';
        return;
      }
      html += '<p class="muted">This handoff is for "' + esc(handoff.bike.name) + '" — no bike here matches it yet. Which bike is it for?</p>' +
        '<label>Bike<select id="handoff-bike">' +
        bikeIds.map(function (id) {
          return '<option value="' + esc(id) + '">' + esc(bikeLabel(store.bikes[id])) + '</option>';
        }).join('') + '</select></label>' +
        '<p class="muted">Picking a bike pins it to roster key ' + esc(handoff.bike.rosterKey) + ', so the next handoff for this bike lands without asking.</p>';
    }
    html += '<label>Task name<input type="text" id="handoff-task-name" value="' + esc(p.suggestedTaskName) + '" maxlength="80"></label>';
    if (draft && draft.existingTaskId) {
      html += '<p><b>A task called "' + esc(draft.name) + '" is already on this bike</b> — confirming will not add a duplicate. It pre-fills the log-service form for that task instead, so you can log the work when it is done.</p>';
    } else if (isTiming) {
      html += '<p class="muted">The factory check interval is ' + esc(p.suggestedIntervalMiles) + ' miles — pre-filled from ' + esc(p.intervalSource) + '. Change it if this bike is on a different schedule. (Only needed for a new task.)</p>' +
        '<div class="grid"><label>Every (miles)<input type="number" id="handoff-miles" inputmode="numeric" min="1" step="1" value="' + esc(p.suggestedIntervalMiles) + '"></label>' +
        '<label>Every (months)<input type="number" id="handoff-months" inputmode="numeric" min="1" step="1" placeholder="e.g. 6"></label></div>';
    } else {
      html += '<p class="muted">A diagnosis carries no service interval, so set one — miles or months, at least one — or this task has no due date. (Only needed for a new task.)</p>' +
        '<div class="grid"><label>Every (miles)<input type="number" id="handoff-miles" inputmode="numeric" min="1" step="1" placeholder="e.g. 5000"></label>' +
        '<label>Every (months)<input type="number" id="handoff-months" inputmode="numeric" min="1" step="1" placeholder="e.g. 6"></label></div>';
    }
    html += '<button type="button" class="primary" data-handoff-confirm>' +
      (draft && draft.existingTaskId ? 'Log a service for this task' : 'Add task') + '</button> ' +
      '<button type="button" class="secondary" data-handoff-dismiss>Dismiss — do nothing</button></div>';
    box.innerHTML = html;
    if (isTiming && !(draft && draft.existingTaskId)) {
      /* Add stays disabled until an interval is given. The suggested
       * 5,000 miles is pre-filled, so the button starts enabled and
       * only disables if the user clears both fields. */
      var milesEl = document.getElementById('handoff-miles');
      var monthsEl = document.getElementById('handoff-months');
      var confirmBtn = box.querySelector('[data-handoff-confirm]');
      var syncInterval = function () {
        if (confirmBtn) confirmBtn.disabled = !(milesEl.value || monthsEl.value);
      };
      if (milesEl) milesEl.addEventListener('input', syncInterval);
      if (monthsEl) monthsEl.addEventListener('input', syncInterval);
      syncInterval();
    }
  }

  function receiveHandoff(text) {
    try {
      var handoff = parsePocketHandoff(text);
      pendingHandoff = { handoff: handoff, resolution: resolvePocketHandoffBike(store, handoff), error: null };
      renderHandoffBox();
    } catch (err) {
      pendingHandoff = { handoff: null, resolution: null, error: err.message };
      renderHandoffBox();
    }
  }

  function checkHandoffFromUrl() {
    var raw = null;
    try { raw = new URLSearchParams(window.location.search).get('handoff'); } catch (e) { return; }
    if (!raw) return;
    try { history.replaceState(null, '', window.location.pathname); } catch (e) { /* harmless */ }
    receiveHandoff(raw);
  }

  function prefillLogForm(bikeId, taskId, notes, dateOverride) {
    document.getElementById('log-bike').value = bikeId;
    fillTaskSelects();
    document.getElementById('log-task').value = taskId;
    document.getElementById('log-date').value = dateOverride || todayISO();
    var b = store.bikes[bikeId];
    document.getElementById('log-odometer').value = b ? Math.round(b.odometer) : '';
    var notesEl = document.getElementById('log-notes');
    if (notesEl && !notesEl.value) notesEl.value = notes;
    document.getElementById('log-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (notesEl) notesEl.focus();
  }

  function confirmHandoff() {
    if (!pendingHandoff || !pendingHandoff.handoff) return;
    var handoff = pendingHandoff.handoff;
    var bikeId = null;
    if (pendingHandoff.resolution && pendingHandoff.resolution.status === 'matched') {
      bikeId = pendingHandoff.resolution.bikeId;
    } else {
      var sel = document.getElementById('handoff-bike');
      bikeId = sel ? sel.value : null;
    }
    if (!bikeId || !store.bikes[bikeId]) { toast('Pick which bike this handoff is for.', true); return; }
    var nameEl = document.getElementById('handoff-task-name');
    var name = nameEl ? nameEl.value.trim() : handoff.payload.suggestedTaskName;
    if (!name) { toast('Give the task a name.', true); return; }
    var draft;
    try { draft = taskFromHandoff(store, handoff, bikeId, name); }
    catch (err) { toast(err.message, true); return; }
    var milesEl = document.getElementById('handoff-miles');
    var monthsEl = document.getElementById('handoff-months');
    var miles = milesEl ? milesEl.value : '';
    var months = monthsEl ? monthsEl.value : '';
    if (!draft.existingTaskId && (!miles && !months)) {
      toast('Give the task an interval — miles or months — or it has no due date.', true);
      return;
    }
    var taskId = draft.existingTaskId;
    try {
      pinPocketRosterKey(store, handoff.bike.rosterKey, bikeId);
      if (!taskId) {
        addTask(store, {
          bike_id: bikeId, name: draft.name,
          every_miles: miles, every_months: months, notes: draft.notes
        });
        taskId = Object.keys(store.tasks).filter(function (tid) {
          var t = store.tasks[tid];
          return t.bike_id === bikeId && t.name.toLowerCase() === draft.name.toLowerCase();
        })[0];
      }
      saveStore(store);
    } catch (err) { toast(err.message, true); return; }
    pendingHandoff = null;
    renderAll();
    renderHandoffBox();
    /* A timing handoff pre-fills the timing job's own date; a
     * diagnosis has no job date, so the form takes today. */
    var serviceDate = handoff.kind === HANDOFF_KIND_TIMING ? handoff.payload.timing.date : null;
    prefillLogForm(bikeId, taskId, draft.notes, serviceDate);
    toast(draft.existingTaskId
      ? 'That task is already on this bike — the log form is pre-filled for it.'
      : 'Task added — the log form is pre-filled so you can log the work when it is done.');
  }

  function showView(name) {
    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
    document.getElementById('view-' + name).classList.add('active');
    document.querySelectorAll('.navbtn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === name);
    });
  }

  document.querySelectorAll('.navbtn').forEach(function (btn) {
    btn.addEventListener('click', function () { showView(btn.getAttribute('data-view')); });
  });

  document.getElementById('due-bike').addEventListener('change', function () {
    renderReminders();
    renderDue();
    renderWearClocks();
  });
  document.getElementById('log-bike').addEventListener('change', fillTaskSelects);
  document.getElementById('history-bike').addEventListener('change', function () {
    fillTaskSelects();
    renderHistory();
  });
  document.getElementById('history-task').addEventListener('change', renderHistory);
  document.getElementById('expense-bike').addEventListener('change', renderExpenses);
  document.getElementById('expense-category').addEventListener('change', renderExpenses);

  document.getElementById('log-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    try {
      var res = logService(store, {
        bike_id: document.getElementById('log-bike').value,
        task_id: document.getElementById('log-task').value,
        date: document.getElementById('log-date').value,
        odometer: document.getElementById('log-odometer').value,
        cost: document.getElementById('log-cost').value,
        notes: document.getElementById('log-notes').value
      });
      saveStore(store);
      renderAll();
      document.getElementById('log-cost').value = '';
      document.getElementById('log-notes').value = '';
      toast(res.warned
        ? 'Logged — note: that reading is below the recorded odometer, which was left alone.'
        : 'Service logged.');
    } catch (e) { toast(e.message, true); }
  });

  /* Common-bike picker: brand -> model fills Make / Model / Name.
   * The text fields stay editable, so anything not listed is still
   * a plain typed entry. */
  (function () {
    var brandSel = document.getElementById('bike-brand-pick');
    var modelSel = document.getElementById('bike-model-pick');
    if (!brandSel || !modelSel) return;
    /* What the picker last filled in — so a brand switch can clear
     * only the picker's own values, never anything the user typed. */
    var lastPick = { brand: '', model: '' };
    commonBrands().forEach(function (b) {
      var o = document.createElement('option');
      o.value = b; o.textContent = b;
      brandSel.appendChild(o);
    });
    var otherBrand = document.createElement('option');
    otherBrand.value = 'other'; otherBrand.textContent = 'Other / not listed — type it below';
    brandSel.appendChild(otherBrand);
    function resetModels(prompt) {
      modelSel.innerHTML = '';
      modelSel.disabled = true;
      var o = document.createElement('option');
      o.value = ''; o.textContent = prompt;
      modelSel.appendChild(o);
    }
    brandSel.addEventListener('change', function () {
      var brand = brandSel.value;
      /* Switching brands drops the previous pick's leftovers. Typed
       * values that differ from the pick survive. */
      var makeEl = document.getElementById('bike-make');
      var modelEl = document.getElementById('bike-model');
      var nameEl = document.getElementById('bike-name');
      if (lastPick.brand && makeEl.value === lastPick.brand) makeEl.value = '';
      if (lastPick.model && modelEl.value === lastPick.model) modelEl.value = '';
      if (lastPick.model && nameEl.value === lastPick.model) nameEl.value = '';
      lastPick = { brand: '', model: '' };
      var hint = document.getElementById('bike-schedule-hint');
      if (hint) hint.textContent = '';
      if (!brand || brand === 'other') { resetModels(brand === 'other' ? '— Type the model below —' : '— Pick a brand first —'); return; }
      modelSel.innerHTML = '';
      modelSel.disabled = false;
      var ph = document.createElement('option');
      ph.value = ''; ph.textContent = '— Pick a model —';
      modelSel.appendChild(ph);
      var lastFamily = null, group = null;
      commonModels(brand).forEach(function (entry) {
        if (entry.family !== lastFamily) {
          group = document.createElement('optgroup');
          group.label = entry.family;
          modelSel.appendChild(group);
          lastFamily = entry.family;
        }
        var o = document.createElement('option');
        o.value = entry.model; o.textContent = entry.model;
        group.appendChild(o);
      });
      var other = document.createElement('option');
      other.value = 'other'; other.textContent = 'Other / not listed — type it below';
      modelSel.appendChild(other);
    });
    modelSel.addEventListener('change', function () {
      var brand = brandSel.value, model = modelSel.value;
      if (!brand || !model || model === 'other') return;
      document.getElementById('bike-make').value = brand;
      document.getElementById('bike-model').value = model;
      var nameEl = document.getElementById('bike-name');
      if (!nameEl.value.trim()) nameEl.value = model;
      lastPick = { brand: brand, model: model };
      /* Factory-schedule hint: a model with a sourced schedule says
       * so (and which years it covers); anything else says plainly
       * that there is none, so the user adds tasks from the manual. */
      var hint = document.getElementById('bike-schedule-hint');
      if (hint) {
        var sched = factoryScheduleModel(brand, model);
        hint.textContent = sched
          ? 'Factory schedule on file: ' + sched.label + ' (' + sched.shortSource + '). Enter the year and the task list fills in when you save the bike.'
          : 'No factory schedule on file for this model — add tasks from your manual.';
      }
    });
  })();

  document.getElementById('bike-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    try {
      var bike = addBike(store, {
        name: document.getElementById('bike-name').value,
        year: document.getElementById('bike-year').value,
        make: document.getElementById('bike-make').value,
        model: document.getElementById('bike-model').value,
        odometer: document.getElementById('bike-odometer').value,
        notes: document.getElementById('bike-notes').value
      });
      /* Factory auto-fill: the new bike's task list fills from its
       * sourced schedule when one matches (make + model + year).
       * It only adds tasks the bike does not have — nothing the
       * user set is ever touched. */
      var bid = Object.keys(store.bikes).filter(function (id) { return store.bikes[id] === bike; })[0];
      var filled = applyFactorySchedule(store, bid);
      saveStore(store);
      renderAll();
      ev.target.reset();
      var hintEl = document.getElementById('bike-schedule-hint');
      if (hintEl) hintEl.textContent = '';
      if (filled.schedule && filled.added > 0) {
        toast('Bike added — ' + filled.added + ' factory tasks filled in (' + filled.schedule.shortSource + ').');
      } else if (filled.schedule) {
        toast('Bike added — factory tasks already there.');
      } else if (factoryScheduleModel(bike.make, bike.model)) {
        toast('Bike added — factory schedule covers ' + factoryScheduleModel(bike.make, bike.model).years[0] + '–' + factoryScheduleModel(bike.make, bike.model).years[1] + '; add the year to auto-fill.');
      } else {
        toast('Bike added.');
      }
    } catch (e) { toast(e.message, true); }
  });

  document.getElementById('odo-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    try {
      var res = setOdometer(store,
        document.getElementById('odo-bike').value,
        document.getElementById('odo-miles').value,
        document.getElementById('odo-date').value || todayISO());
      saveStore(store);
      renderAll();
      toast(res.warned
        ? 'Saved — that reading is below the recorded odometer (kept as entered).'
        : 'Odometer saved.');
    } catch (e) { toast(e.message, true); }
  });

  document.getElementById('task-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    try {
      addTask(store, {
        bike_id: document.getElementById('task-bike').value,
        name: document.getElementById('task-name').value,
        every_miles: document.getElementById('task-miles').value,
        every_months: document.getElementById('task-months').value,
        notes: document.getElementById('task-notes').value
      });
      saveStore(store);
      renderAll();
      ev.target.reset();
      toast('Task added — due dates count from today until its first service is logged.');
    } catch (e) { toast(e.message, true); }
  });

  var quickBox = document.getElementById('task-quick');
  QUICK_TASKS.forEach(function (name) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quick';
    btn.textContent = name;
    btn.addEventListener('click', function () {
      document.getElementById('task-name').value = name;
      document.getElementById('task-name').focus();
    });
    quickBox.appendChild(btn);
  });

  function exportJSON() {
    return JSON.stringify(store, null, 2) + '\n';
  }

  function downloadFile(filename, text, mime) {
    var blob = new Blob([text], { type: mime });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  document.getElementById('export-btn').addEventListener('click', function () {
    downloadFile('bike-log-data.json', exportJSON(), 'application/json');
    toast('Backup downloaded.');
  });

  /* Per-bike service history export: the bike picked in the History
   * filter above. "All bikes" is not one bike — pick one first. */
  function historyExportBike() {
    var bikeId = document.getElementById('history-bike').value || null;
    if (!bikeId) { toast('Pick a bike first — history export is one bike at a time.', true); return null; }
    return bikeId;
  }

  document.getElementById('history-export-json-btn').addEventListener('click', function () {
    var bikeId = historyExportBike();
    if (!bikeId) return;
    var data = bikeHistoryExport(store, bikeId);
    downloadFile(historyExportFilename(data.bike.name, 'json'),
      JSON.stringify(data, null, 2) + '\n', 'application/json');
    toast(data.service_count
      ? 'History downloaded — ' + data.service_count + ' services for ' + data.bike.name + '.'
      : 'History downloaded — no services logged for ' + data.bike.name + ' yet.');
  });

  document.getElementById('history-export-text-btn').addEventListener('click', function () {
    var bikeId = historyExportBike();
    if (!bikeId) return;
    var data = bikeHistoryExport(store, bikeId);
    downloadFile(historyExportFilename(data.bike.name, 'txt'),
      bikeHistoryText(store, bikeId), 'text/plain');
    toast(data.service_count
      ? 'History downloaded — ' + data.service_count + ' services for ' + data.bike.name + '.'
      : 'History downloaded — no services logged for ' + data.bike.name + ' yet.');
  });

  document.getElementById('history-copy-text-btn').addEventListener('click', function () {
    var bikeId = historyExportBike();
    if (!bikeId) return;
    var done = function () { toast('History copied to clipboard.'); };
    var fail = function () { toast('Copy failed — use Download instead.', true); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(bikeHistoryText(store, bikeId)).then(done, fail);
    } else { fail(); }
  });

  /* Per-bike expenses export: the bike picked in the Expenses
   * filter above. "All bikes" is not one bike — pick one first. */
  function expenseExportBike() {
    var bikeId = document.getElementById('expense-bike').value || null;
    if (!bikeId) { toast('Pick a bike first — expenses export is one bike at a time.', true); return null; }
    return bikeId;
  }

  document.getElementById('expense-export-json-btn').addEventListener('click', function () {
    var bikeId = expenseExportBike();
    if (!bikeId) return;
    var data = bikeExpensesExport(store, bikeId);
    downloadFile(expenseExportFilename(data.bike.name, 'json'),
      JSON.stringify(data, null, 2) + '\n', 'application/json');
    toast(data.expense_count
      ? 'Expenses downloaded — ' + data.expense_count + ' expenses for ' + data.bike.name + '.'
      : 'Expenses downloaded — no expenses logged for ' + data.bike.name + ' yet.');
  });

  document.getElementById('expense-export-text-btn').addEventListener('click', function () {
    var bikeId = expenseExportBike();
    if (!bikeId) return;
    var data = bikeExpensesExport(store, bikeId);
    downloadFile(expenseExportFilename(data.bike.name, 'txt'),
      bikeExpensesText(store, bikeId), 'text/plain');
    toast(data.expense_count
      ? 'Expenses downloaded — ' + data.expense_count + ' expenses for ' + data.bike.name + '.'
      : 'Expenses downloaded — no expenses logged for ' + data.bike.name + ' yet.');
  });

  document.getElementById('expense-copy-text-btn').addEventListener('click', function () {
    var bikeId = expenseExportBike();
    if (!bikeId) return;
    var done = function () { toast('Expenses copied to clipboard.'); };
    var fail = function () { toast('Copy failed — use Download instead.', true); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(bikeExpensesText(store, bikeId)).then(done, fail);
    } else { fail(); }
  });

  document.getElementById('expense-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    try {
      addExpense(store, {
        bike_id: document.getElementById('expense-form-bike').value,
        date: document.getElementById('expense-date').value,
        category: document.getElementById('expense-category-form').value,
        description: document.getElementById('expense-description').value,
        cost: document.getElementById('expense-cost').value,
        odometer: document.getElementById('expense-odometer').value,
        notes: document.getElementById('expense-notes').value,
        photo: pendingExpensePhoto
      });
      pendingExpensePhoto = null;
      var preview = document.getElementById('expense-photo-preview');
      if (preview) preview.innerHTML = '';
      saveStore(store);
      renderAll();
      document.getElementById('expense-description').value = '';
      document.getElementById('expense-cost').value = '';
      document.getElementById('expense-odometer').value = '';
      document.getElementById('expense-notes').value = '';
      toast('Expense logged.');
    } catch (e) { toast(e.message, true); }
  });

  /* Per-bike rides export: the bike picked in the Rides filter
   * above. "All bikes" is not one bike — pick one first. */
  function rideExportBike() {
    var bikeId = document.getElementById('ride-bike').value || null;
    if (!bikeId) { toast('Pick a bike first — rides export is one bike at a time.', true); return null; }
    return bikeId;
  }

  document.getElementById('ride-export-json-btn').addEventListener('click', function () {
    var bikeId = rideExportBike();
    if (!bikeId) return;
    var data = bikeRidesExport(store, bikeId);
    downloadFile(rideExportFilename(data.bike.name, 'json'),
      JSON.stringify(data, null, 2) + '\n', 'application/json');
    toast(data.ride_count
      ? 'Rides downloaded — ' + data.ride_count + ' rides for ' + data.bike.name + '.'
      : 'Rides downloaded — no rides logged for ' + data.bike.name + ' yet.');
  });

  document.getElementById('ride-export-text-btn').addEventListener('click', function () {
    var bikeId = rideExportBike();
    if (!bikeId) return;
    var data = bikeRidesExport(store, bikeId);
    downloadFile(rideExportFilename(data.bike.name, 'txt'),
      bikeRidesText(store, bikeId), 'text/plain');
    toast(data.ride_count
      ? 'Rides downloaded — ' + data.ride_count + ' rides for ' + data.bike.name + '.'
      : 'Rides downloaded — no rides logged for ' + data.bike.name + ' yet.');
  });

  document.getElementById('ride-copy-text-btn').addEventListener('click', function () {
    var bikeId = rideExportBike();
    if (!bikeId) return;
    var done = function () { toast('Rides copied to clipboard.'); };
    var fail = function () { toast('Copy failed — use Download instead.', true); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(bikeRidesText(store, bikeId)).then(done, fail);
    } else { fail(); }
  });

  document.getElementById('ride-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    try {
      addRide(store, {
        bike_id: document.getElementById('ride-form-bike').value,
        date: document.getElementById('ride-date').value,
        route: document.getElementById('ride-route').value,
        miles: document.getElementById('ride-miles').value,
        notes: document.getElementById('ride-notes').value
      });
      saveStore(store);
      renderAll();
      document.getElementById('ride-route').value = '';
      document.getElementById('ride-miles').value = '';
      document.getElementById('ride-notes').value = '';
      toast('Ride logged.');
    } catch (e) { toast(e.message, true); }
  });

  document.getElementById('ride-bike').addEventListener('change', renderRides);

  /* Receipt-photo wiring, delegated so it survives the expense list
   * being rebuilt: attach on an existing entry, remove from an
   * entry, pick on the new-expense form, clear a pending pick. */
  document.addEventListener('change', function (ev) {
    var el = ev.target;
    if (!el || !el.closest) return;
    var attach = el.closest('[data-attach-photo]');
    if (attach && attach.files && attach.files[0]) {
      var xid = attach.getAttribute('data-attach-photo');
      var file = attach.files[0];
      downscaleReceipt(file, function (err, photo) {
        if (err) { toast(err.message, true); return; }
        try {
          attachExpensePhoto(store, xid, photo);
          saveStore(store);
          renderAll();
          toast('Receipt photo attached.');
        } catch (e) { toast(e.message, true); }
      });
      return;
    }
    if (el.id === 'expense-photo-input' && el.files && el.files[0]) {
      downscaleReceipt(el.files[0], function (err, photo) {
        if (err) { toast(err.message, true); el.value = ''; return; }
        pendingExpensePhoto = photo;
        var preview = document.getElementById('expense-photo-preview');
        if (preview) {
          preview.innerHTML = '<div class="receipt-thumb"><img src="' + esc(photo.dataUrl) +
            '" alt="Receipt photo preview"></div>' +
            '<button type="button" class="mini secondary" data-clear-pending-photo>Clear photo</button>';
        }
      });
    }
  });
  document.addEventListener('click', function (ev) {
    var el = ev.target && ev.target.closest ? ev.target.closest('[data-remove-photo],[data-clear-pending-photo]') : null;
    if (!el) return;
    if (el.hasAttribute('data-remove-photo')) {
      try {
        removeExpensePhoto(store, el.getAttribute('data-remove-photo'));
        saveStore(store);
        renderAll();
        toast('Receipt photo removed.');
      } catch (e) { toast(e.message, true); }
      return;
    }
    pendingExpensePhoto = null;
    var preview = document.getElementById('expense-photo-preview');
    if (preview) preview.innerHTML = '';
    var input = document.getElementById('expense-photo-input');
    if (input) input.value = '';
  });

  document.getElementById('copy-export-btn').addEventListener('click', function () {
    var done = function () { toast('JSON copied to clipboard.'); };
    var fail = function () { toast('Copy failed — use Download instead.', true); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(exportJSON()).then(done, fail);
    } else { fail(); }
  });

  document.getElementById('import-btn').addEventListener('click', function () {
    var file = document.getElementById('import-file').files[0];
    var handle = function (text) {
      try {
        var imported = validateImport(JSON.parse(text));
        if (!window.confirm('Replace the current logbook with this import? Export first if you want to keep it.')) return;
        store = imported;
        saveStore(store);
        renderAll();
        toast('Logbook imported.');
      } catch (e) { toast('Import failed: ' + e.message, true); }
    };
    if (file) {
      var reader = new FileReader();
      reader.onload = function () { handle(reader.result); };
      reader.readAsText(file);
    } else {
      var text = document.getElementById('import-text').value;
      if (!text.trim()) { toast('Paste JSON or choose a file first.', true); return; }
      handle(text);
    }
  });

  document.getElementById('sample-btn').addEventListener('click', function () {
    if (Object.keys(store.bikes).length &&
        !window.confirm('Load example data on top of your current logbook? (It adds an example bike; your bikes stay.)')) return;
    mergeSample(store, sampleStore());
    saveStore(store);
    renderAll();
    toast('Example logbook loaded.');
  });

  document.getElementById('clear-btn').addEventListener('click', function () {
    if (!window.confirm('Delete EVERYTHING in this logbook? This cannot be undone — export first if you want a backup.')) return;
    store = emptyStore();
    saveStore(store);
    renderAll();
    toast('Logbook wiped.');
  });

  document.getElementById('log-date').value = todayISO();
  document.getElementById('odo-date').value = todayISO();
  document.getElementById('expense-date').value = todayISO();
  document.getElementById('ride-date').value = todayISO();
  renderAll();

  /* Handoff intake: delegated confirm/dismiss (the card is rebuilt
   * by innerHTML), paste fallback on the Data tab, and the
   * ?handoff= parameter on load. */
  document.addEventListener('click', function (ev) {
    var el = ev.target && ev.target.closest ? ev.target.closest('[data-handoff-confirm],[data-handoff-dismiss]') : null;
    if (!el) return;
    if (el.hasAttribute('data-handoff-confirm')) confirmHandoff();
    else { pendingHandoff = null; renderHandoffBox(); }
  });
  var pasteBtn = document.getElementById('handoff-paste-btn');
  if (pasteBtn) pasteBtn.addEventListener('click', function () {
    var text = document.getElementById('handoff-paste-text').value;
    if (!text.trim()) { toast('Paste the handoff JSON first.', true); return; }
    receiveHandoff(text);
    showView('due');
    var box = document.getElementById('handoff-box');
    if (box && box.scrollIntoView) box.scrollIntoView();
  });
  checkHandoffFromUrl();
}

/* Node test hook — the core logic above is pure and dependency-free. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    emptyStore: emptyStore, addBike: addBike, removeBike: removeBike,
    setOdometer: setOdometer, addTask: addTask, removeTask: removeTask,
    logService: logService, lastService: lastService,
    taskStatus: taskStatus, dueRows: dueRows,
    dueReminders: dueReminders,
    bikeHistoryExport: bikeHistoryExport, bikeHistoryText: bikeHistoryText,
    historyExportFilename: historyExportFilename,
    historyEntries: historyEntries, historyTotal: historyTotal,
    EXPENSE_CATEGORIES: EXPENSE_CATEGORIES,
    expenseCategoryLabel: expenseCategoryLabel,
    nextExpenseId: nextExpenseId,
    addExpense: addExpense, removeExpense: removeExpense,
    expensesForBike: expensesForBike, expenseTotal: expenseTotal,
    expensesByCategory: expensesByCategory,
    bikeExpensesExport: bikeExpensesExport, bikeExpensesText: bikeExpensesText,
    expenseExportFilename: expenseExportFilename,
    nextRideId: nextRideId,
    addRide: addRide, removeRide: removeRide,
    ridesForBike: ridesForBike, rideTotalMiles: rideTotalMiles,
    bikeRidesExport: bikeRidesExport, bikeRidesText: bikeRidesText,
    rideExportFilename: rideExportFilename,
    validateImport: validateImport, sampleStore: sampleStore,
    mergeSample: mergeSample,
    addMonths: addMonths, daysBetween: daysBetween,
    COMMON_BIKES: COMMON_BIKES, commonBrands: commonBrands,
    commonModels: commonModels,
    FACTORY_SCHEDULES: FACTORY_SCHEDULES,
    factoryScheduleFor: factoryScheduleFor,
    factoryScheduleModel: factoryScheduleModel,
    applyFactorySchedule: applyFactorySchedule,
    WEAR_COMPONENTS: WEAR_COMPONENTS,
    wearClocks: wearClocks,
    TIRE_INSPECT_YEARS: TIRE_INSPECT_YEARS,
    TIRE_REPLACE_YEARS: TIRE_REPLACE_YEARS,
    isDateISO: isDateISO,
    decodeDotDate: decodeDotDate,
    setTireDate: setTireDate,
    tireAgeClock: tireAgeClock,
    MAX_PHOTO_CHARS: MAX_PHOTO_CHARS,
    isExpensePhoto: isExpensePhoto,
    attachExpensePhoto: attachExpensePhoto,
    removeExpensePhoto: removeExpensePhoto,
    SOON_MILES: SOON_MILES, SOON_DAYS: SOON_DAYS,
    HANDOFF_FORMAT: HANDOFF_FORMAT, HANDOFF_VERSION: HANDOFF_VERSION,
    HANDOFF_KIND: HANDOFF_KIND, HANDOFF_KINDS: HANDOFF_KINDS,
    HANDOFF_KIND_DIAGNOSIS: HANDOFF_KIND_DIAGNOSIS,
    HANDOFF_KIND_TIMING: HANDOFF_KIND_TIMING, HANDOFF_MAX_CHARS: HANDOFF_MAX_CHARS,
    encodePocketHandoff: encodePocketHandoff, parsePocketHandoff: parsePocketHandoff,
    validatePocketHandoff: validatePocketHandoff,
    normalizeBikeName: normalizeBikeName, namesMatch: namesMatch,
    resolvePocketHandoffBike: resolvePocketHandoffBike,
    pinPocketRosterKey: pinPocketRosterKey,
    taskFromHandoff: taskFromHandoff, handoffCitation: handoffCitation
  };
}
