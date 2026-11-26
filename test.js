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

/* --- sample follows FSM #99482-98 §1: no DOT 4, no months legs --- */
(function () {
  var s = app.sampleStore();
  var byName = {};
  Object.keys(s.tasks).forEach(function (tid) { byName[s.tasks[tid].name] = s.tasks[tid]; });
  check('sample oil is 5,000 mi, no months leg',
    byName['Engine oil'].every_miles === 5000 && !byName['Engine oil'].every_months);
  check('sample brake fluid is inspect-only at 5,000 mi, no months leg',
    byName['Brake fluid (inspect)'].every_miles === 5000 && !byName['Brake fluid (inspect)'].every_months);
  check('sample tires inspect at 5,000 mi, not 6,000',
    byName['Tires (inspect)'].every_miles === 5000);
  check('no DOT 4 anywhere in the sample logbook',
    JSON.stringify(s).indexOf('DOT 4') === -1);
  check('sample brake note says DOT 5 silicone ONLY',
    byName['Brake fluid (inspect)'].notes.indexOf('DOT 5 silicone ONLY') >= 0);
})();

/* --- common-bikes catalog --- */
check('catalog has the six brands, in order',
  JSON.stringify(app.commonBrands()) === JSON.stringify(['Harley-Davidson', 'Triumph', 'Honda', 'Suzuki', 'Kawasaki', 'Yamaha']));
(function () {
  var total = 0, ok = true;
  app.COMMON_BIKES.forEach(function (b) {
    if (!b.brand || !b.families || !b.families.length) ok = false;
    b.families.forEach(function (f) {
      if (!f.family || !f.models || !f.models.length) ok = false;
      var seen = {};
      f.models.forEach(function (m) {
        if (!m || typeof m !== 'string' || !m.trim()) ok = false;
        if (seen[m]) ok = false;
        seen[m] = true;
        total++;
      });
    });
  });
  check('every brand has families, every family has non-empty models, no dupes in a family', ok);
  check('catalog holds 100+ models', total >= 100);
})();
check('commonModels of an unknown brand is empty', app.commonModels('No Such Brand').length === 0);
check('Harley Softail family includes Fat Boy',
  app.commonModels('Harley-Davidson').some(function (e) { return e.family === 'Softail' && e.model === 'Fat Boy'; }));
check('Triumph includes Tiger 900 and Bonneville T120',
  app.commonModels('Triumph').some(function (e) { return e.model === 'Tiger 900'; }) &&
  app.commonModels('Triumph').some(function (e) { return e.model === 'T120'; }));
check('Honda includes Gold Wing and Rebel 500',
  app.commonModels('Honda').some(function (e) { return e.model === 'Gold Wing'; }) &&
  app.commonModels('Honda').some(function (e) { return e.model === 'Rebel 500'; }));
check('Suzuki includes SV650 and V-Strom 650',
  app.commonModels('Suzuki').some(function (e) { return e.model === 'SV650'; }) &&
  app.commonModels('Suzuki').some(function (e) { return e.model === 'V-Strom 650'; }));
check('Kawasaki includes Ninja 650 and Z900',
  app.commonModels('Kawasaki').some(function (e) { return e.model === 'Ninja 650'; }) &&
  app.commonModels('Kawasaki').some(function (e) { return e.model === 'Z900'; }));
check('Yamaha includes MT-07 and YZF-R6',
  app.commonModels('Yamaha').some(function (e) { return e.model === 'MT-07'; }) &&
  app.commonModels('Yamaha').some(function (e) { return e.model === 'YZF-R6'; }));

/* --- factory-schedule auto-fill --- */
(function () {
  var sched = app.factoryScheduleFor('Harley-Davidson', 'Fat Boy', 1995);
  check('Fat Boy 1995 matches the Evo Softail schedule',
    !!sched && sched.label === 'Evo Softail (1984–1999)');
  check('schedule carries 16 tasks', !!sched && sched.tasks.length === 16);
  var oil = sched.tasks.filter(function (t) { return t.name === 'Engine oil'; })[0];
  check('Engine oil is 5,000 mi from FSM #99482-98',
    !!oil && oil.every_miles === 5000 && oil.notes.indexOf('#99482-98') >= 0);
  var fork = sched.tasks.filter(function (t) { return t.name === 'Fork oil'; })[0];
  var plugs = sched.tasks.filter(function (t) { return t.name === 'Spark plugs'; })[0];
  check('Fork oil 10,000 / Spark plugs 20,000',
    fork.every_miles === 10000 && plugs.every_miles === 20000);
  check('Heritage Classic 1997 matches',
    !!app.factoryScheduleFor('Harley-Davidson', 'Heritage Classic', 1997));
  check('Standard 1990 matches',
    !!app.factoryScheduleFor('Harley-Davidson', 'Standard', 1990));
  check('year bounds hold (1984 and 1999 in, 1983 and 2000 out)',
    !!app.factoryScheduleFor('Harley-Davidson', 'Fat Boy', 1984) &&
    !!app.factoryScheduleFor('Harley-Davidson', 'Fat Boy', 1999) &&
    !app.factoryScheduleFor('Harley-Davidson', 'Fat Boy', 1983) &&
    !app.factoryScheduleFor('Harley-Davidson', 'Fat Boy', 2000));
  check('Fat Boy 2020 gets no schedule',
    !app.factoryScheduleFor('Harley-Davidson', 'Fat Boy', 2020));
  check('no year means no schedule',
    !app.factoryScheduleFor('Harley-Davidson', 'Fat Boy', null) &&
    !app.factoryScheduleFor('Harley-Davidson', 'Fat Boy', ''));
  check('Triumph Tiger 900 gets no schedule',
    !app.factoryScheduleFor('Triumph', 'Tiger 900', 1995));
  check('model lookup ignores year (for the picker hint)',
    !!app.factoryScheduleModel('Harley-Davidson', 'Fat Boy') &&
    !app.factoryScheduleModel('Triumph', 'Tiger 900'));
})();
(function () {
  var s = app.emptyStore();
  app.addBike(s, { name: 'My Fat Boy', year: '1995', make: 'Harley-Davidson', model: 'Fat Boy', odometer: '20000' });
  var bid = Object.keys(s.bikes)[0];
  var res = app.applyFactorySchedule(s, bid);
  check('auto-fill adds all 16 factory tasks',
    res.added === 16 && res.skipped === 0 && Object.keys(s.tasks).length === 16);
  var oilId = Object.keys(s.tasks).filter(function (id) { return s.tasks[id].name === 'Engine oil'; })[0];
  check('filled tasks carry the source note',
    s.tasks[oilId].notes.indexOf('FSM #99482-98') >= 0);
  check('filled tasks count from the bike odometer',
    s.tasks[oilId].baseline_odo === 20000);
  var again = app.applyFactorySchedule(s, bid);
  check('re-apply adds nothing, skips all 16',
    again.added === 0 && again.skipped === 16);
  app.validateImport(JSON.parse(JSON.stringify(s)));
  check('auto-filled logbook still validates as CLI-shaped', true);
})();
(function () {
  var s = app.emptyStore();
  app.addBike(s, { name: 'My Fat Boy', year: '1995', make: 'Harley-Davidson', model: 'Fat Boy', odometer: '20000' });
  var bid = Object.keys(s.bikes)[0];
  app.addTask(s, { bike_id: bid, name: 'Engine oil', every_miles: '2500', every_months: '', notes: 'My own interval' });
  var res = app.applyFactorySchedule(s, bid);
  var oil = s.tasks[Object.keys(s.tasks).filter(function (id) { return s.tasks[id].name === 'Engine oil'; })[0]];
  check('user-set task survives auto-fill untouched',
    res.added === 15 && res.skipped === 1 &&
    oil.every_miles === 2500 && oil.notes === 'My own interval');
})();
(function () {
  var s = app.emptyStore();
  app.addBike(s, { name: 'New Fat Boy', year: '2020', make: 'Harley-Davidson', model: 'Fat Boy', odometer: '5000' });
  var bid = Object.keys(s.bikes)[0];
  var res = app.applyFactorySchedule(s, bid);
  check('out-of-range year fills nothing',
    res.added === 0 && res.schedule === null && Object.keys(s.tasks).length === 0);
})();
(function () {
  var s = app.sampleStore();
  check('sample logbook still has exactly 4 tasks',
    Object.keys(s.tasks).length === 4);
})();

