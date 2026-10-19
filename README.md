# NEMLab frontend

The browser applications for BatteryLab and GridReplay. This is a separate Git
repository from [nemlab](https://github.com/ryanzzzdev/nemlab), the Python
API/worker backend.

Two applications live here:

- **`apps/public`** — the public product: price explorer, BatteryLab battery
  simulation (scenario form → job polling → stored comparison with charts and
  shareable saved links), and GridReplay (event catalogue, replay, highlights
  and deep links).
- **`apps/admin`** — a separately built owner/viewer console: data operations
  (coverage, loads, jobs, publications, simulations), access management and
  sign-in flows. It never shares a bundle with the public app and holds no
  operator credentials.

The public app uses centered workspaces (1160px BatteryLab, 1440px GridReplay)
following the accepted layouts in
[decision 018](https://github.com/ryanzzzdev/nemlab/blob/main/docs/project/decisions/018-product-layouts-and-appearance.md);
Admin uses an independent full-viewport desktop design under
[decision 025](https://github.com/ryanzzzdev/nemlab/blob/main/docs/project/decisions/025-admin-desktop-workspace.md).
Both share Light/Dark/Auto appearance; the public header's Appearance control
persists across pages and updates open charts.

## Local setup

Use Node.js 22.23.1 (`nvm use` reads `.nvmrc`) and npm 10.9.8. From this repository:

```sh
npm ci --ignore-scripts
npm run dev         # public app  — http://127.0.0.1:5173
npm run dev:admin   # admin app   — http://127.0.0.1:5274/admin
```

Each shell starts without a backend. Price reads and sign-in require the API
configuration below; OE and operator credentials never belong in this frontend.
The development servers bind to loopback and fail if their ports are occupied.

```sh
npx --no-install playwright install chromium
npm run check
```

On a Linux host missing browser system libraries, use
`npx --no-install playwright install --with-deps chromium` once; it may require
administrator permissions. `check` verifies contract hashes, formatting, strict
TypeScript, both production bundles and both Playwright suites (public and
Admin) at desktop/mobile widths. Hosted CI runs these same checks on the
frontend workflow.

`npm run format` applies Prettier. `npm run build` produces `apps/public/dist/`
and `apps/admin/dist/`; `npm run preview`/`preview:admin` serve those outputs
at <http://127.0.0.1:4173> and <http://127.0.0.1:4274/admin> for local inspection.
Build before preview or browser tests. Preview is not a production server.
Playwright owns its preview process and refuses to reuse another process on the
preview port. Browser screenshots/traces live in ignored `test-results/`.

## Layout and boundaries

- `apps/public/`: the public browser application, built as static assets.
- `apps/admin/`: the Admin workspace, a separate build at base `/admin/` with
  its own stylesheet/tokens; the public bundle contains zero Admin code.
- `tests/`, `tests-admin/`: browser checks against the built outputs.
- `contracts/`: versioned OpenAPI snapshot and generated types synced from the
  backend (see _Contract handoff_).
- Root tooling, lockfile and CI: shared by applications in this npm workspace.

Extract shared components only when both applications need them; Admin imports
nothing from `apps/public` styles. Vite environment variables are public bundle
inputs; never place OE credentials or operator tokens in this repository.

The stack is React 19.3.0, Vite 8.3.0, React plugin 6.1.1, TypeScript 5.9.3 and
React Router 8.4.0 with plain CSS. TanStack Query 5.103.1 owns caching/polling,
ECharts 6.1.0 renders linked charts (lazy-loaded) and the typed API client uses
openapi-fetch 0.16.0 over the generated contract. Prettier 3.9.8 enforces
formatting and Playwright 1.63.0 runs the browser suites. Exact dependencies
and the lockfile are committed together.

## Project records

Read [AGENTS.md](AGENTS.md) and the backend's canonical documents:

- [Roadmap](https://github.com/ryanzzzdev/nemlab/blob/main/docs/project/roadmap.md)
- [Tasks](https://github.com/ryanzzzdev/nemlab/blob/main/docs/project/backlog.md)
- [Documentation guide](https://github.com/ryanzzzdev/nemlab/blob/main/docs/project/documentation-guide.md)
- [API contract](https://github.com/ryanzzzdev/nemlab/blob/main/api/contracts/README.md)

These links point at the backend's GitHub repository; locally they correspond to a
sibling checkout named `nemlab` (tools like `contract:sync` still use that layout). This
repository builds independently of the backend. The imported contract snapshot and its provenance are described below.

## Routes and static hosting

The public app uses browser-history URLs at `/`, `/batterylab`, `/prices`,
`/gridreplay` and `/methodology`. Unknown paths show an in-app not-found page
with a home link. The build assumes hosting at the origin root; subdirectory
hosting would require matching Vite base and router basename settings. The
Admin build serves under `/admin/` on the same origin; static hosts should
redirect `/admin` to `/admin/` (the dev server does this itself).

Configure the static host to serve `index.html` for page routes, including direct
loads and reloads. Vite development/preview already provides this fallback; production
hosting must configure it separately. Missing assets and `/api/` requests must **not**
fall back to HTML. Route only public price and simulation requests to the backend and reject other API paths. A conceptual nginx static-only configuration:

```nginx
root /srv/nemlab/public;

location ^~ /assets/ {
    try_files $uri =404;
}

location ^~ /api/v1/prices/ {
    proxy_pass http://127.0.0.1:8080;
}

location = /api/v1/simulations {
    proxy_pass http://127.0.0.1:8080;
}

location ^~ /api/v1/simulations/ {
    proxy_pass http://127.0.0.1:8080;
}

location ^~ /api/ {
    return 404;
}

location / {
    try_files $uri $uri/ /index.html;
}
```

This example is documentation, not a deployed or nginx-tested configuration; it
covers the public bundle only — the Admin deployment additionally proxies the
`/api/auth`, `/api/access` and `/api/admin` families. With SPA fallback, a direct
unknown page normally has HTTP 200 even though the app displays not-found;
server-level 404 status/SEO handling requires a later hosting decision.

The shared layout provides visible mobile navigation, active-page indicators, a
skip link, page titles and heading focus after route changes. Browser tests cover
keyboard navigation, history, direct reloads and a 320-pixel viewport; they are not
a full accessibility or cross-browser audit. No external fonts or UI framework are
required for this shell. Tailwind/shadcn remain candidates for richer form controls.

## Stored-price integration

Start the Python API with `NEMLAB_DATA_ENABLED=true` and its database settings from
[backend API setup](https://github.com/ryanzzzdev/nemlab/blob/main/api/README.md). The database must be migrated and contain
imported days to show values. The public form never imports data or triggers an
unbounded fetch directly.

Vite development **and preview** proxy `/api/v1/prices`, `/api/v1/simulations`
and `/api/v1/events` to `http://127.0.0.1:8080`; the Admin dev server proxies
`/api/admin`, `/api/auth`, `/api/access` and `/api/v1/prices`.
Set `NEMLAB_API_TARGET` in the server process to change that target. This is a Node/Vite
server setting, not a `VITE_` browser variable. Production static hosting needs the
explicit reverse-proxy rule above; the built browser uses same-origin relative URLs.
No wildcard CORS change or embedded backend address is needed.

The private openapi-fetch 0.16.0 client exposes only the public GET operations,
rejects other request paths/methods, strips caller headers, omits cookies/credentials,
rejects redirects and uses a 15-second request timeout. TanStack Query keys
results by region/day, disables automatic retries and window-focus refresh, keeps
inactive cache entries for five minutes and regards cached entries as immediately
stale. Rechecking the same day refetches it. Loading/error states hide old results.

The API response owns coverage and revision metadata. If a correction arrives between
coverage and series requests, the displayed series metadata wins. Exact decimal strings
are displayed without conversion to floating point; missing/source-null rows stay
separate. Dates and interval labels use fixed UTC+10. No result implies investment return.
Generated types are compile-time contracts; small runtime guards protect the displayed
fields, not every OpenAPI invariant.

## GridReplay

`/gridreplay` presents the published event catalogue with type/region filters,
date-scoped replay (price, demand, interconnector flow and fuel panels sharing
one cursor/window), per-event detail, Highlights selections and shareable
deep links (`?region=&from=&to=` and event parameters). Replay data is pinned to
an immutable publication, so corrected source data cannot silently alter a
saved link. Public reads are bounded and never trigger backend fetches.

## Battery scenario and simulation progress

Enable `NEMLAB_DATA_ENABLED=true` and `NEMLAB_SIMULATION_API_ENABLED=true` on the API,
and `NEMLAB_SIMULATION_ENABLED=true` on the worker, with the same migrated database.
The local Vite proxy forwards public price/simulation requests to `NEMLAB_API_TARGET`
(default `http://127.0.0.1:8080`). It adds no operator credentials.

The form sends exact decimal strings and integer five-minute boundaries in fixed UTC+10;
24:00 means next midnight. Illustrative defaults are editable and are not recommendations.
Coverage is checked before submission; the server remains authoritative if prices change.
Inputs are locked during submission/polling. Stop checking aborts browser requests only;
an accepted backend job continues. Resume checks the same ID. Automatic polling pauses
after 60 waits (Retry-After bounded to 1–30 seconds); failed network/status/result reads
leave a resume action. Requests have a 15-second timeout and never retry POST automatically.
Equivalent submissions reuse the job, including a failed job. Editing inputs clears the
displayed job/result to avoid showing a previous scenario as current.

Stored results render the strategy comparison — stat cards, financial breakdown,
interval table and four linked chart panels — and reopen via
`?simulation=<uuid>` route state.

## Linked charts

For an imported day or a stored result, the ECharts 6.1.0 module loads
on demand; failure to download it leaves the exact table available. Panels
share one cursor/x-axis window; interval selection supports keyboard with an
exact text readout; the visible-window selector zooms panels together.
Pinch/wheel gestures are deliberately not captured for chart zoom, allowing
page navigation on mobile. Interval-end labels use fixed NEM UTC+10; the final
midnight explicitly says “+1 day”. Missing prices are null plot points with
disconnected lines and explicit readout states.

Shared grids reuse one ECharts instance and x-axis window. SVG rendering makes the
288-point series inspectable; ResizeObserver handles size changes and unmounting
disposes the chart. Only line/grid/mark-line/inside-zoom/SVG modules are registered.
Native controls and the exact tables remain accessible alternatives.

Browser tests verify cursor geometries, changed zoom geometry, gaps, negative
prices, keyboard and touch selection, DST-independent labels, 320-pixel resizing,
reopening and failed chunk downloads. The real API suite also opens the chart.
Performance observations and limits live in the backend's
[chart evidence](https://github.com/ryanzzzdev/nemlab/blob/main/docs/project/evidence/frontend/chart-findings.md).

## Contract handoff

`contracts/openapi.json` and `contracts/generated/schema.d.ts` are byte-identical copies
of the backend contract. `contracts/provenance.json` records its version, backend commit
and SHA-256 hashes. These files are build inputs outside the public asset directory.
Never edit or format them manually; the backend remains the source of truth.

```sh
npm run contract:sync
npm run contract:check
# Require a backend comparison (also useful in coordinated CI):
node scripts/contract.mjs --backend
```

The sibling `../nemlab` is the default source; override with `NEMLAB_BACKEND` if needed.
Sync refuses uncommitted contract files. Review and commit backend contract changes,
run its generation/checks, then sync and review the frontend snapshot/provenance together.
Ordinary frontend checks verify hashes and compare with the backend when present. An
isolated frontend checkout/CI verifies the recorded snapshot only and reports that limit;
it cannot discover future upstream changes without a backend checkout. Admin definitions
exist in the full declaration snapshot but are excluded from the public client's type.
No operator credential or token is imported into the public bundle.

## Real-backend browser check

```sh
npm run test:live
```

This requires Docker, the sibling backend checkout (or `NEMLAB_BACKEND`), a synced
backend uv workspace, installed frontend dependencies and Playwright Chromium. It
launches the Python API/worker, creates its own PostgreSQL container on a random
loopback port, applies the backend migrations to that empty test database and seeds
clearly synthetic days. It verifies real API/proxy/browser behaviour for complete,
incomplete and absent days, plus simulation submission, worker execution, result
retrieval and deduplication on desktop/mobile. It does not use `.env`, a persistent
database or OE. The API/worker processes and container are cleaned up on success or
failure. SQL application here is fixture setup; backend tests remain responsible for
migration behaviour.

`npm run check`/frontend CI use intercepted browser fixtures and need no
backend/database. The real integration suite is an explicit local/coordinated check.
Screenshots are in ignored `test-results/`.
