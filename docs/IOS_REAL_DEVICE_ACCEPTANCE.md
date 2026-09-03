# iOS Real Device Acceptance

Echo is not complete until this checklist has been executed on a **physical modern iPhone** or a **real-iPhone device cloud** (not Chrome device emulation alone).

Automated Playwright WebKit coverage does **not** replace this checklist. Browser Safari does **not** substitute for the Home Screen PWA rows.

Record evidence for every row: device model, iOS version, surface (Safari browser vs Home Screen PWA), orientation, deployed `buildSha`, PASS/FAIL, notes, and screenshots or screen recordings where helpful.

## Minimum matrix

| Surface | Orientation |
| --- | --- |
| Safari browser | Portrait |
| Safari browser | Landscape |
| Home Screen PWA | Portrait |
| Home Screen PWA | Landscape |

## Shell / install checks

- [ ] Install to Home Screen from Welcome
- [ ] Launch installed PWA cold start
- [ ] Sign-in screen visually correct when Supabase is configured
- [ ] Home safe areas and header layout
- [ ] Drawer opens and closes cleanly
- [ ] Workout detail scrolls without clipping
- [ ] Mile Test keyboard/input and MM:SS formatting
- [ ] Home indicator clearance on bottom actions
- [ ] Status bar readability over gold header (`black-translucent` visual check)
- [ ] No Dynamic Island / notch collision on primary chrome
- [ ] Zero athlete-visible SQL / RLS / Storage / JS errors in the session

## Sprint lifecycle checks

- [ ] Sprint start from a program workout
- [ ] Background app for ~30 seconds during rest, then return (rest reflects elapsed wall time)
- [ ] Lock phone, unlock, return to app
- [ ] Sprint checkpoint / resume after reload or background
- [ ] Same logical session resumes (not a fresh session)

## Golden Athlete Flow (required — configured cloud account)

Run at least once on **Home Screen PWA · Portrait** against a production-equivalent configured account (not local-athlete / empty Supabase). Prefer the Vercel preview for the exact Echo head when that preview has intended production-like Supabase config.

Athlete steps:

1. [ ] Sign in
2. [ ] Open an assigned non-sprint workout
3. [ ] Enter metrics (running distance **or** non-running average watts as appropriate)
4. [ ] Attach proof image A and preview
5. [ ] Tap **Complete**
6. [ ] Reload / cold relaunch
7. [ ] Verify workout remains complete with the same metrics
8. [ ] Attempt the same logical completion again (retry / save again)
9. [ ] Verify still **one** logical completion (no uniqueness error toast; no duplicate athlete-visible state)
10. [ ] Replace proof with image B
11. [ ] Verify still **one** current proof (preview shows B)
12. [ ] Clear the completion
13. [ ] Reload / cold relaunch
14. [ ] Verify completion is absent
15. [ ] Recomplete with final metrics + proof
16. [ ] Confirm zero athlete-visible SQL / RLS / Storage / JS errors throughout

Coach verification (same workout, after step 15):

17. [ ] Coach roster/detail shows the same final metrics the athlete entered
18. [ ] Coach sees the final current proof (B or the recompleted proof)
19. [ ] Athlete and coach agree on completed state — **required before calling this workout successfully tested**

Also cover modality coverage somewhere in the matrix:

- [ ] Running distance path exercised
- [ ] Non-running average-watts path exercised (Assault Bike or equivalent)

## Delta-specific visual check

If status-bar glyphs are hard to read over the gold header on a real iPhone, switch the status-bar style based on observed device behavior rather than theory.

## Execution log template

| Date | Device | iOS | Surface | Orientation | buildSha | Flow | Result | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| YYYY-MM-DD | iPhone __ | __.__ | Safari / Home Screen | Portrait / Landscape | ______ | Shell / Sprint / Golden | PASS / FAIL | |

## Evidence storage

Keep screenshots, short screen recordings, and this completed table with the Echo PR or release notes.
