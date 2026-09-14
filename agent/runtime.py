"""Amazon Bedrock AgentCore entrypoint for the LetsSingAI session conductor."""

from __future__ import annotations

import json
import os
from typing import Any

from agent import stream_coach


async def _collect(payload: dict[str, Any]) -> dict[str, Any]:
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else payload
    singer_id = str(payload.get("singer_id") or payload.get("singerId") or "demo-singer")
    session_id = str(payload.get("session_id") or payload.get("sessionId") or "demo-session")
    event = str(payload.get("event") or "take")
    drill_id = payload.get("drill_id") or payload.get("drillId")
    skip = bool(payload.get("skip") or False)
    next_drill_id = str(payload.get("next_drill_id") or payload.get("nextDrillId") or "")

    tokens: list[str] = []
    tools: list[dict[str, str]] = []
    focus = "none"
    source = "local"
    plan: dict[str, Any] | None = None
    diagnosis: dict[str, Any] | None = None
    verdict: dict[str, Any] | None = None
    async for kind, text in stream_coach(
        summary,
        singer_id=singer_id,
        event=event,
        session_id=session_id,
        drill_id=str(drill_id) if drill_id else None,
        skip=skip,
        next_drill_id=next_drill_id,
    ):
        if kind == "token":
            tokens.append(text)
        elif kind == "focus":
            focus = text
        elif kind == "source":
            source = text
        elif kind == "tool":
            try:
                tools.append(json.loads(text))
            except json.JSONDecodeError:
                tools.append({"name": text, "status": "start"})
        elif kind == "plan":
            try:
                plan = json.loads(text)
            except json.JSONDecodeError:
                plan = None
        elif kind == "diagnosis":
            try:
                diagnosis = json.loads(text)
            except json.JSONDecodeError:
                diagnosis = None
        elif kind == "verdict":
            try:
                verdict = json.loads(text)
            except json.JSONDecodeError:
                verdict = None
    return {
        "focus": focus,
        "source": source,
        "plan": plan,
        "diagnosis": diagnosis,
        "verdict": verdict,
        "tools": tools,
        "result": "".join(tokens),
    }


try:
    from bedrock_agentcore.runtime import BedrockAgentCoreApp

    app = BedrockAgentCoreApp()

    @app.entrypoint
    async def invoke(payload: dict[str, Any]) -> dict[str, Any]:
        return await _collect(payload or {})

except ImportError:
    app = None

    async def invoke(payload: dict[str, Any]) -> dict[str, Any]:
        return await _collect(payload or {})


if __name__ == "__main__":
    if app is not None:
        app.run()
    else:
        import uvicorn

        uvicorn.run("server:app", host="0.0.0.0", port=int(os.getenv("PORT", "8080")))
