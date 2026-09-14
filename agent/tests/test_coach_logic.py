from coach_logic import determine_focus


def test_focus_prefers_body_fault():
    summary = {
        "bodyFaults": [
            {"technique": "open-throat", "label": "Jaw", "offRatio": 0.6, "correctMotion": "drop"}
        ],
        "pitch": {"meanAbsCents": 40, "wrongNoteRatio": 0.4},
        "breathSupport": {"mean": 0.2},
        "timbre": {"thinTone": True, "harmonicBalanceDelta": 0.4},
    }
    assert determine_focus(summary) == "open-throat"


def test_focus_falls_back_to_breath():
    summary = {
        "bodyFaults": [],
        "pitch": {"meanAbsCents": 8, "wrongNoteRatio": 0.02},
        "breathSupport": {"mean": 0.3},
        "timbre": {"thinTone": False, "harmonicBalanceDelta": 0.1},
    }
    assert determine_focus(summary) == "breath-support"


def test_focus_ignores_human_wobble():
    """~30¢ off the held centre is still in tune to a listener."""
    summary = {
        "bodyFaults": [],
        "pitch": {"meanAbsCents": 30, "wrongNoteRatio": 0.08},
        "breathSupport": {"mean": 0.7},
        "timbre": {"thinTone": False, "harmonicBalanceDelta": 0.1},
    }
    assert determine_focus(summary) == "open-throat"


def test_focus_pitch_when_clearly_off():
    summary = {
        "bodyFaults": [],
        "pitch": {"meanAbsCents": 55, "wrongNoteRatio": 0.3},
        "breathSupport": {"mean": 0.7},
        "timbre": {"thinTone": False, "harmonicBalanceDelta": 0.1},
    }
    assert determine_focus(summary) == "pitch-accuracy"
