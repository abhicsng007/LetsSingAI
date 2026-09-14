// The shared "anatomy pose" — a set of normalized 0..1 parameters describing
// how every moving part of the singing instrument is positioned/engaged.
//
// One pose model is rendered three ways by Anatomy3D:
//   • YOU     — driven live from the microphone feature frame
//   • TARGET  — the ideal "ghost" it should match (see ideal.ts)
//   • DEMO    — a scripted ideal walk-through before you sing
//
// Keeping the feature -> pose mapping and the pose -> geometry kinematics here
// (instead of inline in the component) is what lets the same math drive the
// solid "you" body, the translucent target ghost, and the fault comparison.
//
// Acoustically-inferred educational model — not medical imaging.

import type { FeatureFrame } from "../audio/types";
import { clamp, damp, mapRange } from "../three/smooth";

export interface AnatomyPose {
  /** vocal folds adducted & vibrating, 0..1 */
  voiced: number;
  /** airflow speed through the tract, 0..1 */
  airflow: number;
  /** lung inflation, 0..1 */
  breath: number;
  /** diaphragm/breath-support engagement, 0..1 */
  pressure: number;
  /** normalized pitch (midi 48..74 -> 0..1) */
  pitchN: number;
  /** timbral brightness, 0..1 */
  bright: number;
  /** tongue height (1 = high/closed vowel), 0..1 */
  tongueHigh: number;
  /** tongue frontness (1 = front vowel), 0..1 */
  tongueFront: number;
  /** jaw opening, 0..1 */
  jaw: number;
  /** lip rounding, 0..1 */
  lipRound: number;
  /** velum lowered / nasal port open, 0..1 */
  velumOpen: number;
  /** larynx raise / throat squeeze (0 = low & relaxed = good), 0..1 */
  larynx: number;
  /** chest resonance activation, 0..1 */
  chest: number;
  /** mouth resonance activation, 0..1 */
  mouth: number;
  /** head resonance activation, 0..1 */
  head: number;
  /** colour hue for the vibrating folds / pitch, 0..1 */
  hue: number;
}

// Per-field smoothing rates (matched to the original Anatomy3D feel).
const LAMBDA: Record<keyof AnatomyPose, number> = {
  voiced: 10, airflow: 8, breath: 4, pressure: 5, pitchN: 6, bright: 5,
  tongueHigh: 5, tongueFront: 5, jaw: 5, lipRound: 5, velumOpen: 4,
  larynx: 5, chest: 5, mouth: 5, head: 5, hue: 6,
};

const POSE_KEYS = Object.keys(LAMBDA) as (keyof AnatomyPose)[];

export function neutralPose(): AnatomyPose {
  return {
    voiced: 0, airflow: 0.05, breath: 0.3, pressure: 0.3, pitchN: 0.5,
    bright: 0.3, tongueHigh: 0.4, tongueFront: 0.5, jaw: 0.12, lipRound: 0.3,
    velumOpen: 0.15, larynx: 0, chest: 0, mouth: 0, head: 0, hue: 0.5,
  };
}

/** Recompute the three resonance-zone activations from pitch/brightness/voiced. */
function resonance(voiced: number, pitchN: number, bright: number) {
  return {
    chest: voiced * clamp(1 - pitchN, 0, 1),
    mouth: voiced * clamp(1 - Math.abs(pitchN - 0.5) * 1.7, 0, 1) * (0.5 + 0.5 * bright),
    head: voiced * clamp(pitchN, 0, 1) * (0.5 + 0.5 * bright),
  };
}

/**
 * Map a live analysis frame to its (un-damped) target anatomy pose. `prev` is
 * used to hold vowel/pitch-dependent values steady across brief unvoiced gaps.
 */
