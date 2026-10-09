import type { Page, Route } from "@playwright/test";

// Self-contained Admin API fixtures — labelled test data exercising the
// workspace states (complete/partial/missing, dispatching/failed, current
// pointer, pending request, active grant, audit labels). No backend needed:
// every /api/** call is intercepted.

export const OWNER_SESSION = {
  role: "owner",
  name: "Test Owner",
  expiresAt: new Date(Date.now() + 8 * 3600_000).toISOString(),
  csrfToken: "csrf-test",
};

export const VIEWER_SESSION = {
  role: "viewer",
  name: "Test Viewer",
  expiresAt: new Date(Date.now() + 8 * 3600_000).toISOString(),
  csrfToken: "csrf-test",
};

const SERIES = (metric: string, series: string, availability: string, valid: number | null) => ({
  metric,
  series,
  availability,
  revision: "rev-1",
  retrievedAt: availability === "COMPLETE" ? "2023-10-15T04:12:00Z" : null,
  valid,
  missing: null,
  sourceNull: null,
});

export const COVERAGE = {
  region: "NSW1",
  start: "2023-09-01",
  endExclusive: "2023-09-04",
  marketOffset: "+10:00",
  days: [
    {
      day: "2023-09-01",
      availability: "COMPLETE",
      series: [
        SERIES("demand", "", "COMPLETE", 288),
        SERIES("flow_imports", "", "COMPLETE", 288),
        SERIES("flow_exports", "", "COMPLETE", 288),
        SERIES("power", "coal_black", "COMPLETE", 288),
      ],
    },
    {
      day: "2023-09-02",
      availability: "PARTIAL",
      series: [
        SERIES("demand", "", "COMPLETE", 288),
        SERIES("flow_imports", "", "PARTIAL", 120),
        SERIES("flow_exports", "", "NOT_IMPORTED", null),
      ],
    },
    {
      day: "2023-09-03",
      availability: "NOT_IMPORTED",
      series: [SERIES("demand", "", "NOT_IMPORTED", null)],
    },
  ],
};

export const BASELINE = {
  region: "NSW1",
  candidateStart: "2023-09-01",
  candidateEndExclusive: "2023-09-04",
  baselineDays: 90,
  minCompleteDays: 60,
  minClassDays: 20,
  days: [
    { day: "2023-09-01", completeDays: 60, classDays: 20, ready: true },
    { day: "2023-09-02", completeDays: 13, classDays: 9, ready: false },
    { day: "2023-09-03", completeDays: 0, classDays: 0, ready: false },
  ],
};

export const OPERATION = {
  id: "op-1",
  region: "NSW1",
  startDay: "2023-09-01",
  endExclusive: "2023-09-06",
  nextDay: "2023-09-01",
  status: "dispatching",
  phase: "grid",
  actor: "owner",
  createdAt: "2023-10-15T04:00:00Z",
  updatedAt: "2023-10-15T04:01:00Z",
};

export const OPERATION_DETAIL = {
  ...OPERATION,
  children: [
    {
      phase: "grid",
      requestKey: "load:op-1:0",
      startDay: "2023-09-01",
      endExclusive: "2023-09-06",
      submittedAt: "2023-10-15T04:01:00Z",
      jobs: [
        {
          id: "job-in-op",
          region: "NSW1",
          day: "2023-09-01",
          status: "SUCCEEDED",
          attempts: 1,
          availableAt: null,
          diagnostic: null,
        },
      ],
    },
  ],
};

export const IMPORTS = [
  {
    id: "imp-ok",
    region: "NSW1",
    startDay: "2023-09-01",
    endExclusive: "2023-09-04",
    nextDay: "2023-09-04",
    status: "SUCCEEDED",
    attempts: 1,
    optionalFailures: [],
    availableAt: null,
    diagnostic: null,
  },
  {
    id: "imp-fail",
    region: "SA1",
    startDay: "2023-08-01",
    endExclusive: "2023-08-02",
    nextDay: "2023-08-01",
    status: "FAILED",
    attempts: 2,
    optionalFailures: [],
    availableAt: null,
    diagnostic: "source timeout",
  },
];

