import type { components } from "../../../contracts/generated/schema";

export type SessionView = components["schemas"]["SessionView"];
export type Region = components["schemas"]["Region"];
export type GridCoverage = components["schemas"]["GridCoverage"];
export type GridCoverageDay = components["schemas"]["GridCoverageDay"];
export type GridBaselineReadiness = components["schemas"]["GridBaselineReadiness"];
export type AdminGridPublication = components["schemas"]["AdminGridPublication"];
export type GridPublicationDetail = components["schemas"]["GridPublicationDetail"];
export type GridDetectionAttempt = components["schemas"]["GridDetectionAttempt"];
export type Job = components["schemas"]["Job"];
export type GridImport = components["schemas"]["GridImport"];
export type Event = components["schemas"]["Event"];
export type LoadOperation = components["schemas"]["LoadOperation"];
export type LoadOperationDetail = components["schemas"]["LoadOperationDetail"];
export type LoadOperationChild = components["schemas"]["LoadOperationChild"];
export type LoadDispatchOutcome = components["schemas"]["LoadDispatchOutcome"];
export type BeginLoadOperation = components["schemas"]["BeginLoadOperation"];
export type GridPublicationSubmission = components["schemas"]["GridPublicationSubmission"];

export const REGIONS: Region[] = ["NSW1", "QLD1", "SA1", "TAS1", "VIC1"];

/** Public-app origin for cross-bundle links. Production serves both
 * bundles on one origin so links are relative; in dev each Vite server
 * has its own port, so links to the public app need the absolute dev
 * origin. */
export const PUBLIC_BASE = import.meta.env.DEV ? "http://127.0.0.1:5173" : "";

/** Carries the API code so pages can distinguish "sign in again",
 * "no permission", "unavailable" and plain failures. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    throw new ApiError(401, "UNAUTHORISED", "Your session has ended.");
  }
  if (!response.ok) {
    const body = await response
      .clone()
      .json()
      .catch(() => null);
    const code = typeof body?.code === "string" ? body.code : "ERROR";
    const message =
      typeof body?.message === "string" && body.message.length < 200
        ? body.message
        : `Request failed (HTTP ${response.status}).`;
    throw new ApiError(response.status, code, message);
  }
  const content = await response.json().catch(() => null);
  if (content === null) {
    throw new ApiError(response.status, "BAD_RESPONSE", "Unexpected response.");
  }
  return content as T;
}

export function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return fetch(path, {
    headers: { Accept: "application/json" },
    signal: signal ?? null,
  }).then((response) => parse<T>(response));
}

/** Cookie-authenticated mutation — the backend requires the session CSRF
 * token; the browser already sends same-origin Origin/Referer on POST. */
export function apiPost<T>(
  path: string,
  csrfToken?: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T | null> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  if (csrfToken) headers["x-csrf-token"] = csrfToken;
  return fetch(path, {
    method: "POST",
    headers,
    body: body === undefined ? "" : JSON.stringify(body),
  }).then((response) => (response.status === 204 ? null : parse<T>(response)));
}

/** `null` means no active session — a normal state, not a failure, so
 * consumers never see stale session data after a 401. */
