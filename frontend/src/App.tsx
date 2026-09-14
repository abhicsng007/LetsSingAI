import { useEffect } from "react";
import { TopBar } from "./components/TopBar";
import { ViewTabs } from "./components/ViewTabs";
import { StageCanvas } from "./three/StageCanvas";
import { AnatomyOverlay } from "./components/AnatomyOverlay";
import { CoachPanel } from "./components/CoachPanel";
import { Controls } from "./components/Controls";
import { LiveReadout } from "./components/LiveReadout";
import { useStore } from "./state/store";

function ViewIdleChip() {
  const view = useStore((s) => s.view);
  const listening = useStore((s) => s.listening);
  const verifyPlaying = useStore((s) => s.verifyPlaying);
  if (verifyPlaying) {
    return (
      <div className="view-idle-chip verify">
        Demo voice
      </div>
    );
  }
  if (view === "anatomy" || listening) return null;
  return (
    <div className="view-idle-chip">
      {view === "pitch" ? "Start mic or play a demo" : "Start mic or play a demo"}
    </div>
  );
}

export default function App() {
  const expanded = useStore((s) => s.expanded);
  const setExpanded = useStore((s) => s.setExpanded);
  const songId = useStore((s) => s.songId);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, setExpanded]);

  return (
    <div className={`app ${expanded ? "is-expanded" : ""}`}>
      <TopBar />
      <div className="stage-row">
        <section className="stage">
          <ViewTabs />
          <div className="canvas-wrap">
            <StageCanvas />
            <AnatomyOverlay />
            <ViewIdleChip />
            <div className="disclaimer">
              Educational model — inferred from your voice's acoustics, not medical imaging.
              {songId === "twinkle" ? " Demo voice: D. Coetzee (CC0)." : ""}
            </div>
          </div>
        </section>
        <CoachPanel />
      </div>
      <div className="bottom-bar">
        <Controls />
        <LiveReadout />
      </div>
    </div>
  );
}
