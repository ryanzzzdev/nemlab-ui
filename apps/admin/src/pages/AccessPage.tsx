import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useOutletContext } from "react-router";
import {
  ApiError,
  apiGet,
  decideAccessRequest,
  extendViewerGrant,
  resendAccessDelivery,
  revokeViewerGrant,
} from "../api";
import type {
  AccessRequestDetail,
  AccessRequestView,
  GrantDays,
  GrantState,
  SessionView,
  ViewerGrantView,
} from "../api";
import { StatusChip } from "../components/StatusChip";
import { Empty, Failure, Loading, Panel } from "../components/States";

const DURATIONS: GrantDays[] = [7, 30, 90];

function recentAuth(error: unknown): boolean {
  return error instanceof ApiError && error.code === "RECENT_AUTH_REQUIRED";
}

function conflict(error: unknown): boolean {
  return error instanceof ApiError && error.code === "ACCESS_CONFLICT";
}

/** Sensitive decisions need a sign-in from the last 15 minutes. The prompt
 * preserves the owner's in-flight choices — it never replays a stale
 * decision after the fresh session lands. */
function RecentAuthPrompt() {
  return (
    <p className="hint" role="alert">
      This action needs a sign-in from the last 15 minutes.{" "}
      <Link to="/sign-in">Request a fresh sign-in link</Link> — your selections stay on this page;
      nothing is resubmitted for you.
    </p>
  );
}

function DurationPicker({
  value,
  onChange,
  prefix,
}: {
  value: GrantDays;
  onChange: (days: GrantDays) => void;
  prefix: string;
}) {
  return (
    <label>
      <span className="hint">Access for</span>{" "}
      <select
        aria-label={`${prefix} duration`}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) as GrantDays)}
      >
        {DURATIONS.map((d) => (
          <option key={d} value={d}>
            {d} days
          </option>
        ))}
      </select>
    </label>
  );
}

