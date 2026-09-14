import { create } from "zustand";
import type { FeatureFrame } from "../audio/types";
import { emptyFrame } from "../audio/types";
import { AudioEngine } from "../audio/engine";
import type { LiveCue } from "../analysis/cues";
import { liveCue } from "../analysis/cues";
import type { PerformanceSummary } from "../analysis/summary";
import { buildSummary } from "../analysis/summary";
import { getCurrentSong, setCurrentSong, SONGS } from "../data/songs";
import { apiBase, fetchHealth, streamCoach } from "../coach/client";
import type {
  AgentToolEvent,
  CoachEvent,
  Diagnosis,
  DrillSpec,
  DrillVerdict,
  FocusTechnique,
  HealthInfo,
  LessonPhase,
  PracticePlan,
} from "../coach/types";
import type { Part } from "../anatomy/faults";
import { initialDemoCaption, seekDemo, peekDemoElapsed, demoSnapshot } from "../anatomy/demo";
import { playReferenceMelody, stopReferenceMelody, playDrillCue } from "../audio/playback";
import { scoreDrill } from "../drills/score";
import { liveFrame } from "../audio/featureBus";
import {
  buildVerifyFrames,
  runVerifyPlayback,
  stopVerifyPlayback,
} from "../audio/syntheticTake";
import { playAndAnalyzeVocal, stopVocalAnalyze } from "../audio/vocalAnalyze";

export type ViewId = "anatomy" | "harmonics" | "pitch";

interface CoachState {
  streaming: boolean;
  done: boolean;
  text: string;
  focus: FocusTechnique;
  source: "agent" | "local" | null;
  tools: AgentToolEvent[];
  plan: PracticePlan | null;
  diagnosis: Diagnosis | null;
  verdict: DrillVerdict | null;
}

export interface ProgressPoint {
  at: string;
  meanAbsCents: number | null;
  breathSupport: number | null;
  harmonicBalanceDelta: number | null;
  song: string | null;
}

export interface LastSession {
  meanAbsCents?: number | null;
  breathSupport?: number | null;
  song?: string | null;
  focus?: string | null;
}

export interface LiveFault {
  part: Part;
  label: string;
  cue: string;
  severity: number;
}

export interface DemoCaption {
  title: string;
  body: string;
  beat: string;
  step: number;
  steps: number;
  progress: number;
}

interface AppState {
  view: ViewId;
  listening: boolean;
  recording: boolean;
  micError: string | null;
  live: FeatureFrame;
  cue: LiveCue;
  summary: PerformanceSummary | null;
  coach: CoachState;
  demoActive: boolean;
  liveFaults: LiveFault[];
  demoCaption: DemoCaption | null;
  playAlong: boolean;
  progress: ProgressPoint[];
  lastSession: LastSession | null;
  expanded: boolean;
  songId: string;
  lessonPhase: LessonPhase;
  drillIndex: number;
  sessionId: string;
  health: HealthInfo | null;
  lessonLog: string[];
  liveDrillHint: { close: boolean; reason: string } | null;
  verifyPlaying: boolean;
  setView: (v: ViewId) => void;
  setPlayAlong: (on: boolean) => void;
  setExpanded: (on: boolean) => void;
  setSong: (id: string) => void;
  playPhrase: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => void;
  startTake: () => void;
  finishTake: () => Promise<void>;
  skipDrill: () => Promise<void>;
  startRecap: () => void;
  analyzeTake: (frames: FeatureFrame[], event: CoachEvent) => Promise<void>;
  startDemo: () => void;
  stopDemo: () => void;
  playVerifyDemo: () => void;
  stopVerifyDemo: () => void;
  setLiveFaults: (faults: LiveFault[]) => void;
  setDemoCaption: (caption: DemoCaption | null) => void;
  downloadTeacherLog: () => void;
  refreshHealth: () => Promise<void>;
}

let engine: AudioEngine | null = null;

const initialCoach: CoachState = {
  streaming: false,
  done: false,
  text: "",
  focus: "none",
  source: null,
  tools: [],
  plan: null,
  diagnosis: null,
  verdict: null,
};

function singerId(): string {
  const key = "letssingai.singerId";
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return "demo-singer";
  }
}

function newSessionId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `session-${Date.now()}`;
  }
}

function currentDrills(s: AppState): DrillSpec[] {
  return s.coach.plan?.drills ?? [];
}

function nextDrillId(s: AppState, fromIndex: number): string {
  const drills = currentDrills(s);
  return drills[fromIndex + 1]?.id ?? "";
}

