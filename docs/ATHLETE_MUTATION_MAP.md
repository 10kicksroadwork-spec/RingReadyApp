# Athlete mutation map (Hotel)

Inventory of athlete state transitions. **Hotel owns entity identity only.** Operation IDs, orchestrator extraction, and sync idempotency land in later phases (India–Oscar).

Authority rule: Supabase is authoritative; browser storage is disposable cache.

## Entity identity (canonical owner)

All workout / proof / mile entity keys are owned by [`src/workout-completion-identity.js`](../src/workout-completion-identity.js):

| Entity | Constructor | Format |
|--------|-------------|--------|
| Workout completion | `buildWorkoutCompletionKey` / `resolveCanonicalWorkoutIdentity` | `{week}:{workout}` |
| Program proof / linked mile | `buildProgramProofKey` | `program:{4\|7}:{week}:{workout}` |
| Mile test | `buildMileTestKey` / `MILE_TEST_BASELINE_KEY` | baseline or program proof key |
| Single-flight keys | `buildDetailCompletionFlightKey`, `buildSprintCompletionFlightKey`, `buildMileCompletionFlightKey`, `buildProofFlightKey` | `completion:…` / `proof:…` |

**Forbidden:** alternate constructors in callers (`program:${…}`, `` `${week}:${workout}` `` for completion identity, private `buildProgramProofKey` copies). Enforced by `npm run test:architecture`.

**Not entity identity:** UI prefs, note storage helpers that *call* `buildWorkoutCompletionKey`, sync queue item ids (operation IDs — Kilo).

## Current sibling mutation paths (India will consolidate)

| Action | UI entry | Cloud | Local cache | Sheets sync | Notes |
|--------|----------|-------|-------------|-------------|-------|
| Detail complete | `shell.js:completeWorkoutFromDetail` | provisional identity → proof → reconcile save | completions | `daily_workout` + proof | Has staging + unique soft-success |
| Sprint complete | `app.js:completeWorkout` | session upsert → proof → completion | completions | proof only | No provisional staging today |
| Skip | `shell.js:confirmSkipWorkoutFromDetail` | same persist helper | completions | `daily_workout_skip` | No single-flight today |
| Clear | `shell.js` / `app.js` | `clear_workout_completion_with_proof` | tombstone | none | Listener may still raw DELETE |
| Mile test | `shell.js:saveMileTestResult` | mile staging → proof → upsert | mile (+ HR) | `mile_test` | |
| Sprint session finish | `app.js:finishSession` | `sprint_sessions` upsert | history + checkpoint | `sprint_session` | |
| Proof stage/upload | `proof.js` | storage + RPC | in-memory stage | parent mutation | Must not decide completion |
| Profile / HR | shell / onboarding | upsert | profile / HR keys | Sheets | Outside `workout-mutations.js` |

## Target ownership (post-India+)

```text
UI → workout-mutations.js → identity → proof upload → cloud reconcile → cache → outbox
profile/HR → existing owners → mutation-runner.js (reliability only)
```

## Architecture gate

```bash
npm run test:architecture
```

Fails on direct `localStorage` outside `safe-storage.js` and on alternate entity-identity construction in `src/`.
