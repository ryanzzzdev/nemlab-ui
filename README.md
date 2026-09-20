# NEMLab frontend

The public React application for BatteryLab and GridReplay. This is a separate Git
repository from `../nemlab`, the Java API/worker backend. The current application has public navigation, feature descriptions and methodology.
BatteryLab can read stored price days; simulation and replay workflows are not implemented yet.

## Local setup

Use Node.js 22.23.1 (`nvm use` reads `.nvmrc`) and npm 10.9.8. From this repository:

```sh
npm ci --ignore-scripts
npm run dev
```

Open <http://127.0.0.1:5173>. The shell starts without a backend. Price reads require the API configuration below;
OE and operator credentials never belong in this frontend. The development server binds to loopback and fails if its port is
already occupied.

```sh
npx --no-install playwright install chromium
npm run check
```

On a Linux host missing browser system libraries, use
`npx --no-install playwright install --with-deps chromium` once; it may require
administrator permissions. `check` verifies formatting, strict TypeScript, the
production bundle and Chromium startup at desktop/mobile widths. CI runs these same
checks. No hosted CI run is implied by the workflow file.

`npm run format` applies Prettier. `npm run build` produces `apps/public/dist/`;
`npm run preview` serves that output at <http://127.0.0.1:4173> for local inspection.
Build before preview or `test:browser`. Preview is not a production server.
Playwright owns its preview process and refuses to reuse another process on port 4173.
Browser screenshots/traces live in ignored `test-results/`.

## Layout and boundaries

- `apps/public/`: the public browser application, built as static assets.
- `tests/`: browser checks against the built output.
- Root tooling, lockfile and CI: shared by applications in this npm workspace.

An eventual `apps/admin/` will be a separate build and deployment within this Git
repository. No empty Admin application or shared package is created now. Extract
shared components only when both applications need them. Vite environment variables
are public; never place OE credentials or operator tokens in this repository.

The initial stack is React 19.3.0, Vite 8.3.0, React plugin 6.1.1 and TypeScript 5.9.3.
Prettier 3.9.8 enforces formatting and Playwright 1.63.0 checks browser startup.
Exact dependencies and the lockfile are committed together when a commit is requested.
React Router 8.4.0 provides navigation; plain CSS styles the current shell. Forms, query
caching and charts will be added with their first verified slice.

## Project records

Read [AGENTS.md](AGENTS.md) and the backend's canonical documents:

