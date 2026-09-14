// Play a real sung recording and score it with the same pitch detector as the
// mic (pitchy on the PCM), not a fake perfect contour.
//
// The CC0 Twinkle vocal is not in our C4 MIDI key and is not tempo-locked, so
// we transpose to the recording's key and score against the nearest melody
// pitch-class (any octave). Error is the smoothed pitch *centre* vs that note
// — the take summary then scores held notes, not scoops or vibrato peaks.

import { PitchDetector } from "pitchy";
import {
  analyzePitch,
  centsBetween,
  freqToMidi,
  midiToFreq,
  midiToNoteName,
} from "../analysis/pitch";
import { smoothingAlpha } from "../analysis/humanPitch";
import { getCurrentSong, type ReferenceSong } from "../data/songs";
import { estimateFormants, rms } from "./dsp";
import { liveFrame } from "./featureBus";
import { emptyFrame, HARMONIC_COUNT, type FeatureFrame } from "./types";

const WIN = 2048;
const HOP = 512;
const CLARITY = 0.78;
const RMS_FLOOR = 0.006;

let gen = 0;
let ctx: AudioContext | null = null;
let raf = 0;
let source: AudioBufferSourceNode | null = null;

export function stopVocalAnalyze(): void {
  gen += 1;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  try {
    source?.stop();
  } catch {
    /* already stopped */
  }
  source = null;
  if (ctx) {
    void ctx.close();
    ctx = null;
  }
}

