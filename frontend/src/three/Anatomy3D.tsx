// Procedural 3D model of the singing instrument, orbitable from any angle.
//
// It renders in three modes off one shared pose model (see anatomy/pose.ts):
//   • live    — the solid "you" body driven by the microphone
//   • compare — you (solid) vs the ideal target (translucent ghost) while you
//     sing; the part you're doing wrong glows and a cue points at it, and the
//     ghost simultaneously shows the correct motion
//   • demo    — before you sing, a step-by-step 3D walk-through: each phase
//     isolates one part, plays rest → action → hold, and spotlights it
//
// Live fault detection is pure client-side DSP (anatomy/faults.ts). The deep
// per-part explanation comes from the agent at the end of a take.
//
// Acoustically-inferred educational model — not medical imaging.

import { useMemo, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { liveFrame } from "../audio/featureBus";
import { useStore } from "../state/store";
import type { FocusTechnique } from "../coach/types";
import { clamp, mapRange } from "./smooth";
import type { AnatomyPose } from "../anatomy/pose";
import {
  TMJ,
  REST,
  neutralPose,
  poseFromFeature,
  dampPose,
  lungScaleVec,
  lungY,
  diaphragmY,
  diaphragmDome,
  ribOpen,
  jawRot,
  velumRot,
  larynxY,
  thyroidTilt,
  hyoidWorld,
  foldGap,
  foldStretch,
  foldThin,
} from "../anatomy/pose";
import {
  cached,
  headGeometry,
  noseGeometry,
  torsoGeometry,
  lungLobeGeometry,
  diaphragmGeometry,
  thyroidGeometry,
  foldGeometry,
  tongueGeometry,
  shapeTongue,
  lipGeometry,
  shapeLipRing,
  velumGeometry,
  epiglottisGeometry,
  mandibleGeometry,
  alveolarGeometry,
  mandibleFrontGeometry,
  oralFloorGeometry,
  hyoidGeometry,
  hardPalateGeometry,
  pharynxGeometry,
  nasalCavityGeometry,
  tracheaGeometry,
  tracheaRingGeometry,
  ribGeometry,
  vertebraGeometry,
} from "./anatomyGeom";
import { idealPoseAt } from "../anatomy/ideal";
import { demoSnapshot, getDemoElapsed } from "../anatomy/demo";
import type { Part } from "../anatomy/faults";
import { PART_META, evaluateFaults, FaultTracker } from "../anatomy/faults";
import { poseBus } from "../anatomy/poseBus";

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// Airway centre-lines (sagittal plane, z = 0). x = front, y = up.
// Oral path rides UNDER the palate and OVER the tongue — the actual cavity.
const ORAL_PTS = [
  V(-0.35, -1.75, 0), V(-0.2, -1.1, 0), V(-0.05, -0.5, 0),
  V(0.08, 0.16, 0), // glottis
  V(0.22, 0.52, 0), V(0.30, 0.88, 0), // pharynx, behind the tongue root
  V(0.48, 1.16, 0), // oropharynx / velum junction
  V(0.90, 1.18, 0), V(1.40, 1.16, 0), V(1.96, 1.08, 0), // oral cavity → lips
];
const NASAL_PTS = [
  V(-0.35, -1.75, 0), V(-0.2, -1.1, 0), V(-0.05, -0.5, 0),
  V(0.08, 0.16, 0), V(0.22, 0.52, 0), V(0.30, 0.88, 0), V(0.48, 1.16, 0),
  V(0.55, 1.34, 0), V(1.10, 1.40, 0), V(1.55, 1.36, 0), V(1.94, 1.32, 0),
];
const ORAL_CURVE = new THREE.CatmullRomCurve3(ORAL_PTS);
const NASAL_CURVE = new THREE.CatmullRomCurve3(NASAL_PTS);
// Visible lower tract only (lungs → oropharynx). The mouth is a real cavity now.
const PHARYNX_CURVE = new THREE.CatmullRomCurve3(ORAL_PTS.slice(0, 7));

const GLOTTIS = V(0.08, 0.16, 0);

function nearestU(curve: THREE.CatmullRomCurve3, target: THREE.Vector3): number {
  let bestU = 0;
  let best = Infinity;
  for (let i = 0; i <= 200; i++) {
    const u = i / 200;
    const d = curve.getPointAt(u).distanceTo(target);
    if (d < best) {
      best = d;
      bestU = u;
    }
  }
  return bestU;
}
const GLOTTIS_U = nearestU(ORAL_CURVE, GLOTTIS);

const PARTICLES = 240;
const PULSES = 8;
const RINGS = 4;
// Only the single most-severe fault gets an on-model callout; the rest are
// marked by rings and listed in the DOM watch-outs strip (avoids text pile-up).
const CALLOUTS = 1;
const TEAL = new THREE.Color("#5eead4");
const GHOST = "#8895b5";

// Which anatomy part the end-of-take coaching focus points at.
const FOCUS_PART: Record<FocusTechnique, Part | null> = {
  "breath-support": "diaphragm",
  "pitch-accuracy": "folds",
  "forward-resonance": "placement",
  "open-throat": "throat",
  none: null,
};

interface P {
  u: number;
  nasal: boolean;
  off: THREE.Vector3;
  speed: number;
}

interface Highlight {
  part: Part;
  sev: number;
  fault: boolean; // true -> amber/red; false -> teal (demo / focus)
  cue?: string; // live corrective cue (compare mode)
}

function Label({ p, children }: { p: [number, number, number]; children: ReactNode }) {
  return (
    <Html position={p} center distanceFactor={5.5} style={{ pointerEvents: "none" }}>
      <div className="part-label">{children}</div>
    </Html>
  );
}

function faultColor(sev: number, out: THREE.Color): THREE.Color {
  // amber (0.12) at low severity -> red (0.0) at high severity
  return out.setHSL(mapRange(sev, 0, 1, 0.12, 0.0), 0.9, 0.55);
}

export function Anatomy3D() {
  const recording = useStore((s) => s.recording);
  const verifyPlaying = useStore((s) => s.verifyPlaying);
  const demoActive = useStore((s) => s.demoActive);
  const expanded = useStore((s) => s.expanded);
  const focus = useStore((s) => s.coach.focus);
  const setLiveFaults = useStore((s) => s.setLiveFaults);
  const setDemoCaption = useStore((s) => s.setDemoCaption);
  const camera = useThree((s) => s.camera);

  const comparing = recording || !!verifyPlaying;
  const modeRef = useRef({ recording: comparing, demoActive, focus, expanded });
  modeRef.current = { recording: comparing, demoActive, focus, expanded };

  // solid "you" refs
  const lungL = useRef<THREE.Group>(null);
  const lungR = useRef<THREE.Group>(null);
  const lungMats = useRef<THREE.MeshStandardMaterial[]>([]);
  const ribCage = useRef<THREE.Group>(null);
  const diaphragm = useRef<THREE.Mesh>(null);
  const foldL = useRef<THREE.Mesh>(null);
  const foldR = useRef<THREE.Mesh>(null);
  const larynxGroup = useRef<THREE.Group>(null);
  const larynx = useRef<THREE.Mesh>(null);
  const tongue = useRef<THREE.Mesh>(null);
  const jaw = useRef<THREE.Group>(null);
  const jawBone = useRef<THREE.Mesh>(null);
  const hyoid = useRef<THREE.Mesh>(null);
  const mouthRing = useRef<THREE.Mesh>(null);
  const velum = useRef<THREE.Group>(null);
  const velumMesh = useRef<THREE.Mesh>(null);
  const epiglottis = useRef<THREE.Mesh>(null);
  const tractMat = useRef<THREE.MeshStandardMaterial>(null);
  const pharynxMesh = useRef<THREE.Mesh>(null);
  const nasalMesh = useRef<THREE.Mesh>(null);
  const ribMats = useRef<THREE.MeshStandardMaterial[]>([]);
  const pointsGeo = useRef<THREE.BufferGeometry>(null);
  const pulseRefs = useRef<THREE.Mesh[]>([]);
  const zoneChest = useRef<THREE.PointLight>(null);
  const zoneMouth = useRef<THREE.PointLight>(null);
  const zoneHead = useRef<THREE.PointLight>(null);
  const glowChest = useRef<THREE.Mesh>(null);
  const glowMouth = useRef<THREE.Mesh>(null);
  const glowHead = useRef<THREE.Mesh>(null);

  // ghost (ideal target) refs
  const ghostGroup = useRef<THREE.Group>(null);
  const gLungL = useRef<THREE.Group>(null);
  const gLungR = useRef<THREE.Group>(null);
  const gDiaphragm = useRef<THREE.Mesh>(null);
  const gFoldL = useRef<THREE.Mesh>(null);
  const gFoldR = useRef<THREE.Mesh>(null);
  const gTongue = useRef<THREE.Mesh>(null);
  const gJaw = useRef<THREE.Group>(null);
  const gHyoid = useRef<THREE.Mesh>(null);
  const gMouthRing = useRef<THREE.Mesh>(null);
  const gVelum = useRef<THREE.Group>(null);
  const gLarynx = useRef<THREE.Group>(null);
  const gRibs = useRef<THREE.Group>(null);

  // highlight ring + callout pools
  const ringRefs = useRef<THREE.Mesh[]>([]);
  const calloutGroups = useRef<THREE.Group[]>([]);
  const calloutDivs = useRef<HTMLDivElement[]>([]);

  const positions = useMemo(() => new Float32Array(PARTICLES * 3), []);
  const colors = useMemo(() => new Float32Array(PARTICLES * 3), []);
  const particles = useMemo<P[]>(
    () =>
      Array.from({ length: PARTICLES }, () => ({
        u: Math.random(),
        nasal: false,
        off: new THREE.Vector3(
          (Math.random() - 0.5) * 0.09,
          (Math.random() - 0.5) * 0.09,
          (Math.random() - 0.5) * 0.09,
        ),
        speed: 0.35 + Math.random() * 0.2,
      })),
    [],
  );
  const pulses = useMemo(
    () => Array.from({ length: PULSES }, () => ({ active: false, u: 0 })),
    [],
  );

  const poseYou = useRef<AnatomyPose>(neutralPose());
  const poseTarget = useRef<AnatomyPose>(neutralPose());
  const tracker = useRef(new FaultTracker());
  const clock = useRef({
    glot: 0, spawn: 0, pulse: 0, t: 0, idle: 0, demoT: 0,
    faultPush: 0, captionKey: "", captionPush: 0, prevMode: "",
  });

  const scratch = useMemo(() => new THREE.Vector3(), []);
  const tan = useMemo(() => new THREE.Vector3(), []);
  const emphColor = useMemo(() => new THREE.Color(), []);
  const pitchColor = useMemo(() => new THREE.Color(), []);
  const emphasis = useMemo(() => new Map<Part, { sev: number; fault: boolean }>(), []);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const c = clock.current;
    const f = liveFrame.current;
    const { recording: rec, demoActive: demo, focus: foc, expanded: exp } = modeRef.current;
    const mode: "live" | "compare" | "demo" = rec ? "compare" : demo ? "demo" : "live";
    c.t += dt;

    const demoElapsed = getDemoElapsed(mode === "demo", state.clock.elapsedTime);
    const snap = mode === "demo" ? demoSnapshot(demoElapsed) : null;
    if (mode === "demo") c.demoT = demoElapsed;

    // --- target poses for this frame ------------------------------------
    let youTarget: AnatomyPose;
    if (snap) {
      youTarget = snap.pose;
      if (c.prevMode !== "demo") Object.assign(poseYou.current, snap.pose);
    } else {
      youTarget = poseFromFeature(f, poseYou.current);
      if (!f.hasPitch && f.rms <= 0.03) {
        c.idle += dt;
        youTarget.breath = 0.32 + Math.sin(c.idle * 0.9) * 0.12; // gentle idle breathing
      }
    }
    // Demo poses are already eased; a faster damp keeps the step motion readable.
    dampPose(poseYou.current, youTarget, snap ? dt * 2.6 : dt);

    const showGhost = mode === "compare";
    if (showGhost) {
      dampPose(poseTarget.current, idealPoseAt(f.t, f), dt);
    }
    if (ghostGroup.current) ghostGroup.current.visible = showGhost;

    // --- figure out what to highlight -----------------------------------
    const highlights: Highlight[] = [];
    if (mode === "compare") {
      const raw = evaluateFaults(poseYou.current, poseTarget.current, f);
      const active = tracker.current.update(raw, dt);
      for (const a of active) highlights.push({ part: a.part, sev: a.severity, fault: true, cue: a.cue });
      // publish a throttled copy for the DOM watch-outs strip
      c.faultPush += dt;
      if (c.faultPush >= 0.2) {
        c.faultPush = 0;
        setLiveFaults(active.slice(0, 3).map((a) => ({
          part: a.part,
          label: PART_META[a.part].label,
          cue: a.cue,
          severity: a.severity,
        })));
      }
    } else {
      tracker.current.update([], dt); // decay so re-entry is clean
      if (snap) {
        c.captionPush += dt;
        if (snap.key !== c.captionKey || c.captionPush >= 0.12) {
          c.captionKey = snap.key;
          c.captionPush = 0;
          setDemoCaption(snap.caption);
        }
        for (const h of snap.highlights) {
          highlights.push({ part: h.part, sev: h.sev, fault: false, cue: snap.beat.cue });
        }
      } else if (foc !== "none" && FOCUS_PART[foc]) {
        // after a take, keep pointing at what the coach said to work on
        highlights.push({ part: FOCUS_PART[foc]!, sev: 0.5 + 0.25 * Math.sin(c.t * 2.4), fault: false });
      }
    }
    // side-effects on leaving a mode
    if (mode !== "compare" && c.prevMode === "compare") setLiveFaults([]);
    if (mode !== "demo" && c.prevMode === "demo") {
      setDemoCaption(null);
      c.captionKey = "";
    }
    c.prevMode = mode;

    // per-part emphasis lookup for material tinting
    emphasis.clear();
    for (const h of highlights) {
      const prev = emphasis.get(h.part);
      if (!prev || h.sev > prev.sev) emphasis.set(h.part, { sev: h.sev, fault: h.fault });
    }
    const emphOf = (part: Part): { color: THREE.Color; sev: number } | null => {
      const e = emphasis.get(part);
      if (!e) return null;
      return { color: e.fault ? faultColor(e.sev, emphColor) : TEAL, sev: e.sev };
    };

    // --- render the solid "you" body ------------------------------------
    const p = poseYou.current;
    const flutter = mapRange(p.pitchN, 0, 1, 8, 18);
    c.glot += dt * flutter * Math.PI * 2;
    pitchColor.setHSL(p.hue, 0.62, 0.52);

    const [lx, ly, lz] = lungScaleVec(p);
    const lyPos = lungY(p);
    if (lungL.current) {
      lungL.current.scale.set(lx, ly, lz);
      lungL.current.position.set(-0.22, lyPos, 0.5);
    }
    if (lungR.current) {
      lungR.current.scale.set(lx, ly, lz);
      lungR.current.position.set(-0.22, lyPos, -0.5);
    }
    if (ribCage.current) {
      const open = 1 + ribOpen(p);
      ribCage.current.scale.set(open, 1 + p.breath * 0.06, open);
    }
    if (diaphragm.current) {
      diaphragm.current.position.y = diaphragmY(p);
      const dome = diaphragmDome(p);
      diaphragm.current.scale.set(1.05 + p.breath * 0.08, 0.38 * dome + 0.12, 1.05 + p.breath * 0.08);
    }

    const dEmph = emphOf("diaphragm");
    if (diaphragm.current) {
      const m = diaphragm.current.material as THREE.MeshStandardMaterial;
      if (dEmph) {
        m.emissive.copy(dEmph.color);
        m.emissiveIntensity = 0.35 + dEmph.sev * 1.1;
      } else {
        m.emissive.set("#6b2030");
        m.emissiveIntensity = 0.18 + p.pressure * 0.25;
      }
    }
    for (const m of lungMats.current) {
      if (dEmph) {
        m.emissive.copy(dEmph.color);
        m.emissiveIntensity = 0.22 + dEmph.sev * 0.8;
      } else {
        m.emissive.set("#5a2038");
        m.emissiveIntensity = 0.12 + p.breath * 0.2;
      }
    }
    for (const m of ribMats.current) {
      if (!m) continue;
      if (dEmph) {
        m.emissive.copy(dEmph.color);
        m.emissiveIntensity = 0.18 + dEmph.sev * 0.7;
        m.opacity = 0.72;
      } else {
        m.emissive.set("#000000");
        m.emissiveIntensity = 0;
        m.opacity = 0.55;
      }
    }

    const gap = foldGap(p, c.glot);
    const stretch = foldStretch(p);
    const thin = foldThin(p);
    const fEmph = emphOf("folds");
    if (foldL.current && foldR.current) {
      foldL.current.position.set(0.08, larynxY(p), -gap);
      foldR.current.position.set(0.08, larynxY(p), gap);
      foldL.current.rotation.set(0, 0.42, 0.08 * Math.sin(c.glot) * p.voiced);
      foldR.current.rotation.set(0, -0.42, -0.08 * Math.sin(c.glot) * p.voiced);
      foldL.current.scale.set(stretch, thin, 1);
      foldR.current.scale.set(stretch, thin, 1);
      for (const m of [foldL.current, foldR.current]) {
        const mat = m.material as THREE.MeshStandardMaterial;
        if (fEmph) {
          mat.color.copy(fEmph.color);
          mat.emissive.copy(fEmph.color);
          mat.emissiveIntensity = 0.45 + fEmph.sev * 1.1;
        } else {
          mat.color.copy(pitchColor);
          mat.emissive.copy(pitchColor);
          mat.emissiveIntensity = 0.2 + p.voiced * 0.85;
        }
      }
    }

    poseBus.you = p;
    poseBus.glot = c.glot;
    scratch.set(-0.37, -0.15 + larynxY(p), 0).project(camera);
    poseBus.nx = scratch.x * 0.5 + 0.5;
    poseBus.ny = -scratch.y * 0.5 + 0.5;

    if (larynxGroup.current) {
      larynxGroup.current.position.y = larynxY(p) - 0.15;
      larynxGroup.current.rotation.z = thyroidTilt(p);
    }
    const tEmph = emphOf("throat");
    if (larynx.current) {
      const m = larynx.current.material as THREE.MeshStandardMaterial;
      if (tEmph) {
        m.emissive.copy(tEmph.color);
        m.emissiveIntensity = 0.35 + tEmph.sev * 1.0;
      } else {
        m.emissive.set("#c4a882");
        m.emissiveIntensity = 0.08 + p.voiced * 0.2;
      }
    }
    if (pharynxMesh.current) {
      const m = pharynxMesh.current.material as THREE.MeshStandardMaterial;
      if (tEmph) {
        m.emissive.copy(tEmph.color);
        m.emissiveIntensity = 0.28 + tEmph.sev * 0.9;
        m.opacity = 0.62;
      } else {
        m.emissive.set("#000000");
        m.emissiveIntensity = 0;
        m.opacity = 0.42;
      }
    }
    if (epiglottis.current) {
      epiglottis.current.rotation.z = -0.35 - p.voiced * 0.15 + p.larynx * 0.2;
    }

    if (tractMat.current) {
      if (tEmph) {
        tractMat.current.emissive.copy(tEmph.color);
        tractMat.current.emissiveIntensity = 0.2 + tEmph.sev * 0.7;
      } else {
        tractMat.current.emissive.set("#8a3a48");
        tractMat.current.emissiveIntensity = 0.08 + p.voiced * (0.18 + 0.18 * (0.5 + 0.5 * Math.sin(c.glot)));
      }
    }

    if (tongue.current) {
      shapeTongue(tongue.current.geometry as THREE.BufferGeometry, p);
      const m = tongue.current.material as THREE.MeshStandardMaterial;
      const e = emphOf("tongue");
      if (e) {
        m.emissive.copy(e.color);
        m.emissiveIntensity = 0.18 + e.sev * 0.9;
      } else {
        m.emissiveIntensity = 0.05;
      }
    }

    if (jaw.current) jaw.current.rotation.z = jawRot(p);
    if (jawBone.current) {
      const m = jawBone.current.material as THREE.MeshStandardMaterial;
      const e = emphOf("jaw");
      if (e) {
        m.emissive.copy(e.color);
        m.emissiveIntensity = 0.22 + e.sev * 0.9;
      } else {
        m.emissiveIntensity = 0;
      }
    }
    if (hyoid.current) {
      const [hx, hy] = hyoidWorld(p);
      hyoid.current.position.set(hx, hy, 0);
    }
    if (mouthRing.current) {
      shapeLipRing(mouthRing.current.geometry as THREE.BufferGeometry, p);
      const m = mouthRing.current.material as THREE.MeshStandardMaterial;
      const e = emphOf("placement") ?? emphOf("jaw");
      if (e) {
        m.emissive.copy(e.color);
        m.emissiveIntensity = 0.25 + e.sev * 0.9;
      } else {
        m.emissive.set("#7a3048");
        m.emissiveIntensity = 0.12;
      }
    }

    if (velum.current) velum.current.rotation.z = velumRot(p);
    const vEmph = emphOf("velum");
    if (velumMesh.current) {
      const m = velumMesh.current.material as THREE.MeshStandardMaterial;
      if (vEmph) {
        m.emissive.copy(vEmph.color);
        m.emissiveIntensity = 0.25 + vEmph.sev * 0.85;
      } else {
        m.emissiveIntensity = 0.04;
      }
    }
    if (nasalMesh.current) {
      const m = nasalMesh.current.material as THREE.MeshStandardMaterial;
      if (vEmph) {
        m.emissive.copy(vEmph.color);
        m.emissiveIntensity = 0.2 + vEmph.sev * 0.75;
        m.opacity = 0.5;
      } else {
        m.emissive.set("#000000");
        m.emissiveIntensity = 0;
        m.opacity = 0.32;
      }
    }

    // resonance zones
    if (zoneChest.current) zoneChest.current.intensity = p.chest * 3;
    if (zoneMouth.current) zoneMouth.current.intensity = p.mouth * 3;
    if (zoneHead.current) zoneHead.current.intensity = p.head * 3.2;
    const setGlow = (m: THREE.Mesh | null, v: number) => {
      if (!m) return;
      (m.material as THREE.MeshBasicMaterial).opacity = v * 0.5;
      const sc = 0.6 + v * 0.7;
      m.scale.set(sc, sc, sc);
    };
    setGlow(glowChest.current, p.chest);
    setGlow(glowMouth.current, p.mouth);
    setGlow(glowHead.current, p.head);

    // --- render the ghost (ideal target) --------------------------------
    if (showGhost) {
      const g = poseTarget.current;
      const [gx, gy, gz] = lungScaleVec(g);
      const gyPos = lungY(g);
      if (gLungL.current) {
        gLungL.current.scale.set(gx, gy, gz);
        gLungL.current.position.set(-0.22, gyPos, 0.5);
      }
      if (gLungR.current) {
        gLungR.current.scale.set(gx, gy, gz);
        gLungR.current.position.set(-0.22, gyPos, -0.5);
      }
      if (gRibs.current) {
        const open = 1 + ribOpen(g);
        gRibs.current.scale.set(open, 1 + g.breath * 0.06, open);
      }
      if (gDiaphragm.current) {
        gDiaphragm.current.position.y = diaphragmY(g);
        const dome = diaphragmDome(g);
        gDiaphragm.current.scale.set(1.05 + g.breath * 0.08, 0.38 * dome + 0.12, 1.05 + g.breath * 0.08);
      }
      const ggap = foldGap(g, c.glot);
      const gstr = foldStretch(g);
      const gthin = foldThin(g);
      if (gFoldL.current) {
        gFoldL.current.position.set(0.08, larynxY(g), -ggap);
        gFoldL.current.rotation.set(0, 0.42, 0);
        gFoldL.current.scale.set(gstr, gthin, 1);
      }
      if (gFoldR.current) {
        gFoldR.current.position.set(0.08, larynxY(g), ggap);
        gFoldR.current.rotation.set(0, -0.42, 0);
        gFoldR.current.scale.set(gstr, gthin, 1);
      }
      if (gLarynx.current) {
        gLarynx.current.position.y = larynxY(g) - 0.15;
        gLarynx.current.rotation.z = thyroidTilt(g);
      }
      if (gTongue.current) {
        shapeTongue(gTongue.current.geometry as THREE.BufferGeometry, g);
      }
      if (gJaw.current) gJaw.current.rotation.z = jawRot(g);
      if (gHyoid.current) {
        const [hx, hy] = hyoidWorld(g);
        gHyoid.current.position.set(hx, hy, 0);
      }
      if (gMouthRing.current) {
        shapeLipRing(gMouthRing.current.geometry as THREE.BufferGeometry, g);
      }
      if (gVelum.current) gVelum.current.rotation.z = velumRot(g);
    }

    // --- airflow particles ----------------------------------------------
    c.spawn += dt;
    const speedScale = 0.25 + p.airflow * 1.1;
    for (let i = 0; i < particles.length; i++) {
      const pt = particles[i];
      pt.u += pt.speed * speedScale * dt;
      if (pt.u >= 1) {
        pt.u = 0;
        pt.nasal = Math.random() < p.velumOpen;
      }
      const curve = pt.nasal ? NASAL_CURVE : ORAL_CURVE;
      curve.getPointAt(clamp(pt.u, 0, 1), scratch).add(pt.off);
      positions[i * 3] = scratch.x;
      positions[i * 3 + 1] = scratch.y;
      positions[i * 3 + 2] = scratch.z;
      const b = 0.35 + p.airflow * 0.6;
      colors[i * 3] = 0.55 * b;
      colors[i * 3 + 1] = 0.85 * b;
      colors[i * 3 + 2] = b;
    }
    if (pointsGeo.current) {
      (pointsGeo.current.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (pointsGeo.current.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    }

    // --- sound pulses ----------------------------------------------------
    if (p.voiced > 0.4) {
      c.pulse += dt;
      const interval = mapRange(p.pitchN, 0, 1, 0.17, 0.07);
      if (c.pulse >= interval) {
        c.pulse = 0;
        const free = pulses.find((pl) => !pl.active);
        if (free) {
          free.active = true;
          free.u = GLOTTIS_U;
        }
      }
    }
    for (let i = 0; i < pulses.length; i++) {
      const pl = pulses[i];
      const mesh = pulseRefs.current[i];
      if (!mesh) continue;
      if (!pl.active) {
        mesh.visible = false;
        continue;
      }
      pl.u += 0.5 * dt;
      if (pl.u >= 1) {
        pl.active = false;
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      ORAL_CURVE.getPointAt(pl.u, scratch);
      ORAL_CURVE.getTangentAt(pl.u, tan);
      mesh.position.copy(scratch);
      mesh.lookAt(scratch.clone().add(tan));
      const life = 1 - (pl.u - GLOTTIS_U) / (1 - GLOTTIS_U);
      const sc = 0.15 + (1 - life) * 0.25;
      mesh.scale.set(sc, sc, sc);
      (mesh.material as THREE.MeshBasicMaterial).opacity = life * 0.7;
    }

    // --- highlight rings + callouts -------------------------------------
    for (let i = 0; i < RINGS; i++) {
      const ring = ringRefs.current[i];
      if (!ring) continue;
      const h = highlights[i];
      if (!h) {
        ring.visible = false;
        continue;
      }
      const meta = PART_META[h.part];
      ring.visible = true;
      ring.position.set(meta.anchor[0], meta.anchor[1], meta.anchor[2]);
      ring.quaternion.copy(camera.quaternion);
      const sc = meta.ring * (mode === "demo" ? 0.78 : 1) * (1 + 0.07 * Math.sin(c.t * 4 + i));
      ring.scale.set(sc, sc, sc);
      const mat = ring.material as THREE.MeshBasicMaterial;
      mat.color.copy(h.fault ? faultColor(h.sev, emphColor) : TEAL);
      mat.opacity = 0.55 + 0.35 * h.sev;
    }
    for (let i = 0; i < CALLOUTS; i++) {
      const grp = calloutGroups.current[i];
      const div = calloutDivs.current[i];
      if (!grp || !div) continue;
      // Demo copy lives in the DOM caption so on-model chips don't cover the figure.
      const h = mode === "compare" && exp ? highlights[i] : undefined;
      if (!h) {
        if (div.style.display !== "none") div.style.display = "none";
        continue;
      }
      const meta = PART_META[h.part];
      grp.position.set(meta.anchor[0] + 0.15, meta.anchor[1] + meta.ring * 0.55 + 0.2, meta.anchor[2] + 0.15);
      div.textContent = `${meta.label}: ${h.cue ?? meta.correctMotion}`;
      div.className = `anat-callout ${h.sev > 0.6 ? "bad" : "warn"}`;
      div.style.display = "block";
    }
  });

  const headGeom = useMemo(() => cached("head-oral", headGeometry), []);
  const noseGeom = useMemo(() => cached("nose-oral", noseGeometry), []);
  const torsoGeom = useMemo(() => cached("torso", torsoGeometry), []);
  const lobeGeom = useMemo(() => cached("lobe", lungLobeGeometry), []);
  const diaGeom = useMemo(() => cached("dia", diaphragmGeometry), []);
  const thyroidGeom = useMemo(() => cached("thyroid", thyroidGeometry), []);
  const foldGeom = useMemo(() => cached("fold", foldGeometry), []);
  const tongueGeom = useMemo(() => {
    const g = tongueGeometry();
    shapeTongue(g, neutralPose());
    return g;
  }, []);
  const gTongueGeom = useMemo(() => {
    const g = tongueGeometry();
    shapeTongue(g, neutralPose());
    return g;
  }, []);
  const velumGeom = useMemo(() => cached("velum-oral", velumGeometry), []);
  const epiGeom = useMemo(() => cached("epi", epiglottisGeometry), []);
  const jawGeom = useMemo(() => cached("jaw-oral2", mandibleGeometry), []);
  const alveolarGeom = useMemo(() => cached("alveolar", alveolarGeometry), []);
  const jawFrontGeom = useMemo(() => cached("jaw-front", mandibleFrontGeometry), []);
  const floorGeom = useMemo(() => cached("oral-floor", oralFloorGeometry), []);
  const hyoidGeom = useMemo(() => cached("hyoid", hyoidGeometry), []);
  const palateGeom = useMemo(() => cached("palate", hardPalateGeometry), []);
  const pharynxGeom = useMemo(() => cached("pharynx", pharynxGeometry), []);
  const nasalGeom = useMemo(() => cached("nasal-cav", nasalCavityGeometry), []);
  const lipGeom = useMemo(() => {
    const g = lipGeometry();
    shapeLipRing(g, neutralPose());
    return g;
  }, []);
  const gLipGeom = useMemo(() => {
    const g = lipGeometry();
    shapeLipRing(g, neutralPose());
    return g;
  }, []);
  const trachGeom = useMemo(() => cached("trach", tracheaGeometry), []);
  const ringGeom = useMemo(() => cached("tring", tracheaRingGeometry), []);
  const ribGeom = useMemo(() => cached("rib", ribGeometry), []);
  const vertGeom = useMemo(() => cached("vert", vertebraGeometry), []);

  const registerLungMat = (i: number) => (m: THREE.MeshStandardMaterial | null) => {
    if (m) lungMats.current[i] = m;
  };

  return (
    <group position={[-0.45, -0.15, 0]}>
      <mesh geometry={headGeom} position={[0.15, 0, 0]}>
        <meshStandardMaterial
          color="#e7c4ad"
          roughness={0.48}
          transparent
          opacity={0.22}
          depthWrite={false}
        />
      </mesh>
      {/* Nose on the +X face, sitting on the head's nasal ridge. */}
      <mesh geometry={noseGeom} position={[1.82, 1.40, 0]}>
        <meshStandardMaterial
          color="#e0b09a"
          roughness={0.46}
          transparent
          opacity={0.55}
          depthWrite={false}
        />
      </mesh>
      <mesh geometry={torsoGeom} position={[0.05, 0, 0]}>
        <meshStandardMaterial
          color="#d9b39a"
          roughness={0.52}
          transparent
          opacity={0.18}
          depthWrite={false}
        />
      </mesh>

      {/* spine */}
      {[-0.15, -0.42, -0.7, -0.98, -1.26, -1.54, -1.82].map((y, i) => (
        <mesh key={i} geometry={vertGeom} position={[-0.72, y, 0]} rotation={[0, 0, 0.08]}>
          <meshStandardMaterial color="#e6dcc8" roughness={0.7} />
        </mesh>
      ))}

      {/* ribcage — expands with breath */}
      <group ref={ribCage} position={[-0.28, -1.35, 0]}>
        {[0.18, -0.02, -0.22, -0.42, -0.62].map((y, i) => (
          <mesh
            key={i}
            geometry={ribGeom}
            position={[0.15, y, 0]}
            rotation={[Math.PI / 2, 0.12 + i * 0.04, Math.PI * 0.08]}
            scale={[0.92 + i * 0.03, 1, 0.78]}
          >
            <meshStandardMaterial
              ref={(m) => {
                if (m) ribMats.current[i] = m;
              }}
              color="#efe4d2"
              roughness={0.55}
              transparent
              opacity={0.55}
              depthWrite={false}
            />
          </mesh>
        ))}
      </group>

      {/* Lower airway (lungs → oropharynx). The mouth is a real cavity, not a tube. */}
      <mesh>
        <tubeGeometry args={[PHARYNX_CURVE, 64, 0.10, 16, false]} />
        <meshStandardMaterial
          ref={tractMat}
          color="#c97b84"
          emissive="#8a3a48"
          emissiveIntensity={0.1}
          transparent
          opacity={0.28}
          roughness={0.35}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <mesh ref={pharynxMesh} geometry={pharynxGeom}>
        <meshStandardMaterial
          color="#c47a84"
          transparent
          opacity={0.42}
          roughness={0.5}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <mesh ref={nasalMesh} geometry={nasalGeom}>
        <meshStandardMaterial color="#c9a0a6" transparent opacity={0.32} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={palateGeom}>
        <meshStandardMaterial color="#efe4cf" roughness={0.55} side={THREE.DoubleSide} />
      </mesh>

      {/* trachea with cartilaginous rings */}
      <mesh geometry={trachGeom} position={[-0.12, -0.55, 0]}>
        <meshStandardMaterial color="#e2d2bc" roughness={0.55} />
      </mesh>
      {[-0.15, -0.35, -0.55, -0.75, -0.95].map((y, i) => (
        <mesh key={i} geometry={ringGeom} position={[-0.12, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <meshStandardMaterial color="#d9c7a8" roughness={0.4} />
        </mesh>
      ))}

      <LungSide
        groupRef={lungL}
        z={0.5}
        lobeGeom={lobeGeom}
        matA={registerLungMat(0)}
        matB={registerLungMat(2)}
      />
      <LungSide
        groupRef={lungR}
        z={-0.5}
        lobeGeom={lobeGeom}
        matA={registerLungMat(1)}
        matB={registerLungMat(3)}
      />

      {/* diaphragm — dome flattens and drops on inhale */}
      <mesh ref={diaphragm} geometry={diaGeom} position={[-0.28, -2.12, 0]}>
        <meshStandardMaterial
          color="#b54a5c"
          emissive="#6b2030"
          emissiveIntensity={0.18}
          roughness={0.55}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* larynx (thyroid cartilage) + folds + epiglottis at the tongue root */}
      <group ref={larynxGroup} position={[0.08, 0, 0]}>
        <mesh ref={larynx} geometry={thyroidGeom} position={[0, 0.02, 0]} scale={[1.15, 1.1, 1.05]}>
          <meshStandardMaterial color="#e8d5b8" emissive="#c4a882" emissiveIntensity={0.08} roughness={0.45} />
        </mesh>
        <mesh ref={epiglottis} geometry={epiGeom} position={[0.28, 0.48, 0]} rotation={[0, 0, -0.28]}>
          <meshStandardMaterial color="#c97a82" roughness={0.4} />
        </mesh>
      </group>
      <mesh ref={foldL} geometry={foldGeom} position={[0.08, 0.16, -0.05]}>
        <meshStandardMaterial color="#e07080" emissive="#c04058" emissiveIntensity={0.3} roughness={0.35} />
      </mesh>
      <mesh ref={foldR} geometry={foldGeom} position={[0.08, 0.16, 0.05]}>
        <meshStandardMaterial color="#e07080" emissive="#c04058" emissiveIntensity={0.3} roughness={0.35} />
      </mesh>

      <mesh ref={tongue} geometry={tongueGeom}>
        <meshStandardMaterial
          color="#c45c64"
          emissive="#8a3038"
          emissiveIntensity={0.05}
          roughness={0.45}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh ref={hyoid} geometry={hyoidGeom} position={[REST.hyoid[0], REST.hyoid[1], 0]}>
        <meshStandardMaterial color="#e8dcc8" roughness={0.55} />
      </mesh>

      <group ref={velum} position={[REST.velumHinge[0], REST.velumHinge[1], 0]}>
        <mesh ref={velumMesh} geometry={velumGeom}>
          <meshStandardMaterial color="#d48992" roughness={0.4} />
        </mesh>
        <mesh position={[-0.50, -0.08, 0]}>
          <sphereGeometry args={[0.032, 10, 8]} />
          <meshStandardMaterial color="#c97a82" roughness={0.4} />
        </mesh>
      </group>

      {/* Upper teeth sit on the maxilla, just under the anterior palate. */}
      <group position={[REST.upperIncisor[0], REST.upperIncisor[1], 0]}>
        <Teeth upper />
      </group>

      {/* Mouth as one lip ring — aperture morphs with pitch, jaw and rounding. */}
      <mesh ref={mouthRing} geometry={lipGeom}>
        <meshStandardMaterial
          color="#c45a6e"
          emissive="#7a3048"
          emissiveIntensity={0.12}
          roughness={0.35}
          side={THREE.DoubleSide}
        />
      </mesh>

      <group ref={jaw} position={[TMJ.x, TMJ.y, 0]}>
        <mesh ref={jawBone} geometry={jawGeom}>
          <meshStandardMaterial color="#efe6d4" roughness={0.65} />
        </mesh>
        <mesh geometry={alveolarGeom}>
          <meshStandardMaterial color="#efe6d4" roughness={0.6} />
        </mesh>
        <mesh geometry={jawFrontGeom}>
          <meshStandardMaterial color="#efe6d4" roughness={0.6} />
        </mesh>
        <mesh geometry={floorGeom}>
          <meshStandardMaterial
            color="#c45c64"
            roughness={0.55}
            side={THREE.DoubleSide}
            transparent
            opacity={0.85}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[0, 0, 0.68]}>
          <sphereGeometry args={[0.075, 10, 8]} />
          <meshStandardMaterial color="#efe6d4" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0, -0.68]}>
          <sphereGeometry args={[0.075, 10, 8]} />
          <meshStandardMaterial color="#efe6d4" roughness={0.6} />
        </mesh>
        <group position={[REST.lowerIncisor[0] - TMJ.x, REST.lowerIncisor[1] - TMJ.y, 0]}>
          <Teeth upper={false} />
        </group>
      </group>

      {/* ---- ghost: the ideal target body (visible in compare mode) ---- */}
      <group ref={ghostGroup} visible={false}>
        <LungSide groupRef={gLungL} z={0.5} lobeGeom={lobeGeom} ghost />
        <LungSide groupRef={gLungR} z={-0.5} lobeGeom={lobeGeom} ghost />
        <group ref={gRibs} position={[-0.28, -1.35, 0]} />
        <mesh ref={gDiaphragm} geometry={diaGeom} position={[-0.28, -2.12, 0]}>
          <GhostMaterial />
        </mesh>
        <group ref={gLarynx} position={[0.08, 0, 0]}>
          <mesh geometry={thyroidGeom} position={[0, 0.02, 0]} scale={[1.15, 1.1, 1.05]}>
            <GhostMaterial />
          </mesh>
        </group>
        <mesh ref={gFoldL} geometry={foldGeom} position={[0.08, 0.16, -0.05]}>
          <GhostMaterial />
        </mesh>
        <mesh ref={gFoldR} geometry={foldGeom} position={[0.08, 0.16, 0.05]}>
          <GhostMaterial />
        </mesh>
        <mesh ref={gTongue} geometry={gTongueGeom}>
          <GhostMaterial />
        </mesh>
        <mesh ref={gHyoid} geometry={hyoidGeom} position={[REST.hyoid[0], REST.hyoid[1], 0]}>
          <GhostMaterial />
        </mesh>
        <group ref={gJaw} position={[TMJ.x, TMJ.y, 0]}>
          <mesh geometry={jawGeom}>
            <GhostMaterial />
          </mesh>
        </group>
        <mesh ref={gMouthRing} geometry={gLipGeom}>
          <GhostMaterial />
        </mesh>
        <group ref={gVelum} position={[REST.velumHinge[0], REST.velumHinge[1], 0]}>
          <mesh geometry={velumGeom}>
            <GhostMaterial />
          </mesh>
        </group>
      </group>

        {/* resonance zone lights + glow markers */}
        <pointLight ref={zoneChest} position={[-0.3, -1.3, 0]} color="#ff8a5a" intensity={0} distance={4} />
        <pointLight ref={zoneMouth} position={[1.25, 1.14, 0]} color="#63c8ff" intensity={0} distance={3.5} />
        <pointLight ref={zoneHead} position={[1.1, 1.7, 0]} color="#b98cff" intensity={0} distance={3.5} />
        <mesh ref={glowChest} position={[-0.3, -1.3, 0]}>
          <sphereGeometry args={[0.5, 16, 16]} />
          <meshBasicMaterial color="#ff8a5a" transparent opacity={0} depthWrite={false} />
        </mesh>
        <mesh ref={glowMouth} position={[1.25, 1.14, 0]}>
          <sphereGeometry args={[0.42, 16, 16]} />
          <meshBasicMaterial color="#63c8ff" transparent opacity={0} depthWrite={false} />
        </mesh>
        <mesh ref={glowHead} position={[1.1, 1.7, 0]}>
          <sphereGeometry args={[0.42, 16, 16]} />
          <meshBasicMaterial color="#b98cff" transparent opacity={0} depthWrite={false} />
        </mesh>

        {/* airflow particles */}
        <points>
          <bufferGeometry ref={pointsGeo}>
            <bufferAttribute attach="attributes-position" args={[positions, 3]} />
            <bufferAttribute attach="attributes-color" args={[colors, 3]} />
          </bufferGeometry>
          <pointsMaterial size={0.07} vertexColors transparent sizeAttenuation depthWrite={false} />
        </points>

        {/* sound-wave pulse rings */}
        {Array.from({ length: PULSES }).map((_, i) => (
          <mesh
            key={i}
            visible={false}
            ref={(m) => {
              if (m) pulseRefs.current[i] = m;
            }}
          >
            <torusGeometry args={[0.6, 0.05, 8, 24]} />
            <meshBasicMaterial color="#ffd27a" transparent opacity={0} depthWrite={false} />
          </mesh>
        ))}

      {/* highlight rings (faults / demo spotlight / focus) */}
      {Array.from({ length: RINGS }).map((_, i) => (
        <mesh
          key={i}
          visible={false}
          renderOrder={20}
          ref={(m) => {
            if (m) ringRefs.current[i] = m;
          }}
        >
          <torusGeometry args={[1, 0.038, 10, 44]} />
          <meshBasicMaterial color="#5eead4" transparent opacity={0.7} depthWrite={false} depthTest={false} />
        </mesh>
      ))}

      {/* fault callouts (compare mode) */}
      {Array.from({ length: CALLOUTS }).map((_, i) => (
        <group
          key={i}
          ref={(g) => {
            if (g) calloutGroups.current[i] = g;
          }}
        >
          <Html center sprite distanceFactor={8} style={{ pointerEvents: "none" }} zIndexRange={[30, 0]}>
            <div
              ref={(d) => {
                if (d) calloutDivs.current[i] = d;
              }}
              className="anat-callout"
              style={{ display: "none" }}
            />
          </Html>
        </group>
      ))}

      {expanded && !demoActive && (
        <>
          <Label p={[-1.75, -1.35, 0.85]}>Lungs</Label>
          <Label p={[-1.55, -2.45, 0]}>Diaphragm</Label>
          <Label p={[-1.15, 0.15, 0]}>Vocal folds</Label>
          <Label p={[1.15, 0.78, 0.55]}>Tongue</Label>
          <Label p={[1.05, 1.58, 0]}>Palate</Label>
          <Label p={[-0.15, 2.15, 0]}>Head / mask</Label>
          <Label p={[2.45, 1.45, 0]}>Nose</Label>
          <Label p={[2.55, 1.08, 0]}>Lips</Label>
        </>
      )}
    </group>
  );
}

