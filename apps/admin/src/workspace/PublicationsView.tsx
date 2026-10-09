import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { PUBLIC_BASE, apiGet, plusDays } from "../api";
import { fmtDateTime } from "../format";
import type { AdminGridPublication, GridDetectionAttempt, GridPublicationDetail } from "../api";
import { DataTable } from "../components/Table";
import type { Column } from "../components/Table";
import { StatusChip } from "../components/StatusChip";
import { Failure, Loading } from "../components/States";
import type { Scope, Selection } from "./scope";

export const publicationsQuery = {
  queryKey: ["publications"],
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    apiGet<AdminGridPublication[]>("/api/admin/v1/grid-publications", signal),
};

export const attemptsQuery = {
  queryKey: ["publication-attempts"],
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    apiGet<GridDetectionAttempt[]>("/api/admin/v1/grid-publications/attempts", signal),
};

export function replayLink(publication: AdminGridPublication): string {
  const to = plusDays(publication.endExclusive, -1);
  return `${PUBLIC_BASE}/gridreplay?region=${publication.region}&from=${publication.startDay}&to=${to}&view=all`;
}

/** The "current" pointer is the newest publication for a region — the
 * public catalogue resolves to it; older rows stay readable forever. */
export function currentIds(pubs: AdminGridPublication[]): Set<string> {
  const latest = new Map<string, string>();
  for (const pub of pubs) {
    const seen = latest.get(pub.region);
    if (!seen || pub.createdAt > (pubs.find((p) => p.id === seen)?.createdAt ?? "")) {
      latest.set(pub.region, pub.id);
    }
  }
  return new Set(latest.values());
}

const COLUMNS: Column<AdminGridPublication>[] = [
  { id: "region", header: "Region", render: (p) => p.region },
  {
    id: "window",
    header: "Window",
    render: (p) => `${p.startDay} – ${plusDays(p.endExclusive, -1)}`,
  },
  { id: "detector", header: "Detector", render: (p) => p.detectorVersion },
  { id: "events", header: "Events", align: "right", render: (p) => p.eventCount },
  {
    id: "published",
    header: "Published",
    render: (p) => fmtDateTime(p.createdAt),
  },
  {
    id: "actor",
    header: "By",
    render: (p) => p.actor ?? "—",
  },
];

export function PublicationsView({
  scope,
  publications,
  selected,
  onSelect,
}: {
  scope: Scope;
  publications: UseQueryResult<AdminGridPublication[]>;
  selected: Selection | null;
  onSelect: (sel: Selection) => void;
}) {
  if (publications.isPending) return <Loading label="Reading publications…" />;
  if (publications.isError) return <Failure error={publications.error} />;
  const current = currentIds(publications.data);
  const rows = [...publications.data].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <>
      <DataTable
        id="publications"
        columns={[
          {
            id: "current",
            header: "",
            render: (p) =>
              current.has(p.id) ? (
                <span className="chip c-ok" title="Current pointer for this region">
                  Current
                </span>
              ) : (
                ""
              ),
          },
          ...COLUMNS,
        ]}
        rows={rows}
        rowKey={(p) => `pub:${p.id}`}
        selectedKey={selected ? `${selected.kind}:${selected.id}` : null}
        onSelect={(key) => {
          const id = key.split(":", 2)[1];
          if (id) onSelect({ kind: "pub", id });
        }}
        empty={
          <p className="empty-insp">
            No publications yet — publish from stored coverage when a region is ready.
          </p>
        }
      />
      <p className="hint table-note">
        {rows.length} publication{rows.length === 1 ? "" : "s"} recorded — “Current” marks the
        newest per region; each publication replaces that region&apos;s catalogue pointer. Scope{" "}
        {scope.region} is not filtered here — the pointer is a region-level fact.
      </p>
    </>
  );
}

export function AttemptsView({
  attempts,
  selected,
  onSelect,
}: {
  attempts: UseQueryResult<GridDetectionAttempt[]>;
  selected: Selection | null;
  onSelect: (sel: Selection) => void;
}) {
  if (attempts.isPending) return <Loading label="Reading detection runs…" />;
  if (attempts.isError) return <Failure error={attempts.error} />;
  const rows = [...attempts.data].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <DataTable
      id="attempts"
      columns={[
        {
          id: "window",
          header: "Window",
          render: (a) => `${a.startDay} – ${a.endExclusive}`,
        },
        { id: "region", header: "Region", render: (a) => a.region },
        { id: "detector", header: "Detector", render: (a) => a.detectorVersion },
        {
          id: "outcome",
          header: "Outcome",
          render: (a) => (
            <>
              <StatusChip status={a.status} />
              {a.diagnostic && <span className="hint"> {a.diagnostic}</span>}
            </>
          ),
        },
        { id: "actor", header: "By", render: (a) => a.actor ?? "—" },
        { id: "key", header: "Key", render: (a) => a.attemptKey ?? "—" },
        {
          id: "when",
          header: "When",
          render: (a) => fmtDateTime(a.createdAt),
        },
      ]}
      rows={rows}
      rowKey={(a) => `attempt:${a.id}`}
      selectedKey={selected ? `${selected.kind}:${selected.id}` : null}
      onSelect={(key) => {
        const id = key.split(":", 2)[1];
        if (id) onSelect({ kind: "attempt", id });
      }}
      empty={<p className="empty-insp">No detection runs recorded.</p>}
    />
  );
}

