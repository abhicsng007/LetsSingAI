import { useStore } from "../state/store";

export function Controls() {
  const listening = useStore((s) => s.listening);
  const recording = useStore((s) => s.recording);
  const micError = useStore((s) => s.micError);
  const demoActive = useStore((s) => s.demoActive);
  const start = useStore((s) => s.start);
  const stop = useStore((s) => s.stop);
  const startTake = useStore((s) => s.startTake);
  const finishTake = useStore((s) => s.finishTake);
  const startDemo = useStore((s) => s.startDemo);
  const stopDemo = useStore((s) => s.stopDemo);
  const playAlong = useStore((s) => s.playAlong);
  const setPlayAlong = useStore((s) => s.setPlayAlong);
  const playPhrase = useStore((s) => s.playPhrase);
  const lessonPhase = useStore((s) => s.lessonPhase);
  const skipDrill = useStore((s) => s.skipDrill);
  const streaming = useStore((s) => s.coach.streaming);
  const view = useStore((s) => s.view);
  const verifyPlaying = useStore((s) => s.verifyPlaying);
  const playVerifyDemo = useStore((s) => s.playVerifyDemo);
  const stopVerifyDemo = useStore((s) => s.stopVerifyDemo);

  const primaryLabel =
    lessonPhase === "drill"
      ? "● Sing this drill"
      : lessonPhase === "recap"
        ? "● Re-sing the phrase"
        : "● Sing a take";

  const busy = recording || !!verifyPlaying || streaming;

  return (
    <div className="controls">
      {!listening && !verifyPlaying && (
        <button className="btn primary" onClick={() => void start()}>
          🎤 Start mic
        </button>
      )}
      {listening && !recording && !verifyPlaying && (
        <>
          <button className="btn primary" onClick={startTake} disabled={streaming}>
            {primaryLabel}
          </button>
          {lessonPhase === "drill" && (
            <button className="btn ghost" onClick={() => void skipDrill()} disabled={streaming}>
              Skip drill
            </button>
          )}
          <button className="btn ghost" onClick={stop}>
            Stop mic
          </button>
        </>
      )}
      {listening && recording && (
        <button className="btn record" onClick={() => void finishTake()}>
          ■ Stop &amp; analyze
        </button>
      )}
      {!recording && view === "anatomy" && !verifyPlaying && (
        <button
          className={`btn ${demoActive ? "demo-on" : "ghost"}`}
          onClick={demoActive ? stopDemo : startDemo}
          title="Play the correct singing technique as a 3D simulation"
        >
          {demoActive ? "■ Stop demo" : "▶ Show correct technique"}
        </button>
      )}
      {!recording && (
        verifyPlaying ? (
          <button className="btn record" onClick={stopVerifyDemo}>
            ■ Stop demo voice
          </button>
        ) : (
          <button
            className="btn ghost"
            disabled={busy}
            onClick={() => playVerifyDemo()}
            title="Play a real sung recording through the same analysis as the mic"
          >
            ▶ Demo voice
          </button>
        )
      )}
      <button
        className="btn ghost"
        onClick={() => void playPhrase()}
        title="Hear the public-domain reference melody"
        disabled={!!verifyPlaying}
      >
        ▶ Hear phrase
      </button>
      <label className="playalong">
        <input
          type="checkbox"
          checked={playAlong}
          onChange={(e) => setPlayAlong(e.target.checked)}
          disabled={!!verifyPlaying}
        />
        Play along
      </label>
      {micError && <span className="mic-error">⚠ {micError}</span>}
    </div>
  );
}
