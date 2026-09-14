import { midiToFreq } from "../analysis/pitch";
import { getCurrentSong, type ReferenceSong } from "../data/songs";

let ctx: AudioContext | null = null;
let playing = false;
let stopAt = 0;
let playOrigin = 0;
let playRate = 1;
let playSongDuration = 0;
const activeSources: AudioScheduledSourceNode[] = [];

// "ah" formants — same vowel the anatomy/harmonics model uses.
const AH: [number, number, number] = [720, 1150, 2600];

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

function track(node: AudioScheduledSourceNode): void {
  activeSources.push(node);
}

export function isPlayingReference(): boolean {
  return playing && getCtx().currentTime < stopAt;
}

export function stopReferenceMelody(): void {
  playing = false;
  stopAt = 0;
  for (const node of activeSources) {
    try {
      node.stop();
    } catch {
      /* already stopped */
    }
  }
  activeSources.length = 0;
}

/** Song-time in seconds for the currently playing reference, or null. */
export function melodyTimeSec(): number | null {
  if (!playing) return null;
  const ac = getCtx();
  const elapsed = (ac.currentTime - playOrigin) * playRate;
  if (elapsed < -0.05 || elapsed > playSongDuration + 0.25) return null;
  return elapsed;
}

export type VoiceStyle = "sung" | "thin";

/**
 * Play the phrase as a sung vowel (formant voice), not a sine-wave instrument.
 * `thin` is the off-pitch / unsupported demo singer.
 */
export async function playReferenceMelody(
  song: ReferenceSong = getCurrentSong(),
  speed = 1,
  opts?: {
    centsOffset?: number;
    wrongNoteMidi?: (t: number) => number;
    voice?: VoiceStyle;
  },
): Promise<void> {
  const ac = getCtx();
  if (ac.state === "suspended") await ac.resume();
  stopReferenceMelody();
  playing = true;
  const rate = Math.max(0.4, speed);
  playRate = rate;
  const voice: VoiceStyle = opts?.voice ?? (opts?.centsOffset ? "thin" : "sung");

  if (song.vocalUrl && speed === 1) {
    playSongDuration = song.vocalDuration ?? song.duration;
    try {
      await playHumanVocal(ac, song.vocalUrl, {
        centsOffset: opts?.centsOffset ?? 0,
        duration: playSongDuration,
      });
      return;
    } catch (err) {
      console.warn("[playback] human vocal failed, using sung synth", err);
    }
  }

  playSongDuration = song.duration;

  const now = ac.currentTime + 0.05;
  playOrigin = now;
  const master = ac.createGain();
  master.gain.value = voice === "thin" ? 0.09 : 0.11;
  master.connect(ac.destination);

  let end = now;
  for (const note of song.notes) {
    const start = now + note.start / rate;
    const dur = Math.max(0.1, (note.duration - 0.03) / rate);
    const midi = note.midi + (opts?.wrongNoteMidi?.(note.start) ?? 0);
    const hz = midiToFreq(midi) * Math.pow(2, (opts?.centsOffset ?? 0) / 1200);
    startSungNote(ac, master, {
      f0: hz,
      start,
      dur,
      voice,
    });
    end = Math.max(end, start + dur);
  }
  stopAt = end;
  const waitMs = Math.max(0, (end - ac.currentTime) * 1000);
  await new Promise((r) => setTimeout(r, waitMs));
  if (ac.currentTime >= stopAt - 0.05) playing = false;
}