/* --- Sportster factory-schedule auto-fill --- */
(function () {
  var sched = app.factoryScheduleFor('Harley-Davidson', '1200', 1998);
  check('1200 1998 matches the Sportster schedule',
    !!sched && sched.label === 'Sportster XL/XLH (1986–2003)');
  check('Sportster schedule carries 19 tasks (18 + the year-scoped chain-lube line)', !!sched && sched.tasks.length === 19);
  check('Sportster schedule cites FSM #99484-98',
    !!sched && sched.source.indexOf('#99484-98') >= 0);
  var plugs = sched.tasks.filter(function (t) { return t.name === 'Spark plugs'; })[0];
  check('Sportster spark plugs replace 10,000 — flagged, not the Softail 20,000',
    !!plugs && plugs.every_miles === 10000 &&
    plugs.notes.indexOf('SPORTSTER value') >= 0 &&
    plugs.notes.indexOf('20,000') >= 0);
  var cables = sched.tasks.filter(function (t) { return t.name === 'Throttle cables'; })[0];
  check('Sportster throttle cables lube 5,000 — flagged, not the Softail 10,000',
    !!cables && cables.every_miles === 5000 &&
    cables.notes.indexOf('SPORTSTER value') >= 0);
  var tires = sched.tasks.filter(function (t) { return t.name === 'Tires'; })[0];
  check('Sportster tires inspect 2,500 — flagged, not the Softail 5,000',
    !!tires && tires.every_miles === 2500 &&
    tires.notes.indexOf('SPORTSTER value') >= 0);
  var primary = sched.tasks.filter(function (t) { return t.name === 'Primary / transmission fluid'; })[0];
  check('Sportster has one shared-sump primary/transmission task, not two',
    !!primary && primary.every_miles === 5000 &&
    !sched.tasks.some(function (t) { return t.name === 'Transmission fluid'; }) &&
    !sched.tasks.some(function (t) { return t.name === 'Primary fluid'; }));
  var pads = sched.tasks.filter(function (t) { return t.name === 'Brake pads'; })[0];
  check('Sportster brake pads inspect 2,500 from FSM #99484-98',
    !!pads && pads.every_miles === 2500 && pads.notes.indexOf('#99484-98') >= 0);
  check('Sportster year bounds hold (1986 and 2003 in, 1985 and 2004 out)',
    !!app.factoryScheduleFor('Harley-Davidson', '883', 1986) &&
    !!app.factoryScheduleFor('Harley-Davidson', '1200 Sport', 2003) &&
    !app.factoryScheduleFor('Harley-Davidson', '1200', 1985) &&
    !app.factoryScheduleFor('Harley-Davidson', '1200', 2004));
  check('modern Sportster (Iron 883 2020) gets no schedule',
    !app.factoryScheduleFor('Harley-Davidson', 'Iron 883', 2020));
  check('picker lists the 1986–2003 Sportster models',
    app.commonModels('Harley-Davidson').some(function (e) { return e.model === '1200'; }) &&
    app.commonModels('Harley-Davidson').some(function (e) { return e.model === '883 Hugger'; }));
})();
(function () {
  var s = app.emptyStore();
  app.addBike(s, { name: 'My 1200', year: '1998', make: 'Harley-Davidson', model: '1200', odometer: '15000' });
  var bid = Object.keys(s.bikes)[0];
  var res = app.applyFactorySchedule(s, bid);
  check('Sportster auto-fill adds all 18 factory tasks (1998 belt bike skips the chain-lube line)',
    res.added === 18 && res.skipped === 0 && Object.keys(s.tasks).length === 18);
  check('1998 belt-drive Sportster gets no drive-chain task',
    !Object.keys(s.tasks).some(function (id) { return s.tasks[id].name === 'Drive chain lubrication'; }));
  var plugsId = Object.keys(s.tasks).filter(function (id) { return s.tasks[id].name === 'Spark plugs'; })[0];
  check('filled Sportster plugs carry the flagged source note',
    s.tasks[plugsId].notes.indexOf('SPORTSTER value') >= 0);
  var again = app.applyFactorySchedule(s, bid);
  check('Sportster re-apply adds nothing, skips all 18',
    again.added === 0 && again.skipped === 18);
  app.validateImport(JSON.parse(JSON.stringify(s)));
  check('auto-filled Sportster logbook still validates as CLI-shaped', true);
})();
(function () {
  /* A Sportster bike never gets a Softail value, and vice versa. */
  var s = app.emptyStore();
  app.addBike(s, { name: 'Sporty', year: '1998', make: 'Harley-Davidson', model: '1200', odometer: '15000' });
  var sbid = Object.keys(s.bikes)[0];
  app.applyFactorySchedule(s, sbid);
  app.addBike(s, { name: 'Fatty', year: '1995', make: 'Harley-Davidson', model: 'Fat Boy', odometer: '20000' });
  var fbid = Object.keys(s.bikes).filter(function (id) { return s.bikes[id].name === 'Fatty'; })[0];
  app.applyFactorySchedule(s, fbid);
  var sportyPlugs = Object.keys(s.tasks).filter(function (id) {
    return s.tasks[id].bike_id === sbid && s.tasks[id].name === 'Spark plugs';
  })[0];
  var fattyPlugs = Object.keys(s.tasks).filter(function (id) {
    return s.tasks[id].bike_id === fbid && s.tasks[id].name === 'Spark plugs';
  })[0];
  check('Sportster plugs 10,000 beside Softail plugs 20,000 in one logbook',
    s.tasks[sportyPlugs].every_miles === 10000 && s.tasks[fattyPlugs].every_miles === 20000);
})();

/* --- wear clocks --- */
(function () {
  var s = app.emptyStore();
  var r = bikeWithTask(s, { odo: 40000, miles: 5000, baseline_odo: 37000, baseline_date: '2026-01-01' });
  function oilClock() {
    return app.wearClocks(s, r.bid, '2026-11-04').filter(function (c) { return c.component === 'Engine oil'; })[0];
  }
  check('wear clock quiet before the published interval',
    oilClock().status === 'ok' && oilClock().tracked === true);
  s.bikes[r.bid].odometer = 41500;
  check('wear clock due-soon inside 500 mi of the interval',
    oilClock().status === 'due-soon');
  s.bikes[r.bid].odometer = 42000;
  check('wear clock overdue at the published interval',
    oilClock().status === 'overdue');
  app.logService(s, { bike_id: r.bid, task_id: r.tid, date: '2026-11-04', odometer: '42000', cost: '' });
  check('wear clock resets on a logged service',
    oilClock().status === 'ok');
  check('wear clock shows the task interval',
    oilClock().interval.indexOf('5,000') >= 0);
})();
(function () {
  /* A Sportster plugs clock runs on the Sportster interval (10,000),
   * not the Softail one (20,000). */
  var s = app.emptyStore();
  app.addBike(s, { name: 'Sporty', year: '1998', make: 'Harley-Davidson', model: '1200', odometer: '15000' });
  var bid = Object.keys(s.bikes)[0];
  app.applyFactorySchedule(s, bid);
  var plugs = app.wearClocks(s, bid, '2026-11-04').filter(function (c) { return c.component === 'Spark plugs'; })[0];
  check('Sportster plugs clock uses the 10,000-mi interval',
    !!plugs && plugs.tracked === true && plugs.interval.indexOf('10,000') >= 0);
  check('Sportster plugs clock cites the Sportster source',
    plugs.source.indexOf('#99484-98') >= 0);
})();
(function () {
  /* A bike with a factory schedule but no tasks yet shows the
   * published interval as not-tracked, not a made-up clock. */
  var s = app.emptyStore();
  app.addBike(s, { name: 'Bare Fat Boy', year: '1995', make: 'Harley-Davidson', model: 'Fat Boy', odometer: '20000' });
  var bid = Object.keys(s.bikes)[0];
  var before = JSON.stringify(s);
  var clocks = app.wearClocks(s, bid, '2026-11-04');
  check('wearClocks changes nothing in the store', JSON.stringify(s) === before);
  var oil = clocks.filter(function (c) { return c.component === 'Engine oil'; })[0];
  check('untracked component shows the published interval',
    oil.status === 'not-tracked' && oil.interval.indexOf('5,000') >= 0 &&
    oil.source.indexOf('#99482-98') >= 0);
  /* A bike with no schedule at all gets no-interval, never invented. */
  var s2 = app.emptyStore();
  app.addBike(s2, { name: 'Tiger', year: '2020', make: 'Triumph', model: 'Tiger 900', odometer: '5000' });
  var bid2 = Object.keys(s2.bikes)[0];
  var oil2 = app.wearClocks(s2, bid2, '2026-11-04').filter(function (c) { return c.component === 'Engine oil'; })[0];
  check('unscheduled bike shows no-interval, never an invented one',
    oil2.status === 'no-interval' && oil2.tracked === false);
})();
(function () {
  /* The drive-chain clock exists, but ONLY for chain-drive
   * Sportsters — belt-drive bikes and Softails never get one. */
  check('drive-chain clock exists, scoped to chain-drive Sportsters',
    app.WEAR_COMPONENTS.some(function (c) { return c.component === 'Drive chain'; }));
  check('no coolant clock (air-cooled)',
    !app.WEAR_COMPONENTS.some(function (c) { return c.component === 'Coolant'; }));
  var s = app.emptyStore();
  app.addBike(s, { name: 'Fat Boy', year: '1995', make: 'Harley-Davidson', model: 'Fat Boy', odometer: '20000' });
  var bid = Object.keys(s.bikes)[0];
  app.applyFactorySchedule(s, bid);
  var tires = app.wearClocks(s, bid, '2026-11-04').filter(function (c) { return c.component === 'Tires'; })[0];
  check('tires clock is the inspect interval, with the replace-on-condition note',
    !!tires && tires.tracked === true && tires.interval.indexOf('5,000') >= 0 &&
    tires.about.indexOf('replace on condition') >= 0);
  var threw = false;
  try { app.wearClocks(s, 'b99'); } catch (e) { threw = true; }
  check('wear clock for an unknown bike throws', threw);
})();