export function poseFromFeature(f: FeatureFrame, prev?: AnatomyPose): AnatomyPose {
  const breathing = !f.hasPitch && f.rms > 0.03;
  const voiced = f.hasPitch ? 1 : 0;

  const airflow = f.hasPitch
    ? clamp(f.rms * 1.1 + 0.15, 0, 1)
    : breathing ? clamp(f.rms, 0, 0.7) : 0.05;
  const breath = f.hasPitch
    ? Math.max(f.breathSupport, 0.25)
    : breathing ? clamp(f.rms, 0, 0.7) : 0.3;
  const pressure = f.hasPitch ? f.breathSupport : breathing ? f.rms * 0.5 : 0.12;
  const bright = f.hasPitch ? f.brightness : prev?.bright ?? 0.3;
  const pitchN = f.hasPitch ? clamp(mapRange(f.midi, 48, 74, 0, 1), 0, 1) : prev?.pitchN ?? 0.5;
  const tongueHigh = f.hasPitch ? mapRange(f.formants[0], 300, 850, 1, 0) : prev?.tongueHigh ?? 0.4;
  const tongueFront = f.hasPitch ? mapRange(f.formants[1], 900, 2200, 0, 1) : prev?.tongueFront ?? 0.5;
  const jaw = f.hasPitch ? mapRange(f.formants[0], 300, 850, 0.1, 1) : breathing ? 0.3 : 0.12;
  const lipRound = f.hasPitch ? mapRange(f.formants[1], 900, 1600, 1, 0) : prev?.lipRound ?? 0.3;
  const velumOpen = f.hasPitch ? 0.06 : breathing ? 0.6 : 0.15;
  const hue = f.hasPitch ? mapRange(f.midi, 48, 74, 0.6, 0.02) : prev?.hue ?? 0.5;
  // Throat squeeze proxy: a raised larynx tends to read as an over-bright,
  // under-supported (pressed) tone. Educational proxy, kept gentle.
  const larynx = f.hasPitch
    ? clamp(mapRange(f.brightness, 0.5, 0.85, 0, 1) * mapRange(f.breathSupport, 0.55, 0.2, 0, 1), 0, 1)
    : 0;

  return {
    voiced, airflow, breath, pressure, pitchN, bright, tongueHigh, tongueFront,
    jaw, lipRound, velumOpen, larynx, hue,
    ...resonance(voiced, pitchN, bright),
  };
}

/** Frame-rate-independent damp of every field of `current` toward `target`. */
export function dampPose(current: AnatomyPose, target: AnatomyPose, dt: number): void {
  for (const k of POSE_KEYS) {
    current[k] = damp(current[k], target[k], LAMBDA[k], dt);
  }
}

// --- Pose -> geometry kinematics -------------------------------------------
// Pure functions so the "you" body and the target ghost stay perfectly
// consistent — both read the same formulas, only the pose differs.

export const lungScale = (p: AnatomyPose) => 0.72 + p.breath * 0.38 + p.airflow * 0.08;
/** Inferior expansion is larger than apical — matches real diaphragmatic breathing. */
export const lungScaleVec = (p: AnatomyPose): [number, number, number] => {
  const s = lungScale(p);
  return [s * 1.04, s * (1.0 + p.breath * 0.22), s * 1.06];
};
export const lungY = (p: AnatomyPose) => -1.28 - p.breath * 0.14;
export const diaphragmY = (p: AnatomyPose) => -2.12 - p.breath * 0.22;
/** Dome height: 1 = resting dome, 0 = flattened on a deep inhale. */
export const diaphragmDome = (p: AnatomyPose) => 1 - p.breath * 0.55;
export const ribOpen = (p: AnatomyPose) => p.breath * 0.16;
/**
 * Midline TMJ. Real jaws hinge at two condyles by the ears; we collapse that
 * to one sagittal hinge so the mandible, lower teeth, lower lip, hyoid and
 * tongue root all swing as one chain.
 */
export const TMJ = { x: 0.38, y: 1.20 };

/** Closed-jaw rest landmarks in Anatomy3D group space (x anterior, y up). */
export const REST = {
  upperIncisor: [1.80, 1.13] as const,
  lowerIncisor: [1.78, 1.03] as const,
  chin: [1.50, 0.72] as const,
  hyoid: [0.52, 0.56] as const,
  palatalAnt: [1.72, 1.23] as const,
  palatalMid: [1.20, 1.31] as const,
  palatalPost: [0.80, 1.25] as const,
  velumHinge: [0.80, 1.25] as const,
  nostril: [1.94, 1.33] as const,
  lipUpper: [1.84, 1.11] as const,
  lipLower: [1.84, 1.04] as const,
  mouth: [1.84, 1.075] as const,
  glottis: [0.08, 0.16] as const,
};

export function aroundTmj(x: number, y: number, angle: number): [number, number] {
  const dx = x - TMJ.x;
  const dy = y - TMJ.y;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [TMJ.x + c * dx - s * dy, TMJ.y + s * dx + c * dy];
}

/** Vaulted hard-palate height at a given anterior x. */
export function palateY(x: number): number {
  const u = clamp((x - 0.80) / 0.96, 0, 1);
  return 1.23 + 0.08 * Math.sin(u * Math.PI);
}