function startSungNote(
  ac: AudioContext,
  dest: AudioNode,
  opts: { f0: number; start: number; dur: number; voice: VoiceStyle },
): OscillatorNode {
  const { f0, start, dur, voice } = opts;
  const thin = voice === "thin";

  // Glottal-like source: sawtooth has a harmonic series like a sung vowel.
  const source = ac.createOscillator();
  source.type = thin ? "square" : "sawtooth";
  source.frequency.setValueAtTime(f0, start);

  if (!thin) {
    const vib = ac.createOscillator();
    const vibAmt = ac.createGain();
    vib.frequency.value = 5.4;
    vibAmt.gain.value = f0 * 0.011;
    vib.connect(vibAmt);
    vibAmt.connect(source.frequency);
    vib.start(start);
    vib.stop(start + dur + 0.04);
    track(vib);
  }

  const body = ac.createBiquadFilter();
  body.type = "lowpass";
  body.frequency.value = thin ? 1800 : 4200;
  body.Q.value = 0.7;

  const f1 = formant(ac, AH[0], thin ? 4 : 6, thin ? 6 : 14);
  const f2 = formant(ac, AH[1], thin ? 3 : 5, thin ? 2 : 11);
  const f3 = formant(ac, AH[2], 4, thin ? -8 : 7);

  const noteGain = ac.createGain();
  noteGain.gain.setValueAtTime(0.0001, start);
  noteGain.gain.exponentialRampToValueAtTime(thin ? 0.45 : 0.7, start + 0.04);
  noteGain.gain.setValueAtTime(thin ? 0.4 : 0.62, start + Math.max(0.08, dur - 0.08));
  noteGain.gain.exponentialRampToValueAtTime(0.0001, start + dur);

  source.connect(body);
  body.connect(f1);
  f1.connect(f2);
  f2.connect(f3);
  f3.connect(noteGain);
  noteGain.connect(dest);

  // A little breath so it doesn't sound like a keyboard patch.
  const noise = ac.createBufferSource();
  noise.buffer = breathBuffer(ac);
  const breathFilter = ac.createBiquadFilter();
  breathFilter.type = "bandpass";
  breathFilter.frequency.value = thin ? 2800 : 2200;
  breathFilter.Q.value = 0.8;
  const breathGain = ac.createGain();
  breathGain.gain.setValueAtTime(0.0001, start);
  breathGain.gain.exponentialRampToValueAtTime(thin ? 0.045 : 0.02, start + 0.05);
  breathGain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  noise.connect(breathFilter);
  breathFilter.connect(breathGain);
  breathGain.connect(dest);

  source.start(start);
  source.stop(start + dur + 0.04);
  noise.start(start);
  noise.stop(start + dur + 0.04);
  track(source);
  track(noise);
  return source;
}

async function playHumanVocal(
  ac: AudioContext,
  url: string,
  opts: { centsOffset: number; duration: number },
): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`vocal ${res.status}`);
  const buf = await ac.decodeAudioData(await res.arrayBuffer());
  const now = ac.currentTime + 0.04;
  playOrigin = now;
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.detune.value = opts.centsOffset;
  const gain = ac.createGain();
  gain.gain.value = 0.85;
  src.connect(gain);
  gain.connect(ac.destination);
  const playFor = Math.min(buf.duration, opts.duration);
  src.start(now);
  src.stop(now + playFor + 0.05);
  track(src);
  stopAt = now + playFor;
  const waitMs = Math.max(0, playFor * 1000);
  await new Promise((r) => setTimeout(r, waitMs));
  if (ac.currentTime >= stopAt - 0.08) playing = false;
}

function formant(ac: AudioContext, hz: number, q: number, gainDb: number): BiquadFilterNode {
  const f = ac.createBiquadFilter();
  f.type = "peaking";
  f.frequency.value = hz;
  f.Q.value = q;
  f.gain.value = gainDb;
  return f;
}

let _breath: AudioBuffer | null = null;
function breathBuffer(ac: AudioContext): AudioBuffer {
  if (_breath && _breath.sampleRate === ac.sampleRate) return _breath;
  const len = ac.sampleRate;
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  _breath = buf;
  return buf;
}

/** Cue tone for hiss (noise) or siren (glide) drills. */
export async function playDrillCue(kind: "hiss" | "siren"): Promise<void> {
  const ac = getCtx();
  if (ac.state === "suspended") await ac.resume();
  stopReferenceMelody();
  playing = true;
  const now = ac.currentTime + 0.03;
  const master = ac.createGain();
  master.gain.value = 0.1;
  master.connect(ac.destination);

  if (kind === "hiss") {
    const src = ac.createBufferSource();
    src.buffer = breathBuffer(ac);
    src.loop = true;
    const filter = ac.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 1800;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.7, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(now);
    src.stop(now + 0.4);
    track(src);
    stopAt = now + 0.4;
    await new Promise((r) => setTimeout(r, 420));
    playing = false;
    return;
  }

  const glide = startSungNote(ac, master, { f0: 220, start: now, dur: 1.85, voice: "sung" });
  glide.frequency.setValueAtTime(220, now);
  glide.frequency.linearRampToValueAtTime(660, now + 0.9);
  glide.frequency.linearRampToValueAtTime(220, now + 1.8);
  stopAt = now + 1.9;
  await new Promise((r) => setTimeout(r, 1950));
  playing = false;
}
