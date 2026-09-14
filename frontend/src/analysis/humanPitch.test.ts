import { emptyFrame, type FeatureFrame } from "../audio/types";
import { SONGS, melodyNoteNear } from "../data/songs";
import {
  LISTENER,
  listenerCentsSeries,
  noteHolds,
  pitchBand,
  takeNeedsPitchWork,
} from "./humanPitch";

function frame(t: number, cents: number, note = "C4"): FeatureFrame {
  const f = emptyFrame();
  f.t = t;
  f.hasPitch = true;
  f.note = note;
  f.targetNote = note;
  f.cents = cents;
  f.melodyCents = cents;
  f.f0 = 261.6;
  return f;
}

function hold(note: string, t0: number, dur: number, cents: number, hop = 0.02): FeatureFrame[] {
  const out: FeatureFrame[] = [];
  for (let t = t0; t < t0 + dur; t += hop) out.push(frame(t, cents, note));
  return out;
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

function main(): void {
  assert(pitchBand(10) === "in-tune", "10¢ is in tune");
  assert(pitchBand(45) === "in-tune", "45¢ is still in tune to a listener");
  assert(pitchBand(60) === "slightly-off", "60¢ is slightly off");
  assert(pitchBand(85) === "quite-off", "85¢ is quite off");
  assert(pitchBand(105) === "wrong-note", "105¢ is a wrong note");
  assert(!takeNeedsPitchWork(50, 0.1), "human wobble is not a pitch problem");
  assert(takeNeedsPitchWork(65, 0.05), "65¢ mean is a pitch problem");

  // Scoop into a centred hold: listener should score the sustain, not the scoop.
  const scooped: FeatureFrame[] = [
    ...hold("C4", 0, 0.12, -80),
    ...hold("C4", 0.12, 0.5, 8),
  ];
  const holds = noteHolds(scooped);
  assert(holds.length === 1, `expected 1 hold, got ${holds.length}`);
  assert(Math.abs(holds[0]!.cents - 8) < 3, `sustain median should be ~8, got ${holds[0]!.cents}`);

  // Vibrato ±40¢ around centre is in tune (median ~0).
  const vib: FeatureFrame[] = [];
  for (let i = 0; i < 40; i++) {
    vib.push(frame(1 + i * 0.02, 40 * Math.sin(i * 0.9), "G4"));
  }
  const vibSeries = listenerCentsSeries(vib);
  const vibAbs = Math.abs(vibSeries[0]!);
  assert(vibAbs < LISTENER.inTuneCents, `vibrato centre should be in tune, got ${vibAbs}`);

  // Slide between notes should not count as its own held note.
  const slide: FeatureFrame[] = [
    ...hold("C4", 0, 0.4, 5),
    ...hold("D4", 0.4, 0.08, 40),
    ...hold("E4", 0.5, 0.4, -6),
  ];
  const slideHolds = noteHolds(slide);
  assert(slideHolds.length === 2, `slide should yield 2 holds, got ${slideHolds.length}`);

  // Late on C still credits C, not the next written G.
  const twinkle = SONGS[0]!;
  const cHz = 261.63;
  const late = melodyNoteNear(twinkle, 1.35, cHz);
  assert(late && late.midi === 60, `late C should match C4, got ${late?.midi}`);
  const onG = melodyNoteNear(twinkle, 1.5, 392.0);
  assert(onG && onG.midi === 67, `on-time G should match G4, got ${onG?.midi}`);

  console.log("humanPitch tests ok");
}

main();
