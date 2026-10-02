import { useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { connect, init, use } from "echarts/core";
import type { EChartsType } from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import { useTheme } from "../components/Theme";
import type { Replay } from "./client";

use([
  LineChart,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
  SVGRenderer,
]);

const GROUP = "nemlab-gridreplay";
const INTERVAL_MS = 300000;
const HOUR_MS = 3600000;

export type ReplayData = {
  days: string[];
  windowStart: number;
  count: number;
  price: (string | null)[];
  demand: (string | null)[];
  imports: (string | null)[];
  exports: (string | null)[];
  power: Record<string, (string | null)[]>;
};

// Canonical stacking order and colours for the fueltech panel.
const FUELTECH_ORDER = [
  "coal_black",
  "coal_brown",
  "gas_ccgt",
  "gas_ocgt",
  "gas_steam",
  "gas_recip",
  "distillate",
  "battery_discharging",
  "hydro",
  "wind",
  "solar_utility",
  "solar_rooftop",
  "bioenergy_biomass",
  "bioenergy_biogas",
  "battery_charging",
  "pumps",
];
const FUELTECH: Record<string, { name: string; light: string; dark: string }> = {
  coal_black: { name: "Black coal", light: "#4b5563", dark: "#8a94a3" },
  coal_brown: { name: "Brown coal", light: "#8b5a2b", dark: "#c08a50" },
  gas_ccgt: { name: "Gas CCGT", light: "#e08c3f", dark: "#f0a869" },
  gas_ocgt: { name: "Gas OCGT", light: "#f2c078", dark: "#f7d3a3" },
  gas_steam: { name: "Gas steam", light: "#c97c50", dark: "#dd9f7a" },
  gas_recip: { name: "Gas recip", light: "#d99f74", dark: "#e8bf9f" },
  distillate: { name: "Distillate", light: "#b04a2f", dark: "#d4755a" },
  battery_discharging: { name: "Batteries", light: "#7c3aed", dark: "#a78bfa" },
  hydro: { name: "Hydro", light: "#3f8ee0", dark: "#74b0ea" },
  wind: { name: "Wind", light: "#3d9d72", dark: "#63c196" },
  solar_utility: { name: "Utility solar", light: "#e3a008", dark: "#f0c04d" },
  solar_rooftop: { name: "Rooftop solar", light: "#f7d154", dark: "#f9e08e" },
  bioenergy_biomass: { name: "Biomass", light: "#7a9a4e", dark: "#a0bd72" },
  bioenergy_biogas: { name: "Biogas", light: "#a4c16d", dark: "#c4d795" },
  battery_charging: { name: "Battery charging", light: "#b8a6e8", dark: "#8f7bd8" },
  pumps: { name: "Pumped hydro", light: "#5b8dd9", dark: "#8db3e8" },
};

const numbers = (values: (string | null)[]) =>
  values.map((value) => (value === null ? null : Number(value)));

function Panel({
  option,
  cursor,
  span,
  onSelect,
  count,
  dark,
  aria,
  children,
}: {
  option: Record<string, unknown>;
  cursor: number;
  span: [number, number];
  onSelect: (index: number) => void;
  count: number;
  dark: boolean;
  aria: string;
  children: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const instance = init(host.current, undefined, { renderer: "svg" });
    chart.current = instance;
    instance.group = GROUP;
    connect(GROUP);
    instance.setOption(option);
    instance.getZr().on("mousedown", (event: { offsetX: number; offsetY: number }) => {
      const point = [event.offsetX, event.offsetY];
      if (instance.containPixel({ gridIndex: 0 }, point)) {
        const coordinate = instance.convertFromPixel({ gridIndex: 0 }, point) as number[];
        onSelect(Math.max(0, Math.min(count - 1, Math.round(coordinate[0]!))));
      }
    });
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
  }, [option, onSelect, count]);

  // The invisible `cursor` series owns the moving mark line and the event
  // highlight; per-data-series marks (zero line, day boundaries, negative
  // runs) are static and never touched here.
  useEffect(() => {
    chart.current?.setOption({
      series: [
        {
          id: "cursor",
          markLine: {
            silent: true,
            symbol: "none",
            label: { show: false },
            lineStyle: { color: dark ? "#ffa48b" : "#b04a2f", width: 2, type: "solid" },
            data: [{ xAxis: cursor }],
          },
          markArea: {
            silent: true,
            itemStyle: {
              color: dark ? "rgba(138,186,255,0.08)" : "rgba(82,109,160,0.10)",
            },
            label: { show: false },
            data: [[{ xAxis: span[0] }, { xAxis: span[1] }]],
          },
        },
      ],
    });
  }, [cursor, span, dark]);

  return (
    <div className="chart-card">
      <div className="chart-head">{children}</div>
      <div ref={host} className="chart-plot" role="img" aria-label={aria} />
    </div>
  );
}

