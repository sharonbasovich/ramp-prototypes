# Ramp private-event prototype suite

Sharon explicitly authorized building all five now, independently and without questions. This is a DIFFERENT PRIVATE EVENT, not the Luma Ramp x Blueprint event. Do not apply that event's format or build restrictions. Do not submit any project to an event or handle online hackathons in this workspace. No real payments, finance accounts, supplier cancellations, emails, or sensitive data.

## Workspace ownership

Repository: https://github.com/sharonbasovich/ramp-prototypes

Five builders work concurrently on separate branches and app directories:

| App | Directory | Branch | Fullstack port |
| --- | --- | --- | --- |
| Cart Tetris | apps/cart-tetris | codex/cart-tetris | 5311 |
| Pay Me Twice | apps/pay-me-twice | codex/pay-me-twice | 5312 |
| BorrowFirst | apps/borrowfirst | codex/borrowfirst | 5313 |
| Budget Brawl | apps/budget-brawl | codex/budget-brawl | 5314 |
| ExitLane | apps/exitlane | codex/exitlane | 5315 |

Only the Cart Tetris builder owns root package scripts, the hub, root README, and GitHub Actions. Other builders change ONLY their app directory. Image concepts and specs in the repository root are shared read-only inputs. Each app has its own package.json and package-lock.json. Open a PR, do not overwrite another branch or merge anyone else's PR. Do not wait for another app; implement yours independently. If managed Git access is unavailable, continue fully locally and attach a git bundle and readable screenshots; do not pause the build just for publication.

## Technology and deployment

- React + Vite + TypeScript with small focused components, separated pure engine and example data, explicit design tokens. Node 22.14 is installed on Sharon's laptop.
- Each app: npm ci, npm test, npm run build, npm start. Provide package-lock. Fullstack server serves dist and same-origin /api on its assigned port.
- Use Node built-in node:sqlite for real transactional invoice payment, budget reservations and equipment reservations. Avoid native-addon toolchains or paid services.
- Also provide a STATIC sandbox adapter so every app works from GitHub Pages with no key/account. Do not fake server responses as if they were a live backend. Show 'Browser sandbox' clearly when using that adapter, and 'SQLite server sandbox' only after genuine /api/health succeeds. Atomic browser storage can use IndexedDB transactions/Web Locks; explain its single-origin/browser limitation. The engines and editable input/output flows must remain real in both modes.
- Vite base must support /ramp-prototypes/<slug>/. Static assets must be relative or correctly prefixed. If a backend is unavailable the app must remain usable and honestly disclose its mode. No paid hosting or newly accepted terms.
- Root Cart builder supplies GitHub Pages build/deploy workflow for all five apps after merge, with separate per-app CI or matrix detecting which directories exist. Missing apps during parallel build must not break initial CI; final assembled CI must require all five.
- No API key is required for MVP. AI/model extraction is optional and must not be claimed if absent. Scripted agents must be labeled scripted. No fabricated third-party integration or live pricing claim. Example prices/bookings/inventory are explicitly labeled and editable/importable. Integer cents, validated finite inputs, fixed currency, no invented tax or price conversion.
- Use sample-only persistent stores with a reset control; the reset affects only clearly marked sandbox data. No reading local personal files or browser credentials.

## Design contract

Inspect your <slug>-concept.png image before coding. Reproduce its composition, spacing, typography, palette, controls and table/list anatomy. Images are design references, never flattened app UI. All text/controls are code native. No generic marketing page. One complete product workflow above the fold. Responsive at 1536x1024, 1366x768 and 390px mobile; keyboard focus and reduced motion.

Deliberate corrections to generated concepts are REQUIRED: generated invoice dates should use an explicit fixture date; BorrowFirst's inventory compatibility must be computed from actual requirements (larger monitors are not inherently incompatible); Cart Tetris's invoice/table allocations and prices must come from SPEC-CART, not incorrect image arithmetic; Budget Brawl must say scripted agents and must distinguish lack of permission from an approval threshold; ExitLane must not claim a request was sent before sandbox execution and must use true policy cutoff times. Remove invented/unimplemented navigation such as BorrowFirst People/Reports. These are documented functional corrections, not permission to redesign.

Use Manrope (Cart/Borrow/Exit) and IBM Plex Sans (Pay/Budget), with robust fallbacks. True white for Cart/Borrow/Budget/Exit; Pay's light lavender background. No decorations above headline, no generic card grids, no excessive gradients/glow. Functional frames/tables shown in the concept are permitted.

## Definition of done

1. Fully working complete flow, editable inputs, calculation evidence, honest states, reset, export where specified.
2. Meaningful engine tests including held-out and concurrency cases, build and type checks passing.
3. Browser test at desktop and mobile; capture screenshots into your app/docs/screenshots (PNG). A browser interaction must demonstrate changed inputs affecting output. Preserve a readable 30-second booth demo script in app/DEMO.md and scope/limitations in app/README.md.
4. Compare concept and screenshot directly, inspect copy/layout/type/palette/spacing/controls, fix issues and record app/docs/design-review.md. No inert controls.
5. Push only your app branch and open PR. Include exact test commands/results and screenshots. Supply a git bundle if push is blocked. Never pay for SWE-2 Priority or hosting.
6. No final event submission. These are five independent prototypes for Sharon to compare and choose at the private event.

