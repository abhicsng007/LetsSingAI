import json

from tools import plan_practice


def test_plan_practice_only_kb_ids():
    raw = plan_practice("pitch-accuracy")
    payload = json.loads(raw)
    assert payload["focus"] == "pitch-accuracy"
    assert len(payload["drills"]) == 3
    ids = {d["id"] for d in payload["drills"]}
    assert ids == {"pitch-slow-1", "pitch-siren-1", "pitch-phrase-1"}
    unknown = json.loads(plan_practice("not-a-technique"))
    assert "error" in unknown
