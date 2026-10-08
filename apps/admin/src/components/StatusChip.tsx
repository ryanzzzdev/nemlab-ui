const CHIP: Record<string, { tone: string; label: string }> = {
  QUEUED: { tone: "queued", label: "Queued" },
  RUNNING: { tone: "running", label: "Running" },
  PAUSED: { tone: "queued", label: "Paused" },
  SUCCEEDED: { tone: "complete", label: "Succeeded" },
  FAILED: { tone: "failed", label: "Failed" },
  CANCELLED: { tone: "", label: "Cancelled" },
  COMPLETE: { tone: "complete", label: "Complete" },
  dispatching: { tone: "running", label: "Dispatching" },
  paused: { tone: "queued", label: "Paused" },
  dispatched: { tone: "complete", label: "Dispatched" },
};

/** Status chips always carry text — colour alone never signals state. */
export function StatusChip({ status }: { status: string }) {
  const chip = CHIP[status] ?? { tone: "", label: status };
  return <span className={`job-chip ${chip.tone}`}>{chip.label}</span>;
}