export const REFRESHES = [
  {
    id: "job-refresh",
    region: "NSW1",
    day: "2023-09-03",
    status: "QUEUED",
    attempts: 0,
    availableAt: null,
    diagnostic: null,
  },
];

export const PUBLICATIONS = [
  {
    id: "pub-2",
    region: "NSW1",
    startDay: "2023-09-01",
    endExclusive: "2023-09-06",
    detectorVersion: "v2",
    eventCount: 14,
    coverage: { evaluated: 5, complete: 5 },
    createdAt: "2023-10-15T05:00:00Z",
    runId: "run-2",
    actor: "owner",
    attemptKey: "admin-ui:key-2",
  },
  {
    id: "pub-1",
    region: "NSW1",
    startDay: "2023-09-01",
    endExclusive: "2023-09-06",
    detectorVersion: "v1",
    eventCount: 11,
    coverage: { evaluated: 5, complete: 5 },
    createdAt: "2023-10-14T05:00:00Z",
    runId: "run-1",
    actor: "owner",
    attemptKey: null,
  },
];

export const PUBLICATION_DETAIL = {
  ...PUBLICATIONS[0],
  eventCounts: { demand_ramp: 5, negative_price_run: 7, price_spike: 2 },
  highlights: { version: "highlights-v2", matching: 14, selected: 8, eligible: 14, excluded: 0 },
};

export const ATTEMPTS = [
  {
    id: "att-1",
    region: "NSW1",
    startDay: "2023-09-01",
    endExclusive: "2023-09-06",
    detectorVersion: "v2",
    status: "COMPLETE",
    publicationId: "pub-2",
    diagnostic: null,
    actor: "owner",
    attemptKey: "admin-ui:key-2",
    createdAt: "2023-10-15T05:00:00Z",
  },
];

export const PRICE_COVERAGE = {
  region: "NSW1",
  start: "2023-09-01",
  endExclusive: "2023-09-04",
  marketOffset: "+10:00",
  days: [
    {
      day: "2023-09-01",
      availability: "COMPLETE",
      revision: "aaaaaaaa-0000-4000-8000-000000000001",
      retrievedAt: "2023-10-15T04:12:00Z",
      valid: 288,
      missing: 0,
      sourceNull: 0,
    },
    {
      day: "2023-09-02",
      availability: "INCOMPLETE",
      revision: "bbbbbbbb-0000-4000-8000-000000000002",
      retrievedAt: "2023-10-15T04:13:00Z",
      valid: 200,
      missing: 88,
      sourceNull: 0,
    },
    {
      day: "2023-09-03",
      availability: "NOT_IMPORTED",
      revision: null,
      retrievedAt: null,
      valid: null,
      missing: null,
      sourceNull: null,
    },
  ],
};

export const SIMULATIONS_PAGE = {
  rows: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      status: "SUCCEEDED",
      region: "NSW1",
      day: "2023-09-01",
      createdAt: "2023-10-15T04:00:00Z",
      finishedAt: "2023-10-15T04:00:09Z",
      capacityMWh: "2",
      chargeMW: "1",
      dischargeMW: "1",
      strategies: ["fixed", "threshold", "hindsight"],
      attempts: 1,
      hasResult: true,
      diagnostic: null,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      status: "RUNNING",
      region: "NSW1",
      day: "2023-09-02",
      createdAt: "2023-10-15T04:10:00Z",
      finishedAt: null,
      capacityMWh: "4",
      chargeMW: "2",
      dischargeMW: "2",
      strategies: ["fixed", "hindsight"],
      attempts: 1,
      hasResult: false,
      diagnostic: null,
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      status: "FAILED",
      region: "NSW1",
      day: "2023-09-03",
      createdAt: "2023-10-15T04:20:00Z",
      finishedAt: "2023-10-15T04:30:00Z",
      capacityMWh: "2",
      chargeMW: "1",
      dischargeMW: "1",
      strategies: ["fixed", "hindsight"],
      attempts: 3,
      hasResult: false,
      diagnostic: "solver timeout",
    },
  ],
  counts: { QUEUED: 0, RUNNING: 1, SUCCEEDED: 1, FAILED: 1 },
  total: 3,
  nextCursor: null,
  asOf: "2023-10-15T05:00:00Z",
};

