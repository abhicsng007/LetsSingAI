import { useStore } from "../state/store";
import type { ViewId } from "../state/store";

const TABS: { id: ViewId; label: string; caption: string }[] = [
  { id: "anatomy", label: "🫁 Anatomy", caption: "Drag to orbit. Expand for a full-stage view with labels. Acoustically inferred — not medical imaging." },
  { id: "harmonics", label: "📊 Harmonics", caption: "Front bars = your overtones. Wireframe = reference. Thin tone → weak H2–H3." },
  { id: "pitch", label: "🎯 Pitch", caption: "Trail = your pitch. Teal dot = melody note. Green = in tune on the right note." },
];

export function ViewTabs() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const active = TABS.find((t) => t.id === view)!;

  return (
    <div className="viewtabs-wrap">
      <div className="viewtabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${view === t.id ? "active" : ""}`}
            onClick={() => setView(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="view-caption">{active.caption}</p>
    </div>
  );
}
