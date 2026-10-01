# ramp-prototypes

Five working time-and-money-saving prototypes for a private Ramp event: Cart
Tetris, Pay Me Twice, BorrowFirst, Budget Brawl, and ExitLane. All demo data,
sandbox persistence, honest labels — no real payments, accounts, or
cancellations, and no API keys required.

## Getting started (one command)

```bash
npm run setup && npm start
```

`npm run setup` installs dependencies for every app currently present under
`apps/`; `npm start` launches each app's sandbox server (React/Vite build +
same-origin `/api` backed by `node:sqlite`) on its own port:

| App | Directory | Port |
| --- | --- | --- |
| Cart Tetris | `apps/cart-tetris` | http://localhost:5311 |
| Pay Me Twice | `apps/pay-me-twice` | http://localhost:5312 |
| BorrowFirst | `apps/borrowfirst` | http://localhost:5313 |
| Budget Brawl | `apps/budget-brawl` | http://localhost:5314 |
| ExitLane | `apps/exitlane` | http://localhost:5315 |

Requires Node 22.x. Only directories that exist are touched, so this works
while apps land in parallel — run a single app with `APP=<slug> npm start`.

Open `npm run hub` (http://localhost:5300) for the quiet demo hub linking all
five, or `hub/index.html` directly.

## Every app

```bash
cd apps/<slug>
npm ci && npm test && npm run build   # tests, typecheck, production build
npm start                             # sandbox server on its assigned port
npm run dev                           # vite dev server
```

Every build also works fully client-side from GitHub Pages — the app probes
`/api/health` and falls back to an IndexedDB "Browser sandbox" labeled as such.

## Root commands

- `npm run setup` — `npm ci` in each present `apps/*/` directory.
- `npm test` — run each app's test suite sequentially.
- `npm run build` — run each app's production build.
- `npm start` — start every present app's sandbox server.
- `npm run hub` — serve the demo hub on :5300.

## CI & deployment

- `.github/workflows/ci.yml` — discovers `apps/*/package.json` into a matrix
  and runs install/test/build per app (missing apps don't break CI). On
  `main`, an additional job requires all five apps to be present.
- `.github/workflows/pages.yml` — builds every present app and deploys a
  static site to GitHub Pages at `/ramp-prototypes/<slug>/` plus the hub at
  `/ramp-prototypes/` (enable Pages: Settings → Pages → GitHub Actions).
