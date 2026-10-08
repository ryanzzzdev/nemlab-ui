import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router";
import {
  ApiError,
  apiGet,
  decideAccessRequest,
  extendViewerGrant,
  listAccessAudit,
  listAccessRequests,
  resendAccessDelivery,
  revokeViewerGrant,
} from "../api";
import type {
  AccessAuditView,
  AccessRequestDetail,
  AccessRequestView,
  GrantDays,
  GrantState,
  SessionView,
  ViewerGrantView,
} from "../api";
import { Inspector } from "../components/Panes";
import { Empty, Failure, Loading } from "../components/States";
import { StatusChip } from "../components/StatusChip";
import { DataTable } from "../components/Table";
import type { Column } from "../components/Table";
import { Tabs, Toolbar } from "../components/Toolbar";

const DURATIONS: GrantDays[] = [7, 30, 90];
const POLL_MS = 30_000;

const TABS = [
  { id: "requests", label: "Requests" },
  { id: "visitors", label: "Visitors" },
  { id: "audit", label: "Audit" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const GRANT_STATES: { state: GrantState; label: string }[] = [
  { state: "active", label: "Active" },
  { state: "expired", label: "Expired" },
  { state: "revoked", label: "Revoked" },
];

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

const REQUEST_COLUMNS: Column<AccessRequestView>[] = [
  {
    id: "status",
    header: "Status",
    render: (r) => <StatusChip status={r.status} />,
  },
  { id: "name", header: "Name", render: (r) => r.name },
  { id: "email", header: "Email", render: (r) => r.email },
  {
    id: "submitted",
    header: "Submitted",
    render: (r) => new Date(r.submittedAt).toLocaleString("en-AU"),
  },
  {
    id: "verified",
    header: "Verified",
    render: (r) => (r.verifiedAt ? new Date(r.verifiedAt).toLocaleDateString("en-AU") : "not yet"),
  },
];

const GRANT_COLUMNS: Column<ViewerGrantView>[] = [
  { id: "email", header: "Visitor", render: (g) => g.email },
  { id: "state", header: "State", render: (g) => <StatusChip status={g.state} /> },
  {
    id: "granted",
    header: "Granted",
    render: (g) => new Date(g.grantedAt).toLocaleString("en-AU"),
  },
  {
    id: "until",
    header: "Until",
    render: (g) =>
      g.revokedAt
        ? `revoked ${new Date(g.revokedAt).toLocaleString("en-AU")}`
        : new Date(g.expiresAt).toLocaleString("en-AU"),
  },
];

/** Audit rows carry no server id — the selection key is the row itself. */
function auditKey(a: AccessAuditView): string {
  return `${a.occurredAt}|${a.actor}|${a.action}|${a.subject ?? ""}|${a.result ?? ""}`;
}

const AUDIT_COLUMNS: Column<AccessAuditView>[] = [
  {
    id: "occurred",
    header: "When",
    render: (a) => new Date(a.occurredAt).toLocaleString("en-AU"),
  },
  { id: "actor", header: "Actor", render: (a) => a.actor },
  { id: "action", header: "Action", render: (a) => a.action },
  { id: "subject", header: "Subject", render: (a) => a.subject ?? "—" },
  { id: "result", header: "Result", render: (a) => a.result ?? "—" },
];

/** Decision surface for one pending request — approve/reject with a bounded
 * grant duration, resend a queued delivery, and the per-request mail audit.
 * Recent-auth and conflict responses behave exactly as the page did. */
function RequestInspector({ id, session }: { id: string; session: SessionView }) {
  const client = useQueryClient();
  const [days, setDays] = useState<GrantDays>(30);
  const [busy, setBusy] = useState(false);
  const [needsRecent, setNeedsRecent] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const detail = useQuery({
    queryKey: ["access-request", id],
    queryFn: ({ signal }) =>
      apiGet<AccessRequestDetail>(`/api/admin/v1/access-requests/${id}`, signal),
  });

  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["access-requests"] }),
      client.invalidateQueries({ queryKey: ["viewer-grants"] }),
      detail.refetch(),
    ]);
  }

  async function decide(decision: "approve" | "reject") {
    if (!detail.data) return;
    setBusy(true);
    setNote(null);
    setFailure(null);
    try {
      await decideAccessRequest(session.csrfToken, id, {
        decision,
        days: decision === "approve" ? days : undefined,
        version: detail.data.version,
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
      await resendAccessDelivery(session.csrfToken, id);
      setNote("Delivery re-queued — watch the audit below for the outcome.");
      await detail.refetch();
    } catch (error) {
      if (conflict(error)) setNote("Nothing to resend for this request.");
      else setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  if (detail.isPending) return <Loading label="Reading request…" />;
  if (detail.isError) return <Failure error={detail.error} />;
  const request = detail.data;
  return (
    <>
      <div className="insp-head">
        <h2>{request.name}</h2>
        <div className="sub">
          {request.email} · <StatusChip status={request.status} />
        </div>
      </div>
      {request.message && (
        <div className="insp-sec">
          <h3>Their note</h3>
          <p>{request.message}</p>
        </div>
      )}
      <div className="insp-sec">
        <dl className="kv">
          <dt>Submitted</dt>
          <dd>{new Date(request.submittedAt).toLocaleString("en-AU")}</dd>
          <dt>Verified</dt>
          <dd>
            {request.verifiedAt ? new Date(request.verifiedAt).toLocaleString("en-AU") : "not yet"}
          </dd>
          <dt>Decided</dt>
          <dd>{request.decidedAt ? new Date(request.decidedAt).toLocaleString("en-AU") : "—"}</dd>
        </dl>
      </div>
      {request.status === "pending" && (
        <div className="insp-sec">
          <h3>Decision</h3>
          <div className="job-actions">
            <DurationPicker value={days} onChange={setDays} prefix="approval" />
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => void decide("approve")}
            >
              Approve
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() => void decide("reject")}
            >
              Reject
            </button>
          </div>
        </div>
      )}
      <div className="insp-actions">
        <button type="button" className="btn ghost" disabled={busy} onClick={() => void resend()}>
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
      <div className="insp-sec">
        <h3>Delivery audit</h3>
        {request.deliveries.length === 0 ? (
          <Empty label="No deliveries recorded yet." />
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Status</th>
                <th className="num">Attempts</th>
                <th>Sent</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {request.deliveries.map((d) => (
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
        )}
      </div>
    </>
  );
}

/** Grant management for one visitor — bounded extensions and a two-step
 * reasoned revoke. Revocation ends access on the visitor's next request. */
function GrantInspector({ grant, session }: { grant: ViewerGrantView; session: SessionView }) {
  const client = useQueryClient();
  const [days, setDays] = useState<GrantDays>(30);
  const [revoking, setRevoking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsRecent, setNeedsRecent] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);

  async function act(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setNote(null);
    setFailure(null);
    try {
      await action();
      setNote(done);
      setRevoking(false);
      await client.invalidateQueries({ queryKey: ["viewer-grants"] });
    } catch (error) {
      if (recentAuth(error)) setNeedsRecent(true);
      else if (conflict(error)) {
        setNote("This grant changed underneath you — the list has been refreshed.");
        await client.invalidateQueries({ queryKey: ["viewer-grants"] });
      } else setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  if (!grant) return <Empty label="That grant is not in the loaded list." />;
  return (
    <>
      <div className="insp-head">
        <h2>{grant.email}</h2>
        <div className="sub">
          Visitor grant · <StatusChip status={grant.state} />
        </div>
      </div>
      <div className="insp-sec">
        <dl className="kv">
          <dt>Granted</dt>
          <dd>{new Date(grant.grantedAt).toLocaleString("en-AU")}</dd>
          <dt>Until</dt>
          <dd>
            {grant.revokedAt
              ? `revoked ${new Date(grant.revokedAt).toLocaleString("en-AU")}`
              : new Date(grant.expiresAt).toLocaleString("en-AU")}
          </dd>
        </dl>
      </div>
      {grant.state !== "revoked" && (
        <div className="insp-sec">
          <h3>Manage access</h3>
          <div className="job-actions">
            <DurationPicker value={days} onChange={setDays} prefix="extension" />
            <button
              type="button"
              className="btn ghost"
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
              <button type="button" className="btn ghost" onClick={() => setRevoking(true)}>
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
                  className="btn primary"
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
          <p className="hint">
            Revoking ends the visitor's access on their next request — sessions are re-checked
            against the grant every call, so there is no logout race to manage.
          </p>
        </div>
      )}
      {needsRecent && <RecentAuthPrompt />}
      {note && (
        <p className="hint" role="status">
          {note}
        </p>
      )}
      {failure !== null && <Failure error={failure} />}
    </>
  );
}

export function AccessPage() {
  const session = useOutletContext<SessionView>();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get("tab"))?.id ?? "requests") as Tab;
  const sel = params.get("sel");
  const grantState = (GRANT_STATES.find((s) => s.state === params.get("state"))?.state ??
    "active") as GrantState;

  const requests = useQuery({
    queryKey: ["access-requests"],
    queryFn: ({ signal }) => listAccessRequests(signal),
    refetchInterval: POLL_MS,
    enabled: session.role === "owner",
  });
  const grants = useQuery({
    queryKey: ["viewer-grants", grantState],
    queryFn: ({ signal }) =>
      apiGet<ViewerGrantView[]>(`/api/admin/v1/viewer-grants?state=${grantState}`, signal),
    enabled: session.role === "owner" && tab === "visitors",
  });
  const audit = useQuery({
    queryKey: ["access-audit"],
    queryFn: ({ signal }) => listAccessAudit(100, signal),
    enabled: session.role === "owner" && tab === "audit",
  });

  function setParam(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    setParams(next);
  }

  if (session.role !== "owner") {
    return (
      <>
        <Toolbar title="Access" />
        <Empty label="Approving requests, extending access and revoking visitors are owner actions. Your read-only access does not include the access queue or grant management." />
      </>
    );
  }

  function inspector() {
    if (!sel) return <Empty label="Select a row to inspect it here." />;
    if (tab === "requests") return <RequestInspector id={sel} session={session} />;
    if (tab === "visitors") {
      const grant = grants.data?.find((g) => g.id === sel);
      return grant ? (
        <GrantInspector grant={grant} session={session} />
      ) : (
        <Empty label="That grant is not in the loaded list." />
      );
    }
    const row = audit.data?.find((a) => auditKey(a) === sel);
    if (!row) return <Empty label="That audit row is not in the loaded list." />;
    return (
      <>
        <div className="insp-head">
          <h2>{row.action}</h2>
          <div className="sub">
            {row.actor} · {new Date(row.occurredAt).toLocaleString("en-AU")}
          </div>
        </div>
        <div className="insp-sec">
          <dl className="kv">
            <dt>Subject</dt>
            <dd>{row.subject ?? "—"}</dd>
            <dt>Result</dt>
            <dd>{row.result ?? "—"}</dd>
          </dl>
        </div>
        <p className="hint">Audit entries are recorded by the server — this view is read-only.</p>
      </>
    );
  }

  return (
    <>
      <Toolbar title="Access">
        <span className="hint">
          Requests are decided one at a time — each approval mints a bounded visitor grant.
        </span>
      </Toolbar>
      <Tabs
        tabs={[...TABS]}
        active={tab}
        onChange={(next) => setParam({ tab: next === "requests" ? null : next, sel: null })}
      />
      <div className="workarea">
        <div className="main-col">
          {tab === "requests" &&
            (requests.isPending ? (
              <Loading />
            ) : requests.isError ? (
              <Failure error={requests.error} />
            ) : (
              <DataTable
                id="access-requests"
                columns={REQUEST_COLUMNS}
                rows={requests.data}
                rowKey={(r) => r.id}
                selectedKey={sel}
                onSelect={(id) => setParam({ sel: id })}
                empty={
                  <Empty label="No pending requests — verified applicants waiting on a decision appear here." />
                }
              />
            ))}
          {tab === "visitors" && (
            <>
              <Tabs
                tabs={GRANT_STATES.map(({ state, label }) => ({ id: state, label }))}
                active={grantState}
                onChange={(next) => setParam({ state: next === "active" ? null : next, sel: null })}
              />
              {grants.isPending ? (
                <Loading />
              ) : grants.isError ? (
                <Failure error={grants.error} />
              ) : (
                <DataTable
                  id="viewer-grants"
                  columns={GRANT_COLUMNS}
                  rows={grants.data}
                  rowKey={(g) => g.id}
                  selectedKey={sel}
                  onSelect={(id) => setParam({ sel: id })}
                  empty={<Empty label={`No ${grantState} grants.`} />}
                />
              )}
            </>
          )}
          {tab === "audit" &&
            (audit.isPending ? (
              <Loading />
            ) : audit.isError ? (
              <Failure error={audit.error} />
            ) : (
              <DataTable
                id="access-audit"
                columns={AUDIT_COLUMNS}
                rows={audit.data}
                rowKey={auditKey}
                selectedKey={sel}
                onSelect={(key) => setParam({ sel: key })}
                empty={<Empty label="No access audit rows recorded yet." />}
              />
            ))}
        </div>
        <Inspector>{inspector()}</Inspector>
      </div>
    </>
  );
}
