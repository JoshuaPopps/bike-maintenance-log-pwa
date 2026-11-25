# Test notes — bike-maintenance-log-pwa v1.2.0

Tested 2026-11-04; v1.2.0 factory auto-fill tested 2026-11-20. No build step, no dependencies in the app itself.
Test data was throwaway example data — nothing here is anyone's real
bike or real mileage.

## Core-logic tests — `node test.js` (186 passed, 0 failed)

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

## v1.1.1 — picker brand-switch fix (2026-11-11)

The v1.1.0 live check caught one real quirk: switching the brand
picker after picking a model left the auto-filled Make / Model / Name
in place (e.g. Fat Boy / Harley-Davidson still showing after switching
to Triumph) until a new model was picked. The picker now remembers its
last pick and clears only those auto-filled values on a brand switch;
anything the user typed stays put. Verified in a real browser: picked
values clear, typed values survive, picking a new model after the
switch fills correctly. Node suite unchanged at 56/56.

Note: the same live check also flagged a supposed missing-space typo
("fromyourmanual") and extra model names (Iron 1200, Deluxe, Tri
Glide). Both were checked against the served files and the rendered
page — the paragraph renders correctly ("Intervals come from your
manual") and the live app.js byte-matches the pushed commit, so those
two were reporting artifacts, not app bugs. No change made for them.
- Service-worker cache bumped v2 → v3.

## v1.2.0 — factory-schedule auto-fill (2026-11-20)

Picking a bike from the common-bikes catalog now fills its task list
from the factory schedule — where one is sourced. The schedule on
file is the 1984–1999 Evo Softail platform from FSM #99482-98
(1997–98), Service Intervals §1: first service at 500 mi, then
every 5,000 mi (engine oil + filter, primary chaincase lubricant,
transmission lubricant, clutch adjustment, drive belt, brake fluid
level/condition, tires, air cleaner, battery, primary chain);
10,000 mi (fork oil, wheel bearings, fuel tank filter, throttle
cables); 20,000 mi (spark plugs, steering head bearings). Covered
models: Fat Boy (FLSTF) and Heritage Classic (FLSTC), named in
#99482-98 itself, plus Standard (FXST), the base model of the same
platform, covered by the 1984–99 Softail Repair Manual's maintenance
schedule — same 5,000 / 10,000 / 20,000 mi pattern, corroborated in
the repair manual text (wheel bearings and spark plugs at 10,000 mi)
and in the FSM text (oil and primary at 500 mi and every 5,000 mi).
Every filled-in task carries its source in its notes
("Factory schedule — FSM #99482-98: …"), visible in the task rows.
These are the same FSM §1 numbers the Reference tab already shows;
auto-fill turns that reference into tasks.

Rules the implementation holds to:

- Year-gated: the schedule applies only when the bike's year is
  1984–1999. A 2020 Fat Boy gets nothing — same name, different
  bike, no sourced schedule. No year, no fill.
- Never overwrites: auto-fill adds only tasks the bike does not
  already have (name match, case-insensitive). A task the user set
  keeps its own interval and notes; re-running adds nothing.
- Nothing invented: models with no entry in FACTORY_SCHEDULES get
  no auto-fill. Springer-only items (rocker bearings, steering-head
  grease at every interval) and dealer-inspection-only lines (engine
  mounts, fasteners, road test) are deliberately left out — the
  filled list is the owner-serviceable jobs.
- Data model untouched: auto-filled tasks are plain tasks with a
  source note, so the JSON still trades with the CLI both ways
  (validated in the node suite).

- Node tests grew from 61 to 80: schedule lookup (Fat Boy /
  Heritage Classic / Standard in range; 2020, missing year, and
  Triumph out), year bounds (1984 and 1999 in, 1983 and 2000 out),
  full 16-task fill with source notes and bike-odometer baselines,
  re-apply adds nothing, user-set task survives untouched,
  out-of-range year fills nothing, sample logbook still exactly 4
  tasks, and the auto-filled logbook still validates as CLI-shaped.
- Real-browser check (Playwright): pick Harley-Davidson → Fat Boy →
  the hint reads "Factory schedule on file: Evo Softail (1984–1999)"
  → enter year 1995, save → 16 tasks appear, each showing its
  "Factory schedule — FSM #99482-98" note. Picking a Triumph shows
  "No factory schedule on file for this model".
- Service-worker cache bumped v7 → v8.
- Note: local staging was behind live when this landed (live had
  since shipped the 1990 Treatment restyle, the Reference tab, and
  the FSM-based sample logbook). The live files were pulled down
  first and this feature was re-applied on top of them, so nothing
  live was overwritten; the sync record's newest entry before this
  push was 126242b, live head 5be1f15.

## v1.3.0 — due reminders + per-bike service history export (2026-11-24)

- **Due reminders:** a Reminders card now sits at the top of the Due
  tab on open, showing only overdue and due-soon tasks, worst first,
  with the counts up front ("1 overdue, 1 due soon") — or "all caught
  up" when nothing needs attention. It follows the Due tab's bike
  filter. Each reminder row has the same Log button as the full list
  (shared `wireLogButtons` helper). Reminders are read-only
  (`dueReminders` in app.js): they never add, change, or overwrite
  any task — factory-filled or user-set — and the full list including
  ok tasks is still below the card.
- **Per-bike history export:** the History tab gains an export card.
  Pick one bike in the History filter and download its completed
  service records as JSON (`bike-log-<bike>-history.json`: bike,
  tasks with intervals, services newest first, service count, total
  spent) or as readable plain text (`bike-log-<bike>-history.txt`:
  header with bike spec and odometer, task list, one line per service
  with date / task / mileage / cost / notes, total). A Copy text
  button mirrors the Data tab's clipboard pattern. Export is one bike
  at a time — "All bikes" gets a polite "Pick a bike first" toast and
  downloads nothing. A bike with no services exports an empty
  history, not an error.
- Node tests grew from 80 to 111 (+31): reminders from the sample
  (1 overdue / 1 due soon / ok excluded / overdue first / per-bike
  scoping / unknown bike empty / all-ok logbook empty / read-only),
  history export (shape, newest first, $78.50 total, task list,
  JSON round-trip, unknown bike throws, Bike A vs Bike B isolation
  in both JSON and text, empty-history bike), text export content
  (header, service line, total, task intervals, notes, trailing
  newline), and filename slugging (spaces, apostrophes, empty name).
- Real-browser check (Playwright, 22 checks, 0 console errors, local
  temp copy with locally downloaded fonts): reminders card on the
  example logbook, Log pre-fill from a reminder row, JSON + text
  downloads with per-bike filenames and verified contents, All-bikes
  refusal, picker + factory auto-fill still working (16 tasks land in
  the full Due list), all-caught-up state on a fresh bike, and a
  follow-up pass confirming the per-bike filter (Fat Boy filtered →
  all caught up; back to All bikes → the example's 2 reminders).
- Service-worker cache bumped v9 → v10.
- Live dyno styles.css fetched and compared before this landed: the
  1990 Treatment variables match the app's own styles.css, so no
  restyle was needed — the new Reminders card reuses the existing
  card/badge/palette classes plus a 3px accent edge (signal red while
  anything is overdue).

## v1.4.0 — Expenses tab (2026-11-25)

- **Expenses tab:** money out, per bike, in four buckets — Parts,
  Labor, Service, Other. Every number is user-entered; the app never
  suggests a price, never invents a part price or labor rate, and
  never displays a "typical shop cost". A logged service keeps its
  own cost field — this tab is for the money around it (parts bought
  ahead of a job, a shop bill, anything that is not a service entry).
  Filter by bike and category, see the total plus the per-category
  breakdown, delete an entry (with confirm). No reference content was
  added — there is no sourced price or labor data in the library to
  cite, and inventing any would break the library-first rule.
- **Data model:** one new top-level key, `expenses` (records `x1`,
  `x2`, … — same highest-suffix-plus-one id rule as service entries).
  The CLI's `data.json` shape is untouched: `bikes` / `tasks` /
  `entries` are exactly as before, and the CLI ignores the extra key,
  so the file still trades both ways. Importing a CLI export (no
  `expenses` key) loads with an empty expenses list; old logbooks in
  localStorage get the same default on load. Removing a bike drops
  its expenses; `mergeSample` carries a sample's expenses onto the
  remapped bike. `validateImport` rejects expenses pointing at a
  missing bike, with a bad cost, or with an unknown category.
- **History export carries expenses:** the per-bike history export
  (JSON + text) now has its own expenses section — newest first, with
  `expenses_total` and a `grand_total` (services + expenses). The
  services part of the file is byte-for-byte the old shape; nothing
  that reads it breaks. The Expenses tab also has its own per-bike
  export (`bike-log-<bike>-expenses.json` / `.txt`, plus Copy text),
  one bike at a time, same "pick a bike first" guard as history.
  The Data tab counts now include expenses ("3 expenses logged
  ($117.50)").
- Node tests grew from 139 to 186 (+47): add-expense validation
  (unknown bike, empty description, missing/negative cost, bad date,
  unknown category, negative odometer, $0 allowed, blank category
  defaults to other, cost rounds to cents), id rule, newest-first
  ordering, per-bike and per-category filtering, totals and
  per-category breakdowns, delete + unknown-delete throws,
  bike-removal cascade, history-export inclusion (services total
  unchanged, expenses newest first, grand total, text section and
  grand-total line, empty-expenses bike), expenses-only export
  (shape, round-trip, isolation, text content, filename slugging),
  import (expenses carried, pre-expenses file defaults empty,
  missing-bike / negative-cost / unknown-category rejected),
  mergeSample carrying expenses.
- Static checks in place of the jsdom smoke test this round (jsdom
  is not installed on this VM): every `getElementById` id in app.js
  exists in index.html (the only four absent are the handoff confirm
  card's, which are generated by innerHTML — pre-existing), nav
  buttons match view sections 1:1, all 15 expense element ids are
  present, and the static-server check returns 200 for every shipped
  asset. A real-browser pass (add an expense, filter, export, check
  the History export's grand total) is still owed before publish.
- Service-worker cache bumped v12 → v13.
