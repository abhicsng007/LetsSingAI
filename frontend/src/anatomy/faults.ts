// Real-time, client-side detection of which anatomy part is being used
// incorrectly, by comparing the live "you" pose against the ideal target pose.
//
// This runs every frame (no LLM) so the 3D model can point at the wrong part
// and show the correct motion instantly. The Bedrock/Strands agent later gives
// the deep per-part explanation at the end of a take, using the aggregated
// stats (see analysis/summary.ts).

import type { FeatureFrame } from "../audio/types";
import type { AnatomyPose } from "./pose";
import { clamp } from "../three/smooth";
import { LISTENER } from "../analysis/humanPitch";

export type Part =
  | "diaphragm"
  | "folds"
  | "throat"
  | "jaw"
  | "tongue"
  | "velum"
  | "placement";

export interface PartMeta {
  label: string;
  /** local-space anchor inside the Anatomy3D root group */
  anchor: [number, number, number];
  /** highlight-ring radius */
  ring: number;
  /** one-line description of the correct motion (shown in demo + sent to agent) */
  correctMotion: string;
  /** which coaching technique this part maps to */
  technique: string;
}

export const PART_META: Record<Part, PartMeta> = {
  diaphragm: {
    label: "Diaphragm",
    anchor: [-0.3, -2.15, 0],
    ring: 1.4,
    correctMotion: "Breathe low and keep the ribs expanded; feed a steady, gently-resisted airstream.",
    technique: "breath-support",
  },
  folds: {
    label: "Vocal folds",
    anchor: [0.08, 0.16, 0],
    ring: 0.5,
    correctMotion: "Let the folds vibrate on steady breath pressure; find the pitch centre without pushing.",
    technique: "pitch-accuracy",
  },
  throat: {
    label: "Throat",
    anchor: [0.22, 0.55, 0],
    ring: 0.7,
    correctMotion: "Keep the larynx low and the throat open, like the start of a yawn.",
    technique: "open-throat",
  },
  jaw: {
    label: "Jaw",
    anchor: [1.2, 0.7, 0],
    ring: 0.85,
    correctMotion: "Drop the jaw freely for open vowels; keep it loose, never clenched.",
    technique: "open-throat",
  },
  tongue: {
    label: "Tongue",
    anchor: [1.1, 1.0, 0],
    ring: 0.6,
    correctMotion: "Keep the tongue forward and relaxed, tip at the lower teeth; shape each vowel cleanly.",
    technique: "open-throat",
  },
  velum: {
    label: "Soft palate",
    anchor: [0.68, 1.18, 0],
    ring: 0.45,
    correctMotion: "Lift the soft palate to close the nose for a full, non-nasal tone.",
    technique: "forward-resonance",
  },
  placement: {
    label: "Resonance",
    anchor: [1.96, 1.1, 0],
    ring: 0.6,
    correctMotion: "Bring the tone forward into the mask so it rings.",
    technique: "forward-resonance",
  },
};

export const PARTS = Object.keys(PART_META) as Part[];

export interface Fault {
  part: Part;
  /** how far off, 0..1 */
  severity: number;
  /** short, live corrective cue */
  cue: string;
}

/**
 * Compare the live pose against the target and return the parts that are
 * currently off (un-debounced). Only parts with a reliable acoustic signal
 * are judged; the soft palate is educational-only and never live-flagged.
 */
