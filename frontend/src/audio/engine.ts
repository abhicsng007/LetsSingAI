// AudioEngine: microphone capture + per-frame feature extraction.
//
// For an MVP we run the analysis in a requestAnimationFrame loop on the main
// thread reading from an AnalyserNode. pitchy + a 2048-point FFT at ~60fps is
// comfortably within budget and avoids AudioWorklet/Vite loading friction.

import { PitchDetector } from "pitchy";
import type { FeatureFrame } from "./types";
import { emptyFrame } from "./types";
import {
  dbToLinear,
  estimateFormants,
  extractHarmonics,
  rms,
  spectralBrightness,
} from "./dsp";
import {
  analyzePitch,
  centsBetween,
  midiToNoteName,
  freqToMidi,
  snapOctaveToTarget,
} from "../analysis/pitch";
import { smoothingAlpha } from "../analysis/humanPitch";
import { getCurrentSong, melodyNoteNear, refFrameAt } from "../data/songs";
import { liveFrame } from "./featureBus";
import { melodyTimeSec } from "./playback";

const FFT_SIZE = 2048;
const CLARITY_THRESHOLD = 0.8;
const RMS_FLOOR = 0.006;

interface EngineOptions {
  /** throttled callback for UI (default every 100 ms) */
  onUi?: (frame: FeatureFrame) => void;
  uiIntervalMs?: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private detector: PitchDetector<Float32Array> | null = null;
  private raf = 0;
  private running = false;

  private timeBuf = new Float32Array(FFT_SIZE);
  private freqBuf = new Float32Array(FFT_SIZE / 2);

  private takeStartMs = 0;
  private lastUiMs = 0;
  private recording = false;
  private recorded: FeatureFrame[] = [];
  private tempoScale = 1;
  private scoreMelody = true;
  private suppressLive = false;

  // rolling history for vibrato + breath support
  private f0Hist: { t: number; f0: number }[] = [];
  private rmsHist: number[] = [];

  private smoothFormants: [number, number, number] = [0, 0, 0];
  /** Smoothed f0 so live error tracks the pitch centre, not vibrato peaks. */
  private f0Center = 0;
  private lastPitchMs = 0;
  private opts: EngineOptions;

  constructor(opts: EngineOptions = {}) {
    this.opts = opts;
  }

  get isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") await this.ctx.resume();

    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0.15;
    this.analyser.minDecibels = -90;
    this.analyser.maxDecibels = -20;
    source.connect(this.analyser);

    this.detector = PitchDetector.forFloat32Array(this.analyser.fftSize);
    this.timeBuf = new Float32Array(this.analyser.fftSize);
    this.freqBuf = new Float32Array(this.analyser.frequencyBinCount);

