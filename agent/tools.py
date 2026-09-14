"""Strands tools the vocal-coach orchestrator and specialists can call."""

from __future__ import annotations

import json

from strands import tool

import coach_logic
import drills
import memory
import pitch_eval
import sink


def _parse_summary(summary_json: str) -> dict | str:
    try:
        data = json.loads(summary_json)
    except json.JSONDecodeError:
        return "summary_json was not valid JSON"
    if not isinstance(data, dict):
        return "summary_json must be an object"
    return data


@tool
def lookup_technique(issue: str) -> str:
    """Explain the correct vocal technique that fixes a described problem.

    Args:
        issue: A short description of the vocal problem, e.g. "singing flat",
            "thin tone", "running out of breath", "tight throat".
    """
    technique = coach_logic.map_issue_to_technique(issue)
    block = drills.technique_block(technique)
    return json.dumps(
        {
            "technique": technique,
            "title": block.get("title"),
            "why": block.get("why"),
            "cues": block.get("cues", []),
        }
    )


@tool
def get_exercises(technique: str, level: str = "beginner") -> str:
    """Return runnable drill specs for a vocal technique.

    Args:
        technique: One of "breath-support", "pitch-accuracy",
            "forward-resonance", or "open-throat".
        level: Difficulty (informational).
    """
    items = drills.list_drills(technique)
    if not items:
        return json.dumps({"error": f"unknown technique '{technique}'"})
    return json.dumps({"technique": technique, "level": level, "exercises": items})


@tool
def recall_singer(user_id: str) -> str:
    """Load this singer's recent sessions, last focus, and notes.

    Call this near the start of a take so coaching can mention last time.

    Args:
        user_id: Stable identifier for the singer.
    """
    return json.dumps(memory.get_store().recall(user_id))


@tool
def remember_session(user_id: str, summary_json: str) -> str:
    """Persist this take's key metrics so the next lesson can compare.

    Args:
        user_id: Stable identifier for the singer.
        summary_json: Performance summary as a JSON string. Include "focus"
            when known.
    """
    parsed = _parse_summary(summary_json)
    if isinstance(parsed, str):
        return json.dumps({"error": parsed})
    count = memory.get_store().write_session(user_id, parsed)
    return json.dumps({"saved": True, "totalSessions": count})


@tool
def remember_note(user_id: str, text: str, kind: str = "note") -> str:
    """Store a short lesson note (verdict, preference, teacher comment).

    Args:
        user_id: Stable identifier for the singer.
        text: One or two sentences to remember.
        kind: "note", "verdict", or "preference".
    """
    memory.get_store().write_note(user_id, text, kind=kind)
    return json.dumps({"saved": True})


@tool
def analyze_take(summary_json: str) -> str:
    """Structured acoustic + anatomy analysis of a singing take.

    Args:
        summary_json: The performance summary as a JSON string.
    """
    parsed = _parse_summary(summary_json)
    if isinstance(parsed, str):
        return json.dumps({"error": parsed})
    focus = coach_logic.determine_focus(parsed)
    tech = drills.technique_block(focus)
    pitch = parsed.get("pitch", {})
    breath = parsed.get("breathSupport", {})
    timbre = parsed.get("timbre", {})
    issues: list[str] = []
    if pitch_eval.pitch_off(pitch):
        issues.append(
            f"pitch {pitch.get('meanAbsCents')}¢ off vs "
            f"{'melody' if pitch.get('scoredAgainstMelody') else 'nearest note'}, "
            f"tendency {pitch.get('tendency')}, "
            f"{int(float(pitch.get('wrongNoteRatio', 0) or 0) * 100)}% wrong notes"
        )
    if float(breath.get("mean", 1) or 1) < 0.5:
        issues.append(f"breath support {breath.get('mean')} (unsteady airstream)")
    if bool(timbre.get("thinTone")) or float(timbre.get("harmonicBalanceDelta", 0) or 0) > 0.22:
        issues.append(f"thin/dull timbre, harmonic delta {timbre.get('harmonicBalanceDelta')}")
    faults = [
        {
            "part": f.get("label"),
            "offRatio": f.get("offRatio"),
            "correctMotion": f.get("correctMotion"),
        }
        for f in (parsed.get("bodyFaults") or [])
    ]
    payload = {
        "focus": focus,
        "title": tech.get("title"),
        "issues": issues or ["no major acoustic issues"],
        "bodyParts": faults,
        "worstMoments": parsed.get("worstMoments") or [],
    }
    sink.struct("diagnosis", payload)
    sink.struct("focus", {"focus": focus})
    return json.dumps(payload)


