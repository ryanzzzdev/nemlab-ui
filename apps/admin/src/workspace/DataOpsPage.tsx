import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router";
import { REGIONS, marketDay, plusDays } from "../api";
import { fmtTime } from "../format";
import type { Region, SessionView } from "../api";
import { ActivityPane, Inspector } from "../components/Panes";
import { Stat, StatStrip, Tabs, Toolbar } from "../components/Toolbar";
import { Empty } from "../components/States";
import { CoverageView, DayInspector, baselineQuery, coverageQuery } from "./CoverageView";
import { LOAD_DRAFT_KEY, LoadDrawer } from "./LoadDrawer";
import { PublishDrawer } from "./PublishDrawer";
import {
  ActivityBody,
  ImportInspector,
  JobsView,
  OperationInspector,
  RefreshInspector,
  jobsQueries,
} from "./JobsView";
import type { JobRow, JobTypeFilter } from "./JobsView";
import {
  AttemptInspector,
  AttemptsView,
  PublicationInspector,
  PublicationsView,
  attemptsQuery,
  publicationsQuery,
} from "./PublicationsView";
import { defaultScope, endExclusive, parseSelection, selectionParam, validateScope } from "./scope";
import type { Scope, Selection } from "./scope";

type View = "coverage" | "jobs" | "publications";

const VIEW_TABS: { id: View; label: string }[] = [
  { id: "coverage", label: "Coverage" },
  { id: "jobs", label: "Loads & Jobs" },
  { id: "publications", label: "Publications" },
];

const VIEW_SELECTIONS: Record<View, Set<Selection["kind"]>> = {
  coverage: new Set(["day"]),
  jobs: new Set(["op", "import", "refresh"]),
  publications: new Set(["pub", "attempt"]),
};

function scopeFromParams(params: URLSearchParams): Scope {
  const fallback = defaultScope();
  const region = REGIONS.find((r) => r === params.get("region")) ?? fallback.region;
  return {
    region,
    // `from`/`to` are canonical; `start`/`end` cover links minted by the
    // pre-workspace coverage page.
    start: params.get("from") ?? params.get("start") ?? fallback.start,
    end: params.get("to") ?? params.get("end") ?? fallback.end,
  };
}