function RequestDetail({ request, session }: { request: AccessRequestView; session: SessionView }) {
  const client = useQueryClient();
  const [days, setDays] = useState<GrantDays>(30);
  const [busy, setBusy] = useState(false);
  const [needsRecent, setNeedsRecent] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const detail = useQuery({
    queryKey: ["access-request", request.id],
    queryFn: ({ signal }) =>
      apiGet<AccessRequestDetail>(`/api/admin/v1/access-requests/${request.id}`, signal),
  });

  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["access-requests"] }),
      client.invalidateQueries({ queryKey: ["viewer-grants"] }),
      detail.refetch(),
    ]);
  }

  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    setNote(null);
    setFailure(null);
    try {
      await decideAccessRequest(session.csrfToken, request.id, {
        decision,
        days: decision === "approve" ? days : undefined,
        version: detail.data?.version ?? request.version,
      });
      setNote(
        decision === "approve"
          ? `Approved — ${days} days of read-only access and a sign-in invite are on their way.`
          : "Request rejected — the decision email is queued.",
      );
      await refresh();
    } catch (error) {
      if (recentAuth(error)) setNeedsRecent(true);
      else if (conflict(error)) {
        setNote("This request was already decided — the list has been refreshed.");
        await refresh();
      } else setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setNote(null);
    setFailure(null);
    try {
      await resendAccessDelivery(session.csrfToken, request.id);
      setNote("Delivery re-queued — watch the audit below for the outcome.");
      await detail.refetch();
    } catch (error) {
      if (conflict(error)) setNote("Nothing to resend for this request.");
      else setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="job-detail">
      {detail.isPending ? (
        <Loading label="Reading request…" />
      ) : detail.isError ? (
        <Failure error={detail.error} />
      ) : (
        <>
          {detail.data.message && (
            <p className="message">
              <strong>Their note:</strong> {detail.data.message}
            </p>
          )}
          <dl className="detail-grid">
            <dt>Verified</dt>
            <dd>
              {detail.data.verifiedAt
                ? new Date(detail.data.verifiedAt).toLocaleString("en-AU")
                : "not yet"}
            </dd>
            <dt>Decided</dt>
            <dd>
              {detail.data.decidedAt
                ? new Date(detail.data.decidedAt).toLocaleString("en-AU")
                : "—"}
            </dd>
          </dl>
          {detail.data.status === "pending" && (
            <div className="job-actions">
              <DurationPicker value={days} onChange={setDays} prefix="approval" />
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void decide("approve")}
              >
                Approve
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => void decide("reject")}
              >
                Reject
              </button>
            </div>
          )}
          <div className="job-actions">
            <button type="button" className="ghost" disabled={busy} onClick={() => void resend()}>
              Resend email
            </button>
          </div>
          {needsRecent && <RecentAuthPrompt />}
          {note && (
            <p className="hint" role="status">
              {note}
            </p>
          )}
          {failure !== null && <Failure error={failure} />}
          <h3>Delivery audit</h3>
          {detail.data.deliveries.length === 0 ? (
            <Empty label="No deliveries recorded yet." />
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Kind</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="num">
                      Attempts
                    </th>
                    <th scope="col">Sent</th>
                    <th scope="col">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.data.deliveries.map((d) => (
                    <tr key={`${d.kind}:${d.createdAt}`}>
                      <td>{d.kind.replaceAll("_", " ")}</td>
                      <td>
                        <StatusChip status={d.status} />
                      </td>
                      <td className="num">{d.attempts}</td>
                      <td>{d.sentAt ? new Date(d.sentAt).toLocaleString("en-AU") : "—"}</td>
                      <td>{d.diagnostic ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PendingQueue({ session }: { session: SessionView }) {
  const [open, setOpen] = useState<string | null>(null);
  const queue = useQuery({
    queryKey: ["access-requests"],
    queryFn: ({ signal }) => apiGet<AccessRequestView[]>("/api/admin/v1/access-requests", signal),
    refetchInterval: 30_000,
  });
  if (queue.isPending) return <Loading />;
  if (queue.isError) return <Failure error={queue.error} />;
  if (queue.data.length === 0) {
    return (
      <Empty label="No pending requests — verified applicants waiting on a decision appear here." />
    );
  }
  return (
    <ul className="job-list">
      {queue.data.map((request) => (
        <li key={request.id} className="job-row">
          <div className="job-summary">
            <button
              type="button"
              className="linklike"
              aria-expanded={open === request.id}
              onClick={() => setOpen(open === request.id ? null : request.id)}
            >
              {request.name} — {request.email}
            </button>
            <StatusChip status={request.status} />
            <span className="hint">
              submitted {new Date(request.submittedAt).toLocaleString("en-AU")}
              {request.verifiedAt ? " · verified" : " · unverified"}
            </span>
          </div>
          {open === request.id && <RequestDetail request={request} session={session} />}
        </li>
      ))}
    </ul>
  );
}

function GrantRow({ grant, session }: { grant: ViewerGrantView; session: SessionView }) {
  const client = useQueryClient();
  const [days, setDays] = useState<GrantDays>(30);
  const [revoking, setRevoking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsRecent, setNeedsRecent] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);

  async function refresh() {
    await client.invalidateQueries({ queryKey: ["viewer-grants"] });
  }

  async function act(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setNote(null);
    setFailure(null);
    try {
      await action();
      setNote(done);
      setRevoking(false);
      await refresh();
    } catch (error) {
      if (recentAuth(error)) setNeedsRecent(true);
      else if (conflict(error)) {
        setNote("This grant changed underneath you — the list has been refreshed.");
        await refresh();
      } else setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td>{grant.email}</td>
      <td>
        <StatusChip status={grant.state} />
      </td>
      <td>{new Date(grant.grantedAt).toLocaleString("en-AU")}</td>
      <td>
        {grant.revokedAt
          ? `revoked ${new Date(grant.revokedAt).toLocaleString("en-AU")}`
          : new Date(grant.expiresAt).toLocaleString("en-AU")}
      </td>
      <td>
        {grant.state !== "revoked" && (
          <div className="job-actions">
            <DurationPicker value={days} onChange={setDays} prefix="extension" />
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() =>
                void act(
                  () => extendViewerGrant(session.csrfToken, grant.id, days),
                  `Extended by ${days} days.`,
                )
              }
            >
              Extend
            </button>
            {!revoking ? (
              <button type="button" className="ghost" onClick={() => setRevoking(true)}>
                Revoke…
              </button>
            ) : (
              <>
                <input
                  type="text"
                  value={reason}
                  maxLength={200}
                  placeholder="Reason (optional, recorded)"
                  aria-label="Revocation reason"
                  onChange={(e) => setReason(e.target.value)}
                />
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => revokeViewerGrant(session.csrfToken, grant.id, reason || null),
                      "Access revoked — sessions for this visitor end on their next request.",
                    )
                  }
                >
                  Confirm revoke
                </button>
              </>
            )}
          </div>
        )}
        {needsRecent && <RecentAuthPrompt />}
        {note && (
          <p className="hint" role="status">
            {note}
          </p>
        )}
        {failure !== null && <Failure error={failure} />}
      </td>
    </tr>
  );
}

const GRANT_STATES: { state: GrantState; label: string }[] = [
  { state: "active", label: "Active" },
  { state: "expired", label: "Expired" },
  { state: "revoked", label: "Revoked" },
];

function GrantsPanel({ session }: { session: SessionView }) {
  const [state, setState] = useState<GrantState>("active");
  const grants = useQuery({
    queryKey: ["viewer-grants", state],
    queryFn: ({ signal }) =>
      apiGet<ViewerGrantView[]>(`/api/admin/v1/viewer-grants?state=${state}`, signal),
  });
  return (
    <Panel title="Viewer access grants">
      <div className="job-actions" role="group" aria-label="Grant state">
        {GRANT_STATES.map(({ state: s, label }) => (
          <button
            key={s}
            type="button"
            className={s === state ? "primary" : "ghost"}
            aria-pressed={s === state}
            onClick={() => setState(s)}
          >
            {label}
          </button>
        ))}
      </div>
      {grants.isPending ? (
        <Loading />
      ) : grants.isError ? (
        <Failure error={grants.error} />
      ) : grants.data.length === 0 ? (
        <Empty label={`No ${state} grants.`} />
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Visitor</th>
                <th scope="col">State</th>
                <th scope="col">Granted</th>
                <th scope="col">Until</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {grants.data.map((grant) => (
                <GrantRow key={grant.id} grant={grant} session={session} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint">
        Revoking ends the visitor's access on their next request — sessions are re-checked against
        the grant every call, so there is no logout race to manage.
      </p>
    </Panel>
  );
}

export function AccessPage() {
  const session = useOutletContext<SessionView>();
  if (session.role !== "owner") {
    return (
      <>
        <p className="eyebrow">Access</p>
        <h1 tabIndex={-1}>Who can see this console?</h1>
        <Panel title="Owner only">
          <p className="hint">
            Approving requests, extending access and revoking visitors are owner actions. Your
            read-only access does not include the access queue or grant management.
          </p>
        </Panel>
      </>
    );
  }
  return (
    <>
      <p className="eyebrow">Access</p>
      <h1 tabIndex={-1}>Who can see this console?</h1>
      <p className="intro">
        Verified requests waiting on your decision, and every visitor grant — approve, extend,
        revoke. Sensitive actions ask for a fresh sign-in.
      </p>
      <Panel title="Pending requests">
        <p className="hint">
          Applicants appear here once they verify their email — pending means verified and waiting.
        </p>
        <PendingQueue session={session} />
      </Panel>
      <GrantsPanel session={session} />
    </>
  );
}