export async function playAndAnalyzeVocal(opts: {
  url: string;
  detuneCents: number;
  durationSec: number;
  onFrame: (frame: FeatureFrame) => void;
  onDone: (frames: FeatureFrame[]) => void;
}): Promise<void> {
  stopVocalAnalyze();
  const myGen = gen;
  const ac = new AudioContext();
  ctx = ac;
  if (ac.state === "suspended") await ac.resume();
  if (myGen !== gen) {
    void ac.close();
    return;
  }

  const res = await fetch(opts.url);
  if (!res.ok) throw new Error(`vocal ${res.status}`);
  const buf = await ac.decodeAudioData(await res.arrayBuffer());
  if (myGen !== gen) {
    void ac.close();
    return;
  }

  const playFor = Math.min(buf.duration, opts.durationSec);
  const frames = analyzePcm(buf, playFor, opts.detuneCents, getCurrentSong());

  const src = ac.createBufferSource();
  src.buffer = buf;
  src.detune.value = opts.detuneCents;
  const gain = ac.createGain();
  gain.gain.value = 0.85;
  src.connect(gain);
  gain.connect(ac.destination);
  source = src;
  const t0 = performance.now();
  let finished = false;
  src.start();
  src.stop(ac.currentTime + playFor + 0.05);

  const tick = () => {
    if (myGen !== gen || finished) return;
    const t = (performance.now() - t0) / 1000;
    const frame = frameAt(frames, t) ?? emptyFrame();
    liveFrame.current = frame;
    opts.onFrame(frame);
    if (t >= playFor) {
      finished = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      opts.onDone(frames.filter((f) => f.hasPitch));
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

function analyzePcm(
  buf: AudioBuffer,
  duration: number,
  detuneCents: number,
  song: ReferenceSong,
): FeatureFrame[] {
  const sr = buf.sampleRate;
  const pcm = buf.getChannelData(0);
  const detune = Math.pow(2, detuneCents / 1200);
  const detector = PitchDetector.forFloat32Array(WIN);
  const end = Math.min(pcm.length, Math.floor(duration * sr));
  const frames: FeatureFrame[] = [];
  const rmsHist: number[] = [];
  let f0Center = 0;
  const dt = HOP / sr;
  const alpha = smoothingAlpha(dt);

  for (let i = 0; i + WIN < end; i += HOP) {
    const slice = pcm.subarray(i, i + WIN);
    const window = new Float32Array(WIN);
    window.set(slice);
    const t = i / sr;
    const level = rms(window);
    const [rawPitch, clarity] = detector.findPitch(window, sr);
    const frame = emptyFrame();
    frame.t = t;
    frame.rms = Math.min(1, level * 6);
    frame.clarity = clarity;

    const pitch = rawPitch * detune;
    const voiced = clarity > CLARITY && level > RMS_FLOOR && pitch > 70 && pitch < 900;
    if (!voiced) {
      f0Center = 0;
      frames.push(frame);
      continue;
    }

    f0Center = f0Center > 0 ? f0Center + (pitch - f0Center) * alpha : pitch;
    const targetHz = nearestMelodyNoteHz(f0Center, song);
    const np = analyzePitch(pitch);
    frame.hasPitch = true;
    frame.f0 = pitch;
    frame.midi = np.midi;
    frame.note = np.note;
    frame.cents = np.cents;
    if (targetHz > 0) {
      frame.targetF0 = targetHz;
      frame.targetNote = midiToNoteName(Math.round(freqToMidi(targetHz)));
      frame.melodyCents = centsBetween(f0Center, targetHz);
    }
    frame.harmonics = goertzelHarmonics(window, sr, pitch);
    frame.brightness = spectralBrightnessFromTime(window, sr);
    frame.formants = estimateFormants(window, sr);
    rmsHist.push(level);
    if (rmsHist.length > 40) rmsHist.shift();
    if (rmsHist.length < 8) frame.breathSupport = frame.rms;
    else {
      const mean = rmsHist.reduce((s, v) => s + v, 0) / rmsHist.length;
      const variance = rmsHist.reduce((s, v) => s + (v - mean) * (v - mean), 0) / rmsHist.length;
      const cv = mean > 1e-6 ? Math.sqrt(variance) / mean : 1;
      frame.breathSupport = Math.max(0, 1 - cv * 2.2) * 0.7 + Math.min(1, level * 12) * 0.3;
    }
    frames.push(frame);
  }
  return frames;
}

/** Closest Twinkle note in the recording's key, any octave — not time-locked. */
function nearestMelodyNoteHz(f0: number, song: ReferenceSong): number {
  const tr = song.vocalTranspose ?? 0;
  const pcs = [...new Set(song.notes.map((n) => (((n.midi + tr) % 12) + 12) % 12))];
  let bestHz = 0;
  let bestErr = Infinity;
  for (const pc of pcs) {
    for (let m = 36; m <= 84; m++) {
      if ((((m % 12) + 12) % 12) !== pc) continue;
      const hz = midiToFreq(m);
      const err = Math.abs(centsBetween(f0, hz));
      if (err < bestErr) {
        bestErr = err;
        bestHz = hz;
      }
    }
  }
  return bestHz;
}

function goertzelHarmonics(frame: Float32Array, sr: number, f0: number): number[] {
  const raw = new Array<number>(HARMONIC_COUNT).fill(0);
  if (f0 <= 0) return raw;
  for (let n = 1; n <= HARMONIC_COUNT; n++) {
    raw[n - 1] = goertzel(frame, sr, n * f0);
  }
  const max = Math.max(...raw, 1e-9);
  return raw.map((v) => v / max);
}

function goertzel(frame: Float32Array, sr: number, freq: number): number {
  const n = frame.length;
  const w = (2 * Math.PI * freq) / sr;
  const coeff = 2 * Math.cos(w);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    s0 = frame[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return Math.sqrt(Math.max(0, power));
}

function spectralBrightnessFromTime(frame: Float32Array, sr: number): number {
  // Cheap centroid via first 8 harmonics already computed elsewhere; fallback:
  let num = 0;
  let den = 0;
  for (let n = 1; n <= 8; n++) {
    const mag = goertzel(frame, sr, n * 220);
    num += mag * n;
    den += mag;
  }
  if (den < 1e-9) return 0.4;
  return Math.max(0, Math.min(1, (num / den - 1) / 6));
}

function frameAt(frames: FeatureFrame[], t: number): FeatureFrame | null {
  if (frames.length === 0) return null;
  const step = frames.length >= 2 ? frames[1].t - frames[0].t : 0.01;
  const idx = Math.round(t / Math.max(0.005, step));
  if (idx < 0) return frames[0];
  if (idx >= frames.length) return frames[frames.length - 1];
  return frames[idx];
}
