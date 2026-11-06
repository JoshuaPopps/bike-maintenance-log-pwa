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
 * Spec rule, same as the CLI: this app ships NO service intervals of
 * its own. Intervals come from the owner's manual for the bike in
 * question. The example logbook's intervals are placeholders, clearly
 * labelled as such, never presented as factory specs.
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
  return { bikes: {}, tasks: {}, entries: [] };
}

function loadStore() {
  var raw = _storage().getItem(STORAGE_KEY);
  if (!raw) return emptyStore();
  try {
    var data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return emptyStore();
    data.bikes = data.bikes || {};
    data.tasks = data.tasks || {};
    data.entries = Array.isArray(data.entries) ? data.entries : [];
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
    odometer_date: todayISO()
  };
  return store.bikes[id];
}

function removeBike(store, bikeId) {
  if (!store.bikes[bikeId]) throw new Error('Bike not found.');
  delete store.bikes[bikeId];
  Object.keys(store.tasks).forEach(function (tid) {
    if (store.tasks[tid].bike_id === bikeId) delete store.tasks[tid];
  });
  store.entries = store.entries.filter(function (e) { return e.bike_id !== bikeId; });
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
    if (left <= 0) legs.push({ status: 'overdue', text: fmtMiles(-left) + ' overdue' });
    else if (left <= SOON_MILES) legs.push({ status: 'due-soon', text: 'due in ' + fmtMiles(left) });
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
  return { bikes: data.bikes, tasks: data.tasks, entries: data.entries };
}

/* Example logbook — dates relative to today so the OVERDUE / DUE SOON /
 * ok spread stays true whenever it is loaded. Every number is an
 * EXAMPLE placeholder, not a factory spec. */
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
  var oil = addTask(store, { bike_id: bid, name: 'Engine oil', every_miles: '3000', every_months: '6', notes: 'Example interval — use your manual.' });
  var primary = addTask(store, { bike_id: bid, name: 'Primary fluid', every_miles: '5000', every_months: '', notes: 'Example interval — use your manual.' });
  var brakes = addTask(store, { bike_id: bid, name: 'Brake fluid', every_miles: '', every_months: '12', notes: 'Example interval — use your manual.' });
  var tires = addTask(store, { bike_id: bid, name: 'Tires', every_miles: '6000', every_months: '', notes: 'Example interval — use your manual.' });
  var oilId = Object.keys(store.tasks).filter(function (id) { return store.tasks[id].name === 'Engine oil'; })[0];
  var primaryId = Object.keys(store.tasks).filter(function (id) { return store.tasks[id].name === 'Primary fluid'; })[0];
  var brakesId = Object.keys(store.tasks).filter(function (id) { return store.tasks[id].name === 'Brake fluid'; })[0];
  void oil; void primary; void brakes; void tires;
  /* Oil: 2,800 mi ago, 5 months ago -> 200 mi left (due soon). */
  logService(store, { bike_id: bid, task_id: oilId, date: monthsAgo(5), odometer: '39500', cost: '48.50', notes: '20W-50, new filter' });
  /* Primary: 1,000 mi ago, 1 month ago -> comfortably ok. */
  logService(store, { bike_id: bid, task_id: primaryId, date: monthsAgo(1), odometer: '41300', cost: '18.00', notes: '' });
  /* Brakes: 14 months ago -> overdue on the time leg. */
  logService(store, { bike_id: bid, task_id: brakesId, date: monthsAgo(14), odometer: '27300', cost: '12.00', notes: 'DOT 4, bled both calipers' });
  /* Tires: never logged -> counts from task creation, ok. */
  /* Restore the bike odometer the services advanced past the sample's
   * headline reading: services logged at 39,500 / 41,300 / 27,300 must
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
  return { bikes: Object.keys(bikeMap).length, tasks: Object.keys(taskMap).length };
}
if (typeof document !== 'undefined') {
  var store = loadStore();
  var toastTimer = null;

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
     ['task-bike', false], ['history-bike', true]].forEach(function (pair) {
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
    box.querySelectorAll('[data-del-task]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tid = btn.getAttribute('data-del-task');
        if (!window.confirm('Delete task "' + store.tasks[tid].name + '" and its history?')) return;
        removeTask(store, tid);
        saveStore(store);
        renderAll();
        toast('Task deleted.');
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

  function renderData() {
    var bikes = Object.keys(store.bikes).length;
    var tasks = Object.keys(store.tasks).length;
    var entries = store.entries.length;
    var spent = historyTotal(store.entries);
    document.getElementById('data-counts').textContent =
      bikes + ' bike' + (bikes === 1 ? '' : 's') + ', ' +
      tasks + ' task' + (tasks === 1 ? '' : 's') + ', ' +
      entries + ' service' + (entries === 1 ? '' : 's') + ' logged' +
      (spent ? ', ' + fmtMoney(spent) + ' total spent' : '') + '.';
  }

  function renderAll() {
    fillBikeSelects();
    renderDue();
    renderBikes();
    renderHistory();
    renderData();
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

  document.getElementById('due-bike').addEventListener('change', renderDue);
  document.getElementById('log-bike').addEventListener('change', fillTaskSelects);
  document.getElementById('history-bike').addEventListener('change', function () {
    fillTaskSelects();
    renderHistory();
  });
  document.getElementById('history-task').addEventListener('change', renderHistory);

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

  document.getElementById('bike-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    try {
      addBike(store, {
        name: document.getElementById('bike-name').value,
        year: document.getElementById('bike-year').value,
        make: document.getElementById('bike-make').value,
        model: document.getElementById('bike-model').value,
        odometer: document.getElementById('bike-odometer').value,
        notes: document.getElementById('bike-notes').value
      });
      saveStore(store);
      renderAll();
      ev.target.reset();
      toast('Bike added.');
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

  document.getElementById('export-btn').addEventListener('click', function () {
    var blob = new Blob([exportJSON()], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bike-log-data.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('Backup downloaded.');
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
  renderAll();
}

/* Node test hook — the core logic above is pure and dependency-free. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    emptyStore: emptyStore, addBike: addBike, removeBike: removeBike,
    setOdometer: setOdometer, addTask: addTask, removeTask: removeTask,
    logService: logService, lastService: lastService,
    taskStatus: taskStatus, dueRows: dueRows,
    historyEntries: historyEntries, historyTotal: historyTotal,
    validateImport: validateImport, sampleStore: sampleStore,
    mergeSample: mergeSample,
    addMonths: addMonths, daysBetween: daysBetween,
    SOON_MILES: SOON_MILES, SOON_DAYS: SOON_DAYS
  };
}
