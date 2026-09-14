// Public-domain reference phrases. Same shape as analysis/analyze_song.py output.

import { centsBetween, midiToFreq, snapOctaveToTarget } from "../analysis/pitch";
import { LISTENER } from "../analysis/humanPitch";

export interface RefFrame {
  t: number;
  f0: number;
  harmonics: number[];
  formants: [number, number, number];
  rms: number;
}

export interface RefSection {
  name: string;
  start: number;
  end: number;
}

export interface MelodyNote {
  midi: number;
  beats: number;
  start: number;
  duration: number;
  f0: number;
}

export interface ReferenceSong {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  duration: number;
  vowel: string;
  frames: RefFrame[];
  sections: RefSection[];
  notes: MelodyNote[];
  /** Public-folder URL of a real sung recording (CC0 / PD), if we have one. */
  vocalUrl?: string;
  /** Seconds of that file to play (first verse). */
  vocalDuration?: number;
  /**
   * Semitones to shift our MIDI melody when scoring that recording.
   * The CC0 Twinkle vocal is near D3, not our C4 chart.
   */
  vocalTranspose?: number;
}

const BASE_HARMONICS = [1.0, 0.85, 0.6, 0.45, 0.32, 0.22, 0.15, 0.1];
const AH_FORMANTS: [number, number, number] = [720, 1150, 2600];

function buildSong(
  id: string,
  title: string,
  artist: string,
  bpm: number,
  melody: [number, number][],
  vowel = "ah",
): ReferenceSong {
  const beat = 60 / bpm;
  const step = 0.05;
  const frames: RefFrame[] = [];
  const notes: MelodyNote[] = [];
  let t = 0;
  melody.forEach(([midi, beats], noteIndex) => {
    const dur = beats * beat;
    const f0 = midiToFreq(midi);
    const wiggle = 0.08 * Math.sin(noteIndex * 1.3);
    const harmonics = BASE_HARMONICS.map((h, i) =>
      Math.max(0, Math.min(1, h + wiggle * Math.cos(i))),
    );
    const noteStart = t;
    notes.push({ midi, beats, start: noteStart, duration: dur, f0 });
    for (let local = 0; local < dur - 1e-6; local += step) {
      const attack = Math.min(1, local / 0.08);
      const decay = 1 - 0.15 * (local / dur);
      const rms = 0.72 * attack * decay;
      frames.push({
        t: +(noteStart + local).toFixed(3),
        f0,
        harmonics,
        formants: AH_FORMANTS,
        rms,
      });
    }
    t += dur;
  });
  const half = t / 2;
  return {
    id,
    title,
    artist,
    bpm,
    duration: +t.toFixed(2),
    vowel,
    frames,
    notes,
    sections: [
      { name: "Line 1", start: 0, end: +half.toFixed(2) },
      { name: "Line 2", start: +half.toFixed(2), end: +t.toFixed(2) },
    ],
  };
}

const VOCALS: Partial<
  Record<string, { vocalUrl: string; vocalDuration: number; vocalTranspose: number }>
> = {
  twinkle: {
    vocalUrl: "/voices/twinkle-vocal.mp3",
    vocalDuration: 24,
    // Measured f0: ~C#3/Db, not our C4 chart. −11 = octave down + 1 semitone.
    vocalTranspose: -11,
  },
};

/** Twinkle Twinkle Little Star — public domain, C major. */
const TWINKLE = buildSong(
  "twinkle",
  "Twinkle Twinkle Little Star",
  "Traditional (public domain)",
  100,
  [
    [60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2],
    [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2],
  ],
);

/** Ode to Joy opening — public domain (Beethoven). */
const ODE = buildSong(
  "ode-to-joy",
  "Ode to Joy",
  "Beethoven (public domain)",
  108,
  [
    [64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1],
    [60, 1], [60, 1], [62, 1], [64, 1], [64, 1.5], [62, 0.5], [62, 2],
  ],
);

/** Amazing Grace opening — public domain. */
const GRACE = buildSong(
  "amazing-grace",
  "Amazing Grace",
  "Traditional (public domain)",
  72,
  [
    [62, 1], [67, 2], [69, 1], [67, 2], [64, 1], [62, 2],
    [62, 1], [67, 2], [69, 1], [67, 3],
  ],
);

export const SONGS: ReferenceSong[] = [TWINKLE, ODE, GRACE].map((s) => ({
  ...s,
  ...(VOCALS[s.id] ?? {}),
}));

export const songBus: { current: ReferenceSong } = { current: SONGS[0] };

export function getCurrentSong(): ReferenceSong {
  return songBus.current;
}

export function setCurrentSong(id: string): ReferenceSong {
  const found = SONGS.find((s) => s.id === id) ?? SONGS[0];
  songBus.current = found;
  return found;
}

export function refFrameAt(song: ReferenceSong, t: number): RefFrame | null {
  if (song.frames.length === 0) return null;
  if (t < -0.05 || t > song.duration + 0.2) return null;
  const idx = Math.round(t / 0.05);
  if (idx < 0 || idx >= song.frames.length) return null;
  return song.frames[idx];
}

/**
 * Melody note a listener would credit at time t for sung f0.
 * Exact chart time is too strict — people land a bit late/early — so we
 * pick the nearby written note whose pitch is closest to what they sang.
 */
export function melodyNoteNear(
  song: ReferenceSong,
  t: number,
  f0: number,
): MelodyNote | null {
  if (song.notes.length === 0 || f0 <= 0) return null;
  const late = LISTENER.lateWindowSec;
  const early = LISTENER.earlyWindowSec;
  let best: MelodyNote | null = null;
  let bestScore = Infinity;
  for (const n of song.notes) {
    const n0 = n.start;
    const n1 = n.start + n.duration;
    if (n1 < t - late || n0 > t + early) continue;
    const folded = snapOctaveToTarget(f0, n.f0);
    const err = Math.abs(centsBetween(folded, n.f0));
    const covers = t >= n0 && t < n1 ? 0 : 12;
    const score = err + covers;
    if (score < bestScore) {
      bestScore = score;
      best = n;
    }
  }
  if (best) return best;
  let nearest = song.notes[0]!;
  let nearestDt = Math.abs(t - (nearest.start + nearest.duration / 2));
  for (const n of song.notes) {
    const dt = Math.abs(t - (n.start + n.duration / 2));
    if (dt < nearestDt) {
      nearest = n;
      nearestDt = dt;
    }
  }
  return nearest;
}

/** MIDI staff range: the phrase plus a little headroom, not a full piano. */
export function pitchStaffRange(song: ReferenceSong, transpose = 0): { lo: number; hi: number } {
  const midis = song.notes.map((n) => n.midi + transpose);
  const min = Math.min(...midis);
  const max = Math.max(...midis);
  const pad = 3;
  let lo = min - pad;
  let hi = max + pad;
  if (hi - lo < 12) {
    const mid = (lo + hi) / 2;
    lo = mid - 6;
    hi = mid + 6;
  }
  return { lo, hi };
}

/** @deprecated use getCurrentSong() — kept so older imports keep working. */
export const REFERENCE_SONG = TWINKLE;
