import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { marketDay, nextDay } from "../prices/client";
import { fields, initialForm, prepare, costFields, windowFields } from "./scenario";
import type { Field, Form, Errors, Request } from "./scenario";
import { readResult, readStatus, submitSimulation, SimulationError, uuid } from "./client";
import type { Job, Result } from "./client";
import { ResultView } from "./ResultView";

function wait(seconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, seconds * 1000);
    signal.addEventListener("abort", abort, { once: true });
  });
}

// Scenario groups collapse into disclosures; a group containing a field error
// is forced open so the invalid control is never hidden.
const groupFields: Record<string, (keyof Form)[]> = {
  market: ["day"],
  site: ["capacityMWh", "chargeMW", "dischargeMW", "importLimitMW", "exportLimitMW"],
  energy: ["minimumMWh", "maximumMWh", "initialMWh"],
  efficiency: ["efficiencyMode", "roundTrip", "charge", "discharge"],
  costs: [...costFields],
  windows: [...windowFields],
  thresholds: ["chargeBelow", "dischargeAbove"],
};

export function BatteryWorkspace() {
  const [form, setForm] = useState(initialForm);
  const [openGroups, setOpenGroups] = useState(() => new Set<string>(["market"]));
  const [errors, setErrors] = useState<Errors>({});
  const [job, setJob] = useState<Job | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Choose your scenario, then run all three strategies.");
  const [problem, setProblem] = useState(false);
  const [shareNote, setShareNote] = useState("");
  const active = useRef<AbortController | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const statusRef = useRef<HTMLElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedId = searchParams.get("simulation");
  const chip: [string, string] = result
    ? ["complete", "Complete"]
    : problem
      ? ["failed", "Failed"]
      : busy
        ? job?.status === "RUNNING"
          ? ["running", "Running"]
          : ["queued", job ? "Queued" : "Working"]
        : job?.status === "FAILED"
          ? ["failed", "Failed"]
          : job?.status === "RUNNING"
            ? ["running", "Running"]
            : job
              ? ["queued", "Queued"]
              : ["ready", "Ready"];
  useEffect(() => () => active.current?.abort(), []);
  // Rejected fields open their group before focus; the second effect focuses
  // once every needed group is committed open, and only once per errors object.
  const focusedErrors = useRef<Errors | null>(null);
  useEffect(() => {
    const rejected = new Set(Object.keys(errors));
    if (!rejected.size) return;
    setOpenGroups((current) => {
      const next = new Set(current);
      for (const [group, members] of Object.entries(groupFields))
        if (members.some((member) => rejected.has(member))) next.add(group);
      return next;
    });
  }, [errors]);
  useEffect(() => {
    const rejected = new Set(Object.keys(errors));
    if (!rejected.size || focusedErrors.current === errors) return;
    const needed = Object.entries(groupFields)
      .filter(([, members]) => members.some((member) => rejected.has(member)))
      .map(([group]) => group);
    if (!needed.every((group) => openGroups.has(group))) return;
    focusedErrors.current = errors;
    formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
  }, [errors, openGroups]);
  useEffect(() => {
    if (!linkedId) return;
    if (!uuid.test(linkedId)) {
      setProblem(true);
      setMessage("This link does not identify a saved simulation.");
      return;
    }
    if (linkedId === job?.id || linkedId === result?.id) return;
    active.current?.abort();
    active.current = null;
    void restore(linkedId);
  }, [linkedId]);

  function change(key: keyof Form, value: string | boolean) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors({});
    setJob(null);
    setResult(null);
    setProblem(false);
    setShareNote("");
    setMessage("Scenario changed. Run all three strategies to calculate a new comparison.");
    if (linkedId) setSearchParams({}, { replace: true });
  }
  async function monitor(first: Job, signal: AbortSignal, request?: Request) {
    let current = { job: first, retryAfter: 2 };
    for (let check = 0; ; check++) {
      signal.throwIfAborted();
      setJob(current.job);
      if (current.job.status === "FAILED") {
        setProblem(true);
        setMessage(
          `Simulation failed${current.job.failureCode ? ` — ${current.job.failureCode}` : ""}. No proven comparison is available. Resubmitting unchanged inputs reuses this failed job; it does not restart it.`,
        );
        return null;
      }
      if (current.job.status === "SUCCEEDED") {
        setMessage("Simulation succeeded. Loading the stored result…");
        const saved = await readResult(current.job.id, signal);
        signal.throwIfAborted();
        if (request && (saved.inputs.region !== request.region || saved.inputs.day !== request.day))
          throw new SimulationError(
            "The stored result does not match the selected region and day.",
          );
        setResult(saved);
        setSearchParams({ simulation: saved.id }, { replace: true });
        setMessage("Simulation complete. All strategies and their original inputs are stored.");
        return saved;
      }
      if (check >= 60)
        throw new SimulationError(
          "Automatic checking paused. Your simulation may still be running; resume checking for an update.",
        );
      setMessage(
        current.job.status === "QUEUED"
          ? "Queued — waiting for a simulation worker."
          : "Running — comparing fixed schedule, thresholds and hindsight.",
      );
      await wait(current.retryAfter, signal);
      current = await readStatus(current.job.id, signal);
    }
  }

  async function run(event?: FormEvent, resume = false) {
    event?.preventDefault();
    if (active.current) return;
    const prepared = prepare(form);
    if (!prepared.request) {
      setErrors(prepared.errors);
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    const signal = controller.signal;
    setBusy(true);
    setProblem(false);
    setErrors({});
    setResult(null);
    setShareNote("");
    if (!resume) setJob(null);
    setMessage(resume ? "Checking simulation…" : "Submitting scenario…");
    statusRef.current?.focus({ preventScroll: true });
    try {
      let first: Job;
      if (resume && job) first = (await readStatus(job.id, signal)).job;
      else first = await submitThroughRefresh(prepared.request, signal);
      await monitor(first, signal, prepared.request);
    } catch (error) {
      report(error, signal);
    } finally {
      finish(controller);
    }
  }

  // An uncovered but eligible day answers 409 PRICE_REFRESH_PENDING: the service
  // deduplicates a bounded visitor fetch, so resubmitting the same scenario is safe.
  async function submitThroughRefresh(request: Request, signal: AbortSignal) {
    let waits = 0;
    for (;;) {
      try {
        return (await submitSimulation(request, signal)).job;
      } catch (error) {
        const retryable =
          error instanceof SimulationError &&
          (error.code === "PRICE_REFRESH_PENDING" || error.code === "VISITOR_REFRESH_LIMIT");
        if (!retryable) throw error;
        const cap = error.code === "VISITOR_REFRESH_LIMIT" ? 10 : 20;
        if (++waits > cap)
          throw new SimulationError(
            error.code === "VISITOR_REFRESH_LIMIT"
              ? "Too many price fetches are still queued. Submit the same scenario again later."
              : "Prices for this day are still being fetched. Submit the same scenario again to keep waiting.",
          );
        setMessage(
          error.code === "VISITOR_REFRESH_LIMIT"
            ? "Many price fetches are in progress — retrying automatically…"
            : "Fetching stored prices for this day — the simulation starts once they arrive…",
        );
        await wait(Math.max(1, error.retryAfter || 30), signal);
      }
    }
  }

  async function restore(id: string) {
    const controller = new AbortController();
    active.current = controller;
    const signal = controller.signal;
    setBusy(true);
    setProblem(false);
    setErrors({});
    setResult(null);
    setJob(null);
    setShareNote("");
    setMessage("Opening the saved simulation…");
    statusRef.current?.focus({ preventScroll: true });
    try {
      const first = (await readStatus(id, signal)).job;
      const saved = await monitor(first, signal);
      if (saved) applyInputs(saved);
    } catch (error) {
      report(error, signal);
    } finally {
      finish(controller);
    }
  }

  function applyInputs(saved: Result) {
    const hhmm = (minutes: number) =>
      `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    setForm((current) => ({
      ...current,
      region: saved.inputs.region,
      day: saved.inputs.day,
      efficiencyMode: "legs",
      charge: saved.inputs.efficiency.charge,
      discharge: saved.inputs.efficiency.discharge,
      ...saved.inputs.site,
      ...saved.inputs.costs,
      chargeStart: hhmm(saved.inputs.windows.chargeStart),
      chargeEnd: hhmm(saved.inputs.windows.chargeEnd),
      dischargeStart: hhmm(saved.inputs.windows.dischargeStart),
      dischargeEnd: hhmm(saved.inputs.windows.dischargeEnd),
      // A pre-threshold saved result shows empty threshold fields: the saved
      // inputs did not include them, and defaults are only inserted by the
      // explicit "Compare all three" action below.
      chargeBelow: saved.inputs.thresholds?.chargeBelow ?? "",
      dischargeAbove: saved.inputs.thresholds?.dischargeAbove ?? "",
    }));
  }

  // Explicit opt-in to rerun an old two-strategy result with the illustrative
  // threshold defaults — the saved result stays untouched server-side.
  function compareAll() {
    setForm((current) => ({
      ...current,
      chargeBelow: fields.chargeBelow[1],
      dischargeAbove: fields.dischargeAbove[1],
    }));
    setErrors({});
    setJob(null);
    setResult(null);
    setShareNote("");
    setProblem(false);
    setMessage(
      `Illustrative thresholds ${fields.chargeBelow[1]}/${fields.dischargeAbove[1]} AUD/MWh added — edit freely, then run to compare all three strategies as a new scenario.`,
    );
    if (linkedId) setSearchParams({}, { replace: true });
  }

  async function copyResultLink() {
    if (!result) return;
    const url = `${window.location.origin}/batterylab?simulation=${result.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareNote("Result link copied to the clipboard.");
    } catch {
      setShareNote(`Copy this result link: ${url}`);
    }
  }

  function report(error: unknown, signal: AbortSignal) {
    if (signal.aborted) return;
    setProblem(true);
    setMessage(error instanceof Error ? error.message : "Simulation unavailable. Try again later.");
    if (error instanceof SimulationError && error.field) {
      const key = error.field.split(".").at(-1)!;
      const mapped =
        key === "site"
          ? "capacityMWh"
          : key === "windows"
            ? "chargeStart"
            : key === "efficiency"
              ? "efficiencyMode"
              : key === "thresholds"
                ? "chargeBelow"
                : key;
      if (mapped in form)
        setErrors({
          [mapped]:
            "The service rejected this value or its bounds. Check this input and related fields.",
        });
    }
  }

  function finish(controller: AbortController) {
    if (active.current === controller) {
      active.current = null;
      setBusy(false);
    }
  }
  function stop() {
    active.current?.abort();
    active.current = null;
    setBusy(false);
    setProblem(false);
    setMessage(
      "Checking stopped on this page. Any accepted backend job continues. Resume checking, or submit the same scenario to recover its job.",
    );
  }
  function input(key: Field) {
    return (
      <label key={key} htmlFor={`scenario-${key}`}>
        <span id={`label-${key}`}>{fields[key][0]}</span>
        <input
          id={`scenario-${key}`}
          aria-labelledby={`label-${key}`}
          value={form[key]}
          maxLength={64}
          inputMode={
            windowFields.includes(key as (typeof windowFields)[number]) ? "text" : "decimal"
          }
          onChange={(e) => change(key, e.target.value)}
          aria-invalid={Boolean(errors[key])}
          aria-describedby={errors[key] ? `error-${key}` : undefined}
        />
        {errors[key] && (
          <span className="field-error" id={`error-${key}`}>
            {errors[key]}
          </span>
        )}
      </label>
    );
  }
  // Collapsible scenario group: a native disclosure keeps keyboard and
  // screen-reader semantics; the inner fieldset still carries disabled state.
  function section(key: string, title: string, children: ReactNode) {
    return (
      <details
        className="scenario-group"
        open={openGroups.has(key)}
        onToggle={(e) => {
          const open = e.currentTarget.open;
          setOpenGroups((current) => {
            const next = new Set(current);
            if (open) next.add(key);
            else next.delete(key);
            return next;
          });
        }}
      >
        <summary>{title}</summary>
        <fieldset disabled={busy}>
          <legend className="sr-only">{title}</legend>
          {children}
        </fieldset>
      </details>
    );
  }
  return (
    <div className="lab-layout simulation-layout">
      <form
        ref={formRef}
        className="scenario-form"
        onSubmit={(e) => void run(e)}
        noValidate
        aria-label="Battery scenario"
      >
        <h2>Scenario</h2>
        {section(
          "market",
          "Market day",
          <div className="scenario-fields">
            <label>
              <span id="label-region">Simulation region</span>
              <select
                aria-labelledby="label-region"
                value={form.region}
                onChange={(e) => change("region", e.target.value)}
              >
                {["NSW1", "QLD1", "VIC1", "SA1", "TAS1"].map((region) => (
                  <option key={region}>{region}</option>
                ))}
              </select>
            </label>
            <label>
              <span id="label-day">Simulation day (UTC+10)</span>
              <input
                aria-labelledby="label-day"
                type="date"
                value={form.day}
                min="2021-10-01"
                max={nextDay(marketDay(), -1)}
                onChange={(e) => change("day", e.target.value)}
                aria-invalid={Boolean(errors.day)}
                aria-describedby={errors.day ? "error-day" : undefined}
              />
              {errors.day && (
                <span className="field-error" id="error-day">
                  {errors.day}
                </span>
              )}
            </label>
          </div>,
        )}
        {section(
          "site",
          "Aggregate site",
          <div className="scenario-fields">
            <div className="field-full">{input("capacityMWh")}</div>
            {input("chargeMW")}
            {input("dischargeMW")}
            {input("importLimitMW")}
            {input("exportLimitMW")}
          </div>,
        )}
        {section(
          "energy",
          "Stored energy",
          <>
            <div className="scenario-fields">
              {input("minimumMWh")}
              {input("maximumMWh")}
              {input("initialMWh")}
            </div>
            <p className="hint">
              Terminal energy equals initial energy for the fixed schedule and hindsight strategies;
              price thresholds may differ.
            </p>
          </>,
        )}
        {section(
          "efficiency",
          "Efficiency",
          <>
            <div className="radio-row">
              <label>
                <input
                  type="radio"
                  name="efficiency-mode"
                  checked={form.efficiencyMode === "roundTrip"}
                  aria-invalid={Boolean(errors.efficiencyMode)}
                  aria-describedby={errors.efficiencyMode ? "error-efficiency" : undefined}
                  onChange={() => change("efficiencyMode", "roundTrip")}
                />
                Round trip
              </label>
              <label>
                <input
                  type="radio"
                  name="efficiency-mode"
                  checked={form.efficiencyMode === "legs"}
                  onChange={() => change("efficiencyMode", "legs")}
                />
                Separate legs
              </label>
            </div>
            {errors.efficiencyMode && (
              <span className="field-error" id="error-efficiency">
                {errors.efficiencyMode}
              </span>
            )}
            <div className="scenario-fields">
              {form.efficiencyMode === "roundTrip"
                ? input("roundTrip")
                : ["charge", "discharge"].map((key) => input(key as Field))}
            </div>
            <p className="hint">
              Round-trip efficiency is split into equal square-root charge and discharge
              efficiencies.
            </p>
          </>,
        )}
        {section(
          "costs",
          "Variable costs",
          <div className="scenario-fields">{costFields.map(input)}</div>,
        )}
        {section(
          "windows",
          "Schedule windows — fixed schedule and hindsight only",
          <>
            <div className="scenario-fields">{windowFields.map(input)}</div>
            <p className="hint">
              NEM UTC+10, five-minute steps. One charge window, then one discharge window. Use 24:00
              for next midnight. Price thresholds run all day and ignore these windows.
            </p>
          </>,
        )}
        {section(
          "thresholds",
          "Price thresholds",
          <>
            <div className="scenario-fields">
              {input("chargeBelow")}
              {input("dischargeAbove")}
            </div>
            <p className="hint">
              All-day price rule: charge below, discharge above, otherwise hold. It ignores the
              schedule windows and may finish with different stored energy.
            </p>
          </>,
        )}
        <div className="btns">
          <button type="submit" className="primary" disabled={busy}>
            Run simulation
          </button>
        </div>
        <section ref={statusRef} tabIndex={-1} className="job" aria-label="Simulation progress">
          <p className="job-state" role={problem ? "alert" : "status"}>
            <span className={`job-chip ${chip[0]}`}>{chip[1]}</span>
            <span className="job-message">{message}</span>
          </p>
          {job && (
            <p className="job-id">
              Simulation <span className="revision">{job.id}</span>
              <br />
              {(result ? result.inputs : form).region} · {(result ? result.inputs : form).day} · NEM
              UTC+10
            </p>
          )}
          {result && (
            <p className="job-id">
              Prices: Open Electricity · revision{" "}
              <span className="revision">{result.priceRevision}</span>
              <br />
              <span className="revision">
                request {result.versions.request} · model {result.versions.model} · fixed{" "}
                {result.versions.fixed} · hindsight {result.versions.hindsight} · solver{" "}
                {result.versions.solver} · execution {result.versions.executionProfile}
              </span>
            </p>
          )}
          <div className="job-actions">
            {busy && (
              <button type="button" className="ghost" onClick={stop}>
                Stop checking
              </button>
            )}
            {!busy && job && !result && job.status !== "FAILED" && (
              <button type="button" className="ghost" onClick={() => void run(undefined, true)}>
                Resume checking
              </button>
            )}
          </div>
          {result && (
            <div className="saved-result">
              <h3>Stored result ready</h3>
              <p>
                288 intervals · {result.threshold ? "three strategies" : "two strategies"} compared.
              </p>
              <button type="button" className="ghost" onClick={() => void copyResultLink()}>
                Copy result link
              </button>
              {shareNote && (
                <p className="availability" role="status">
                  {shareNote}
                </p>
              )}
            </div>
          )}
        </section>
        <p className="hint">Illustrative defaults, not investment recommendations.</p>
      </form>
      <div className="lab-workspace">
        {result ? (
          <ResultView result={result} compareAll={result.threshold ? undefined : compareAll} />
        ) : (
          <>
            <section className="comparison-preview">
              <h2>Three strategies, one battery</h2>
              <div className="strategy-grid">
                <article className="strategy-fixed">
                  <span className="strategy-label">Fixed schedule</span>
                  <h3>Follow a plan</h3>
                  <p>Trade within your windows without knowing future prices.</p>
                </article>
                <article className="strategy-threshold">
                  <span className="strategy-label">Price thresholds</span>
                  <h3>React to the price</h3>
                  <p>Charge below your buy price and discharge above your sell price, all day.</p>
                </article>
                <article className="strategy-hindsight">
                  <span className="strategy-label">Perfect hindsight</span>
                  <h3>Find the benchmark</h3>
                  <p>
                    Optimise against the day’s prices with the same limits. This is not a forecast.
                  </p>
                </article>
              </div>
            </section>
            <section className="prose">
              <h2>Understand the result</h2>
              <p>
                Trading margin excludes capital and financing costs, household tariffs and
                ancillary-service revenue.
              </p>
              <Link to="/methodology">Read the model assumptions</Link>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
