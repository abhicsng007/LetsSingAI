// 2D top-down (looking into the larynx) view of the vocal folds, drawn in a
// callout box with a leader line to the glottis on the 3D figure.

import { useEffect, useRef } from "react";
import { poseBus } from "../anatomy/poseBus";
import { glottisOpen } from "../anatomy/pose";
import type { AnatomyPose } from "../anatomy/pose";

const CSS_W = 168;
const CSS_H = 178;

function foldColor(p: AnatomyPose): string {
  const h = Math.round(p.hue * 360);
  const l = Math.round(46 + p.voiced * 14);
  return `hsl(${h} 74% ${l}%)`;
}

function drawTopView(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  p: AnatomyPose,
  phase: number,
) {
  ctx.clearRect(0, 0, w, h);

  const cx = w * 0.5;
  const cy = h * 0.54;
  const s = w / CSS_W;
  const open = glottisOpen(p, phase);
  const len = (62 + p.pitchN * 20) * s;
  const halfW = (8.5 - p.pitchN * 3.2) * s;
  const gap = (5 + open * 36) * s;
  const wave = p.voiced * Math.sin(phase) * 2.4 * s;

  // Larynx tube, looking down from above.
  ctx.fillStyle = "#4a242c";
  ctx.beginPath();
  ctx.ellipse(cx, cy, 62 * s, 74 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#16080c";
  ctx.beginPath();
  ctx.ellipse(cx, cy, 48 * s, 60 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  const antX = cx;
  const antY = cy - len * 0.46;
  const postY = cy + len * 0.46;
  const midY = (antY + postY) * 0.5;
  const col = foldColor(p);

  const drawFold = (side: number) => {
    const postX = cx + side * gap * 0.5;
    const midX = cx + side * (gap * 0.32 + wave * side);
    const lat = side * (halfW + 10 * s);
    ctx.beginPath();
    ctx.moveTo(antX + side * 1.2 * s, antY);
    ctx.quadraticCurveTo(midX, midY - 10 * s, postX, postY);
    ctx.lineTo(postX + lat, postY - 2 * s);
    ctx.quadraticCurveTo(midX + lat, midY + 8 * s, antX + lat * 0.4, antY + 5 * s);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,220,230,0.35)";
    ctx.lineWidth = 1.1 * s;
    ctx.stroke();

    // Arytenoid at the posterior end.
    ctx.beginPath();
    ctx.arc(postX + side * 4.5 * s, postY + 2 * s, 5.2 * s, 0, Math.PI * 2);
    ctx.fillStyle = "#e4d2b4";
    ctx.fill();
  };

  drawFold(-1);
  drawFold(1);

  // Anterior commissure tick.
  ctx.fillStyle = "#f4f7ff";
  ctx.beginPath();
  ctx.arc(antX, antY - 1 * s, 2.2 * s, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(232,237,247,0.85)";
  ctx.font = `600 ${11 * s}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("FRONT", cx, 16 * s);
  ctx.fillText("BACK", cx, h - 8 * s);
}

function stateLabel(p: AnatomyPose): string {
  if (p.voiced > 0.45) return "Vibrating";
  if (p.airflow > 0.2) return "Open — breath";
  return "Resting open";
}

export function VocalCordsCallout() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<SVGLineElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  const stateRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const tick = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = CSS_W;
      const cssH = CSS_H;
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawTopView(ctx, cssW, cssH, poseBus.you, poseBus.glot);
      if (stateRef.current) stateRef.current.textContent = stateLabel(poseBus.you);

      const box = boxRef.current;
      const line = lineRef.current;
      const dot = dotRef.current;
      const overlay = box?.closest(".anat-overlay") as HTMLElement | null;
      if (box && line && dot && overlay) {
        const ow = overlay.clientWidth;
        const oh = overlay.clientHeight;
        const br = box.getBoundingClientRect();
        const or = overlay.getBoundingClientRect();
        const left = br.left - or.left;
        const right = br.right - or.left;
        const y1 = br.top - or.top + br.height * 0.42;
        const x2 = poseBus.nx * ow;
        const y2 = poseBus.ny * oh;
        const x1 = Math.abs(x2 - left) < Math.abs(x2 - right) ? left : right;
        const on = x2 >= 8 && x2 <= ow - 8 && y2 >= 8 && y2 <= oh - 8;
        line.setAttribute("x1", String(x1));
        line.setAttribute("y1", String(y1));
        line.setAttribute("x2", String(x2));
        line.setAttribute("y2", String(y2));
        line.style.opacity = on ? "1" : "0";
        dot.setAttribute("cx", String(x2));
        dot.setAttribute("cy", String(y2));
        dot.style.opacity = on ? "1" : "0";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <>
      <svg className="glottis-leader" aria-hidden="true">
        <line ref={lineRef} className="glottis-leader-line" />
        <circle ref={dotRef} r="4.5" className="glottis-leader-dot" />
      </svg>
      <div ref={boxRef} className="glottis-inset" aria-label="Vocal cords, top view">
        <div className="glottis-inset-head">
          Vocal cords
          <span>Top view</span>
        </div>
        <canvas ref={canvasRef} width={CSS_W} height={CSS_H} />
        <div className="glottis-inset-foot">
          <span ref={stateRef}>Resting open</span>
        </div>
      </div>
    </>
  );
}