export const SIMULATION_DETAIL = {
  simulation: SIMULATIONS_PAGE.rows[0],
  scenario: {
    request: {
      region: "NSW1",
      day: "2023-09-01",
      site: {
        capacityMWh: "2",
        minimumMWh: "0",
        maximumMWh: "2",
        initialMWh: "0",
        chargeMW: "1",
        dischargeMW: "1",
        importLimitMW: "1",
        exportLimitMW: "1",
      },
      efficiency: { roundTrip: "0.9" },
      costs: { importFee: "0", exportFee: "0", degradationPerExportedMWh: "0" },
      windows: { chargeStart: 60, chargeEnd: 600, dischargeStart: 960, dischargeEnd: 1440 },
      thresholds: { chargeBelow: "50", dischargeAbove: "300" },
    },
    versions: {
      request: "simulation-request-v1",
      model: "battery-model-v1",
      fixed: "fixed-windows-v1",
      hindsight: "ordered-hindsight-v1",
      solver: "scipy-highs",
      executionProfile: "ordered-comparison-v1",
      limits: { intervalsPerDay: 288 },
    },
  },
  result: {
    accounting: {
      fixed: {
        importedMWh: 2.05,
        exportedMWh: 1.84,
        chargingCost: 41.2,
        revenue: 552.1,
        fees: 0,
        degradation: 0,
        margin: 510.9,
        lossesMWh: 0.21,
      },
      hindsight: {
        importedMWh: 2.11,
        exportedMWh: 1.9,
        chargingCost: 38.4,
        revenue: 612.0,
        fees: 0,
        degradation: 0,
        margin: 573.6,
        lossesMWh: 0.21,
      },
    },
    solver: { status: "OPTIMAL", objective: 573.6, upperBound: 573.6, absoluteGap: 0 },
    createdAt: "2023-10-15T04:00:09Z",
  },
  execution: {
    status: "SUCCEEDED",
    attempts: 1,
    availableAt: "2023-10-15T04:00:00Z",
    diagnostic: null,
    createdAt: "2023-10-15T04:00:00Z",
    finishedAt: "2023-10-15T04:00:09Z",
  },
  lifecycle: {
    recorded: true,
    events: [
      {
        kind: "QUEUED",
        attempt: null,
        diagnostic: null,
        availableAt: null,
        createdAt: "2023-10-15T04:00:00Z",
        attemptMs: null,
      },
      {
        kind: "CLAIMED",
        attempt: 1,
        diagnostic: null,
        availableAt: null,
        createdAt: "2023-10-15T04:00:01Z",
        attemptMs: 8123,
      },
      {
        kind: "SUCCEEDED",
        attempt: 1,
        diagnostic: null,
        availableAt: null,
        createdAt: "2023-10-15T04:00:09Z",
        attemptMs: 8123,
      },
    ],
  },
  provenance: {
    pinnedRevision: "aaaaaaaa-0000-4000-8000-000000000001",
    currentRevision: "aaaaaaaa-0000-4000-8000-000000000001",
    comparison: "matches",
    checkedAt: "2023-10-15T05:00:00Z",
  },
};

