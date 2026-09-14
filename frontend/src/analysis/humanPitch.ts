// Listener-like pitch evaluation — not a strobe tuner.
//
// People do not hear singing the way a machine does:
// - they judge the *centre* of a held note, not every frame
// - scoops, consonants, and releases are ignored
// - vibrato of ±30–50¢ around a centred mean is still in tune
// - ~50¢ off still sounds like the intended note; a semitone (100¢) is a miss
//
// Research/practice: listeners accept ~50¢ as “the note” in melody
// (Hutchins & Peretz; Vurma & Ross). Karaoke-style games are often ±50–100¢.
// 15–35¢ is studio autotune, not a human teacher.

import type { FeatureFrame } from "../audio/types";

export const LISTENER = {
  /** Green: a listener hears this as in tune (covers vibrato and loose amateur pitch). */
  inTuneCents: 50,
  /** Still the intended scale degree; trained ear may notice. */
  slightlyOffCents: 75,
  /** Clearly flat/sharp, not yet a different note. */
  quiteOffCents: 90,
  /** Different note — a semitone. */
  wrongNoteCents: 100,
  /** Take needs pitch work (coach / focus). */
  takeOffCents: 58,
  takeOffWrongRatio: 0.28,
  /** Drop this much of each note’s start (scoop / consonant). */
  attackIgnoreSec: 0.18,
  /** Drop this much of each note’s end (release). */
  releaseIgnoreSec: 0.12,
  /** Shorter than this is a slide, not a held note. */
  minSustainSec: 0.12,
  /** Gap that still counts as the same syllable-note. */
  mergeGapSec: 0.28,
  /** EMA time-constant so live error tracks the pitch *centre*. */
  centreWindowSec: 0.32,
  /** Live meter spans ± this many cents (edges = wrong note). */
  meterSpanCents: 100,
  /** Singer can be this late and still count as the previous melody note. */
  lateWindowSec: 0.4,
  /** Singer can be this early and still count as the next melody note. */
  earlyWindowSec: 0.25,
} as const;

export type PitchBand = "in-tune" | "slightly-off" | "quite-off" | "wrong-note";

export interface NoteHold {
  t: number;
  note: string;
  /** Signed median cents of the sustain (listener error). */
  cents: number;
  duration: number;
}

export function listenerError(frame: FeatureFrame): number {
  return frame.melodyCents ?? frame.cents;
}

export function pitchBand(absCents: number): PitchBand {
  const a = Math.abs(absCents);
  if (a < LISTENER.inTuneCents) return "in-tune";
  if (a < LISTENER.slightlyOffCents) return "slightly-off";
  if (a < LISTENER.wrongNoteCents) return "quite-off";
  return "wrong-note";
}

export function pitchBandColor(absCents: number): string {
  const band = pitchBand(absCents);
  if (band === "in-tune" || band === "slightly-off") return "#34d399";
  if (band === "quite-off") return "#fbbf24";
  return "#f87171";
}

/** Map signed cents onto a 0–100% meter whose edges are ±1 semitone. */
export function pitchNeedlePercent(cents: number): number {
  const span = LISTENER.meterSpanCents;
  const clamped = Math.max(-span, Math.min(span, cents));
  return 50 + (clamped / span) * 50;
}

export function smoothingAlpha(dtSec: number, tauSec = LISTENER.centreWindowSec): number {
  const dt = Math.max(0.001, Math.min(0.08, dtSec));
  return 1 - Math.exp(-dt / tauSec);
}

export function takeNeedsPitchWork(meanAbsCents: number, wrongNoteRatio: number): boolean {
  return meanAbsCents > LISTENER.takeOffCents || wrongNoteRatio > LISTENER.takeOffWrongRatio;
}

function holdKey(frame: FeatureFrame): string {
  return frame.targetNote || frame.note || "--";
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/**
 * Group voiced frames into held notes. Slides, scoops, and tiny blips are
 * dropped; each remaining hold is scored by the median of its sustain.
 */
export function noteHolds(frames: FeatureFrame[]): NoteHold[] {
  const voiced = frames.filter((f) => f.hasPitch);
  if (voiced.length === 0) return [];

  const groups: FeatureFrame[][] = [];
  let cur: FeatureFrame[] = [voiced[0]!];
  for (let i = 1; i < voiced.length; i++) {
    const prev = voiced[i - 1]!;
    const f = voiced[i]!;
    const gap = f.t - prev.t;
    if (holdKey(f) === holdKey(prev) && gap < LISTENER.mergeGapSec) {
      cur.push(f);
    } else {
      groups.push(cur);
      cur = [f];
    }
  }
  groups.push(cur);

  const holds: NoteHold[] = [];
  for (const g of groups) {
    const t0 = g[0]!.t;
    const t1 = g[g.length - 1]!.t;
    const dur = Math.max(t1 - t0, 0.01);
    if (dur < LISTENER.minSustainSec) continue;

    const innerStart = t0 + Math.min(LISTENER.attackIgnoreSec, dur * 0.25);
    const innerEnd = t1 - Math.min(LISTENER.releaseIgnoreSec, dur * 0.2);
    let inner = g.filter((f) => f.t >= innerStart && f.t <= innerEnd);
    if (inner.length < 2) {
      const lo = Math.floor(g.length * 0.25);
      const hi = Math.max(lo + 1, Math.ceil(g.length * 0.85));
      inner = g.slice(lo, hi);
    }
    if (inner.length === 0) inner = g;

    holds.push({
      t: (t0 + t1) / 2,
      note: holdKey(g[Math.floor(g.length / 2)]!),
      cents: median(inner.map(listenerError)),
      duration: dur,
    });
  }
  return holds;
}

/** Signed cents used for take-level stats: held-note centres, else raw frames. */
export function listenerCentsSeries(frames: FeatureFrame[]): number[] {
  const holds = noteHolds(frames);
  if (holds.length >= 1) return holds.map((h) => h.cents);
  return frames.filter((f) => f.hasPitch).map(listenerError);
}

export function sectionScore(meanAbsCents: number): number {
  // First 50¢ are “in tune”; after that, drop. 75¢ → 65, 100¢ → 30.
  return Math.round(
    Math.max(0, 100 - Math.max(0, meanAbsCents - LISTENER.inTuneCents) * 1.4),
  );
}
