"""Offline reference-song analyzer.

Turns an audio file into the JSON shape the frontend loads
(`frontend/src/data/<song>.json` == the `ReferenceSong` type):

    { id, title, artist, bpm, duration, vowel,
      frames: [ { t, f0, harmonics[8], formants[3], rms } ],
      sections: [ { name, start, end } ] }

Usage:
    python analyze_song.py vocal.wav --title "My Song" --artist "Someone" \
        --out ../frontend/src/data/mysong.json

Requires: pip install librosa numpy soundfile
(These are heavy scientific packages; install them only when you want to
analyze real audio. The app ships with a synthetic reference so this is
optional.)
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

HOP = 0.05  # seconds between output frames
HARMONICS = 8


def levinson(r: np.ndarray, order: int) -> np.ndarray | None:
    if r[0] == 0:
        return None
    a = np.zeros(order + 1)
    a[0] = 1.0
    err = r[0]
    for i in range(1, order + 1):
        acc = r[i] + np.dot(a[1:i], r[i - 1 : 0 : -1])
        k = -acc / err
        a[1:i], prev = a[1:i] + k * a[i - 1 : 0 : -1], a[1:i].copy()
        a[i] = k
        err *= 1 - k * k
        if err <= 0:
            return None
    return a


def estimate_formants(frame: np.ndarray, sr: int) -> list[float]:
    factor = max(1, round(sr / 11025))
    dec = frame[::factor]
    dec_sr = sr / factor
    if dec.size < 64:
        return [0.0, 0.0, 0.0]
    pre = np.append(dec[0], dec[1:] - 0.97 * dec[:-1])
    win = pre * np.hamming(pre.size)
    order = 12
    r = np.array([np.dot(win[lag:], win[: win.size - lag]) for lag in range(order + 1)])
    a = levinson(r, order)
    if a is None:
        return [0.0, 0.0, 0.0]
    steps = 256
    freqs = np.linspace(0, dec_sr / 2, steps)
    w = 2 * np.pi * freqs / dec_sr
    k = np.arange(order + 1)
    resp = np.abs(1.0 / (np.exp(-1j * np.outer(w, k)) @ a))
    formants: list[float] = []
    for s in range(1, steps - 1):
        if freqs[s] < 200:
            continue
        if resp[s] > resp[s - 1] and resp[s] >= resp[s + 1]:
            formants.append(round(float(freqs[s])))
            if len(formants) == 3:
                break
    while len(formants) < 3:
        formants.append(0.0)
    return formants


def analyze(path: str, title: str, artist: str, vowel: str) -> dict:
    import librosa

    y, sr = librosa.load(path, sr=None, mono=True)
    duration = len(y) / sr

    f0, _, _ = librosa.pyin(
        y, fmin=float(librosa.note_to_hz("C2")), fmax=float(librosa.note_to_hz("C6")), sr=sr
    )
    times = librosa.times_like(f0, sr=sr)
    n_fft = 2048
    S = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=n_fft // 4))
    stft_times = librosa.times_like(S, sr=sr, hop_length=n_fft // 4)
    rms = librosa.feature.rms(y=y, frame_length=n_fft, hop_length=n_fft // 4)[0]
    bin_hz = sr / n_fft
    win = int(HOP * sr)

    frames = []
    t = 0.0
    while t < duration:
        fi = int(np.argmin(np.abs(times - t)))
        si = int(np.argmin(np.abs(stft_times - t)))
        pitch = f0[fi] if fi < len(f0) and not np.isnan(f0[fi]) else 0.0
        if pitch and pitch > 0:
            harm = []
            spec = S[:, si]
            for n in range(1, HARMONICS + 1):
                center = int(round(n * pitch / bin_hz))
                lo, hi = max(0, center - 2), min(len(spec), center + 3)
                harm.append(float(spec[lo:hi].max()) if hi > lo else 0.0)
            mx = max(harm) or 1.0
            harmonics = [round(h / mx, 3) for h in harm]
            start = int(t * sr)
            formants = estimate_formants(y[start : start + win].astype(np.float64), sr)
            frames.append(
                {
                    "t": round(t, 3),
                    "f0": round(float(pitch), 2),
                    "harmonics": harmonics,
                    "formants": formants,
                    "rms": round(float(rms[min(si, len(rms) - 1)]), 3),
                }
            )
        t += HOP

    try:
        tempo = float(librosa.beat.tempo(y=y, sr=sr)[0])
    except Exception:
        tempo = 100.0

    half = round(duration / 2, 2)
    return {
        "id": Path(path).stem.lower().replace(" ", "-"),
        "title": title,
        "artist": artist,
        "bpm": round(tempo),
        "duration": round(duration, 2),
        "vowel": vowel,
        "frames": frames,
        "sections": [
            {"name": "Part 1", "start": 0, "end": half},
            {"name": "Part 2", "start": half, "end": round(duration, 2)},
        ],
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Analyze a song into reference JSON.")
    ap.add_argument("audio", help="path to an audio file (wav/mp3/flac)")
    ap.add_argument("--title", default="Reference Song")
    ap.add_argument("--artist", default="Unknown")
    ap.add_argument("--vowel", default="ah")
    ap.add_argument("--out", default="reference.json")
    args = ap.parse_args()

    data = analyze(args.audio, args.title, args.artist, args.vowel)
    Path(args.out).write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"Wrote {args.out}: {len(data['frames'])} frames, {data['duration']}s")


if __name__ == "__main__":
    main()
