from pitch_eval import pitch_off


def test_human_wobble_is_not_off():
    assert pitch_off({"meanAbsCents": 30, "wrongNoteRatio": 0.1}) is False


def test_clearly_flat_is_off():
    assert pitch_off({"meanAbsCents": 70, "wrongNoteRatio": 0.05}) is True


def test_wrong_notes_are_off():
    assert pitch_off({"meanAbsCents": 20, "wrongNoteRatio": 0.3}) is True
