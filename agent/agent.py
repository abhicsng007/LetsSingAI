"""Session-conductor agent: Strands orchestrator on Bedrock.

The singer only sings. This agent diagnoses a take, assigns runnable drills,
reviews each drill, and remembers the singer. Tool choice is model-driven.
If Bedrock is down, the same tools run on a heuristic path.
"""

from __future__ import annotations

import json
import os
from typing import Any, AsyncIterator, Callable

import envload  # noqa: F401
import coach_logic
import drills
import memory
import sink
from tools import (
    ALL_TOOLS,
    analyze_take,
    compare_progress,
    plan_practice,
    recall_singer,
    remember_note,
    remember_session,
    review_drill,
)

DEFAULT_MODEL_ID = "us.anthropic.claude-sonnet-4-20250514-v1:0"

SYSTEM_PROMPT = """You are the session conductor of a vocal lesson embedded in a
real-time singing app. The app already inferred the singer's anatomy from their
voice (educational acoustics, not medical imaging) and scored pitch against the
song melody. Raw audio never reaches you — only a JSON summary.

Pitch numbers are listener-scored, not tuner-scored:
- meanAbsCents is the average |error| of *held note centres* (scoops, slides,
  and vibrato around the centre are ignored).
- inTuneRatio is the fraction of held notes within ~50 cents of the target
  (what a person hears as in tune). inTuneWindowCents is that window.
- wrongNoteRatio is held notes a semitone off (100¢+).
Do not treat 20–50¢ as a problem. Flag pitch only when meanAbsCents is above
~58¢ or many notes are the wrong scale degree.

You run the lesson. The singer's only job is to sing.

Goals by event:
- take: recall the singer, diagnose the take, plan exactly 3 runnable drills
  from the knowledge base for the focus technique, compare to last time,
  remember the session, then coach in markdown.
- drill: review the drill take (pass / retry / skip) and say what happens next.
- recap: compare progress, remember, write a short recap.

Rules:
- Ground every claim in the numbers you were given. Never invent metrics.
- Never invent drill ids. Only assign drills returned by plan_practice / get_exercises.
- Point at anatomy: when a body part was flagged, name it and the correct motion.
- If last session slipped on a focus, start there.
- After tools finish, output ONLY singer-facing markdown. Never write
  <thinking> tags, JSON, or toolResult blobs.
- On take, use exactly these sections: "### What I heard", "**Correct technique**",
  "**Your practice plan**" (numbered 3 drills).
"""

_agent = None
_agent_error: str | None = None


class ToolSinkHook:
    def register_hooks(self, registry) -> None:
        from strands.hooks.events import AfterToolCallEvent, BeforeToolCallEvent

        registry.add_callback(BeforeToolCallEvent, self.before)
        registry.add_callback(AfterToolCallEvent, self.after)

    def before(self, event) -> None:
        name = (event.tool_use or {}).get("name") or "tool"
        sink.tool_start(str(name))

    def after(self, event) -> None:
        name = (event.tool_use or {}).get("name") or "tool"
        sink.tool_done(str(name))


def _make_model():
    from strands.models import BedrockModel

    return BedrockModel(
        model_id=os.getenv("BEDROCK_MODEL_ID", DEFAULT_MODEL_ID),
        region_name=os.getenv("AWS_REGION", "us-west-2"),
        temperature=0.4,
    )


def _get_agent():
    global _agent, _agent_error
    if _agent is not None or _agent_error is not None:
        return _agent
    try:
        from specialists import build_specialists
        from strands import Agent

        model_id = os.getenv("BEDROCK_MODEL_ID", DEFAULT_MODEL_ID)
        nova = "nova" in model_id.lower()
        model = _make_model()
        if nova:
            tools = list(ALL_TOOLS)
        else:
            tools = [
                *build_specialists(model),
                recall_singer,
                remember_session,
                remember_note,
                lookup_from_tools(),
                get_exercises_from_tools(),
                compare_progress,
                score_drill_from_tools(),
            ]
        _agent = Agent(
            name="vocal_coach",
            description="Conducts a vocal lesson: diagnose, drill, review, remember.",
            model=model,
            tools=tools,
            system_prompt=SYSTEM_PROMPT,
            callback_handler=None,
            hooks=[ToolSinkHook()],
        )
    except Exception as exc:  # noqa: BLE001
        _agent_error = f"{type(exc).__name__}: {exc}"
        print(f"[agent] Bedrock/Strands unavailable, using heuristic coach ({_agent_error})")
    return _agent


