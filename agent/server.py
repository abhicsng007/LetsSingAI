"""FastAPI server exposing the vocal-coach session conductor over SSE."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Literal

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

import drills
import memory
from agent import agent_available, stream_coach

app = FastAPI(title="LetsSingAI Coach")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class CoachRequest(BaseModel):
    summary: dict[str, Any]
    singer_id: str = "demo-singer"
    session_id: str = "demo-session"
    event: Literal["take", "drill", "recap"] = "take"
    drill_id: str | None = None
    skip: bool = False
    next_drill_id: str = ""


def _sse(obj: dict[str, Any]) -> str:
    return f"data: {json.dumps(obj)}\n\n"


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "coach": "bedrock-agent" if agent_available() else "heuristic",
        "memory": memory.memory_backend(),
        "model": os.getenv("BEDROCK_MODEL_ID", "unset"),
    }


@app.get("/progress/{singer_id}")
def progress(singer_id: str) -> dict[str, Any]:
    recalled = memory.get_store().recall(singer_id)
    return {
        "history": recalled.get("sessions") or [],
        "lastFocus": recalled.get("lastFocus"),
        "notes": recalled.get("notes") or [],
        "sessionCount": recalled.get("sessionCount") or 0,
        "last": recalled.get("last"),
        "backend": recalled.get("backend"),
    }


@app.get("/session/{singer_id}")
def session_export(singer_id: str) -> dict[str, Any]:
    """Teacher log: sessions + notes for this singer."""
    return progress(singer_id)


@app.get("/kb/drills")
def kb_drills(technique: str | None = None) -> dict[str, Any]:
    if technique:
        return {"technique": technique, "drills": drills.list_drills(technique)}
    return {"drills": drills.all_drills()}


@app.post("/coach")
async def coach(req: CoachRequest) -> StreamingResponse:
    async def gen():
        async for kind, text in stream_coach(
            req.summary,
            singer_id=req.singer_id,
            event=req.event,
            session_id=req.session_id,
            drill_id=req.drill_id,
            skip=req.skip,
            next_drill_id=req.next_drill_id,
        ):
            if kind == "focus":
                yield _sse({"type": "focus", "focus": text})
            elif kind == "source":
                yield _sse({"type": "meta", "source": text, "memory": memory.memory_backend()})
            elif kind == "tool":
                try:
                    payload = json.loads(text)
                except json.JSONDecodeError:
                    payload = {"name": text, "status": "start"}
                yield _sse({"type": "tool", **payload})
            elif kind == "plan":
                try:
                    plan = json.loads(text)
                except json.JSONDecodeError:
                    plan = {"focus": "none", "drills": [], "exercises": []}
                yield _sse({"type": "plan", "plan": plan})
            elif kind == "diagnosis":
                try:
                    diagnosis = json.loads(text)
                except json.JSONDecodeError:
                    diagnosis = {}
                yield _sse({"type": "diagnosis", "diagnosis": diagnosis})
            elif kind == "verdict":
                try:
                    verdict = json.loads(text)
                except json.JSONDecodeError:
                    verdict = {}
                yield _sse({"type": "verdict", "verdict": verdict})
            else:
                yield _sse({"type": "token", "text": text})
        yield _sse({"type": "done"})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _frontend_dist() -> Path | None:
    raw = os.getenv("FRONTEND_DIST", "").strip()
    candidates = [
        Path(raw) if raw else None,
        Path(__file__).resolve().parent / "static",
        Path(__file__).resolve().parent.parent / "frontend" / "dist",
    ]
    for path in candidates:
        if path is not None and (path / "index.html").is_file():
            return path
    return None


_DIST = _frontend_dist()
if _DIST is not None:

    @app.get("/")
    def spa_index() -> FileResponse:
        return FileResponse(_DIST / "index.html")

    @app.get("/{full_path:path}")
    def spa_assets(full_path: str) -> FileResponse:
        target = (_DIST / full_path).resolve()
        dist = _DIST.resolve()
        if str(target).startswith(str(dist)) and target.is_file():
            return FileResponse(target)
        return FileResponse(_DIST / "index.html")


if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=False)
