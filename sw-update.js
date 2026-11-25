/* Pocket Garage service-worker update button — sw-update.js (v1).
   Shared module for all eight Pocket Garage PWAs + the landing page.
   Vendor verbatim into each app; do not fork per app.
   The phone can keep serving the old version for an hour+ after a push
   because the service worker serves old files cache-first. This module
   owns one small update button: hidden until a new worker is waiting,
   tap it and the new worker takes over and the page reloads exactly
   once. The app keeps working offline exactly as before — every SW
   call is wrapped, failures are silent, and the check never blocks use.
   No account, offline-first, on-device only.
   ------------------------------------------------------------------
   STATES (state machine — see deriveState / buttonView, both pure):
     unsupported — no service-worker support; no button, never throws.
     current     — no waiting worker; button HIDDEN.
     waiting     — a worker is waiting; button SHOWN ("Update available").
     checking    — manual check in flight; button shown, disabled.
     offline     — check failed / no connection; button shows the
                   "No connection — try again" retry state, app unaffected.
     reloading   — update accepted, reload once.
   ------------------------------------------------------------------
   SW SNIPPET — each app's sw.js needs these lines (copy verbatim).
   Without them the waiting worker never hears the tap:
     self.addEventListener("message", (e) => {
       if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
     });
   NOTE: if an app's sw.js already calls self.skipWaiting() on install,
   remove that call — the button gates activation, so a worker that
   skips waiting on install never reaches the waiting state and the
   button would never show. Keep the activate handler (cache cleanup +
   clients.claim()) as-is.
   ------------------------------------------------------------------
   WIRING — copy verbatim into each app:
     1. Add "sw-update.js" to the sw.js precache list (ASSETS), so the
        button code itself updates with the app.
     2. In index.html, at the end of <body>, BEFORE app.js:
          <script src="sw-update.js"></script>
     3. In app.js, once at startup (after the DOM exists):
          var swUpdate = PG_SWUpdate.init({ container: document.body });
        Pass a header element instead of document.body to place the
        button there. init() returns the controller; a settings menu can
        offer a manual check with swUpdate.checkForUpdates().
   ------------------------------------------------------------------
   BUTTON STYLING — classes only, no colors in this module. Style in
   the app's own stylesheet, 1990 Treatment (palette lives there):
     .pg-sw-update            base (shown only when an update is pending)
     .pg-sw-update.pg-sw-checking
     .pg-sw-update.pg-sw-offline
     .pg-sw-update.pg-sw-reloading
   The button is created once, appended to the container passed to
   init(), and hidden with display:none when there is nothing to
   update — never greyed-out clutter.
   ------------------------------------------------------------------
   RELOAD GUARD — the page reloads only on the controllerchange that
   follows OUR skip-waiting request: a skipRequested flag set at tap
   time and cleared by the handler, a one-shot listener, and a
   sessionStorage flag ("pg-sw-update-reloaded") set just before the
   reload and consumed at init, so a second controllerchange — or a
   second update cycle in the same session — can never loop. */
