# NEMLab public UI standards

Conventions established while building BatteryLab and the Prices explorer. New
pages should reuse these patterns rather than inventing parallel ones. When a
rule has a CSS class or component, use it; do not restyle per page.

## Page structure

- Every page renders through `Page` (`apps/public/src/components/Page.tsx`):
  eyebrow (uppercase section label), `<h1>` as a question or plain statement,
  then a full-width `.intro` paragraph, then content.
- `.intro` has **no width cap** — it spans the content column. Keep it to a
  single descriptive line at desktop width where practical; it may wrap on
  narrow viewports. Name what the page compares or does, plainly.
- Headings state the visitor's question, e.g. "What could a battery do in a
  market day?" — not feature names.

## Layout and cards

- Content lives in bordered panels (`.card`, `.chart-card`, `.scenario-form`):
  `background: var(--color-panel)`, `border: 1px solid var(--color-rule)`,
  `border-radius: 10px`.
- Form-in-a-column layouts put the compact control card beside a wider result
  area (`.lab-layout`); at narrow widths they stack — never allow horizontal
  overflow at 320px (there is a browser test that asserts this).

## Forms

- **Compact controls**: inside `.scenario-fields`, every input/select is a
  uniform `height: 32px`, `padding: 7px 9px`, `font-size: 13px`. This includes
  `input[type="date"]` — date pickers must be constrained explicitly or they
  render taller than text inputs.
- Elsewhere, interactive elements keep `min-height: 44px` (touch target).
- **Collapsible groups**: long forms group fields in native
  `<details>`/`<summary>` disclosures. The first/most important group opens by
  default; the rest start collapsed. Pattern in
  `BatteryWorkspace.tsx` (`section()` helper):
  - A group containing a field with a validation error is forced open _before_
    focus lands on the invalid input — never leave an `aria-invalid` control
    hidden.
  - Each group keeps an inner `<fieldset>` carrying `disabled` state and a
    visually hidden `<legend>` (`.sr-only`) for the accessible name.
- Labels sit above inputs; every labelled element gets an `id`/`aria-labelledby`
  pair and `aria-describedby` pointing at its `error-<field>` element when
  invalid.
- Explanatory micro-copy uses `.hint` (small muted text) inside the relevant
  group, next to the fields it qualifies — not in a footer.
- Validation focuses the first invalid control; error text is specific and
  states the accepted format (e.g. exact signed decimals, negative allowed).

## Buttons and selectors

- One `.primary` button for the page's main action, full width in compact form
  cards.
- `.ghost` for secondary actions (Copy result link, Stop checking, Resume
  checking).
- `.seg` segmented control for mutually exclusive **view** options (e.g.
  strategy selection). The same selection should be offered on every panel it
  affects and stay **synchronised** — one shared state, one `aria-pressed` truth.
- Status chips (`.job-chip`) carry Ready/Queued/Working/Complete/Failed;
  transient messages sit beside them in `.job-message`; errors use
  `role="alert"`.

## Disclosures

- Use native `<details>`/`<summary>` for any collapsed content — exact data
  tables, methodology, long metadata. The summary is styled like a section
  label (small, semibold, muted) with a focus-visible outline.
- Do not build disclosure widgets with buttons + hidden divs; the native
  element gives keyboard and screen-reader behaviour for free.

## Tables

- **Metadata**: two-column label/value tables (`.job-meta`) — fixed layout,
  ~104px semibold label column, thin row separators, placed _below_ the
  interactive content they describe.
- **Data tables**: wrap in `.price-table` (`max-height: 420px;
overflow: auto`, focusable region with `aria-label`). Cells are
  `white-space: nowrap` — long content scrolls inside the region, not the page.
- **Long identifiers** (UUIDs, revisions, version tags): never wrap mid-token.
  Use `.ellip` (`overflow: hidden; text-overflow: ellipsis; white-space:
nowrap`) with the full value duplicated in `title`. Note: the global
  `th, td { white-space: nowrap }` rule means plain cells must opt back into
  wrapping (`white-space: normal`) and the `td` needs `overflow: hidden` for
  ellipsis to clip.
- Never render `NaN`, `Infinity`, or undefined averages — explain one-sided or
  empty cases in words ("exported 0.000 MWh across 0 intervals").

