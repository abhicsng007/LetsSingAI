import json

import pytest
from fastapi.testclient import TestClient

import server


@pytest.fixture
def client():
    return TestClient(server.app)


def test_health(client):
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["coach"] in ("bedrock-agent", "heuristic")
    assert body["memory"] in ("local", "agentcore")


def test_kb_drills(client):
    res = client.get("/kb/drills", params={"technique": "breath-support"})
    assert res.status_code == 200
    drills = res.json()["drills"]
    assert len(drills) == 3
    assert drills[0]["id"] == "breath-hiss-1"


def test_coach_take_sse_shape(client, monkeypatch):
    async def fake_stream(*_args, **_kwargs):
        yield ("focus", "breath-support")
        yield ("tool", json.dumps({"name": "analyze_take", "status": "start"}))
        yield ("tool", json.dumps({"name": "analyze_take", "status": "done"}))
        yield (
            "plan",
            json.dumps(
                {
                    "focus": "breath-support",
                    "drills": [{"id": "breath-hiss-1", "title": "Hiss", "instruction": "hiss"}],
                    "exercises": ["hiss"],
                }
            ),
        )
        yield ("token", "### What I heard\n- breath")
        yield ("source", "local")

    monkeypatch.setattr(server, "stream_coach", fake_stream)
    res = client.post(
        "/coach",
        json={
            "event": "take",
            "singer_id": "test",
            "summary": {
                "pitch": {"meanAbsCents": 20},
                "breathSupport": {"mean": 0.3},
                "song": {"title": "Twinkle"},
            },
        },
    )
    assert res.status_code == 200
    text = res.text
    assert '"type": "focus"' in text
    assert '"type": "plan"' in text
    assert '"type": "tool"' in text
    assert '"type": "done"' in text


def test_coach_drill_event(client, monkeypatch):
    async def fake_stream(*_args, **kwargs):
        assert kwargs.get("event") == "drill"
        assert kwargs.get("drill_id") == "breath-hiss-1"
        yield (
            "verdict",
            json.dumps(
                {
                    "drillId": "breath-hiss-1",
                    "result": "pass",
                    "reason": "ok",
                    "nextDrillId": "breath-siren-1",
                }
            ),
        )
        yield ("token", "**Hiss — pass.**")
        yield ("source", "local")

    monkeypatch.setattr(server, "stream_coach", fake_stream)
    res = client.post(
        "/coach",
        json={
            "event": "drill",
            "drill_id": "breath-hiss-1",
            "singer_id": "test",
            "summary": {"breathSupport": {"mean": 0.7}, "durationSec": 12},
        },
    )
    assert res.status_code == 200
    assert '"type": "verdict"' in res.text
