import type { DrillSpec, FocusTechnique } from "../coach/types";

export const DRILL_CATALOG: DrillSpec[] = [
  {
    id: "breath-hiss-1",
    title: "Hiss exercise",
    instruction:
      "Inhale for 4 counts, then hiss on 's' for 12–16 seconds. Keep the stream perfectly even — no pulses, no fade at the end.",
    kind: "hiss",
    durationSec: 16,
    technique: "breath-support",
    pass: [
      { metric: "breathSupport.mean", op: ">=", value: 0.55 },
      { metric: "durationSec", op: ">=", value: 8 },
    ],
  },
  {
    id: "breath-siren-1",
    title: "Supported siren",
    instruction:
      "Lip-trill or 'ng' siren from low to high and back, 8–10 seconds, without the air collapsing at the top.",
    kind: "siren",
    durationSec: 10,
    technique: "breath-support",
    pass: [
      { metric: "voicedRatio", op: ">=", value: 0.55 },
      { metric: "breathSupport.mean", op: ">=", value: 0.5 },
      { metric: "durationSec", op: ">=", value: 6 },
    ],
  },
  {
    id: "breath-vowel-1",
    title: "Phrase on 'oo'",
    instruction:
      "Sing the phrase on a steady 'oo'. Ignore words. Only the airstream matters — unwavering from first note to last.",
    kind: "vowel-phrase",
    durationSec: 12,
    technique: "breath-support",
    pass: [
      { metric: "breathSupport.mean", op: ">=", value: 0.55 },
      { metric: "voicedRatio", op: ">=", value: 0.45 },
    ],
  },
  {
    id: "pitch-slow-1",
    title: "Slow note matching",
    instruction:
      "Sing the phrase at half speed. Hold each note until it is centered on the play-along pitch before moving on.",
    kind: "slow-notes",
    durationSec: 20,
    technique: "pitch-accuracy",
    pass: [
      { metric: "pitch.meanAbsCents", op: "<=", value: 52 },
      { metric: "pitch.wrongNoteRatio", op: "<=", value: 0.3 },
    ],
  },
  {
    id: "pitch-siren-1",
    title: "Siren through the range",
    instruction: "Glide smoothly through the phrase's range on 'oo'. No jumps, no breaks — a continuous line.",
    kind: "siren",
    durationSec: 10,
    technique: "pitch-accuracy",
    pass: [
      { metric: "voicedRatio", op: ">=", value: 0.6 },
      { metric: "durationSec", op: ">=", value: 6 },
    ],
  },
  {
    id: "pitch-phrase-1",
    title: "Phrase at full tempo",
    instruction:
      "Sing the melody on 'ah'. Aim for the center of each written note — a perfectly tuned wrong note still fails.",
    kind: "vowel-phrase",
    durationSec: 12,
    technique: "pitch-accuracy",
    pass: [
      { metric: "pitch.meanAbsCents", op: "<=", value: 55 },
      { metric: "pitch.wrongNoteRatio", op: "<=", value: 0.3 },
    ],
  },
  {
    id: "res-ng-1",
    title: "Ng to ah slides",
    instruction:
      "On each note of the phrase, start on 'ng' (buzz in the mask) then open to 'ah' without losing the buzz.",
    kind: "vowel-phrase",
    durationSec: 14,
    technique: "forward-resonance",
    pass: [
      { metric: "timbre.harmonicBalanceDelta", op: "<=", value: 0.28 },
      { metric: "voicedRatio", op: ">=", value: 0.4 },
    ],
  },
  {
    id: "res-hum-1",
    title: "Hum the phrase",
    instruction: "Hum the melody with lips closed. Feel the buzz on the front teeth and nose. Keep it even.",
    kind: "vowel-phrase",
    durationSec: 12,
    technique: "forward-resonance",
    pass: [
      { metric: "timbre.thinTone", op: "<=", value: 0.5 },
      { metric: "voicedRatio", op: ">=", value: 0.4 },
    ],
  },
  {
    id: "res-nyah-1",
    title: "Nyah placement",
    instruction:
      "Sing the melody on a bratty 'nyah', then immediately again on a clean 'ah' keeping the same forward ping.",
    kind: "vowel-phrase",
    durationSec: 14,
    technique: "forward-resonance",
    pass: [
      { metric: "timbre.harmonicBalanceDelta", op: "<=", value: 0.25 },
      { metric: "pitch.meanAbsCents", op: "<=", value: 60 },
    ],
  },
  {
    id: "throat-yawn-1",
    title: "Yawn-sigh glides",
    instruction: "Start a silent yawn, then sigh on 'ah' from the top of your range to the bottom. Jaw stays loose.",
    kind: "siren",
    durationSec: 10,
    technique: "open-throat",
    pass: [
      { metric: "voicedRatio", op: ">=", value: 0.5 },
      { metric: "durationSec", op: ">=", value: 6 },
    ],
  },
  {
    id: "throat-ah-1",
    title: "Phrase on open 'ah'",
    instruction:
      "Sing the phrase on 'ah' with a comfortably dropped jaw. Do not clench. Keep the yawn-space through every note.",
    kind: "vowel-phrase",
    durationSec: 12,
    technique: "open-throat",
    pass: [
      { metric: "voicedRatio", op: ">=", value: 0.45 },
      { metric: "pitch.meanAbsCents", op: "<=", value: 55 },
    ],
  },
  {
    id: "throat-ee-ah-1",
    title: "Ee–ah on one pitch",
    instruction: "Pick a comfortable mid note. Alternate 'ee' and 'ah' four times without changing the throat space.",
    kind: "slow-notes",
    durationSec: 10,
    technique: "open-throat",
    pass: [
      { metric: "voicedRatio", op: ">=", value: 0.5 },
      { metric: "durationSec", op: ">=", value: 6 },
    ],
  },
];

export function drillsFor(technique: FocusTechnique | string): DrillSpec[] {
  return DRILL_CATALOG.filter((d) => d.technique === technique).slice(0, 3);
}

export function drillById(id: string): DrillSpec | undefined {
  return DRILL_CATALOG.find((d) => d.id === id);
}
