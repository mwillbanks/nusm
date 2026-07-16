# Browser Runtime QA Receipt

- Date: 2026-07-16 (America/Chicago)
- Runtime: current Bun hot-reload preflight at `http://127.0.0.1:4173/` and full QA against the final rebuilt production bundle at `http://127.0.0.1:43117/?devtools`
- Browser: headed Playwright Chromium `149.0.7827.55` at desktop (1600 x 900) and mobile (390 x 844) viewports
- Browser-validated application asset: `index-bkcgrgcg.js` (SHA-256 `b3a8ed6a41b37bad5bcd0a419aabbaa18b00d7f9692e027f65e2ab44af236f5e`)
- Reviewed source identities: `src/nusm.ts` SHA-256 `57dfe2e33f309dd1adbc1213dafaa52b8a143412958182e4b6ec01ebd31c49d5`; `src/devtools/panel.tsx` SHA-256 `09f3f04539d4be1e42dfffd00f4c748375a3ce4358efd6683d1b05f397b697c7`
- Validation gate: `.agents/.code-validation-gate/2026-07-16_172230` (5/5 checks, `review_valid: true`)

## Live checks

| Surface | Browser-level result |
| --- | --- |
| App readiness | Reported `4 of 4 stores ready` with a live bidirectional event bridge. |
| Navigation | Command center, Stores, and Signals each rendered as exclusive labelled regions. |
| Responsive layout | Stores and Signals remained operable at 390 x 844 with no horizontal overflow, console warning, or console error. |
| TanStack integration | The TanStack trigger opened the native `nusm` plugin panel with the canonical nusm logo. |
| Store selection | Four real stores displayed stable instance discriminators. Two live duplicate-display-id snapshots (`qa-duplicate-a` and `qa-duplicate-b`) remained independently visible; searching the second instance hid only the first and selecting it rendered `duplicate-live · instance qa-duplicate-b`. |
| localStorage | The adapter tab rendered `accent`, `density`, `shortcuts`, and `theme` values and reported ready/synchronized hydration. |
| sessionStorage | The adapter tab rendered `activeView`, `drafts`, and `lastCommand` values and reported ready/synchronized hydration. |
| IndexedDB | The adapter tab rendered three nested activity events and reported ready/synchronized hydration. |
| Bidirectional mutation | Editing `workspace-pulse.focusMinutes` from `96` to `128` in the panel updated both the Devtools row and the live Signals visualization; the panel acknowledged `set path complete`. |
| Devpanel UX | Search, overview/memory/adapter/timeline/about tabs, copy, raw edit, add, edit, remove, refresh, health, hydration, and last-write affordances were present in the mounted panel. |
| Console | Browser warning/error log was empty after navigation, adapter inspection, and mutation. |

## Production server checks

After `bun run example:build` and `PORT=43117 bun run example:serve`, `/` returned `200` with the 438-byte HTML shell and `/index-bkcgrgcg.js` returned `200` with the built bundle. Absolute, encoded, dot-segment, backslash, and malformed-encoding traversal probes all returned `404` with the 9-byte not-found response.

## Reproduction

1. Run `bun run example:devtools` and open `http://127.0.0.1:4173/`, or build and serve the exact production asset with `bun run example:build` and `PORT=43117 bun run example:serve`.
2. Select each primary navigation control and verify its labelled region is exclusive.
3. Open TanStack Devtools, select `nusm`, and inspect Memory plus each adapter tab.
4. Confirm every store exposes its instance discriminator; stage or create duplicate display ids and verify instance search and selection remain independent.
5. Edit `workspace-pulse.focusMinutes`; verify the Signals ring changes to the acknowledged value.
6. Reload and confirm localStorage, sessionStorage, and IndexedDB tabs remain hydrated and synchronized.
7. Check desktop and mobile browser consoles for warnings or errors.
