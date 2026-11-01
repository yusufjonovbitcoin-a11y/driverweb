# Member avatar loading and display

## Confirmed cause

The live roster used 44 × 44 CSS-grid avatar frames, but portrait images
resolved to 44 × 95.33 inside them. The intrinsic image sizing overflowed the
grid track and cropped the wrong portion of the picture. Both inspected
images had successfully loaded (1080 × 2340); this was a display defect,
not evidence of a failed file upload.

An additional failure path hid an image by mutating its inline display style.
That style persisted when React replaced its URL, and the roster did not
render initials in its place.

## Change

- Share `MemberAvatar` across the roster, driver detail, team, chat/call,
  arrival and map-driver-picker surfaces.
- Constrain images to the existing frame, independently of intrinsic aspect
  ratio, and show initials while loading or on error.
- Renew a failed authenticated media URL once, invalidating only that media's
  cached signature. Keep normal server authorization and short-lived URLs.
- Keep a replacement-source failure bounded; never loop retries. Remount on
  member/path/source changes and ignore responses after unmount.
- Do not modify stored photos, media access rules, or backend configuration.

## Verification

- Live roster: both images loaded and measured exactly 44 × 44 after HMR.
- Five desktop browser regressions passed: portrait geometry, expired URL
  recovery, offline recovery, invalid renewed URL, late response after a
  member change. Source replacement is also exercised after both failures.
- All 1,008 unit tests passed; lint and production build passed.
- Screenshot: `output/avatar-loading-fixed-2026-11-01.jpg` (ignored).