export const SIMULATION_DETAIL_NO_HISTORY = {
  ...SIMULATION_DETAIL,
  simulation: SIMULATIONS_PAGE.rows[2],
  scenario: {
    ...SIMULATION_DETAIL.scenario,
    request: { ...SIMULATION_DETAIL.scenario.request, day: "2023-09-03", thresholds: null },
  },
  result: null,
  execution: {
    status: "FAILED",
    attempts: 3,
    availableAt: "2023-10-15T04:20:00Z",
    diagnostic: "solver timeout",
    createdAt: "2023-10-15T04:20:00Z",
    finishedAt: "2023-10-15T04:30:00Z",
  },
  lifecycle: { recorded: false, events: [] },
};

export const REQUEST = {
  id: "req-1",
  name: "Fixture Applicant",
  email: "applicant@example.test",
  message: null,
  status: "pending",
  submittedAt: "2023-10-15T03:00:00Z",
  verifiedAt: "2023-10-15T03:05:00Z",
  decidedAt: null,
  version: 1,
};

export const REQUEST_DETAIL = {
  ...REQUEST,
  message: "Research access for a class project.",
  deliveries: [
    {
      kind: "request_verification",
      status: "sent",
      attempts: 1,
      sentAt: "2023-10-15T03:01:00Z",
      diagnostic: null,
      createdAt: "2023-10-15T03:00:00Z",
    },
  ],
};

export const GRANTS = {
  active: [
    {
      id: "grant-1",
      requestId: "req-0",
      userId: "user-1",
      email: "visitor@example.test",
      state: "active",
      grantedAt: "2023-10-10T03:00:00Z",
      expiresAt: "2023-11-09T03:00:00Z",
      revokedAt: null,
    },
  ],
  expired: [],
  revoked: [],
};

export const AUDIT = [
  {
    occurredAt: "2023-10-15T05:10:00Z",
    actor: "owner",
    action: "SESSION_STARTED",
    subject: "user:owner-1",
    result: "applied",
  },
  {
    occurredAt: "2023-10-15T03:30:00Z",
    actor: "owner",
    action: "GRANT_CREATED",
    subject: "grant:grant-1",
    result: "applied",
  },
  {
    occurredAt: "2023-10-15T03:20:00Z",
    actor: "applicant",
    action: "REQUEST_VERIFIED",
    subject: "request:req-1",
    result: "applied",
  },
];

export interface ApiCalls {
  mutations: string[];
}

/** Intercepts every /api/** request with the fixtures above. `role` picks the
 * session identity; mutation calls are recorded on `calls` for assertions. */
