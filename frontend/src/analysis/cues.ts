// Instant, rule-based coaching cues shown live while singing (no LLM).
// The deep, personalized coaching comes from the agent at the end of a take.

import type { FeatureFrame } from "../audio/types";
import { pitchBand } from "./humanPitch";

export type CueTone = "good" | "warn" | "info";

export interface LiveCue {
  text: string;
  tone: CueTone;
}

export function liveCue(f: FeatureFrame): LiveCue {
  if (!f.hasPitch) {
    if (f.rms > 0.05) return { text: "Let the note ring out", tone: "info" };
    return { text: "Take a breath and sing a steady note", tone: "info" };
  }
  const vsMelody = f.melodyCents != null;
  const cents = f.melodyCents ?? f.cents;
  const band = pitchBand(cents);
  if (vsMelody && band === "wrong-note") {
    return {
      text: `Wrong note — sing ${f.targetNote}`,
      tone: "warn",
    };
  }
  if (band === "quite-off") {
    const off = Math.round(Math.abs(cents));
    if (cents < 0) {
      return {
        text: vsMelody
          ? `Below ${f.targetNote} by ${off}¢ — lift`
          : `Flat by ${off}¢ — lift the pitch`,
        tone: "warn",
      };
    }
    return {
      text: vsMelody
        ? `Above ${f.targetNote} by ${off}¢ — ease down`
        : `Sharp by ${off}¢ — ease the pitch down`,
      tone: "warn",
    };
  }
  if (f.breathSupport < 0.4) {
    return { text: "Steady your breath — support from the diaphragm", tone: "warn" };
  }
  if (f.brightness < 0.18) {
    return { text: "Open the throat and brighten the tone", tone: "info" };
  }
  return { text: "Nice — hold it right there", tone: "good" };
}
