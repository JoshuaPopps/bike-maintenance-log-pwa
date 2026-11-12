# bike-maintenance-log-pwa

A maintenance logbook for motorcycles — as a phone app you install
from the browser. No app store, no account, no server.

Oil, tires, primary fluid, brakes, belt, plugs: every recurring job
gets a miles interval, a months interval, or both, and the app tells
you what's **OVERDUE**, what's **DUE SOON** (within 500 miles or 30
days), and what's fine — before a missed service turns into a shop
bill. Log a service and the clock resets from that date and mileage,
not from when you remembered to write it down.

This is the phone face of the
[bike-maintenance-log CLI](https://github.com/JoshuaPopps/bike-maintenance-log).
Same logbook, same data model, same rules — the CLI keeps working,
and the two trade one JSON file back and forth.

> All bikes, names, and numbers below are examples only.

## What it does

- **Due tab** — every task across all your bikes, worst first:
  overdue, then due soon, then ok. Each row shows the interval, what
  the last service was (or that nothing's been logged yet, counting
  from task creation), and a **Log** button that pre-fills the service
  form for that task.
- **Bikes & Tasks tab** — multiple bikes, each with its own tasks and
  odometer. Add a bike by picking from the common-bikes catalog
  (Harley-Davidson, Triumph, Honda, Suzuki, Kawasaki, Yamaha — 106
  models grouped by family, e.g. Softail → Fat Boy) or by typing any
  make and model not listed. Update its odometer, add tasks. Common task
  names (Engine oil, Primary fluid, Spark plugs, …) are one-tap
  buttons that fill in the name — **you set the interval from your
  manual**. The Reference tab lists the factory intervals for the Evo
  Softail as a starting point, but your manual wins for your bike.
- **History tab** — every logged service, newest first, filterable by
  bike and task, with a running total of what you've spent.
- **Data tab** — export the whole logbook as one JSON file, import a
  logbook back, load example data to try it out, or wipe everything.
- **Reference tab** — factory service intervals, fluid specs, tire
  pressures, and key torques for the Evo Softail, from the 1997–98
  Softail Factory Service Manual #99482-98 §1. The example bike is a
  1995 Fat Boy on the same platform; year-specific capacities are not
  printed as 1995 specs.
- **Installable & offline** — open it in Chrome (Android) or Safari
  (iPhone), "Add to Home Screen," and it works in the garage with no
  signal. A service worker caches the app shell; your logbook lives in
  the browser's local storage on your device.

## Install

No build step, no dependencies. Any static host works — GitHub Pages,
a folder on your home server, or just the files on disk:

```bash
# Local preview
python3 -m http.server 8000
# then open http://localhost:8000/ on your phone or desktop
```

On your phone, open the hosted URL and use **Add to Home Screen**
(Android Chrome: menu → Add to Home Screen; iPhone Safari: Share →
Add to Home Screen). It then launches full-screen like a native app
and works offline.

## Try it with example data

Open the **Data** tab and tap **Load example data**. You get an
example bike with four tasks that show all three states at once — one
overdue, one due soon, two ok — so you can see the badges before
entering your own bike. The example intervals are the factory numbers
for the Evo Softail platform, from the 1997–98 Softail Factory Service
Manual #99482-98 §1 (mileage-based only; the manual has no months legs
and brake fluid is inspect-only) — the same numbers in the app's
Reference tab. Loading the example on top of a logbook you already
started is safe: it gets fresh ids, so it never overwrites your bikes
or attaches its history to them. Delete it any time from Bikes &
Tasks, or wipe everything from Data.

Example walkthrough (what the example logbook shows):

```
Example 1995 Softail — odo 42,300 mi
  OVERDUE   Brake fluid (inspect)
             last done Sep 04, 2025 @ 27,300 mi
             10,000 mi overdue
  DUE SOON  Engine oil
             last done Jun 04, 2026 @ 37,500 mi
             due in 200 mi
  ok        Primary fluid
             last done Oct 04, 2026 @ 41,300 mi
             due in 4,000 mi (@ 46,300 mi)
  ok        Tires (inspect)
             not logged yet — counting from task creation
             due in 5,000 mi (@ 47,300 mi)
```

(The example's dates are relative to the day you load it, so the
overdue / due-soon / ok spread stays true whenever you try it.)

## Moving data between the app and the CLI

The app's export **is** the CLI's `data.json` — same keys
(`bikes`, `tasks`, `entries`), same field names (`every_miles`,
`every_months`, `baseline_odo`, `baseline_date`), same id scheme
(`b1`, `t1`, `e1`), same due rules (worst leg wins; due-soon
windows of 500 miles / 30 days). Export from the app, drop it where
the CLI reads it (or point `BIKE_LOG_HOME` at that folder), and
`bike_log.py due` prints the same statuses. Import a CLI export into
the app the same way. Verified both directions — see TESTING.md.

## How due dates work

- A task with a miles interval is due at **last-service mileage +
  interval**; a task with a months interval is due at **last-service
  date + interval months** (month-end clamped: Jan 31 + 1 month =
  Feb 28).
- With both intervals, the worse leg wins: a task is OVERDUE if
  either leg is past, DUE SOON if either leg is inside its window.
- With no service logged yet, the clock counts from when the task was
  created (the bike's odometer and that date at the time).
- Logging a service at a higher odometer than recorded advances the
  bike's odometer (the service happened at that mileage). Logging
  below it warns and leaves the recorded odometer alone — odometer
  swaps happen, but a typo shouldn't rewind your bike.

## On specs

The app's only service numbers are the ones in the Reference tab and
the example logbook, and they come from one source: the 1997–98
Softail Factory Service Manual #99482-98, §1 — not from memory. The
example bike is a 1995 Fat Boy on the same Evo Softail platform, so
the intervals and fluid types carry over, but year-specific capacities
are not printed as 1995 specs. For any other bike, the numbers come
from that bike's own manual — guessing them is how parts get broken.

Brake fluid is the one to get right: **DOT 5 silicone ONLY, never mix
with DOT 3/4** (§1, p.1-42; part nos. 99902-77 / 99901-77).

## Tests

```bash
node test.js   # core logic: 61 checks, no dependencies
```

The core logic (due math, odometer rules, import validation, sample
merge) is pure JavaScript with no DOM in it, so it runs under Node
directly. The UI itself was smoke-tested in jsdom against the real
`index.html` + `app.js` — see TESTING.md for the full notes.

## Known limits

- Data lives in one browser's local storage; Export/Import is the
  sync story for now. (The CLI on a home machine is the natural
  second copy.)
- Installability (Add to Home Screen) and the service worker's
  offline cache were verified by code inspection (manifest + sw.js
  asset list matches the shipped files) and the static-server check,
  not by an on-device install test — that step is for the owner on
  their own phone after approval.
- The app itself is plain ES5-era JavaScript and CSS with no build
  step, written to run in any modern mobile browser.