    this.takeStartMs = performance.now();
    this.running = true;
    this.loop();
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.ctx = null;
    this.analyser = null;
    this.stream = null;
    this.suppressLive = false;
    liveFrame.current = emptyFrame();
  }

  setSuppressLive(on: boolean): void {
    this.suppressLive = on;
  }

  setRecording(
    on: boolean,
    opts?: { tempoScale?: number; scoreMelody?: boolean },
  ): void {
    this.recording = on;
    if (on) {
      this.recorded = [];
      this.takeStartMs = performance.now();
      this.tempoScale = opts?.tempoScale ?? 1;
      this.scoreMelody = opts?.scoreMelody ?? true;
    } else {
      this.tempoScale = 1;
      this.scoreMelody = true;
    }
  }

  getTake(): FeatureFrame[] {
    return this.recorded;
  }

  private loop = (): void => {
    if (!this.running || !this.analyser || !this.detector || !this.ctx) return;
    this.raf = requestAnimationFrame(this.loop);

    const sr = this.ctx.sampleRate;
    const fftSize = this.analyser.fftSize;
    this.analyser.getFloatTimeDomainData(this.timeBuf);
    this.analyser.getFloatFrequencyData(this.freqBuf);

    const level = rms(this.timeBuf);
    const [pitch, clarity] = this.detector.findPitch(this.timeBuf, sr);
    const voiced =
      clarity > CLARITY_THRESHOLD &&
      level > RMS_FLOOR &&
      pitch > 60 &&
      pitch < 1200;

    const now = performance.now();
    const t = (now - this.takeStartMs) / 1000;

    const frame: FeatureFrame = emptyFrame();
    frame.t = t;
    frame.rms = Math.min(1, level * 6);
    frame.clarity = clarity;

    if (voiced) {
      const linear = dbToLinear(this.freqBuf);
      const f0 = this.foldToMelody(pitch, t);
      const dt = this.lastPitchMs ? (now - this.lastPitchMs) / 1000 : 0.016;
      this.lastPitchMs = now;
      const a = smoothingAlpha(dt);
      this.f0Center = this.f0Center > 0 ? this.f0Center + (f0 - this.f0Center) * a : f0;
      const np = analyzePitch(f0);
      frame.hasPitch = true;
      frame.f0 = f0;
      frame.midi = np.midi;
      frame.note = np.note;
      frame.cents = np.cents;
      this.applyMelodyTarget(frame, this.f0Center, t);
      frame.harmonics = extractHarmonics(linear, f0, sr, fftSize);
      frame.brightness = spectralBrightness(linear, sr, fftSize);

      const rawFormants = estimateFormants(this.timeBuf, sr);
      for (let i = 0; i < 3; i++) {
        const raw = rawFormants[i];
        if (raw > 0) {
          const prev = this.smoothFormants[i];
          this.smoothFormants[i] = prev > 0 ? prev * 0.8 + raw * 0.2 : raw;
        }
      }
      frame.formants = [...this.smoothFormants] as [number, number, number];

      this.updateVibrato(frame, t, f0);
      this.updateBreathSupport(frame, level);
    } else {
      this.f0Hist = [];
      this.f0Center = 0;
      this.lastPitchMs = 0;
    }

    if (!this.suppressLive) liveFrame.current = frame;
    if (this.recording && voiced && !this.suppressLive) this.recorded.push(frame);

    const interval = this.opts.uiIntervalMs ?? 100;
    if (this.opts.onUi && now - this.lastUiMs >= interval) {
      this.lastUiMs = now;
      this.opts.onUi(frame);
    }
  };

  /** Song-time for melody lookup: take clock (tempo-scaled) or play-along clock. */
  private melodySongTime(tWall: number): number | null {
    if (this.recording) {
      return this.scoreMelody ? tWall * this.tempoScale : null;
    }
    return melodyTimeSec();
  }

  private foldToMelody(pitch: number, tWall: number): number {
    const target = this.melodyTargetHz(pitch, tWall);
    if (target <= 0) return pitch;
    return snapOctaveToTarget(pitch, target);
  }

  private applyMelodyTarget(frame: FeatureFrame, f0: number, tWall: number): void {
    const target = this.melodyTargetHz(f0, tWall);
    if (target <= 0) return;
    frame.targetF0 = target;
    frame.targetNote = midiToNoteName(Math.round(freqToMidi(target)));
    frame.melodyCents = centsBetween(f0, target);
  }

  /** Nearby written note whose pitch matches the sung note — not exact chart time. */
  private melodyTargetHz(f0: number, tWall: number): number {
    const tSong = this.melodySongTime(tWall);
    if (tSong == null) return 0;
    const song = getCurrentSong();
    const note = melodyNoteNear(song, tSong, f0);
    if (note && note.f0 > 0) return note.f0;
    const rf = refFrameAt(song, tSong);
    return rf && rf.f0 > 0 ? rf.f0 : 0;
  }

  private updateVibrato(frame: FeatureFrame, t: number, f0: number): void {
    this.f0Hist.push({ t, f0 });
    while (this.f0Hist.length > 0 && t - this.f0Hist[0].t > 0.7) {
      this.f0Hist.shift();
    }
    if (this.f0Hist.length < 6) return;

    const mean =
      this.f0Hist.reduce((s, p) => s + p.f0, 0) / this.f0Hist.length;
    let min = Infinity;
    let max = -Infinity;
    let crossings = 0;
    let prevSign = 0;
    for (const p of this.f0Hist) {
      min = Math.min(min, p.f0);
      max = Math.max(max, p.f0);
      const sign = Math.sign(p.f0 - mean);
      if (sign !== 0 && prevSign !== 0 && sign !== prevSign) crossings++;
      if (sign !== 0) prevSign = sign;
    }
    const duration =
      this.f0Hist[this.f0Hist.length - 1].t - this.f0Hist[0].t || 1;
    frame.vibratoExtent = Math.abs(1200 * Math.log2(max / min)) / 2;
    frame.vibratoRate = crossings / (2 * duration);
  }

  private updateBreathSupport(frame: FeatureFrame, level: number): void {
    this.rmsHist.push(level);
    if (this.rmsHist.length > 40) this.rmsHist.shift();
    if (this.rmsHist.length < 8) {
      frame.breathSupport = frame.rms;
      return;
    }
    const mean =
      this.rmsHist.reduce((s, v) => s + v, 0) / this.rmsHist.length;
    const variance =
      this.rmsHist.reduce((s, v) => s + (v - mean) * (v - mean), 0) /
      this.rmsHist.length;
    const cv = mean > 1e-6 ? Math.sqrt(variance) / mean : 1;
    const stability = Math.max(0, 1 - cv * 2.2);
    const levelOk = Math.min(1, level * 12);
    frame.breathSupport = stability * 0.7 + levelOk * 0.3;
  }
}