export const useStore = create<AppState>((set, get) => ({
  view: "anatomy",
  listening: false,
  recording: false,
  micError: null,
  live: emptyFrame(),
  cue: { text: "Press Start and sing", tone: "info" },
  summary: null,
  coach: initialCoach,
  demoActive: true,
  liveFaults: [],
  demoCaption: initialDemoCaption,
  playAlong: true,
  progress: [],
  lastSession: null,
  expanded: false,
  songId: SONGS[0].id,
  lessonPhase: "demo",
  drillIndex: 0,
  sessionId: newSessionId(),
  health: null,
  lessonLog: [],
  liveDrillHint: null,
  verifyPlaying: false,

  setView: (v) => set({ view: v }),
  setPlayAlong: (on) => set({ playAlong: on }),
  setExpanded: (on) => set({ expanded: on }),
  setSong: (id) => {
    setCurrentSong(id);
    set({ songId: id });
  },
  playPhrase: async () => {
    await playReferenceMelody(getCurrentSong());
  },

  start: async () => {
    get().stopVerifyDemo();
    if (!engine) {
      engine = new AudioEngine({
        uiIntervalMs: 90,
        onUi: (frame) => {
          const st = get();
          let liveDrillHint = st.liveDrillHint;
          if (st.recording && st.lessonPhase === "drill" && engine) {
            const drills = currentDrills(st);
            const drill = drills[st.drillIndex];
            const preview = buildSummary(engine.getTake(), getCurrentSong());
            if (drill && preview) {
              const scored = scoreDrill(preview, drill);
              liveDrillHint = { close: scored.passed, reason: scored.reason };
            }
          }
          set({ live: frame, cue: liveCue(frame), liveDrillHint });
        },
      });
    }
    try {
      await engine.start();
      set({
        listening: true,
        micError: null,
        demoActive: false,
        lessonPhase: get().lessonPhase === "demo" ? "ready" : get().lessonPhase,
      });
      void get().refreshHealth();
    } catch (err) {
      set({
        micError: err instanceof Error ? err.message : "Microphone access was denied",
      });
    }
  },

  stop: () => {
    get().stopVerifyDemo();
    engine?.stop();
    stopReferenceMelody();
    set({ listening: false, recording: false, live: emptyFrame(), liveFaults: [] });
  },

  startTake: () => {
    get().stopVerifyDemo();
    const phase = get().lessonPhase;
    const nextPhase: LessonPhase =
      phase === "drill" || phase === "verdict"
        ? "drill"
        : phase === "recap"
          ? "recap"
          : "take";
    const drill = currentDrills(get())[get().drillIndex];
    const tempoScale = nextPhase === "drill" && drill?.kind === "slow-notes" ? 0.5 : 1;
    const scoreMelody =
      nextPhase !== "drill" ||
      drill?.kind === "vowel-phrase" ||
      drill?.kind === "slow-notes";
    engine?.setRecording(true, { tempoScale, scoreMelody });
    set({
      recording: true,
      summary: null,
      coach: {
        ...initialCoach,
        plan: get().coach.plan,
        focus: get().coach.focus,
        diagnosis: get().coach.diagnosis,
      },
      demoActive: false,
      liveFaults: [],
      liveDrillHint: null,
      lessonPhase: nextPhase,
    });
    if (nextPhase === "drill" && drill && (drill.kind === "hiss" || drill.kind === "siren")) {
      void playDrillCue(drill.kind);
    } else if (get().playAlong) {
      void playReferenceMelody(getCurrentSong(), nextPhase === "drill" && drill?.kind === "slow-notes" ? 0.5 : 1);
    }
  },

  finishTake: async () => {
    if (!engine) return;
    engine.setRecording(false);
    stopReferenceMelody();
    const phase = get().lessonPhase;
    const event: CoachEvent = phase === "drill" ? "drill" : phase === "recap" ? "recap" : "take";
    await get().analyzeTake(engine.getTake(), event);
  },

  skipDrill: async () => {
    const st = get();
    const drills = currentDrills(st);
    const drill = drills[st.drillIndex];
    if (!drill) return;
    const summary = st.summary ?? {
      song: { title: getCurrentSong().title, artist: getCurrentSong().artist },
      durationSec: 0,
      voicedRatio: 0,
      pitch: {
        meanAbsCents: 0,
        p95AbsCents: 0,
        inTuneRatio: 0,
        wrongNoteRatio: 0,
        tendency: "balanced" as const,
        scoredAgainstMelody: true,
        inTuneWindowCents: 50,
        heldNotes: 0,
      },
      breathSupport: { mean: 0 },
      vibrato: { rate: 0, extent: 0, present: false },
      timbre: { brightness: 0, harmonicBalanceDelta: 0, thinTone: false },
      worstMoments: [],
      sections: [],
      bodyFaults: [],
    };
    set({
      coach: { ...st.coach, streaming: true, text: "", tools: [], verdict: null },
      lessonPhase: "coaching",
    });
    await streamCoach(
      {
        event: "drill",
        summary,
        singerId: singerId(),
        sessionId: st.sessionId,
        drillId: drill.id,
        skip: true,
        nextDrillId: nextDrillId(st, st.drillIndex),
      },
      coachHandlers(set, get, "drill"),
    );
  },

  startRecap: () => {
    set({ lessonPhase: "recap" });
  },

  analyzeTake: async (frames, event) => {
    const summary = buildSummary(frames, getCurrentSong());
    if (!summary) {
      set({
        recording: false,
        coach: {
          ...get().coach,
          streaming: false,
          done: true,
          text: "I didn't catch enough singing to analyze. Try holding notes a bit longer.",
        },
      });
      return;
    }
    const st = get();
    const drill = currentDrills(st)[st.drillIndex];
    set({
      recording: false,
      summary,
      lessonPhase: "coaching",
      coach: {
        ...initialCoach,
        plan: event === "take" ? null : st.coach.plan,
        focus: st.coach.focus,
        diagnosis: event === "take" ? null : st.coach.diagnosis,
        streaming: true,
      },
    });

    await streamCoach(
      {
        event,
        summary,
        singerId: singerId(),
        sessionId: st.sessionId,
        drillId: event === "drill" ? drill?.id : null,
        nextDrillId: event === "drill" ? nextDrillId(st, st.drillIndex) : "",
      },
      coachHandlers(set, get, event),
    );
  },

  startDemo: () => {
    get().stopVerifyDemo();
    seekDemo(0);
    set({ demoActive: true, liveFaults: [], demoCaption: initialDemoCaption, lessonPhase: "demo" });
  },
  stopDemo: () => set({ demoActive: false, demoCaption: null, lessonPhase: get().listening ? "ready" : "demo" }),

  playVerifyDemo: () => {
    const song = getCurrentSong();
    get().stopDemo();
    stopVerifyPlayback();
    stopVocalAnalyze();
    stopReferenceMelody();
    engine?.setSuppressLive(true);
    set({
      verifyPlaying: true,
      demoActive: false,
      demoCaption: null,
      summary: null,
      liveFaults: [],
      coach: { ...initialCoach, plan: get().coach.plan, focus: get().coach.focus },
    });

    const finish = (frames: FeatureFrame[]) => {
      if (!get().verifyPlaying) return;
      engine?.setSuppressLive(false);
      set({ verifyPlaying: false });
      void get().analyzeTake(frames, "take");
    };

    let lastUi = 0;
    const onFrame = (frame: FeatureFrame) => {
      const now = performance.now();
      if (now - lastUi < 90) return;
      lastUi = now;
      set({ live: frame, cue: liveCue(frame) });
    };

    if (song.vocalUrl) {
      void playAndAnalyzeVocal({
        url: song.vocalUrl,
        detuneCents: 0,
        durationSec: song.vocalDuration ?? song.duration,
        onFrame,
        onDone: finish,
      }).catch((err) => {
        console.warn("[verify] vocal analyze failed", err);
        engine?.setSuppressLive(false);
        set({ verifyPlaying: false });
      });
      return;
    }

    const frames = buildVerifyFrames(song, "correct");
    void playReferenceMelody(song, 1, { voice: "sung" });
    runVerifyPlayback(frames, onFrame, () => finish(frames));
  },

  stopVerifyDemo: () => {
    stopVerifyPlayback();
    stopVocalAnalyze();
    stopReferenceMelody();
    engine?.setSuppressLive(false);
    liveFrame.current = emptyFrame();
    if (get().verifyPlaying) {
      set({ verifyPlaying: false, live: emptyFrame(), liveFaults: [] });
    }
  },
  setLiveFaults: (faults) => set({ liveFaults: faults }),
  setDemoCaption: (caption) => set({ demoCaption: caption }),

  downloadTeacherLog: () => {
    const st = get();
    const song = getCurrentSong();
    const lines = [
      `# LetsSingAI teacher log`,
      `Singer: ${singerId()}`,
      `Session: ${st.sessionId}`,
      `Phrase: ${song.title}`,
      `Focus: ${st.coach.focus}`,
      "",
      ...st.lessonLog,
      "",
      st.coach.text ? `## Latest notes\n\n${st.coach.text}` : "",
    ];
    const blob = new Blob([lines.filter(Boolean).join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `letssingai-${song.id}-session.md`;
    a.click();
    URL.revokeObjectURL(url);
  },

  refreshHealth: async () => {
    const health = await fetchHealth();
    set({ health });
    try {
      const res = await fetch(`${apiBase()}/progress/${encodeURIComponent(singerId())}`);
      if (res.ok) {
        const data = (await res.json()) as {
          history?: ProgressPoint[];
          last?: LastSession;
          lastFocus?: string;
        };
        set({
          progress: data.history ?? [],
          lastSession: data.last
            ? { ...data.last, focus: data.lastFocus ?? data.last.focus }
            : get().lastSession,
        });
      }
    } catch {
      /* optional */
    }
  },
}));

function coachHandlers(
  set: (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void,
  get: () => AppState,
  event: CoachEvent,
) {
  return {
    onToken: (text: string) =>
      set((s) => ({ coach: { ...s.coach, text: s.coach.text + text } })),
    onFocus: (focus: FocusTechnique) => set((s) => ({ coach: { ...s.coach, focus } })),
    onTool: (tool: AgentToolEvent) =>
      set((s) => ({ coach: { ...s.coach, tools: [...s.coach.tools, tool] } })),
    onPlan: (plan: PracticePlan) =>
      set((s) => ({
        coach: {
          ...s.coach,
          plan,
          focus: (plan.focus as FocusTechnique) || s.coach.focus,
        },
      })),
    onDiagnosis: (diagnosis: Diagnosis) =>
      set((s) => ({
        coach: {
          ...s.coach,
          diagnosis,
          focus: (diagnosis.focus as FocusTechnique) || s.coach.focus,
        },
      })),
    onVerdict: (verdict: DrillVerdict) => set((s) => ({ coach: { ...s.coach, verdict } })),
    onDone: (meta: { source: "agent" | "local" }) => {
      const s = get();
      const logLine =
        event === "take"
          ? `Take: ${s.summary?.pitch.meanAbsCents}¢, breath ${s.summary?.breathSupport.mean}, focus ${s.coach.focus}`
          : event === "drill"
            ? `Drill ${s.coach.verdict?.drillId}: ${s.coach.verdict?.result} — ${s.coach.verdict?.reason}`
            : `Recap: ${s.coach.text.slice(0, 180)}`;
      let lessonPhase: LessonPhase = s.lessonPhase;
      let drillIndex = s.drillIndex;
      if (event === "take" && (s.coach.plan?.drills.length ?? 0) > 0) {
        lessonPhase = "drill";
        drillIndex = 0;
      } else if (event === "drill") {
        const result = s.coach.verdict?.result;
        const drills = s.coach.plan?.drills ?? [];
        if (result === "retry") {
          lessonPhase = "drill";
        } else if (drillIndex + 1 < drills.length) {
          lessonPhase = "drill";
          drillIndex = drillIndex + 1;
        } else {
          lessonPhase = "recap";
        }
      } else if (event === "recap") {
        lessonPhase = "recap";
      }
      set({
        coach: { ...get().coach, streaming: false, done: true, source: meta.source },
        lessonPhase,
        drillIndex,
        lessonLog: [...s.lessonLog, logLine],
      });
      void get().refreshHealth();
    },
    onError: (message: string) =>
      set((s) => ({
        coach: {
          ...s.coach,
          streaming: false,
          done: true,
          text: s.coach.text + `\n\n_(${message})_`,
        },
      })),
  };
}

if (typeof window !== "undefined") {
  void useStore.getState().refreshHealth();
}

if (import.meta.env.DEV) {
  const g = globalThis as unknown as {
    __store?: typeof useStore;
    __simulateTake?: () => Promise<void>;
    __seekDemo?: (elapsed: number) => void;
    __demoSnap?: () => ReturnType<typeof demoSnapshot>;
  };
  g.__store = useStore;
  g.__simulateTake = () =>
    useStore.getState().analyzeTake(buildVerifyFrames(getCurrentSong(), "incorrect"), "take");
  g.__seekDemo = seekDemo;
  g.__demoSnap = () => demoSnapshot(peekDemoElapsed());
}
