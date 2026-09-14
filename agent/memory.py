"""Singer memory: local JSON, plus AgentCore Memory when MEMORY_ID is set.

Tools talk only to this protocol. Local file keeps the demo working without
an AWS memory resource; AgentCore is used in addition when configured.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol

import envload  # noqa: F401 — load agent/.env

_STORE = Path(__file__).parent / "data" / "progress.json"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _compact_session(summary: dict[str, Any]) -> dict[str, Any]:
    return {
        "at": _now(),
        "meanAbsCents": (summary.get("pitch") or {}).get("meanAbsCents"),
        "breathSupport": (summary.get("breathSupport") or {}).get("mean"),
        "harmonicBalanceDelta": (summary.get("timbre") or {}).get("harmonicBalanceDelta"),
        "wrongNoteRatio": (summary.get("pitch") or {}).get("wrongNoteRatio"),
        "song": (summary.get("song") or {}).get("title"),
        "focus": summary.get("focus"),
    }


class MemoryStore(Protocol):
    def recall(self, singer_id: str) -> dict[str, Any]: ...
    def write_session(self, singer_id: str, summary: dict[str, Any]) -> int: ...
    def write_note(self, singer_id: str, text: str, kind: str = "note") -> None: ...
    backend: str


class LocalJsonMemory:
    backend = "local"

    def __init__(self, path: Path | None = None) -> None:
        self.path = path or _STORE

    def _load(self) -> dict[str, Any]:
        if not self.path.exists():
            return {"singers": {}}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {"singers": {}}
        if "singers" in data and isinstance(data["singers"], dict):
            return data
        # Migrate legacy { singer_id: [sessions] } shape.
        singers: dict[str, Any] = {}
        if isinstance(data, dict):
            for key, val in data.items():
                if isinstance(val, list):
                    singers[key] = {"sessions": val, "notes": [], "lastFocus": None}
        return {"singers": singers}

    def _save(self, data: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    def _singer(self, data: dict[str, Any], singer_id: str) -> dict[str, Any]:
        singers = data.setdefault("singers", {})
        rec = singers.get(singer_id)
        if not isinstance(rec, dict):
            rec = {"sessions": [], "notes": [], "lastFocus": None}
            singers[singer_id] = rec
        rec.setdefault("sessions", [])
        rec.setdefault("notes", [])
        rec.setdefault("lastFocus", None)
        return rec

    def recall(self, singer_id: str) -> dict[str, Any]:
        rec = self._singer(self._load(), singer_id)
        sessions = rec.get("sessions") or []
        notes = rec.get("notes") or []
        last = sessions[-1] if sessions else None
        return {
            "singerId": singer_id,
            "sessions": sessions[-8:],
            "sessionCount": len(sessions),
            "last": last,
            "lastFocus": rec.get("lastFocus"),
            "notes": notes[-6:],
            "backend": self.backend,
        }

    def write_session(self, singer_id: str, summary: dict[str, Any]) -> int:
        data = self._load()
        rec = self._singer(data, singer_id)
        rec["sessions"].append(_compact_session(summary))
        if summary.get("focus"):
            rec["lastFocus"] = summary.get("focus")
        self._save(data)
        return len(rec["sessions"])

    def write_note(self, singer_id: str, text: str, kind: str = "note") -> None:
        data = self._load()
        rec = self._singer(data, singer_id)
        rec["notes"].append({"at": _now(), "kind": kind, "text": text})
        rec["notes"] = rec["notes"][-40:]
        self._save(data)


class AgentCoreMemory:
    """Local store plus best-effort AgentCore Memory events."""

    backend = "agentcore"

    def __init__(self, memory_id: str, inner: LocalJsonMemory, region: str | None = None) -> None:
        self.memory_id = memory_id
        self.inner = inner
        self.region = region or os.getenv("AWS_REGION", "us-west-2")

    def recall(self, singer_id: str) -> dict[str, Any]:
        payload = self.inner.recall(singer_id)
        payload["backend"] = self.backend
        remote = self._retrieve(singer_id)
        if remote:
            payload["agentcore"] = remote
        return payload

    def write_session(self, singer_id: str, summary: dict[str, Any]) -> int:
        count = self.inner.write_session(singer_id, summary)
        compact = _compact_session(summary)
        self._write_event(singer_id, f"session {json.dumps(compact)}")
        return count

    def write_note(self, singer_id: str, text: str, kind: str = "note") -> None:
        self.inner.write_note(singer_id, text, kind=kind)
        self._write_event(singer_id, f"{kind}: {text}")

    def _write_event(self, actor_id: str, text: str) -> None:
        try:
            from bedrock_agentcore.memory import MemoryClient

            client = MemoryClient(region_name=self.region)
            client.create_event(
                memory_id=self.memory_id,
                actor_id=actor_id,
                session_id="letssingai-lesson",
                messages=[(text, "ASSISTANT")],
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[memory] AgentCore write skipped ({type(exc).__name__}: {exc})")

    def _retrieve(self, actor_id: str) -> list[str]:
        try:
            from bedrock_agentcore.memory import MemoryClient

            client = MemoryClient(region_name=self.region)
            if not hasattr(client, "retrieve_memories"):
                return []
            hits = client.retrieve_memories(
                memory_id=self.memory_id,
                namespace=f"/singer/{actor_id}/",
                query="vocal practice progress focus drills",
                top_k=5,
            )
            out: list[str] = []
            for hit in hits or []:
                if isinstance(hit, dict):
                    content = hit.get("content") or hit.get("text")
                    if content:
                        out.append(str(content)[:400])
                elif hit:
                    out.append(str(hit)[:400])
            return out
        except Exception as exc:  # noqa: BLE001
            print(f"[memory] AgentCore recall skipped ({type(exc).__name__}: {exc})")
            return []


_store: MemoryStore | None = None


def memory_backend() -> str:
    return "agentcore" if os.getenv("AGENTCORE_MEMORY_ID", "").strip() else "local"


def get_store() -> MemoryStore:
    global _store
    if _store is not None:
        return _store
    local = LocalJsonMemory()
    mem_id = os.getenv("AGENTCORE_MEMORY_ID", "").strip()
    if mem_id:
        _store = AgentCoreMemory(mem_id, local)
    else:
        _store = local
    return _store
