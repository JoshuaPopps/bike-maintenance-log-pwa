/* Core-logic tests for bike-maintenance-log-pwa. No dependencies.
 * Run: node test.js   (from this directory)
 * The DOM layer is browser-only; these tests cover the pure logic
 * that the UI calls, with fixed dates so results never drift. */
'use strict';
var app = require('./app.js');

var passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('ok   - ' + name); }
  else { failed++; console.log('FAIL - ' + name); }
}
function throws(name, fn) {
  try { fn(); check(name, false); }
  catch (e) { check(name + ' (' + e.message + ')', true); }
}

function bikeWithTask(store, opts) {
  var b = app.addBike(store, { name: opts.bike || 'Test Bike', odometer: String(opts.odo || 0) });
  var bid = Object.keys(store.bikes)[0];
  /* Pin the baseline to fixed values: addTask stamps "today", which is
   * fine for mileage-only tasks but not for fixed-date time tests, so
   * rewrite the baseline right after creation. */
  var t = app.addTask(store, {
    bike_id: bid, name: opts.task || 'Engine oil',
    every_miles: opts.miles == null ? '' : String(opts.miles),
    every_months: opts.months == null ? '' : String(opts.months)
  });
  var tid = Object.keys(store.tasks)[0];
  if (opts.baseline_odo != null) store.tasks[tid].baseline_odo = opts.baseline_odo;
  if (opts.baseline_date) store.tasks[tid].baseline_date = opts.baseline_date;
  return { bid: bid, tid: tid };
}

/* --- date math --- */
check('addMonths clamps Jan 31 + 1 mo to Feb 28', app.addMonths('2026-01-31', 1) === '2026-02-28');
check('addMonths crosses year boundary', app.addMonths('2026-11-15', 2) === '2027-01-15');
check('addMonths goes backward across a year', app.addMonths('2026-11-04', -14) === '2025-09-04');
check('addMonths backward clamps day', app.addMonths('2026-03-31', -1) === '2026-02-28');
check('addMonths leap Feb 29 + 12 mo to Feb 28', app.addMonths('2024-02-29', 12) === '2025-02-28');
check('daysBetween counts forward', app.daysBetween('2026-11-01', '2026-11-04') === 3);
check('daysBetween counts backward as negative', app.daysBetween('2026-11-04', '2026-11-01') === -3);

/* --- validation --- */
(function () {
  var s = app.emptyStore();
  app.addBike(s, { name: 'My Bike' });
  throws('duplicate bike name rejected (case-insensitive)', function () {
    app.addBike(s, { name: 'MY BIKE' });
  });
  throws('empty bike name rejected', function () {
    app.addBike(s, { name: '   ' });
  });
  throws('negative odometer rejected', function () {
    app.addBike(s, { name: 'Other', odometer: '-5' });
  });
  var bid = Object.keys(s.bikes)[0];
  throws('task with neither interval rejected', function () {
    app.addTask(s, { bike_id: bid, name: 'Oil', every_miles: '', every_months: '' });
  });
  throws('task with zero miles interval rejected', function () {
    app.addTask(s, { bike_id: bid, name: 'Oil', every_miles: '0', every_months: '' });
  });
  throws('task on unknown bike rejected', function () {
    app.addTask(s, { bike_id: 'b99', name: 'Oil', every_miles: '3000', every_months: '' });
  });
  app.addTask(s, { bike_id: bid, name: 'Oil', every_miles: '3000', every_months: '' });
  throws('duplicate task name on same bike rejected', function () {
    app.addTask(s, { bike_id: bid, name: 'oil', every_miles: '3000', every_months: '' });
  });
  throws('log with negative cost rejected', function () {
    var tid = Object.keys(s.tasks)[0];
    app.logService(s, { bike_id: bid, task_id: tid, date: '2026-11-04', cost: '-1' });
  });
})();

/* --- status: mileage leg --- */
(function () {
  var s = app.emptyStore();
  var r = bikeWithTask(s, { odo: 42000, miles: 3000, baseline_odo: 40000, baseline_date: '2026-01-01' });
  /* due at 43,000; bike at 42,000 -> 1,000 left -> ok */
  check('mileage ok', app.taskStatus(s, r.bid, r.tid, '2026-11-04').status === 'ok');
  s.bikes[r.bid].odometer = 42600; /* 400 left -> due soon */
  check('mileage due-soon within 500', app.taskStatus(s, r.bid, r.tid, '2026-11-04').status === 'due-soon');
  s.bikes[r.bid].odometer = 43000; /* exactly due -> overdue (left <= 0) */
  check('mileage exactly due counts overdue', app.taskStatus(s, r.bid, r.tid, '2026-11-04').status === 'overdue');
})();

