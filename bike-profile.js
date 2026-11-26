/* Pocket Garage — Shared Bike Profile (Phase 1).
   Pure module: one canonical bike roster shared by every Pocket Garage app.
   No dependencies, no DOM access. The caller passes a storage adapter
   (an object with getItem/setItem, e.g. localStorage, or null) so the same
   code runs in the browser and in Node tests.

   Rules, all deliberate:
   - Shared key is "pocket-garage-bikes". Seed on first run ONLY when that
     key is empty/missing. Stored data is authoritative after that: it is
     never overwritten and seed bikes are never merged back in.
   - NEVER guess a bike: no silent defaults, no invented bikes, no merging.
   - Keys are stable and never reused: new bikes get the next free key in
     sequence (b4, b5, ...). A deleted key stays spent, so old handoffs and
     records keep resolving. The high-water mark lives under
     "pocket-garage-bikes-next" (a second key; the bikes array itself is
     always just the array of bike records).
   - Lookup is exact: an unknown key returns null, never a wrong bike and
     never the first bike as a fallback.
   - Storage unavailable (no adapter, or the adapter throws): fall back to
     the embedded roster held in memory; reads work, writes are kept in
     memory for the session and never throw.
   - Corrupt stored JSON, or stored JSON that is not an array: fall back to
     the embedded roster in memory and do NOT overwrite the stored value —
     leave it alone for a human to fix.

   Seed facts (copied exactly from evo-diagnostic/data.js roster + the carb
   seed; nothing invented): b1 1995 Fat Boy / S&S Super E, main 0.072,
   intermediate 0.0295, mixture 1-1/4 turns out. b2 1990 Softail / Keihin
   CV40, main 185, pilot 45, float 0.413-0.453 in. b3 1947 Knucklehead /
   Linkert M74B — jetting NOT published, so carbFacts is empty, never guessed.
*/
(function (root) {
  "use strict";

  var STORAGE_KEY = "pocket-garage-bikes";
  var COUNTER_KEY = "pocket-garage-bikes-next";

  var SEED = [
    { key: "b1", name: "1995 Fat Boy", year: 1995, model: "Fat Boy", carb: "S&S Super E",
      carbFacts: { mainJet: "0.072", intermediateJet: "0.0295", mixtureScrew: "1-1/4 turns out" }, notes: "" },
    { key: "b2", name: "1990 Softail", year: 1990, model: "Softail", carb: "Keihin CV40",
      carbFacts: { mainJet: "185", pilotJet: "45", floatHeight: "0.413-0.453 in" }, notes: "" },
    { key: "b3", name: "1947 Knucklehead", year: 1947, model: "Knucklehead", carb: "Linkert M74B",
      carbFacts: {}, notes: "" }
  ];

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function maxKeyNum(bikes) {
    var max = 0;
    (bikes || []).forEach(function (b) {
      if (b && typeof b.key === "string") {
        var m = /^b(\d+)$/.exec(b.key);
        if (m && +m[1] > max) max = +m[1];
      }
    });
    return max;
  }

  function createProfile(adapter) {
    var store = adapter || null;
    var bikes = null;   // in-memory working copy (array of bike records)
    var nextNum = 4;    // next key number to assign
    var loaded = false;

    function readRaw(key) {
      if (!store) return { ok: false, value: null };
      try { return { ok: true, value: store.getItem(key) }; }
      catch (e) { return { ok: false, value: null }; }
    }
    function writeRaw(key, value) {
      if (!store) return false;
      try { store.setItem(key, value); return true; }
      catch (e) { return false; }
    }
    function persist() {
      // Best effort only: a failed write keeps the in-memory copy and
      // never throws. Bikes and counter are written together.
      if (!store) return false;
      var bikesOk = writeRaw(STORAGE_KEY, JSON.stringify(bikes));
      var counterOk = writeRaw(COUNTER_KEY, String(nextNum));
      return bikesOk && counterOk;
    }

    function load() {
      var raw = readRaw(STORAGE_KEY);
      if (!raw.ok) {
        // No adapter, or the adapter throws on read: memory mode.
        bikes = clone(SEED);
        nextNum = maxKeyNum(bikes) + 1;
        loaded = true;
        return clone(bikes);
      }
      if (raw.value === null || raw.value === undefined || raw.value === "") {
        // First run: seed, and only now.
        bikes = clone(SEED);
        nextNum = maxKeyNum(bikes) + 1;
        loaded = true;
        persist();
        return clone(bikes);
      }
      var parsed = null, parsedOk = false;
      try { parsed = JSON.parse(raw.value); parsedOk = true; } catch (e) { parsedOk = false; }
      if (!parsedOk || !Array.isArray(parsed)) {
        // Corrupt or not an array: fall back to the embedded roster in
        // memory and leave the stored value alone for a human to fix.
        bikes = clone(SEED);
        nextNum = maxKeyNum(bikes) + 1;
        loaded = true;
        return clone(bikes);
      }
      // Valid array: authoritative, used as-is. No seed merge, no rewrite.
      bikes = clone(parsed);
      var counter = readRaw(COUNTER_KEY);
      var storedNext = null;
      if (counter.ok && counter.value !== null && counter.value !== "" && /^\d+$/.test(String(counter.value))) {
        storedNext = +counter.value;
      }
      var derived = maxKeyNum(bikes) + 1;
      if (bikes.length === 0) derived = Math.max(derived, 4); // seed keys b1-b3 are spent even if all were deleted
      nextNum = storedNext !== null ? Math.max(storedNext, derived) : derived;
      if (storedNext === null) writeRaw(COUNTER_KEY, String(nextNum));
      loaded = true;
      return clone(bikes);
    }

    function ensureLoaded() { if (!loaded) load(); }

    function save() {
      ensureLoaded();
      return persist();
    }

    function getBike(key) {
      ensureLoaded();
      if (typeof key !== "string") return null;
      for (var i = 0; i < bikes.length; i++) {
        if (bikes[i] && bikes[i].key === key) return clone(bikes[i]);
      }
      return null;
    }

    function listBikes() {
      ensureLoaded();
      return clone(bikes);
    }

    function normalize(fields, key) {
      fields = fields || {};
      return {
        key: key,
        name: typeof fields.name === "string" ? fields.name : "",
        year: fields.year === undefined ? null : fields.year,
        model: typeof fields.model === "string" ? fields.model : "",
        carb: typeof fields.carb === "string" ? fields.carb : "",
        carbFacts: (fields.carbFacts && typeof fields.carbFacts === "object") ? clone(fields.carbFacts) : {},
        notes: typeof fields.notes === "string" ? fields.notes : ""
      };
    }

    function addBike(fields) {
      ensureLoaded();
      var key = "b" + nextNum;
      nextNum++;
      bikes.push(normalize(fields, key));
      persist();
      return key;
    }

    function updateBike(key, fields) {
      ensureLoaded();
      if (typeof key !== "string") return false;
      fields = fields || {};
      for (var i = 0; i < bikes.length; i++) {
        if (bikes[i] && bikes[i].key === key) {
          // Only the named fields change; the key itself never does.
          if (fields.name !== undefined) bikes[i].name = fields.name;
          if (fields.year !== undefined) bikes[i].year = fields.year;
          if (fields.model !== undefined) bikes[i].model = fields.model;
          if (fields.carb !== undefined) bikes[i].carb = fields.carb;
          if (fields.carbFacts !== undefined) bikes[i].carbFacts = clone(fields.carbFacts);
          if (fields.notes !== undefined) bikes[i].notes = fields.notes;
          persist();
          return true;
        }
      }
      return false;
    }

    function removeBike(key) {
      ensureLoaded();
      if (typeof key !== "string") return false;
      for (var i = 0; i < bikes.length; i++) {
        if (bikes[i] && bikes[i].key === key) {
          bikes.splice(i, 1);
          persist();
          return true;
        }
      }
      return false;
    }

    return {
      load: load, save: save, getBike: getBike, listBikes: listBikes,
      addBike: addBike, updateBike: updateBike, removeBike: removeBike,
      STORAGE_KEY: STORAGE_KEY, SEED: clone(SEED)
    };
  }

  var api = {
    create: createProfile, createProfile: createProfile,
    STORAGE_KEY: STORAGE_KEY, SEED: clone(SEED)
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PG_BikeProfile = api;
})(typeof window !== "undefined" ? window : globalThis);