@tool
def plan_practice(technique: str) -> str:
    """Return exactly 3 runnable drills for a technique (KB ids only).

    Args:
        technique: One of "breath-support", "pitch-accuracy",
            "forward-resonance", or "open-throat".
    """
    items = drills.list_drills(technique)[:3]
    if not items:
        return json.dumps({"error": f"unknown technique '{technique}'"})
    payload = {
        "focus": technique,
        "title": drills.technique_block(technique).get("title"),
        "drills": items,
        "exercises": [drills.instruction_of(d) for d in items],
    }
    sink.struct("plan", payload)
    sink.struct("focus", {"focus": technique})
    return json.dumps(payload)


@tool
def score_drill(drill_id: str, summary_json: str) -> str:
    """Score a drill take against that drill's pass criteria.

    Args:
        drill_id: A drill id from get_exercises / plan_practice.
        summary_json: Performance summary JSON for the drill take.
    """
    drill = drills.get_drill(drill_id)
    if not drill:
        return json.dumps({"error": f"unknown drill '{drill_id}'"})
    parsed = _parse_summary(summary_json)
    if isinstance(parsed, str):
        return json.dumps({"error": parsed})
    return json.dumps(drills.score_drill(parsed, drill))


@tool
def review_drill(
    drill_id: str,
    summary_json: str,
    skip: bool = False,
    next_drill_id: str = "",
) -> str:
    """Decide pass, retry, or skip for a drill and name what happens next.

    Args:
        drill_id: The drill that was just sung (or skipped).
        summary_json: Performance summary JSON. Ignored when skip is true.
        skip: If true, mark skip without scoring.
        next_drill_id: Suggested next drill id after a pass/skip (empty = recap).
    """
    drill = drills.get_drill(drill_id)
    if not drill:
        return json.dumps({"error": f"unknown drill '{drill_id}'"})
    if skip:
        payload = {
            "drillId": drill_id,
            "result": "skip",
            "reason": "Singer skipped this drill.",
            "nextDrillId": next_drill_id or None,
            "passed": False,
        }
        sink.struct("verdict", payload)
        return json.dumps(payload)

    parsed = _parse_summary(summary_json)
    if isinstance(parsed, str):
        return json.dumps({"error": parsed})
    scored = drills.score_drill(parsed, drill)
    result = "pass" if scored["passed"] else "retry"
    payload = {
        "drillId": drill_id,
        "result": result,
        "reason": scored["reason"],
        "nextDrillId": (next_drill_id or None) if result == "pass" else drill_id,
        "passed": scored["passed"],
        "score": scored,
    }
    sink.struct("verdict", payload)
    return json.dumps(payload)


@tool
def compare_progress(user_id: str, mean_abs_cents: float, breath_support: float) -> str:
    """Compare this take's pitch error and breath-support to history.

    Args:
        user_id: Stable identifier for the singer.
        mean_abs_cents: This take's mean absolute pitch error in cents.
        breath_support: This take's mean breath-support score, 0..1.
    """
    recalled = memory.get_store().recall(user_id)
    history = recalled.get("sessions") or []
    if not history:
        return json.dumps(
            {
                "sessions": 0,
                "trend": "first_take",
                "note": "No prior sessions — treat this take as the baseline.",
            }
        )
    prev = history[-1]
    prev_cents = prev.get("meanAbsCents")
    prev_breath = prev.get("breathSupport")
    cents_delta = None
    breath_delta = None
    if isinstance(prev_cents, (int, float)):
        cents_delta = round(float(mean_abs_cents) - float(prev_cents), 1)
    if isinstance(prev_breath, (int, float)):
        breath_delta = round(float(breath_support) - float(prev_breath), 2)
    if cents_delta is not None and cents_delta < -3:
        trend = "improving"
    elif cents_delta is not None and cents_delta > 5:
        trend = "slipping"
    else:
        trend = "steady"
    return json.dumps(
        {
            "sessions": recalled.get("sessionCount", len(history)),
            "previous": {"meanAbsCents": prev_cents, "breathSupport": prev_breath},
            "centsDelta": cents_delta,
            "breathDelta": breath_delta,
            "trend": trend,
            "lastFocus": recalled.get("lastFocus"),
        }
    )


# Nova / heuristic: same names the specialists expose, as plain tools.
ALL_TOOLS = [
    analyze_take,
    plan_practice,
    review_drill,
    score_drill,
    lookup_technique,
    get_exercises,
    recall_singer,
    remember_session,
    remember_note,
    compare_progress,
]
