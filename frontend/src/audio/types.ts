// Shared feature-frame type produced by the audio engine every analysis hop
// and consumed by the 3D views (imperatively) and the UI (throttled).

export interface FeatureFrame {
  /** seconds since the current take started */
  t: number;
  /** true when a confident pitch was detected this frame */
  hasPitch: boolean;
  /** fundamental frequency in Hz (0 when unvoiced) */
  f0: number;
  /** pitch detector confidence, 0..1 */
  clarity: number;
  /** fractional MIDI note number (0 when unvoiced) */
  midi: number;
  /** nearest note name, e.g. "A4" */
  note: string;
  /** deviation from the nearest chromatic note in cents, -50..50 */
  cents: number;
  /**
   * Deviation from the reference melody, in cents, using the *pitch centre*
   * (vibrato/jitter smoothed). Null when not scoring a song.
   * Unlike `cents`, this is wrong when you sing a different note in tune.
   */
  melodyCents: number | null;
  /** reference-melody note name at this take-time (empty when not recording) */
  targetNote: string;
  /** reference-melody f0 at this take-time (0 when not recording) */
  targetF0: number;
  /** loudness, 0..1 */
  rms: number;
  /** breath-support proxy from loudness stability, 0..1 */
  breathSupport: number;
  /** normalized harmonic amplitudes H1..H8, each 0..1 (relative to strongest) */
  harmonics: number[];
  /** spectral centroid mapped to 0..1 ("brightness") */
  brightness: number;
  /** estimated formants [F1, F2, F3] in Hz (0 when unavailable) */
  formants: [number, number, number];
  /** estimated vibrato rate in Hz */
  vibratoRate: number;
  /** estimated vibrato extent in cents */
  vibratoExtent: number;
}

export function emptyFrame(): FeatureFrame {
  return {
    t: 0,
    hasPitch: false,
    f0: 0,
    clarity: 0,
    midi: 0,
    note: "--",
    cents: 0,
    melodyCents: null,
    targetNote: "",
    targetF0: 0,
    rms: 0,
    breathSupport: 0,
    harmonics: [0, 0, 0, 0, 0, 0, 0, 0],
    brightness: 0,
    formants: [0, 0, 0],
    vibratoRate: 0,
    vibratoExtent: 0,
  };
}

export const HARMONIC_COUNT = 8;
