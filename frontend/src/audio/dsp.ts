// Lightweight DSP helpers used by the audio engine.
// Everything here runs once per analysis hop, so it is kept cheap.

import { HARMONIC_COUNT } from "./types";

/** Convert an AnalyserNode dB spectrum (negative dB) to linear magnitudes. */
export function dbToLinear(db: Float32Array): Float32Array {
  const out = new Float32Array(db.length);
  for (let i = 0; i < db.length; i++) {
    out[i] = Math.pow(10, db[i] / 20);
  }
  return out;
}

/**
 * Extract normalized harmonic amplitudes H1..H8 given the fundamental f0.
 * For each harmonic we take the strongest bin in a small neighbourhood to be
 * robust to bin quantization, then normalize by the strongest harmonic.
 */
export function extractHarmonics(
  linearSpectrum: Float32Array,
  f0: number,
  sampleRate: number,
  fftSize: number,
): number[] {
  const binHz = sampleRate / fftSize;
  const raw = new Array<number>(HARMONIC_COUNT).fill(0);
  if (f0 <= 0) return raw;

  for (let n = 1; n <= HARMONIC_COUNT; n++) {
    const centerBin = Math.round((n * f0) / binHz);
    // Wider window on higher harmonics (voice is slightly inharmonic).
    const half = n <= 2 ? 2 : 3;
    let peak = 0;
    for (let b = centerBin - half; b <= centerBin + half; b++) {
      if (b >= 0 && b < linearSpectrum.length) {
        peak = Math.max(peak, linearSpectrum[b]);
      }
    }
    raw[n - 1] = peak;
  }

  const max = Math.max(...raw, 1e-9);
  return raw.map((v) => v / max);
}

/** Spectral centroid (Hz) mapped into a 0..1 "brightness" value. */
export function spectralBrightness(
  linearSpectrum: Float32Array,
  sampleRate: number,
  fftSize: number,
): number {
  const binHz = sampleRate / fftSize;
  let weighted = 0;
  let total = 0;
  for (let b = 1; b < linearSpectrum.length; b++) {
    const mag = linearSpectrum[b];
    weighted += b * binHz * mag;
    total += mag;
  }
  if (total <= 1e-9) return 0;
  const centroid = weighted / total;
  // Map ~[100 Hz .. 4000 Hz] onto 0..1.
  return Math.min(1, Math.max(0, (centroid - 100) / 3900));
}

/** RMS of a time-domain frame, 0..~1. */
export function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

// --- Formant estimation via LPC on a decimated frame -----------------------

function decimate(frame: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return frame;
  const out = new Float32Array(Math.floor(frame.length / factor));
  for (let i = 0; i < out.length; i++) {
    // crude anti-alias: average of `factor` samples
    let acc = 0;
    for (let k = 0; k < factor; k++) acc += frame[i * factor + k];
    out[i] = acc / factor;
  }
  return out;
}

function autocorrelation(x: Float32Array, order: number): Float32Array {
  const r = new Float32Array(order + 1);
  for (let lag = 0; lag <= order; lag++) {
    let acc = 0;
    for (let i = lag; i < x.length; i++) acc += x[i] * x[i - lag];
    r[lag] = acc;
  }
  return r;
}

/** Levinson-Durbin recursion -> LPC coefficients a[0..order] (a[0] = 1). */
function levinson(r: Float32Array, order: number): Float32Array | null {
  if (r[0] === 0) return null;
  const a = new Float32Array(order + 1);
  a[0] = 1;
  let err = r[0];
  for (let i = 1; i <= order; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
    const k = -acc / err;
    const prev = a.slice();
    for (let j = 1; j < i; j++) a[j] = prev[j] + k * prev[i - j];
    a[i] = k;
    err *= 1 - k * k;
    if (err <= 0) return null;
  }
  return a;
}

/**
 * Estimate the first three formants (F1, F2, F3) in Hz from a time-domain
 * frame. The signal is decimated to ~11 kHz, pre-emphasized and windowed,
 * then an order-12 LPC spectral envelope is scanned for its first peaks.
 * This is an approximate, pedagogy-grade estimate (smooth it downstream).
 */
export function estimateFormants(
  frame: Float32Array,
  sampleRate: number,
): [number, number, number] {
  const none: [number, number, number] = [0, 0, 0];
  const factor = Math.max(1, Math.round(sampleRate / 11025));
  const decSr = sampleRate / factor;
  const dec = decimate(frame, factor);
  if (dec.length < 64) return none;

  // pre-emphasis + Hamming window
  const win = new Float32Array(dec.length);
  const N = dec.length;
  for (let i = 0; i < N; i++) {
    const pre = i === 0 ? dec[i] : dec[i] - 0.97 * dec[i - 1];
    const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (N - 1));
    win[i] = pre * w;
  }

  const order = 12;
  const r = autocorrelation(win, order);
  const a = levinson(r, order);
  if (!a) return none;

  // Scan LPC envelope |1 / A(e^jw)| for local maxima -> formants.
  const steps = 256;
  const maxHz = decSr / 2;
  const mags = new Float32Array(steps);
  for (let s = 0; s < steps; s++) {
    const f = (s / steps) * maxHz;
    const w = (2 * Math.PI * f) / decSr;
    let re = 0;
    let im = 0;
    for (let k = 0; k <= order; k++) {
      re += a[k] * Math.cos(w * k);
      im -= a[k] * Math.sin(w * k);
    }
    const denom = Math.sqrt(re * re + im * im);
    mags[s] = denom > 1e-9 ? 1 / denom : 0;
  }

  const formants: number[] = [];
  for (let s = 1; s < steps - 1; s++) {
    const f = (s / steps) * maxHz;
    if (f < 200) continue; // ignore sub-formant region
    if (mags[s] > mags[s - 1] && mags[s] >= mags[s + 1]) {
      formants.push(f);
      if (formants.length === 3) break;
    }
  }
  return [formants[0] ?? 0, formants[1] ?? 0, formants[2] ?? 0];
}
