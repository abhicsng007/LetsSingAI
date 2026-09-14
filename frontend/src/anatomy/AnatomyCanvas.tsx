// Real-time sagittal (side-profile) model of the singing instrument, drawn on
// a 2D canvas. One connected airway carries animated airflow from the lungs
// through the glottis and into the mouth/nose; glottal vibration launches sound
// pulses that light up the chest / mouth / head resonance zones. Tongue, jaw,
// lips and velum reshape from the live formants.
//
// This is an acoustically-inferred educational model, not medical imaging.

import { useEffect, useRef } from "react";
import { liveFrame } from "../audio/featureBus";
import { useStore } from "../state/store";
import type { FocusTechnique } from "../coach/types";
import { clamp, damp, mapRange } from "../three/smooth";
import * as G from "./geometry";
import type { Pt } from "./geometry";
import { buildRoute, pointAt } from "./route";

const ORAL_ROUTE = buildRoute([...G.AIRWAY_BASE, ...G.AIRWAY_ORAL]);
const NASAL_ROUTE = buildRoute([...G.AIRWAY_BASE, ...G.AIRWAY_NASAL]);
const GLOTTIS_DIST = buildRoute(G.AIRWAY_BASE.slice(0, 6)).length;

interface Particle {
  nasal: boolean;
  dist: number;
  off: number; // perpendicular offset
  size: number;
}
interface Pulse {
  nasal: boolean;
  dist: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function smoothClosed(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  const n = pts.length;
  ctx.beginPath();
  ctx.moveTo((pts[0][0] + pts[n - 1][0]) / 2, (pts[0][1] + pts[n - 1][1]) / 2);
  for (let i = 0; i < n; i++) {
    const c = pts[i];
    const nx = pts[(i + 1) % n];
    ctx.quadraticCurveTo(c[0], c[1], (c[0] + nx[0]) / 2, (c[1] + nx[1]) / 2);
  }
  ctx.closePath();
}

function smoothOpen(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const c = pts[i];
    const nx = pts[i + 1];
    ctx.quadraticCurveTo(c[0], c[1], (c[0] + nx[0]) / 2, (c[1] + nx[1]) / 2);
  }
  ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, a: number) {
  if (a <= 0.001) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "transparent");
  ctx.globalAlpha = a;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function classifyVowel(hi: number, front: number): string {
  if (hi > 0.6 && front > 0.6) return "/i/ (ee)";
  if (hi > 0.6 && front < 0.4) return "/u/ (oo)";
  if (hi < 0.4) return front > 0.5 ? "/a/ (ah)" : "/ɔ/ (aw)";
  return front > 0.5 ? "/e/ (eh)" : "/o/ (oh)";
}

interface Anim {
  breath: number;
  airflow: number;
  pressure: number;
  pitchN: number;
  hi: number;
  front: number;
  jaw: number;
  round: number;
  bright: number;
  nasal: number;
  voiced: number;
  hue: number;
  chest: number;
  mouth: number;
  head: number;
  glotPhase: number;
  spawnAcc: number;
  pulseAcc: number;
  idle: number;
  t: number;
  particles: Particle[];
  pulses: Pulse[];
}

