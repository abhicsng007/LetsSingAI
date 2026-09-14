import type { PerformanceSummary } from "../analysis/summary";
import type { DrillCheck, DrillSpec, DrillVerdict } from "../coach/types";

const OPS: Record<string, (a: number, b: number) => boolean> = {
  ">=": (a, b) => a >= b,
  "<=": (a, b) => a <= b,
  ">": (a, b) => a > b,
  "<": (a, b) => a < b,
};

export function metricValue(summary: PerformanceSummary, path: string): number | null {
  const parts = path.split(".");
  let cur: unknown = summary;
  for (const part of parts) {
    if (cur === null || typeof cur !== "object" || !(part in cur)) return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  if (typeof cur === "boolean") return cur ? 1 : 0;
  if (typeof cur === "number") return cur;
  return null;
}

export function scoreDrill(
  summary: PerformanceSummary,
  drill: DrillSpec,
): { passed: boolean; checks: { metric: string; op: string; threshold: number; value: number | null; ok: boolean }[]; reason: string } {
  const checks = drill.pass.map((c: DrillCheck) => {
    const value = metricValue(summary, c.metric);
    const fn = OPS[c.op];
    const ok = value !== null && fn ? fn(value, c.value) : false;
    return { metric: c.metric, op: c.op, threshold: c.value, value, ok };
  });
  const passed = checks.length > 0 && checks.every((c) => c.ok);
  const reason = checks
    .map((c) => `${c.metric} ${c.value ?? "n/a"} ${c.op} ${c.threshold} (${c.ok ? "ok" : "miss"})`)
    .join("; ");
  return { passed, checks, reason: reason || "no pass criteria" };
}

export function localVerdict(
  summary: PerformanceSummary,
  drill: DrillSpec,
  opts: { skip?: boolean; nextDrillId?: string | null },
): DrillVerdict {
  if (opts.skip) {
    return {
      drillId: drill.id,
      result: "skip",
      reason: "Singer skipped this drill.",
      nextDrillId: opts.nextDrillId ?? null,
      passed: false,
    };
  }
  const scored = scoreDrill(summary, drill);
  return {
    drillId: drill.id,
    result: scored.passed ? "pass" : "retry",
    reason: scored.reason,
    nextDrillId: scored.passed ? (opts.nextDrillId ?? null) : drill.id,
    passed: scored.passed,
  };
}
