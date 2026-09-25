import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { init, use } from "echarts/core";
import type { EChartsType } from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  DataZoomInsideComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { Result } from "./client";
import { aud, cumulativeMargins, endLabel, mwh, netMW, signedMw, thresholdAction } from "./compare";
import { useTheme } from "../components/Theme";

use([
  LineChart,
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  DataZoomInsideComponent,
  SVGRenderer,
]);

const windows = [
  { label: "Full day", start: 0, end: 287 },
  { label: "00:00–06:00", start: 0, end: 71 },
  { label: "06:00–12:00", start: 72, end: 143 },
  { label: "12:00–18:00", start: 144, end: 215 },
  { label: "18:00–24:00", start: 216, end: 287 },
];

type PanelConfig = {
  option: Record<string, unknown>;
  cursorOn: string;
  lines?: { yAxis: number; label: string; color: string }[] | undefined;
};

function Panel({
  config,
  selected,
  window,
  onSelect,
  dark,
  aria,
  children,
}: {
  config: PanelConfig;
  selected: number;
  window: { start: number; end: number };
  onSelect: (index: number) => void;
  dark: boolean;
  aria: string;
  children: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const started = performance.now();
    const instance = init(host.current, undefined, { renderer: "svg" });
    chart.current = instance;
    let measured = false;
    instance.on("finished", () => {
      if (!measured) {
        measured = true;
        performance.measure("nemlab-chart-initial-render", {
          start: started,
          end: performance.now(),
        });
      }
    });
    instance.setOption(config.option);
    function pick(event: { offsetX: number; offsetY: number }) {
      const point = [event.offsetX, event.offsetY];
      if (instance.containPixel({ gridIndex: 0 }, point)) {
        const coordinate = instance.convertFromPixel({ gridIndex: 0 }, point) as number[];
        onSelect(Math.max(0, Math.min(287, Math.round(coordinate[0]!))));
      }
    }
    instance.getZr().on("mousemove", pick);
    instance.getZr().on("click", pick);
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, [config, onSelect]);

  useEffect(() => {
    chart.current?.setOption({
      dataZoom: [{ startValue: window.start, endValue: window.end }],
      series: [
        {
          id: config.cursorOn,
          markLine: {
            silent: true,
            symbol: "none",
            label: { show: false },
            lineStyle: { color: dark ? "#ffa48b" : "#b04a2f", width: 2, type: "solid" },
            data: [
              { xAxis: selected },
              ...(config.lines ?? []).map((level) => ({
                yAxis: level.yAxis,
                lineStyle: { color: level.color, width: 1, type: "dashed" as const },
                label: {
                  show: true,
                  position: "insideEndTop" as const,
                  fontSize: 9,
                  color: level.color,
                  formatter: level.label,
                },
              })),
            ],
          },
        },
      ],
    });
  }, [config, selected, window, dark]);

  return (
    <div className="chart-card">
      <div className="chart-head">{children}</div>
      <div ref={host} className="chart-plot" role="img" aria-label={aria} />
    </div>
  );
}

