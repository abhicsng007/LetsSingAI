// DOM overlay on the 3D canvas: expand control, plus anatomy mode chip,
// watch-outs, demo caption, and legend. Compact mode keeps copy off the
// figure; expanded mode docks it in a side panel.

import { useStore } from "../state/store";
import { VocalCordsCallout } from "./VocalCordsCallout";

export function AnatomyOverlay() {
  const view = useStore((s) => s.view);
  const recording = useStore((s) => s.recording);
  const verifyPlaying = useStore((s) => s.verifyPlaying);
  const listening = useStore((s) => s.listening);
  const demoActive = useStore((s) => s.demoActive);
  const demoCaption = useStore((s) => s.demoCaption);
  const liveFaults = useStore((s) => s.liveFaults);
  const expanded = useStore((s) => s.expanded);
  const setExpanded = useStore((s) => s.setExpanded);

  const comparing = recording || !!verifyPlaying;
  const mode = comparing
    ? {
        icon: "◎",
        text: verifyPlaying ? "Demo voice" : "Comparing you vs target",
      }
    : demoActive
      ? {
          icon: "▶",
          text: demoCaption
            ? `Correct-technique demo · ${demoCaption.step}/${demoCaption.steps}`
            : "Correct-technique demo",
        }
      : listening
        ? { icon: "●", text: "Live — your voice" }
        : null;

  const expandBtn = (
    <button
      type="button"
      className="expand-btn"
      onClick={() => setExpanded(!expanded)}
      title={expanded ? "Exit expanded view (Esc)" : "Expand stage — more room for the figure"}
    >
      {expanded ? "✕ Close" : "⛶ Expand"}
    </button>
  );

  if (view !== "anatomy") {
    return <div className="anat-overlay">{expandBtn}</div>;
  }

  const modeChip = mode && (
    <div className={`anat-mode ${comparing ? "rec" : demoActive ? "demo" : "live"}`}>
      <span className="anat-mode-icon">{mode.icon}</span> {mode.text}
    </div>
  );

  const watchouts = comparing && liveFaults.length > 0 && (
    <div className="watchouts">
      {liveFaults.map((f) => (
        <div key={f.part} className={`watchout ${f.severity > 0.6 ? "bad" : "warn"}`}>
          <b>{f.label}</b>
          <span>{f.cue}</span>
        </div>
      ))}
    </div>
  );

  const balanced = comparing && !verifyPlaying && liveFaults.length === 0 && (
    <div className="watchout good">
      <b>Nicely balanced</b>
      <span>Every part is tracking the target — keep it there.</span>
    </div>
  );

  const legend = comparing && (
    <div className="anat-legend">
      <span className="lg you">● You</span>
      <span className="lg target">○ Target</span>
    </div>
  );

  const caption = demoActive && demoCaption && (
    <div className="demo-caption">
      <div className="demo-steps" aria-hidden="true">
        {Array.from({ length: demoCaption.steps }, (_, i) => (
          <span
            key={i}
            className={`demo-step-dot ${i + 1 === demoCaption.step ? "on" : i + 1 < demoCaption.step ? "done" : ""}`}
          />
        ))}
      </div>
      <div className="demo-caption-title">{demoCaption.title}</div>
      {demoCaption.beat && <div className="demo-caption-beat">{demoCaption.beat}</div>}
      <div className="demo-caption-body">{demoCaption.body}</div>
      <div className="demo-phase-bar" title={`Step ${demoCaption.step} of ${demoCaption.steps}`}>
        <i style={{ width: `${Math.round(demoCaption.progress * 100)}%` }} />
      </div>
      <div className="demo-caption-foot">Press <b>Start mic</b> when you're ready to try it.</div>
    </div>
  );

  return (
    <div className={`anat-overlay ${expanded ? "docked" : "compact"}`}>
      {expandBtn}

      {expanded ? (
        <aside className="anat-dock">
          <div className="anat-dock-head">Anatomy</div>
          {modeChip}
          {legend}
          {watchouts}
          {balanced}
          {caption}
          <p className="anat-dock-note">
            Drag to orbit. Part labels are on the figure here. Esc closes.
          </p>
        </aside>
      ) : (
        <>
          <div className="anat-topleft">
            {modeChip}
            {watchouts}
            {balanced}
            {caption}
          </div>
          {legend}
        </>
      )}

      <VocalCordsCallout />
    </div>
  );
}
