import type { components } from "../../../../contracts/generated/schema";
import { marketDay, nextDay, validDay } from "../prices/client";

export type Request = components["schemas"]["SimulationRequest"];
export const fields = {
  capacityMWh: ["Capacity (MWh)", "2"],
  minimumMWh: ["Minimum energy (MWh)", "0"],
  maximumMWh: ["Maximum energy (MWh)", "2"],
  initialMWh: ["Initial energy (MWh)", "0"],
  chargeMW: ["Charge power (MW)", "1"],
  dischargeMW: ["Discharge power (MW)", "1"],
  importLimitMW: ["Import limit (MW)", "1"],
  exportLimitMW: ["Export limit (MW)", "1"],
  roundTrip: ["Round-trip efficiency (0–1)", "0.9"],
  charge: ["Charge efficiency (0–1)", "0.95"],
  discharge: ["Discharge efficiency (0–1)", "0.95"],
  importFee: ["Import fee (AUD/MWh)", "0"],
  exportFee: ["Export fee (AUD/MWh)", "0"],
  degradationPerExportedMWh: ["Degradation (AUD/exported MWh)", "0"],
  chargeStart: ["Charge start (HH:MM)", "10:00"],
  chargeEnd: ["Charge end (HH:MM)", "14:00"],
  dischargeStart: ["Discharge start (HH:MM)", "17:00"],
  dischargeEnd: ["Discharge end (HH:MM)", "21:00"],
  chargeBelow: ["Charge below (AUD/MWh)", "30"],
  dischargeAbove: ["Discharge above (AUD/MWh)", "150"],
} as const;
export type Field = keyof typeof fields;
export type Form = Record<Field, string> & {
  region: Request["region"];
  day: string;
  efficiencyMode: "roundTrip" | "legs";
  thresholdEnabled: boolean;
};
export type Errors = Partial<Record<keyof Form, string>>;
export const initialForm = (): Form => ({
  ...(Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value[1]])) as Record<
    Field,
    string
  >),
  region: "NSW1",
  day: nextDay(marketDay(), -1),
  efficiencyMode: "roundTrip",
  thresholdEnabled: false,
});
export const siteFields = [
  "capacityMWh",
  "minimumMWh",
  "maximumMWh",
  "initialMWh",
  "chargeMW",
  "dischargeMW",
  "importLimitMW",
  "exportLimitMW",
] as const;
export const costFields = ["importFee", "exportFee", "degradationPerExportedMWh"] as const;
export const windowFields = ["chargeStart", "chargeEnd", "dischargeStart", "dischargeEnd"] as const;

// Fixed-scale integers compare decimal bounds without rounding through a JS Number.
function decimal(value: string, signed = false): bigint | null {
  const pattern = signed ? /^-?\d+(?:\.\d{1,18})?$/ : /^\d+(?:\.\d{1,18})?$/;
  if (
    !pattern.test(value) ||
    value.replace("-", "").replace(".", "").replace(/^0+/, "").length > 38
  )
    return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole! + fraction.padEnd(18, "0"));
}
function minutes(value: string): number {
  if (value === "24:00") return 1440;
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return NaN;
  const [hours, mins] = value.split(":").map(Number);
  return hours! * 60 + mins!;
}
export function prepare(form: Form): { errors: Errors; request?: Request } {
  const errors: Errors = {};
  if (!validDay(form.day))
    errors.day = "Choose a completed NEM day from 2021-10-01 through yesterday (UTC+10).";
  const values: Partial<Record<Field, bigint>> = {};
  const efficiencies: Field[] =
    form.efficiencyMode === "roundTrip" ? ["roundTrip"] : ["charge", "discharge"];
  for (const key of [...siteFields, ...costFields, ...efficiencies]) {
    const value = decimal(form[key]);
    const efficiency = efficiencies.includes(key);
    const min = efficiency ? decimal(key === "roundTrip" ? "0.0001" : "0.01")! : 0n;
    const max = decimal(efficiency ? "1" : "1000000")!;
    if (value === null)
      errors[key] =
        "Enter a nonnegative decimal, up to 18 decimal places and 38 significant digits. No exponent notation.";
    else if (value < min || value > max || (key === "capacityMWh" && value === 0n))
      errors[key] = efficiency
        ? `Enter a value from ${key === "roundTrip" ? "0.0001" : "0.01"} to 1.`
        : "Enter a value up to 1,000,000; capacity must be greater than zero.";
    else values[key] = value;
  }
  for (const [lower, upper] of [
    ["minimumMWh", "initialMWh"],
    ["initialMWh", "maximumMWh"],
    ["maximumMWh", "capacityMWh"],
  ] as const) {
    if (
      values[lower] !== undefined &&
      values[upper] !== undefined &&
      values[lower]! > values[upper]!
    )
      errors[lower] = "Energy must satisfy minimum ≤ initial ≤ maximum ≤ capacity.";
  }
  const windows = Object.fromEntries(
    windowFields.map((key) => [key, minutes(form[key])]),
  ) as Request["windows"];
  for (const key of windowFields)
    if (!Number.isInteger(windows[key]) || windows[key] % 5 !== 0)
      errors[key] = "Use HH:MM in five-minute steps; 24:00 means next midnight.";
  if (
    windowFields.every((key) => !errors[key]) &&
    !(
      windows.chargeStart < windows.chargeEnd &&
      windows.chargeEnd <= windows.dischargeStart &&
      windows.dischargeStart < windows.dischargeEnd
    )
  )
    errors.chargeStart =
      "Use one nonempty charge window followed by one nonoverlapping discharge window.";
  let thresholds: Request["thresholds"];
  if (form.thresholdEnabled) {
    const chargeBelow = decimal(form.chargeBelow, true);
    const dischargeAbove = decimal(form.dischargeAbove, true);
    const limit = decimal("1000000")!;
    for (const [key, value] of [
      ["chargeBelow", chargeBelow],
      ["dischargeAbove", dischargeAbove],
    ] as const) {
      if (value === null)
        errors[key] =
          "Enter a decimal up to 18 decimal places and 38 significant digits; negative values allowed.";
      else if (value < -limit || value > limit) errors[key] = "Enter a value within ±1,000,000.";
    }
    if (!errors.chargeBelow && !errors.dischargeAbove)
      if (chargeBelow! >= dischargeAbove!)
        errors.chargeBelow = "Charge threshold must be below the discharge threshold.";
      else thresholds = { chargeBelow: form.chargeBelow, dischargeAbove: form.dischargeAbove };
  }
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    request: {
      region: form.region,
      day: form.day,
      site: Object.fromEntries(siteFields.map((key) => [key, form[key]])) as Request["site"],
      costs: Object.fromEntries(costFields.map((key) => [key, form[key]])) as Request["costs"],
      efficiency:
        form.efficiencyMode === "roundTrip"
          ? { roundTrip: form.roundTrip }
          : { charge: form.charge, discharge: form.discharge },
      windows,
      ...(thresholds ? { thresholds } : {}),
    },
  };
}
