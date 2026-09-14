"""Specialist Strands agents used as tools by the lesson orchestrator.

Each specialist has a narrow job and a small tool set. They reason over the
numbers; they do not invent metrics or drill ids.
"""

from __future__ import annotations

from typing import Any

DIAGNOSE_PROMPT = """You are a vocal-technique diagnostician.
You receive a JSON performance summary and body-part faults from the 3D model.

Always call analyze_take with that JSON first.
Call lookup_technique if you need a technique definition.

Then reply in under 80 words with:
- the 2-3 most important issues, grounded in the numbers
- the body part(s) that moved incorrectly and the correct motion
Do not invent metrics. Do not write a practice plan.
"""

PLAN_PROMPT = """You are a vocal-practice planner.
Given a focus technique, call plan_practice for that technique (it returns
exactly 3 runnable drills with ids the app can execute).

You may call get_exercises first if you need to inspect the catalog.
Never invent a drill id. Never add a fourth drill.
Reply with one sentence on why these three, then stop.
"""

REVIEW_PROMPT = """You are a drill coach.
Call score_drill, then review_drill, with the drill_id and summary JSON.

Pass if the acoustic criteria are met. Retry if not (once is enough to say
retry — do not invent extra attempts). Skip only if skip=true.

You may override a raw pass to retry when a flagged body part is still badly
off (offRatio >= 0.5) even if the metric passed.

Reply with one sentence the singer should hear, naming pass/retry/skip.
"""


def build_specialists(model: Any) -> list[Any]:
    from strands import Agent
    from tools import (
        analyze_take,
        get_exercises,
        lookup_technique,
        plan_practice,
        review_drill,
        score_drill,
    )

    diagnoser = Agent(
        name="diagnose_take",
        description=(
            "Diagnose a singing take from acoustic + anatomy JSON. "
            "Name 2-3 issues and the body parts that moved incorrectly."
        ),
        model=model,
        system_prompt=DIAGNOSE_PROMPT,
        tools=[analyze_take, lookup_technique],
        callback_handler=None,
    )
    planner = Agent(
        name="plan_practice",
        description=(
            "Build a 3-drill practice block for a vocal technique. "
            "Returns runnable drill specs with ids from the KB."
        ),
        model=model,
        system_prompt=PLAN_PROMPT,
        tools=[plan_practice, get_exercises],
        callback_handler=None,
    )
    reviewer = Agent(
        name="review_drill",
        description=(
            "Score a drill take and decide pass, retry, or skip. "
            "Pass the drill_id and the performance JSON."
        ),
        model=model,
        system_prompt=REVIEW_PROMPT,
        tools=[score_drill, review_drill],
        callback_handler=None,
    )
    return [
        diagnoser.as_tool(
            name="diagnose_take",
            description=(
                "Diagnose the take: name the issues and the body parts "
                "that moved incorrectly. Pass the performance JSON."
            ),
        ),
        planner.as_tool(
            name="plan_practice",
            description=(
                "Return exactly 3 runnable drills for the focus technique. "
                "Pass the technique id (breath-support, pitch-accuracy, "
                "forward-resonance, open-throat)."
            ),
        ),
        reviewer.as_tool(
            name="review_drill",
            description=(
                "Review a drill take. Pass drill_id, summary JSON, skip flag, "
                "and optional next_drill_id."
            ),
        ),
    ]
