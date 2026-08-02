# Phase 04 Deferred Items

## 2026-07-29 — Plan 04-01 full aggregate

- `npm run check` was explicitly interrupted after the long packed Builder matrix stopped producing output under execution stall surveillance.
- At interruption the aggregate reported 792 passed, 1 failed, 2 cancelled, and 1 skipped.
- The reported assertion failure was in `test/codex-builder-behavior.test.js` (`bounds an escaped stdout-holding PATH-shadow probe`) and does not overlap the Plan 04-01 package/carrier source or tests.
- `test/builder-packed-install.test.js` was interrupted with pending work and is inconclusive, not green.
- Revisit the load-sensitive timeout and complete an unbounded aggregate in a dedicated verification window; do not treat this item as a Phase 4 package failure without reproduction.
