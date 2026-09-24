import { useEffect, useRef, useState } from "react";
import { init, use } from "echarts/core";
import type { EChartsType } from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, MarkLineComponent, DataZoomInsideComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { Series } from "./client";
import { useTheme } from "../components/Theme";

use([LineChart, GridComponent, MarkLineComponent, DataZoomInsideComponent, SVGRenderer]);

const endLabel = (instant: string, index: number) =>
  new Date(Date.parse(instant) + 10 * 3600000).toISOString().slice(11, 16) +
  (index === 287 ? " +1 day" : "");
const syntheticEnergy = (index: number) =>
  Math.round(100 * (index <= 143 ? index / 143 : (287 - index) / 144));
const windows = [
  { label: "Full day", start: 0, end: 287 },
  { label: "00:00–06:00", start: 0, end: 71 },
  { label: "06:00–12:00", start: 72, end: 143 },
  { label: "12:00–18:00", start: 144, end: 215 },
  { label: "18:00–24:00", start: 216, end: 287 },
];

export default function PriceCharts({ series }: { series: Series }) {
  const { dark } = useTheme();
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);
  const [selected, setSelected] = useState(0);
  const [windowIndex, setWindowIndex] = useState(0);
  const window = windows[windowIndex]!;
  const slot = series.intervals[selected]!;

  useEffect(() => {
    if (!host.current) return;
    const started = performance.now();
    const instance = init(host.current, undefined, { renderer: "svg" });
    chart.current = instance;
    const labels = series.intervals.map((value, index) => endLabel(value.end, index));
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
    instance.setOption({
      animation: false,
      textStyle: { color: dark ? "#9aa7b8" : "#5b6470" },
      grid: [
        { left: 65, right: 20, top: 35, height: 165 },
        { left: 65, right: 20, top: 285, height: 165 },
      ],
      xAxis: [0, 1].map((index) => ({
        type: "category",
        gridIndex: index,
        data: labels,
        boundaryGap: false,
        axisLabel: { hideOverlap: true, fontSize: 11, color: dark ? "#9aa7b8" : "#5b6470" },
        axisLine: { lineStyle: { color: dark ? "#596777" : "#b4bdc8" } },
      })),
      yAxis: [
        { type: "value", gridIndex: 0, name: "AUD/MWh", scale: true },
        { type: "value", gridIndex: 1, name: "Synthetic %", min: 0, max: 100 },
      ].map((axis) => ({
        ...axis,
        axisLabel: { color: dark ? "#9aa7b8" : "#5b6470" },
        nameTextStyle: { color: dark ? "#9aa7b8" : "#5b6470" },
        splitLine: { lineStyle: { color: dark ? "#303a47" : "#dce1e7" } },
      })),
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: [0, 1],
          disabled: true,
          filterMode: "none",
          startValue: 0,
          endValue: 287,
        },
      ],
      series: [
        {
          name: "Stored price",
          type: "line",
          xAxisIndex: 0,
          yAxisIndex: 0,
          showSymbol: false,
          connectNulls: false,
          lineStyle: { color: dark ? "#69d8b6" : "#163e35", width: 2 },
          data: series.intervals.map((value) =>
            value.state === "VALUE" ? Number(value.price) : null,
          ),
        },
        {
          name: "Synthetic energy",
          type: "line",
          xAxisIndex: 1,
          yAxisIndex: 1,
          showSymbol: false,
          lineStyle: { color: dark ? "#8abaff" : "#526da0", type: "dashed", width: 2 },
          data: series.intervals.map((_, index) => syntheticEnergy(index)),
        },
      ],
    });
    function selectAt(event: { offsetX: number; offsetY: number }) {
      const point = [event.offsetX, event.offsetY];
      for (const gridIndex of [0, 1]) {
        if (instance.containPixel({ gridIndex }, point)) {
          const coordinate = instance.convertFromPixel({ gridIndex }, point) as number[];
          const index = Math.max(0, Math.min(287, Math.round(coordinate[0]!)));
          setSelected(index);
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
  }, [series, dark]);

  useEffect(() => {
    chart.current?.setOption({
      dataZoom: [{ startValue: window.start, endValue: window.end }],
      series: [0, 1].map(() => ({
        markLine: {
          silent: true,
          symbol: "none",
          label: { show: false },
          lineStyle: { color: dark ? "#ffa48b" : "#b04a2f", width: 2, type: "solid" },
          data: [{ xAxis: selected }],
        },
      })),
    });
  }, [selected, window, series, dark]);

  return (
    <section className="chart-prototype" aria-labelledby="chart-heading">
      <h3 id="chart-heading">Linked-chart prototype</h3>
      <p>
        Top: stored prices. Bottom: <strong>synthetic energy trace</strong> for interaction testing
        only. It is not a battery simulation or observed energy data.
      </p>
      <p>
        Both panels use the same interval-end times in NEM UTC+10. Gaps stay disconnected. Charts
        use approximate plotting numbers; the readout and price table retain exact values.
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
            aria-valuetext={`${endLabel(slot.end, selected)} NEM UTC+10`}
            onChange={(event) => setSelected(Number(event.target.value))}
          />
        </label>
      </div>
      <p className="chart-readout" aria-live="polite">
        Interval end: <strong>{endLabel(slot.end, selected)} NEM UTC+10</strong>
        <br />
        Price:{" "}
        <strong>
          {slot.state === "VALUE"
            ? `${slot.price} AUD/MWh`
            : slot.state === "MISSING"
              ? "Missing"
              : "Source null"}
        </strong>
        <br />
        Synthetic energy: <strong>{syntheticEnergy(selected)}%</strong>
      </p>
      <div
        ref={host}
        className="linked-chart"
        role="img"
        aria-label="Two linked charts: stored prices and a synthetic energy trace. Use the interval and window controls or the exact price table below for an accessible alternative."
      />
      <p>
        Point or tap either panel to move both cursors. Use the controls to zoom both panels
        together; scroll and pinch remain available to navigate the page.
      </p>
    </section>
  );
}
