import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router";
import { PriceExplorer } from "../prices/PriceExplorer";
import { readPriceDay, marketDay, nextDay } from "../prices/client";
import { fields, initialForm, prepare, siteFields, costFields, windowFields } from "./scenario";
import type { Field, Form, Errors } from "./scenario";
import { readResult, readStatus, submitSimulation, SimulationError } from "./client";
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

export function BatteryWorkspace() {
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState<Errors>({});
  const [job, setJob] = useState<Job | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Choose your scenario, then run both strategies.");
  const [problem, setProblem] = useState(false);
  const active = useRef<AbortController | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const statusRef = useRef<HTMLElement>(null);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (Object.keys(errors).length)
      formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
  }, [errors]);

  function change(key: keyof Form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors({});
    setJob(null);
    setResult(null);
    setProblem(false);
    setMessage("Scenario changed. Run both strategies to calculate a new comparison.");
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
    if (!resume) setJob(null);
    setMessage(resume ? "Checking simulation…" : "Checking complete stored prices…");
    statusRef.current?.focus({ preventScroll: true });
    try {
      let current;
      if (resume && job) current = await readStatus(job.id, signal);
      else {
        const prices = await readPriceDay(prepared.request.region, prepared.request.day, signal);
        signal.throwIfAborted();
        if (
          prices.coverage.availability !== "COMPLETE" ||
          prices.coverage.valid !== 288 ||
          !prices.series ||
          !prices.series.intervals.every((v) => v.state === "VALUE")
        )
          throw new SimulationError(
            "A complete stored price day is required. Choose another day; this does not import new data.",
          );
        setMessage("Submitting scenario…");
        current = await submitSimulation(prepared.request, signal);
      }
      for (let check = 0; ; check++) {
        signal.throwIfAborted();
        setJob(current.job);
        if (current.job.status === "FAILED") {
          setProblem(true);
          setMessage(
            "Simulation failed. No proven comparison is available. Resubmitting unchanged inputs reuses this failed job; it does not restart it.",
          );
          break;
        }
        if (current.job.status === "SUCCEEDED") {
          setMessage("Simulation succeeded. Loading the stored result…");
          const saved = await readResult(current.job.id, signal);
          signal.throwIfAborted();
          if (
            saved.inputs.region !== prepared.request.region ||
            saved.inputs.day !== prepared.request.day
          )
            throw new SimulationError(
              "The stored result does not match the selected region and day.",
            );
          setResult(saved);
          setMessage("Simulation complete. Both strategies and their original inputs are stored.");
          break;
        }
        if (check >= 60)
          throw new SimulationError(
            "Automatic checking paused. Your simulation may still be running; resume checking for an update.",
          );
        setMessage(
          current.job.status === "QUEUED"
            ? "Queued — waiting for a simulation worker."
            : "Running — comparing fixed schedule and hindsight.",
        );
        await wait(current.retryAfter, signal);
        current = await readStatus(current.job.id, signal);
      }
    } catch (error) {
      if (signal.aborted) return;
      setProblem(true);
      setMessage(
        error instanceof Error ? error.message : "Simulation unavailable. Try again later.",
      );
      if (error instanceof SimulationError && error.field) {
        const key = error.field.split(".").at(-1)!;
        const mapped =
          key === "site"
            ? "capacityMWh"
            : key === "windows"
              ? "chargeStart"
              : key === "efficiency"
                ? "efficiencyMode"
                : key;
        if (mapped in form)
          setErrors({
            [mapped]:
              "The service rejected this value or its bounds. Check this input and related fields.",
          });
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
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
  return (
    <div className="lab-layout simulation-layout">
      <form
        ref={formRef}
        className="scenario-form"
        onSubmit={(e) => void run(e)}
        noValidate
        aria-label="Battery scenario"
      >
        <h2>Your scenario</h2>
        <p className="availability">Illustrative defaults, not investment recommendations.</p>
        <fieldset disabled={busy}>
          <legend>Market day</legend>
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
          </div>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Aggregate site</legend>
          <div className="scenario-fields">{siteFields.map(input)}</div>
          <p className="availability">Terminal energy equals initial energy for both strategies.</p>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Efficiency</legend>
          <label>
            <span id="label-efficiency">Efficiency input</span>
            <select
              aria-labelledby="label-efficiency"
              aria-invalid={Boolean(errors.efficiencyMode)}
              aria-describedby={errors.efficiencyMode ? "error-efficiency" : undefined}
              value={form.efficiencyMode}
              onChange={(e) => change("efficiencyMode", e.target.value)}
            >
              <option value="roundTrip">Round trip</option>
              <option value="legs">Separate charge / discharge</option>
            </select>
            {errors.efficiencyMode && (
              <span className="field-error" id="error-efficiency">
                {errors.efficiencyMode}
              </span>
            )}
          </label>
          <div className="scenario-fields">
            {form.efficiencyMode === "roundTrip"
              ? input("roundTrip")
              : ["charge", "discharge"].map((key) => input(key as Field))}
          </div>
          <p className="availability">
            Round-trip efficiency is split into equal square-root charge and discharge efficiencies.
          </p>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Operating windows · NEM UTC+10</legend>
          <div className="scenario-fields">{windowFields.map(input)}</div>
          <p className="availability">
            Five-minute steps. One charge window, then one discharge window. Use 24:00 for next
            midnight.
          </p>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Variable costs</legend>
          <div className="scenario-fields">{costFields.map(input)}</div>
        </fieldset>
        <button type="submit" disabled={busy}>
          Run simulation
        </button>
      </form>
      <div className="lab-workspace">
        <section
          ref={statusRef}
          tabIndex={-1}
          className="simulation-status"
          aria-labelledby="simulation-heading"
        >
          <div className="section-heading">
            <h2 id="simulation-heading">Simulation progress</h2>
            <span className="badge">
              {result ? "Complete" : (job?.status ?? (busy ? "Preparing" : "Ready"))}
            </span>
          </div>
          <p role={problem ? "alert" : "status"}>{message}</p>
          {job && (
            <p className="revision">
              Simulation: {job.id}
              <br />
              Scenario: {form.region} · {form.day} · NEM UTC+10
            </p>
          )}
          {busy && (
            <button type="button" onClick={stop}>
              Stop checking
            </button>
          )}
          {!busy && job && !result && job.status !== "FAILED" && (
            <button type="button" onClick={() => void run(undefined, true)}>
              Resume checking
            </button>
          )}
          {result && (
            <div className="saved-result">
              <h3>Stored result ready</h3>
              <p>288 intervals · fixed schedule and proven hindsight comparison.</p>
              <p className="revision">Price revision: {result.priceRevision}</p>
              <p>The full comparison and linked charts are below.</p>
            </div>
          )}
        </section>
        {result && <ResultView result={result} />}
        <section className="comparison-preview">
          <h2>Two strategies, the same limits</h2>
          <div className="strategy-grid">
            <article>
              <span className="strategy-label">Fixed schedule</span>
              <h3>Follow a plan</h3>
              <p>Trade within your windows without knowing future prices.</p>
            </article>
            <article>
              <span className="strategy-label">Perfect hindsight</span>
              <h3>Find the benchmark</h3>
              <p>Optimise against the day’s prices with the same limits. This is not a forecast.</p>
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
        <PriceExplorer />
      </div>
    </div>
  );
}
