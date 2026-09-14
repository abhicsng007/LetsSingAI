"""Runnable drill specs and pass/fail scoring.

The agent may only assign drills that live in the KB. Frontend scoring uses
the same rules (see frontend/src/drills/score.ts).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_KB = json.loads((Path(__file__).parent / "kb" / "exercises.json").read_text(encoding="utf-8"))

OPS = {
    ">=": lambda a, b: a >= b,
    "<=": lambda a, b: a <= b,
    ">": lambda a, b: a > b,
    "<": lambda a, b: a < b,
}


def kb() -> dict[str, Any]:
    return _KB


def techniques() -> list[str]:
    return [k for k in _KB if not k.startswith("_")]


def technique_block(technique: str) -> dict[str, Any]:
    return _KB.get(technique) or {}


def _as_drill(raw: Any, technique: str) -> dict[str, Any] | None:
    if isinstance(raw, dict) and raw.get("id"):
        out = dict(raw)
        out.setdefault("technique", technique)
        return out
    return None


def list_drills(technique: str) -> list[dict[str, Any]]:
    block = technique_block(technique)
    out: list[dict[str, Any]] = []
    for raw in block.get("exercises") or []:
        drill = _as_drill(raw, technique)
        if drill:
            out.append(drill)
    return out


def all_drills() -> list[dict[str, Any]]:
    drills: list[dict[str, Any]] = []
    for tech in techniques():
        drills.extend(list_drills(tech))
    return drills


def get_drill(drill_id: str) -> dict[str, Any] | None:
    for drill in all_drills():
        if drill.get("id") == drill_id:
            return drill
    return None


def metric_value(summary: dict[str, Any], path: str) -> float | None:
    cur: Any = summary
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    if isinstance(cur, bool):
        return 1.0 if cur else 0.0
    if isinstance(cur, (int, float)):
        return float(cur)
    return None


def _checks(drill: dict[str, Any]) -> list[dict[str, Any]]:
    raw = drill.get("pass")
    if isinstance(raw, list):
        return [c for c in raw if isinstance(c, dict)]
    if isinstance(raw, dict):
        return [raw]
    return []


def score_drill(summary: dict[str, Any], drill: dict[str, Any]) -> dict[str, Any]:
    """Return a structured pass/fail for one drill against a take summary."""
    results: list[dict[str, Any]] = []
    passed = True
    for check in _checks(drill):
        metric = str(check.get("metric") or "")
        op = str(check.get("op") or ">=")
        try:
            threshold = float(check.get("value"))
        except (TypeError, ValueError):
            threshold = 0.0
        value = metric_value(summary, metric)
        ok = False
        fn = OPS.get(op)
        if value is not None and fn is not None:
            ok = bool(fn(value, threshold))
        if not ok:
            passed = False
        results.append(
            {
                "metric": metric,
                "op": op,
                "threshold": threshold,
                "value": value,
                "ok": ok,
            }
        )
    if not results:
        passed = False
    reason_bits = []
    for r in results:
        got = "n/a" if r["value"] is None else r["value"]
        mark = "ok" if r["ok"] else "miss"
        reason_bits.append(f"{r['metric']} {got} {r['op']} {r['threshold']} ({mark})")
    return {
        "drillId": drill.get("id"),
        "title": drill.get("title"),
        "passed": passed,
        "checks": results,
        "reason": "; ".join(reason_bits) if reason_bits else "no pass criteria",
    }


def instruction_of(drill: dict[str, Any]) -> str:
    return str(drill.get("instruction") or drill.get("title") or "")