/* --- chain-drive Sportster: Clymer 300-mi chain lube, year-scoped --- */
(function () {
  var sched = app.factoryScheduleFor('Harley-Davidson', '883', 1988);
  var chain = sched.tasks.filter(function (t) { return t.name === 'Drive chain lubrication'; })[0];
  check('chain-lube line is 300 mi, labeled Clymer, SPORTSTER, chain-drive only',
    !!chain && chain.every_miles === 300 &&
    chain.notes.indexOf('Clymer') >= 0 &&
    chain.notes.indexOf('SPORTSTER value') >= 0 &&
    chain.notes.indexOf('chain-drive models ONLY') >= 0 &&
    chain.notes.indexOf('300 mi (480 km)') >= 0);
  check('chain-lube line is scoped to 1986–1990',
    !!chain && chain.years && chain.years[0] === 1986 && chain.years[1] === 1990);
  /* 1988 chain-drive Sportster: auto-fill adds all 19, chain lube included. */
  var s = app.emptyStore();
  app.addBike(s, { name: 'Old Sporty', year: '1988', make: 'Harley-Davidson', model: '883', odometer: '12000' });
  var bid = Object.keys(s.bikes)[0];
  var res = app.applyFactorySchedule(s, bid);
  check('1988 chain-drive Sportster auto-fill adds all 19 factory tasks',
    res.added === 19 && res.skipped === 0 && Object.keys(s.tasks).length === 19);
  var chainId = Object.keys(s.tasks).filter(function (id) { return s.tasks[id].name === 'Drive chain lubrication'; })[0];
  check('1988 chain-lube task carries the Clymer note',
    !!chainId && s.tasks[chainId].every_miles === 300 &&
    s.tasks[chainId].notes.indexOf('Clymer') >= 0);
  var clock = app.wearClocks(s, bid, '2026-11-04').filter(function (c) { return c.component === 'Drive chain'; })[0];
  check('1988 chain clock is tracked on the 300-mi interval, citing Clymer',
    !!clock && clock.tracked === true && clock.interval.indexOf('300') >= 0 &&
    clock.source.indexOf('Clymer') >= 0);
  /* 1990 is the last chain year; 1991 belt bike gets no chain task. */
  var s91 = app.emptyStore();
  app.addBike(s91, { name: 'Belt Sporty', year: '1991', make: 'Harley-Davidson', model: '883', odometer: '12000' });
  var bid91 = Object.keys(s91.bikes)[0];
  app.applyFactorySchedule(s91, bid91);
  check('1991 Sportster gets no drive-chain task',
    !Object.keys(s91.tasks).some(function (id) { return s91.tasks[id].name === 'Drive chain lubrication'; }));
  var clock91 = app.wearClocks(s91, bid91, '2026-11-04').filter(function (c) { return c.component === 'Drive chain'; })[0];
  check('1991 belt-drive Sportster chain clock is no-interval',
    !!clock91 && clock91.status === 'no-interval' && clock91.tracked === false);
  /* Softail never gets a chain task or clock. */
  var sF = app.emptyStore();
  app.addBike(sF, { name: 'Fatty', year: '1995', make: 'Harley-Davidson', model: 'Fat Boy', odometer: '20000' });
  var bidF = Object.keys(sF.bikes)[0];
  app.applyFactorySchedule(sF, bidF);
  var clockF = app.wearClocks(sF, bidF, '2026-11-04').filter(function (c) { return c.component === 'Drive chain'; })[0];
  check('Softail chain clock is no-interval',
    !!clockF && clockF.status === 'no-interval');
  /* Untracked 1988 Sportster shows the published 300-mi interval. */
  var sU = app.emptyStore();
  app.addBike(sU, { name: 'Bare Sporty', year: '1988', make: 'Harley-Davidson', model: '883', odometer: '12000' });
  var bidU = Object.keys(sU.bikes)[0];
  var clockU = app.wearClocks(sU, bidU, '2026-11-04').filter(function (c) { return c.component === 'Drive chain'; })[0];
  check('untracked 1988 chain clock shows the published 300-mi interval',
    !!clockU && clockU.status === 'not-tracked' && clockU.interval.indexOf('300') >= 0 &&
    clockU.source.indexOf('Clymer') >= 0);
})();
(function () {
  /* A 300-mi interval can actually read ok: the due-soon window
   * caps at half the interval, so it is 150 mi here, not 500. */
  var s = app.emptyStore();
  var r = bikeWithTask(s, { odo: 10100, miles: 300, baseline_odo: 10000, baseline_date: '2026-11-01' });
  check('300-mi task ok with 200 mi left (inside the interval, outside the capped window)',
    app.taskStatus(s, r.bid, r.tid, '2026-11-04').status === 'ok');
  s.bikes[r.bid].odometer = 10160; /* 140 left -> due soon */
  check('300-mi task due-soon inside 150 mi',
    app.taskStatus(s, r.bid, r.tid, '2026-11-04').status === 'due-soon');
  s.bikes[r.bid].odometer = 10300; /* exactly due -> overdue */
  check('300-mi task overdue at the interval',
    app.taskStatus(s, r.bid, r.tid, '2026-11-04').status === 'overdue');
})();

/* --- tire age clock: Michelin/Dunlop 5/10 rule, DOT decode --- */
(function () {
  /* DOT decode — same rules as the Evo Diagnostic's tire reader. */
  var d1 = app.decodeDotDate('5107');
  check('DOT 5107 decodes to week 51 of 2007 (Dec 17, 2007)',
    d1.week === 51 && d1.year === 2007 && d1.madeISO === '2007-12-17');
  var d2 = app.decodeDotDate('0308');
  check('DOT 0308 decodes to week 3 of 2008 (Jan 15, 2008)',
    d2.week === 3 && d2.year === 2008 && d2.madeISO === '2008-01-15');
  var d3 = app.decodeDotDate('258');
  check('3-digit DOT 258 reads as week 25 of 1998',
    d3.week === 25 && d3.year === 1998 && d3.madeISO === '1998-06-18');
  check('DOT week 54 is rejected', !!app.decodeDotDate('5407').error);
  check('DOT code of 2 digits is rejected', !!app.decodeDotDate('12').error);
  check('DOT code reading a future year is rejected', !!app.decodeDotDate('0150').error);

  function bikeWithTire(made) {
    var s = app.emptyStore();
    app.addBike(s, { name: 'Tire Bike', odometer: '10000' });
    var bid = Object.keys(s.bikes)[0];
    if (made) app.setTireDate(s, bid, made);
    return { s: s, bid: bid };
  }
  /* setTireDate: plain date, DOT code, clear, bad input. */
  var r = bikeWithTire();
  app.setTireDate(r.s, r.bid, '2019-12-16');
  check('setTireDate stores a plain manufacture date',
    r.s.bikes[r.bid].tire_made === '2019-12-16');
  app.setTireDate(r.s, r.bid, '5107');
  check('setTireDate decodes a DOT code to the manufacture date',
    r.s.bikes[r.bid].tire_made === '2007-12-17');
  app.setTireDate(r.s, r.bid, '');
  check('setTireDate with empty clears the date',
    r.s.bikes[r.bid].tire_made === null);
  throws('setTireDate rejects garbage', function () {
    app.setTireDate(r.s, r.bid, 'not a date');
  });
  throws('setTireDate rejects an impossible calendar date', function () {
    app.setTireDate(r.s, r.bid, '2021-02-30');
  });
  throws('setTireDate rejects a future manufacture date', function () {
    app.setTireDate(r.s, r.bid, '2999-01-01');
  });
  throws('setTireDate on an unknown bike throws', function () {
    app.setTireDate(r.s, 'b99', '2019-01-01');
  });

  /* Bands, fixed asOf 2026-11-04 so nothing drifts. */
  var young = bikeWithTire('2024-01-01');
  var yc = app.tireAgeClock(young.s, young.bid, '2026-11-04');
  check('tire age green under 5 years',
    yc.status === 'ok' && yc.tracked === true);
  check('tire age replace-by is manufacture + 10 years',
    yc.details[2].indexOf('Jan 1, 2034') >= 0);
  var five = bikeWithTire('2021-11-04');
  check('tire age amber on the 5-year line, not before',
    app.tireAgeClock(five.s, five.bid, '2026-11-03').status === 'ok' &&
    app.tireAgeClock(five.s, five.bid, '2026-11-04').status === 'due-soon');
  var amber = app.tireAgeClock(five.s, five.bid, '2026-11-04');
  check('tire age amber says inspect every year',
    amber.details[1].indexOf('inspection every year') >= 0);
  check('tire age amber replace-by is Nov 4, 2031',
    amber.details[2].indexOf('Nov 4, 2031') >= 0);
  var ten = bikeWithTire('2016-11-04');
  check('tire age red on the 10-year line, not before',
    app.tireAgeClock(ten.s, ten.bid, '2026-11-03').status === 'due-soon' &&
    app.tireAgeClock(ten.s, ten.bid, '2026-11-04').status === 'overdue');
  var red = app.tireAgeClock(ten.s, ten.bid, '2026-11-04');
  check('tire age red says replace even with tread left',
    red.details[1].indexOf('even if the tread looks fine') >= 0);
  /* DOT-code tire, end to end: 5107 made Dec 2007 is long past 10. */
  var old = bikeWithTire('5107');
  var oc = app.tireAgeClock(old.s, old.bid, '2026-11-04');
  check('DOT-code tire clock is overdue with the decoded replace-by',
    oc.status === 'overdue' && oc.details[0].indexOf('week 51 of 2007') >= 0 &&
    oc.details[2].indexOf('Dec 17, 2017') >= 0);
  /* 3-digit-code tire is red on sight. */
  var vintage = bikeWithTire('258');
  check('3-digit DOT tire is red on sight',
    app.tireAgeClock(vintage.s, vintage.bid, '2026-11-04').status === 'overdue');

  /* The clock names whose rule it applies — and never the 6-year
   * car-tire figure. */
  check('tire age clock cites Michelin/Dunlop, repeated by Harley-Davidson',
    yc.source.indexOf('Michelin/Dunlop') >= 0 &&
    yc.source.indexOf('Harley-Davidson') >= 0);
  check('tire age clock never uses the 6-year car figure',
    JSON.stringify(yc).indexOf('6-year') === -1 &&
    JSON.stringify(yc).indexOf('6 year') === -1);

  /* Unset: old logbook, no date entered. */
  var bare = bikeWithTire();
  var bc = app.tireAgeClock(bare.s, bare.bid, '2026-11-04');
  check('tire age with no date entered is not-tracked',
    bc.status === 'not-tracked' && bc.tracked === false &&
    bc.details[0].indexOf('No date entered') === 0);
  /* A bike object with no tire_made key at all (pre-v18 logbook)
   * behaves the same — never an error. */
  var legacy = app.emptyStore();
  app.addBike(legacy, { name: 'Legacy Bike', odometer: '5000' });
  var lbid = Object.keys(legacy.bikes)[0];
  delete legacy.bikes[lbid].tire_made;
  check('legacy bike without a tire_made key shows no date entered',
    app.tireAgeClock(legacy, lbid, '2026-11-04').status === 'not-tracked');
  app.validateImport(JSON.parse(JSON.stringify(legacy)));
  check('legacy logbook without tire dates still validates', true);
  var badMade = JSON.parse(JSON.stringify(legacy));
  badMade.bikes[lbid].tire_made = 'garbage';
  throws('import rejects a bad tire manufacture date', function () {
    app.validateImport(badMade);
  });

  /* The clock rides in wearClocks as the 18th clock, read-only,
   * with no Log button target (no task drives it). */
  var s2 = bikeWithTire('2021-11-04');
  var before = JSON.stringify(s2.s);
  var clocks = app.wearClocks(s2.s, s2.bid, '2026-11-04');
  check('wearClocks now carries 18 clocks including Tire age',
    clocks.length === 18 &&
    clocks.some(function (c) { return c.component === 'Tire age'; }));
  var wc = clocks.filter(function (c) { return c.component === 'Tire age'; })[0];
  check('wearClocks Tire age matches tireAgeClock and has no task',
    wc.status === 'due-soon' && wc.taskId === null && wc.tracked === true);
  check('wearClocks with a tire date changes nothing in the store',
    JSON.stringify(s2.s) === before);
  var threw = false;
  try { app.tireAgeClock(s2.s, 'b99', '2026-11-04'); } catch (e) { threw = true; }
  check('tire age clock for an unknown bike throws', threw);

  /* Bike removal cascades to its tire date. */
  var gone = bikeWithTire('2019-01-01');
  app.removeBike(gone.s, gone.bid);
  check('removing the bike removes its tire date with it',
    Object.keys(gone.s.bikes).length === 0);
})();