## Charts

- ECharts via tree-shaken `echarts/core` imports, **SVG renderer**,
  `animation: false`. Shared grid/axis config through a `frame()` helper so all
  panels share x-axis interval coordinates (keep `boundaryGap: false` +
  `containShape: false` on category axes — bar padding otherwise shifts the
  shared cursor).
- Panels live in `.chart-grid` inside `.chart-card` with a `.chart-head`
  carrying title + HTML legend + optional `.seg` control.
- **Hover is native, click is React.** Axis tooltips (`trigger: "axis"` +
  `connect()`ed chart groups) show a dark card with an interval header and the
  panel's own per-series rows — synchronized across panels. Do **not** route
  hover through React state: a `mousemove → setState → setOption` loop per
  panel is what made the cursor feel heavy. Tooltips render per mousemove for
  free in ECharts.
- The **selected** interval is a discrete state (mark line + slider +
  `.chart-readout`) set by click, arrow keys on the charts region, or the
  window/slider controls. `aria-live` belongs only on these discrete updates —
  never on per-hover text.
- **Emphasise, don't hide**: when a panel shows multiple strategy series and
  one is selected, dim the rest (`lineStyle.opacity ≈ 0.25`) — comparison is
  the chart's purpose. Power bars are the exception (single strategy can't
  overlay).
- Chart values shown in tooltips/readouts keep exact stored precision; a hint
  notes "charts use approximate plotting numbers; the readout and tables keep
  the stored values."
- Every chart gets `role="img"` + `aria-label` describing what it plots and
  pointing keyboard/AT users to the readout, slider, and detail table.

## Strategy colour language

Consistent across charts, legends, stat cards and breakdown columns:

| Strategy              | Colour                            | Style            |
| --------------------- | --------------------------------- | ---------------- |
| Fixed schedule        | slate/gray                        | dashed line      |
| Price thresholds      | violet                            | dotted line      |
| Perfect hindsight     | teal/green                        | solid line       |
| Stored price          | amber                             | solid line       |
| Charging bars         | blue                              |                  |
| Discharging bars      | green                             |                  |
| Threshold price lines | blue (charge) / green (discharge) | dashed, labelled |

Dark theme uses the lightened variants already defined in `ResultCharts.tsx`
and `styles.css` — check legibility in both.

## Honesty and copy

- Exact decimal strings for all money/energy/price values end to end; display
  rounding happens only at the presentation edge and is flagged ("Display
  rounded to cents and thousandths; stored values are unrounded").
- State scope caveats next to the thing they qualify: e.g. terminal-energy
  equality applies "for the fixed schedule and hindsight strategies; price
  thresholds may differ"; threshold margin is "not a like-for-like
  comparison".
- Benchmark framing: hindsight "saw every price before choosing" — never imply
  forecastability.
- Footer disclaimer on anything resembling advice: "Illustrative defaults, not
  investment recommendations." Page footer: "Historical analysis and
  experiments. No live trading."
- Timezone is always stated: "NEM UTC+10". Units in labels: "Capacity (MWh)",
  "Charge start (HH:MM)".

## Accessibility

- Prefer native semantics: `fieldset`/`legend`, `details`/`summary`, `radio`
  groups, `table` with `caption` and `scope="row"` headers.
- One h1 per page, `tabIndex={-1}` for focus-after-navigation; skip link goes
  to `main`.
- `.sr-only` for labels that must exist for AT but not visually.
- Keyboard path must reach everything: disclosures are focusable, charts
  accept arrow keys, `.price-table` regions are `tabIndex={0}` scroll areas.
- `focus-visible` outlines only (no focus ring on mouse click).
- Every interactive control needs an accessible name; `aria-pressed` for
  toggles, `aria-invalid`/`aria-describedby` for errors.

## Verification expectations

Any UI change is expected to hold under:

- `npm run check` (contract check, Prettier, build, full Playwright suite on
  desktop + mobile projects).
- 320px no-horizontal-overflow assertions.
- Light, dark and auto themes — spot-check screenshots for new coloured
  surfaces.
- Keyboard-only navigation to every interactive element.
- `npm run test:live` when the submission/data path changes; presentation-only
  changes may skip it but say so in the records.