export function DataOpsPage() {
  const session = useOutletContext<SessionView>();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();

  const view = (VIEW_TABS.find((t) => t.id === params.get("view"))?.id ?? "coverage") as View;
  const scope = scopeFromParams(params);
  const selection = parseSelection(params.get("sel"));
  const typeFilter = (params.get("type") ?? "all") as JobTypeFilter;

  // Draft scope edits — nothing queries until Apply.
  const [draft, setDraft] = useState<Scope>(scope);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [allRecent, setAllRecent] = useState(false);
  const [pubsTab, setPubsTab] = useState<"pubs" | "attempts">("pubs");
  const [openDrawer, setOpenDrawer] = useState<"load" | "publish" | null>(null);

  useEffect(() => setDraft(scope), [scope.region, scope.start, scope.end]);

  const endEx = endExclusive(scope);
  const coverage = useQuery({
    ...coverageQuery(scope.region, scope.start, endEx),
    enabled: view === "coverage",
  });
  const baseline = useQuery({
    ...baselineQuery(scope.region, scope.start, endEx),
    enabled: view === "coverage",
  });
  const operations = useQuery(jobsQueries.operations);
  const imports = useQuery(jobsQueries.imports);
  const refreshes = useQuery(jobsQueries.refreshes);
  const publications = useQuery(publicationsQuery);
  const attempts = useQuery({ ...attemptsQuery, enabled: view === "publications" });

  function setParam(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    setParams(next);
  }

  function select(sel: Selection | null) {
    setParam({ sel: selectionParam(sel) });
  }

  function changeView(next: View) {
    // One inspector kind at a time — a selection that does not belong to
    // the new view is dropped rather than showing a dead record.
    const keep = selection && VIEW_SELECTIONS[next].has(selection.kind);
    setParam({ view: next, sel: keep ? selectionParam(selection) : null });
  }

  function apply() {
    const problem = validateScope(draft);
    setScopeError(problem);
    if (problem) return;
    setNote(selection ? "Selection cleared — the scope changed." : null);
    setParam({
      region: draft.region,
      from: draft.start,
      to: draft.end,
      sel: null,
    });
  }

  function refresh() {
    const keys = [
      ["grid-coverage"],
      ["grid-baseline"],
      ["load-operations"],
      ["grid-imports"],
      ["price-refreshes"],
      ["publications"],
      ["publication-attempts"],
    ];
    for (const key of keys) void client.invalidateQueries({ queryKey: key });
  }

  const checkedAt = [
    coverage.dataUpdatedAt,
    operations.dataUpdatedAt,
    imports.dataUpdatedAt,
    refreshes.dataUpdatedAt,
    publications.dataUpdatedAt,
  ].reduce((a, b) => Math.max(a, b), 0);

  const jobRows: JobRow[] = [
    ...(operations.data ?? []).map((op) => ({ kind: "op", id: op.id, op }) as JobRow),
    ...(imports.data ?? []).map((job) => ({ kind: "import", id: job.id, job }) as JobRow),
    ...(refreshes.data ?? []).map((job) => ({ kind: "refresh", id: job.id, job }) as JobRow),
  ];
  const jobsPending = operations.isPending && imports.isPending && refreshes.isPending;
  const jobsError = operations.error ?? imports.error ?? refreshes.error;

  const days = coverage.data?.days ?? [];
  const completeDays = days.filter((d) => d.availability === "COMPLETE").length;
  const partialDays = days.filter((d) => d.availability === "PARTIAL").length;
  const readyDays = baseline.data?.days.filter((d) => d.ready).length ?? 0;
  const latest = publications.data
    ?.filter((p) => p.region === scope.region)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const runningJobs = jobRows.filter(
    (r) =>
      (r.kind === "op" && r.op.status === "dispatching") ||
      (r.kind !== "op" && (r.job.status === "QUEUED" || r.job.status === "RUNNING")),
  ).length;
  const failedJobs = jobRows.filter((r) => r.kind !== "op" && r.job.status === "FAILED").length;

  function inspector() {
    if (!selection) {
      return <Empty label="Select a row to inspect it here." />;
    }
    switch (selection.kind) {
      case "day":
        return (
          <DayInspector
            scope={scope}
            coverage={coverage}
            baseline={baseline}
            day={selection.id}
            session={session}
            onLoadDay={(d) => {
              // Load-this-day is a new explicit draft — it replaces any
              // unfinished drawer draft rather than resuming it.
              sessionStorage.setItem(
                LOAD_DRAFT_KEY,
                JSON.stringify({ region: scope.region, start: d, end: d }),
              );
              setOpenDrawer("load");
            }}
          />
        );
      case "op": {
        const op = operations.data?.find((o) => o.id === selection.id);
        return op ? (
          <OperationInspector operation={op} session={session} />
        ) : (
          <Empty label="That operation is not in the loaded list." />
        );
      }
      case "import": {
        const job = imports.data?.find((j) => j.id === selection.id);
        return job ? (
          <ImportInspector
            job={job}
            session={session}
            onLoadDraft={(draft) => {
              // "Submit again" seeds the drawer with the job's remaining
              // window — same draft the retired /load page consumed.
              sessionStorage.setItem(LOAD_DRAFT_KEY, JSON.stringify(draft));
              setOpenDrawer("load");
            }}
          />
        ) : (
          <Empty label="That import is not in the loaded list." />
        );
      }
      case "refresh": {
        const job = refreshes.data?.find((j) => j.id === selection.id);
        return job ? (
          <RefreshInspector job={job} />
        ) : (
          <Empty label="That refresh is not in the loaded list." />
        );
      }
      case "pub":
        return <PublicationInspector id={selection.id} />;
      case "attempt": {
        const attempt = attempts.data?.find((a) => a.id === selection.id);
        return attempt ? (
          <AttemptInspector
            attempt={attempt}
            onOpenPublication={(id) => select({ kind: "pub", id })}
          />
        ) : (
          <Empty label="That run is not in the loaded list." />
        );
      }
    }
  }

  return (
    <>
      <Toolbar title="Data Operations">
        <label>
          Region
          <select
            value={draft.region}
            onChange={(e) => setDraft({ ...draft, region: e.target.value as Region })}
          >
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input
            type="date"
            value={draft.start}
            max={plusDays(marketDay(), -1)}
            onChange={(e) => setDraft({ ...draft, start: e.target.value })}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={draft.end}
            max={plusDays(marketDay(), -1)}
            onChange={(e) => setDraft({ ...draft, end: e.target.value })}
          />
        </label>
        <button type="button" className="btn primary" onClick={apply}>
          Apply
        </button>
        {session.role === "owner" && (
          <>
            <button type="button" className="btn" onClick={() => setOpenDrawer("load")}>
              Load data
            </button>
            <button type="button" className="btn" onClick={() => setOpenDrawer("publish")}>
              Review &amp; publish
            </button>
          </>
        )}
        {checkedAt > 0 && <span className="fresh">checked {fmtTime(checkedAt)}</span>}
        <button type="button" className="btn" onClick={refresh}>
          Refresh
        </button>
      </Toolbar>
      {scopeError && (
        <p className="banner warn" role="alert">
          {scopeError}
        </p>
      )}
      {note && (
        <p className="banner" role="status">
          {note}
        </p>
      )}

      <StatStrip>
        {view === "coverage" && (
          <>
            <Stat value={`${completeDays}/${days.length}`} label="Complete days" tone="ok" />
            <Stat value={partialDays} label="Partial" tone={partialDays ? "warn" : undefined} />
            <Stat
              value={days.length - completeDays - partialDays}
              label="Not imported"
              tone={days.length - completeDays - partialDays ? "warn" : undefined}
            />
            <Stat
              value={baseline.data ? `${readyDays}/${baseline.data.days.length}` : "—"}
              label="Baseline ready"
            />
          </>
        )}
        {view === "jobs" && (
          <>
            <Stat value={runningJobs} label="In flight" />
            <Stat value={failedJobs} label="Failed" tone={failedJobs ? "warn" : undefined} />
            <Stat value={jobRows.length} label="Loaded rows" />
          </>
        )}
        {view === "publications" && (
          <>
            <Stat value={publications.data?.length ?? "—"} label="Publications" />
            <Stat value={attempts.data?.length ?? "—"} label="Detection runs" />
          </>
        )}
        <Stat
          value={
            latest
              ? `${latest.region} ${latest.startDay} – ${plusDays(latest.endExclusive, -1)}`
              : "—"
          }
          label="Latest publication"
        />
      </StatStrip>

      <Tabs tabs={VIEW_TABS} active={view} onChange={changeView} />

      <div className="workarea">
        <div className="main-col">
          {view === "coverage" && (
            <CoverageView
              scope={scope}
              coverage={coverage}
              selectedDay={selection?.kind === "day" ? selection.id : null}
              onSelect={(day) => select({ kind: "day", id: day })}
            />
          )}
          {view === "jobs" && (
            <JobsView
              rows={jobRows}
              filter={typeFilter}
              onFilter={(f) => setParam({ type: f === "all" ? null : f })}
              selected={selection}
              onSelect={select}
              pending={jobsPending}
              error={jobsError}
            />
          )}
          {view === "publications" && (
            <>
              <Tabs
                tabs={[
                  { id: "pubs" as const, label: "Publications" },
                  { id: "attempts" as const, label: "Detection runs" },
                ]}
                active={pubsTab}
                onChange={setPubsTab}
              />
              {pubsTab === "pubs" ? (
                <PublicationsView
                  scope={scope}
                  publications={publications}
                  selected={selection}
                  onSelect={select}
                />
              ) : (
                <AttemptsView attempts={attempts} selected={selection} onSelect={select} />
              )}
            </>
          )}
          <ActivityPane
            scope={
              allRecent ? "all recent work" : `${scope.region} · ${scope.start} – ${scope.end}`
            }
          >
            <div className="activity-toggle">
              <label>
                <input
                  type="checkbox"
                  checked={allRecent}
                  onChange={(e) => setAllRecent(e.target.checked)}
                />{" "}
                All recent
              </label>
            </div>
            <ActivityBody
              rows={jobRows}
              scope={scope}
              allRecent={allRecent}
              onSelect={(sel) => {
                setParam({ view: "jobs", sel: selectionParam(sel) });
              }}
            />
          </ActivityPane>
        </div>
        <Inspector>{inspector()}</Inspector>
      </div>
      {session.role === "owner" && (
        <>
          <LoadDrawer
            scope={scope}
            session={session}
            open={openDrawer === "load"}
            onClose={() => setOpenDrawer(null)}
            onStarted={() => changeView("jobs")}
          />
          <PublishDrawer
            scope={scope}
            session={session}
            open={openDrawer === "publish"}
            onClose={() => setOpenDrawer(null)}
          />
        </>
      )}
    </>
  );
}
