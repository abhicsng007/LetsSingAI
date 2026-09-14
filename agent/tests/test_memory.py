from pathlib import Path

from memory import LocalJsonMemory


def test_memory_round_trip(tmp_path: Path):
    store = LocalJsonMemory(tmp_path / "progress.json")
    empty = store.recall("singer-a")
    assert empty["sessionCount"] == 0
    assert empty["last"] is None

    n = store.write_session(
        "singer-a",
        {
            "pitch": {"meanAbsCents": 22.0},
            "breathSupport": {"mean": 0.4},
            "timbre": {"harmonicBalanceDelta": 0.2},
            "song": {"title": "Twinkle"},
            "focus": "breath-support",
        },
    )
    assert n == 1
    store.write_note("singer-a", "retry hiss", kind="verdict")
    rec = store.recall("singer-a")
    assert rec["sessionCount"] == 1
    assert rec["last"]["meanAbsCents"] == 22.0
    assert rec["lastFocus"] == "breath-support"
    assert rec["notes"][0]["text"] == "retry hiss"