export function PublicationInspector({ id }: { id: string }) {
  const detail = useQuery({
    queryKey: ["publication", id],
    queryFn: ({ signal }) =>
      apiGet<GridPublicationDetail>(`/api/admin/v1/grid-publications/${id}`, signal),
  });
  if (detail.isPending) return <Loading label="Reading publication…" />;
  if (detail.isError) return <Failure error={detail.error} />;
  const pub = detail.data;
  const counts = Object.entries(pub.eventCounts ?? {});
  const highlights = pub.highlights;
  return (
    <>
      <div className="insp-head">
        <h2>
          {pub.region} {pub.startDay} – {plusDays(pub.endExclusive, -1)}
        </h2>
        <div className="sub">
          {pub.detectorVersion} · {pub.eventCount} events
        </div>
      </div>
      <div className="insp-sec">
        <h3>Publication</h3>
        <dl className="kv">
          <dt>Published</dt>
          <dd>{fmtDateTime(pub.createdAt)}</dd>
          <dt>Run</dt>
          <dd>{pub.runId ? <code>{pub.runId.slice(0, 8)}</code> : "—"}</dd>
          {pub.actor && (
            <>
              <dt>By</dt>
              <dd>{pub.actor}</dd>
            </>
          )}
          {pub.attemptKey && (
            <>
              <dt>Attempt key</dt>
              <dd>
                <code>{pub.attemptKey}</code>
              </dd>
            </>
          )}
        </dl>
      </div>
      {counts.length > 0 && (
        <div className="insp-sec">
          <h3>Events by type</h3>
          <dl className="kv">
            {counts.map(([type, count]) => (
              <div key={type} style={{ display: "contents" }}>
                <dt>{type.replaceAll("_", " ")}</dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {highlights && (
        <div className="insp-sec">
          <h3>Highlights</h3>
          <p className="hint">
            Selection {highlights.version}: {highlights.matching} matching, {highlights.selected}{" "}
            selected, {highlights.eligible} eligible, {highlights.excluded} excluded by overlap.
          </p>
        </div>
      )}
      <div className="insp-actions">
        <a
          className="btn"
          href={`${PUBLIC_BASE}/gridreplay?region=${pub.region}&from=${pub.startDay}&to=${plusDays(pub.endExclusive, -1)}&view=all`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open in GridReplay
        </a>
      </div>
      <div className="insp-sec">
        <p className="hint">
          Snapshots are frozen — replay links keep working when new data arrives or a later
          publication replaces this one.
        </p>
      </div>
    </>
  );
}

export function AttemptInspector({
  attempt,
  onOpenPublication,
}: {
  attempt: GridDetectionAttempt;
  onOpenPublication: (id: string) => void;
}) {
  return (
    <>
      <div className="insp-head">
        <h2>
          {attempt.region} {attempt.startDay} – {attempt.endExclusive}
        </h2>
        <div className="sub">
          Detection run · <StatusChip status={attempt.status} />
        </div>
      </div>
      <div className="insp-sec">
        <h3>Run</h3>
        <dl className="kv">
          <dt>Detector</dt>
          <dd>{attempt.detectorVersion}</dd>
          <dt>By</dt>
          <dd>{attempt.actor ?? "—"}</dd>
          <dt>Key</dt>
          <dd>{attempt.attemptKey ? <code>{attempt.attemptKey}</code> : "—"}</dd>
          <dt>When</dt>
          <dd>{fmtDateTime(attempt.createdAt)}</dd>
          {attempt.diagnostic && (
            <>
              <dt>Diagnostic</dt>
              <dd>{attempt.diagnostic}</dd>
            </>
          )}
        </dl>
        {attempt.publicationId && (
          <p>
            <button
              type="button"
              className="linklike"
              title="Select the publication this detection run produced."
              onClick={() => onOpenPublication(attempt.publicationId!)}
            >
              Open the recorded publication
            </button>
          </p>
        )}
      </div>
    </>
  );
}
