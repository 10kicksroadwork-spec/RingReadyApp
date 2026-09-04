# Coach Decision Dashboard V1

**Status:** Spec approved with corrections — **implementation authorized**.  
**Branch:** `coach/decision-dashboard-v1`  
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
3. Add **Detailed Summary** with athlete selector and Sheets **information/field** parity.
4. Add four team-wide metric pages that share one reusable card/grid architecture.
5. Preserve `user_id` locker boundaries and roster exclusions (`docs/AUTH_LOCKER_MODEL.md`).
6. One canonical analytics model — identical metric values/status everywhere in the coach UI.

## Non-goals (V1)

- Changing the athlete drawer, athlete home, or Training Weeks for athletes.
- Inventing a new “summary” that drops Sheets dashboard fields.
- Mixing watts / machine output into Overall Pace Stats (future: separate **Output Stats** page).
- Forced numerical parity with obsolete Sheets formulas when RingReady already has a newer canonical builder.
- Four copy-pasted analytics implementations.

---

## Release / deploy policy

```text
A–F
  COMPLETE

COACH UX V1
  Implement now
  Adversarial review + exact-head CI + athlete regression gates
  Merge to main when clean

AFTER PRODUCTION DEPLOYMENT
  Record the new production main SHA
  Reset GOLF Day 0 to that deployment date
  Restart the 7-day final soak
  Current GOLF soak may be superseded
```

Implementation may merge to production after adversarial review, exact-head CI green, and athlete regression gates green. There is **no** September 11 (or other calendar) merge prohibition.

Release gate checklist:

```text
COACH FUNCTIONAL
Camp Roster home                  PASS
coach drawer IA                   PASS
Detailed Summary athlete select   PASS
Benchmark sort/filter             PASS
Recovery sort/filter              PASS
Pace sort/filter                  PASS
HR adherence sort/filter          PASS
card → correct athlete detail     PASS

DATA CONSISTENCY
same metric everywhere            PASS
one card per user_id              PASS
excluded accounts absent          PASS
No Data handled correctly         PASS

ATHLETE REGRESSION
athlete drawer unchanged          PASS
workout completion unchanged      PASS
Sprint unchanged                  PASS
proof unchanged                   PASS
auth locker boundaries            PASS

CI
unit                              PASS
lint                              PASS
build                             PASS
browser-e2e                       PASS
```

Then after merge:

```text
main production-contract PASS
Vercel PASS
/api/health = new main SHA
GOLF Day 0 resets
```

---

## Current baseline (code facts)

These are the live surfaces this spec replaces or extends — not inventions:

| Surface | Location | Note |
|---------|----------|------|
| Drawer still shows **Training Weeks** for everyone | `index.html` (`drawer-section-label` + `#drawer-week-list`), populated by `renderDrawerWeeks()` in `src/shell.js` | Coach still sees dead-weight week list |
| Coach home = Camp Roster | `#coach-dashboard` in `index.html`, rendered by `src/coach-preview.js` | Keep as command center |
| Per-athlete coach detail | `#coach-athlete` | Useful signals exist; evolve into Detailed Summary |
| Benchmark / zone / recovery / pace / Performance Index signals | `src/coach-preview.js` + `src/modality.js` + `src/hr-analytics.js` | Canonical builders — reuse everywhere |
| Zone adherence thresholds | `buildZoneSignal()` — green ≥80%, amber ≥60%, else red | Preserve for HR Adherence Stats |
| Schedule adherence today | `completionPct = logged / due` in `buildAthleteRecord()` | Canonical RingReady definition (see below) |
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

Roster athlete click → **Detailed Summary** for that athlete (same destination as metric-card clicks).

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

### Sheets parity policy (required)

> **Detailed Summary requires information/field parity with Sheets, not forced numerical parity with legacy formulas. Where RingReady already has a newer canonical metric builder, RingReady's canonical calculation wins and must be used consistently everywhere. Any intentional semantic difference must retain clear labeling.**

Required information areas (Sheets **field** parity checklist):

| Area | Notes |
|------|--------|
| Workouts Completed | Camp completion counts (`logged`) |
| Total Running Hours | Running modality time only where modality is known |
| Total Mileage | Running distance |
| Benchmark Progress | Prefer Performance Index / HR-adjusted benchmark builders already in RingReady; label clearly if not raw Sheets equiv-mi % |
| Mile Test time delta | Baseline → latest |
| Sprint HR Drop — First 5 | Latest + trend |
| Schedule Adherence | **Canonical RingReady:** `logged / due` (see below) |
| Missed Workouts | Explicit list |
| Coaching Guidance | **Two separate elements** (see below) — never silently substitute one for the other |
| Benchmark Trend | Chart / weekly series from canonical builders |
| Mile Test & Max HR | Profile + test context |
| Sprint HR Recovery | First-5 recovery series |
| Zone Adherence Heatmap | Eligible sessions in/out of band |
| HR vs Pace Efficiency | Existing efficiency framing from dashboard / RingReady pace+HR signals |

