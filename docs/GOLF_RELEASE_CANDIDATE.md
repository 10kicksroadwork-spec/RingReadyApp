# GOLF — Release Candidate Soak (`release/stability-rc1`)

**Baseline:** production `main` at `4f04928` (Foxtrot merge; approved head `82010e7`).

GOLF is a **release-stability** phase. It is not a feature phase.

## Freeze (do not reopen without a reproducible production defect)

- Auth / account-boundary isolation (Foxtrot)
- Completion identity and reconciliation
- Cloud hydration authority
- Service worker caching contract
- Proof upload / finalization RPCs
- Sprint checkpoint ownership and resume semantics
- iOS lifecycle / timer audio recovery

Do **not** perform cleanup, refactors, or “while we’re here” polish on these paths during GOLF.

## Phase goals

1. **Soak** the known-good production baseline
2. **Observe** regressions in production and CI
3. Confirm **rollback readiness**
4. Keep the **Golden Athlete Flow** green without reopening frozen code
5. Avoid feature creep

## Known-good baseline record

| Gate | Status at Foxtrot close |
|------|-------------------------|
| `main` SHA | `4f04928` |
| `quality` | PASS |
| `browser-e2e` | PASS |
| `production-contract` (live) | PASS |
| Vercel production | PASS |
| `/api/health` `buildSha` | `4f04928` |
| Account-boundary smoke | PASS (A → logout → A) |
| Real iPhone / Golden Athlete Flow | COMPLETE (prior phases) |

## Soak checklist

Record date, operator, `buildSha`, and notes for each item.

### Daily / continuous

- [ ] Production `/api/health` still reports an expected `buildSha` lineage from this baseline
- [ ] Vercel production deployment remains healthy
- [ ] No new athlete-visible auth, completion, Sprint, proof, or SW regressions reported
- [ ] Main CI stays green on any follow-up RC commits (only allow emergency defect fixes)

### Periodic (during RC window)

- [ ] Spot-check Athlete A sign-in → own data → logout → re-login hydration
- [ ] Spot-check one normal workout completion persistence (no Golden Flow full re-run unless a defect appears)
- [ ] Spot-check Sprint start / resume still behaves on one browser surface
- [ ] Confirm proof upload still succeeds for a disposable test athlete when exercised
- [ ] Confirm coach view still sees athlete completions when a coach check is available

### Explicit non-goals

- No new product features
- No auth-model redesigns
- No SW / proof RPC / hydration “improvements” without a production defect
- No full physical-iPhone Golden Flow re-certification unless a regression forces it

## Rollback readiness

If production regresses after an RC change:

1. Identify the bad deploy SHA from `/api/health` `buildSha`
2. Prefer **Vercel rollback** to the last known-good production deployment whose `buildSha` is `4f04928` (or a later explicitly validated soak SHA)
3. Confirm post-rollback `/api/health` matches the restored SHA
4. Re-run a minimal smoke: sign-in → home hydration → one workout or Sprint surface
5. Only then open a narrow defect PR; do not broaden scope into frozen areas

### Rollback evidence to keep handy

| Item | Where |
|------|--------|
| Known-good SHA | `4f04928` |
| Production URL | `https://ring-ready-app.vercel.app/` |
| Health endpoint | `https://ring-ready-app.vercel.app/api/health` |
| Foxtrot PR | #60 |
| Live auth contract | `npm run test:proof-auth` / main `production-contract` job |

## Release checklist (RC → ship)

Before calling the RC shippable beyond soak:

- [ ] Soak window completed without open production defects on frozen paths
- [ ] Main gates green on the RC tip (if any commits landed)
- [ ] `/api/health` matches the intended production SHA
- [ ] Rollback path rehearsed or confirmed available on Vercel
- [ ] Release notes list only stability/soak outcomes — no undeclared features
- [ ] Frozen-path policy restated for the next phase

## If a defect appears

1. Reproduce with evidence (`buildSha`, steps, screenshots/logs)
2. Open a **narrow** fix branch
3. Touch only the failing subsystem
4. Re-run the smallest gates that prove the defect is gone
5. Merge only after adversarial/operator review if the change touches a frozen path

## Status

```text
ALPHA–ECHO     COMPLETE
FOXTROT        COMPLETE / FROZEN
REAL IPHONE    COMPLETE
GOLDEN FLOW    COMPLETE
GOLF           IN PROGRESS (soak / rollback readiness)
baseline       4f04928
branch         release/stability-rc1
```
