# iOS Real Device Acceptance

Echo is not complete until this checklist has been executed on a **physical modern iPhone** or a **real-iPhone device cloud** (not Chrome device emulation alone).

Record evidence for every row: device model, iOS version, surface (Safari browser vs Home Screen PWA), orientation, deployed `buildSha`, PASS/FAIL, notes, and screenshots or screen recordings where helpful.

## Minimum matrix

| Surface | Orientation |
| --- | --- |
| Safari browser | Portrait |
| Safari browser | Landscape |
| Home Screen PWA | Portrait |
| Home Screen PWA | Landscape |

## Minimum checks

- [ ] Install to Home Screen from Welcome
- [ ] Launch installed PWA cold start
- [ ] Sign-in screen visually correct when Supabase is configured
- [ ] Home safe areas and header layout
- [ ] Drawer opens and closes cleanly
- [ ] Workout detail scrolls without clipping
- [ ] Mile Test keyboard/input and MM:SS formatting
- [ ] Normal workout logging (running distance + non-running watts)
- [ ] Proof image selection and preview
- [ ] Sprint start from a program workout
- [ ] Background app for ~30 seconds, then return
- [ ] Lock phone, unlock, return to app
- [ ] Sprint checkpoint/resume after reload or background
- [ ] Home indicator clearance on bottom actions
- [ ] Status bar readability over gold header (`black-translucent` visual check)
- [ ] No Dynamic Island / notch collision on primary chrome

## Delta-specific visual check

If status-bar glyphs are hard to read over the gold header on a real iPhone, switch the status-bar style based on observed device behavior rather than theory.

## Execution log template

| Date | Device | iOS | Surface | Orientation | buildSha | Result | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| YYYY-MM-DD | iPhone __ | __.__ | Safari / Home Screen | Portrait / Landscape | ______ | PASS / FAIL | |

## Evidence storage

Keep screenshots, short screen recordings, and this completed table with the Echo PR or release notes. Automated Playwright WebKit coverage does **not** replace this checklist.
