// Builds the compact structured performance summary that is sent to the
// coaching agent. The agent reasons over this JSON — never raw audio.

import type { FeatureFrame, } from "../audio/types";
import { HARMONIC_COUNT } from "../audio/types";
import type { ReferenceSong } from "../data/referenceSong";
import { poseFromFeature } from "../anatomy/pose";
import { idealPoseAt } from "../anatomy/ideal";
import { evaluateFaults, PART_META, PARTS } from "../anatomy/faults";
import type { Part } from "../anatomy/faults";
import {
  LISTENER,
  listenerCentsSeries,
  listenerError,
  noteHolds,
  sectionScore,
} from "./humanPitch";

/** A body-mechanic issue aggregated over the whole take (for the agent). */
export interface BodyFault {
  part: Part;
  label: string;
  /** fraction of voiced frames this part was off, 0..1 */
  offRatio: number;
  /** mean severity while off, 0..1 */
  severity: number;
  /** the most common live cue for this part */
  cue: string;
  /** the correct motion for this part */
  correctMotion: string;
  /** coaching technique this part maps to */
  technique: string;
}

export interface PerformanceSummary {
  song: { title: string; artist: string };
  durationSec: number;
  voicedRatio: number;
  pitch: {
    meanAbsCents: number;
    p95AbsCents: number;
    inTuneRatio: number;
    /** fraction of held notes ~a semitone or more from the target */
    wrongNoteRatio: number;
    tendency: "flat" | "sharp" | "balanced";
    /** true when scoring is against the song melody, not nearest chromatic */
    scoredAgainstMelody: boolean;
    /** listener in-tune window in cents (held-note centre) */
    inTuneWindowCents: number;
    /** how many notes were held long enough to score */
    heldNotes: number;
  };
  breathSupport: { mean: number };
  vibrato: { rate: number; extent: number; present: boolean };
  timbre: {
    brightness: number;
    harmonicBalanceDelta: number; // 0..1 distance from the reference timbre
    thinTone: boolean;
  };
  worstMoments: { t: number; cents: number; note: string }[];
  sections: { name: string; meanAbsCents: number; score: number }[];
  /** which body parts moved incorrectly, most impactful first */
  bodyFaults: BodyFault[];
}

/**
 * Replays the take through the same actual-vs-ideal pose comparison the live 3D
 * model uses, and aggregates per-part how often (and how badly) each part was
 * off. This is what lets the agent point at specific anatomy.
 */