/* --- status: time leg, and worst-leg-wins --- */
(function () {
  var s = app.emptyStore();
  var r = bikeWithTask(s, { odo: 1000, months: 6, baseline_odo: 0, baseline_date: '2026-05-04' });
  /* due 2026-11-04; as of 2026-10-04 -> 31 days -> ok */
  check('time ok outside 30 days', app.taskStatus(s, r.bid, r.tid, '2026-10-04').status === 'ok');
  /* as of 2026-10-10 -> 25 days -> due soon */
  check('time due-soon within 30 days', app.taskStatus(s, r.bid, r.tid, '2026-10-10').status === 'due-soon');
  /* as of 2026-11-05 -> 1 day past -> overdue */
  check('time overdue past due date', app.taskStatus(s, r.bid, r.tid, '2026-11-05').status === 'overdue');
  /* worst leg wins: miles ok, time overdue -> overdue */
  var s2 = app.emptyStore();
  var r2 = bikeWithTask(s2, { odo: 1000, miles: 100000, months: 6, baseline_odo: 0, baseline_date: '2026-05-04' });
  check('worst leg wins (miles ok, time overdue)',
    app.taskStatus(s2, r2.bid, r2.tid, '2026-11-05').status === 'overdue');
})();

/* --- last service beats baseline --- */
(function () {
  var s = app.emptyStore();
  var r = bikeWithTask(s, { odo: 42000, miles: 3000, baseline_odo: 0, baseline_date: '2026-01-01' });
  app.logService(s, { bike_id: r.bid, task_id: r.tid, date: '2026-10-01', odometer: '41000', cost: '50' });
  /* due at 44,000 now, not 3,000 from baseline */
  var st = app.taskStatus(s, r.bid, r.tid, '2026-11-04');
  check('last service resets the clock', st.status === 'ok' && st.details[1].indexOf('2,000') >= 0);
  /* unlogged task keeps the "not logged yet" line */
  var s2 = app.emptyStore();
  var r2 = bikeWithTask(s2, { odo: 100, miles: 3000, baseline_odo: 0, baseline_date: '2026-01-01' });
  check('unlogged task notes baseline counting',
    app.taskStatus(s2, r2.bid, r2.tid, '2026-11-04').details[0].indexOf('not logged yet') === 0);
})();

/* --- odometer rules --- */
(function () {
  var s = app.emptyStore();
  var r = bikeWithTask(s, { odo: 42000, miles: 3000 });
  var res = app.logService(s, { bike_id: r.bid, task_id: r.tid, date: '2026-11-04', odometer: '43000' });
  check('higher service reading advances bike odometer',
    s.bikes[r.bid].odometer === 43000 && res.warned === false);
  var res2 = app.logService(s, { bike_id: r.bid, task_id: r.tid, date: '2026-11-04', odometer: '42500' });
  check('lower service reading warns and does not rewind',
    res2.warned === true && s.bikes[r.bid].odometer === 43000);
  var odoRes = app.setOdometer(s, r.bid, '42000', '2026-11-04');
  check('setOdometer lower warns', odoRes.warned === true && s.bikes[r.bid].odometer === 42000);
})();

/* --- entry ids follow the CLI rule: highest suffix in use + 1 --- */
(function () {
  var s = app.emptyStore();
  var r = bikeWithTask(s, { odo: 0, miles: 3000 });
  app.logService(s, { bike_id: r.bid, task_id: r.tid, date: '2026-11-01', odometer: '1000' });
  app.logService(s, { bike_id: r.bid, task_id: r.tid, date: '2026-11-02', odometer: '2000' });
  s.entries = s.entries.filter(function (e) { return e.id !== 'e2'; });
  var res = app.logService(s, { bike_id: r.bid, task_id: r.tid, date: '2026-11-03', odometer: '3000' });
  check('entry id after delete reuses e2, same as the CLI', res.entry.id === 'e2');
})();

/* --- due ordering --- */
(function () {
  var s = app.emptyStore();
  var r = bikeWithTask(s, { odo: 42000, miles: 3000, baseline_odo: 39000, baseline_date: '2026-01-01' });
  var bid = r.bid;
  app.addTask(s, { bike_id: bid, name: 'Tires', every_miles: '6000', every_months: '' });
  var tids = Object.keys(s.tasks);
  var tiresId = tids.filter(function (id) { return s.tasks[id].name === 'Tires'; })[0];
  s.tasks[tiresId].baseline_odo = 42000;
  app.addTask(s, { bike_id: bid, name: 'Brakes', every_miles: '3000', every_months: '' });
  var brakesId = Object.keys(s.tasks).filter(function (id) { return s.tasks[id].name === 'Brakes'; })[0];
  s.tasks[brakesId].baseline_odo = 40000; /* due 43,000 -> 1,000 left -> ok */
  s.tasks[r.tid].baseline_odo = 39000; /* due 42,000 -> at bike odo -> overdue */
  var rows = app.dueRows(s, bid, '2026-11-04');
  check('due rows sort overdue first, then ok',
    rows[0].status === 'overdue' && rows[rows.length - 1].status === 'ok' && rows.length === 3);
})();