function Teeth({ upper }: { upper: boolean }) {
  const zs = [-0.13, -0.08, -0.028, 0.028, 0.08, 0.13];
  const fwd = [0.0, 0.012, 0.028, 0.028, 0.012, 0.0];
  return (
    <>
      {zs.map((z, i) => (
        <mesh
          key={i}
          position={[fwd[i], upper ? -0.035 : 0.035, z]}
          rotation={[0, 0, upper ? 0.12 : -0.12]}
        >
          <boxGeometry args={[0.038, 0.078, 0.03]} />
          <meshStandardMaterial color="#f3eee4" roughness={0.32} />
        </mesh>
      ))}
    </>
  );
}

function GhostMaterial() {
  return (
    <meshStandardMaterial color={GHOST} transparent opacity={0.28} roughness={0.45} depthWrite={false} />
  );
}

function LungSide({
  groupRef,
  z,
  lobeGeom,
  ghost,
  matA,
  matB,
}: {
  groupRef: RefObject<THREE.Group | null>;
  z: number;
  lobeGeom: THREE.BufferGeometry;
  ghost?: boolean;
  matA?: (m: THREE.MeshStandardMaterial | null) => void;
  matB?: (m: THREE.MeshStandardMaterial | null) => void;
}) {
  return (
    <group ref={groupRef} position={[-0.22, -1.28, z]}>
      <mesh geometry={lobeGeom} position={[0.08, 0.28, 0]} scale={[0.95, 0.85, 0.9]}>
        {ghost ? (
          <GhostMaterial />
        ) : (
          <meshStandardMaterial
            ref={matA}
            color="#c45d72"
            emissive="#5a2038"
            emissiveIntensity={0.12}
            roughness={0.82}
            transparent
            opacity={0.82}
            depthWrite={false}
          />
        )}
      </mesh>
      <mesh geometry={lobeGeom} position={[0.02, -0.22, 0]} scale={[1.08, 1.05, 1.05]}>
        {ghost ? (
          <GhostMaterial />
        ) : (
          <meshStandardMaterial
            ref={matB}
            color="#c45d72"
            emissive="#5a2038"
            emissiveIntensity={0.12}
            roughness={0.82}
            transparent
            opacity={0.82}
            depthWrite={false}
          />
        )}
      </mesh>
    </group>
  );
}
