"""Listener-like pitch thresholds.

Keep in sync with frontend/src/analysis/humanPitch.ts. A teacher hears the
centre of a held note (~50¢ still in tune). 15–35¢ is a strobe tuner, not a
person. Flag pitch work only when the take is clearly off or many notes miss.
"""

from __future__ import annotations

from typing import Any

IN_TUNE_CENTS = 50
TAKE_OFF_CENTS = 58
TAKE_OFF_WRONG_RATIO = 0.28


def pitch_off(pitch: dict[str, Any] | None) -> bool:
    p = pitch or {}
    mean_abs = float(p.get("meanAbsCents", 0) or 0)
    wrong = float(p.get("wrongNoteRatio", 0) or 0)
    return mean_abs > TAKE_OFF_CENTS or wrong > TAKE_OFF_WRONG_RATIO