(function (root) {
  "use strict";

  var SKIP_WAITING = "SKIP_WAITING";
  var RELOAD_FLAG = "pg-sw-update-reloaded";
  var RELOAD_TIMEOUT_MS = 10000; // worker never took control: let the user tap again

  var STATES = ["unsupported", "current", "waiting", "checking", "offline", "reloading"];

  /* Pure: given SW support + whether a worker is waiting, the base state.
     Transient states (checking / offline / reloading) are set by the
     controller around async work; they are never derived here. */
  function deriveState(input) {
    if (!input || !input.supported) return "unsupported";
    if (input.waiting) return "waiting";
    return "current";
  }

  /* Pure: what the button looks like for a state. Hidden unless there is
     something to update, a check in flight, or a failed check to retry. */
  function buttonView(state) {
    switch (state) {
      case "waiting":
        return { visible: true, label: "Update available", disabled: false, cls: "pg-sw-update" };
      case "checking":
        return { visible: true, label: "Checking for updates…", disabled: true, cls: "pg-sw-update pg-sw-checking" };
      case "offline":
        return { visible: true, label: "No connection — try again", disabled: false, cls: "pg-sw-update pg-sw-offline" };
      case "reloading":
        return { visible: true, label: "Updating…", disabled: true, cls: "pg-sw-update pg-sw-reloading" };
      default: /* "current" and "unsupported": no button at all. */
        return { visible: false, label: "", disabled: true, cls: "pg-sw-update" };
    }
  }

  function hasWaiting(reg) { return !!(reg && reg.waiting); }

  function safe(fn) { try { return fn(); } catch (e) { return undefined; } }

  function on(target, event, fn) {
    if (!target || typeof fn !== "function") return false;
    if (typeof target.addEventListener === "function") {
      safe(function () { target.addEventListener(event, fn); });
      return true;
    }
    try { target["on" + event] = fn; return true; } catch (e) { return false; }
  }

  function off(target, event, fn) {
    if (!target || typeof fn !== "function") return;
    if (typeof target.removeEventListener === "function") {
      safe(function () { target.removeEventListener(event, fn); });
    }
  }

  function createController(opts) {
    opts = opts || {};
    var nav = opts.navigator || (typeof navigator !== "undefined" ? navigator : undefined);
    var win = opts.window || (typeof window !== "undefined" ? window : undefined);
    var doc = opts.document || (typeof document !== "undefined" ? document : undefined);
    var storage = opts.storage || (win && win.sessionStorage) || null;
    var reloadFn = opts.reload || null;
    if (!reloadFn && win && win.location && typeof win.location.reload === "function") {
      reloadFn = function () { win.location.reload(); };
    }
    var onStateChange = typeof opts.onStateChange === "function" ? opts.onStateChange : null;
    var container = opts.container || (doc && doc.body) || null;
    var registration = opts.registration || null;
    var reloadTimeoutMs = typeof opts.reloadTimeoutMs === "number" ? opts.reloadTimeoutMs : RELOAD_TIMEOUT_MS;

    var state = "current";
    var skipRequested = false;
    var ccAttached = false;
    var reloadTimer = null;
    var button = null;
    var waitingWorker = null;
    var destroyed = false;

    function supported() { return !!(nav && "serviceWorker" in nav); }

    function setState(next) {
      if (state === next || destroyed) return;
      state = next;
      render();
      if (onStateChange) safe(function () { onStateChange(state); });
    }

    function render() {
      if (!doc || !container || state === "unsupported") return;
      var view = buttonView(state);
      if (!button) {
        button = doc.createElement("button");
        button.type = "button";
        button.className = "pg-sw-update";
        on(button, "click", onTap);
        safe(function () { container.appendChild(button); });
      }
      button.className = view.cls;
      button.textContent = view.label;
      button.disabled = view.disabled;
      button.style.display = view.visible ? "" : "none";
      safe(function () { button.setAttribute("aria-hidden", view.visible ? "false" : "true"); });
    }

    function onTap() {
      if (destroyed) return;
      if (state === "waiting") applyUpdate();
      else if (state === "offline") checkForUpdates();
      /* checking / reloading are disabled; current / unsupported have no button. */
    }

    /* Only the controllerchange that follows OUR skip-waiting request may
       reload — and only once. A stray controllerchange (skipRequested
       false) or a repeat (flag already set) is ignored. */
    function handleControllerChange() {
      if (!skipRequested || destroyed) return;
      skipRequested = false;
      disarmReloadTimer();
      var already = safe(function () { return storage && storage.getItem(RELOAD_FLAG); });
      if (already) return;
      safe(function () { if (storage) storage.setItem(RELOAD_FLAG, "1"); });
      setState("reloading");
      safe(function () { if (reloadFn) reloadFn(); });
    }

    function armReloadTimer() {
      disarmReloadTimer();
      reloadTimer = setTimeout(function () {
        reloadTimer = null;
        if (skipRequested) { skipRequested = false; setState("waiting"); }
      }, reloadTimeoutMs);
      if (reloadTimer && typeof reloadTimer.unref === "function") safe(function () { reloadTimer.unref(); });
    }

    function disarmReloadTimer() {
      if (reloadTimer) { clearTimeout(reloadTimer); reloadTimer = null; }
    }

    function watchRegistration(reg) {
      if (!reg) return;
      registration = reg;
      waitingWorker = reg.waiting || null;
      if (hasWaiting(reg)) { setState("waiting"); return; }
      on(reg, "updatefound", function () {
        var nw = reg.installing;
        if (!nw) return;
        on(nw, "statechange", function () {
          if (nw.state === "installed" && nav && nav.serviceWorker && nav.serviceWorker.controller) {
            waitingWorker = nw;
            setState("waiting");
          }
        });
      });
    }

    /* Manual "Check for updates": calls registration.update() on demand.
       Resolves to the resulting state ("waiting" / "current" / "offline").
       Never throws; a failed check leaves the app working as before. */
    function checkForUpdates() {
      if (!supported() || !registration) return Promise.resolve(state);
      if (state === "checking" || state === "reloading") return Promise.resolve(state);
      if (nav && nav.onLine === false) { setState("offline"); return Promise.resolve("offline"); }
      if (typeof registration.update !== "function") return Promise.resolve(state);
      setState("checking");
      var result;
      try { result = registration.update(); } catch (e) { setState("offline"); return Promise.resolve("offline"); }
      return Promise.resolve(result).then(function () {
        setState(hasWaiting(registration) ? "waiting" : "current");
        return state;
      }, function () {
        setState("offline");
        return state;
      });
    }

    /* Tap path: tell the waiting worker to take over, then reload once
       when it does. Returns false when there is no waiting worker or the
       post fails — the button stays on "waiting" and the user can retry. */
    function applyUpdate() {
      if (!supported() || destroyed) return false;
      var worker = (registration && registration.waiting) || waitingWorker;
      if (!worker || typeof worker.postMessage !== "function") return false;
      skipRequested = true;
      setState("reloading");
      var sw = nav && nav.serviceWorker;
      if (sw && !ccAttached) ccAttached = on(sw, "controllerchange", handleControllerChange);
      var posted = safe(function () { worker.postMessage({ type: SKIP_WAITING }); return true; });
      if (!posted) { skipRequested = false; setState("waiting"); return false; }
      armReloadTimer();
      return true;
    }

    function destroy() {
      destroyed = true;
      disarmReloadTimer();
      skipRequested = false;
      var sw = nav && nav.serviceWorker;
      if (sw && ccAttached) off(sw, "controllerchange", handleControllerChange);
      if (button && button.parentNode && typeof button.parentNode.removeChild === "function") {
        safe(function () { button.parentNode.removeChild(button); });
      }
      button = null;
    }

    function init() {
      /* Consume the flag left by the reload this module triggered: the
         fresh page is the new version, so a later update in this session
         may reload again. */
      safe(function () { if (storage) storage.removeItem(RELOAD_FLAG); });
      if (!supported()) { state = "unsupported"; render(); return api; }
      state = "current";
      render();
      if (registration) watchRegistration(registration);
      else if (nav && nav.serviceWorker && nav.serviceWorker.ready) {
        safe(function () {
          Promise.resolve(nav.serviceWorker.ready).then(function (reg) {
            if (!destroyed) watchRegistration(reg);
          }, function () { /* no registration: stay current, app works offline as before */ });
        });
      }
      return api;
    }

    var api = {
      getState: function () { return state; },
      checkForUpdates: checkForUpdates,
      applyUpdate: applyUpdate,
      destroy: destroy,
      init: init,
      _handleControllerChange: handleControllerChange /* tests / debugging only */
    };
    return api;
  }

  function init(opts) {
    var c = createController(opts || {});
    c.init();
    return c;
  }

  var api = {
    version: 1,
    STATES: STATES,
    SKIP_WAITING: SKIP_WAITING,
    RELOAD_FLAG: RELOAD_FLAG,
    deriveState: deriveState,
    buttonView: buttonView,
    hasWaiting: hasWaiting,
    createController: createController,
    init: init
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PG_SWUpdate = api;
})(typeof window !== "undefined" ? window : globalThis);
