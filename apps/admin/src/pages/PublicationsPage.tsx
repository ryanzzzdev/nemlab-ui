import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useOutletContext } from "react-router";
import { ApiError, REGIONS, apiGet, marketDay, plusDays, publishGrid } from "../api";
import type {
  AdminGridPublication,
  GridCoverage,
  GridDetectionAttempt,
  GridPublicationDetail,
  Region,
  SessionView,
} from "../api";
import { StatusChip } from "../components/StatusChip";
import { Empty, Failure, Loading, Panel } from "../components/States";

const PUBLISH_ATTEMPT_KEY = "admin.publishAttempt";

function replayLink(publication: AdminGridPublication): string {
  const to = plusDays(publication.endExclusive, -1);
  return `/gridreplay?region=${publication.region}&from=${publication.startDay}&to=${to}&view=all`;
}

interface PendingAttempt {
  key: string;
  region: Region;
  start: string;
  endExclusive: string;
  suite: "v1" | "v2";
}

function readPendingAttempt(): PendingAttempt | null {
  try {
    const raw = sessionStorage.getItem(PUBLISH_ATTEMPT_KEY);
    return raw ? (JSON.parse(raw) as PendingAttempt) : null;
  } catch {
    return null;
  }
}

/** Step 5–7 of the owner journey: review a <=31-day scope against stored
 * coverage, acknowledge intentional gaps, then publish explicitly. Each
 * attempt carries a correlation key persisted before the request so a lost
 * response reconciles against the attempts history instead of silently
 * republishing. */
