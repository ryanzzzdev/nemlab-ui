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

export const REGIONS: Region[] = ["NSW1", "QLD1", "SA1", "TAS1", "VIC1"];

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
export function apiPost<T>(path: string, csrfToken: string, body?: unknown): Promise<T | null> {
  return fetch(path, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-csrf-token": csrfToken,
    },
    body: body === undefined ? "" : JSON.stringify(body),
  }).then((response) => (response.status === 204 ? null : parse<T>(response)));
}

export function getSession(signal?: AbortSignal): Promise<SessionView> {
  return apiGet<SessionView>("/api/auth/v1/session", signal);
}

/** NEM market days run UTC+10 — same helper convention as the public app. */
export function marketDay(now = new Date()): string {
  return new Date(now.getTime() + 10 * 3600000).toISOString().slice(0, 10);
}

export function plusDays(day: string, offset: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
}