export function AnatomyCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const focus = useStore((s) => s.coach.focus);
  const focusRef = useRef<FocusTechnique>(focus);
  focusRef.current = focus;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let scale = 1;
    let ox = 0;
    let oy = 0;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      scale = Math.min(w / G.MODEL_W, h / G.MODEL_H) * 0.98;
      ox = (w - G.MODEL_W * scale) / 2;
      oy = (h - G.MODEL_H * scale) / 2;
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    const a: Anim = {
      breath: 0.3, airflow: 0, pressure: 0.3, pitchN: 0.5, hi: 0.4, front: 0.5,
      jaw: 0.2, round: 0.3, bright: 0.3, nasal: 0.1, voiced: 0, hue: 0.5,
      chest: 0, mouth: 0, head: 0, glotPhase: 0, spawnAcc: 0, pulseAcc: 0,
      idle: 0, t: 0, particles: [], pulses: [],
    };

    let last = performance.now();

    const update = (dt: number) => {
      const f = liveFrame.current;
      a.t += dt;
      a.idle += dt;
      const voicedT = f.hasPitch ? 1 : 0;
      const breathing = !f.hasPitch && f.rms > 0.03;
      const idleBreath = 0.32 + Math.sin(a.idle * 0.9) * 0.12;

      const airflowT = f.hasPitch ? clamp(f.rms * 1.1 + 0.15, 0, 1) : breathing ? clamp(f.rms, 0, 0.7) : 0.04;
      const breathT = f.hasPitch ? Math.max(f.breathSupport, 0.25) : idleBreath;
      const pressureT = f.hasPitch ? f.breathSupport : breathing ? f.rms * 0.5 : 0.12;

      a.voiced = damp(a.voiced, voicedT, 10, dt);
      a.airflow = damp(a.airflow, airflowT, 8, dt);
      a.breath = damp(a.breath, breathT, 4, dt);
      a.pressure = damp(a.pressure, pressureT, 5, dt);
      a.bright = damp(a.bright, f.hasPitch ? f.brightness : a.bright, 5, dt);

      if (f.hasPitch) {
        a.pitchN = damp(a.pitchN, clamp(mapRange(f.midi, 48, 74, 0, 1), 0, 1), 6, dt);
        a.hi = damp(a.hi, mapRange(f.formants[0], 300, 850, 1, 0), 5, dt);
        a.front = damp(a.front, mapRange(f.formants[1], 900, 2200, 0, 1), 5, dt);
        a.jaw = damp(a.jaw, mapRange(f.formants[0], 300, 850, 0.12, 1), 5, dt);
        a.round = damp(a.round, mapRange(f.formants[1], 900, 1600, 1, 0), 5, dt);
        a.hue = damp(a.hue, mapRange(f.midi, 48, 74, 0.6, 0.02), 6, dt);
      } else {
        a.jaw = damp(a.jaw, breathing ? 0.35 : 0.15, 4, dt);
      }
      // velum: mostly closed while singing; opens for nasal breathing
      a.nasal = damp(a.nasal, f.hasPitch ? 0.06 : breathing ? 0.6 : 0.15, 4, dt);

      // resonance zones
      const chestT = a.voiced * clamp(1 - a.pitchN, 0, 1);
      const mouthT = a.voiced * clamp(1 - Math.abs(a.pitchN - 0.5) * 1.7, 0, 1) * (0.5 + 0.5 * a.bright);
      const headT = a.voiced * clamp(a.pitchN, 0, 1) * (0.5 + 0.5 * a.bright);
      a.chest = damp(a.chest, chestT, 5, dt);
      a.mouth = damp(a.mouth, mouthT, 5, dt);
      a.head = damp(a.head, headT, 5, dt);

      // glottal flutter (visual scale of the real vibration)
      const flutter = mapRange(a.pitchN, 0, 1, 7, 15);
      a.glotPhase += dt * flutter * Math.PI * 2;

      // spawn airflow particles
      a.spawnAcc += dt * (10 + a.airflow * 60);
      while (a.spawnAcc >= 1) {
        a.spawnAcc -= 1;
        if (a.particles.length < 320) {
          a.particles.push({
            nasal: Math.random() < a.nasal,
            dist: Math.random() * 20,
            off: (Math.random() - 0.5) * 10,
            size: 1.4 + Math.random() * 2.2,
          });
        }
      }
      const speed = 240 + a.airflow * 1150;
      for (const p of a.particles) p.dist += speed * dt;
      a.particles = a.particles.filter(
        (p) => p.dist < (p.nasal ? NASAL_ROUTE : ORAL_ROUTE).length,
      );

      // sound pulses from the glottis
      if (a.voiced > 0.4) {
        a.pulseAcc += dt;
        const interval = mapRange(a.pitchN, 0, 1, 0.17, 0.07);
        if (a.pulseAcc >= interval) {
          a.pulseAcc = 0;
          a.pulses.push({ nasal: false, dist: GLOTTIS_DIST });
          if (a.nasal > 0.4) a.pulses.push({ nasal: true, dist: GLOTTIS_DIST });
        }
      }
      for (const p of a.pulses) p.dist += 1500 * dt;
      a.pulses = a.pulses.filter(
        (p) => p.dist < (p.nasal ? NASAL_ROUTE : ORAL_ROUTE).length,
      );
    };

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // backdrop
      const bg = ctx.createRadialGradient(
        (ox + G.MODEL_W * scale * 0.6),
        oy + G.MODEL_H * scale * 0.3,
        20,
        ox + G.MODEL_W * scale * 0.5,
        oy + G.MODEL_H * scale * 0.5,
        G.MODEL_W * scale,
      );
      bg.addColorStop(0, "#131c30");
      bg.addColorStop(1, "#0a0e1a");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.setTransform(scale * dpr, 0, 0, scale * dpr, ox * dpr, oy * dpr);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      drawBody();
      drawChest();
      drawCavities();
      drawTongueJawLips();
      drawLarynx();
      drawOverlays();
      drawLabels();
    };

    const drawBody = () => {
      const grad = ctx.createLinearGradient(300, 60, 900, 760);
      grad.addColorStop(0, "#f0c4ad");
      grad.addColorStop(1, "#c98d76");
      smoothClosed(ctx, G.BODY);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = "rgba(120,70,55,0.5)";
      ctx.lineWidth = 3;
      ctx.stroke();
      // soft inner shading
      ctx.save();
      smoothClosed(ctx, G.BODY);
      ctx.clip();
      glow(ctx, 500, 400, 520, "#8a4a38", 0.18);
      ctx.restore();
    };

    const drawChest = () => {
      ctx.save();
      smoothClosed(ctx, G.BODY);
      ctx.clip();

      // lungs (breathe)
      const s = 0.9 + a.breath * 0.22;
      ctx.save();
      ctx.translate(G.ZONE_CHEST[0], 600);
      ctx.scale(s, s);
      ctx.translate(-G.ZONE_CHEST[0], -600);
      const lg = ctx.createLinearGradient(300, 480, 560, 700);
      lg.addColorStop(0, "#d98a8a");
      lg.addColorStop(1, "#b25f68");
      smoothClosed(ctx, G.LUNG);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = lg;
      ctx.fill();
      ctx.globalAlpha = 1;
      // bronchi
      ctx.strokeStyle = "rgba(120,50,55,0.5)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(534, 520);
      ctx.quadraticCurveTo(470, 560, 400, 590);
      ctx.moveTo(520, 560);
      ctx.quadraticCurveTo(450, 610, 380, 650);
      ctx.stroke();
      ctx.restore();

      // ribs
      ctx.strokeStyle = "rgba(240,232,210,0.35)";
      ctx.lineWidth = 7;
      for (const r of G.RIBS) {
        ctx.beginPath();
        ctx.ellipse(r.x, r.y, r.w, r.h, 0, Math.PI * 1.15, Math.PI * 1.95);
        ctx.stroke();
      }

      // diaphragm dome (lower when supported/engaged)
      const dy = 704 + (1 - a.breath) * 10;
      ctx.strokeStyle = "#b5545f";
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(300, dy - 8);
      ctx.quadraticCurveTo(430, dy + 34, 560, dy - 8);
      ctx.stroke();

      // trachea
      const tg = ctx.createLinearGradient(500, 490, 500, 616);
      tg.addColorStop(0, "#caa6ad");
      tg.addColorStop(1, "#a87f88");
      smoothClosed(ctx, G.TRACHEA);
      ctx.fillStyle = tg;
      ctx.fill();
      // cartilage rings
      ctx.strokeStyle = "rgba(90,50,60,0.4)";
      ctx.lineWidth = 2.5;
      for (let y = 508; y < 610; y += 16) {
        ctx.beginPath();
        ctx.moveTo(508, y);
        ctx.lineTo(554, y);
        ctx.stroke();
      }
      ctx.restore();

      // subglottal pressure gauge
      const px = 476;
      ctx.fillStyle = "rgba(10,16,28,0.6)";
      ctx.fillRect(px, 470, 12, 150);
      const ph = a.pressure * 150;
      const pcol = a.pressure > 0.6 ? "#34d399" : a.pressure > 0.35 ? "#fbbf24" : "#f87171";
      ctx.fillStyle = pcol;
      ctx.fillRect(px, 620 - ph, 12, ph);
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px, 470, 12, 150);
    };

    const drawCavities = () => {
      ctx.save();
      smoothClosed(ctx, G.BODY);
      ctx.clip();

      const airFill = "#25121a";
      // pharynx
      smoothClosed(ctx, G.PHARYNX);
      ctx.fillStyle = airFill;
      ctx.fill();
      // nasal cavity
      smoothClosed(ctx, G.NASAL);
      ctx.fillStyle = airFill;
      ctx.fill();
      // head-resonance tint inside nasal
      ctx.save();
      smoothClosed(ctx, G.NASAL);
      ctx.clip();
      glow(ctx, G.ZONE_HEAD[0], G.ZONE_HEAD[1] + 40, 160, "#b98cff", a.head * 0.7);
      ctx.restore();
      // turbinates
      ctx.strokeStyle = "rgba(180,120,120,0.4)";
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(690 + i * 42, 230);
        ctx.quadraticCurveTo(700 + i * 42, 246, 690 + i * 42, 252);
        ctx.stroke();
      }

      // oral cavity
      smoothClosed(ctx, G.ORAL);
      ctx.fillStyle = airFill;
      ctx.fill();

      // hard palate bone
      smoothClosed(ctx, G.HARD_PALATE);
      ctx.fillStyle = "#efe4cf";
      ctx.fill();
      ctx.restore();
    };

    const drawTongueJawLips = () => {
      ctx.save();
      smoothClosed(ctx, G.BODY);
      ctx.clip();

      // velum (soft palate)
      const vtx = lerp(644, 628, a.nasal);
      const vty = lerp(298, 344, a.nasal);
      ctx.beginPath();
      ctx.moveTo(604, 274);
      ctx.quadraticCurveTo(624, 286, vtx, vty);
      ctx.quadraticCurveTo(614, 300, 600, 288);
      ctx.closePath();
      ctx.fillStyle = "#d98a94";
      ctx.fill();

      // tongue (morphs with vowel)
      const apexX = lerp(632, 792, a.front);
      const apexY = lerp(356, 292, a.hi);
      const tipX = lerp(772, 834, a.front);
      const tipY = lerp(360, 322, a.hi);
      const tongue: Pt[] = [
        [548, 466], [566, 406], [596, 360], [apexX, apexY], [tipX, tipY],
        [852, 372], [740, 400], [636, 412], [560, 432],
      ];
      const tg = ctx.createLinearGradient(560, 300, 700, 440);
      tg.addColorStop(0, "#d67a75");
      tg.addColorStop(1, "#a83f47");
      smoothClosed(ctx, tongue);
      ctx.fillStyle = tg;
      ctx.fill();
      ctx.strokeStyle = "rgba(120,40,50,0.4)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // upper teeth + upper lip (fixed)
      ctx.fillStyle = "#f4ecdc";
      ctx.fillRect(862, 300, 14, 16);
      ctx.fillStyle = "#c66a6a";
      ctx.beginPath();
      ctx.ellipse(886, 314, 12, 9, 0, 0, Math.PI * 2);
      ctx.fill();

      // lower jaw group rotates open around the hinge
      ctx.save();
      ctx.translate(G.JAW_HINGE[0], G.JAW_HINGE[1]);
      ctx.rotate(a.jaw * 0.22);
      ctx.translate(-G.JAW_HINGE[0], -G.JAW_HINGE[1]);
      // mandible bone
      ctx.strokeStyle = "#e7dcc4";
      ctx.lineWidth = 16;
      smoothOpen(ctx, [
        [462, 358], [474, 452], [560, 492], [690, 500], [812, 470], [878, 442],
      ]);
      ctx.stroke();
      // lower teeth
      ctx.fillStyle = "#f4ecdc";
      ctx.fillRect(858, 344, 14, 16);
      // lower lip
      ctx.fillStyle = "#bd5f60";
      ctx.beginPath();
      ctx.ellipse(884, 352, 13, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.restore();
    };

    const drawLarynx = () => {
      ctx.save();
      smoothClosed(ctx, G.BODY);
      ctx.clip();
      // epiglottis
      ctx.strokeStyle = "#cf9aa2";
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(576, 452);
      ctx.quadraticCurveTo(590, 470, 572, 486);
      ctx.stroke();

      // larynx box
      ctx.fillStyle = "#9c5c68";
      ctx.beginPath();
      ctx.ellipse(534, 486, 26, 22, 0, 0, Math.PI * 2);
      ctx.fill();

      // vocal folds vibrating (gap opens/closes; colour by pitch)
      const gap = a.voiced * (0.5 + 0.5 * Math.sin(a.glotPhase)) * 6 + 0.5;
      const col = `hsl(${a.hue * 360} 75% 60%)`;
      ctx.fillStyle = col;
      ctx.strokeStyle = col;
      ctx.beginPath();
      ctx.moveTo(520, 474);
      ctx.lineTo(534 - gap, 486);
      ctx.lineTo(520, 498);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(548, 474);
      ctx.lineTo(534 + gap, 486);
      ctx.lineTo(548, 498);
      ctx.closePath();
      ctx.fill();
      if (a.voiced > 0.3) glow(ctx, 534, 486, 34, col, a.voiced * 0.5);
      ctx.restore();
    };

    const drawOverlays = () => {
      ctx.save();
      smoothClosed(ctx, G.BODY);
      ctx.clip();
      ctx.globalCompositeOperation = "lighter";

      // resonance zone glows (where the "voice is placed")
      glow(ctx, G.ZONE_CHEST[0], G.ZONE_CHEST[1], 235, "#ff8a5a", a.chest * 0.6);
      glow(ctx, G.ZONE_MOUTH[0], G.ZONE_MOUTH[1], 170, "#63c8ff", a.mouth * 0.7);
      glow(ctx, G.ZONE_HEAD[0], G.ZONE_HEAD[1], 165, "#b98cff", a.head * 0.72);

      // airflow particles (short streaks along the airway)
      for (const p of a.particles) {
        const route = p.nasal ? NASAL_ROUTE : ORAL_ROUTE;
        const pt = pointAt(route, p.dist);
        const nx = Math.cos(pt.angle + Math.PI / 2);
        const ny = Math.sin(pt.angle + Math.PI / 2);
        const x = pt.x + nx * p.off;
        const y = pt.y + ny * p.off;
        const len = 8 + a.airflow * 14;
        const alpha = 0.3 + a.airflow * 0.55;
        ctx.strokeStyle = `rgba(175,232,255,${alpha})`;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(pt.angle) * len, y - Math.sin(pt.angle) * len);
        ctx.lineTo(x, y);
        ctx.stroke();
      }

      // sound-wave pulses (arcs crossing the airway)
      for (const p of a.pulses) {
        const route = p.nasal ? NASAL_ROUTE : ORAL_ROUTE;
        const pt = pointAt(route, p.dist);
        const life = 1 - (p.dist - GLOTTIS_DIST) / (route.length - GLOTTIS_DIST);
        ctx.strokeStyle = `rgba(255,208,120,${0.5 * life})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 10, pt.angle + Math.PI / 2 - 0.8, pt.angle + Math.PI / 2 + 0.8);
        ctx.stroke();
      }
      ctx.restore();

      // focus highlight ring
      const target = focusTarget(focusRef.current);
      if (target) {
        const pulse = 0.5 + Math.sin(a.t * 3) * 0.3;
        ctx.strokeStyle = `rgba(94,234,212,${pulse})`;
        ctx.lineWidth = 4;
        ctx.setLineDash([10, 8]);
        ctx.beginPath();
        ctx.arc(target[0], target[1], target[2], 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    };

    const LABELS: { text: string; at: Pt; to: Pt }[] = [
      { text: "Nasal cavity", at: [720, 150], to: [760, 232] },
      { text: "Hard palate", at: [560, 236], to: [700, 266] },
      { text: "Soft palate (velum)", at: [470, 288], to: [618, 300] },
      { text: "Oral cavity", at: [812, 300], to: [780, 320] },
      { text: "Tongue", at: [648, 452], to: [680, 388] },
      { text: "Lips", at: [940, 332], to: [890, 332] },
      { text: "Jaw", at: [560, 520], to: [610, 500] },
      { text: "Pharynx", at: [452, 400], to: [560, 400] },
      { text: "Epiglottis", at: [452, 452], to: [572, 466] },
      { text: "Vocal folds", at: [452, 500], to: [520, 488] },
      { text: "Trachea", at: [452, 556], to: [508, 556] },
      { text: "Lungs", at: [250, 560], to: [360, 600] },
      { text: "Diaphragm", at: [250, 700], to: [360, 706] },
    ];

    const drawLabels = () => {
      ctx.font = "600 15px 'Segoe UI', system-ui, sans-serif";
      ctx.textBaseline = "middle";
      for (const l of LABELS) {
        const right = l.at[0] > l.to[0];
        ctx.strokeStyle = "rgba(200,220,255,0.35)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(l.at[0], l.at[1]);
        ctx.lineTo(l.to[0], l.to[1]);
        ctx.stroke();
        ctx.fillStyle = "rgba(210,224,245,0.4)";
        ctx.beginPath();
        ctx.arc(l.to[0], l.to[1], 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.textAlign = right ? "left" : "right";
        ctx.fillStyle = "rgba(232,237,247,0.92)";
        ctx.fillText(l.text, l.at[0] + (right ? 6 : -6), l.at[1]);
      }

      // vowel estimate near the mouth
      if (a.voiced > 0.4) {
        ctx.textAlign = "left";
        ctx.font = "700 20px 'Segoe UI', system-ui, sans-serif";
        ctx.fillStyle = "#5eead4";
        ctx.fillText(`vowel ≈ ${classifyVowel(a.hi, a.front)}`, 620, 470);
      }

      // legend: resonance zones
      const legend: [string, string, number][] = [
        ["Head / nasal", "#b98cff", a.head],
        ["Mouth (oral)", "#63c8ff", a.mouth],
        ["Chest", "#ff8a5a", a.chest],
      ];
      ctx.font = "600 15px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "left";
      legend.forEach(([name, color, val], i) => {
        const y = 70 + i * 30;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.35 + val * 0.65;
        ctx.beginPath();
        ctx.arc(60, y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = "rgba(232,237,247,0.85)";
        ctx.fillText(`${name} resonance`, 78, y);
      });
      ctx.fillStyle = "rgba(147,160,189,0.9)";
      ctx.font = "600 14px 'Segoe UI', system-ui, sans-serif";
      ctx.fillText("Subglottal pressure", 430, 452);
      ctx.fillText("Airflow →", 372, 640);
    };

    let raf = 0;
    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      update(dt);
      draw();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="anatomy-canvas" />;
}

function focusTarget(focus: FocusTechnique): [number, number, number] | null {
  switch (focus) {
    case "breath-support":
      return [G.ZONE_CHEST[0], 660, 130];
    case "open-throat":
      return [568, 400, 70];
    case "forward-resonance":
      return [860, 320, 70];
    case "pitch-accuracy":
      return [534, 486, 56];
    default:
      return null;
  }
}
