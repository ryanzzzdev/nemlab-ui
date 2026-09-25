import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { connect, init, use } from "echarts/core";
import type { EChartsType } from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { Result } from "./client";
import { aud, cumulativeMargins, endLabel, mwh, netMW, signedMw, thresholdAction } from "./compare";
import { useTheme } from "../components/Theme";

use([
  BarChart,
  LineChart,
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
  SVGRenderer,
]);

type PanelConfig = {
  option: Record<string, unknown>;
  cursorOn: string;
  lines?: { yAxis: number; label: string; color: string }[] | undefined;
};

function Panel({
  config,
  selected,
  onSelect,
  dark,
  aria,
  children,
}: {
  config: PanelConfig;
  selected: number;
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
    // Grouped charts share axis pointers natively — hover tooltips never touch
    // React state; only a click commits a selection.
    instance.group = "nemlab-charts";
    connect("nemlab-charts");
    instance.setOption(config.option);
    // mousedown, not click: taps on touch devices never produce a click when
    // the page shifts mid-gesture, but every press starts with mousedown.
    instance.getZr().on("mousedown", (event: { offsetX: number; offsetY: number }) => {
      const point = [event.offsetX, event.offsetY];
      if (instance.containPixel({ gridIndex: 0 }, point)) {
        const coordinate = instance.convertFromPixel({ gridIndex: 0 }, point) as number[];
        onSelect(Math.max(0, Math.min(287, Math.round(coordinate[0]!))));
      }
    });
    // A resize re-renders the axis pointer at its stale hover coordinates,
    // which can re-show the tooltip outside the new grid — clear the pointer
    // state after resizing so it cannot stick out of the viewport.
    const observer = new ResizeObserver(() => {
      instance.resize();
      instance.dispatchAction({ type: "updateAxisPointer", currTrigger: "leave" });
    });
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, [config, onSelect]);

  useEffect(() => {
    chart.current?.setOption({
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
  }, [config, selected, dark]);

  return (
    <div className="chart-card">
      <div className="chart-head">{children}</div>
      <div ref={host} className="chart-plot" role="img" aria-label={aria} />
    </div>
  );
}

type StrategyKey = "fixed" | "threshold" | "hindsight";

// Synced segmented control shared by the three strategy-dependent panels.
function Seg({
  label,
  value,
  threshold,
  onChange,
}: {
  label: string;
  value: StrategyKey;
  threshold: boolean;
  onChange: (next: StrategyKey) => void;
}) {
  const options: [StrategyKey, string][] = [
    ["fixed", "Fixed"],
    ...(threshold ? ([["threshold", "Thresholds"]] as [StrategyKey, string][]) : []),
    ["hindsight", "Hindsight"],
  ];
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([key, name]) => (
        <button
          key={key}
          type="button"
          className={value === key ? "on" : ""}
          aria-pressed={value === key}
          onClick={() => onChange(key)}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

export default function ResultCharts({ result }: { result: Result }) {
  const { dark } = useTheme();
  const [selected, setSelected] = useState(0);
  const [strategy, setStrategy] = useState<StrategyKey>("hindsight");
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
        // Keep identical interval coordinates across line and bar panels
        // (bars otherwise add half-band padding at the day edges).
        containShape: false,
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
    });
    const line = (
      id: string,
      name: string,
      data: (number | null)[],
      color: string,
      dashed = false,
      opacity = 1,
    ) => ({
      id,
      name,
      type: "line",
      showSymbol: false,
      connectNulls: false,
      lineStyle: { color, width: 1.6, opacity, ...(dashed ? { type: "dashed" as const } : {}) },
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
      strategy === "fixed"
        ? derived.fixedMW
        : strategy === "threshold" && derived.thresholdMW
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
    // Demo-style hover tooltips: a dark card beside the axis cursor showing the
    // panel's own values at that interval. Native ECharts — no React update per
    // mousemove.
    const ttColors = {
      fixed: "#94a3b8",
      threshold: "#c4b5fd",
      hindsight: "#34d399",
      price: "#fbbf24",
    };
    const title = (index: number) =>
      `${index === 0 ? "00:00" : endLabel(result.prices[index - 1]!.end, index - 1)}–${endLabel(
        result.prices[index]!.end,
        index,
      )} · interval ${index + 1}/288`;
    const rows = (entries: [name: string, color: string, value: string][]) =>
      `<table style="border-collapse:collapse;width:100%">${entries
        .map(
          ([name, color, value]) =>
            `<tr><td style="color:${color};padding:0 12px 1px 0">${name}</td><td style="text-align:right">${value}</td></tr>`,
        )
        .join("")}</table>`;
    const strategyRows = (value: (key: StrategyKey) => string) => {
      const entries: [string, string, string][] = [["Fixed", ttColors.fixed, value("fixed")]];
      if (threshold) entries.push(["Thresholds", ttColors.threshold, value("threshold")]);
      entries.push(["Hindsight", ttColors.hindsight, value("hindsight")]);
      return entries;
    };
    const tip = (body: (index: number) => string) => ({
      trigger: "axis" as const,
      confine: true,
      transitionDuration: 0,
      backgroundColor: "rgba(15,23,42,0.94)",
      borderWidth: 0,
      padding: [8, 10],
      textStyle: { color: "#e8ecf1", fontSize: 11 },
      axisPointer: {
        type: "line" as const,
        label: { show: false },
        lineStyle: { color: dark ? "#ffa48b" : "#b04a2f", width: 1 },
      },
      formatter: (params: { dataIndex?: number }[]) => {
        const index = Math.max(0, Math.min(287, params[0]?.dataIndex ?? 0));
        return `<div style="font-weight:700;color:#93c5fd;margin-bottom:3px">${title(index)}</div>${body(index)}`;
      },
    });
    return {
      price: {
        cursorOn: "price",
        lines: thresholdLines,
        option: {
          animation: false,
          textStyle: { color: text },
          ...frame("AUD/MWh", 24),
          tooltip: tip((i) =>
            rows([["Price", ttColors.price, `${result.prices[i]!.price} AUD/MWh`]]),
          ),
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
          tooltip: tip(
            (i) =>
              rows(
                strategyRows((key) =>
                  signedMw(
                    (key === "fixed"
                      ? derived.fixedMW
                      : key === "threshold"
                        ? derived.thresholdMW!
                        : derived.hindMW)[i]!,
                  ),
                ),
              ) +
              (threshold ? `<div style="margin-top:2px">${thresholdAction(result, i)}</div>` : ""),
          ),
          series: [
            ...[
              {
                id: "power-charge",
                name: "Charging",
                positive: true,
                color: dark ? "#8abaff" : "#2563eb",
              },
              {
                id: "power-discharge",
                name: "Discharging",
                positive: false,
                color: dark ? "#69d8b6" : "#0e9f6e",
              },
            ].map(({ id, name, positive, color }) => ({
              id,
              name,
              type: "bar",
              stack: "power",
              barWidth: "80%",
              itemStyle: { color },
              data: powerMW.map((value) => (positive ? Math.max(0, value) : Math.min(0, value))),
            })),
          ],
        },
      },
      energy: {
        cursorOn: "energy-fixed",
        option: {
          animation: false,
          textStyle: { color: text },
          ...frame("MWh", 8),
          tooltip: tip((i) =>
            rows(
              strategyRows(
                (key) =>
                  mwh(
                    (key === "fixed"
                      ? derived.fixedEnergy
                      : key === "threshold"
                        ? derived.thresholdEnergy!
                        : derived.hindEnergy)[i]!,
                  ) + " MWh",
              ),
            ),
          ),
          series: [
            line(
              "energy-fixed",
              "Fixed schedule",
              derived.fixedEnergy,
              fixedColor,
              true,
              strategy === "fixed" ? 1 : 0.25,
            ),
            ...(derived.thresholdEnergy
              ? [
                  line(
                    "energy-threshold",
                    "Price thresholds",
                    derived.thresholdEnergy,
                    thresholdColor,
                    true,
                    strategy === "threshold" ? 1 : 0.25,
                  ),
                ]
              : []),
            {
              ...line(
                "energy-hindsight",
                "Perfect hindsight",
                derived.hindEnergy,
                hindColor,
                false,
                strategy === "hindsight" ? 1 : 0.25,
              ),
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
          tooltip: tip((i) =>
            rows(
              strategyRows((key) =>
                aud(
                  (key === "fixed"
                    ? derived.fixedMargin
                    : key === "threshold"
                      ? derived.thresholdMargin!
                      : derived.hindMargin)[i]!,
                ),
              ),
            ),
          ),
          series: [
            line(
              "margin-fixed",
              "Fixed schedule",
              derived.fixedMargin,
              fixedColor,
              true,
              strategy === "fixed" ? 1 : 0.25,
            ),
            ...(derived.thresholdMargin
              ? [
                  line(
                    "margin-threshold",
                    "Price thresholds",
                    derived.thresholdMargin,
                    thresholdColor,
                    true,
                    strategy === "threshold" ? 1 : 0.25,
                  ),
                ]
              : []),
            line(
              "margin-hindsight",
              "Perfect hindsight",
              derived.hindMargin,
              hindColor,
              false,
              strategy === "hindsight" ? 1 : 0.25,
            ),
          ],
        },
      },
    };
  }, [derived, result, dark, strategy]);

  return (
    <section
      className="charts"
      aria-label="Comparison charts; use left and right arrow keys to move the selected interval"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        if (event.target instanceof HTMLInputElement) return;
        event.preventDefault();
        setSelected((current) =>
          Math.max(0, Math.min(287, current + (event.key === "ArrowRight" ? 1 : -1))),
        );
      }}
    >
      <div className="chart-grid">
        <Panel
          config={configs.price!}
          selected={selected}
          onSelect={setSelected}
          dark={dark}
          aria="Stored price for the full day with charge and discharge window bands and negative-price runs marked. Hover for interval values; the interval detail table is the accessible alternative."
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
          <Seg
            label="Power strategy"
            value={strategy}
            threshold={Boolean(threshold)}
            onChange={setStrategy}
          />
        </Panel>
        <Panel
          config={configs.energy!}
          selected={selected}
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
          <Seg
            label="Energy strategy"
            value={strategy}
            threshold={Boolean(threshold)}
            onChange={setStrategy}
          />
        </Panel>
        <Panel
          config={configs.margin!}
          selected={selected}
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
          <Seg
            label="Margin strategy"
            value={strategy}
            threshold={Boolean(threshold)}
            onChange={setStrategy}
          />
        </Panel>
      </div>
      <p className="hint">
        Price, grid-side power (positive imports, negative exports), stored energy and cumulative
        margin share one cursor. Hover a panel for its interval values; click or use the arrow keys
        to move the selected interval, and the energy and margin selectors emphasise the same
        strategy on every panel. Charts use approximate plotting numbers; the interval detail table
        keeps the stored values.
      </p>
    </section>
  );
}