export async function getSession(signal?: AbortSignal): Promise<SessionView | null> {
  try {
    return await apiGet<SessionView>("/api/auth/v1/session", signal);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export type ApplicantStatus = components["schemas"]["ApplicantStatus"];
export type SignInAccepted = components["schemas"]["SignInAccepted"];

/** Anonymous auth endpoints carry no CSRF (no session exists yet) and are
 * deliberately generic — the response never reveals account existence. */
export function requestAccess(body: {
  displayName: string;
  email: string;
  message: string;
}): Promise<SignInAccepted | null> {
  return apiPost<SignInAccepted>("/api/access/v1/requests", undefined, body);
}

export function requestSignInLink(email: string): Promise<SignInAccepted | null> {
  return apiPost<SignInAccepted>("/api/auth/v1/sign-in-requests", undefined, {
    email,
  });
}

export function exchangeSignInToken(token: string): Promise<SessionView | null> {
  return apiPost<SessionView>("/api/auth/v1/sessions", undefined, { token });
}

export function verifyAccessRequest(token: string): Promise<SessionView | null> {
  return apiPost<SessionView>("/api/access/v1/verifications", undefined, {
    token,
  });
}

export function applicantStatus(signal?: AbortSignal): Promise<ApplicantStatus> {
  return apiGet<ApplicantStatus>("/api/access/v1/requests/status", signal);
}

export function resendVerification(csrfToken: string) {
  return apiPost("/api/access/v1/requests/resend", csrfToken);
}

/** Owner data-loading mutations — all capability-gated `ops.write` server-
 * side; the UI hides them from viewers but the boundary is the API. */
export function beginLoadOperation(
  csrfToken: string,
  body: BeginLoadOperation,
): Promise<LoadOperation | null> {
  return apiPost<LoadOperation>("/api/admin/v1/load-operations", csrfToken, body);
}

export function dispatchLoadOperation(
  csrfToken: string,
  id: string,
): Promise<LoadDispatchOutcome | null> {
  return apiPost<LoadDispatchOutcome>(`/api/admin/v1/load-operations/${id}/dispatch`, csrfToken);
}

export function pauseLoadOperation(csrfToken: string, id: string): Promise<LoadOperation | null> {
  return apiPost<LoadOperation>(`/api/admin/v1/load-operations/${id}/pause`, csrfToken);
}

export function resumeLoadOperation(csrfToken: string, id: string): Promise<LoadOperation | null> {
  return apiPost<LoadOperation>(`/api/admin/v1/load-operations/${id}/resume`, csrfToken);
}

export function submitGridImport(
  csrfToken: string,
  idempotencyKey: string,
  body: { region: Region; startDay: string; endExclusive: string },
): Promise<GridImport | null> {
  return apiPost<GridImport>("/api/admin/v1/grid-imports", csrfToken, body, {
    "Idempotency-Key": idempotencyKey,
  });
}

export function cancelGridImport(csrfToken: string, id: string): Promise<GridImport | null> {
  return apiPost<GridImport>(`/api/admin/v1/grid-imports/${id}/cancel`, csrfToken);
}

export function publishGrid(
  csrfToken: string,
  body: GridPublicationSubmission,
): Promise<AdminGridPublication | null> {
  return apiPost<AdminGridPublication>("/api/admin/v1/grid-publications", csrfToken, body);
}

export type PriceCoverage = components["schemas"]["Coverage"];
export type PriceCoverageDay = components["schemas"]["DayCoverage"];

/** Shared public price-coverage read — same bounded projection the BatteryLab
 * day picker consumes; Admin renders it alongside grid metrics. */
export function getPriceCoverage(
  region: Region,
  start: string,
  endExclusive: string,
  signal?: AbortSignal,
): Promise<PriceCoverage> {
  return apiGet<PriceCoverage>(
    `/api/v1/prices/${region}/coverage?start=${start}&endExclusive=${endExclusive}`,
    signal,
  );
}

/** Owner-only price re-fetch for one market day — idempotent; a replayed
 * submission returns the existing job rather than duplicating work. */
export function submitPriceRefresh(
  csrfToken: string,
  region: Region,
  day: string,
): Promise<Job | null> {
  return apiPost<Job>("/api/admin/v1/price-refreshes", csrfToken, { region, day });
}

export type AdminSimulationSummary = components["schemas"]["AdminSimulationSummary"];
export type AdminSimulationPage = components["schemas"]["AdminSimulationPage"];
export type AdminSimulationDetail = components["schemas"]["AdminSimulationDetail"];
export type AdminSimulationEvent = components["schemas"]["AdminSimulationEvent"];
export type SimulationStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
export type SimulationStrategy = "fixed" | "threshold" | "hindsight";
export type SimulationSort = "newest" | "oldest";

/** Scoped simulation catalogue — `ops.read`, viewer-safe. `cursor` continues
 * a page; INVALID_CURSOR/INVALID_SCOPE surface as recoverable ApiErrors. */
export function listSimulations(
  scope: { region: Region; startDay: string; endDay: string },
  filters: {
    status?: SimulationStatus;
    strategy?: SimulationStrategy;
    sort?: SimulationSort;
    limit?: number;
    cursor?: string;
  } = {},
  signal?: AbortSignal,
): Promise<AdminSimulationPage> {
  const params = new URLSearchParams({
    region: scope.region,
    startDay: scope.startDay,
    endDay: scope.endDay,
  });
  if (filters.status) params.set("status", filters.status);
  if (filters.strategy) params.set("strategy", filters.strategy);
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  if (filters.cursor) params.set("cursor", filters.cursor);
  return apiGet<AdminSimulationPage>(`/api/admin/v1/simulations?${params}`, signal);
}

/** Stored-scenario inspector — verbatim request document, result summary,
 * lifecycle events and pinned-vs-current revision provenance. */
export function getSimulation(id: string, signal?: AbortSignal): Promise<AdminSimulationDetail> {
  return apiGet<AdminSimulationDetail>(`/api/admin/v1/simulations/${id}`, signal);
}

export type AccessRequestView = components["schemas"]["AccessRequestView"];
export type AccessRequestDetail = components["schemas"]["AccessRequestDetail"];
export type DeliveryView = components["schemas"]["DeliveryView"];
export type ViewerGrantView = components["schemas"]["ViewerGrantView"];
export type AccessAuditView = components["schemas"]["AccessAuditView"];
export type GrantState = "active" | "expired" | "revoked";
export type GrantDays = 7 | 30 | 90;

/** Pending request queue — owner only (`access.manage`). */
export function listAccessRequests(signal?: AbortSignal): Promise<AccessRequestView[]> {
  return apiGet<AccessRequestView[]>("/api/admin/v1/access-requests", signal);
}

/** Recent access-audit rows — owner only, newest first. */
export function listAccessAudit(limit = 100, signal?: AbortSignal): Promise<AccessAuditView[]> {
  return apiGet<AccessAuditView[]>(`/api/admin/v1/access-audit?limit=${limit}`, signal);
}

/** Owner-only access management (`access.manage` capability). Sensitive
 * mutations additionally demand a recent sign-in server-side —
 * `RECENT_AUTH_REQUIRED` is a normal outcome the UI surfaces, never a
 * reason to silently replay the request. */
export function decideAccessRequest(
  csrfToken: string,
  id: string,
  body: { decision: "approve" | "reject"; days?: GrantDays | undefined; version: number },
): Promise<AccessRequestView | null> {
  return apiPost<AccessRequestView>(
    `/api/admin/v1/access-requests/${id}/decisions`,
    csrfToken,
    body,
  );
}

export function resendAccessDelivery(csrfToken: string, id: string) {
  return apiPost(`/api/admin/v1/access-requests/${id}/resend`, csrfToken);
}

export function extendViewerGrant(
  csrfToken: string,
  id: string,
  days: GrantDays,
): Promise<ViewerGrantView | null> {
  return apiPost<ViewerGrantView>(`/api/admin/v1/viewer-grants/${id}/extend`, csrfToken, {
    days,
  });
}

export function revokeViewerGrant(
  csrfToken: string,
  id: string,
  reason: string | null,
): Promise<ViewerGrantView | null> {
  return apiPost<ViewerGrantView>(`/api/admin/v1/viewer-grants/${id}/revoke`, csrfToken, {
    reason,
  });
}

/** NEM market days run UTC+10 — same helper convention as the public app. */
export function marketDay(now = new Date()): string {
  return new Date(now.getTime() + 10 * 3600000).toISOString().slice(0, 10);
}

export function plusDays(day: string, offset: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
}
