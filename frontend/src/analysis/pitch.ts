// Frequency <-> musical-note helpers. A4 = 440 Hz = MIDI 69.

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

export function freqToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function midiToNoteName(midi: number): string {
  const rounded = Math.round(midi);
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return `${name}${octave}`;
}

export interface NotePosition {
  midi: number;
  note: string;
  /** signed deviation from the nearest semitone, -50..50 */
  cents: number;
}

export function analyzePitch(freq: number): NotePosition {
  if (freq <= 0) {
    return { midi: 0, note: "--", cents: 0 };
  }
  const midi = freqToMidi(freq);
  const nearest = Math.round(midi);
  const cents = (midi - nearest) * 100;
  return { midi, note: midiToNoteName(nearest), cents };
}

/** Difference between two pitches expressed in cents. */
export function centsBetween(freqA: number, freqB: number): number {
  if (freqA <= 0 || freqB <= 0) return 0;
  return 1200 * Math.log2(freqA / freqB);
}

/**
 * Pitch detectors often jump octaves. If f0 is ~2× or ½× the melody note,
 * fold it onto the target octave so scoring and harmonics use the sung pitch.
 */
export function snapOctaveToTarget(f0: number, target: number): number {
  if (f0 <= 0 || target <= 0) return f0;
  const origDist = Math.abs(Math.log2(f0 / target));
  let best = f0;
  let bestDist = origDist;
  for (const mul of [0.25, 0.5, 2, 4]) {
    const cand = f0 * mul;
    if (cand < 70 || cand > 1100) continue;
    const dist = Math.abs(Math.log2(cand / target));
    if (dist < bestDist) {
      best = cand;
      bestDist = dist;
    }
  }
  // Fold only when the original was clearly the wrong octave and the
  // folded pitch sits within ~3 semitones of the target.
  if (best !== f0 && bestDist < 3 / 12 && origDist > bestDist + 0.4) {
    return best;
  }
  return f0;
}
