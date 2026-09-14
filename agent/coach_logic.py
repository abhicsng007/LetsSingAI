"""Shared coaching logic for the Strands path and the heuristic fallback."""

from __future__ import annotations

import json
from typing import Any

import drills
import memory
import pitch_eval

FOCUS_LABELS = {
    "breath-support": "Breath support",
    "pitch-accuracy": "Pitch accuracy",
    "forward-resonance": "Forward resonance",
    "open-throat": "Open throat",
    "none": "Balanced",
}


def determine_focus(summary: dict[str, Any]) -> str:
    """Pick the single most impactful technique (body faults first)."""
    faults = summary.get("bodyFaults") or []
    if faults:
        tech = faults[0].get("technique")
        if tech in FOCUS_LABELS:
            return tech

    pitch = summary.get("pitch", {})
    breath = summary.get("breathSupport", {})
    timbre = summary.get("timbre", {})

    pitch_off = pitch_eval.pitch_off(pitch)
    breath_weak = float(breath.get("mean", 1) or 1) < 0.5
    thin = bool(timbre.get("thinTone")) or float(timbre.get("harmonicBalanceDelta", 0) or 0) > 0.22

    if breath_weak:
        return "breath-support"
    if pitch_off:
        return "pitch-accuracy"
    if thin:
        return "forward-resonance"
    return "open-throat"


def body_faults_text(summary: dict[str, Any]) -> str:
    faults = summary.get("bodyFaults") or []
    if not faults:
        return ""
    lines = [
        f"- {f.get('label')} — off {int(float(f.get('offRatio', 0) or 0) * 100)}% of the take; "
        f"correct motion: {f.get('correctMotion')}"
        for f in faults
    ]
    return "\n".join(lines)


def technique_block(technique: str) -> dict[str, Any]:
    return drills.technique_block(technique)


def map_issue_to_technique(issue: str) -> str:
    text = issue.lower()
    for key, tech in drills.kb().get("_issue_map", {}).items():
        if key in text:
            return tech
    return "open-throat"


def event_prompt(
    event: str,
    summary: dict[str, Any],
    singer_id: str,
    session_id: str,
    drill_id: str | None,
    skip: bool,
    next_drill_id: str = "",
) -> str:
    """User-turn prompt for the orchestrator. Goal-oriented, not a tool DAG."""
    recalled = memory.get_store().recall(singer_id)
    last = recalled.get("last")
    last_line = (
        f"Last session: {last.get('song')} · {last.get('meanAbsCents')}¢ · "
        f"breath {last.get('breathSupport')} · focus {recalled.get('lastFocus')}"
        if last
        else "No prior sessions on file."
    )
    faults = body_faults_text(summary)
    faults_block = (
        "3D actual-vs-ideal flagged:\n" + faults + "\n\n" if faults else "No sustained body-part faults.\n\n"
    )
    header = (
        f"Event: {event}\n"
        f"singer_id: {singer_id}\n"
        f"session_id: {session_id}\n"
        f"{last_line}\n\n"
    )
    if event == "drill":
        return (
            header
            + f"drill_id: {drill_id}\n"
            + f"skip: {str(skip).lower()}\n"
            + (f"next_drill_id hint: {next_drill_id}\n" if next_drill_id else "next_drill_id hint: (none → recap)\n")
            + "Performance JSON for this drill take:\n\n"
            + json.dumps(summary, indent=2)
            + "\n\n"
            + faults_block
            + "Review this drill. Use score_drill and review_drill. "
            "Then write one short singer-facing paragraph: what happened and what to do next."
        )
    if event == "recap":
        return (
            header
            + "Performance JSON for the recap take (may be the original take if they did not re-sing):\n\n"
            + json.dumps(summary, indent=2)
            + "\n\nCompare to history, remember the session, and write a short recap: "
            "what improved, what to keep next time, under 120 words."
        )
    return (
        header
        + "Performance JSON for the phrase they just sang:\n\n"
        + json.dumps(summary, indent=2)
        + "\n\n"
        + faults_block
        + "Run the lesson: recall the singer, diagnose the take (name body parts), "
        "plan exactly 3 runnable drills from the KB for the focus technique, "
        "compare to last time, and remember this session. "
        "If last time's focus slipped, start there. "
        "Then write the singer-facing reply with exactly these markdown sections:\n"
        '### What I heard\n'
        "**Correct technique**\n"
        "**Your practice plan** (the 3 drills, numbered).\n"
        "Ground every claim in the numbers. Do not invent drill ids. Under ~200 words."
    )


