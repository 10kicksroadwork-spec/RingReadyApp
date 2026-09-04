# Coach Decision Dashboard V1

**Status:** Spec only — stop for Daniel review before major implementation.  
**Branch:** `coach/decision-dashboard-v1`  
**Production merge:** Blocked until GOLF soak exits (do not merge into production while `release/stability-rc1` / GOLF is soaking).  
**Athlete systems:** Frozen — do not alter athlete drawer behavior, workout logging, BLE, sprint engine, proof upload, or completion identity for this work.

---

## Product verdict

Camp Roster remains the coach home / command center. The coach drawer becomes a set of **cross-athlete analysis lenses** so coaches navigate by the question they want answered, not by training week.

Two complementary coaching modes:

| Mode | Question | Entry |
|------|----------|-------|
| Athlete-first | “Tell me everything about Daniel.” | Detailed Summary |
| Question-first | “Whose benchmark is declining?” / “Who isn’t following HR?” | Benchmark / Recovery / Pace / HR Adherence Stats |

---

## Goals

1. Replace the coach-side **Training Weeks** drawer section with analytics navigation.
2. Keep **Camp Roster** as coach home, essentially as-is.
3. Add **Detailed Summary** with athlete selector and parity to the Google Sheets Coaches Dashboard Individual Detailed Summary.
4. Add four team-wide metric pages that share one reusable card/grid architecture.
5. Preserve `user_id` locker boundaries and roster exclusions (`docs/AUTH_LOCKER_MODEL.md`).

## Non-goals (V1)

- Changing the athlete drawer, athlete home, or Training Weeks for athletes.
- Inventing a new “summary” that drops Sheets dashboard fields.
- Mixing watts / machine output into Overall Pace Stats (future: separate **Output Stats** page).
- Merging this branch to production before GOLF exit.
- Four copy-pasted analytics implementations.

---

## Current baseline (code facts)

These are the live surfaces this spec replaces or extends — not inventions:

| Surface | Location | Note |
|---------|----------|------|
| Drawer still shows **Training Weeks** for everyone | `index.html` (`drawer-section-label` + `#drawer-week-list`), populated by `renderDrawerWeeks()` in `src/shell.js` | Coach still sees dead-weight week list |
| Coach home = Camp Roster | `#coach-dashboard` in `index.html`, rendered by `src/coach-preview.js` | Keep as command center |
| Per-athlete coach detail | `#coach-athlete` | Useful signals exist; **not** full Sheets Individual Detailed Summary parity |
| Benchmark / zone / recovery / pace / Performance Index signals | `src/coach-preview.js` + `src/modality.js` + `src/hr-analytics.js` | Reuse; expose better in aggregate lenses |
| Zone adherence thresholds | `buildZoneSignal()` — green ≥80%, amber ≥60%, else red | Preserve for HR Adherence Stats |
| Roster exclusions / coach hide-self | `src/coach-access.js` + RLS | Must apply on every aggregate page |

---

## Coach drawer IA (coach only)

```text
CAMP ROSTER
(home)

ANALYSIS

Detailed Summary
Benchmark Stats
Recovery Stats
Overall Pace Stats
HR Adherence Stats

ACCOUNT

Sign Out
```

### Rules

- **Coach only:** When `isCoachUser()` is true, hide athlete page targets (`data-coach-hide`) as today, hide **Training Weeks** (`#drawer-week-list` + its section label), and show the Analysis destinations above.
- **Athlete drawer:** Unchanged — Home, Profile, Welcome, HR Info, S&C, Mile Test, Training Weeks, Sign Out.
- Camp Roster / home must always be one tap away from any coach analytics screen.
- Sign Out stays under Account (existing `#drawer-account` behavior).

---

## 1. Camp Roster (home)

**Purpose:** “Show me everybody and let me decide who I want to inspect.”

Keep essentially as-is:

- Roster count / needs a look / on track / missing summary chips
- Filter: All / Needs a Look / On Track
- Athlete search
- Per-athlete roster cards opening the deep-dive path

