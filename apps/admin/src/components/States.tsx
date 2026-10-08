import type { ReactNode } from "react";
import { ApiError } from "../api";

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card state-panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="hint" role="status">
      {label}
    </p>
  );
}

/** One renderer for every failure the console can hit — plain language,
 * no internals, and always a route back. */
export function Failure({ error }: { error: unknown }) {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return (
        <Panel title="Your access has ended">
          <p>
            Your session or permission has expired. Sign in again from your email link to continue.
          </p>
        </Panel>
      );
    }
    if (error.status === 403) {
      return (
        <Panel title="No permission for this view">
          <p>
            Your account can read coverage, jobs and publications but not this resource. If you
            recently lost access, sign in again.
          </p>
        </Panel>
      );
    }
    if (error.status === 503) {
      return (
        <Panel title="Storage temporarily unavailable">
          <p>The store could not be reached. Try again shortly.</p>
        </Panel>
      );
    }
  }
  return (
    <Panel title="Something went wrong">
      <p>The console could not complete this request. Try again.</p>
    </Panel>
  );
}

export function Empty({ label }: { label: string }) {
  return <p className="hint">{label}</p>;
}
