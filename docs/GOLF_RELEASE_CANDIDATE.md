# GOLF — Release Candidate Soak (`release/stability-rc1`)

GOLF answers one question:

> Can we leave RingReady alone, let real athletes use it, and trust it?

This is a **release-validation** phase, not a coding phase. Do not begin GOLF with speculative code changes.

## CURRENT KNOWN-GOOD

```text
CURRENT KNOWN-GOOD:
4f04928

SOURCE:
Foxtrot merge (approved head 82010e7)

PRODUCTION:
https://ring-ready-app.vercel.app/
/api/health buildSha = 4f04928 (verified day-0)
```

Treat `4f04928` as the production baseline for the entire RC window unless a later SHA is explicitly validated and recorded below.

## Freeze (do not reopen without a reproducible production defect)

- Auth / account-boundary isolation (Foxtrot)
- Service worker caching contract
- Cloud hydration authority
- Completion identity and reconciliation
- Proof upload / finalization RPCs
- Sprint checkpoint ownership and resume semantics
- iOS lifecycle / timer audio recovery

No cleanup, refactors, or “while we’re here” polish on these paths during GOLF.

## Phase goals

1. Production soak against real usage
2. Regression monitoring (CI + production)
3. Release checklist discipline
4. Rollback readiness
5. Confirm Golden Athlete Flow stays green without reopening frozen code
6. No feature creep

## Day-0 baseline record

| Gate | Evidence |
|------|----------|
| `main` SHA | `4f04928` |
| Foxtrot close | COMPLETE |
| `quality` | PASS |
| `browser-e2e` | PASS |
| `production-contract` (live) | PASS |
| Vercel production | PASS |
| `/api/health` `buildSha` | `4f04928` |
| Account-boundary smoke | PASS (A → logout → A) |
| Real iPhone / Golden Athlete Flow | COMPLETE (prior certification) |
| GOLF branch tip | docs-only (see soak tip on branch) |
| GOLF branch CI | PASS |

## Defect severity

| Severity | Meaning |
|----------|---------|
| **P0** | App unusable, data loss, or security/authorization breach |
| **P1** | Athlete cannot reliably complete, log, resume, or hydrate a workout / Sprint |
| **P2** | Degraded or non-blocking UX (including known backlog such as proof-transfer latency/telemetry unless it becomes P1) |

Unresolved **P0** or **P1** defects block GOLF completion. P2 stays backlog unless it elevates.

## Soak exit criteria (objective)

GOLF is **not** complete until **all** of the following are true:

```text
Minimum soak:
7 calendar days on the known-good production lineage
(start counting from day-0: 2026-09-04 → earliest exit 2026-09-11)

AND during that window observe at least:
- 3 normal workout completions (persist after refresh)
- 1 Sprint completion / resume lifecycle
- 1 proof upload / transfer (arrives eventually)
- 1 logout / re-login
- 1 coach-side completion / proof check

AND:
- zero unresolved P0/P1 production defects
- main CI remains green during the window
- /api/health remains on the expected known-good lineage
- Vercel production remains healthy
- rollback path confirmed available (see Rollback)
```

Prefer real athlete usage. Do not manufacture volume just to tick boxes. Record each observed item in the soak log.

### Daily (during the 7 days)

- [ ] `/api/health` sane / expected SHA lineage
- [ ] Vercel healthy
- [ ] No new unresolved P0/P1 user reports
- [ ] Main remains green when CI runs

### Over 7 days (minimum observed usage)

- [ ] ≥3 normal completions persist after refresh
- [ ] ≥1 Sprint lifecycle (complete and/or resume)
- [ ] ≥1 proof reaches Drive / eventual transfer
- [ ] ≥1 logout / re-login with correct athlete state
- [ ] ≥1 coach-side verification of completion/proof

## Core soak checks

Record date, operator, `buildSha`, surface, and notes. Prefer real athlete usage over inventing new automation.

Observation targets (map into the exit-criteria counts above):