**Do not** stuff every new analytics metric onto the roster. Aggregate pages own that job.

Clicking a roster athlete may continue to open the current coach athlete surface during early implementation; once Detailed Summary ships, roster → Detailed Summary for that athlete is the preferred deep link (same destination as metric-card clicks).

---

## 2. Detailed Summary

**Purpose:** Athlete-first deep dive.

### Header

```text
DETAILED SUMMARY

Athlete
[ Daniel ▼ ]
```

Selecting any **active, non-excluded** roster athlete reloads the page for that `user_id`.

### Source of truth

Functional parity with the **Google Sheets Coaches Dashboard — Individual Detailed Summary**. Modernize RingReady presentation, but preserve information — do not invent a thinner substitute.

Required information areas (Sheets parity checklist):

| Area | Notes |
|------|--------|
| Workouts Completed | Camp completion counts |
| Total Running Hours | Running modality time only where modality is known |
| Total Mileage | Running distance |
| Benchmark Progress | Vs camp baseline / W1 |
| Mile Test time delta | Baseline → latest |
| Sprint HR Drop — First 5 | Latest + trend |
| Schedule Adherence | Due vs logged |
| Missed Workouts | Explicit list |
| Coaching Guidance | Coach notes / verdict copy |
| Benchmark Trend | Chart / weekly series |
| Mile Test & Max HR | Profile + test context |
| Sprint HR Recovery | First-5 recovery series |
| Zone Adherence Heatmap | Eligible sessions in/out of band |
| HR vs Pace Efficiency | Existing efficiency framing from dashboard |

Existing `#coach-athlete` metric cards (Performance Index, Benchmark Run, HR Zone Adherence, Recovery Trend, Overall Pace Trend, missed/skipped panels, camp start, clean slate) are implementation raw material — not a free pass to drop Sheets fields.

### Identity

All loads keyed by `user_id`. Display name is metadata only (see `docs/AUTH_LOCKER_MODEL.md`).

---

## 3. Shared analytics page framework

**Major requirement:** One reusable architecture — not four separate dashboards.

```text
CoachMetricPage
    │
    ├── benchmark definition
    ├── recovery definition
    ├── pace definition
    └── adherence definition
```

Each metric definition supplies:

| Field | Meaning |
|-------|---------|
| `value` | Primary display metric |
| `baseline` | Camp / first valid baseline |
| `delta` | Change vs baseline (signed, metric-specific) |
| `trendPoints` | Ordered week (or session) series for the sparkline |
| `status` | Filterable classification |
| `sortValue` | Numeric key for asc/desc sort |
| `formatters` | Value / delta / graph / badge copy |
| `userId` | Athlete locker id (required) |
| `weekLabel` | Current camp week display |

### Shared page chrome (all four aggregate pages)

```text
PAGE TITLE

Status filters
Sort metric
Ascending / descending
Athlete search

────────────────────

Athlete card grid
```

### Shared card anatomy

```text
Athlete Name
Current Camp Week

Primary metric
Change from baseline

Small trend graph

Status badge
```

### Shared behaviors

- Search filters by athlete display name (client-side over already-authorized roster payload).
- Card click → **Detailed Summary** for that athlete (`user_id`).
- Empty / insufficient data → explicit **No Data** (or metric-specific empty copy) — never invent trend points.
- One card per `user_id`; no duplicates.
- Exclude coach accounts and roster exclusions (`buildCoachUserIdSet`, `buildRosterExclusionSet`, seeds).
- Soft-fail per data source remains acceptable; do not widen RLS or invent parallel auth.

---

## 4. Benchmark Stats

**Lens:** Performance Index for everybody.

### Chrome

```text
BENCHMARK STATS

[ Improving ] [ Declining ] [ All ]

Sort by Performance Index
[ Descending ▼ ]

Search athlete...
```

### Status rules (PI normalized around 100)

