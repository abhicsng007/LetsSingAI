"""Compatibility wrapper — session history lives in memory.py."""

from __future__ import annotations

from typing import Any

import memory


def append_session(user_id: str, summary: dict[str, Any]) -> int:
    return memory.get_store().write_session(user_id, summary)


def read_history(user_id: str) -> list[dict[str, Any]]:
    return list(memory.get_store().recall(user_id).get("sessions") or [])