/* --- receipt photos on expenses --- */
var TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AvwH/2Q==';
(function () {
  var s = app.emptyStore();
  app.addBike(s, { name: 'Bike', odometer: '1000' });
  var bid = Object.keys(s.bikes)[0];
  var x = app.addExpense(s, { bike_id: bid, date: '2026-11-04', category: 'parts', description: 'Oil', cost: '48.50' });
  check('expense without a photo loads with photo null', x.photo === null);
  app.attachExpensePhoto(s, x.id, { name: 'receipt.jpg', type: 'image/jpeg', dataUrl: TINY_JPEG });
  check('attach stores the photo on the expense',
    s.expenses[0].photo && s.expenses[0].photo.dataUrl === TINY_JPEG);
  check('attached photo validates', app.isExpensePhoto(s.expenses[0].photo) === true);
  throws('non-image data URL rejected', function () {
    app.attachExpensePhoto(s, x.id, { name: 'x.txt', type: 'text/plain', dataUrl: 'data:text/plain;base64,aGk=' });
  });
  throws('oversize photo rejected', function () {
    var big = 'data:image/jpeg;base64,' + new Array(app.MAX_PHOTO_CHARS).join('A');
    app.attachExpensePhoto(s, x.id, { name: 'big.jpg', type: 'image/jpeg', dataUrl: big });
  });
  check('rejected attach leaves the good photo alone',
    s.expenses[0].photo && s.expenses[0].photo.dataUrl === TINY_JPEG);
  check('remove photo returns true and clears it',
    app.removeExpensePhoto(s, x.id) === true && s.expenses[0].photo === null);
  check('remove photo again returns false',
    app.removeExpensePhoto(s, x.id) === false);
  throws('attach to an unknown expense throws', function () {
    app.attachExpensePhoto(s, 'x99', { name: 'r.jpg', type: 'image/jpeg', dataUrl: TINY_JPEG });
  });
})();
(function () {
  /* Old expense entries (no photo key) load fine and validate. */
  var s = app.emptyStore();
  app.addBike(s, { name: 'Bike', odometer: '1000' });
  var bid = Object.keys(s.bikes)[0];
  var old = {
    bikes: s.bikes, tasks: {}, entries: [],
    expenses: [{ id: 'x1', bike_id: bid, date: '2026-11-01', category: 'parts', description: 'Old oil', cost: 30, odometer: 42000, notes: '' }]
  };
  var imported = app.validateImport(JSON.parse(JSON.stringify(old)));
  check('old expense with no photo key validates',
    imported.expenses.length === 1 && imported.expenses[0].photo == null);
  var withPhoto = JSON.parse(JSON.stringify(old));
  withPhoto.expenses[0].photo = { name: 'r.jpg', type: 'image/jpeg', dataUrl: TINY_JPEG };
  check('expense with a valid photo validates',
    app.validateImport(withPhoto).expenses[0].photo.dataUrl === TINY_JPEG);
  var badPhoto = JSON.parse(JSON.stringify(old));
  badPhoto.expenses[0].photo = { name: 'r.jpg', type: 'image/jpeg', dataUrl: 'data:text/plain;base64,aGk=' };
  throws('expense with a bad photo fails validation', function () { app.validateImport(badPhoto); });
})();
(function () {
  /* Exports flag the photo without embedding it. */
  var s = app.emptyStore();
  app.addBike(s, { name: 'Bike', odometer: '1000' });
  var bid = Object.keys(s.bikes)[0];
  var x = app.addExpense(s, { bike_id: bid, date: '2026-11-04', category: 'parts', description: 'Oil', cost: '48.50' });
  app.attachExpensePhoto(s, x.id, { name: 'receipt.jpg', type: 'image/jpeg', dataUrl: TINY_JPEG });
  app.addExpense(s, { bike_id: bid, date: '2026-11-05', category: 'labor', description: 'Shop time', cost: '100' });
  var exp = app.bikeExpensesExport(s, bid);
  check('expenses export flags has_photo per expense (newest first)',
    exp.expenses[0].has_photo === false && exp.expenses[1].has_photo === true);
  check('expenses export does not embed the photo data',
    JSON.stringify(exp).indexOf('data:image') === -1);
  check('expenses text notes the attached photo',
    app.bikeExpensesText(s, bid).indexOf('receipt photo attached') >= 0);
  var hist = app.bikeHistoryExport(s, bid);
  check('history export flags has_photo on its expenses',
    hist.expenses[1].has_photo === true);
})();

/* --- due reminders --- */
(function () {
  var s = app.sampleStore();
  var rem = app.dueReminders(s, null);
  check('reminders from the sample: 1 overdue, 1 due soon, 2 total',
    rem.overdueCount === 1 && rem.dueSoonCount === 1 && rem.total === 2);
  check('reminders leave ok tasks out',
    rem.rows.every(function (r) { return r.status !== 'ok'; }));
  check('reminders sort overdue first',
    rem.rows[0].status === 'overdue' && rem.rows[1].status === 'due-soon');
  check('reminders name the overdue task',
    s.tasks[rem.rows[0].task_id].name === 'Brake fluid (inspect)');
  var bid = Object.keys(s.bikes)[0];
  var perBike = app.dueReminders(s, bid);
  check('reminders scoped to one bike match the all-bikes set',
    perBike.total === 2);
  check('reminders for an unknown bike are empty',
    app.dueReminders(s, 'b99').total === 0);
})();
(function () {
  var s = app.emptyStore();
  check('reminders on an empty logbook are empty',
    app.dueReminders(s, null).total === 0);
  var r = bikeWithTask(s, { odo: 1000, miles: 100000, baseline_odo: 0, baseline_date: '2026-01-01' });
  check('reminders skip an all-ok logbook',
    app.dueReminders(s, null).total === 0);
  /* Same task, two bikes: each bike's reminder stays on its own bike. */
  var s2 = app.emptyStore();
  var a = bikeWithTask(s2, { bike: 'Bike A', odo: 5000, miles: 3000, baseline_odo: 0, baseline_date: '2026-01-01' });
  var b2 = app.addBike(s2, { name: 'Bike B', odometer: '1000' });
  var b2id = Object.keys(s2.bikes).filter(function (id) { return s2.bikes[id].name === 'Bike B'; })[0];
  app.addTask(s2, { bike_id: b2id, name: 'Engine oil', every_miles: '3000', every_months: '' });
  var remA = app.dueReminders(s2, a.bid, '2026-11-04');
  var remB = app.dueReminders(s2, b2id, '2026-11-04');
  check('reminders are per-bike: overdue on A only, B all ok',
    remA.total === 1 && remB.total === 0);
  void b2;
})();
(function () {
  /* Reminders are read-only: calling them changes no task or entry. */
  var s = app.sampleStore();
  var before = JSON.stringify(s);
  app.dueReminders(s, null);
  check('dueReminders changes nothing in the store',
    JSON.stringify(s) === before);
})();