def lookup_from_tools():
    from tools import lookup_technique

    return lookup_technique


def get_exercises_from_tools():
    from tools import get_exercises

    return get_exercises


def score_drill_from_tools():
    from tools import score_drill

    return score_drill


def agent_available() -> bool:
    return _get_agent() is not None


def _match_brace(s: str, start: int) -> int | None:
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(s)):
        ch = s[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i + 1
    return None


def _strip_tool_json(s: str) -> str:
    out: list[str] = []
    i = 0
    n = len(s)
    while i < n:
        if s[i] == "{":
            look = s[i : i + 120]
            if "toolResult" in look or '"tool_name"' in look or "toolUse" in look:
                end = _match_brace(s, i)
                if end is None:
                    break
                i = end
                continue
        out.append(s[i])
        i += 1
    return "".join(out)


def _strip_thinking(s: str) -> str:
    import re

    s = re.sub(r"<(thinking|reasoning)>[\s\S]*?</\1>", "", s, flags=re.I)
    s = re.sub(r"<(thinking|reasoning)\b[\s\S]*$", "", s, flags=re.I)
    return s


def _singer_facing(raw: str) -> str:
    cleaned = _strip_tool_json(_strip_thinking(raw))
    for needle in ("### what i heard", "### session recap", "**"):
        low = cleaned.lower()
        if needle == "**":
            idx = cleaned.find("**")
            if idx >= 0 and len(cleaned) - idx < 40:
                continue
        j = low.find(needle)
        if j >= 0:
            body = cleaned[j:]
            junk = body.find("\n<")
            if junk > 0:
                body = body[:junk]
            return body.strip()
    return cleaned.strip() if len(cleaned.strip()) > 40 else ""


class _TokenGate:
    def __init__(self) -> None:
        self.raw = ""
        self.emitted = 0

    def push(self, chunk: str) -> str:
        self.raw += chunk
        facing = _singer_facing(self.raw)
        if not facing:
            return ""
        extra = facing[self.emitted :]
        self.emitted = len(facing)
        return extra


def _flush_side_channel(
    open_tools: set[str],
) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for status, name in sink.drain_tools():
        if status == "start":
            if name in open_tools:
                continue
            open_tools.add(name)
        else:
            if name not in open_tools:
                continue
            open_tools.discard(name)
        out.append(("tool", json.dumps({"name": name, "status": status})))
    for kind, payload in sink.drain_struct():
        if kind == "focus":
            out.append(("focus", str(payload.get("focus") or "none")))
        else:
            out.append((kind, json.dumps(payload)))
    return out


async def stream_coach(
    summary: dict[str, Any],
    singer_id: str = "demo-singer",
    *,
    event: str = "take",
    session_id: str = "demo-session",
    drill_id: str | None = None,
    skip: bool = False,
    next_drill_id: str = "",
) -> AsyncIterator[tuple[str, str]]:
    """Yield lesson events: tool/focus/diagnosis/plan/verdict/token/source."""
    sink.clear()
    agent = _get_agent()
    if agent is None:
        async for item in _heuristic_stream(
            summary, singer_id, event, drill_id, skip, next_drill_id
        ):
            yield item
        return

    prompt = coach_logic.event_prompt(
        event, summary, singer_id, session_id, drill_id, skip, next_drill_id
    )
    emitted = False
    saw_plan = False
    saw_focus = False
    open_tools: set[str] = set()
    gate = _TokenGate()

    async def run_once() -> AsyncIterator[tuple[str, str]]:
        nonlocal emitted, saw_plan, saw_focus
        async for model_event in agent.stream_async(prompt):
            for item in _flush_side_channel(open_tools):
                if item[0] == "plan":
                    saw_plan = True
                if item[0] == "focus":
                    saw_focus = True
                yield item
            if not isinstance(model_event, dict):
                continue
            data = model_event.get("data")
            if data:
                piece = gate.push(data)
                if piece:
                    emitted = True
                    yield ("token", piece)

    try:
        async for item in run_once():
            yield item
    except Exception as exc:  # noqa: BLE001
        print(f"[agent] stream failed: {type(exc).__name__}: {exc}")
        try:
            agent.messages.clear()
        except Exception:
            pass
        gate = _TokenGate()
        emitted = False
        try:
            print("[agent] retrying orchestrator once")
            async for item in run_once():
                yield item
        except Exception as exc2:  # noqa: BLE001
            print(f"[agent] retry failed: {type(exc2).__name__}: {exc2}")

    for item in _flush_side_channel(open_tools):
        if item[0] == "plan":
            saw_plan = True
        if item[0] == "focus":
            saw_focus = True
        yield item
    for name in list(open_tools):
        yield ("tool", json.dumps({"name": name, "status": "done"}))

    if event == "take":
        focus = coach_logic.determine_focus(summary)
        if not saw_focus:
            yield ("focus", focus)
        if not saw_plan:
            async for item in _run_tool("plan_practice", lambda: plan_practice(focus)):
                yield item

    if emitted:
        yield ("source", "agent")
        return

    async for item in _heuristic_stream(
        summary, singer_id, event, drill_id, skip, next_drill_id
    ):
        yield item


async def _run_tool(name: str, fn: Callable[[], Any]) -> AsyncIterator[tuple[str, str]]:
    yield ("tool", json.dumps({"name": name, "status": "start"}))
    try:
        fn()
    except Exception as exc:  # noqa: BLE001
        print(f"[agent] heuristic tool {name} failed: {exc}")
    for item in _flush_side_channel(set()):
        yield item
    yield ("tool", json.dumps({"name": name, "status": "done"}))


async def _heuristic_stream(
    summary: dict[str, Any],
    singer_id: str,
    event: str,
    drill_id: str | None,
    skip: bool,
    next_drill_id: str,
) -> AsyncIterator[tuple[str, str]]:
    pitch = summary.get("pitch", {})
    breath = summary.get("breathSupport", {})

    if event == "drill":
        did = drill_id or ""
        async for item in _run_tool(
            "review_drill",
            lambda: review_drill(did, json.dumps(summary), skip, next_drill_id),
        ):
            yield item
        drill = drills.get_drill(did)
        # last verdict is in sink already flushed; rebuild for markdown
        scored = None
        if drill and not skip:
            scored = drills.score_drill(summary, drill)
        verdict = {
            "drillId": did,
            "result": "skip" if skip else ("pass" if scored and scored["passed"] else "retry"),
            "reason": "Singer skipped this drill."
            if skip
            else (scored or {}).get("reason", ""),
            "nextDrillId": (next_drill_id or None) if not skip and scored and scored["passed"] else (None if skip else did),
        }
        memory.get_store().write_note(
            singer_id, f"{did}: {verdict['result']} — {verdict['reason']}", kind="verdict"
        )
        yield ("token", coach_logic.heuristic_drill_markdown(verdict, drill))
        yield ("source", "local")
        return

    if event == "recap":
        async for item in _run_tool(
            "compare_progress",
            lambda: compare_progress(
                singer_id,
                float(pitch.get("meanAbsCents", 0) or 0),
                float(breath.get("mean", 0) or 0),
            ),
        ):
            yield item
        cmp_raw = compare_progress(
            singer_id,
            float(pitch.get("meanAbsCents", 0) or 0),
            float(breath.get("mean", 0) or 0),
        )
        try:
            cmp = json.loads(cmp_raw)
        except json.JSONDecodeError:
            cmp = {}
        tagged = dict(summary)
        tagged["focus"] = coach_logic.determine_focus(summary)
        async for item in _run_tool(
            "remember_session",
            lambda: remember_session(singer_id, json.dumps(tagged)),
        ):
            yield item
        yield ("token", coach_logic.heuristic_recap_markdown(summary, cmp))
        yield ("source", "local")
        return

    async for item in _run_tool("recall_singer", lambda: recall_singer(singer_id)):
        yield item
    async for item in _run_tool("analyze_take", lambda: analyze_take(json.dumps(summary))):
        yield item
    focus = coach_logic.determine_focus(summary)
    async for item in _run_tool("plan_practice", lambda: plan_practice(focus)):
        yield item
    async for item in _run_tool(
        "compare_progress",
        lambda: compare_progress(
            singer_id,
            float(pitch.get("meanAbsCents", 0) or 0),
            float(breath.get("mean", 0) or 0),
        ),
    ):
        yield item
    tagged = dict(summary)
    tagged["focus"] = focus
    async for item in _run_tool(
        "remember_session",
        lambda: remember_session(singer_id, json.dumps(tagged)),
    ):
        yield item
    yield ("token", coach_logic.heuristic_markdown(summary, focus))
    yield ("source", "local")
