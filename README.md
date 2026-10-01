# ramp-prototypes

Five working time-and-money-saving prototypes for a private Ramp event: Cart
Tetris, Pay Me Twice, BorrowFirst, Budget Brawl, and ExitLane. All demo data,
sandbox persistence, honest labels — no real payments, accounts, or
cancellations, and no API keys required.

## Getting started

macOS/Linux:

```bash
npm run setup && npm start
```

PowerShell (run `npm start` after setup completes successfully):

```powershell
npm run setup
npm start
```

`npm run setup` installs dependencies for every app currently present under
`apps/`; `npm start` builds any missing `dist/` and launches each app's
sandbox server (React/Vite plus same-origin `/api` backed by `node:sqlite`)
on its own port. To rebuild changed source, run `npm run build` first:

| App | Directory | Port |
| --- | --- | --- |
| Cart Tetris | `apps/cart-tetris` | http://localhost:5311 |
| Pay Me Twice | `apps/pay-me-twice` | http://localhost:5312 |
| BorrowFirst | `apps/borrowfirst` | http://localhost:5313 |
| Budget Brawl | `apps/budget-brawl` | http://localhost:5314 |
| ExitLane | `apps/exitlane` | http://localhost:5315 |

Requires Node 22.14 or newer. Only directories that exist are touched. Run one
app on macOS/Linux with `APP=cart-tetris npm start`. In PowerShell:

```powershell
$env:APP='cart-tetris'
npm start
```

After stopping it with Ctrl+C, clear the filter with
`Remove-Item Env:APP` before starting the full suite.

Run `npm run hub` in a second terminal and open http://localhost:5300 for the
demo hub linking all five local servers. Directly opening `hub/index.html`
as a file does not launch or route to the apps. On GitHub Pages, the same
hub uses relative links to the deployed app directories.

## Every app

```bash
cd apps/<slug>
npm ci
npm run typecheck --if-present
npm test
npm run build
npm start
```

Every build also works fully client-side from GitHub Pages — the app probes
`/api/health` and falls back to a labeled "Browser sandbox". Browser state uses
IndexedDB, localStorage, or memory depending on the app and browser support;
it is not a shared server database. No real transactions occur in either mode.

`npm run dev` starts an optional Vite development server. Use it separately
from the full suite or assign an unused port: BorrowFirst's Vite default is
5314, which the full suite uses for Budget Brawl.

## Public previews

After the `main` Pages deployment succeeds, the hub is at
[sharonbasovich.github.io/ramp-prototypes/](https://sharonbasovich.github.io/ramp-prototypes/).

| App | Pages preview |
| --- | --- |
| Cart Tetris | [Open Cart Tetris](https://sharonbasovich.github.io/ramp-prototypes/cart-tetris/) |
| Pay Me Twice | [Open Pay Me Twice](https://sharonbasovich.github.io/ramp-prototypes/pay-me-twice/) |
| BorrowFirst | [Open BorrowFirst](https://sharonbasovich.github.io/ramp-prototypes/borrowfirst/) |
| Budget Brawl | [Open Budget Brawl](https://sharonbasovich.github.io/ramp-prototypes/budget-brawl/) |
| ExitLane | [Open ExitLane](https://sharonbasovich.github.io/ramp-prototypes/exitlane/) |

## Root commands

- `npm run setup` — `npm ci` in each present `apps/*/` directory.
- `npm test` — run each app's test suite sequentially.
- `npm run typecheck` — run each available app's typecheck script.
- `npm run build` — run each app's production build.
- `npm start` — start every present app's sandbox server.
- `npm run hub` — serve the demo hub on :5300.

## CI & deployment

- `.github/workflows/ci.yml` — discovers `apps/*/package.json` into a matrix
  and runs install/typecheck/test/build per app (missing apps don't break CI). On
  `main`, an additional job requires all five apps to be present.
- `.github/workflows/pages.yml` — builds every present app and deploys a
  static site to GitHub Pages at `/ramp-prototypes/<slug>/` plus the hub at
  `/ramp-prototypes/` (enable Pages: Settings → Pages → GitHub Actions).