- [Roadmap](../nemlab/docs/project/roadmap.md)
- [Tasks](../nemlab/docs/project/backlog.md#nem-015)
- [Documentation guide](../nemlab/docs/project/documentation-guide.md)
- [API contract](../nemlab/api/contracts/README.md)

These relative links assume sibling checkouts called `nemlab` and `nemlab-ui`. This
repository builds independently of the backend. The imported contract snapshot and its provenance are described below.

## Routes and static hosting

The public app uses browser-history URLs at `/`, `/batterylab`, `/gridreplay` and
`/methodology`. Unknown paths show an in-app not-found page with a home link. The
current build assumes hosting at the origin root; subdirectory hosting would require
matching Vite base and router basename settings.

Configure the static host to serve `index.html` for page routes, including direct
loads and reloads. Vite development/preview already provides this fallback; production
hosting must configure it separately. Missing assets and `/api/` requests must **not**
fall back to HTML. Route only public price requests to the backend and reject other API paths. A conceptual nginx static-only configuration:

```nginx
root /srv/nemlab/public;

location ^~ /assets/ {
    try_files $uri =404;
}

location ^~ /api/v1/prices/ {
    proxy_pass http://127.0.0.1:8080;
}

location ^~ /api/ {
    return 404;
}

location / {
    try_files $uri $uri/ /index.html;
}
```

This example is documentation, not a deployed or nginx-tested configuration. With
SPA fallback, a direct unknown page normally has HTTP 200 even though the app displays
not-found; server-level 404 status/SEO handling requires a later hosting decision.

The shared layout provides visible mobile navigation, active-page indicators, a
skip link, page titles and heading focus after route changes. Browser tests cover
keyboard navigation, history, direct reloads and a 320-pixel viewport; they are not
a full accessibility or cross-browser audit. No external fonts or UI framework are
required for this shell. Tailwind/shadcn remain candidates for richer form controls.

## Stored-price integration

Start the Java API with `NEMLAB_DATA_ENABLED=true` and its database settings from
[backend API setup](../nemlab/api/README.md). The database must be migrated and contain
imported days to show values. Keep `NEMLAB_ADMIN_ENABLED=false` for this public slice.
The public form never imports data or runs a simulation.

Vite development **and preview** proxy `/api/v1/prices` to `http://127.0.0.1:8080`.
Set `NEMLAB_API_TARGET` in the server process to change that target. This is a Node/Vite
server setting, not a `VITE_` browser variable. Production static hosting needs the
explicit reverse-proxy rule above; the built browser uses same-origin relative URLs.
No wildcard CORS change or embedded backend address is needed.

The private openapi-fetch 0.16.0 client exposes only the two public GET operations,
rejects other request paths/methods, strips caller headers, omits cookies/credentials,
rejects redirects and uses a 15-second request timeout. TanStack Query 5.103.1 keys
results by region/day, disables automatic retries and window-focus refresh, keeps
inactive cache entries for five minutes and regards cached entries as immediately
stale. Rechecking the same day refetches it. Loading/error states hide old results.

The API response owns coverage and revision metadata. If a correction arrives between
coverage and series requests, the displayed series metadata wins. Exact decimal strings
are displayed without conversion to floating point; missing/source-null rows stay
separate. Dates and interval labels use fixed UTC+10. No result implies investment return.
Generated types are compile-time contracts; small runtime guards protect the displayed
fields, not every OpenAPI invariant.

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
No runtime Admin client or credentials are imported.

## Real-backend browser check

```sh
export JAVA_HOME=/path/to/jdk-25
npm run test:live
```

This requires Docker, the sibling backend (or `NEMLAB_BACKEND`), cached Java dependencies,
installed frontend dependencies and Playwright Chromium. It builds the API jar and public
bundle, creates its own PostgreSQL 18.6 container on a random loopback port, applies the
backend SQL migrations to that empty test database and seeds clearly synthetic days.
It then verifies real API/proxy/browser behaviour for complete, incomplete and absent days
on desktop/mobile. It does not use `.env`, a persistent database or OE. The API process
and container are cleaned up on success or failure. SQL application here is fixture setup;
backend tests remain responsible for Flyway migration behaviour.

`npm run check`/frontend CI use intercepted browser fixtures and need no Java/database.
The real integration suite is an explicit local/coordinated check, not a claim of a hosted
cross-repository CI run. Screenshots are in ignored `test-results/`.

## Linked-chart prototype

For an imported day, choose **Show chart prototype**. The ECharts 6.1.0 module loads
on demand; failure to download it leaves the exact table available. The top panel
plots stored prices (approximate numbers for drawing only); the bottom is a clearly
labelled synthetic 0–100% triangular energy trace, independent of prices. It tests
interaction and is not a battery result or observed energy data.

Point or tap either panel to move both cursors. The interval slider supports keyboard
selection with an exact text readout. The visible-window selector zooms both panels
together to a full day or six-hour block. Pinch/wheel gestures are deliberately not
captured for chart zoom, allowing page navigation on mobile. Interval-end labels use
fixed NEM UTC+10; the final midnight explicitly says “+1 day”. Missing prices are
null plot points with disconnected lines and explicit readout states.

The two grids share one ECharts instance and x-axis window. SVG rendering makes the
288-point prototype inspectable; ResizeObserver handles size changes and unmounting
disposes the chart. Only line/grid/mark-line/inside-zoom/SVG modules are registered.
Native controls and the existing exact table remain accessible alternatives.

Browser tests verify both cursor geometries, changed zoom geometry, gaps, negative
prices, keyboard and touch selection, DST-independent labels, 320-pixel resizing,
reopening and failed chunk downloads. The real API suite also opens the chart.
Performance observations and limits live in the backend's
[chart evidence](../nemlab/docs/project/evidence/frontend/chart-findings.md).
