import { useStore } from "../state/store";
import { LISTENER, pitchBandColor, pitchNeedlePercent } from "../analysis/humanPitch";

function Bar({ label, value, hue }: { label: string; value: number; hue: number }) {
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <div className="bar-track">
        <div
          className="bar-fill"
          style={{ width: `${Math.round(Math.min(1, value) * 100)}%`, background: `hsl(${hue} 80% 55%)` }}
        />
      </div>
    </div>
  );
}

export function LiveReadout() {
  const live = useStore((s) => s.live);
  const cue = useStore((s) => s.cue);
  const listening = useStore((s) => s.listening);

  const cents = live.hasPitch ? (live.melodyCents ?? live.cents) : 0;
  const needle = pitchNeedlePercent(cents);
  const goodLo = 50 - (LISTENER.inTuneCents / LISTENER.meterSpanCents) * 50;
  const goodWidth = (LISTENER.inTuneCents / LISTENER.meterSpanCents) * 100;

  return (
    <div className="readout">
      <div className="note-block">
        <div className="note-name">{live.hasPitch ? live.note : "--"}</div>
        <div className="note-hz">
          {live.hasPitch
            ? `${live.f0.toFixed(1)} Hz${live.targetNote ? ` → ${live.targetNote}` : ""}`
            : listening
              ? "listening…"
              : "mic off"}
        </div>
      </div>

      <div className="cents-meter">
        <div className="cents-scale">
          <span>-1 st</span>
          <span>in tune</span>
          <span>+1 st</span>
        </div>
        <div className="cents-track">
          <div
            className="cents-good"
            style={{ left: `${goodLo}%`, width: `${goodWidth}%` }}
          />
          <div className="cents-center" />
          {live.hasPitch && (
            <div
              className="cents-needle"
              style={{
                left: `${needle}%`,
                background: pitchBandColor(cents),
              }}
            />
          )}
        </div>
      </div>

      <div className="bars">
        <Bar label="Loudness" value={live.rms} hue={200} />
        <Bar label="Breath" value={live.breathSupport} hue={150} />
        <Bar label="Brightness" value={live.brightness} hue={45} />
      </div>

      <div className={`cue cue-${cue.tone}`} title={cue.text}>{cue.text}</div>
    </div>
  );
}