export default function ReplayCharts({
  replay,
  data,
  cursor,
  span,
  onSelect,
}: {
  replay: Replay;
  data: ReplayData;
  cursor: number;
  span: [number, number];
  onSelect: (index: number) => void;
}) {
  const { dark } = useTheme();
  const labels = useMemo(
    () =>
      Array.from({ length: data.count }, (_, index) =>
        new Date(data.windowStart + (index + 1) * INTERVAL_MS + 10 * HOUR_MS)
          .toISOString()
          .slice(11, 16),
      ),
    [data],
  );

  const configs = useMemo(() => {
    const text = dark ? "#9aa7b8" : "#5b6470";
    const rule = dark ? "#303a47" : "#dce1e7";
    const axisLine = dark ? "#596777" : "#b4bdc8";
    const boundaryLines = data.days.slice(1).map((day, index) => ({
      xAxis: (index + 1) * 288 - 0.5,
      label: {
        show: true,
        position: "insideEndTop" as const,
        formatter: day,
        fontSize: 9,
        color: text,
      },
      lineStyle: { color: text, type: "dashed" as const, width: 1 },
    }));
    const frame = (name: string, top: number) => ({
      grid: { left: 48, right: 12, top, bottom: 20 },
      xAxis: {
        type: "category",
        data: labels,
        boundaryGap: false,
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
    const title = (index: number) =>
      `${data.days[Math.floor(index / 288)]} · interval ${(index % 288) + 1}/288`;
    const rows = (entries: [name: string, color: string, value: string][]) =>
      `<table style="border-collapse:collapse;width:100%">${entries
        .map(
          ([name, color, value]) =>
            `<tr><td style="color:${color};padding:0 12px 1px 0">${name}</td><td style="text-align:right">${value}</td></tr>`,
        )
        .join("")}</table>`;
    // Exact stored strings in tooltips; charts plot approximate numbers.
    const at = (values: (string | null)[], index: number, unit: string) =>
      values[index] === null || values[index] === undefined
        ? "missing"
        : `${values[index]} ${unit}`;
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
        const index = Math.max(0, Math.min(data.count - 1, params[0]?.dataIndex ?? 0));
        return `<div style="font-weight:700;color:#93c5fd;margin-bottom:3px">${title(index)}</div>${body(index)}`;
      },
    });

    const price = numbers(data.price);
    const negativeRuns: [number, number][] = [];
    let runStart = -1;
    price.forEach((value, index) => {
      if (value !== null && value < 0 && runStart < 0) runStart = index;
      if ((value === null || value >= 0) && runStart >= 0) {
        negativeRuns.push([runStart, index - 1]);
        runStart = -1;
      }
    });
    if (runStart >= 0) negativeRuns.push([runStart, data.count - 1]);

    const boundaryMark = {
      silent: true,
      symbol: "none",
      label: { show: false },
      lineStyle: { color: text, type: "dashed" as const, width: 1 },
      data: boundaryLines,
    };
    const cursorSeries = { id: "cursor", type: "line", data: [] as number[] };
    const fueltechs = [
      ...FUELTECH_ORDER.filter((key) => key in data.power),
      ...Object.keys(data.power).filter((key) => !(key in FUELTECH)),
    ];

    return {
      price: {
        option: {
          animation: false,
          textStyle: { color: text },
          ...frame("AUD/MWh", 24),
          tooltip: tip((i) => rows([["Price", "#fbbf24", at(data.price, i, "AUD/MWh")]])),
          series: [
            cursorSeries,
            {
              name: "Regional price",
              type: "line",
              showSymbol: false,
              connectNulls: false,
              lineStyle: { color: dark ? "#ffb020" : "#b45309", width: 1.6 },
              itemStyle: { color: dark ? "#ffb020" : "#b45309" },
              data: price,
              markArea: {
                silent: true,
                data: negativeRuns.map(([from, to]) => [
                  {
                    xAxis: from,
                    itemStyle: {
                      color: dark ? "rgba(255,110,90,0.10)" : "rgba(179,38,30,0.08)",
                    },
                  },
                  { xAxis: to },
                ]),
              },
              markLine: {
                ...boundaryMark,
                data: [{ yAxis: 0 }, ...boundaryLines],
              },
            },
          ],
        },
      },
      demand: {
        option: {
          animation: false,
          textStyle: { color: text },
          ...frame("MW", 24),
          tooltip: tip((i) => rows([["Demand", "#8abaff", at(data.demand, i, "MW")]])),
          series: [
            cursorSeries,
            {
              name: "Scheduled demand",
              type: "line",
              showSymbol: false,
              connectNulls: false,
              areaStyle: { opacity: dark ? 0.16 : 0.12 },
              lineStyle: { color: dark ? "#8abaff" : "#2563eb", width: 1.6 },
              itemStyle: { color: dark ? "#8abaff" : "#2563eb" },
              data: numbers(data.demand),
              markLine: boundaryMark,
            },
          ],
        },
      },
      generation: {
        option: {
          animation: false,
          textStyle: { color: text },
          ...frame("MW", 34),
          legend: {
            top: 0,
            icon: "rect",
            itemWidth: 10,
            itemHeight: 3,
            textStyle: { color: text, fontSize: 10 },
          },
          tooltip: tip((i) =>
            rows(
              fueltechs.map((key) => [
                FUELTECH[key]?.name ?? key,
                (dark ? FUELTECH[key]?.dark : FUELTECH[key]?.light) ?? "#94a3b8",
                at(data.power[key]!, i, "MW"),
              ]),
            ),
          ),
          series: [
            cursorSeries,
            ...fueltechs.map((key, index) => ({
              name: FUELTECH[key]?.name ?? key,
              type: "line",
              stack: "generation",
              showSymbol: false,
              connectNulls: false,
              areaStyle: { opacity: 0.75 },
              lineStyle: {
                color: (dark ? FUELTECH[key]?.dark : FUELTECH[key]?.light) ?? "#94a3b8",
                width: 0.8,
              },
              itemStyle: {
                color: (dark ? FUELTECH[key]?.dark : FUELTECH[key]?.light) ?? "#94a3b8",
              },
              emphasis: { focus: "series" },
              data: numbers(data.power[key]!),
              ...(index === 0 ? { markLine: boundaryMark } : {}),
            })),
          ],
        },
      },
      flows: {
        option: {
          animation: false,
          textStyle: { color: text },
          ...frame("MW", 24),
          tooltip: tip((i) =>
            rows([
              ["Imports", "#34d399", at(data.imports, i, "MW")],
              ["Exports", "#f87171", at(data.exports, i, "MW")],
            ]),
          ),
          series: [
            cursorSeries,
            {
              name: "Imports",
              type: "line",
              showSymbol: false,
              connectNulls: false,
              lineStyle: { color: dark ? "#69d8b6" : "#0e9f6e", width: 1.6 },
              itemStyle: { color: dark ? "#69d8b6" : "#0e9f6e" },
              data: numbers(data.imports),
              markLine: {
                ...boundaryMark,
                data: [{ yAxis: 0 }, ...boundaryLines],
              },
            },
            {
              name: "Exports",
              type: "line",
              showSymbol: false,
              connectNulls: false,
              lineStyle: { color: dark ? "#f0a090" : "#c2410c", width: 1.6 },
              itemStyle: { color: dark ? "#f0a090" : "#c2410c" },
              data: numbers(data.exports).map((value) => (value === null ? null : -value)),
            },
          ],
        },
      },
    };
  }, [data, dark, labels]);

  return (
    <section
      className="charts replay-charts"
      aria-label="Replay charts; use left and right arrow keys to move the cursor"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        if (event.target instanceof HTMLInputElement) return;
        event.preventDefault();
        onSelect(
          Math.max(0, Math.min(data.count - 1, cursor + (event.key === "ArrowRight" ? 1 : -1))),
        );
      }}
    >
      <div className="chart-grid">
        <Panel
          option={configs.price!.option}
          cursor={cursor}
          span={span}
          onSelect={onSelect}
          count={data.count}
          dark={dark}
          aria={`Regional price across the replay window, ${replay.event.marketDay}. The detected event is highlighted and negative-price runs are shaded.`}
        >
          <h3 className="chart-title">
            Regional price <span>AUD/MWh</span>
          </h3>
        </Panel>
        <Panel
          option={configs.demand!.option}
          cursor={cursor}
          span={span}
          onSelect={onSelect}
          count={data.count}
          dark={dark}
          aria="Scheduled demand across the replay window."
        >
          <h3 className="chart-title">
            Scheduled demand <span>MW</span>
          </h3>
        </Panel>
        <Panel
          option={configs.generation!.option}
          cursor={cursor}
          span={span}
          onSelect={onSelect}
          count={data.count}
          dark={dark}
          aria="Generation stacked by fuel technology across the replay window."
        >
          <h3 className="chart-title">
            Generation by technology <span>MW</span>
          </h3>
        </Panel>
        <Panel
          option={configs.flows!.option}
          cursor={cursor}
          span={span}
          onSelect={onSelect}
          count={data.count}
          dark={dark}
          aria="Regional imports above zero and exports below zero across the replay window."
        >
          <h3 className="chart-title">
            Regional flows <span>MW</span>
          </h3>
        </Panel>
      </div>
    </section>
  );
}