export async function installApiMock(
  page: Page,
  role: "owner" | "viewer" | "anonymous" = "owner",
  calls: ApiCalls = { mutations: [] },
): Promise<ApiCalls> {
  const session = role === "anonymous" ? null : role === "owner" ? OWNER_SESSION : VIEWER_SESSION;
  await page.route("**/api/**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (method !== "GET") calls.mutations.push(`${method} ${path}`);

    // Auth
    if (path === "/api/auth/v1/session" && method === "GET") {
      return session
        ? json(session)
        : route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
    }
    if (path === "/api/auth/v1/logout") return route.fulfill({ status: 204 });

    // DataOps reads — the baseline route is a grid-coverage subpath, so it
    // must be matched before the generic prefix.
    if (path.includes("/grid-coverage/") && path.endsWith("/baseline")) return json(BASELINE);
    if (path.startsWith("/api/admin/v1/grid-coverage/")) return json(COVERAGE);
    if (path === "/api/admin/v1/load-operations" && method === "GET") return json([OPERATION]);
    if (path === "/api/admin/v1/load-operations/op-1") return json(OPERATION_DETAIL);
    if (path === "/api/admin/v1/grid-imports" && method === "GET") return json(IMPORTS);
    if (path === "/api/admin/v1/price-refreshes" && method === "GET") return json(REFRESHES);
    if (path === "/api/admin/v1/grid-publications" && method === "GET") return json(PUBLICATIONS);
    if (path === "/api/admin/v1/grid-publications/attempts") return json(ATTEMPTS);
    if (path.startsWith("/api/admin/v1/grid-publications/")) return json(PUBLICATION_DETAIL);

    // Shared public price coverage — the same bounded projection BatteryLab
    // reads; Admin renders it alongside the grid matrix.
    if (path.match(/^\/api\/v1\/prices\/[^/]+\/coverage$/) && method === "GET") {
      // Like the grid-coverage fixture, the applied scope is test-agnostic —
      // always return the fixture days.
      return json(PRICE_COVERAGE);
    }

    // Simulation catalogue — the list honours scope/status/strategy filters
    // so the UI's URL state is exercised end to end.
    if (path === "/api/admin/v1/simulations" && method === "GET") {
      const status = url.searchParams.get("status");
      const strategy = url.searchParams.get("strategy");
      const startDay = url.searchParams.get("startDay") ?? "";
      const endDay = url.searchParams.get("endDay") ?? "";
      // Same-day scopes are inspector lookups — honour them; the wide applied
      // scope is test-agnostic so broad listings keep all fixture rows.
      const sameDay = startDay === endDay ? startDay : null;
      const rows = SIMULATIONS_PAGE.rows.filter(
        (r) =>
          (!sameDay || r.day === sameDay) &&
          (!status || r.status === status) &&
          (!strategy || r.strategies.includes(strategy)),
      );
      return json({ ...SIMULATIONS_PAGE, rows, total: rows.length });
    }
    if (path === `/api/admin/v1/simulations/${SIMULATIONS_PAGE.rows[0]!.id}`)
      return json(SIMULATION_DETAIL);
    if (path === `/api/admin/v1/simulations/${SIMULATIONS_PAGE.rows[2]!.id}`)
      return json(SIMULATION_DETAIL_NO_HISTORY);

    // Access reads
    if (path === "/api/admin/v1/access-requests" && method === "GET") return json([REQUEST]);
    if (path === "/api/admin/v1/access-requests/req-1" && method === "GET")
      return json(REQUEST_DETAIL);
    if (path.startsWith("/api/admin/v1/viewer-grants")) {
      const state = url.searchParams.get("state") ?? "active";
      return json(GRANTS[state as keyof typeof GRANTS] ?? []);
    }
    if (path === "/api/admin/v1/access-audit") return json(AUDIT);

    // Owner mutations — success fixtures; failure paths asserted separately.
    if (path === "/api/admin/v1/price-refreshes" && method === "POST")
      return json(REFRESHES[0], 202);
    if (path === "/api/admin/v1/load-operations" && method === "POST") return json(OPERATION);
    if (path.endsWith("/dispatch")) return json({ outcome: "child", child: null });
    if (path.endsWith("/pause") || path.endsWith("/resume"))
      return json({ ...OPERATION, status: path.endsWith("/pause") ? "paused" : "dispatching" });
    if (path === "/api/admin/v1/grid-publications" && method === "POST")
      return json(PUBLICATIONS[0]);
    if (path === "/api/admin/v1/access-requests/req-1/decisions")
      return json({ ...REQUEST, status: "approved", decidedAt: "2023-10-15T06:00:00Z" });
    if (path === "/api/admin/v1/access-requests/req-1/resend")
      return route.fulfill({ status: 204 });
    if (path.endsWith("/extend")) return json(GRANTS.active[0]);
    if (path.endsWith("/revoke"))
      return json({ ...GRANTS.active[0], state: "revoked", revokedAt: "2023-10-15T06:00:00Z" });

    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  return calls;
}

export async function ownerPage(page: Page) {
  await installApiMock(page, "owner");
  await page.goto("/admin/");
  await mainGrid(page).locator("tbody tr").first().waitFor();
}

export async function viewerPage(page: Page) {
  await installApiMock(page, "viewer");
  await page.goto("/admin/");
  await mainGrid(page).locator("tbody tr").first().waitFor();
}

/** The workspace DataTable — `.table-wrap` excludes the activity-pane and
 * inspector-side tables that share the `.grid` class. */
export function mainGrid(page: Page) {
  return page.locator(".table-wrap table.grid");
}