/* --- per-bike service history export --- */
(function () {
  var s = app.sampleStore();
  var bid = Object.keys(s.bikes)[0];
  var data = app.bikeHistoryExport(s, bid);
  check('history export names the bike',
    data.bike.name === 'Example 1995 Softail' && data.bike.year === 1995);
  check('history export has 3 services, newest first',
    data.services.length === 3 && data.services[0].task === 'Primary fluid');
  check('history export totals $78.50',
    data.total_spent === 78.50 && data.service_count === 3);
  check('history export lists the bike tasks with intervals',
    data.tasks.length === 4 &&
    data.tasks.some(function (t) { return t.name === 'Engine oil' && t.every_miles === 5000; }));
  check('history export carries the odometer and export date',
    data.bike.odometer === 42300 && /^\d{4}-\d{2}-\d{2}$/.test(data.exported));
  check('history export JSON round-trips',
    JSON.parse(JSON.stringify(data)).services.length === 3);
  throws('history export for an unknown bike throws', function () {
    app.bikeHistoryExport(s, 'b99');
  });
})();
(function () {
  /* Export is one bike only — the other bike's services stay out. */
  var s = app.emptyStore();
  var a = bikeWithTask(s, { bike: 'Bike A', odo: 5000, miles: 3000 });
  app.logService(s, { bike_id: a.bid, task_id: a.tid, date: '2026-11-01', odometer: '5000', cost: '25', notes: 'A only' });
  var b2 = app.addBike(s, { name: 'Bike B', odometer: '1000' });
  var b2id = Object.keys(s.bikes).filter(function (id) { return s.bikes[id].name === 'Bike B'; })[0];
  var tb = app.addTask(s, { bike_id: b2id, name: 'Engine oil', every_miles: '3000', every_months: '' });
  var tbid = Object.keys(s.tasks).filter(function (id) { return s.tasks[id].name === 'Engine oil' && s.tasks[id].bike_id === b2id; })[0];
  void b2; void tb;
  app.logService(s, { bike_id: b2id, task_id: tbid, date: '2026-11-02', odometer: '1000', cost: '99', notes: 'B only' });
  var dataA = app.bikeHistoryExport(s, a.bid);
  check('export for Bike A has only Bike A services',
    dataA.services.length === 1 && dataA.services[0].notes === 'A only' && dataA.total_spent === 25);
  var dataB = app.bikeHistoryExport(s, b2id);
  check('export for Bike B has only Bike B services',
    dataB.services.length === 1 && dataB.total_spent === 99);
  var textA = app.bikeHistoryText(s, a.bid);
  check('text export for Bike A never mentions Bike B',
    textA.indexOf('Bike B') === -1 && textA.indexOf('B only') === -1);
})();
(function () {
  var s = app.sampleStore();
  var bid = Object.keys(s.bikes)[0];
  var text = app.bikeHistoryText(s, bid);
  check('text export names the bike and its spec',
    text.indexOf('Example 1995 Softail') >= 0 && text.indexOf('Fat Boy') >= 0);
  check('text export lists services newest first with date, task, mileage, cost',
    text.indexOf('Primary fluid @ 41,300 mi — $18.00') >= 0);
  check('text export shows the total and the service count',
    text.indexOf('3 services — total $78.50') >= 0);
  check('text export lists the bike tasks with intervals',
    text.indexOf('Engine oil (every 5,000 mi)') >= 0);
  check('text export includes a service note',
    text.indexOf('20W-50, new filter') >= 0);
  check('text export ends with a newline',
    text.slice(-1) === '\n');
})();
(function () {
  var s = app.emptyStore();
  var r = bikeWithTask(s, { odo: 1000, miles: 3000 });
  var data = app.bikeHistoryExport(s, r.bid);
  check('history export for a bike with no services is empty, not an error',
    data.services.length === 0 && data.service_count === 0 && data.total_spent === 0);
  var text = app.bikeHistoryText(s, r.bid);
  check('text export for a bike with no services says so',
    text.indexOf('No services logged yet for this bike.') >= 0);
})();
check('history filename slugs the bike name',
  app.historyExportFilename('Example 1995 Softail', 'json') === 'bike-log-example-1995-softail-history.json');
check('history filename handles odd characters',
  app.historyExportFilename("Josh's Fat Boy!", 'txt') === 'bike-log-josh-s-fat-boy-history.txt');
check('history filename falls back to bike for an empty name',
  app.historyExportFilename('', 'json') === 'bike-log-bike-history.json');

console.log('pocket handoff — diagnosis to task (receiving side)');
function exampleTaskHandoff(overrides) {
  var h = {
    format: 'pocket-garage-handoff', version: 1, kind: 'diagnosis-to-task',
    sentAt: '2026-11-24T18:00:00.000Z', from: 'evo-diagnostic',
    bike: { rosterKey: 'b2', name: '1990 Softail' },
    payload: {
      treeId: 'carb-running', treeTitle: 'Running rich / poor idle',
      topCause: 'Pilot jet too large',
      cause: 'Pilot jet too large — idle mixture screw has no effect',
      test: 'Screw the mixture screw all the way in: if the idle does not stumble, the pilot is too big',
      fix: 'Fit one size smaller pilot jet, then re-adjust the mixture screw',
      urgency: 'medium', safeToRide: 'Likely rideable — running rich at idle. Fix soon.',
      suggestedTaskName: 'Carb — pilot jet too large'
    }
  };
  if (overrides) Object.keys(overrides).forEach(function (k) { h[k] = overrides[k]; });
  return h;
}
var _th = exampleTaskHandoff();
var _thB64 = app.encodePocketHandoff(_th);
check('handoff encodes to base64url (no + / or =)', /^[-A-Za-z0-9_]+$/.test(_thB64));
check('handoff round-trips through base64url',
  JSON.stringify(app.parsePocketHandoff(_thB64)) === JSON.stringify(_th));
check('handoff parses from raw pasted JSON too',
  app.parsePocketHandoff(JSON.stringify(_th)).payload.suggestedTaskName === 'Carb — pilot jet too large');
throws('wrong format rejected', function () {
  app.parsePocketHandoff(JSON.stringify(exampleTaskHandoff({ format: 'nope' })));
});
throws('version 2 rejected', function () {
  app.parsePocketHandoff(JSON.stringify(exampleTaskHandoff({ version: 2 })));
});
throws('carb kind rejected by the bike log', function () {
  app.parsePocketHandoff(JSON.stringify(exampleTaskHandoff({ kind: 'diagnosis-to-carb' })));
});
throws('dyno kind rejected by the bike log', function () {
  app.parsePocketHandoff(JSON.stringify(exampleTaskHandoff({ kind: 'dyno-run-to-mod' })));
});
throws('task name over 80 chars rejected', function () {
  var h = exampleTaskHandoff();
  h.payload.suggestedTaskName = new Array(90).join('x');
  app.parsePocketHandoff(JSON.stringify(h));
});
throws('oversize handoff rejected', function () {
  var h = exampleTaskHandoff(); h.payload.cause = new Array(9000).join('x');
  app.parsePocketHandoff(JSON.stringify(h));
});
(function () {
  var r = app.emptyStore();
  var rb = app.addBike(r, { name: '1990 Softail', year: '1990', make: 'Harley-Davidson', model: 'Heritage Classic' });
  var rid = Object.keys(r.bikes).filter(function (id) { return r.bikes[id] === rb; })[0];
  check('bike resolves by name match (no pin yet)',
    (function () { var res = app.resolvePocketHandoffBike(r, _th); return res.status === 'matched' && res.via === 'name'; })());
  app.pinPocketRosterKey(r, 'b2', rid);
  check('after pinning, the same handoff resolves by roster key',
    app.resolvePocketHandoffBike(r, _th).via === 'roster');
  check('resolution carries the bike id (bike-log bikes have no id field)',
    app.resolvePocketHandoffBike(r, _th).bikeId === rid);
  check('a second handoff after pinning still drafts against that bike',
    app.taskFromHandoff(r, _th, app.resolvePocketHandoffBike(r, _th).bikeId).name === 'Carb — pilot jet too large');
  check('unknown bike resolves to unknown, never a guess',
    (function () { var h = exampleTaskHandoff(); h.bike = { rosterKey: 'b9', name: 'No Such Bike' };
      return app.resolvePocketHandoffBike(r, h).status === 'unknown'; })());
  var s = app.sampleStore();
  var bid = Object.keys(s.bikes)[0];
  var draft = app.taskFromHandoff(s, _th, bid);
  check('task draft carries the suggested name and a diagnosis citation',
    draft.name === 'Carb — pilot jet too large' && draft.existingTaskId === null &&
    draft.notes.indexOf('From the Evo Diagnostic') === 0 &&
    draft.notes.indexOf('Pilot jet too large') >= 0);
  var added = app.addTask(s, {
    bike_id: bid, name: draft.name, every_miles: '5000', every_months: '', notes: draft.notes
  });
  check('confirming with a 5000-mi interval creates the task', !!added);
  var draft2 = app.taskFromHandoff(s, _th, bid);
  check('second handoff for the same cause finds the existing task, no duplicate',
    draft2.existingTaskId !== null);
  check('existing-task lookup is case-insensitive',
    app.taskFromHandoff(s, _th, bid, 'carb — PILOT JET TOO LARGE').existingTaskId !== null);
  check('renamed task draft uses the new name',
    app.taskFromHandoff(s, _th, bid, 'Check pilot jet').name === 'Check pilot jet');
  check('citation never invents an interval or a jet size',
    draft.notes.indexOf('5000') < 0 && draft.notes.indexOf('every') < 0);
  throws('pinning the same key to a second bike is refused', function () {
    var t = app.emptyStore();
    var b1 = app.addBike(t, { name: 'Bike One' });
    var b2 = app.addBike(t, { name: 'Bike Two' });
    var id1 = Object.keys(t.bikes).filter(function (id) { return t.bikes[id] === b1; })[0];
    var id2 = Object.keys(t.bikes).filter(function (id) { return t.bikes[id] === b2; })[0];
    app.pinPocketRosterKey(t, 'b2', id1);
    app.pinPocketRosterKey(t, 'b2', id2);
  });
})();

console.log('pocket handoff — timing job to task (receiving side, kind timing-to-task)');
function exampleTimingHandoff(overrides) {
  var h = {
    format: 'pocket-garage-handoff', version: 1, kind: 'timing-to-task',
    sentAt: '2026-11-25T18:00:00.000Z', from: 'ignition-timing-helper',
    bike: { rosterKey: 'b1', name: '1995 Fat Boy' },
    payload: {
      timing: {
        date: '2026-11-25', ignition: 'dyna-2000i', method: 'dynamic', curve: 2,
        finalAdvanceDeg: 35,
        result: 'Mark centered at full advance, no ping on a test ride.',
        notes: 'Switched from curve 3 after pinging on curve 2 was cured — recheck after 500 miles.',
        source: 'Dynatek 2801103 Rev. C (curves/final advance); FSM #99482-98 Ch. 1 + Ch. 8 (factory 20° BTDC check)'
      },
      suggestedTaskName: 'Ignition timing — check / adjust',
      suggestedIntervalMiles: 5000,
      intervalSource: 'FSM #99482-98 Ch. 1 + Ch. 8: check timing every 5,000 miles'
    }
  };
  if (overrides) Object.keys(overrides).forEach(function (k) { h[k] = overrides[k]; });
  return h;
}
var _tt = exampleTimingHandoff();
check('timing handoff round-trips through base64url',
  JSON.stringify(app.parsePocketHandoff(app.encodePocketHandoff(_tt))) === JSON.stringify(_tt));