| PI | Status |
|----|--------|
| `> 100` | Improving |
| `< 100` | Declining |
| `= 100` | Baseline / neutral — include with **Improving** (Not Declining) for the two-button Improving filter |

Underlying tone in `buildPerformanceSignal()` already treats `index >= 100` as green and `< 95` as red; the **page filters** follow the PI 100 rule above for Improving / Declining.

### Sort

- Descending → most improved / highest PI first  
- Ascending → lowest PI first  

### Card content

- Athlete name, current week  
- Performance Index (primary)  
- Delta from 100 baseline (e.g. `+8.4%` / `-7.6%`)  
- **PI trend graph as visual centerpiece** (`buildContinuousPerformanceIndex` / `formatPerformanceIndex` in `src/modality.js`)  
- Status badge: IMPROVING / DECLINING / etc.

Reuse continuous PI across modalities — Benchmark Stats is about the **index**, not raw miles. Do not fake cross-modality distance conversions (existing modality contract).

---

## 5. Recovery Stats

**Lens:** Sprint First-5 BPM drop.

Same chrome pattern:

```text
RECOVERY STATS

[ Improving ] [ Declining ] [ All ]

Sort by Recovery Improvement
[ Descending ▼ ]
```

### Metric

- Primary: latest First-5 Sprint BPM drop  
- Improvement: `latestFirst5Drop - baselineFirst5Drop`  
- **Higher BPM drop = better recovery**

### Status

| Delta | Status |
|-------|--------|
| Positive (latest > baseline) | Improving |
| Negative | Declining |
| Flat / single sample | Neutral / All only until comparable |

Existing `buildRecoverySignal()` already compares latest vs first First-5 drop — align card math with that model.

### Sort

Descending = largest positive improvement first.

### Card content

- Latest First-5 drop (BPM)  
- Delta vs baseline  
- Weekly First-5 series + sparkline  
- IMPROVING / DECLINING badge  

---

## 6. Overall Pace Stats

**Lens:** Running pace trend only.

```text
OVERALL PACE STATS

[ Improving ] [ Declining ] [ All ]

Sort by Pace Improvement
[ Descending ▼ ]
```

### Hard rule — running only

```text
Overall Pace Stats = running data.
```

- Include sessions with `normalizeModality(...) === running` and valid minutes + distance.  
- **Do not** mix assault bike / rower / stationary bike watts into pace.  
- Future optional page: **Output Stats** (watts) — out of scope for V1.

### Metric

- Prefer overall / collective pace improvement % vs first comparable week (existing `buildPaceSignal()` averages zone-relative bucket trends).  
- Display human pace when useful (`min/mi` baseline → latest) **only** for running aggregates.  
- Faster = positive improvement.

Implementation note: today’s `collectPaceBuckets()` does not yet hard-filter modality; V1 must enforce running-only when wiring this page.

### Status

| Trend | Status |
|-------|--------|
| Faster vs baseline (above flat band) | Improving |
| Slower vs baseline | Declining |
| Insufficient weeks | No Data |

---

## 7. HR Adherence Stats

**Lens:** Compliance with prescribed HR targets (Zone Adherence) — **not** fitness improvement.

```text
HR ADHERENCE STATS

[ On Target ] [ Needs Attention ] [ All ]

Sort by Adherence
[ Ascending ▼ ]
```

Default sort Ascending surfaces the athletes who need attention first.

### Metric

```text
adherencePct = onTarget / eligibleSessions * 100
```

Eligible = sessions with a resolvable zone target and logged avg BPM (`scoreZoneAdherence` / `buildZoneSignal` in `src/hr-analytics.js` + `src/coach-preview.js`).

Zero eligible sessions → **No Data** (not 0%).

### Status thresholds (preserve current)

| Pct | Status | Filter bucket |
|-----|--------|----------------|
| ≥ 80% | On Target | On Target |
| 60–79% | Watch | *(shown under All; optional mid chip later)* |
| < 60% | Needs Attention | Needs Attention |

