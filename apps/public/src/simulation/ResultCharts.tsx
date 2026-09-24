import { useEffect, useMemo, useRef, useState } from "react";
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
import { aud, cumulativeMargins, endLabel, mwh, netMW, signedMw } from "./compare";
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
const cursorGrids = ["price", "power-fixed", "energy-fixed", "margin-fixed"];

export default function ResultCharts({ result }: { result: Result }) {
  const { dark } = useTheme();
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);
  const [selected, setSelected] = useState(0);
  const [windowIndex, setWindowIndex] = useState(0);
  const window = windows[windowIndex]!;

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
      negativeRuns: runs,
    };
  }, [result]);

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
    const text = dark ? "#9aa7b8" : "#5b6470";
    const rule = dark ? "#303a47" : "#dce1e7";
    const axisLine = dark ? "#596777" : "#b4bdc8";
    const bands = [
      { name: "Charge window", from: result.inputs.windows.chargeStart / 5, tone: "window" },
      { name: "Discharge window", from: result.inputs.windows.dischargeStart / 5, tone: "window" },
      ...derived.negativeRuns.map(([from]) => ({ name: "", from, tone: "negative" })),
    ];
    const ends = [
      result.inputs.windows.chargeEnd / 5 - 1,
      result.inputs.windows.dischargeEnd / 5 - 1,
      ...derived.negativeRuns.map(([, to]) => to),
    ];
    const axis = (index: number, name: string) => ({
      type: "value" as const,
      gridIndex: index,
      name,
      scale: true,
      axisLabel: { color: text },
      nameTextStyle: { color: text },
      splitLine: { lineStyle: { color: rule } },
    });
    const strategy = (
      id: string,
      name: string,
      gridIndex: number,
      data: number[],
      color: string,
      dashed: boolean,
    ) => ({
      id,
      name,
      type: "line" as const,
      xAxisIndex: gridIndex,
      yAxisIndex: gridIndex,
      showSymbol: false,
      lineStyle: { color, width: 2, ...(dashed ? { type: "dashed" as const } : {}) },
      data,
    });
    const fixedColor = dark ? "#8abaff" : "#526da0";
    const hindColor = dark ? "#69d8b6" : "#0e7a5f";
    instance.setOption({
      animation: false,
      textStyle: { color: text },
      grid: [45, 235, 425, 615].map((top) => ({
        left: 65,
        right: 20,
        top,
        height: 140,
      })),
      xAxis: [0, 1, 2, 3].map((index) => ({
        type: "category",
        gridIndex: index,
        data: derived.labels,
        boundaryGap: false,
        axisLabel: { hideOverlap: true, fontSize: 11, color: text },
        axisLine: { lineStyle: { color: axisLine } },
      })),
      yAxis: [axis(0, "AUD/MWh"), axis(1, "MW"), axis(2, "MWh"), axis(3, "AUD")],
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: [0, 1, 2, 3],
          disabled: true,
          filterMode: "none",
          startValue: 0,
          endValue: 287,
        },
      ],
      series: [
        {
          id: "price",
          name: "Stored price",
          type: "line",
          xAxisIndex: 0,
          yAxisIndex: 0,
          showSymbol: false,
          lineStyle: { color: dark ? "#ffb020" : "#925800", width: 2 },
          data: derived.prices,
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
                  fontSize: 10,
                  color: text,
                },
              },
              { xAxis: ends[index] },
            ]),
          },
        },
        strategy("power-fixed", "Fixed power", 1, derived.fixedMW, fixedColor, true),
        strategy("power-hindsight", "Hindsight power", 1, derived.hindMW, hindColor, false),
        strategy("energy-fixed", "Fixed energy", 2, derived.fixedEnergy, fixedColor, true),
        {
          ...strategy(
            "energy-hindsight",
            "Hindsight energy",
            2,
            derived.hindEnergy,
            hindColor,
            false,
          ),
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { color: text, type: "dashed", width: 1 },
            label: { show: true, position: "insideEndTop", fontSize: 10, formatter: "{b}" },
            data: [
              { yAxis: Number(result.inputs.site.minimumMWh), name: "Min" },
              { yAxis: Number(result.inputs.site.maximumMWh), name: "Max" },
            ],
          },
        },
        strategy("margin-fixed", "Fixed margin", 3, derived.fixedMargin, fixedColor, true),
        strategy("margin-hindsight", "Hindsight margin", 3, derived.hindMargin, hindColor, false),
      ],
    });
    function selectAt(event: { offsetX: number; offsetY: number }) {
      const point = [event.offsetX, event.offsetY];
      for (const gridIndex of [0, 1, 2, 3]) {
        if (instance.containPixel({ gridIndex }, point)) {
          const coordinate = instance.convertFromPixel({ gridIndex }, point) as number[];
          setSelected(Math.max(0, Math.min(287, Math.round(coordinate[0]!))));
          break;
        }
      }
    }
    instance.getZr().on("mousemove", selectAt);
    instance.getZr().on("click", selectAt);
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, [derived, result, dark]);

  useEffect(() => {
    chart.current?.setOption({
      dataZoom: [{ startValue: window.start, endValue: window.end }],
      series: cursorGrids.map((id) => ({
        id,
        markLine: {
          silent: true,
          symbol: "none",
          label: { show: false },
          lineStyle: { color: dark ? "#ffa48b" : "#b04a2f", width: 2, type: "solid" },
          data: [{ xAxis: selected }],
        },
      })),
    });
  }, [selected, window, dark]);

  return (
    <section className="chart-prototype" aria-labelledby="result-chart-heading">
      <h3 id="result-chart-heading">Linked result charts</h3>
      <p>
        Price, grid-side power (positive imports, negative exports), stored energy and cumulative
        margin for both strategies. All four panels share the same interval-end times in NEM UTC+10;
        shaded bands mark the operating windows and negative-price runs.
      </p>
      <p>Charts use approximate plotting numbers; the readout and tables keep the stored values.</p>
      <p className="chart-legend" aria-hidden="true">
        <span>
          <i className="sw sw-price" />
          Stored price
        </span>
        <span>
          <i className="sw sw-fixed" />
          Fixed schedule
        </span>
        <span>
          <i className="sw sw-hindsight" />
          Perfect hindsight
        </span>
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
      </p>
      <div
        ref={host}
        className="linked-chart result-chart"
        role="img"
        aria-label="Four linked charts: stored price, grid-side power, stored energy and cumulative margin for the fixed schedule and perfect hindsight. Use the interval and window controls or the interval table below for an accessible alternative."
      />
      <p>
        Point or tap any panel to move all four cursors. Use the controls to zoom the panels
        together; scroll and pinch remain available to navigate the page.
      </p>
    </section>
  );
}
