// Synthetic takes that drive the same liveFrame + coach pipeline as the mic.
// Used so a non-singer can verify pitch, harmonics, anatomy, and coaching.

import { analyzePitch, centsBetween, freqToMidi, midiToNoteName } from "../analysis/pitch";
import type { ReferenceSong } from "../data/songs";
import { emptyFrame, type FeatureFrame } from "./types";
import { liveFrame } from "./featureBus";

export type VerifyKind = "correct" | "incorrect";

const THIN_HARMONICS = [1, 0.22, 0.16, 0.11, 0.08, 0.05, 0.03, 0.02];
const CLOSED_FORMANTS: [number, number, number] = [360, 1150, 2600];

export function buildVerifyFrames(
  song: ReferenceSong,
  kind: VerifyKind,
  durationSec?: number,
): FeatureFrame[] {
  const frames: FeatureFrame[] = [];
  const duration = durationSec ?? song.vocalDuration ?? song.duration;
  const timeScale = duration / Math.max(0.01, song.duration);
  const wrongStart = duration * 0.45;
  const wrongEnd = duration * 0.62;

  for (const rf of song.frames) {
    const f = emptyFrame();
    f.t = rf.t * timeScale;
    f.hasPitch = true;
    f.clarity = 0.95;
    f.targetF0 = rf.f0;
    f.targetNote = midiToNoteName(Math.round(freqToMidi(rf.f0)));

    if (kind === "correct") {
      const wobble = 4 * Math.sin(rf.t * 5.2);
      const sung = rf.f0 * Math.pow(2, wobble / 1200);
      applyPitch(f, sung, rf.f0);
      f.rms = Math.min(1, rf.rms);
      f.breathSupport = 0.74 + 0.04 * Math.sin(rf.t * 1.7);
      f.harmonics = rf.harmonics.slice();
      f.brightness = 0.55;
      f.formants = [...rf.formants] as [number, number, number];
      f.vibratoRate = 5.4;
      f.vibratoExtent = 22;
    } else {
      const inWrongNote = f.t >= wrongStart && f.t < wrongEnd;
      const centsOff = inWrongNote ? -700 : -95 - 10 * Math.sin(rf.t * 3.1);
      const sung = rf.f0 * Math.pow(2, centsOff / 1200);
      applyPitch(f, sung, rf.f0);
      f.rms = Math.min(1, rf.rms * 0.7);
      f.breathSupport = 0.32 + 0.05 * Math.sin(rf.t * 4.2);
      f.harmonics = THIN_HARMONICS.slice();
      f.brightness = 0.28;
      f.formants = CLOSED_FORMANTS;
      f.vibratoRate = 0;
      f.vibratoExtent = 8;
    }
    frames.push(f);
  }
  return frames;
}

function applyPitch(f: FeatureFrame, sungHz: number, targetHz: number): void {
  const np = analyzePitch(sungHz);
  f.f0 = sungHz;
  f.midi = np.midi;
  f.note = np.note;
  f.cents = np.cents;
  f.melodyCents = centsBetween(sungHz, targetHz);
}

/** Cents to detune the audible demo (incorrect take is sung flat). */
export function verifyAudioCents(kind: VerifyKind): number {
  return kind === "incorrect" ? -95 : 0;
}

/** Extra MIDI shift on one note so the incorrect take has a visible wrong note. */
export function verifyWrongNoteAt(song: ReferenceSong, t: number): number {
  if (t >= song.duration * 0.45 && t < song.duration * 0.62) return -7;
  return 0;
}

let verifyGen = 0;
let verifyRaf = 0;

export function stopVerifyPlayback(): void {
  verifyGen += 1;
  if (verifyRaf) cancelAnimationFrame(verifyRaf);
  verifyRaf = 0;
}

export function runVerifyPlayback(
  frames: FeatureFrame[],
  onFrame: (frame: FeatureFrame) => void,
  onDone: () => void,
): void {
  stopVerifyPlayback();
  const gen = verifyGen;
  const t0 = performance.now();
  const duration = frames.length ? frames[frames.length - 1].t : 0;

  const tick = () => {
    if (gen !== verifyGen) return;
    const t = (performance.now() - t0) / 1000;
    const frame = frameAt(frames, t) ?? frames[frames.length - 1];
    if (frame) {
      liveFrame.current = frame;
      onFrame(frame);
    }
    if (t >= duration + 0.08) {
      onDone();
      return;
    }
    verifyRaf = requestAnimationFrame(tick);
  };
  verifyRaf = requestAnimationFrame(tick);
}

function frameAt(frames: FeatureFrame[], t: number): FeatureFrame | null {
  if (frames.length === 0) return null;
  const step = frames.length >= 2 ? frames[1].t - frames[0].t : 0.05;
  const idx = Math.round(t / Math.max(0.01, step));
  if (idx < 0) return frames[0];
  if (idx >= frames.length) return frames[frames.length - 1];
  return frames[idx];
}