V1 filters are **On Target / Needs Attention / All**. Watch (amber) athletes appear in All; they are not labeled “Declining.”

### Card content

- Adherence %  
- `onTarget / scored` eligible sessions copy  
- Weekly adherence series when available  
- ON TARGET / WATCH / NEEDS ATTENTION badge  

---

## Implementation phases

Conceptual boundaries (not necessarily four giant PRs):

| Phase | Scope |
|-------|--------|
| **COACH 1** | Coach drawer IA + shared `CoachMetricPage` / card / sort / search framework (stub metric defs OK) |
| **COACH 2** | Detailed Summary — athlete selector + Sheets Individual Detailed Summary parity |
| **COACH 3** | Benchmark Stats (PI cards, Improving/Declining, sort, graph) |
| **COACH 4** | Recovery Stats + Overall Pace Stats (running-only) + HR Adherence Stats |

Suggested commit discipline after this spec:

1. Navigation + shared framework  
2. Detailed Summary parity  
3. Benchmark Stats  
4. Remaining three metric pages + shared tests  

---

## Architecture notes for implementers

- Prefer extracting pure metric builders from `src/coach-preview.js` into shared modules (e.g. coach analytics) so roster detail and aggregate pages call the same functions.
- UI may live as new screens in `index.html` + render functions, consistent with existing coach screens (`coach-dashboard`, `coach-athlete`).
- Routing: coach-only screen ids; `isCoachScreen` / `canAccessCoachScreens` gates stay mandatory.
- Do not touch frozen athlete completion, sprint, proof, or iOS audio paths listed as out of scope in `docs/AUTH_LOCKER_MODEL.md`.

---

## Test plan

Beyond normal CI / lint:

### Unit — metric definitions

```text
Benchmark
  PI 108 → Improving
  PI 92  → Declining
  PI 100 → Improving filter (Not Declining)
  descending sorts 108 before 92

Recovery
  29 → 36 BPM → +7 Improving
  36 → 28 BPM → Declining

Pace
  11:42 → 10:54 /mi → Improving
  machine watts sessions excluded from pace aggregates
  running-only metrics

HR adherence
  9/10 → 90% → On Target
  6/10 → 60% → Watch (All)
  5/10 → 50% → Needs Attention
  0 eligible → No Data (not 0%)
```

### Aggregate page invariants

- Every card `user_id` belongs to the authorized roster payload  
- No duplicate athletes  
- No coach / excluded / test accounts  
- No fake trend series from missing data  
- Card navigation lands on Detailed Summary for the same `user_id`

### Regression

- Athlete drawer still shows Training Weeks and athlete page links  
- Coach drawer does not show Training Weeks  
- Athlete workout / sprint / proof flows unchanged  

---

## Deploy / track separation

```text
GOLF
  release/stability-rc1 (and related soak)
  DO NOT TOUCH
  soak through Sep 11, 2026

COACH DEVELOPMENT
  coach/decision-dashboard-v1
  free to develop / preview / test
  NO production merge before GOLF exit
```

Preview and local coach testing are encouraged on this branch. Production promotion waits on explicit post-soak approval.

---

## Review gate

**STOP for Daniel review before major implementation.**

This document is the V1 product contract. Implementation PRs should cite section numbers / phase tags (COACH 1–4) and must not silently change athlete IA or merge ahead of GOLF exit.

### Acceptance for “spec done”

- [x] Camp Roster remains home  
- [x] Coach drawer Analysis IA defined; athlete drawer untouched  
- [x] Detailed Summary Sheets parity field list captured  
- [x] Four aggregate lenses + shared card framework specified  
- [x] HR Adherence uses On Target / Needs Attention (not Improving/Declining)  
- [x] Pace = running only  
- [x] Locker / exclusion / test plan / branch / merge policy recorded  

---

## Changelog

| Date | Change |
|------|--------|
| 2026-09-04 | Initial V1 spec (`docs(coach): define analytics navigation and views`) |
