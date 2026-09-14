import type { PerformanceSummary } from "../analysis/summary";
import type { DrillSpec, FocusTechnique } from "./types";
import { drillsFor } from "../drills/catalog";
import { LISTENER, takeNeedsPitchWork } from "../analysis/humanPitch";

export interface LocalCoachResult {
  markdown: string;
  focus: FocusTechnique;
  drills: DrillSpec[];
  exercises: string[];
}

export function localCoach(s: PerformanceSummary): LocalCoachResult {
  const issues: string[] = [];
  let focus: FocusTechnique = "none";

  const pitchOff = takeNeedsPitchWork(s.pitch.meanAbsCents, s.pitch.wrongNoteRatio);
  const breathWeak = s.breathSupport.mean < 0.5;
  const thin = s.timbre.thinTone || s.timbre.harmonicBalanceDelta > 0.22;

  const topFault = s.bodyFaults[0];
  if (topFault) focus = topFault.technique as FocusTechnique;
  else if (breathWeak) focus = "breath-support";
  else if (pitchOff) focus = "pitch-accuracy";
  else if (thin) focus = "forward-resonance";
  else focus = "open-throat";

  if (pitchOff) {
    const vs = s.pitch.scoredAgainstMelody ? "the melody" : "nearest pitch";
    const wrong = Math.round(s.pitch.wrongNoteRatio * 100);
    issues.push(
      `**Pitch** — vs ${vs} you averaged ${s.pitch.meanAbsCents}¢ off the held-note centre, trending ${s.pitch.tendency}. ` +
        `Only ${Math.round(s.pitch.inTuneRatio * 100)}% of held notes sat within ${LISTENER.inTuneCents}¢` +
        (wrong > 0 ? `; ${wrong}% were a different note.` : ".") +
        " Scoops, slides, and vibrato around the centre are ignored.",
    );
  }
  if (breathWeak) {
    issues.push(
      `**Breath support** — your support score was ${s.breathSupport.mean}. ` +
        `An unsteady airstream makes pitch drift and tone waver.`,
    );
  }
  if (thin) {
    issues.push(
      `**Resonance/timbre** — your overtone balance differs from the reference ` +
        `(harmonic delta ${s.timbre.harmonicBalanceDelta}). The tone reads thin because the ` +
        `2nd–3rd harmonics are weak.`,
    );
  }
  if (issues.length === 0) {
    issues.push("**Solid take** — tuning, support, and tone were all close to the target.");
  }

  const bodyLines = s.bodyFaults.map(
    (f) => `- **${f.label}** (${Math.round(f.offRatio * 100)}% of the take) → ${f.correctMotion}`,
  );

  const technique: Record<FocusTechnique, string> = {
    "breath-support":
      "Breathe low (belly/ribs expand, shoulders still). Sing on a steady, supported airstream — imagine gently sustaining a candle flame without blowing it out.",
    "pitch-accuracy":
      s.pitch.tendency === "flat"
        ? "You're landing under the note. Aim slightly over the pitch center and lead each note with breath energy so it 'blooms' up to pitch."
        : "You're landing over the note. Relax the jaw and larynx and approach each note from just underneath its center.",
    "forward-resonance":
      "Bring the sound forward. Hum on an 'ng', feel the buzz on the lips/mask, then open to the vowel keeping that forward placement — this strengthens the 2nd–3rd harmonics.",
    "open-throat":
      "Keep a relaxed, open throat (the start of a yawn) so the tone stays free and resonant across a phrase.",
    none: "Maintain your open, supported sound and keep listening for pitch center.",
  };

  const drills = drillsFor(focus);
  const md = [
    `### Coaching for "${s.song.title}"`,
    "",
    "### What I heard",
    ...issues.map((i) => `- ${i}`),
    ...(bodyLines.length > 0 ? ["", "**Which parts moved incorrectly**", ...bodyLines] : []),
    "",
    "**Correct technique**",
    technique[focus],
    "",
    "**Your practice plan**",
    ...drills.map((d, i) => `${i + 1}. ${d.instruction}`),
  ]
    .filter((line) => line !== "")
    .join("\n");

  return { markdown: md, focus, drills, exercises: drills.map((d) => d.instruction) };
}