export default function ResultCharts({ result }: { result: Result }) {
  const { dark } = useTheme();
  const [selected, setSelected] = useState(0);
  const [windowIndex, setWindowIndex] = useState(0);
  const [powerStrategy, setPowerStrategy] = useState<"fixed" | "hindsight" | "threshold">(
    "hindsight",
  );
  const window = windows[windowIndex]!;
  const threshold = result.threshold;

  const derived = useMemo(() => {
    const seconds = result.intervalSeconds;
    const runs: [number, number][] = [];
    let runStart = -1;
    const prices = result.prices.map((slot, index) => {
      const value = Number(slot.price);
      if (value < 0 && runStart < 0) runStart = index;
      if (value >= 0 && runStart >= 0) {
        runs.push([runStart, index - 1]);
        runStart = -1;
      }
      return value;
    });
    if (runStart >= 0) runs.push([runStart, 287]);
    return {
      labels: result.prices.map((slot, index) => endLabel(slot.end, index)),
      prices,
      fixedMW: result.fixed.dispatch.intervals.map((v) => netMW(v, seconds)),
      hindMW: result.hindsight.dispatch.intervals.map((v) => netMW(v, seconds)),
      fixedEnergy: result.fixed.dispatch.intervals.map((v) => v.endingEnergyMWh),
      hindEnergy: result.hindsight.dispatch.intervals.map((v) => v.endingEnergyMWh),
      fixedMargin: cumulativeMargins(result, result.fixed),
      hindMargin: cumulativeMargins(result, result.hindsight),
      thresholdMW: threshold?.dispatch.intervals.map((v) => netMW(v, seconds)) ?? null,
      thresholdEnergy: threshold?.dispatch.intervals.map((v) => v.endingEnergyMWh) ?? null,
      thresholdMargin: threshold ? cumulativeMargins(result, threshold) : null,
      negativeRuns: runs,
    };
  }, [result]);

  const configs = useMemo<Record<string, PanelConfig>>(() => {
    const text = dark ? "#9aa7b8" : "#5b6470";
    const rule = dark ? "#303a47" : "#dce1e7";
    const axisLine = dark ? "#596777" : "#b4bdc8";
    const fixedColor = dark ? "#9aa7b8" : "#64748b";
    const hindColor = dark ? "#69d8b6" : "#0e7a5f";
    const thresholdColor = dark ? "#c4b5fd" : "#7c3aed";
    const frame = (name: string, top: number) => ({
      grid: { left: 48, right: 12, top, bottom: 20 },
      xAxis: {
        type: "category",
        data: derived.labels,
        boundaryGap: false,
        axisLabel: { hideOverlap: true, fontSize: 10, color: text },
        axisLine: { lineStyle: { color: axisLine } },
      },
      yAxis: {
        type: "value",
        name,
        scale: true,
        axisLabel: { color: text, fontSize: 10 },
        nameTextStyle: { color: text },
        splitLine: { lineStyle: { color: rule } },
      },
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: 0,
          disabled: true,
          filterMode: "none",
          startValue: 0,
          endValue: 287,
        },
      ],
    });
    const line = (
      id: string,
      name: string,
      data: (number | null)[],
      color: string,
      dashed = false,
    ) => ({
      id,
      name,
      type: "line",
      showSymbol: false,
      connectNulls: false,
      lineStyle: { color, width: 1.6, ...(dashed ? { type: "dashed" as const } : {}) },
      data,
    });
    const bands = [
      { name: "Charge", from: result.inputs.windows.chargeStart / 5, tone: "window" },
      { name: "Discharge", from: result.inputs.windows.dischargeStart / 5, tone: "window" },
      ...derived.negativeRuns.map(([from]) => ({ name: "", from, tone: "negative" })),
    ];
    const bandEnds = [
      result.inputs.windows.chargeEnd / 5 - 1,
      result.inputs.windows.dischargeEnd / 5 - 1,
      ...derived.negativeRuns.map(([, to]) => to),
    ];
    const powerMW =
      powerStrategy === "fixed"
        ? derived.fixedMW
        : powerStrategy === "threshold" && derived.thresholdMW
          ? derived.thresholdMW
          : derived.hindMW;
    const thresholdLines = threshold
      ? [
          {
            yAxis: Number(threshold.thresholds.chargeBelow),
            label: `Charge < ${threshold.thresholds.chargeBelow}`,
            color: dark ? "#8abaff" : "#2563eb",
          },
          {
            yAxis: Number(threshold.thresholds.dischargeAbove),
            label: `Discharge > ${threshold.thresholds.dischargeAbove}`,
            color: dark ? "#69d8b6" : "#0e9f6e",
          },
        ]
      : undefined;
    return {
      price: {
        cursorOn: "price",
        lines: thresholdLines,
        option: {
          animation: false,
          textStyle: { color: text },
          ...frame("AUD/MWh", 24),
          series: [
            {
              ...line("price", "Stored price", derived.prices, dark ? "#ffb020" : "#b45309"),
              markArea: {
                silent: true,
                data: bands.map((band, index) => [
                  {
                    name: band.name,
                    xAxis: band.from,
                    itemStyle: {
                      color:
                        band.tone === "negative"
                          ? dark
                            ? "rgba(255,110,90,0.10)"
                            : "rgba(179,38,30,0.08)"
                          : dark
                            ? "rgba(138,186,255,0.07)"
                            : "rgba(82,109,160,0.09)",
                    },
                    label: {
                      show: Boolean(band.name),
                      position: "insideTop",
                      fontSize: 9,
                      color: text,
                    },
                  },
                  { xAxis: bandEnds[index] },
                ]),
              },
            },
          ],
        },
      },
      power: {
        cursorOn: "power-charge",
        option: {
          animation: false,
          textStyle: { color: text },
          ...frame("MW", 8),
          series: [
            line(
              "power-charge",
              "Charging",
              powerMW.map((value) => (value > 0 ? value : null)),
              dark ? "#8abaff" : "#2563eb",
            ),
            line(
              "power-discharge",
              "Discharging",
              powerMW.map((value) => (value < 0 ? value : null)),
              dark ? "#69d8b6" : "#0e9f6e",
            ),
          ],
        },
      },
      energy: {
        cursorOn: "energy-fixed",
        option: {
          animation: false,
          textStyle: { color: text },
          ...frame("MWh", 8),
          series: [
            line("energy-fixed", "Fixed schedule", derived.fixedEnergy, fixedColor, true),
            ...(derived.thresholdEnergy
              ? [
                  line(
                    "energy-threshold",
                    "Price thresholds",
                    derived.thresholdEnergy,
                    thresholdColor,
                    true,
                  ),
                ]
              : []),
            {
              ...line("energy-hindsight", "Perfect hindsight", derived.hindEnergy, hindColor),
              markLine: {
                silent: true,
                symbol: "none",
                lineStyle: { color: text, type: "dashed", width: 1 },
                label: { show: true, position: "insideEndTop", fontSize: 9, formatter: "{b}" },
                data: [
                  { yAxis: Number(result.inputs.site.minimumMWh), name: "Min" },
                  { yAxis: Number(result.inputs.site.maximumMWh), name: "Max" },
                ],
              },
            },
          ],
        },
      },
      margin: {
        cursorOn: "margin-fixed",
        option: {
          animation: false,
          textStyle: { color: text },
          ...frame("AUD", 8),
          series: [
            line("margin-fixed", "Fixed schedule", derived.fixedMargin, fixedColor, true),
            ...(derived.thresholdMargin
              ? [
                  line(
                    "margin-threshold",
                    "Price thresholds",
                    derived.thresholdMargin,
                    thresholdColor,
                    true,
                  ),
                ]
              : []),
            line("margin-hindsight", "Perfect hindsight", derived.hindMargin, hindColor),
          ],
        },
      },
    };
  }, [derived, result, dark, powerStrategy]);

  return (
    <section className="charts" aria-label="Comparison charts">
      <div className="chart-grid">
        <Panel
          config={configs.price!}
          selected={selected}
          window={window}
          onSelect={setSelected}
          dark={dark}
          aria="Stored price with charge and discharge window bands and negative-price runs marked. Use the interval and window controls or the interval detail table for an accessible alternative."
        >
          <h3 className="chart-title">
            Regional price <span>AUD/MWh</span>
          </h3>
          <div className="chart-legend" aria-hidden="true">
            <span>
              <i className="sw sw-price" />
              Price
            </span>
            <span>
              <i className="sw sw-band sw-window" />
              Windows
            </span>
            <span>
              <i className="sw sw-band sw-neg" />
              Negative
            </span>
          </div>
        </Panel>
        <Panel
          config={configs.power!}
          selected={selected}
          window={window}
          onSelect={setSelected}
          dark={dark}
          aria="Grid-side power for the selected strategy: positive imports while charging, negative exports while discharging."
        >
          <h3 className="chart-title">
            Grid-side power <span>MW</span>
          </h3>
          <div className="chart-legend" aria-hidden="true">
            <span>
              <i className="sw sw-charge" />
              Charging
            </span>
            <span>
              <i className="sw sw-discharge" />
              Discharging
            </span>
          </div>
          <div className="seg" role="group" aria-label="Power strategy">
            <button
              type="button"
              className={powerStrategy === "fixed" ? "on" : ""}
              aria-pressed={powerStrategy === "fixed"}
              onClick={() => setPowerStrategy("fixed")}
            >
              Fixed
            </button>
            {threshold && (
              <button
                type="button"
                className={powerStrategy === "threshold" ? "on" : ""}
                aria-pressed={powerStrategy === "threshold"}
                onClick={() => setPowerStrategy("threshold")}
              >
                Thresholds
              </button>
            )}
            <button
              type="button"
              className={powerStrategy === "hindsight" ? "on" : ""}
              aria-pressed={powerStrategy === "hindsight"}
              onClick={() => setPowerStrategy("hindsight")}
            >
              Hindsight
            </button>
          </div>
        </Panel>
        <Panel
          config={configs.energy!}
          selected={selected}
          window={window}
          onSelect={setSelected}
          dark={dark}
          aria="Stored energy for each strategy with minimum and maximum site limits marked."
        >
          <h3 className="chart-title">
            Stored energy <span>MWh</span>
          </h3>
          <div className="chart-legend" aria-hidden="true">
            <span>
              <i className="sw sw-fixed" />
              Fixed schedule
            </span>
            {threshold && (
              <span>
                <i className="sw sw-threshold" />
                Price thresholds
              </span>
            )}
            <span>
              <i className="sw sw-hindsight" />
              Perfect hindsight
            </span>
          </div>
        </Panel>
        <Panel
          config={configs.margin!}
          selected={selected}
          window={window}
          onSelect={setSelected}
          dark={dark}
          aria="Cumulative trading margin for each strategy."
        >
          <h3 className="chart-title">
            Cumulative margin <span>AUD</span>
          </h3>
          <div className="chart-legend" aria-hidden="true">
            <span>
              <i className="sw sw-fixed" />
              Fixed schedule
            </span>
            {threshold && (
              <span>
                <i className="sw sw-threshold" />
                Price thresholds
              </span>
            )}
            <span>
              <i className="sw sw-hindsight" />
              Perfect hindsight
            </span>
          </div>
        </Panel>
      </div>
      <p className="hint">
        Price, grid-side power (positive imports, negative exports), stored energy and cumulative
        margin share one cursor. Charts use approximate plotting numbers; the readout and tables
        keep the stored values.
      </p>
      <div className="chart-controls">
        <label>
          Visible window
          <select
            value={windowIndex}
            onChange={(event) => {
              const next = Number(event.target.value);
              setWindowIndex(next);
              setSelected((current) =>
                Math.max(windows[next]!.start, Math.min(windows[next]!.end, current)),
              );
            }}
          >
            {windows.map((value, index) => (
              <option value={index} key={value.label}>
                {value.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Selected interval
          <input
            type="range"
            min={window.start}
            max={window.end}
            value={selected}
            aria-valuetext={`${endLabel(result.prices[selected]!.end, selected)} NEM UTC+10`}
            onChange={(event) => setSelected(Number(event.target.value))}
          />
        </label>
      </div>
      <p className="chart-readout" aria-live="polite">
        Interval end: <strong>{endLabel(result.prices[selected]!.end, selected)} NEM UTC+10</strong>
        <br />
        Price: <strong>{result.prices[selected]!.price} AUD/MWh</strong>
        <br />
        Fixed:{" "}
        <strong>
          {signedMw(derived.fixedMW[selected]!)} MW · {mwh(derived.fixedEnergy[selected]!)} MWh
          stored · {aud(derived.fixedMargin[selected]!)} cumulative
        </strong>
        <br />
        Hindsight:{" "}
        <strong>
          {signedMw(derived.hindMW[selected]!)} MW · {mwh(derived.hindEnergy[selected]!)} MWh stored
          · {aud(derived.hindMargin[selected]!)} cumulative
        </strong>
        {threshold && (
          <>
            <br />
            Thresholds:{" "}
            <strong>
              {signedMw(derived.thresholdMW![selected]!)} MW ·{" "}
              {mwh(derived.thresholdEnergy![selected]!)} MWh stored ·{" "}
              {aud(derived.thresholdMargin![selected]!)} cumulative
            </strong>
            {" — "}
            {thresholdAction(result, selected)}
          </>
        )}
      </p>
      <p className="hint">
        Point or tap any panel to move all four cursors. Use the controls to zoom the panels
        together; scroll and pinch remain available to navigate the page.
      </p>
    </section>
  );
}
