import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { REGIONS, apiGet, plusDays } from "../api";
import type {
  AdminGridPublication,
  GridDetectionAttempt,
  GridPublicationDetail,
  Region,
} from "../api";
import { StatusChip } from "../components/StatusChip";
import { Empty, Failure, Loading, Panel } from "../components/States";

function replayLink(publication: AdminGridPublication): string {
  const to = plusDays(publication.endExclusive, -1);
  return `/gridreplay?region=${publication.region}&from=${publication.startDay}&to=${to}&view=all`;
}

function PublicationDetail({ id }: { id: string }) {
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
    <div className="job-detail">
      <dl className="detail-grid">
        <dt>Detector</dt>
        <dd>{pub.detectorVersion}</dd>
        <dt>Events</dt>
        <dd>{pub.eventCount}</dd>
        <dt>Run</dt>
        <dd>
          {pub.runId ? <code>{pub.runId}</code> : "—"}
          {pub.actor ? ` · by ${pub.actor}` : ""}
          {pub.attemptKey ? ` · key ${pub.attemptKey}` : ""}
        </dd>
        {counts.length > 0 && (
          <>
            <dt>By type</dt>
            <dd>
              {counts.map(([type, count]) => (
                <span key={type} className="job-ref">
                  {type.replaceAll("_", " ")}: {count}
                </span>
              ))}
            </dd>
          </>
        )}
      </dl>
      {highlights && (
        <p className="hint">
          Highlights selection {highlights.version}: {highlights.matching} matching,{" "}
          {highlights.selected} selected, {highlights.eligible} eligible, {highlights.excluded}{" "}
          excluded by overlap.
        </p>
      )}
      <p className="hint">
        Published snapshots are frozen — replay links below keep working even when new data arrives
        or a later publication replaces this one.
      </p>
    </div>
  );
}

function Publications({ region }: { region: Region }) {
  const [open, setOpen] = useState<string | null>(null);
  const publications = useQuery({
    queryKey: ["publications"],
    queryFn: ({ signal }) =>
      apiGet<AdminGridPublication[]>("/api/admin/v1/grid-publications", signal),
  });
  if (publications.isPending) return <Loading />;
  if (publications.isError) return <Failure error={publications.error} />;
  const filtered = publications.data.filter((p) => p.region === region);
  if (filtered.length === 0) {
    return <Empty label={`No publications for ${region} yet.`} />;
  }
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Window</th>
            <th scope="col">Detector</th>
            <th scope="col" className="num">
              Events
            </th>
            <th scope="col">Published</th>
            <th scope="col">Replay</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((pub) => (
            <tr key={pub.id}>
              <td>
                <button
                  type="button"
                  className="linklike"
                  aria-expanded={open === pub.id}
                  onClick={() => setOpen(open === pub.id ? null : pub.id)}
                >
                  {pub.startDay} – {plusDays(pub.endExclusive, -1)}
                </button>
                {open === pub.id && <PublicationDetail id={pub.id} />}
              </td>
              <td>{pub.detectorVersion}</td>
              <td className="num">{pub.eventCount}</td>
              <td>{new Date(pub.createdAt).toLocaleString("en-AU")}</td>
              <td>
                <a href={replayLink(pub)}>Open in GridReplay</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Attempts({ region }: { region: Region }) {
  const attempts = useQuery({
    queryKey: ["publication-attempts"],
    queryFn: ({ signal }) =>
      apiGet<GridDetectionAttempt[]>("/api/admin/v1/grid-publications/attempts", signal),
  });
  if (attempts.isPending) return <Loading />;
  if (attempts.isError) return <Failure error={attempts.error} />;
  const filtered = attempts.data.filter((a) => a.region === region);
  if (filtered.length === 0) {
    return <Empty label="No detection runs recorded for this region." />;
  }
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Window</th>
            <th scope="col">Detector</th>
            <th scope="col">Outcome</th>
            <th scope="col">By</th>
            <th scope="col">Key</th>
            <th scope="col">When</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((attempt) => (
            <tr key={attempt.id}>
              <td>
                {attempt.startDay} – {attempt.endExclusive}
              </td>
              <td>{attempt.detectorVersion}</td>
              <td>
                <StatusChip status={attempt.status} />
                {attempt.diagnostic && <span className="hint"> {attempt.diagnostic}</span>}
              </td>
              <td>{attempt.actor ?? "—"}</td>
              <td>{attempt.attemptKey ?? "—"}</td>
              <td>{new Date(attempt.createdAt).toLocaleString("en-AU")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PublicationsPage() {
  const [region, setRegion] = useState<Region>("NSW1");
  return (
    <>
      <p className="eyebrow">Publications</p>
      <h1 tabIndex={-1}>What did we publish?</h1>
      <p className="intro">
        Detection runs and published catalogues — each publication replaces the region pointer;
        older replays stay readable.
      </p>
      <section className="card scenario-form">
        <div className="scenario-fields">
          <label htmlFor="pub-region">Region</label>
          <select
            id="pub-region"
            value={region}
            onChange={(e) => setRegion(e.target.value as Region)}
          >
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </section>
      <Panel title={`${region} publications`}>
        <Publications region={region} />
      </Panel>
      <Panel title="Detection runs">
        <p className="hint">
          Every publish attempt is recorded — complete runs inside the transaction, failed runs from
          the audit trail. Use the run key to reconcile a publish response that never arrived;
          republishing is always a deliberate new attempt.
        </p>
        <Attempts region={region} />
      </Panel>
    </>
  );
}