check('timing handoff parses from raw pasted JSON too',
  app.parsePocketHandoff(JSON.stringify(_tt)).payload.suggestedIntervalMiles === 5000);
throws('timing handoff with curve 5 rejected', function () {
  var h = exampleTimingHandoff(); h.payload.timing.curve = 5;
  app.parsePocketHandoff(JSON.stringify(h));
});
throws('timing handoff with a curve on stock ignition rejected', function () {
  var h = exampleTimingHandoff();
  h.payload.timing.ignition = 'stock'; h.payload.timing.curve = 2;
  app.parsePocketHandoff(JSON.stringify(h));
});
throws('timing handoff with a bad method rejected', function () {
  var h = exampleTimingHandoff(); h.payload.timing.method = 'guess';
  app.parsePocketHandoff(JSON.stringify(h));
});
throws('timing handoff with no interval source rejected', function () {
  var h = exampleTimingHandoff(); h.payload.intervalSource = '';
  app.parsePocketHandoff(JSON.stringify(h));
});
throws('wiring kind rejected by the bike log', function () {
  app.parsePocketHandoff(JSON.stringify(exampleTimingHandoff({ kind: 'wiring-to-mod' })));
});
(function () {
  var h = exampleTimingHandoff();
  h.payload.timing.ignition = 'stock'; h.payload.timing.method = 'check';
  h.payload.timing.curve = null; h.payload.timing.finalAdvanceDeg = null;
  h.payload.timing.source = 'FSM #99482-98 Ch. 1 + Ch. 8 (factory 20° BTDC check)';
  var parsed = app.parsePocketHandoff(JSON.stringify(h));
  check('stock check with no curve validates, invents neither curve nor advance',
    parsed.payload.timing.curve === null && parsed.payload.timing.finalAdvanceDeg === null);
  var r = app.emptyStore();
  var rb = app.addBike(r, { name: '1995 Fat Boy', odometer: '10000' });
  var rid = Object.keys(r.bikes).filter(function (id) { return r.bikes[id] === rb; })[0];
  check('timing bike resolves by name match (no pin yet)',
    (function () { var res = app.resolvePocketHandoffBike(r, _tt); return res.status === 'matched' && res.via === 'name'; })());
  app.pinPocketRosterKey(r, 'b1', rid);
  check('after pinning, the timing handoff resolves by roster key',
    app.resolvePocketHandoffBike(r, _tt).via === 'roster');
  check('unknown timing bike resolves to unknown, never a guess',
    (function () { var bad = exampleTimingHandoff(); bad.bike = { rosterKey: 'b9', name: 'No Such Bike' };
      return app.resolvePocketHandoffBike(r, bad).status === 'unknown'; })());
  var s = app.sampleStore();
  var bid = Object.keys(s.bikes)[0];
  var draft = app.taskFromHandoff(s, _tt, bid);
  check('timing task draft carries the suggested name and the timing citation',
    draft.name === 'Ignition timing — check / adjust' && draft.existingTaskId === null &&
    draft.notes.indexOf('From the Ignition Timing Helper, 2026-11-25:') === 0 &&
    draft.notes.indexOf('dyna-2000i, dynamic, curve 2, 35° final advance') >= 0 &&
    draft.notes.indexOf('Mark centered at full advance') >= 0 &&
    draft.notes.indexOf('Dynatek 2801103 Rev. C') >= 0);
  check('timing citation never invents an interval',
    draft.notes.indexOf('5000') < 0 && draft.notes.indexOf('every') < 0);
  var added = app.addTask(s, {
    bike_id: bid, name: draft.name, every_miles: '5000', every_months: '', notes: draft.notes
  });
  check('confirming with the suggested 5000-mi interval creates the task', !!added);
  var draft2 = app.taskFromHandoff(s, _tt, bid);
  check('second timing handoff finds the existing task, no duplicate',
    draft2.existingTaskId !== null);
  var stockDraft = app.taskFromHandoff(s, parsed, bid, 'Ignition timing — stock check');
  check('stock-check citation shows no curve figure and no advance figure',
    stockDraft.notes.indexOf(', curve ') < 0 && stockDraft.notes.indexOf('final advance') < 0);
})();

/* --- expenses --- */
function expenseStore() {
  var s = app.emptyStore();
  var a = app.addBike(s, { name: 'Bike A', odometer: '5000' });
  var aId = Object.keys(s.bikes).filter(function (id) { return s.bikes[id] === a; })[0];
  var b = app.addBike(s, { name: 'Bike B', odometer: '1000' });
  var bId = Object.keys(s.bikes).filter(function (id) { return s.bikes[id] === b; })[0];
  return { s: s, aId: aId, bId: bId };
}
(function () {
  var r = expenseStore();
  var x = app.addExpense(r.s, { bike_id: r.aId, date: '2026-11-01', category: 'parts', description: 'Oil + filter', cost: '32.50', odometer: '5000', notes: 'bought at the dealer' });
  check('expense gets an x id and stores as given',
    x.id === 'x1' && x.cost === 32.50 && x.category === 'parts' && x.odometer === 5000);
  var x2 = app.addExpense(r.s, { bike_id: r.aId, date: '2026-11-02', category: 'labor', description: 'Shop labor', cost: '85' });
  check('second expense gets x2, blank odometer stays null',
    x2.id === 'x2' && x2.odometer === null);
  var x3 = app.addExpense(r.s, { bike_id: r.aId, date: '2026-11-03', category: '', description: 'Shop rag', cost: '4.999' });
  check('blank category defaults to other, cost rounds to cents (4.999 -> 5.00)',
    x3.category === 'other' && x3.cost === 5);
  var x4 = app.addExpense(r.s, { bike_id: r.aId, date: '2026-11-04', category: 'service', description: 'Gifted gasket', cost: '0' });
  check('a $0 expense is allowed (free part, still worth recording)', x4.cost === 0);
  throws('expense on unknown bike rejected', function () {
    app.addExpense(r.s, { bike_id: 'b99', date: '2026-11-01', category: 'parts', description: 'x', cost: '10' });
  });
  throws('expense with no description rejected', function () {
    app.addExpense(r.s, { bike_id: r.aId, date: '2026-11-01', category: 'parts', description: '   ', cost: '10' });
  });
  throws('expense with no cost rejected', function () {
    app.addExpense(r.s, { bike_id: r.aId, date: '2026-11-01', category: 'parts', description: 'x', cost: '' });
  });
  throws('expense with negative cost rejected', function () {
    app.addExpense(r.s, { bike_id: r.aId, date: '2026-11-01', category: 'parts', description: 'x', cost: '-5' });
  });
  throws('expense with a bad date rejected', function () {
    app.addExpense(r.s, { bike_id: r.aId, date: 'Nov 1', category: 'parts', description: 'x', cost: '10' });
  });
  throws('expense with an unknown category rejected', function () {
    app.addExpense(r.s, { bike_id: r.aId, date: '2026-11-01', category: 'bling', description: 'x', cost: '10' });
  });
  throws('expense with a negative odometer rejected', function () {
    app.addExpense(r.s, { bike_id: r.aId, date: '2026-11-01', category: 'parts', description: 'x', cost: '10', odometer: '-1' });
  });
})();
(function () {
  var r = expenseStore();
  app.addExpense(r.s, { bike_id: r.aId, date: '2026-11-01', category: 'parts', description: 'A1', cost: '10' });
  app.addExpense(r.s, { bike_id: r.aId, date: '2026-11-02', category: 'labor', description: 'A2', cost: '20' });
  app.addExpense(r.s, { bike_id: r.bId, date: '2026-11-03', category: 'parts', description: 'B1', cost: '99' });
  var all = app.expensesForBike(r.s, null, null);
  check('expenses newest first across bikes',
    all.length === 3 && all[0].description === 'B1' && all[2].description === 'A1');
  var aOnly = app.expensesForBike(r.s, r.aId, null);
  check('expenses filter to one bike',
    aOnly.length === 2 && aOnly.every(function (x) { return x.bike_id === r.aId; }));
  var parts = app.expensesForBike(r.s, null, 'parts');
  check('expenses filter to one category',
    parts.length === 2 && parts.every(function (x) { return x.category === 'parts'; }));
  check('expense total sums a bike',
    app.expenseTotal(aOnly) === 30);
  var byCat = app.expensesByCategory(all);
  check('per-category totals (parts 109, labor 20, service 0, other 0)',
    byCat.parts === 109 && byCat.labor === 20 && byCat.service === 0 && byCat.other === 0);
  app.removeExpense(r.s, 'x2');
  check('removing an expense drops it and only it',
    r.s.expenses.length === 2 && r.s.expenses.every(function (x) { return x.id !== 'x2'; }));
  var again = app.addExpense(r.s, { bike_id: r.aId, date: '2026-11-04', category: 'other', description: 'A3', cost: '1' });
  check('expense id is highest suffix in use + 1 (x3 still live, so x4 after deleting x2)', again.id === 'x4');
  throws('removing an unknown expense throws', function () {
    app.removeExpense(r.s, 'x99');
  });
})();
(function () {
  var r = expenseStore();
  app.addExpense(r.s, { bike_id: r.aId, date: '2026-11-01', category: 'parts', description: 'A1', cost: '10' });
  app.addExpense(r.s, { bike_id: r.bId, date: '2026-11-02', category: 'parts', description: 'B1', cost: '99' });
  app.removeBike(r.s, r.bId);
  check('removing a bike drops its expenses too',
    r.s.expenses.length === 1 && r.s.expenses[0].description === 'A1');
})();
(function () {
  /* History export carries the bike's expenses alongside its
   * services — the services shape is unchanged. */
  var s = app.emptyStore();
  var r = bikeWithTask(s, { bike: 'Bike A', odo: 5000, miles: 3000 });
  app.logService(s, { bike_id: r.bid, task_id: r.tid, date: '2026-11-01', odometer: '5000', cost: '25', notes: 'A service' });
  app.addExpense(s, { bike_id: r.bid, date: '2026-10-28', category: 'parts', description: 'Oil + filter', cost: '32.50', notes: 'bought ahead' });
  app.addExpense(s, { bike_id: r.bid, date: '2026-11-02', category: 'labor', description: 'Shop labor', cost: '85' });
  var data = app.bikeHistoryExport(s, r.bid);
  check('history export still totals services at $25',
    data.total_spent === 25 && data.services.length === 1);
  check('history export carries 2 expenses, newest first, totaling $117.50',
    data.expenses.length === 2 && data.expenses[0].description === 'Shop labor' &&
    data.expenses_total === 117.50 && data.expense_count === 2);
  check('history export grand total is services + expenses ($142.50)',
    data.grand_total === 142.50);
  var text = app.bikeHistoryText(s, r.bid);
  check('history text lists the expenses section with category and cost',
    text.indexOf('2 expenses — total $117.50') >= 0 &&
    text.indexOf('Parts — Oil + filter — $32.50') >= 0 &&
    text.indexOf('Labor — Shop labor — $85.00') >= 0);
  check('history text shows the grand total',
    text.indexOf('Grand total (services + expenses): $142.50') >= 0);
  var s2 = app.emptyStore();
  var r2 = bikeWithTask(s2, { bike: 'Bike B', odo: 1000, miles: 3000 });
  var data2 = app.bikeHistoryExport(s2, r2.bid);
  check('history export for a bike with no expenses says so, grand total is services only',
    data2.expenses.length === 0 && data2.expenses_total === 0 && data2.grand_total === 0);
  check('history text for a bike with no expenses says so',
    app.bikeHistoryText(s2, r2.bid).indexOf('No expenses logged yet for this bike.') >= 0);
})();
(function () {
  /* Expenses-only export, one bike at a time, same isolation rule. */
  var r = expenseStore();
  app.addExpense(r.s, { bike_id: r.aId, date: '2026-11-01', category: 'parts', description: 'A1', cost: '10' });
  app.addExpense(r.s, { bike_id: r.aId, date: '2026-11-02', category: 'labor', description: 'A2', cost: '20' });
  app.addExpense(r.s, { bike_id: r.bId, date: '2026-11-03', category: 'parts', description: 'B1', cost: '99' });
  var data = app.bikeExpensesExport(r.s, r.aId);
  check('expenses export names the bike, 2 expenses, $30 total',
    data.bike.name === 'Bike A' && data.expense_count === 2 && data.total_spent === 30);
  check('expenses export breaks down by category',
    data.by_category.parts === 10 && data.by_category.labor === 20 && data.by_category.other === 0);
  check('expenses export newest first',
    data.expenses[0].description === 'A2' && data.expenses[1].description === 'A1');
  check('expenses export JSON round-trips',
    JSON.parse(JSON.stringify(data)).expenses.length === 2);
  throws('expenses export for an unknown bike throws', function () {
    app.bikeExpensesExport(r.s, 'b99');
  });
  var text = app.bikeExpensesText(r.s, r.aId);
  check('expenses text names the bike and totals',
    text.indexOf('Expenses — Bike A') === 0 && text.indexOf('2 expenses — total $30.00') >= 0);
  check('expenses text lists the per-category breakdown',
    text.indexOf('Parts: $10.00') >= 0 && text.indexOf('Labor: $20.00') >= 0);
  check('expenses text lists each expense with date, category, cost',
    text.indexOf('Nov 2, 2026 — Labor — A2 — $20.00') >= 0);
  check('expenses text for the other bike never mentions Bike A',
    app.bikeExpensesText(r.s, r.bId).indexOf('Bike A') === -1);
  check('expenses text ends with a newline', text.slice(-1) === '\n');
  var empty = app.bikeExpensesExport(r.s, r.aId);
  void empty;
  var s2 = app.emptyStore();
  var r2 = bikeWithTask(s2, { bike: 'Bike C', odo: 0, miles: 3000 });
  check('expenses text for a bike with no expenses says so',
    app.bikeExpensesText(s2, r2.bid).indexOf('No expenses logged yet for this bike.') >= 0);
})();
check('expenses filename slugs the bike name',
  app.expenseExportFilename('Example 1995 Softail', 'json') === 'bike-log-example-1995-softail-expenses.json');