function PublishPanel({ region, session }: { region: Region; session: SessionView }) {
  const client = useQueryClient();
  const [start, setStart] = useState(() => plusDays(marketDay(), -31));
  const [end, setEnd] = useState(() => plusDays(marketDay(), -1));
  const [suite, setSuite] = useState<"v1" | "v2">("v2");
  const [coverage, setCoverage] = useState<GridCoverage | null>(null);
  const [coverageFor, setCoverageFor] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [pending, setPending] = useState<PendingAttempt | null>(readPendingAttempt);
  const [published, setPublished] = useState<AdminGridPublication | null>(null);

  const attempts = useQuery({
    queryKey: ["publication-attempts"],
    queryFn: ({ signal }) =>
      apiGet<GridDetectionAttempt[]>("/api/admin/v1/grid-publications/attempts", signal),
    enabled: pending !== null,
  });
  const reconciled = pending ? attempts.data?.find((a) => a.attemptKey === pending.key) : undefined;

  const gapDays = coverage?.days.filter((d) => d.availability !== "COMPLETE") ?? [];
  const canPublish = coverage !== null && (gapDays.length === 0 || acknowledged);

  async function checkCoverage() {
    setError(null);
    setCoverage(null);
    setAcknowledged(false);
    setPublished(null);
    if (!start || !end || end < start) {
      setError("Choose a valid window — the last day must be on or after the first.");
      return;
    }
    if (plusDays(start, 31) <= end) {
      setError(
        "A publication covers at most 31 days — split longer spans into separate publications.",
      );
      return;
    }
    if (end > plusDays(marketDay(), -1)) {
      setError(
        `Only completed market days are publishable — the last day can be ${plusDays(marketDay(), -1)} at most.`,
      );
      return;
    }
    const endExclusive = plusDays(end, 1);
    setCoverageFor(`${region} ${start} – ${end}`);
    try {
      setCoverage(
        await apiGet<GridCoverage>(
          `/api/admin/v1/grid-coverage/${region}?start=${start}&endExclusive=${endExclusive}`,
        ),
      );
    } catch (error) {
      setFailure(error);
    }
  }

  async function publish() {
    const attempt: PendingAttempt = {
      key: `admin-ui:${crypto.randomUUID()}`,
      region,
      start,
      endExclusive: plusDays(end, 1),
      suite,
    };
    // Persist before the request: if the response is lost the key is the
    // handle for reconciling against the recorded detection run.
    sessionStorage.setItem(PUBLISH_ATTEMPT_KEY, JSON.stringify(attempt));
    setPending(attempt);
    setBusy(true);
    setFailure(null);
    try {
      const result = await publishGrid(session.csrfToken, {
        region: attempt.region,
        startDay: attempt.start,
        endExclusive: attempt.endExclusive,
        detectorSuite: attempt.suite,
        attemptKey: attempt.key,
      });
      sessionStorage.removeItem(PUBLISH_ATTEMPT_KEY);
      setPending(null);
      setPublished(result);
      await client.invalidateQueries({ queryKey: ["publications"] });
      await client.invalidateQueries({ queryKey: ["publication-attempts"] });
    } catch (error) {
      // A client-side validation rejection (4xx) cannot have published;
      // anything else leaves the outcome genuinely unknown — the attempt key
      // above reconciles it against the recorded run.
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        sessionStorage.removeItem(PUBLISH_ATTEMPT_KEY);
        setPending(null);
      }
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Review & publish">
      <p className="hint">
        Publishing runs the detector suite over stored data and replaces {region}'s public catalogue
        pointer in one transaction — it does not append monthly catalogues. A loaded span longer
        than 31 days needs one deliberate publication per ≤31-day window; the most recent wins the
        pointer.
      </p>
      <div className="scenario-form">
        <div className="scenario-fields">
          <label htmlFor="pub-start">First day</label>
          <input
            id="pub-start"
            type="date"
            value={start}
            max={plusDays(marketDay(), -1)}
            onChange={(e) => {
              setStart(e.target.value);
              setCoverage(null);
            }}
          />
          <label htmlFor="pub-end">Last day</label>
          <input
            id="pub-end"
            type="date"
            value={end}
            max={plusDays(marketDay(), -1)}
            onChange={(e) => {
              setEnd(e.target.value);
              setCoverage(null);
            }}
          />
          {error && (
            <p className="hint" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            className="ghost"
            onClick={() => void checkCoverage()}
            disabled={busy}
          >
            Check coverage
          </button>
          <details>
            <summary>Detector suite (advanced)</summary>
            <label htmlFor="pub-suite">Suite</label>
            <select
              id="pub-suite"
              value={suite}
              onChange={(e) => setSuite(e.target.value as "v1" | "v2")}
            >
              <option value="v2">v2 — calibrated reversal, episode and unusual-ramp types</option>
              <option value="v1">v1 — frozen original rules (compatibility)</option>
            </select>
            <p className="hint">
              The request always names the suite explicitly — v2 is the default, v1 stays available
              for compatibility comparisons.
            </p>
          </details>
        </div>
      </div>
      {coverage && (
        <section className="card" aria-label="Coverage review">
          <h3>Coverage preview — {coverageFor}</h3>
          {gapDays.length === 0 ? (
            <p>
              All {coverage.days.length} days report complete required market data. Optional power
              or price gaps can still exist — published snapshots pin whatever revisions exist at
              publish time.
            </p>
          ) : (
            <>
              <p>
                {gapDays.length} of {coverage.days.length} days lack complete required grid data:{" "}
                {gapDays
                  .map((d) => `${d.day} (${d.availability.toLowerCase().replace("_", " ")})`)
                  .join(", ")}
                .
              </p>
              <label className="ack">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                Publish anyway — I intend a partial publication for these days.
              </label>
            </>
          )}
          <p className="hint">
            This is a coverage preview, not a promise of event counts — the detector evaluates at
            publish time and records the outcome in the run history below.
          </p>
          <button
            type="button"
            className="primary"
            disabled={busy || !canPublish}
            onClick={() => void publish()}
          >
            {busy ? "Publishing…" : `Detect & publish ${suite}`}
          </button>
        </section>
      )}
      {pending && (
        <section className="card" aria-label="Reconcile publish attempt">
          <h3>Outcome unknown — check history</h3>
          <p>
            The publish response for {pending.region} {pending.start} –{" "}
            {plusDays(pending.endExclusive, -1)} never confirmed. Its attempt key{" "}
            <code>{pending.key}</code> is recorded on the detection run if it landed — deliberate
            republishing always creates a new publication, so nothing is silently deduplicated.
          </p>
          {attempts.isPending ? (
            <Loading label="Checking detection runs…" />
          ) : attempts.isError ? (
            <Failure error={attempts.error} />
          ) : reconciled ? (
            <p role="status">
              Run recorded: <StatusChip status={reconciled.status} /> —{" "}
              {reconciled.publicationId ? (
                <>
                  publication <code>{reconciled.publicationId}</code> landed; it is listed in the
                  history below.
                </>
              ) : (
                "the run is recorded without a publication."
              )}{" "}
              Safe to clear this attempt or submit deliberately again.
            </p>
          ) : (
            <p role="status">
              No run carries this key yet — the submission likely never landed. A new explicit
              submission is safe.
            </p>
          )}
          <div className="job-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => void attempts.refetch()}
              disabled={attempts.isFetching}
            >
              Check detection runs
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                sessionStorage.removeItem(PUBLISH_ATTEMPT_KEY);
                setPending(null);
              }}
            >
              Clear attempt
            </button>
          </div>
        </section>
      )}
      {published && (
        <section className="card" aria-label="Publication result">
          <h3>
            Published {published.region} {published.startDay} –{" "}
            {plusDays(published.endExclusive, -1)}
          </h3>
          <p>
            {published.eventCount} events under {published.detectorVersion} — {region}'s catalogue
            pointer now pins this publication.{" "}
            <a href={replayLink(published)}>Open in GridReplay</a>
          </p>
          <p className="hint">
            Existing replay links stay immutable; fresh data needs a deliberate republication.
          </p>
        </section>
      )}
      {failure !== null && <Failure error={failure} />}
    </Panel>
  );
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
  const session = useOutletContext<SessionView>();
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
      {session.role === "owner" ? (
        <PublishPanel region={region} session={session} />
      ) : (
        <Panel title="Review & publish">
          <p className="hint">
            Publishing is an owner action — each deliberate publication replaces the region's public
            catalogue pointer. Your read-only access covers history and replay links.
          </p>
        </Panel>
      )}
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
