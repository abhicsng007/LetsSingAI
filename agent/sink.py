"""Side channel so tools can surface structured lesson events to the SSE stream.

Tools push diagnosis / plan / verdict here. stream_coach drains after each
model event so the UI updates as the agent actually calls tools — not from a
precomputed DAG.
"""

from __future__ import annotations

from typing import Any

tool_events: list[tuple[str, str]] = []
struct_events: list[tuple[str, dict[str, Any]]] = []


def tool_start(name: str) -> None:
    tool_events.append(("start", name))


def tool_done(name: str) -> None:
    tool_events.append(("done", name))


def struct(kind: str, payload: dict[str, Any]) -> None:
    struct_events.append((kind, payload))


def drain_tools() -> list[tuple[str, str]]:
    items = list(tool_events)
    tool_events.clear()
    return items


def drain_struct() -> list[tuple[str, dict[str, Any]]]:
    items = list(struct_events)
    struct_events.clear()
    return items


def clear() -> None:
    tool_events.clear()
    struct_events.clear()
