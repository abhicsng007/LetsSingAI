// The "correct" target the live voice is compared against, plus the scripted
// pre-sing demo that walks through good technique part by part.
//
// Target model = HYBRID: pitch & vowel targets follow the reference song at the
// current take time (lenient on timing), while posture targets — breath
// support, open throat, forward placement — come from an ideal "good singer"
// baseline. This stays useful even when the singer drifts off the reference
// tempo.

import type { FeatureFrame } from "../audio/types";
import { emptyFrame } from "../audio/types";
import { getCurrentSong, refFrameAt } from "../data/songs";
import type { RefFrame } from "../data/songs";
import { freqToMidi } from "../analysis/pitch";
import type { AnatomyPose } from "./pose";
import { clamp } from "../three/smooth";
import { poseFromFeature } from "./pose";

// An ideal, well-supported, open, forward-placed instrument. Pitch/vowel
// fields are placeholders — overwritten from the reference when available.
const BASELINE: AnatomyPose = {
  voiced: 1,
  airflow: 0.6,
  breath: 0.78,
  pressure: 0.72,
  pitchN: 0.5,
  bright: 0.55,
  tongueHigh: 0.4,
  tongueFront: 0.55,
  jaw: 0.55,
  lipRound: 0.35,
  velumOpen: 0.08, // raised soft palate -> full, non-nasal tone
  larynx: 0, // low & relaxed
  chest: 0,
  mouth: 0,
  head: 0,
  hue: 0.4,
};

/** Convert a reference-song frame into a minimal FeatureFrame for pose mapping. */
function refToFeature(rf: RefFrame): FeatureFrame {
  const f = emptyFrame();
  f.hasPitch = true;
  f.f0 = rf.f0;
  f.midi = freqToMidi(rf.f0);
  f.rms = rf.rms;
  f.breathSupport = 0.8;
  f.brightness = 0.55;
  f.formants = rf.formants;
  return f;
}

function withResonance(p: AnatomyPose): AnatomyPose {
  return {
    ...p,
    chest: p.voiced * clamp(1 - p.pitchN, 0, 1),
    mouth: p.voiced * clamp(1 - Math.abs(p.pitchN - 0.5) * 1.7, 0, 1) * (0.5 + 0.5 * p.bright),
    head: p.voiced * clamp(p.pitchN, 0, 1) * (0.5 + 0.5 * p.bright),
  };
}

/**
 * The ideal target pose at take-time `t`. When the singer is voicing and a
 * reference frame exists, the pitch and vowel (jaw/tongue/lips) targets follow
 * the reference; posture always follows the good-technique baseline.
 */
export function idealPoseAt(t: number, live?: FeatureFrame): AnatomyPose {
  const target: AnatomyPose = { ...BASELINE };
  const singing = live?.hasPitch ?? true;
  const rf = singing ? refFrameAt(getCurrentSong(), t) : null;

  if (rf) {
    const ref = poseFromFeature(refToFeature(rf));
    target.pitchN = ref.pitchN;
    target.hue = ref.hue;
    target.jaw = ref.jaw;
    target.tongueHigh = ref.tongueHigh;
    target.tongueFront = ref.tongueFront;
    target.lipRound = ref.lipRound;
    target.voiced = 1;
  } else {
    target.voiced = singing ? 1 : 0;
  }
  return withResonance(target);
}

// Pre-sing demo choreography lives in demo.ts (step-by-step 3D motion, not a
// looping "sing the phrase" pose). Re-exported so older imports keep working.
export {
  DEMO_PHASES,
  DEMO_PHASE_SEC,
  DEMO_TOTAL_SEC,
  demoPhaseIndex,
  demoPose,
} from "./demo";
export type { DemoPhase } from "./demo";