/* --- history + totals --- */
(function () {
  var s = app.emptyStore();
  var r = bikeWithTask(s, { odo: 0, miles: 3000 });
  app.logService(s, { bike_id: r.bid, task_id: r.tid, date: '2026-11-01', odometer: '1000', cost: '10.50', notes: 'first' });
  app.logService(s, { bike_id: r.bid, task_id: r.tid, date: '2026-11-03', odometer: '2000', cost: '20', notes: '' });
  var hist = app.historyEntries(s, r.bid, r.tid);
  check('history newest first', hist[0].date === '2026-11-03' && hist[1].date === '2026-11-01');
  check('cost stored as given', hist[1].cost === 10.50);
  check('history total sums costs', app.historyTotal(hist) === 30.50);
  var round = app.logService(s, { bike_id: r.bid, task_id: r.tid, date: '2026-11-04', odometer: '3000', cost: '10.999' });
  check('cost rounds to cents (10.999 -> 11.00)', round.entry.cost === 11);
})();

/* --- import validation --- */
(function () {
  var good = app.emptyStore();
  var r = bikeWithTask(good, { odo: 1000, miles: 3000 });
  app.logService(good, { bike_id: r.bid, task_id: r.tid, date: '2026-11-01', odometer: '1000' });
  var round = app.validateImport(JSON.parse(JSON.stringify(good)));
  check('CLI-shaped export validates', round.entries.length === 1);
  throws('garbage JSON object rejected', function () { app.validateImport({ nope: true }); });
  throws('entry pointing at missing task rejected', function () {
    var bad = JSON.parse(JSON.stringify(good));
    bad.entries[0].task_id = 't99';
    app.validateImport(bad);
  });
  throws('task pointing at missing bike rejected', function () {
    var bad = JSON.parse(JSON.stringify(good));
    bad.tasks[Object.keys(bad.tasks)[0]].bike_id = 'b99';
    app.validateImport(bad);
  });
})();

/* --- cascades --- */
(function () {
  var s = app.emptyStore();
  var r = bikeWithTask(s, { bike: 'Cascade Bike A', odo: 0, miles: 3000 });
  app.logService(s, { bike_id: r.bid, task_id: r.tid, date: '2026-11-01', odometer: '1000' });
  app.removeTask(s, r.tid);
  check('removing a task drops its history', s.entries.length === 0);
  var r2 = bikeWithTask(s, { bike: 'Cascade Bike B', odo: 0, miles: 3000 });
  app.removeBike(s, r2.bid);
  check('removing a bike drops its tasks', Object.keys(s.tasks).length === 0);
})();

/* --- sample merge never collides with existing ids --- */
(function () {
  var s = app.emptyStore();
  var r = bikeWithTask(s, { bike: 'My Real Bike', odo: 5000, miles: 3000 });
  app.logService(s, { bike_id: r.bid, task_id: r.tid, date: '2026-11-01', odometer: '5000' });
  var merged = app.mergeSample(s, app.sampleStore());
  check('merge adds the example bike alongside the real one',
    merged.bikes === 1 && Object.keys(s.bikes).length === 2);
  var exampleBid = Object.keys(s.bikes).filter(function (id) {
    return s.bikes[id].name === 'Example 1995 Softail';
  })[0];
  check('example bike kept its own id', !!exampleBid && exampleBid !== r.bid);
  var exampleEntries = s.entries.filter(function (e) { return e.bike_id === exampleBid; });
  check('sample entries point at the example bike, not the real one',
    exampleEntries.length === 3);
  var realEntries = s.entries.filter(function (e) { return e.bike_id === r.bid; });
  check('real bike history untouched by merge', realEntries.length === 1);
  app.validateImport(JSON.parse(JSON.stringify(s)));
  check('merged logbook still validates as CLI-shaped', true);
})();
(function () {
  var s = app.sampleStore();
  var bid = Object.keys(s.bikes)[0];
  var states = {};
  Object.keys(s.tasks).forEach(function (tid) {
    states[app.taskStatus(s, bid, tid).status] = true;
  });
  check('sample has overdue, due-soon, and ok tasks',
    states.overdue && states['due-soon'] && states.ok);
  check('sample bike odometer is the headline 42,300',
    s.bikes[bid].odometer === 42300);
})();

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
