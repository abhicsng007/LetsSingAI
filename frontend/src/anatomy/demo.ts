// Pre-sing technique demo: a scripted 3D walk-through of the breath-to-resonance
// chain. Each phase isolates one part, plays a rest → action → hold cycle so
// the motion is readable, and names the beat currently on screen.
//
// The live "sing the reference phrase" pose is NOT used here — that kept every
// part moving at once, so the caption changed while the figure just sang.

import type { AnatomyPose } from "./pose";
import type { Part } from "./faults";
import { clamp } from "../three/smooth";

export interface DemoBeat {
  /** start of this beat, 0..1 of the phase */
  at: number;
  /** short action line, kept in sync with the 3D motion */
  cue: string;
}

export interface DemoCamera {
  pos: [number, number, number];
  target: [number, number, number];
}

export interface DemoPhase {
  part: Part;
  extraParts: Part[];
  title: string;
  body: string;
  beats: DemoBeat[];
  camera: DemoCamera;
}

export interface DemoHighlight {
  part: Part;
  sev: number;
}

export interface DemoCaptionState {
  title: string;
  body: string;
  beat: string;
  step: number;
  steps: number;
  progress: number;
}

export interface DemoSnapshot {
  key: string;
  index: number;
  local: number;
  phase: DemoPhase;
  beat: DemoBeat;
  pose: AnatomyPose;
  highlights: DemoHighlight[];
  camera: DemoCamera;
  caption: DemoCaptionState;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function easeInOut(t: number): number {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function seg(t: number, a: number, b: number): number {
  if (b <= a) return 1;
  return clamp((t - a) / (b - a), 0, 1);
}

function lerpVec(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** Quiet, empty instrument — start of the breath lesson. */
const EMPTY: AnatomyPose = {
  voiced: 0,
  airflow: 0.05,
  breath: 0.22,
  pressure: 0.1,
  pitchN: 0.38,
  bright: 0.4,
  tongueHigh: 0.34,
  tongueFront: 0.52,
  jaw: 0.16,
  lipRound: 0.28,
  velumOpen: 0.18,
  larynx: 0.1,
  chest: 0,
  mouth: 0,
  head: 0,
  hue: 0.46,
};

/** Stable "good singer ready" hold used between featured motions. */
const HOLD: AnatomyPose = {
  voiced: 0,
  airflow: 0.2,
  breath: 0.64,
  pressure: 0.6,
  pitchN: 0.42,
  bright: 0.48,
  tongueHigh: 0.38,
  tongueFront: 0.6,
  jaw: 0.34,
  lipRound: 0.34,
  velumOpen: 0.07,
  larynx: 0.02,
  chest: 0.12,
  mouth: 0.16,
  head: 0.1,
  hue: 0.42,
};

function copy(src: AnatomyPose): AnatomyPose {
  return { ...src };
}

export const DEMO_PHASES: DemoPhase[] = [
  {
    part: "diaphragm",
    extraParts: [],
    title: "1 · Breath & support",
    body: "Inhale low — belly and lower ribs expand, shoulders stay still. The diaphragm drops and stays engaged to feed a steady, gently-resisted airstream.",
    beats: [
      { at: 0, cue: "Rest. Shoulders stay still." },
      { at: 0.1, cue: "Inhale low — diaphragm drops, ribs expand." },
      { at: 0.42, cue: "Stay engaged — don't dump the air." },
      { at: 0.56, cue: "Controlled exhale — a steady, resisted airstream." },
    ],
    camera: { pos: [2.5, 0.4, 7.0], target: [0.1, -0.25, 0] },
  },
  {
    part: "folds",
    extraParts: [],
    title: "2 · Vocal folds",
    body: "The folds come together and vibrate. Pitch rides on steady breath pressure — found from the airstream, never pushed from the throat.",
    beats: [
      { at: 0, cue: "Folds rest open while you breathe." },
      { at: 0.18, cue: "They come together (adduction)." },
      { at: 0.38, cue: "Vibration starts — pitch rides on the airstream." },
      { at: 0.58, cue: "Higher pitch: folds stretch and thin." },
      { at: 0.82, cue: "Pitch eases back — still on the breath, not a push." },
    ],
    camera: { pos: [2.55, 0.45, 7.0], target: [0.15, -0.1, 0] },
  },
  {
    part: "throat",
    extraParts: [],
    title: "3 · Open throat",
    body: "Keep the pharynx open and the larynx low and relaxed — the feeling at the start of a yawn — so the tone rings freely.",
    beats: [
      { at: 0, cue: "Starting high and tight — this chokes the tone." },
      { at: 0.22, cue: "Yawn-open: larynx drops, pharynx widens." },
      { at: 0.48, cue: "Hold the open throat — low and relaxed." },
      { at: 0.72, cue: "If it creeps up, drop it again." },
    ],
    camera: { pos: [2.55, 0.48, 7.0], target: [0.18, -0.08, 0] },
  },
  {
    part: "jaw",
    extraParts: [],
    title: "4 · Jaw & vowel",
    body: "Let the jaw drop loosely for open vowels so the lip ring becomes a tall oval and the sound is released, not swallowed or pinched.",
    beats: [
      { at: 0, cue: "Jaw almost closed — the vowel is pinched." },
      { at: 0.16, cue: "Drop the jaw from the hinge, loose, not shoved." },
      { at: 0.46, cue: "Hold the open /a/ — a tall oval at the lips." },
      { at: 0.7, cue: "Close a little, then drop again for the vowel." },
    ],
    camera: { pos: [2.65, 0.5, 7.0], target: [0.3, -0.06, 0] },
  },
  {
    part: "tongue",
    extraParts: [],
    title: "5 · Tongue",
    body: "The tongue shapes each vowel — forward and relaxed, tip resting at the lower front teeth.",
    beats: [
      { at: 0, cue: "/a/ (ah) — tongue low, jaw open." },
      { at: 0.24, cue: "/i/ (ee) — tongue high and forward, tip at the teeth." },
      { at: 0.5, cue: "/u/ (oo) — tongue high and back, lips round." },
      { at: 0.76, cue: "Rest forward — tip stays at the lower front teeth." },
    ],
    camera: { pos: [2.7, 0.52, 7.0], target: [0.32, -0.04, 0] },
  },
  {
    part: "velum",
    extraParts: [],
    title: "6 · Soft palate",
    body: "The soft palate lifts to close off the nose for a full, non-nasal tone; it lowers only for nasal consonants.",
    beats: [
      { at: 0, cue: "Palate down — the nasal port is open." },
      { at: 0.2, cue: "Lift the soft palate — it swings up and back." },
      { at: 0.48, cue: "Hold it raised for a full, non-nasal tone." },
      { at: 0.72, cue: "A quick nasal, then lift again for the vowel." },
    ],
    camera: { pos: [2.6, 0.52, 7.0], target: [0.28, -0.02, 0] },
  },
  {
    part: "placement",
    extraParts: [],
    title: "7 · Forward resonance",
    body: "Collect the lips into a smaller, more forward O — the high-note aperture — and send the tone into the mask so it rings.",
    beats: [
      { at: 0, cue: "Tone sits back — lips spread, mask is dark." },
      { at: 0.2, cue: "Collect into a forward O and send it to the mask." },
      { at: 0.5, cue: "Hold the ring — head resonance lights up." },
      { at: 0.78, cue: "If it swallows, collect forward again." },
    ],
    camera: { pos: [2.7, 0.5, 7.0], target: [0.35, -0.04, 0] },
  },
];

export const DEMO_PHASE_SEC = 6.6;
export const DEMO_TOTAL_SEC = DEMO_PHASES.length * DEMO_PHASE_SEC;

let origin = 0;
let running = false;
let lastElapsed = 0;
let pendingSeek: number | null = null;

/** Jump the shared demo clock (used by the 3D loop on the next frame). */
export function seekDemo(elapsed: number): void {
  pendingSeek = Math.max(0, elapsed);
  lastElapsed = pendingSeek;
}

/** Shared demo clock so the model, captions and camera stay on the same beat. */
export function getDemoElapsed(active: boolean, now: number): number {
  if (!active) {
    running = false;
    lastElapsed = 0;
    pendingSeek = null;
    return 0;
  }
  if (pendingSeek !== null) {
    origin = now - pendingSeek;
    lastElapsed = pendingSeek;
    pendingSeek = null;
    running = true;
    return lastElapsed;
  }
  if (!running) {
    running = true;
    origin = now;
  }
  lastElapsed = now - origin;
  return lastElapsed;
}

export function peekDemoElapsed(): number {
  return lastElapsed;
}

export function demoPhaseIndex(elapsed: number): number {
  const t = ((elapsed % DEMO_TOTAL_SEC) + DEMO_TOTAL_SEC) % DEMO_TOTAL_SEC;
  return Math.min(DEMO_PHASES.length - 1, Math.floor(t / DEMO_PHASE_SEC));
}

export function demoPhaseProgress(elapsed: number): { index: number; local: number } {
  const t = ((elapsed % DEMO_TOTAL_SEC) + DEMO_TOTAL_SEC) % DEMO_TOTAL_SEC;
  const index = Math.min(DEMO_PHASES.length - 1, Math.floor(t / DEMO_PHASE_SEC));
  const local = clamp((t - index * DEMO_PHASE_SEC) / DEMO_PHASE_SEC, 0, 1);
  return { index, local };
}

function pickBeat(beats: DemoBeat[], local: number): DemoBeat {
  let chosen = beats[0]!;
  for (const b of beats) {
    if (local + 1e-6 >= b.at) chosen = b;
  }
  return chosen;
}

function beatIndex(beats: DemoBeat[], local: number): number {
  let idx = 0;
  for (let i = 0; i < beats.length; i++) {
    if (local + 1e-6 >= beats[i]!.at) idx = i;
  }
  return idx;
}

/** Two identical breath cycles packed into local 0..1. */
function cycle2(local: number): number {
  return (local * 2) % 1;
}

function animateBreath(p: AnatomyPose, local: number): void {
  const u = cycle2(local);
  Object.assign(p, EMPTY);
  p.jaw = 0.2;
  p.velumOpen = 0.12;
  p.larynx = 0.04;
  if (u < 0.1) {
    p.breath = 0.22;
    p.pressure = 0.12;
    p.airflow = 0.06;
  } else if (u < 0.42) {
    const t = easeInOut(seg(u, 0.1, 0.42));
    p.breath = lerp(0.22, 0.96, t);
    p.pressure = lerp(0.12, 0.8, t);
    p.airflow = lerp(0.1, 0.32, t);
  } else if (u < 0.56) {
    p.breath = 0.96;
    p.pressure = 0.9;
    p.airflow = 0.22;
  } else {
    const t = easeInOut(seg(u, 0.56, 1));
    p.breath = lerp(0.96, 0.38, t);
    p.pressure = lerp(0.9, 0.52, t);
    p.airflow = lerp(0.78, 0.2, t);
  }
}

function animateFolds(p: AnatomyPose, local: number): void {
  Object.assign(p, HOLD);
  p.breath = 0.72;
  p.pressure = 0.7;
  p.jaw = 0.28;
  if (local < 0.18) {
    p.voiced = 0;
    p.airflow = 0.35;
    p.pitchN = 0.32;
  } else if (local < 0.38) {
    const t = easeInOut(seg(local, 0.18, 0.38));
    p.voiced = lerp(0, 1, t);
    p.airflow = lerp(0.35, 0.62, t);
    p.pitchN = 0.34;
  } else if (local < 0.58) {
    p.voiced = 1;
    p.airflow = 0.65;
    p.pitchN = 0.36;
    p.hue = 0.5;
  } else if (local < 0.82) {
    const t = easeInOut(seg(local, 0.58, 0.82));
    p.voiced = 1;
    p.airflow = 0.7;
    p.pitchN = lerp(0.36, 0.88, t);
    p.hue = lerp(0.5, 0.08, t);
  } else {
    const t = easeInOut(seg(local, 0.82, 1));
    p.voiced = 1;
    p.airflow = 0.62;
    p.pitchN = lerp(0.88, 0.4, t);
    p.hue = lerp(0.08, 0.46, t);
  }
  p.chest = p.voiced * (1 - p.pitchN) * 0.7;
  p.mouth = p.voiced * 0.35;
  p.head = p.voiced * p.pitchN * 0.55;
}

function animateThroat(p: AnatomyPose, local: number): void {
  Object.assign(p, HOLD);
  p.voiced = 0.7;
  p.airflow = 0.55;
  p.breath = 0.7;
  p.pressure = 0.66;
  p.jaw = 0.42;
  p.pitchN = 0.48;
  if (local < 0.2) {
    p.larynx = 0.92;
  } else if (local < 0.48) {
    p.larynx = lerp(0.92, 0, easeInOut(seg(local, 0.2, 0.48)));
  } else if (local < 0.7) {
    p.larynx = 0;
  } else if (local < 0.82) {
    p.larynx = lerp(0, 0.55, easeInOut(seg(local, 0.7, 0.82)));
  } else {
    p.larynx = lerp(0.55, 0, easeInOut(seg(local, 0.82, 1)));
  }
}

function animateJaw(p: AnatomyPose, local: number): void {
  Object.assign(p, HOLD);
  p.voiced = 0.25;
  p.airflow = 0.4;
  p.larynx = 0;
  p.lipRound = 0.22;
  if (local < 0.14) {
    p.jaw = 0.1;
  } else if (local < 0.46) {
    p.jaw = lerp(0.1, 0.95, easeInOut(seg(local, 0.14, 0.46)));
  } else if (local < 0.68) {
    p.jaw = 0.95;
  } else if (local < 0.82) {
    p.jaw = lerp(0.95, 0.28, easeInOut(seg(local, 0.68, 0.82)));
  } else {
    p.jaw = lerp(0.28, 0.88, easeInOut(seg(local, 0.82, 1)));
  }
}

function animateTongue(p: AnatomyPose, local: number): void {
  Object.assign(p, HOLD);
  p.voiced = 0;
  p.airflow = 0.28;
  p.larynx = 0;
  p.velumOpen = 0.06;
  if (local < 0.24) {
    const t = easeInOut(seg(local, 0, 0.18));
    p.jaw = lerp(0.4, 0.88, t);
    p.tongueHigh = lerp(0.4, 0.12, t);
    p.tongueFront = lerp(0.55, 0.5, t);
    p.lipRound = 0.22;
  } else if (local < 0.5) {
    const t = easeInOut(seg(local, 0.24, 0.42));
    p.jaw = lerp(0.88, 0.32, t);
    p.tongueHigh = lerp(0.12, 0.9, t);
    p.tongueFront = lerp(0.5, 0.94, t);
    p.lipRound = lerp(0.22, 0.18, t);
  } else if (local < 0.76) {
    const t = easeInOut(seg(local, 0.5, 0.68));
    p.jaw = lerp(0.32, 0.38, t);
    p.tongueHigh = lerp(0.9, 0.82, t);
    p.tongueFront = lerp(0.94, 0.16, t);
    p.lipRound = lerp(0.18, 0.88, t);
  } else {
    const t = easeInOut(seg(local, 0.76, 0.92));
    p.jaw = lerp(0.38, 0.5, t);
    p.tongueHigh = lerp(0.82, 0.4, t);
    p.tongueFront = lerp(0.16, 0.72, t);
    p.lipRound = lerp(0.88, 0.3, t);
  }
}

function animateVelum(p: AnatomyPose, local: number): void {
  Object.assign(p, HOLD);
  p.voiced = 0;
  p.airflow = 0.3;
  p.jaw = 0.62; // open enough to see the palate flap
  p.tongueHigh = 0.28;
  p.tongueFront = 0.55;
  p.larynx = 0;
  if (local < 0.18) {
    p.velumOpen = 0.88;
  } else if (local < 0.48) {
    p.velumOpen = lerp(0.88, 0.04, easeInOut(seg(local, 0.18, 0.48)));
  } else if (local < 0.7) {
    p.velumOpen = 0.04;
  } else if (local < 0.82) {
    p.velumOpen = lerp(0.04, 0.7, easeInOut(seg(local, 0.7, 0.82)));
  } else {
    p.velumOpen = lerp(0.7, 0.04, easeInOut(seg(local, 0.82, 1)));
  }
}

function animatePlacement(p: AnatomyPose, local: number): void {
  Object.assign(p, HOLD);
  p.voiced = 1;
  p.airflow = 0.62;
  p.breath = 0.72;
  p.pressure = 0.7;
  p.larynx = 0;
  p.velumOpen = 0.05;
  p.tongueFront = 0.62;
  if (local < 0.18) {
    p.lipRound = 0.12;
    p.jaw = 0.72;
    p.pitchN = 0.32;
    p.bright = 0.35;
    p.chest = 0.45;
    p.mouth = 0.25;
    p.head = 0.05;
    p.hue = 0.52;
  } else if (local < 0.5) {
    const t = easeInOut(seg(local, 0.18, 0.5));
    p.lipRound = lerp(0.12, 0.86, t);
    p.jaw = lerp(0.72, 0.38, t);
    p.pitchN = lerp(0.32, 0.84, t);
    p.bright = lerp(0.35, 0.7, t);
    p.chest = lerp(0.45, 0.15, t);
    p.mouth = lerp(0.25, 0.45, t);
    p.head = lerp(0.05, 0.95, t);
    p.hue = lerp(0.52, 0.1, t);
  } else if (local < 0.76) {
    p.lipRound = 0.86;
    p.jaw = 0.38;
    p.pitchN = 0.84;
    p.bright = 0.7;
    p.chest = 0.15;
    p.mouth = 0.45;
    p.head = 0.85 + 0.12 * Math.sin(local * 28);
    p.hue = 0.1;
  } else {
    const t = easeInOut(seg(local, 0.76, 0.88));
    p.lipRound = lerp(0.86, 0.35, t);
    p.jaw = lerp(0.38, 0.6, t);
    p.pitchN = lerp(0.84, 0.5, t);
    p.head = lerp(0.9, 0.2, t);
    p.hue = lerp(0.1, 0.4, t);
    if (local > 0.88) {
      const t2 = easeInOut(seg(local, 0.88, 1));
      p.lipRound = lerp(0.35, 0.84, t2);
      p.jaw = lerp(0.6, 0.4, t2);
      p.pitchN = lerp(0.5, 0.8, t2);
      p.head = lerp(0.2, 0.92, t2);
    }
  }
}

const ANIM: Array<(p: AnatomyPose, local: number) => void> = [
  animateBreath,
  animateFolds,
  animateThroat,
  animateJaw,
  animateTongue,
  animateVelum,
  animatePlacement,
];

function cameraAt(index: number, local: number, elapsed: number): DemoCamera {
  const cam = DEMO_PHASES[index]!.camera;
  const fade = easeInOut(seg(local, 0.86, 1));
  const next = DEMO_PHASES[(index + 1) % DEMO_PHASES.length]!.camera;
  const pos = fade > 0 ? lerpVec(cam.pos, next.pos, fade) : cam.pos;
  const target = fade > 0 ? lerpVec(cam.target, next.target, fade) : cam.target;
  const orbit = Math.sin(elapsed * 0.28) * 0.06;
  const bob = Math.cos(elapsed * 0.22) * 0.03;
  return {
    pos: [pos[0] + orbit, pos[1] + bob * 0.35, pos[2] + bob],
    target,
  };
}

function highlightsFor(phase: DemoPhase, local: number, elapsed: number): DemoHighlight[] {
  const pulse = 0.62 + 0.38 * Math.sin(elapsed * 3.4);
  const action = local > 0.08 && local < 0.92 ? 1 : 0.7;
  const out: DemoHighlight[] = [{ part: phase.part, sev: pulse * action }];
  for (const extra of phase.extraParts) {
    out.push({ part: extra, sev: 0.4 + 0.18 * Math.sin(elapsed * 2.6) });
  }
  return out;
}

export function demoSnapshot(elapsed: number): DemoSnapshot {
  const { index, local } = demoPhaseProgress(elapsed);
  const phase = DEMO_PHASES[index]!;
  const beatLocal = phase.part === "diaphragm" ? cycle2(local) : local;
  const beat = pickBeat(phase.beats, beatLocal);
  const pose = copy(HOLD);
  ANIM[index]!(pose, local);
  const highlights = highlightsFor(phase, local, elapsed);
  const camera = cameraAt(index, local, elapsed);
  const bi = beatIndex(phase.beats, beatLocal);
  return {
    key: `${index}:${bi}`,
    index,
    local,
    phase,
    beat,
    pose,
    highlights,
    camera,
    caption: {
      title: phase.title,
      body: phase.body,
      beat: beat.cue,
      step: index + 1,
      steps: DEMO_PHASES.length,
      progress: local,
    },
  };
}

export function demoPose(elapsed: number): AnatomyPose {
  return demoSnapshot(elapsed).pose;
}

export const initialDemoCaption: DemoCaptionState = {
  title: DEMO_PHASES[0]!.title,
  body: DEMO_PHASES[0]!.body,
  beat: DEMO_PHASES[0]!.beats[0]!.cue,
  step: 1,
  steps: DEMO_PHASES.length,
  progress: 0,
};