Existing `#coach-athlete` metric cards, missed/skipped panels, camp start, and clean slate are implementation raw material — not a free pass to drop Sheets fields.

### Schedule Adherence (canonical)

Sheets legacy: `completed workouts / assigned workouts` (all assigned slots).

**RingReady canonical (wins):**

```text
scheduleAdherencePct = logged / due * 100
```

where:

- `due` = sessions whose calendar day has arrived (not future / not before camp start)
- `logged` = sessions with status `logged` **or** `skipped` (same as today’s `buildAthleteRecord()`)
- Label in UI as **Schedule Adherence** with supporting copy like `N / M due sessions` so the due-vs-assigned difference is visible

Do not reintroduce Sheets’ all-assigned denominator merely for numerical parity.

### Coaching Guidance (two elements)

| Element | Source | UI |
|---------|--------|-----|
| **Generated verdict / guidance** | Algorithmic RingReady headline (`buildHeadline` / scan-driven) | Status chip + verdict copy — not coach-authored |
| **Coach-authored notes** | `coach_notes` / local preview notes | Separate notes panel with save |

Never present coach notes as if they were the generated guidance block, or vice versa.

### Identity

All loads keyed by `user_id`. Display name is metadata only (see `docs/AUTH_LOCKER_MODEL.md`).

---

## 3. Shared analytics page framework

**Major requirement:** One reusable architecture — not four separate dashboards.

```text
buildCoachAthleteAnalytics(athlete)
        |
        +-- performanceIndex
        +-- recovery
        +-- pace
        +-- hrAdherence
        |
        +--> Detailed Summary
        +--> Benchmark Stats
        +--> Recovery Stats
        +--> Pace Stats
        +--> HR Adherence Stats
        +--> existing coach detail surfaces
```

The aggregate pages are **different views of one analytics model**, not five opportunities to calculate differently.

### Canonical metric invariant (acceptance)

> **The same athlete and underlying data must produce the same metric value/status everywhere in the coach UI.**

Example:

```text
Daniel Benchmark PI
Detailed Summary      108.4
Benchmark Stats       108.4
existing coach detail 108.4
```

Never:

```text
Detailed Summary      108.4
Benchmark Stats       106.9
coach athlete page    +7.2%   // different interpretation of the same data
```

Applies to:

- Performance Index
- Sprint First-5 recovery
- Overall Pace Trend
- HR Adherence

Centralize builders for those four metrics. Detailed Summary, aggregate pages, and any remaining coach detail chrome must consume them.

### Metric definition shape

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
| `hasData` | False → No Data UI (never invent trends) |

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
- Empty / insufficient data → explicit **No Data** — never invent trend points or classify as Declining/Needs Attention from missing data.
- One card per `user_id`; no duplicates.
- Exclude coach accounts and roster exclusions (`buildCoachUserIdSet`, `buildRosterExclusionSet`, seeds).
- Soft-fail per data source remains acceptable; do not widen RLS or invent parallel auth.
- Filters change the **visible** card set only; they must not mutate underlying athlete analytics.

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

| PI | Badge | Filter |
|----|-------|--------|
| `> 100` | **IMPROVING** | Improving, All |
| `= 100` | **BASELINE** | **All only** (not Improving, not Declining) |
| `< 100` | **DECLINING** | Declining, All |
| no index | **NO DATA** | All only |

Do **not** visually label PI `= 100` as IMPROVING. Including baseline only under **All** is the V1 filter rule.

### Sort

- Descending → highest PI first  
- Ascending → lowest PI first  

### Card content

- Athlete name, current week  
- Performance Index (primary)  
- Delta from 100 baseline (e.g. `+8.4%` / `-7.6%`)  
- **PI trend graph as visual centerpiece** (`buildContinuousPerformanceIndex` / `formatPerformanceIndex` in `src/modality.js`)  
- Status badge per table above  

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
| Flat / single sample | Neutral / BASELINE — All only until comparable |
| No sprint drops | No Data |

Existing `buildRecoverySignal()` already compares latest vs first First-5 drop — align card math with that model (same numbers everywhere).

### Sort

Descending = largest positive improvement first.

### Card content

- Latest First-5 drop (BPM)  
- Delta vs baseline  
- Weekly First-5 series + sparkline  
- IMPROVING / DECLINING / BASELINE / NO DATA badge  

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

