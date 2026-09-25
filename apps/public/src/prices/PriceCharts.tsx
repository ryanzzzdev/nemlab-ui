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
    const text = dark ? "#9aa7b8" : "#5b6470";
    instance.setOption({
      animation: false,
      textStyle: { color: text },
      grid: [{ left: 48, right: 12, top: 14, bottom: 22 }],
      xAxis: {
        type: "category",
        data: labels,
        boundaryGap: false,
        axisLabel: { hideOverlap: true, fontSize: 10, color: text },
        axisLine: { lineStyle: { color: dark ? "#596777" : "#b4bdc8" } },
      },
      yAxis: {
        type: "value",
        name: "AUD/MWh",
        scale: true,
        axisLabel: { color: text, fontSize: 10 },
        nameTextStyle: { color: text },
        splitLine: { lineStyle: { color: dark ? "#303a47" : "#dce1e7" } },
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
      series: [
        {
          id: "price",
          name: "Stored price",
          type: "line",
          showSymbol: false,
          connectNulls: false,
          lineStyle: { color: dark ? "#ffb020" : "#b45309", width: 1.6 },
          data: series.intervals.map((value) =>
            value.state === "VALUE" ? Number(value.price) : null,
          ),
        },
      ],
    });
    function selectAt(event: { offsetX: number; offsetY: number }) {
      const point = [event.offsetX, event.offsetY];
      if (instance.containPixel({ gridIndex: 0 }, point)) {
        const coordinate = instance.convertFromPixel({ gridIndex: 0 }, point) as number[];
        setSelected(Math.max(0, Math.min(287, Math.round(coordinate[0]!))));
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
      series: [
        {
          id: "price",
          markLine: {
            silent: true,
            symbol: "none",
            label: { show: false },
            lineStyle: { color: dark ? "#ffa48b" : "#b04a2f", width: 2, type: "solid" },
            data: [{ xAxis: selected }],
          },
        },
      ],
    });
  }, [selected, window, series, dark]);

  return (
    <div className="chart-card">
      <div className="chart-head">
        <h3 className="chart-title">
          Stored price <span>AUD/MWh</span>
        </h3>
        <div className="chart-legend" aria-hidden="true">
          <span>
            <i className="sw sw-price" />
            Price
          </span>
          <span>
            <i className="sw sw-band sw-gap" />
            Gap
          </span>
        </div>
      </div>
      <div
        ref={host}
        className="chart-plot"
        role="img"
        aria-label="Stored price chart. Gaps stay disconnected. Use the interval and window controls or the exact interval table for an accessible alternative."
      />
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
      </p>
      <p className="hint">
        Point or tap the chart to move the cursor. Use the controls to zoom; scroll and pinch remain
        available to navigate the page. The chart uses approximate plotting numbers; the readout and
        exact table keep the stored values.
      </p>
    </div>
  );
}