- [ ] Normal workout save → persists after refresh
- [ ] Sprint session → resumes correctly
- [ ] Proof → arrives eventually (do not reopen transfer latency unless it becomes P0/P1)
- [ ] Cross-device → same authoritative completion state
- [ ] Logout / login → correct athlete state
- [ ] Coach dashboard → sees intended athlete data
- [ ] No raw SQL / RLS / storage / athlete-visible JS errors in reported sessions

### Explicit non-goals

- No new product features
- No speculative cleanup/refactors
- No full physical-iPhone Golden Flow re-certification unless a regression forces it
- No auth/SW/hydration/proof/Sprint “improvements” without a production defect

## Release gates (before calling GOLF complete)

- [ ] Soak **exit criteria** above are fully met (7 days + minimum usage + zero P0/P1)
- [ ] Main CI green repeatedly during the soak window
- [ ] `production-contract` green on main (live, not skipped)
- [ ] Vercel healthy
- [ ] `/api/health` reports the expected SHA
- [ ] Golden Athlete Flow remains green (prior certification stands; re-run only if a defect appears)
- [ ] Coach visibility check PASS (≥1 during soak)
- [ ] Rollback path **confirmed available** on Vercel (do not intentionally roll back healthy production merely to rehearse)
- [ ] Known-good production SHA recorded (start: `4f04928`)

## Rollback procedure

```text
IF NEW RELEASE REGRESSES:
1. identify last green main / last known-good deploy
   (start from CURRENT KNOWN-GOOD: 4f04928)
2. revert/rollback deployment (prefer Vercel rollback)
3. verify /api/health buildSha matches restored SHA
4. verify production-contract (live) when credentials/CI allow
5. smoke Golden Athlete Flow essentials:
   sign-in → hydrate → one completion or Sprint surface → logout/login clean
```

**Confirm** that production rollback is available in Vercel. Do **not** intentionally roll back a healthy production deployment merely to rehearse. Rehearse only in non-production / preview if practical.

Reliability is not only “nothing breaks.” It is also:

> If something breaks, we can get back to safe production quickly.

### Rollback evidence

| Item | Where |
|------|--------|
| Known-good SHA | `4f04928` |
| Production URL | `https://ring-ready-app.vercel.app/` |
| Health | `https://ring-ready-app.vercel.app/api/health` |
| Foxtrot PR | #60 |
| Live auth contract | `npm run test:proof-auth` / main `production-contract` |
| iOS acceptance doc | `docs/IOS_REAL_DEVICE_ACCEPTANCE.md` |

## If a defect appears

Record at minimum:

```text
date/time
buildSha
device/browser
athlete action
expected
actual
screenshots/logs
whether Supabase data remained correct
severity (P0/P1/P2)
```

Then:

1. Reproduce with evidence
2. Open a **narrow** fix branch
3. Touch only the failing subsystem
4. Re-run the smallest gates that prove the defect is gone
5. Merge only after review if the change touches a frozen path
6. Update CURRENT KNOWN-GOOD only after the fix is production-validated

## Soak log

| Date | Operator | buildSha | Check | Result | Notes |
|------|----------|----------|-------|--------|-------|
| 2026-09-04 | Carl (day-0) | `4f04928` | `/api/health` | PASS | `environment=production`, refs match |
| 2026-09-04 | Carl (day-0) | `4f04928` | Vercel / Foxtrot close smoke | PASS | A → logout → A already recorded at Foxtrot close |
| 2026-09-04 | Carl | docs tip | Exit criteria defined | PASS | 7-day soak + min usage + P0/P1 gate |
|  |  |  |  |  |  |

## Status

```text
ALPHA       COMPLETE
BRAVO       COMPLETE
CHARLIE     COMPLETE
DELTA       COMPLETE
ECHO        COMPLETE
FOXTROT     COMPLETE / FROZEN
REAL IPHONE COMPLETE
GOLDEN FLOW COMPLETE
GOLF        SOAKING — earliest exit 2026-09-11 if criteria met
baseline    4f04928
branch      release/stability-rc1
PR          #62 (draft, docs-only)
```