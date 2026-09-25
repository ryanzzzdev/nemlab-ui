import { useEffect, useRef, useState } from "react";
import { init, use } from "echarts/core";
import type { EChartsType } from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { Series } from "./client";
import { useTheme } from "../components/Theme";

use([LineChart, GridComponent, MarkLineComponent, TooltipComponent, SVGRenderer]);

const endLabel = (instant: string, index: number) =>
  new Date(Date.parse(instant) + 10 * 3600000).toISOString().slice(11, 16) +
  (index === 287 ? " +1 day" : "");

export default function PriceCharts({ series }: { series: Series }) {
  const { dark } = useTheme();
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);
  const [selected, setSelected] = useState(0);

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
      tooltip: {
        trigger: "axis",
        confine: true,
        transitionDuration: 0,
        backgroundColor: "rgba(15,23,42,0.94)",
        borderWidth: 0,
        padding: [8, 10],
        textStyle: { color: "#e8ecf1", fontSize: 11 },
        axisPointer: {
          type: "line",
          label: { show: false },
          lineStyle: { color: dark ? "#ffa48b" : "#b04a2f", width: 1 },
        },
        formatter: (params: { dataIndex?: number }[]) => {
          const index = Math.max(0, Math.min(287, params[0]?.dataIndex ?? 0));
          const slot = series.intervals[index]!;
          const start =
            index === 0 ? "00:00" : endLabel(series.intervals[index - 1]!.end, index - 1);
          const value =
            slot.state === "VALUE"
              ? `${slot.price} AUD/MWh`
              : slot.state === "MISSING"
                ? "Missing"
                : "Source null";
          return (
            `<div style="font-weight:700;color:#93c5fd;margin-bottom:3px">${start}–${endLabel(
              slot.end,
              index,
            )} · interval ${index + 1}/288</div>` +
            `<table style="border-collapse:collapse;width:100%"><tr>` +
            `<td style="color:#fbbf24;padding:0 12px 1px 0">Price</td>` +
            `<td style="text-align:right">${value}</td></tr></table>`
          );
        },
      },
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
    // mousedown, not click: taps on touch devices never produce a click when
    // the page shifts mid-gesture, but every press starts with mousedown.
    instance.getZr().on("mousedown", (event: { offsetX: number; offsetY: number }) => {
      const point = [event.offsetX, event.offsetY];
      if (instance.containPixel({ gridIndex: 0 }, point)) {
        const coordinate = instance.convertFromPixel({ gridIndex: 0 }, point) as number[];
        setSelected(Math.max(0, Math.min(287, Math.round(coordinate[0]!))));
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
  }, [series, dark]);

  useEffect(() => {
    chart.current?.setOption({
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
  }, [selected, series, dark]);

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
        aria-label="Stored price chart. Gaps stay disconnected. Hover for interval values, click or use the arrow keys to move the cursor, or use the exact interval table for an accessible alternative."
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          setSelected((current) =>
            Math.max(0, Math.min(287, current + (event.key === "ArrowRight" ? 1 : -1))),
          );
        }}
      />
      <p className="hint">
        Hover the chart for interval values; click or use the arrow keys to move the cursor. The
        chart uses approximate plotting numbers; the exact interval table keeps the stored values.
      </p>
    </div>
  );
}