def heuristic_markdown(summary: dict[str, Any], focus: str) -> str:
    pitch = summary.get("pitch", {})
    breath = summary.get("breathSupport", {})
    timbre = summary.get("timbre", {})
    song = summary.get("song", {})
    tech = technique_block(focus)

    issues: list[str] = []
    if pitch_eval.pitch_off(pitch):
        in_tune = round(float(pitch.get("inTuneRatio", 0) or 0) * 100)
        wrong = round(float(pitch.get("wrongNoteRatio", 0) or 0) * 100)
        vs = "the melody" if pitch.get("scoredAgainstMelody") else "nearest pitch"
        extra = f"; {wrong}% were a different note" if wrong else ""
        window = int(pitch.get("inTuneWindowCents") or pitch_eval.IN_TUNE_CENTS)
        issues.append(
            f"**Pitch** — vs {vs} you averaged {pitch.get('meanAbsCents')}¢ off the held-note "
            f"centre, trending {pitch.get('tendency', 'off')}. Only {in_tune}% of held notes "
            f"sat within {window}¢{extra}. Scoops, slides, and vibrato around the centre are ignored."
        )
    if float(breath.get("mean", 1) or 1) < 0.5:
        issues.append(
            f"**Breath support** — your support score was {breath.get('mean')}. "
            "An unsteady airstream makes pitch drift and tone waver."
        )
    if bool(timbre.get("thinTone")) or float(timbre.get("harmonicBalanceDelta", 0) or 0) > 0.22:
        issues.append(
            f"**Resonance/timbre** — your overtone balance differs from the reference "
            f"(harmonic delta {timbre.get('harmonicBalanceDelta')}); the tone reads thin."
        )
    if not issues:
        issues.append("**Solid take** — tuning, support, and tone were all close to the target.")

    faults = summary.get("bodyFaults") or []
    body_lines: list[str] = []
    if faults:
        body_lines.append("")
        body_lines.append("**Which parts moved incorrectly**")
        for f in faults:
            pct = int(float(f.get("offRatio", 0) or 0) * 100)
            body_lines.append(
                f"- **{f.get('label')}** ({pct}% of the take) → {f.get('correctMotion')}"
            )

    items = drills.list_drills(focus)
    lines = [
        f"### Coaching for \"{song.get('title', 'your take')}\"",
        "",
        "### What I heard",
        *[f"- {i}" for i in issues],
        *body_lines,
        "",
        f"**Correct technique** — {tech.get('title', FOCUS_LABELS.get(focus, focus))}",
        tech.get("why", ""),
        "",
        "**Your practice plan**",
        *[f"{n + 1}. {drills.instruction_of(ex)}" for n, ex in enumerate(items)],
    ]
    worst = summary.get("worstMoments", [])
    if worst:
        moments = ", ".join(
            f"{m.get('note')} at {m.get('t')}s ({'+' if (m.get('cents') or 0) > 0 else ''}{m.get('cents')}¢)"
            for m in worst
        )
        lines += ["", f"_Trickiest moments: {moments}._"]
    return "\n".join(l for l in lines if l != "")


def heuristic_drill_markdown(verdict: dict[str, Any], drill: dict[str, Any] | None) -> str:
    result = verdict.get("result")
    title = (drill or {}).get("title") or verdict.get("drillId")
    if result == "pass":
        return f"**{title} — pass.** {verdict.get('reason')}. Onto the next drill."
    if result == "skip":
        return f"**{title} — skipped.** We'll pick this up next session."
    return (
        f"**{title} — retry.** {verdict.get('reason')}. "
        f"{(drill or {}).get('instruction') or 'Sing it again, same setup.'}"
    )


def heuristic_recap_markdown(summary: dict[str, Any], compare: dict[str, Any]) -> str:
    trend = compare.get("trend", "steady")
    song = (summary.get("song") or {}).get("title", "the phrase")
    return (
        f"### Session recap — {song}\n\n"
        f"Trend vs last time: **{trend}** "
        f"(cents Δ {compare.get('centsDelta')}, breath Δ {compare.get('breathDelta')}).\n\n"
        "Keep the three drills in your 10-minute loop. The agent will remember this take "
        "and start from whatever still slips next time."
    )