check('expenses filename handles odd characters',
  app.expenseExportFilename("Josh's Fat Boy!", 'txt') === 'bike-log-josh-s-fat-boy-expenses.txt');
(function () {
  /* Import: expenses ride along, old files without them still load. */
  var r = expenseStore();
  app.addExpense(r.s, { bike_id: r.aId, date: '2026-11-01', category: 'parts', description: 'A1', cost: '10' });
  var round = app.validateImport(JSON.parse(JSON.stringify(r.s)));
  check('import carries expenses through',
    round.expenses.length === 1 && round.expenses[0].description === 'A1');
  var old = JSON.parse(JSON.stringify(r.s));
  delete old.expenses;
  var oldRound = app.validateImport(old);
  check('a logbook from before expenses imports with an empty expenses list',
    Array.isArray(oldRound.expenses) && oldRound.expenses.length === 0);
  throws('expense pointing at a missing bike rejected on import', function () {
    var bad = JSON.parse(JSON.stringify(r.s));
    bad.expenses[0].bike_id = 'b99';
    app.validateImport(bad);
  });
  throws('expense with a negative cost rejected on import', function () {
    var bad = JSON.parse(JSON.stringify(r.s));
    bad.expenses[0].cost = -1;
    app.validateImport(bad);
  });
  throws('expense with an unknown category rejected on import', function () {
    var bad = JSON.parse(JSON.stringify(r.s));
    bad.expenses[0].category = 'bling';
    app.validateImport(bad);
  });
})();
(function () {
  /* mergeSample carries a sample's expenses onto the remapped bike. */
  var s = app.emptyStore();
  var sample = app.sampleStore();
  var sampleBid = Object.keys(sample.bikes)[0];
  sample.expenses = [{
    id: 'x1', bike_id: sampleBid, date: '2026-11-01', category: 'parts',
    description: 'Sample oil', cost: 30, odometer: 42000, notes: ''
  }];
  app.mergeSample(s, sample);
  var exampleBid = Object.keys(s.bikes).filter(function (id) {
    return s.bikes[id].name === 'Example 1995 Softail';
  })[0];
  check('merged sample expense lands on the example bike with a fresh id',
    s.expenses.length === 1 && s.expenses[0].bike_id === exampleBid &&
    s.expenses[0].description === 'Sample oil');
  app.validateImport(JSON.parse(JSON.stringify(s)));
  check('merged logbook with expenses still validates as CLI-shaped', true);
})();