- Prefer overall / collective pace improvement % vs first comparable week (canonical `buildPaceSignal()` after running-only filter).  
- Display human pace when useful (`min/mi` baseline → latest) **only** for running aggregates.  
- Faster = positive improvement.

Implementation note: today’s `collectPaceBuckets()` does not yet hard-filter modality; V1 must enforce running-only when wiring this page **inside the canonical builder** so Detailed Summary and Pace Stats agree.

### Status

| Trend | Status |
|-------|--------|
| Faster vs baseline (above flat band) | Improving |
| Slower vs baseline | Declining |
| Flat within band | Baseline — All only |
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

Eligible = sessions with a resolvable zone target and logged avg BPM (`scoreZoneAdherence` / canonical zone builder).

Zero eligible sessions → **No Data** (not 0%).

### Status thresholds (preserve current)

| Pct | Status | Filter bucket |
|-----|--------|----------------|
| ≥ 80% | On Target | On Target |
| 60–79% | Watch | All only |
| < 60% | Needs Attention | Needs Attention |
| 0 eligible | No Data | All only |

V1 filters are **On Target / Needs Attention / All**. Watch (amber) athletes appear in All; they are not labeled “Declining.”

### Card content

- Adherence %  
- `onTarget / scored` eligible sessions copy  
- Weekly adherence series when available  
- ON TARGET / WATCH / NEEDS ATTENTION / NO DATA badge  

---

## Implementation phases

| Phase | Scope |
|-------|--------|
| **COACH 1** | Coach drawer IA + shared `CoachMetricPage` / card / sort / search framework |
| **COACH 2** | Detailed Summary — athlete selector + Sheets field parity + guidance split |
| **COACH 3** | Benchmark Stats (PI cards, Improving/Declining/Baseline, sort, graph) |
| **COACH 4** | Recovery Stats + Overall Pace Stats (running-only) + HR Adherence Stats |

---

## Architecture notes for implementers

- Extract / centralize pure metric builders so roster detail, Detailed Summary, and aggregate pages call the **same** functions.
- UI may live as new screens in `index.html` + render functions, consistent with existing coach screens (`coach-dashboard`, `coach-athlete`).
- Routing: coach-only screen ids; `isCoachScreen` / `canAccessCoachScreens` gates stay mandatory.
- Do not touch frozen athlete completion, sprint, proof, or iOS audio paths listed as out of scope in `docs/AUTH_LOCKER_MODEL.md`.

---

## Test plan

### Unit — metric definitions

```text
Benchmark
  PI 108 → Improving badge + Improving filter
  PI 92  → Declining
  PI 100 → BASELINE badge; visible under All only (not Improving)
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

Consistency
  same athlete + same sessions → identical PI / recovery / pace / adherence
  on Detailed Summary, aggregate cards, and coach detail surfaces
```

### Browser / E2E acceptance

```text
Coach drawer
  → Training Weeks absent
  → all five Analysis destinations visible
  → Camp Roster / home reachable

Athlete drawer
  → unchanged (Training Weeks + athlete pages present)

Benchmark Stats (and siblings)
  → changing sort visibly reorders athlete cards
  → filters change visible card set only
  → filters do not mutate underlying data
  → search finds correct athlete

Metric card click
  → opens Detailed Summary
  → correct athlete selected

Direct athlete attempt
  → cannot reach coach pages

No-data athlete
  → clear No Data UI
  → no bogus zero / Declining / Needs Attention classification
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

## Review gate

**Implementation authorized** after this corrected contract. Open a draft PR, run the full regression suite, then **STOP for adversarial code review** before merge.

### Acceptance for “spec done”

- [x] Camp Roster remains home  
- [x] Coach drawer Analysis IA defined; athlete drawer untouched  
- [x] Detailed Summary Sheets **information** parity + RingReady canonical win policy  
- [x] Schedule Adherence = `logged / due` documented  
- [x] Coaching Guidance split: generated verdict vs coach notes  
- [x] Canonical metric invariant (same value/status everywhere)  
- [x] Four aggregate lenses + shared card framework specified  
- [x] PI `= 100` → BASELINE (All only; never IMPROVING badge)  
- [x] HR Adherence uses On Target / Needs Attention  
- [x] Pace = running only  
- [x] Browser/E2E acceptance listed  
- [x] Merge-when-clean + GOLF Day 0 reset policy recorded  

---

## Changelog

| Date | Change |
|------|--------|
| 2026-09-04 | Initial V1 spec (`docs(coach): define analytics navigation and views`) |
| 2026-09-04 | Align metric parity and release policy (`docs(coach): align metric parity and release policy`) |
