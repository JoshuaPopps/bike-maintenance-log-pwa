# Test notes — bike-maintenance-log-pwa v1.0.0

Tested 2026-11-04. No build step, no dependencies in the app itself.
Test data was throwaway example data — nothing here is anyone's real
bike or real mileage.

## Core-logic tests — `node test.js` (46 passed, 0 failed)

Run from the app directory against Node 24:

- **Date math**: month addition clamps month-end (Jan 31 + 1 mo →
  Feb 28; Feb 29 + 12 mo → Feb 28), crosses year boundaries both
  directions (Nov 2026 − 14 mo → Sep 2025), days-between counts
  forward and negative.
- **Validation** (all rejected with clean errors): duplicate bike
  name (case-insensitive), empty bike name, negative odometer, task
  with neither interval, zero miles interval, task on an unknown
  bike, duplicate task name on the same bike, negative service cost.
- **Due math** (mirrors the CLI exactly): mileage ok / due-soon
  inside 500 mi / overdue at or past the due mileage; time ok
  outside 30 days / due-soon inside / overdue past the due date;
  worst leg wins when miles and months disagree; last service
  resets the clock; an unlogged task counts from task creation and
  says so.
- **Odometer rules**: a higher service reading advances the bike;
  a lower one warns and never rewinds; same for the odometer form.
- **Entry ids**: follow the CLI rule (highest suffix in use + 1), so
  the two stay in lockstep.
- **Due ordering**: overdue first, then due-soon, then ok.
- **History**: newest first, costs rounded to cents, totals summed.
- **Import validation**: CLI-shaped export validates; garbage,
  entries pointing at missing tasks, and tasks pointing at missing
  bikes are all rejected.
- **Cascades**: removing a task drops its history; removing a bike
  drops its tasks and history.
- **Sample logbook**: shows overdue, due-soon, and ok tasks at once
  (dates are relative to load day, so the spread never drifts);
  headline odometer stays 42,300.
- **Sample merge**: merging the example into a logbook that already
  has a bike keeps both bikes, gives the example fresh ids, points
  its entries at the example bike only, and leaves the real bike's
  history untouched. The merged logbook still validates as
  CLI-shaped.

Two real catches during testing, both fixed before staging:

1. `addMonths` broke on negative offsets — JavaScript's `%` keeps
   the sign, so Nov 2026 − 14 months produced month −3 and an
   invalid date that crashed the sample loader. Fixed with a
   sign-safe modulo; regression tests added for backward month math.
2. The first sample loader skipped the example bike when the user
   already had a bike with the same id (`b1`) — but pushed its
   entries anyway, attaching example history to the user's bike.
   Replaced with `mergeSample`, which remaps every id before
   merging; the smoke test below caught it, the core test pins it.

## DOM smoke test — real UI in jsdom (15 passed, 0 failed)

A throwaway harness in /tmp (not shipped) loaded the actual
`index.html` + `app.js`, then drove the UI:

1. Empty state prompts to add a bike.
2. Adding a bike through the form renders it in the list and fills
   the task form's bike select.
3. A quick-name button fills the task name; adding the task renders
   it.
4. Pushing the odometer past the interval flips the Due tab to
   OVERDUE; logging the service through the Due form flips it back
   to ok.
5. History tab activates, shows the logged service and its $48.50
   total.
6. Loading the example on top shows the example bike plus OVERDUE
   and DUE SOON badges (this is the step that caught catch #2
   above — it failed until the merge fix landed, then passed).
7. localStorage holds a CLI-shaped logbook: `bikes` / `tasks` /
   `entries` keys, tasks carrying `every_miles` and `baseline_odo`.

## CLI interop check — the app's export runs under the real CLI

The sample logbook exported from `app.js` was written as a CLI
`data.json` and run through the published `bike_log.py` (with
`BIKE_LOG_HOME` pointed at it). The CLI printed the same statuses
the app shows — Brake fluid OVERDUE (61 days), Engine oil DUE SOON
(200 mi / 30 days), Primary fluid and Tires ok — and the same
summary (4 tasks, 3 services, $78.50 spent, 2 due). Both directions
of the trade use the identical file shape; no conversion step.

## Static-server check (all 200)

`python3 -m http.server` from the app directory; every referenced
asset returned 200: `index.html`, `styles.css`, `app.js`, `test.js`,
`sw.js`, `manifest.webmanifest`, `icons/icon-192.png`,
`icons/icon-512.png`, `icons/icon.svg`. The 512-px icon was also
rendered back and eyeballed: dark gauge dial, amber needle zone,
"DUE?" — clean at phone-icon size.

## OPSEC scrub

Before staging, the whole directory was grepped for IPs, hostnames,
usernames, real file paths, credentials/tokens, network names, and
personal details. Clean: all bikes, names, and numbers are labeled
examples; the only external reference is the published CLI repo
link. No personal or system information ships in the app.

## Known limits (also in README)

- Data lives in one browser's local storage; Export/Import is the
  sync story for now.
- jsdom is not a real phone browser: installability (Add to Home
  Screen) and the service worker's offline cache were verified by
  code inspection (manifest + sw.js asset list matches the shipped
  files) and the static-server check, not by an on-device install
  test — that step is for the owner on their own phone after approval.
- Tested on Node 24 (tests) and Python 3.12 (server); the app itself
  is plain ES5-era JavaScript and CSS with no build step, written to
  run in any modern mobile browser.

## v1.1.0 — common-bikes picker (2026-11-11)

Adding a bike used to mean typing make and model freehand every time.
Now the Add-a-bike form opens with a brand picker (Harley-Davidson,
Triumph, Honda, Suzuki, Kawasaki, Yamaha) and a model picker grouped
by family (optgroups — e.g. Harley → Softail → Fat Boy, Street Bob,
Heritage Classic). Picking a model fills Make, Model, and Name (only
if Name is empty — it never overwrites what you typed). "Other / not
listed" on either picker leaves the text fields alone for a plain
typed entry, so nothing is gated behind the catalog.

- Catalog: 106 models, model names only — no years, no trims, no specs
  attached, nothing invented. Street Bob and Fat Bob appear under both
  Softail and Dyna on purpose (both eras are real); the year you type
  tells them apart.
- Node tests grew from 46 to 56: brand order, every family non-empty,
  no empty or duplicate model names inside a family, 100+ models
  total, unknown brand returns empty, and a spot check per brand
  (Fat Boy, T120, Gold Wing, SV650, Z900, MT-07).
- Real-browser check (Playwright): pick Harley-Davidson → model
  select shows the Softail group with Fat Boy → picking it fills
  Make/Model/Name → submitting adds the bike → it shows in the list.
  Picking "Other" leaves manual entry working.
- Service-worker cache bumped v1 → v2 so installed copies pick the
  picker up instead of serving the old cached shell.
