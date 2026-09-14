export type FocusTechnique =
  | "breath-support"
  | "open-throat"
  | "pitch-accuracy"
  | "forward-resonance"
  | "none";

export const FOCUS_LABELS: Record<FocusTechnique, string> = {
  "breath-support": "Breath support",
  "open-throat": "Open throat",
  "pitch-accuracy": "Pitch accuracy",
  "forward-resonance": "Forward resonance",
  none: "Balanced",
};

export type LessonPhase = "demo" | "ready" | "take" | "coaching" | "drill" | "verdict" | "recap";

export type CoachEvent = "take" | "drill" | "recap";

export type DrillKind = "hiss" | "siren" | "vowel-phrase" | "slow-notes";

export interface DrillCheck {
  metric: string;
  op: ">=" | "<=" | ">" | "<" | string;
  value: number;
}

export interface DrillSpec {
  id: string;
  title: string;
  instruction: string;
  kind: DrillKind | string;
  durationSec: number;
  technique: FocusTechnique | string;
  pass: DrillCheck[];
}

export interface AgentToolEvent {
  name: string;
  status: "start" | "done";
  detail?: string;
}

export interface PracticePlan {
  focus: FocusTechnique | string;
  drills: DrillSpec[];
  exercises: string[];
}

export interface DrillVerdict {
  drillId: string;
  result: "pass" | "retry" | "skip";
  reason: string;
  nextDrillId?: string | null;
  passed?: boolean;
}

export interface Diagnosis {
  focus?: FocusTechnique | string;
  issues?: string[];
  bodyParts?: { part?: string; offRatio?: number; correctMotion?: string }[];
  title?: string;
}

export interface HealthInfo {
  ok: boolean;
  coach: "bedrock-agent" | "heuristic" | string;
  memory: "local" | "agentcore" | string;
  model?: string;
}
