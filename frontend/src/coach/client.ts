import type { PerformanceSummary } from "../analysis/summary";
import type {
  AgentToolEvent,
  CoachEvent,
  Diagnosis,
  DrillVerdict,
  FocusTechnique,
  HealthInfo,
  PracticePlan,
} from "./types";
import { localCoach } from "./localCoach";
import { drillById, drillsFor } from "../drills/catalog";
import { localVerdict } from "../drills/score";

// Unset → local uvicorn. Empty string → same origin (one-service live deploy).
const _envApi = import.meta.env.VITE_API_BASE as string | undefined;
const API_BASE =
  _envApi === undefined ? "http://localhost:8000" : _envApi.replace(/\/$/, "");

export function apiBase(): string {
  return API_BASE;
}

export interface CoachRequest {
  event: CoachEvent;
  summary: PerformanceSummary;
  singerId?: string;
  sessionId?: string;
  drillId?: string | null;
  skip?: boolean;
  nextDrillId?: string;
}

export interface CoachHandlers {
  onToken: (text: string) => void;
  onFocus: (focus: FocusTechnique) => void;
  onTool?: (tool: AgentToolEvent) => void;
  onPlan?: (plan: PracticePlan) => void;
  onDiagnosis?: (diagnosis: Diagnosis) => void;
  onVerdict?: (verdict: DrillVerdict) => void;
  onDone: (meta: { source: "agent" | "local"; memory?: string }) => void;
  onError: (message: string) => void;
}

export async function fetchHealth(): Promise<HealthInfo | null> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) return null;
    return (await res.json()) as HealthInfo;
  } catch {
    return null;
  }
}

export async function streamCoach(req: CoachRequest, handlers: CoachHandlers): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/coach`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: req.summary,
        singer_id: req.singerId ?? "demo-singer",
        session_id: req.sessionId ?? "demo-session",
        event: req.event,
        drill_id: req.drillId ?? null,
        skip: req.skip ?? false,
        next_drill_id: req.nextDrillId ?? "",
      }),
    });
    if (!res.ok || !res.body) throw new Error(`backend ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let source: "agent" | "local" = "agent";
    let memory: string | undefined;

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const line = block.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          const evt = JSON.parse(payload) as {
            type: string;
            text?: string;
            focus?: FocusTechnique;
            source?: "agent" | "local";
            memory?: string;
            message?: string;
            name?: string;
            status?: "start" | "done";
            plan?: PracticePlan;
            diagnosis?: Diagnosis;
            verdict?: DrillVerdict;
          };
          if (evt.type === "token" && evt.text) handlers.onToken(evt.text);
          else if (evt.type === "focus" && evt.focus) handlers.onFocus(evt.focus);
          else if (evt.type === "tool" && evt.name && evt.status) {
            handlers.onTool?.({ name: evt.name, status: evt.status });
          } else if (evt.type === "plan" && evt.plan) {
            handlers.onPlan?.(normalizePlan(evt.plan));
          } else if (evt.type === "diagnosis" && evt.diagnosis) {
            handlers.onDiagnosis?.(evt.diagnosis);
          } else if (evt.type === "verdict" && evt.verdict) {
            handlers.onVerdict?.(evt.verdict);
          } else if (evt.type === "meta") {
            if (evt.source) source = evt.source;
            if (evt.memory) memory = evt.memory;
          } else if (evt.type === "error") throw new Error(evt.message ?? "agent error");
        } catch {
          /* keep-alive */
        }
      }
    }
    handlers.onDone({ source, memory });
  } catch {
    await runLocalFallback(req, handlers);
  }
}

function normalizePlan(plan: PracticePlan): PracticePlan {
  const drills = plan.drills?.length
    ? plan.drills
    : drillsFor(plan.focus);
  return {
    focus: plan.focus,
    drills,
    exercises: plan.exercises?.length ? plan.exercises : drills.map((d) => d.instruction),
  };
}

async function runLocalFallback(req: CoachRequest, handlers: CoachHandlers): Promise<void> {
  if (req.event === "drill") {
    const drill = drillById(req.drillId ?? "") ?? drillsFor("breath-support")[0];
    const verdict = localVerdict(req.summary, drill, {
      skip: req.skip,
      nextDrillId: req.nextDrillId || null,
    });
    handlers.onVerdict?.(verdict);
    const title = drill.title;
    const text =
      verdict.result === "pass"
        ? `**${title} — pass.** ${verdict.reason}. Onto the next drill.`
        : verdict.result === "skip"
          ? `**${title} — skipped.** We'll pick this up next session.`
          : `**${title} — retry.** ${verdict.reason}. ${drill.instruction}`;
    handlers.onToken(text);
    handlers.onDone({ source: "local", memory: "local" });
    return;
  }

  if (req.event === "recap") {
    handlers.onToken(
      `### Session recap\n\nOffline heuristic recap for "${req.summary.song.title}". ` +
        `Pitch ${req.summary.pitch.meanAbsCents}¢, breath ${req.summary.breathSupport.mean}. ` +
        `Keep the three drills in your 10-minute loop.`,
    );
    handlers.onDone({ source: "local", memory: "local" });
    return;
  }

  const { markdown, focus, drills } = localCoach(req.summary);
  handlers.onFocus(focus);
  handlers.onDiagnosis?.({
    focus,
    issues: req.summary.bodyFaults.map((f) => f.label),
    bodyParts: req.summary.bodyFaults.map((f) => ({
      part: f.label,
      offRatio: f.offRatio,
      correctMotion: f.correctMotion,
    })),
  });
  handlers.onPlan?.({
    focus,
    drills,
    exercises: drills.map((d) => d.instruction),
  });
  handlers.onToken(markdown);
  handlers.onDone({ source: "local", memory: "local" });
}
