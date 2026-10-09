import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, PUBLIC_BASE, apiGet, marketDay, plusDays, publishGrid } from "../api";
import type {
  AdminGridPublication,
  GridCoverage,
  GridDetectionAttempt,
  Region,
  SessionView,
} from "../api";
import { Drawer } from "../components/Drawer";
import { Empty, Failure, Loading } from "../components/States";
import { StatusChip } from "../components/StatusChip";
import type { Scope } from "./scope";

const PUBLISH_ATTEMPT_KEY = "admin.publishAttempt";

function replayLink(publication: AdminGridPublication): string {
  const to = plusDays(publication.endExclusive, -1);
  return `${PUBLIC_BASE}/gridreplay?region=${publication.region}&from=${publication.startDay}&to=${to}&view=all`;
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

/**
 * Owner review-and-publish workflow as a workspace drawer. The window seeds
 * from the applied scope each open; every attempt carries a correlation key
 * persisted before the request so a lost response reconciles against the
 * recorded detection run instead of silently republishing.
 */
export function PublishDrawer({
  scope,
  session,
  open,
  onClose,
}: {
  scope: Scope;
  session: SessionView;
  open: boolean;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [start, setStart] = useState(scope.start);
  const [end, setEnd] = useState(scope.end);
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
    setCoverageFor(`${scope.region} ${start} – ${end}`);
    try {
      setCoverage(
        await apiGet<GridCoverage>(
          `/api/admin/v1/grid-coverage/${scope.region}?start=${start}&endExclusive=${endExclusive}`,
        ),
      );
    } catch (error) {
      setFailure(error);
    }
  }

  async function publish() {
    const attempt: PendingAttempt = {
      key: `admin-ui:${crypto.randomUUID()}`,
      region: scope.region,
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
    <Drawer title="Review & publish" open={open} onClose={onClose} wide>
      <p className="hint">
        Publishing runs the detector suite over stored data and replaces {scope.region}'s public
        catalogue pointer in one transaction — it does not append monthly catalogues. A span longer
        than 31 days needs one deliberate publication per ≤31-day window; the most recent wins the
        pointer.
      </p>
      <div className="field-row">
        <label>Region</label>
        <span>{scope.region}</span>
      </div>
      <div className="field-row">
        <label htmlFor="pd-start">First day</label>
        <input
          id="pd-start"
          type="date"
          value={start}
          max={plusDays(marketDay(), -1)}
          onChange={(e) => {
            setStart(e.target.value);
            setCoverage(null);
          }}
        />
      </div>
      <div className="field-row">
        <label htmlFor="pd-end">Last day</label>
        <input
          id="pd-end"
          type="date"
          value={end}
          max={plusDays(marketDay(), -1)}
          onChange={(e) => {
            setEnd(e.target.value);
            setCoverage(null);
          }}
        />
      </div>
      {error && (
        <p className="hint" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="btn ghost"
        onClick={() => void checkCoverage()}
        disabled={busy}
      >
        Check coverage
      </button>
      <details>
        <summary>Detector suite (advanced)</summary>
        <div className="field-row">
          <label htmlFor="pd-suite">Suite</label>
          <select
            id="pd-suite"
            value={suite}
            onChange={(e) => setSuite(e.target.value as "v1" | "v2")}
          >
            <option value="v2">v2 — calibrated reversal, episode and unusual-ramp types</option>
            <option value="v1">v1 — frozen original rules (compatibility)</option>
          </select>
        </div>
        <p className="hint">
          The request always names the suite explicitly — v2 is the default, v1 stays available for
          compatibility comparisons.
        </p>
      </details>
      {coverage && (
        <section aria-label="Coverage review">
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
                />{" "}
                Publish anyway — I intend a partial publication for these days.
              </label>
            </>
          )}
          <p className="hint">
            This is a coverage preview, not a promise of event counts — the detector evaluates at
            publish time and records the outcome in the run history.
          </p>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !canPublish}
            onClick={() => void publish()}
          >
            {busy ? "Publishing…" : `Detect & publish ${suite}`}
          </button>
        </section>
      )}
      {pending && (
        <section aria-label="Reconcile publish attempt">
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
                  history.
                </>
              ) : (
                "the run is recorded without a publication."
              )}{" "}
              Safe to clear this attempt or submit deliberately again.
            </p>
          ) : attempts.data ? (
            <p role="status">
              No run carries this key yet — the submission likely never landed. A new explicit
              submission is safe.
            </p>
          ) : (
            <Empty label="No detection runs loaded." />
          )}
          <div className="job-actions">
            <button
              type="button"
              className="btn ghost"
              onClick={() => void attempts.refetch()}
              disabled={attempts.isFetching}
            >
              Check detection runs
            </button>
            <button
              type="button"
              className="btn ghost"
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
        <section aria-label="Publication result">
          <h3>
            Published {published.region} {published.startDay} –{" "}
            {plusDays(published.endExclusive, -1)}
          </h3>
          <p>
            {published.eventCount} events under {published.detectorVersion} — {scope.region}'s
            catalogue pointer now pins this publication.{" "}
            <a href={replayLink(published)} target="_blank" rel="noopener noreferrer">
              Open in GridReplay
            </a>
          </p>
          <p className="hint">
            Existing replay links stay immutable; fresh data needs a deliberate republication.
          </p>
        </section>
      )}
      {failure !== null && <Failure error={failure} />}
    </Drawer>
  );
}
