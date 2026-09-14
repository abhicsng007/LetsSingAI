from drills import get_drill, list_drills, score_drill


def test_plan_returns_kb_ids_only():
    items = list_drills("breath-support")
    assert len(items) == 3
    assert all(d["id"].startswith("breath-") for d in items)
    assert get_drill("breath-hiss-1")["kind"] == "hiss"


def test_score_drill_pass_and_fail():
    drill = get_drill("breath-hiss-1")
    good = {
        "breathSupport": {"mean": 0.7},
        "durationSec": 12,
        "pitch": {"meanAbsCents": 10, "wrongNoteRatio": 0.05},
        "voicedRatio": 0.8,
        "timbre": {"harmonicBalanceDelta": 0.1, "thinTone": False},
    }
    bad = {
        "breathSupport": {"mean": 0.2},
        "durationSec": 3,
        "pitch": {"meanAbsCents": 40, "wrongNoteRatio": 0.4},
        "voicedRatio": 0.2,
        "timbre": {"harmonicBalanceDelta": 0.4, "thinTone": True},
    }
    assert score_drill(good, drill)["passed"] is True
    assert score_drill(bad, drill)["passed"] is False


def test_pitch_drill_threshold():
    drill = get_drill("pitch-phrase-1")
    summary = {
        "pitch": {"meanAbsCents": 10, "wrongNoteRatio": 0.05},
        "breathSupport": {"mean": 0.6},
        "durationSec": 10,
        "voicedRatio": 0.7,
        "timbre": {"harmonicBalanceDelta": 0.1, "thinTone": False},
    }
    assert score_drill(summary, drill)["passed"] is True
    summary["pitch"]["meanAbsCents"] = 70
    assert score_drill(summary, drill)["passed"] is False