/* --- rides --- */
function rideStore() {
  var s = app.emptyStore();
  var a = app.addBike(s, { name: 'Bike A', odometer: '5000' });
  var aId = Object.keys(s.bikes).filter(function (id) { return s.bikes[id] === a; })[0];
  var b = app.addBike(s, { name: 'Bike B', odometer: '1000' });
  var bId = Object.keys(s.bikes).filter(function (id) { return s.bikes[id] === b; })[0];
  return { s: s, aId: aId, bId: bId };
}
(function () {
  var r = rideStore();
  check('a fresh store has an empty rides list', Array.isArray(r.s.rides) && r.s.rides.length === 0);
  var ride = app.addRide(r.s, { bike_id: r.aId, date: '2026-11-01', route: 'Tortilla Flat loop', miles: '87.5', notes: 'solo' });
  check('ride gets an r id and stores as given',
    ride.id === 'r1' && ride.miles === 87.5 && ride.route === 'Tortilla Flat loop');
  var ride2 = app.addRide(r.s, { bike_id: r.aId, date: '2026-11-02', route: 'Around the block', miles: '12.5' });
  check('second ride gets r2, blank notes stay empty',
    ride2.id === 'r2' && ride2.notes === '');
  var ride3 = app.addRide(r.s, { bike_id: r.aId, date: '2026-11-03', route: 'Quick spin', miles: '0' });
  check('a 0-mile ride is allowed (still worth recording)', ride3.miles === 0);
  var ride4 = app.addRide(r.s, { bike_id: r.aId, date: '2026-11-04', route: 'Long way home', miles: '45.67' });
  check('miles round to one decimal (45.67 -> 45.7)', ride4.miles === 45.7);
  throws('ride on unknown bike rejected', function () {
    app.addRide(r.s, { bike_id: 'b99', date: '2026-11-01', route: 'x', miles: '10' });
  });
  throws('ride with no route rejected', function () {
    app.addRide(r.s, { bike_id: r.aId, date: '2026-11-01', route: '   ', miles: '10' });
  });
  throws('ride with no miles rejected', function () {
    app.addRide(r.s, { bike_id: r.aId, date: '2026-11-01', route: 'x', miles: '' });
  });
  throws('ride with negative miles rejected', function () {
    app.addRide(r.s, { bike_id: r.aId, date: '2026-11-01', route: 'x', miles: '-5' });
  });
  throws('ride with a bad date rejected', function () {
    app.addRide(r.s, { bike_id: r.aId, date: 'Nov 1', route: 'x', miles: '10' });
  });
})();
(function () {
  var r = rideStore();
  app.addRide(r.s, { bike_id: r.aId, date: '2026-11-01', route: 'A1', miles: '10' });
  app.addRide(r.s, { bike_id: r.aId, date: '2026-11-02', route: 'A2', miles: '20.5' });
  app.addRide(r.s, { bike_id: r.bId, date: '2026-11-03', route: 'B1', miles: '99' });
  var all = app.ridesForBike(r.s, null);
  check('rides newest first across bikes',
    all.length === 3 && all[0].route === 'B1' && all[2].route === 'A1');
  var aOnly = app.ridesForBike(r.s, r.aId);
  check('rides filter to one bike',
    aOnly.length === 2 && aOnly.every(function (x) { return x.bike_id === r.aId; }));
  check('per-bike ride totals (count 2, miles 30.5)',
    aOnly.length === 2 && app.rideTotalMiles(aOnly) === 30.5);
  check('ride total keeps one decimal, no float dust (12.5 + 45.6 = 58.1)',
    app.rideTotalMiles([{ miles: 12.5 }, { miles: 45.6 }]) === 58.1);
  app.removeRide(r.s, 'r2');
  check('removing a ride drops it and only it',
    r.s.rides.length === 2 && r.s.rides.every(function (x) { return x.id !== 'r2'; }));
  var again = app.addRide(r.s, { bike_id: r.aId, date: '2026-11-04', route: 'A3', miles: '1' });
  check('ride id is highest suffix in use + 1 (r3 still live, so r4 after deleting r2)', again.id === 'r4');
  throws('removing an unknown ride throws', function () {
    app.removeRide(r.s, 'r99');
  });
})();
(function () {
  var r = rideStore();
  app.addRide(r.s, { bike_id: r.aId, date: '2026-11-01', route: 'A1', miles: '10' });
  app.addRide(r.s, { bike_id: r.bId, date: '2026-11-02', route: 'B1', miles: '99' });
  app.removeBike(r.s, r.bId);
  check('removing a bike drops its rides too',
    r.s.rides.length === 1 && r.s.rides[0].route === 'A1');
})();
(function () {
  /* History export carries the bike's rides alongside its services
   * and expenses — the services and expenses shapes are unchanged. */
  var s = app.emptyStore();
  var r = bikeWithTask(s, { bike: 'Bike A', odo: 5000, miles: 3000 });
  app.logService(s, { bike_id: r.bid, task_id: r.tid, date: '2026-11-01', odometer: '5000', cost: '25', notes: 'A service' });
  app.addExpense(s, { bike_id: r.bid, date: '2026-10-28', category: 'parts', description: 'Oil + filter', cost: '32.50', notes: 'bought ahead' });
  app.addRide(s, { bike_id: r.bid, date: '2026-10-30', route: 'Tortilla Flat loop', miles: '87.5', notes: 'solo' });
  app.addRide(s, { bike_id: r.bid, date: '2026-11-02', route: 'Around the block', miles: '12.5' });
  var data = app.bikeHistoryExport(s, r.bid);
  check('history export still totals services at $25 and expenses at $32.50',
    data.total_spent === 25 && data.expenses_total === 32.50 && data.grand_total === 57.50);
  check('history export carries 2 rides, newest first, totaling 100 miles',
    data.rides.length === 2 && data.rides[0].route === 'Around the block' &&
    data.rides_total_miles === 100 && data.ride_count === 2);
  check('history export grand total miles is the rides total (100)',
    data.grand_total_miles === 100);
  var text = app.bikeHistoryText(s, r.bid);
  check('history text lists the rides section with route and miles',
    text.indexOf('2 rides — total 100 mi') >= 0 &&
    text.indexOf('Oct 30, 2026 — Tortilla Flat loop — 87.5 mi') >= 0 &&
    text.indexOf('Nov 2, 2026 — Around the block — 12.5 mi') >= 0);
  check('history text shows the grand total miles',
    text.indexOf('Grand total miles: 100 mi') >= 0);
  var s2 = app.emptyStore();
  var r2 = bikeWithTask(s2, { bike: 'Bike B', odo: 1000, miles: 3000 });
  var data2 = app.bikeHistoryExport(s2, r2.bid);
  check('history export for a bike with no rides says so, grand total miles is 0',
    data2.rides.length === 0 && data2.rides_total_miles === 0 && data2.grand_total_miles === 0);
  check('history text for a bike with no rides says so',
    app.bikeHistoryText(s2, r2.bid).indexOf('No rides logged yet for this bike.') >= 0);
})();
(function () {
  /* Rides-only export, one bike at a time, same isolation rule. */
  var r = rideStore();
  app.addRide(r.s, { bike_id: r.aId, date: '2026-11-01', route: 'A1', miles: '10' });
  app.addRide(r.s, { bike_id: r.aId, date: '2026-11-02', route: 'A2', miles: '20.5' });
  app.addRide(r.s, { bike_id: r.bId, date: '2026-11-03', route: 'B1', miles: '99' });
  var data = app.bikeRidesExport(r.s, r.aId);
  check('rides export names the bike, 2 rides, 30.5 total miles',
    data.bike.name === 'Bike A' && data.ride_count === 2 && data.total_miles === 30.5);
  check('rides export newest first',
    data.rides[0].route === 'A2' && data.rides[1].route === 'A1');
  check('rides export JSON round-trips',
    JSON.parse(JSON.stringify(data)).rides.length === 2);
  throws('rides export for an unknown bike throws', function () {
    app.bikeRidesExport(r.s, 'b99');
  });
  var text = app.bikeRidesText(r.s, r.aId);
  check('rides text names the bike and totals',
    text.indexOf('Rides — Bike A') === 0 && text.indexOf('2 rides — total 30.5 mi') >= 0);
  check('rides text lists each ride with date, route, miles',
    text.indexOf('Nov 2, 2026 — A2 — 20.5 mi') >= 0);
  check('rides text for the other bike never mentions Bike A',
    app.bikeRidesText(r.s, r.bId).indexOf('Bike A') === -1);
  check('rides text ends with a newline', text.slice(-1) === '\n');
  var s2 = app.emptyStore();
  var r2 = bikeWithTask(s2, { bike: 'Bike C', odo: 0, miles: 3000 });
  check('rides text for a bike with no rides says so',
    app.bikeRidesText(s2, r2.bid).indexOf('No rides logged yet for this bike.') >= 0);
})();
check('rides filename slugs the bike name',
  app.rideExportFilename('Example 1995 Softail', 'json') === 'bike-log-example-1995-softail-rides.json');
check('rides filename handles odd characters',
  app.rideExportFilename("Josh's Fat Boy!", 'txt') === 'bike-log-josh-s-fat-boy-rides.txt');
(function () {
  /* Import: rides ride along, old files without them still load. */
  var r = rideStore();
  app.addRide(r.s, { bike_id: r.aId, date: '2026-11-01', route: 'A1', miles: '10' });
  var round = app.validateImport(JSON.parse(JSON.stringify(r.s)));
  check('import carries rides through',
    round.rides.length === 1 && round.rides[0].route === 'A1');
  var old = JSON.parse(JSON.stringify(r.s));
  delete old.rides;
  var oldRound = app.validateImport(old);
  check('a logbook from before rides imports with an empty rides list',
    Array.isArray(oldRound.rides) && oldRound.rides.length === 0);
  throws('ride pointing at a missing bike rejected on import', function () {
    var bad = JSON.parse(JSON.stringify(r.s));
    bad.rides[0].bike_id = 'b99';
    app.validateImport(bad);
  });
  throws('ride with negative miles rejected on import', function () {
    var bad = JSON.parse(JSON.stringify(r.s));
    bad.rides[0].miles = -1;
    app.validateImport(bad);
  });
})();
(function () {
  /* mergeSample carries a sample's rides onto the remapped bike. */
  var s = app.emptyStore();
  var sample = app.sampleStore();
  var sampleBid = Object.keys(sample.bikes)[0];
  sample.rides = [{
    id: 'r1', bike_id: sampleBid, date: '2026-11-01',
    route: 'Sample loop', miles: 42, notes: ''
  }];
  app.mergeSample(s, sample);
  var exampleBid = Object.keys(s.bikes).filter(function (id) {
    return s.bikes[id].name === 'Example 1995 Softail';
  })[0];
  check('merged sample ride lands on the example bike with a fresh id',
    s.rides.length === 1 && s.rides[0].bike_id === exampleBid &&
    s.rides[0].route === 'Sample loop');
  app.validateImport(JSON.parse(JSON.stringify(s)));
  check('merged logbook with rides still validates as CLI-shaped', true);
})();

/* --- service-worker update button wiring (sw-update.js) --- */
var fs = require('fs');
var path = require('path');
var _sw = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
var _html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
var _appjs = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
check('sw.js caches v18', _sw.indexOf('bike-maintenance-log-v18') >= 0);
check('sw.js precaches sw-update.js', _sw.indexOf('sw-update.js') >= 0);
check('sw.js has the SKIP_WAITING message handler',
  _sw.indexOf("addEventListener('message'") >= 0 && _sw.indexOf('SKIP_WAITING') >= 0);
check('sw.js does not call skipWaiting on install',
  (_sw.split('self.skipWaiting()').length - 1) === 1);
check('index.html has the wear-clocks container', _html.indexOf('id="wear-clocks"') >= 0);
check('index.html has the expense photo input', _html.indexOf('id="expense-photo-input"') >= 0);
check('index.html has the rides view', _html.indexOf('id="view-rides"') >= 0);
check('index.html has the ride form', _html.indexOf('id="ride-form"') >= 0);
check('index.html has the rides nav button', _html.indexOf('data-view="rides"') >= 0);
check('index.html has the tire-age reference card',
  _html.indexOf('Tire age — the 5/10 rule') >= 0 &&
  _html.indexOf('Michelin/Dunlop motorcycle rule') >= 0);
check('index.html references the Sportster schedule', _html.indexOf('#99484-98') >= 0);
check('index.html flags the Sportster disagreements', _html.indexOf('disagrees with the Softail book') >= 0);
check('index.html loads sw-update.js before app.js',
  _html.indexOf('src="sw-update.js"') >= 0 &&
  _html.indexOf('src="sw-update.js"') < _html.indexOf('src="app.js"'));
check('app.js calls PG_SWUpdate.init', _appjs.indexOf('PG_SWUpdate.init') >= 0);
check('sw-update.js vendored byte-identical to canonical',
  fs.readFileSync(path.join(__dirname, 'sw-update.js'), 'utf8') ===
  fs.readFileSync(path.join(__dirname, '..', '..', 'sw-update.js'), 'utf8'));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