export const jawRot = (p: AnatomyPose) => -p.jaw * 0.28;
/** Raised (nasal closed) is negative — flap swings up and back to the pharynx. */
export const velumRot = (p: AnatomyPose) => -0.55 + p.velumOpen * 0.95;
export const larynxY = (p: AnatomyPose) => 0.16 + p.larynx * 0.16 - p.pitchN * 0.02;
/** Thyroid cartilage tilts forward as pitch rises (cricothyroid). */
export const thyroidTilt = (p: AnatomyPose) => p.pitchN * 0.28 + p.larynx * 0.12;

/**
 * Mouth as one lip ring (the rima oris). High notes collect into a smaller,
 * more forward O; low notes and open vowels drop into a taller oval; rounding
 * (from F2) turns the oval into a circle and protrudes it.
 */
export interface LipRingPose {
  x: number;
  y: number;
  /** half-width of the aperture, along Z */
  rx: number;
  /** half-height of the aperture, along Y */
  ry: number;
  tube: number;
}

export function lipRingPose(p: AnatomyPose): LipRingPose {
  const jaw = jawRot(p);
  const [, lowY] = aroundTmj(REST.lipLower[0], REST.lipLower[1], jaw);
  const topY = REST.lipUpper[1];
  // High notes collect the mouth (don't gape); low notes keep the jaw's opening.
  const collect = mapRange(p.pitchN, 0, 1, 1.06, 0.72);
  const span = Math.max(0.05, topY - lowY) * collect;
  const ry = span * 0.58 + 0.038;
  // Top of the ring stays on the maxilla; the aperture grows downward.
  const y = topY - ry;
  // Rounded / high → circular O. Spread / low → wide oval.
  const round = clamp(p.lipRound * 0.82 + p.pitchN * 0.28, 0, 1);
  const rx = (0.125 + p.jaw * 0.03) * mapRange(round, 0, 1, 1.36, 0.68);
  const protrude = 0.008 + round * 0.07 + p.pitchN * 0.02;
  const tube = 0.040 + (1 - round) * 0.008;
  return { x: REST.mouth[0] + protrude, y, rx, ry, tube };
}

export function hyoidWorld(p: AnatomyPose): [number, number] {
  const jaw = jawRot(p);
  const [x, y] = aroundTmj(REST.hyoid[0], REST.hyoid[1], jaw * 0.7);
  return [x, y - p.larynx * 0.05];
}

/**
 * Tongue body centre-line, root (hyoid) → tip (lower incisors), in group space.
 * Dorsum height aims at the (fixed) palate so the oral cavity stays a real
 * connected space as the jaw opens and the vowel changes.
 */
export function tongueCenterline(p: AnatomyPose): [number, number][] {
  const jaw = jawRot(p);
  const [tipX, tipY] = aroundTmj(REST.lowerIncisor[0] - 0.08, REST.lowerIncisor[1] + 0.01, jaw);
  const [hyX, hyY] = hyoidWorld(p);

  const peakX = mapRange(p.tongueFront, 0, 1, 0.78, 1.42);
  const pal = palateY(peakX);
  const lowY = Math.min(hyY + 0.28, pal - 0.36);
  const highY = pal - 0.07;
  const peakY = mapRange(p.tongueHigh, 0, 1, lowY, highY);

  const backX = mapRange(p.tongueFront, 0, 1, 0.48, 0.62);
  const pharynxX = 0.34 + p.tongueFront * 0.06;

  return [
    [hyX, hyY],
    [pharynxX, hyY + 0.18],
    [backX, (hyY + peakY) * 0.5 + 0.06],
    [peakX, peakY],
    [(peakX + tipX) * 0.55, (peakY + tipY) * 0.5 + 0.03],
    [tipX, tipY],
  ];
}

/** Glottal gap. Abducted when not voicing; adducted + mucosal wave when singing. */
export const foldGap = (p: AnatomyPose, phase: number) => {
  if (p.voiced < 0.2) return 0.078 + p.airflow * 0.02;
  const wave = 0.5 + 0.5 * Math.sin(phase);
  return 0.01 + p.voiced * wave * 0.038;
};
export const foldStretch = (p: AnatomyPose) => 0.9 + p.pitchN * 0.42;
export const foldThin = (p: AnatomyPose) => 1.08 - p.pitchN * 0.38;

/**
 * Opening of the glottis for a top-down 2D view, 0 = closed, 1 = fully abducted.
 * Same rules as foldGap: breath opens the V, voicing keeps a small oscillating slit.
 */
export const glottisOpen = (p: AnatomyPose, phase: number) => {
  if (p.voiced < 0.2) return 0.55 + p.airflow * 0.35;
  const wave = 0.5 + 0.5 * Math.sin(phase);
  return 0.05 + wave * 0.16;
};