function computeBodyFaults(voiced: FeatureFrame[]): BodyFault[] {
  const count = new Map<Part, number>();
  const sevSum = new Map<Part, number>();
  const cueTally = new Map<Part, Map<string, number>>();

  for (const f of voiced) {
    const you = poseFromFeature(f);
    const ideal = idealPoseAt(f.t, f);
    for (const fault of evaluateFaults(you, ideal, f)) {
      count.set(fault.part, (count.get(fault.part) ?? 0) + 1);
      sevSum.set(fault.part, (sevSum.get(fault.part) ?? 0) + fault.severity);
      const tally = cueTally.get(fault.part) ?? new Map<string, number>();
      tally.set(fault.cue, (tally.get(fault.cue) ?? 0) + 1);
      cueTally.set(fault.part, tally);
    }
  }

  const out: BodyFault[] = [];
  for (const part of PARTS) {
    const n = count.get(part) ?? 0;
    const offRatio = n / voiced.length;
    if (offRatio < 0.25) continue; // only sustained issues
    const severity = (sevSum.get(part) ?? 0) / Math.max(1, n);
    const tally = cueTally.get(part);
    const cue = tally
      ? [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0]
      : PART_META[part].correctMotion;
    out.push({
      part,
      label: PART_META[part].label,
      offRatio: +offRatio.toFixed(2),
      severity: +severity.toFixed(2),
      cue,
      correctMotion: PART_META[part].correctMotion,
      technique: PART_META[part].technique,
    });
  }
  return out.sort((a, b) => b.offRatio * b.severity - a.offRatio * a.severity).slice(0, 4);
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

function meanHarmonics(frames: { harmonics: number[] }[]): number[] {
  const acc = new Array<number>(HARMONIC_COUNT).fill(0);
  if (frames.length === 0) return acc;
  for (const f of frames) {
    for (let i = 0; i < HARMONIC_COUNT; i++) acc[i] += f.harmonics[i] ?? 0;
  }
  return acc.map((v) => v / frames.length);
}

export function buildSummary(
  frames: FeatureFrame[],
  song: ReferenceSong,
): PerformanceSummary | null {
  const voiced = frames.filter((f) => f.hasPitch);
  if (voiced.length < 5) return null;

  const duration = voiced[voiced.length - 1].t - voiced[0].t || 0.1;
  const scoredAgainstMelody = voiced.some((f) => f.melodyCents != null);
  const holds = noteHolds(voiced);
  const signed = listenerCentsSeries(voiced);
  const absCents = signed.map((c) => Math.abs(c));
  const sortedAbs = [...absCents].sort((a, b) => a - b);
  const signedMean = mean(signed);

  const tendency: "flat" | "sharp" | "balanced" =
    signedMean < -12 ? "flat" : signedMean > 12 ? "sharp" : "balanced";

  const userHarm = meanHarmonics(voiced);
  const refHarm = meanHarmonics(song.frames);
  const harmonicBalanceDelta =
    mean(userHarm.map((v, i) => Math.abs(v - (refHarm[i] ?? 0))));

  const vibExtent = mean(voiced.map((f) => f.vibratoExtent));
  const vibRate = mean(voiced.filter((f) => f.vibratoExtent > 15).map((f) => f.vibratoRate));

  // worst 3 *held notes*, spaced apart — not scoop/vibrato frames
  const worstMoments: { t: number; cents: number; note: string }[] = [];
  const byError = [...holds].sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
  for (const h of byError) {
    if (Math.abs(h.cents) < LISTENER.slightlyOffCents) break;
    if (worstMoments.every((m) => Math.abs(m.t - h.t) > 0.5)) {
      worstMoments.push({
        t: +h.t.toFixed(2),
        cents: Math.round(h.cents),
        note: h.note,
      });
    }
    if (worstMoments.length >= 3) break;
  }

  const sections = song.sections
    .map((s) => {
      const inSec = holds.filter((h) => h.t >= s.start && h.t < s.end);
      const series = inSec.length
        ? inSec.map((h) => Math.abs(h.cents))
        : voiced
            .filter((f) => f.t >= s.start && f.t < s.end)
            .map((f) => Math.abs(listenerError(f)));
      const m = mean(series);
      return {
        name: s.name,
        meanAbsCents: +m.toFixed(1),
        score: sectionScore(m),
      };
    })
    .filter((s) => s.meanAbsCents > 0);

  const brightness = mean(voiced.map((f) => f.brightness));

  return {
    song: { title: song.title, artist: song.artist },
    durationSec: +duration.toFixed(2),
    voicedRatio: +Math.min(1, (voiced.length * 0.016) / duration).toFixed(2),
    pitch: {
      meanAbsCents: +mean(absCents).toFixed(1),
      p95AbsCents: +percentile(sortedAbs, 0.95).toFixed(1),
      inTuneRatio: +(
        absCents.filter((c) => c < LISTENER.inTuneCents).length / absCents.length
      ).toFixed(2),
      wrongNoteRatio: +(
        absCents.filter((c) => c > LISTENER.wrongNoteCents).length / absCents.length
      ).toFixed(2),
      tendency,
      scoredAgainstMelody,
      inTuneWindowCents: LISTENER.inTuneCents,
      heldNotes: holds.length,
    },
    breathSupport: { mean: +mean(voiced.map((f) => f.breathSupport)).toFixed(2) },
    vibrato: {
      rate: +vibRate.toFixed(1),
      extent: +vibExtent.toFixed(0),
      present: vibExtent > 20 && vibRate > 3.5 && vibRate < 8,
    },
    timbre: {
      brightness: +brightness.toFixed(2),
      harmonicBalanceDelta: +harmonicBalanceDelta.toFixed(2),
      thinTone: (userHarm[1] ?? 0) < (refHarm[1] ?? 0) * 0.7,
    },
    worstMoments,
    sections,
    bodyFaults: computeBodyFaults(voiced),
  };
}
