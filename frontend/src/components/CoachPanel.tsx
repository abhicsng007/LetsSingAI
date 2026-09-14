import { useStore } from "../state/store";
import { LISTENER } from "../analysis/humanPitch";
import { FOCUS_LABELS } from "../coach/types";
import { Markdown } from "./Markdown";

const STEPS = ["Take", "Drill 1", "Drill 2", "Drill 3", "Recap"] as const;

export function CoachPanel() {
  const coach = useStore((s) => s.coach);
  const summary = useStore((s) => s.summary);
  const recording = useStore((s) => s.recording);
  const progress = useStore((s) => s.progress);
  const lastSession = useStore((s) => s.lastSession);
  const lessonPhase = useStore((s) => s.lessonPhase);
  const drillIndex = useStore((s) => s.drillIndex);
  const health = useStore((s) => s.health);
  const liveDrillHint = useStore((s) => s.liveDrillHint);
  const downloadTeacherLog = useStore((s) => s.downloadTeacherLog);
  const verifyPlaying = useStore((s) => s.verifyPlaying);

  const idle = !coach.streaming && !coach.done && !summary;
  const toolNames = collapseTools(coach.tools);
  const drills = coach.plan?.drills ?? [];
  const currentDrill = drills[drillIndex];
  const stepIndex = stepFor(lessonPhase, drillIndex, drills.length);
  const badge = badgeLabel(coach.source, health?.coach);

  return (
    <aside className="coach">
      <header className="coach-head">
        <div className="coach-title">
          <span className="dot" /> Lesson conductor
        </div>
        {badge && (
          <span className={`badge ${coach.source === "agent" || health?.coach === "bedrock-agent" ? "agent" : "local"}`}>
            {badge}
          </span>
        )}
      </header>

      <ol className="lesson-steps" aria-label="Lesson steps">
        {STEPS.map((label, i) => (
          <li key={label} className={stepClass(i, stepIndex, lessonPhase)}>
            <span className="lesson-step-n">{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      <div className="coach-scroll">
        {lastSession && (lastSession.meanAbsCents != null || lastSession.breathSupport != null) && (
          <div className="last-time">
            Last time
            {lastSession.song ? ` · ${lastSession.song}` : ""}:{" "}
            {lastSession.meanAbsCents != null ? `${lastSession.meanAbsCents}¢` : "—"}
            {lastSession.breathSupport != null ? ` · breath ${lastSession.breathSupport}` : ""}
            {lastSession.focus ? ` · focus ${lastSession.focus}` : ""}
          </div>
        )}

        {toolNames.length > 0 && (
          <div className="agent-loop" aria-label="Strands agent tool loop">
            <div className="agent-loop-head">Agent loop</div>
            <div className="agent-loop-chips">
              {toolNames.map((t) => (
                <span key={t.name} className={`tool-chip ${t.status}`}>
                  {t.status === "start" ? "⟳" : "✓"} {prettyTool(t.name)}
                </span>
              ))}
            </div>
          </div>
        )}

        {summary && (
          <div className="metrics">
            <Metric label="Pitch error" value={`${summary.pitch.meanAbsCents}¢`} good={summary.pitch.meanAbsCents < LISTENER.inTuneCents} />
            <Metric label="In tune" value={`${Math.round(summary.pitch.inTuneRatio * 100)}%`} good={summary.pitch.inTuneRatio > 0.5} />
            <Metric label="Right note" value={`${Math.round((1 - summary.pitch.wrongNoteRatio) * 100)}%`} good={summary.pitch.wrongNoteRatio < LISTENER.takeOffWrongRatio} />
            <Metric label="Breath" value={summary.breathSupport.mean.toFixed(2)} good={summary.breathSupport.mean > 0.55} />
          </div>
        )}

        {coach.focus !== "none" && (
          <div className="focus-chip">Focus: {FOCUS_LABELS[coach.focus] ?? coach.focus}</div>
        )}

        {currentDrill && (lessonPhase === "drill" || lessonPhase === "verdict" || lessonPhase === "coaching") && (
          <div className="drill-card">
            <div className="drill-card-head">
              Drill {drillIndex + 1}/{drills.length || 3} · {currentDrill.title}
            </div>
            <p>{currentDrill.instruction}</p>
            <div className="drill-pass">
              Pass if {currentDrill.pass.map((c) => `${c.metric} ${c.op} ${c.value}`).join(" and ")}
            </div>
            {recording && liveDrillHint && (
              <div className={`drill-hint ${liveDrillHint.close ? "ok" : "warn"}`}>
                {liveDrillHint.close ? "On track" : "Keep going"} — live check
              </div>
            )}
          </div>
        )}

        {coach.verdict && (
          <div className={`verdict-chip ${coach.verdict.result}`}>
            {coach.verdict.result.toUpperCase()}
            {coach.verdict.reason ? ` — ${shortReason(coach.verdict.reason)}` : ""}
          </div>
        )}

        {summary && summary.bodyFaults.length > 0 && (
          <div className="bodyfaults">
            <div className="bodyfaults-head">Body mechanics to fix</div>
            {summary.bodyFaults.map((f) => (
              <div key={f.part} className={`bodyfault ${f.severity > 0.6 ? "bad" : "warn"}`}>
                <div className="bodyfault-top">
                  <b>{f.label}</b>
                  <span className="bodyfault-pct">{Math.round(f.offRatio * 100)}% of the take</span>
                </div>
                <div className="bodyfault-fix">→ {f.correctMotion}</div>
              </div>
            ))}
          </div>
        )}

        <div className="coach-body">
          {verifyPlaying && (
            <p className="hint">
              Playing the <b>demo voice</b> through the same engine as the mic.
              Green = near a melody note. Red = more than about a semitone off.
            </p>
          )}
          {idle && !recording && !verifyPlaying && (
            <p className="hint">
              Not a singer? Use <b>Demo voice</b> to run a recording through the views.
              Or hear the phrase, start the mic, and sing a take.
            </p>
          )}
          {recording && (
            <p className="hint recording">
              ● {lessonPhase === "drill" ? "Listening to this drill…" : "Recording your take…"} sing, then press Stop.
            </p>
          )}
          {coach.streaming && coach.text === "" && (
            <p className="hint">
              <span className="spinner" /> {lessonPhase === "drill" ? "Reviewing the drill…" : "Running the lesson…"}
            </p>
          )}
          {coach.text && <Markdown text={coach.text} />}
          {lessonPhase === "recap" && (
            <button className="btn ghost log-btn" onClick={downloadTeacherLog}>
              Download teacher log
            </button>
          )}
          {progress.length > 0 && (
            <div className="progress-log">
              <div className="progress-log-head">Your sessions</div>
              {progress.slice(-5).map((p, i) => (
                <div key={p.at + i} className="progress-row">
                  <span>{formatWhen(p.at)}</span>
                  <span>{p.meanAbsCents != null ? `${p.meanAbsCents}¢` : "—"}</span>
                  <span>{p.breathSupport != null ? `breath ${p.breathSupport}` : ""}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function stepFor(phase: string, drillIndex: number, _drillCount: number): number {
  if (phase === "recap") return 4;
  if (phase === "drill" || phase === "verdict") return Math.min(3, 1 + drillIndex);
  return 0;
}

function stepClass(i: number, current: number, phase: string): string {
  if (phase === "coaching" && i === current) return "on";
  if (i < current) return "done";
  if (i === current) return "on";
  return "";
}

function badgeLabel(source: "agent" | "local" | null, healthCoach?: string): string | null {
  if (source === "agent") return "Strands · Bedrock";
  if (source === "local") return "offline heuristic";
  if (healthCoach === "bedrock-agent") return "Strands · Bedrock";
  if (healthCoach === "heuristic") return "offline heuristic";
  return null;
}

function collapseTools(tools: { name: string; status: "start" | "done" }[]) {
  const last = new Map<string, "start" | "done">();
  for (const t of tools) last.set(t.name, t.status);
  return [...last.entries()].map(([name, status]) => ({ name, status }));
}

function prettyTool(name: string): string {
  return name.replace(/_/g, " ");
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function shortReason(reason: string): string {
  return reason.length > 90 ? `${reason.slice(0, 87)}…` : reason;
}

function Metric({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className={`metric ${good ? "ok" : "warn"}`}>
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
}