export function evaluateFaults(
  you: AnatomyPose,
  ideal: AnatomyPose,
  live: FeatureFrame,
): Fault[] {
  const faults: Fault[] = [];
  const voicing = live.hasPitch;

  // Diaphragm / breath support — weak or unsteady support.
  if ((voicing || live.rms > 0.05) && you.pressure < 0.45) {
    faults.push({
      part: "diaphragm",
      severity: clamp((0.45 - you.pressure) / 0.45, 0, 1),
      cue: "Support from the diaphragm — steady the airstream.",
    });
  }

  if (voicing) {
    // Vocal folds — pitch off the reference melody (or nearest note if free singing).
    const signedCents = live.melodyCents ?? live.cents;
    const absCents = Math.abs(signedCents);
    if (absCents > LISTENER.quiteOffCents) {
      const wrongNote = live.melodyCents != null && absCents > LISTENER.wrongNoteCents;
      faults.push({
        part: "folds",
        severity: clamp((absCents - LISTENER.quiteOffCents) / 50, 0, 1),
        cue: wrongNote
          ? `Wrong note — aim for ${live.targetNote}.`
          : signedCents < 0
            ? "Flat — lift the pitch, lead with breath energy."
            : "Sharp — ease the pitch down, release the squeeze.",
      });
    }

    // Jaw — too closed (or too clenched) for the target vowel.
    const jawGap = ideal.jaw - you.jaw;
    if (jawGap > 0.22) {
      faults.push({
        part: "jaw",
        severity: clamp(jawGap / 0.5, 0, 1),
        cue: "Open the jaw more for this vowel.",
      });
    } else if (jawGap < -0.32) {
      faults.push({
        part: "jaw",
        severity: clamp(-jawGap / 0.5, 0, 1),
        cue: "Relax the jaw — you're over-opening.",
      });
    }

    // Tongue — vowel shape drifting from the target.
    const tongueDist = Math.hypot(ideal.tongueFront - you.tongueFront, ideal.tongueHigh - you.tongueHigh);
    if (tongueDist > 0.3) {
      faults.push({
        part: "tongue",
        severity: clamp((tongueDist - 0.3) / 0.4, 0, 1),
        cue: "Reshape the tongue for a cleaner vowel.",
      });
    }

    // Throat — raised larynx / squeezed tone.
    if (you.larynx > 0.5) {
      faults.push({
        part: "throat",
        severity: clamp((you.larynx - 0.5) / 0.5, 0, 1),
        cue: "Open the throat — feel the start of a yawn.",
      });
    }

    // Placement — thin tone, weak forward resonance (2nd harmonic low).
    const h2 = live.harmonics[1] ?? 0;
    if (h2 < 0.5 && live.brightness < 0.38) {
      faults.push({
        part: "placement",
        severity: clamp((0.5 - h2) / 0.5, 0, 1),
        cue: "Bring the tone forward into the mask.",
      });
    }
  }

  return faults.sort((a, b) => b.severity - a.severity);
}

interface Track {
  on: number;
  off: number;
  active: boolean;
  severity: number;
  cue: string;
}

const ATTACK = 0.35; // sustained seconds before a fault is shown
const RELEASE = 0.4; // clean seconds before it clears

/**
 * Debounces raw per-frame faults so highlights don't flicker: a part must be
 * off for ~0.35s to activate and clean for ~0.4s to clear, with a smoothed
 * severity for steady visuals.
 */
export class FaultTracker {
  private tracks = new Map<Part, Track>();

  update(raw: Fault[], dt: number): Fault[] {
    const now = new Map(raw.map((f) => [f.part, f]));

    for (const part of PARTS) {
      const track = this.tracks.get(part) ?? { on: 0, off: 0, active: false, severity: 0, cue: "" };
      const hit = now.get(part);
      if (hit) {
        track.on += dt;
        track.off = 0;
        track.cue = hit.cue;
        track.severity += (hit.severity - track.severity) * Math.min(1, dt * 6);
        if (track.on >= ATTACK) track.active = true;
      } else {
        track.off += dt;
        track.on = 0;
        track.severity += (0 - track.severity) * Math.min(1, dt * 4);
        if (track.off >= RELEASE) track.active = false;
      }
      this.tracks.set(part, track);
    }

    const out: Fault[] = [];
    for (const part of PARTS) {
      const t = this.tracks.get(part)!;
      if (t.active) out.push({ part, severity: t.severity, cue: t.cue });
    }
    return out.sort((a, b) => b.severity - a.severity);
  }

  reset(): void {
    this.tracks.clear();
  }
}
