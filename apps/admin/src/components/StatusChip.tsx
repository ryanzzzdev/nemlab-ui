const CHIP: Record<string, { tone: string; label: string }> = {
  QUEUED: { tone: "c-warn", label: "Queued" },
  RUNNING: { tone: "c-run", label: "Running" },
  PAUSED: { tone: "c-warn", label: "Paused" },
  SUCCEEDED: { tone: "c-ok", label: "Succeeded" },
  FAILED: { tone: "c-bad", label: "Failed" },
  CANCELLED: { tone: "", label: "Cancelled" },
  COMPLETE: { tone: "c-ok", label: "Complete" },
  dispatching: { tone: "c-run", label: "Dispatching" },
  paused: { tone: "c-warn", label: "Paused" },
  dispatched: { tone: "c-ok", label: "Dispatched" },
};

/** Status chips always carry text — colour alone never signals state. */
export function StatusChip({ status }: { status: string }) {
  const chip = CHIP[status] ?? { tone: "", label: status };
  return <span className={`chip ${chip.tone}`}>{chip.label}</span>;
}
