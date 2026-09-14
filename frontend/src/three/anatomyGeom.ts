// Procedural anatomical geometries for the singing-instrument model.
// Oral-cavity pieces share the landmarks in anatomy/pose.ts so the tract
// reads as one connected instrument (palate → velum → pharynx → tongue →
// teeth → lips), not a pile of independent blobs.

import * as THREE from "three";
import type { AnatomyPose } from "../anatomy/pose";
import { TMJ, REST, tongueCenterline, lipRingPose } from "../anatomy/pose";

function lathe(xy: [number, number][], segments = 48): THREE.LatheGeometry {
  const pts = xy.map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, segments);
  g.computeVertexNormals();
  return g;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function radiusAtY(profile: [number, number][], y: number): number {
  if (y >= profile[0][1]) return profile[0][0];
  const last = profile[profile.length - 1];
  if (y <= last[1]) return last[0];
  for (let i = 0; i < profile.length - 1; i++) {
    const y0 = profile[i][1];
    const y1 = profile[i + 1][1];
    if (y <= y0 && y >= y1) {
      const t = (y0 - y) / (y0 - y1);
      return lerp(profile[i][0], profile[i + 1][0], t);
    }
  }
  return last[0];
}

/**
 * Single-face head. A lathe of the sagittal profile used to spin the nose
 * and lips a full 360°, so a side view showed two faces. This sweep uses a
 * facial profile only on +X (where the lip meshes sit) and a round cranium
 * on the back and sides.
 *
 * Head-local units: +X anterior, +Y up. The mesh is placed at x=0.15 in
 * Anatomy3D, so mouth radius 1.83 lands on the lip meshes at group x≈1.98.
 */
export function headGeometry(): THREE.BufferGeometry {
  // [radius, y] — y from crown down to neck. Same y-span as the old lathe.
  const front: [number, number][] = [
    [0.03, 2.60],
    [0.48, 2.52],
    [0.88, 2.38],
    [1.12, 2.16],
    [1.20, 2.04],
    [1.24, 1.80], // brow
    [1.16, 1.62], // glabella
    [1.34, 1.50], // bridge
    [1.78, 1.42], // nose upper
    [1.95, 1.38], // nose tip (just anterior of the lips)
    [1.52, 1.28], // subnasal
    [1.68, 1.18], // philtrum
    [1.83, 1.10], // mouth — aligned with lip meshes
    [1.72, 1.02], // lower lip
    [1.50, 0.90],
    [1.40, 0.80], // chin
    [0.86, 0.68],
    [0.56, 0.42],
    [0.50, 0.18],
    [0.50, 0.08],
  ];
  // Skull without nose/lips, used for sides and as the front cranial base.
  const cranium: [number, number][] = [
    [0.03, 2.60],
    [0.48, 2.52],
    [0.88, 2.38],
    [1.12, 2.16],
    [1.20, 2.04],
    [1.22, 1.80],
    [1.18, 1.62],
    [1.16, 1.50],
    [1.14, 1.42],
    [1.14, 1.38],
    [1.12, 1.28],
    [1.12, 1.18],
    [1.10, 1.10],
    [1.08, 1.02],
    [1.02, 0.90],
    [0.92, 0.80],
    [0.72, 0.68],
    [0.54, 0.42],
    [0.50, 0.18],
    [0.50, 0.08],
  ];
  const side: [number, number][] = [
    [0.03, 2.60],
    [0.46, 2.52],
    [0.82, 2.38],
    [1.06, 2.16],
    [1.14, 2.04],
    [1.18, 1.80],
    [1.16, 1.62],
    [1.14, 1.50],
    [1.12, 1.42],
    [1.12, 1.38],
    [1.12, 1.28],
    [1.10, 1.18],
    [1.08, 1.10],
    [1.04, 1.02],
    [0.98, 0.90],
    [0.88, 0.80],
    [0.70, 0.68],
    [0.54, 0.42],
    [0.50, 0.18],
    [0.50, 0.08],
  ];
  const back: [number, number][] = [
    [0.03, 2.60],
    [0.50, 2.52],
    [0.90, 2.38],
    [1.14, 2.16],
    [1.20, 2.04],
    [1.20, 1.80],
    [1.16, 1.62],
    [1.12, 1.50],
    [1.10, 1.42],
    [1.08, 1.38],
    [1.06, 1.28],
    [1.04, 1.18],
    [1.02, 1.10],
    [0.98, 1.02],
    [0.92, 0.90],
    [0.84, 0.80],
    [0.68, 0.68],
    [0.52, 0.42],
    [0.48, 0.18],
    [0.48, 0.08],
  ];

  const yTop = front[0][1];
  const yBot = front[front.length - 1][1];
  const rows = 56;
  const radialSegs = 64;
  const widthScale = 0.86; // slightly oval skull (narrower left-right)
  const positions: number[] = [];
  const uvs: number[] = [];

  for (let j = 0; j < radialSegs; j++) {
    const theta = (j / radialSegs) * Math.PI * 2;
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    const ang = Math.acos(Math.min(1, Math.max(-1, ct))); // 0 at front, π at back

    for (let i = 0; i < rows; i++) {
      const y = lerp(yTop, yBot, i / (rows - 1));
      let cranial: number;
      if (ang <= Math.PI / 2) {
        cranial = lerp(
          radiusAtY(cranium, y),
          radiusAtY(side, y),
          smoothstep(ang / (Math.PI / 2)),
        );
      } else {
        cranial = lerp(
          radiusAtY(side, y),
          radiusAtY(back, y),
          smoothstep((ang - Math.PI / 2) / (Math.PI / 2)),
        );
      }
      const extra = radiusAtY(front, y) - radiusAtY(cranium, y);
      // Nose is a narrow peak; mouth/chin spread a little wider.
      const noseBand = Math.exp(-(((y - 1.38) / 0.13) ** 2));
      const power = 2.6 + 4.2 * noseBand;
      const face = extra * Math.pow(Math.max(0, ct), power);
      // Indent the rima oris so the lips/teeth/cavity sit in a real opening
      // instead of on a closed face.
      const mouthBand = Math.exp(-(((y - 1.09) / 0.075) ** 2));
      const mouthInset = 0.20 * mouthBand * Math.pow(Math.max(0, ct), 1.6);
      const r = cranial + face - mouthInset;
      positions.push(r * ct, y, r * st * widthScale);
      uvs.push(j / radialSegs, 1 - i / (rows - 1));
    }
  }

  const indices: number[] = [];
  for (let j = 0; j < radialSegs; j++) {
    const jn = (j + 1) % radialSegs;
    for (let i = 0; i < rows - 1; i++) {
      const a = j * rows + i;
      const b = jn * rows + i;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** Fleshy nose on the +X face, sitting on the head's nasal ridge. */
export function noseGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.13, 16, 12);
  g.scale(1.45, 0.88, 0.52);
  g.translate(0.10, -0.02, 0);
  g.computeVertexNormals();
  return g;
}

export function torsoGeometry(): THREE.LatheGeometry {
  return lathe(
    [
      [0.5, 0.1],
      [0.78, -0.25],
      [1.12, -0.7],
      [1.28, -1.2],
      [1.32, -1.7],
      [1.22, -2.15],
      [1.02, -2.48],
      [0.55, -2.62],
      [0.08, -2.64],
    ],
    48,
  );
}

/** Pear-shaped lung lobe (Y-up). Instanced twice per side as upper/lower. */
export function lungLobeGeometry(): THREE.LatheGeometry {
  return lathe(
    [
      [0.02, 0.55],
      [0.18, 0.5],
      [0.34, 0.32],
      [0.4, 0.05],
      [0.38, -0.28],
      [0.26, -0.5],
      [0.08, -0.58],
      [0.02, -0.6],
    ],
    28,
  );
}

/** Muscle dome of the diaphragm — hemisphere we flatten via scale.y. */
export function diaphragmGeometry(): THREE.SphereGeometry {
  const g = new THREE.SphereGeometry(0.95, 36, 18, 0, Math.PI * 2, 0, Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

/** Thyroid cartilage (Adam's apple) — shield lathed then flattened. */
export function thyroidGeometry(): THREE.LatheGeometry {
  const g = lathe(
    [
      [0.04, 0.16],
      [0.14, 0.14],
      [0.18, 0.04],
      [0.16, -0.08],
      [0.1, -0.14],
      [0.03, -0.16],
    ],
    28,
  );
  g.scale(1, 1, 0.72);
  return g;
}

export function foldGeometry(): THREE.CapsuleGeometry {
  const g = new THREE.CapsuleGeometry(0.028, 0.16, 6, 12);
  g.rotateZ(Math.PI / 2); // anterior-posterior
  g.computeVertexNormals();
  return g;
}

export const TONGUE_LEN = 24;
export const TONGUE_RAD = 14;

/** Empty deformable tongue grid. Vertex positions are written by `shapeTongue`. */
export function tongueGeometry(): THREE.BufferGeometry {
  const cols = TONGUE_LEN + 1;
  const rows = TONGUE_RAD + 1;
  const grid = cols * rows;
  const positions = new Float32Array((grid + 2) * 3);
  const uvs = new Float32Array((grid + 2) * 2);
  const indices: number[] = [];
  for (let i = 0; i < TONGUE_LEN; i++) {
    for (let j = 0; j < TONGUE_RAD; j++) {
      const a = i * rows + j;
      const b = a + rows;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const root = grid;
  const tip = grid + 1;
  for (let j = 0; j < TONGUE_RAD; j++) {
    indices.push(root, j + 1, j);
    const t0 = TONGUE_LEN * rows + j;
    indices.push(tip, t0, t0 + 1);
  }
  for (let i = 0; i <= TONGUE_LEN; i++) {
    for (let j = 0; j <= TONGUE_RAD; j++) {
      const k = i * rows + j;
      uvs[k * 2] = i / TONGUE_LEN;
      uvs[k * 2 + 1] = j / TONGUE_RAD;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  g.setIndex(indices);
  return g;
}

function catmull2(pts: [number, number][], t: number): [number, number] {
  const n = pts.length - 1;
  const u = Math.min(1, Math.max(0, t)) * n;
  const i = Math.min(Math.floor(u), n - 1);
  const f = u - i;
  const p0 = pts[Math.max(0, i - 1)];
  const p1 = pts[i];
  const p2 = pts[Math.min(n, i + 1)];
  const p3 = pts[Math.min(n, i + 2)];
  const f2 = f * f;
  const f3 = f2 * f;
  return [
    0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * f + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * f2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * f3),
    0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * f + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * f2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * f3),
  ];
}

const _t = new THREE.Vector3();
const _n = new THREE.Vector3();
const _b = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Fit the tongue into the oral cavity for this pose: root stays on the hyoid,
 * tip stays at the lower incisors, dorsum aims at the palate. Writes vertices
 * in Anatomy3D group space (mesh sits at the origin).
 */
export function shapeTongue(geo: THREE.BufferGeometry, p: AnatomyPose): void {
  const ctrl = tongueCenterline(p);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const cols = TONGUE_LEN + 1;
  const rows = TONGUE_RAD + 1;

  const samples: { x: number; y: number; tx: number; ty: number }[] = [];
  for (let i = 0; i < cols; i++) {
    const t = i / TONGUE_LEN;
    const [x, y] = catmull2(ctrl, t);
    const t2 = t < 1 ? Math.min(1, t + 0.03) : t - 0.03;
    const [x2, y2] = catmull2(ctrl, t2);
    let tx = x2 - x;
    let ty = y2 - y;
    if (t >= 1) {
      tx = -tx;
      ty = -ty;
    }
    const len = Math.hypot(tx, ty) || 1;
    samples.push({ x, y, tx: tx / len, ty: ty / len });
  }

  for (let i = 0; i < cols; i++) {
    const t = i / TONGUE_LEN;
    const s = samples[i];
    _t.set(s.tx, s.ty, 0);
    _b.crossVectors(_t, _up);
    if (_b.lengthSq() < 1e-8) _b.set(0, 0, 1);
    else _b.normalize();
    _n.crossVectors(_b, _t).normalize();

    // Bulky root, full body, thin tip. Height is the oral-cavity fill.
    const body = Math.sin(Math.min(1, t / 0.85) * Math.PI);
    const tipFade = t > 0.82 ? (t - 0.82) / 0.18 : 0;
    const width = lerp(0.26, 0.34, body) * (1 - tipFade * 0.85);
    const height = lerp(0.15, 0.22, body) * (1 - tipFade * 0.72);

    for (let j = 0; j < rows; j++) {
      const theta = (j / TONGUE_RAD) * Math.PI * 2;
      const ct = Math.cos(theta);
      const st = Math.sin(theta);
      // Superellipse: flatter dorsum (tissue against the palate), rounder belly.
      const nrm = st >= 0 ? 2.6 : 1.7;
      const r = 1 / Math.pow(Math.pow(Math.abs(ct), nrm) + Math.pow(Math.abs(st), nrm), 1 / nrm);
      const ly = height * r * st;
      const lz = width * r * ct;
      const k = i * rows + j;
      pos.setXYZ(k, s.x + _n.x * ly + _b.x * lz, s.y + _n.y * ly + _b.y * lz, _n.z * ly + _b.z * lz);
    }
  }
  const grid = cols * rows;
  pos.setXYZ(grid, samples[0].x, samples[0].y, 0);
  const last = samples[cols - 1];
  pos.setXYZ(grid + 1, last.x, last.y, 0);
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

/** Soft-palate flap. Origin is the hinge at the posterior hard palate; the body hangs posterior (-X) toward the pharynx. */
export function velumGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.15, 16, 12);
  g.scale(2.15, 0.32, 0.92);
  g.translate(-0.28, -0.04, 0);
  g.computeVertexNormals();
  return g;
}

export function epiglottisGeometry(): THREE.SphereGeometry {
  const g = new THREE.SphereGeometry(0.11, 14, 12);
  g.scale(0.55, 1.35, 0.22);
  g.computeVertexNormals();
  return g;
}

/** Mandible in jaw-local space (origin = TMJ). Inferior border + rami as one U. */
export function mandibleGeometry(): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector3(0.00, 0.02, 0.70),
    new THREE.Vector3(0.08, -0.30, 0.64),
    new THREE.Vector3(0.34, -0.70, 0.50),
    new THREE.Vector3(0.78, -0.54, 0.28),
    new THREE.Vector3(1.12, -0.48, 0.00),
    new THREE.Vector3(0.78, -0.54, -0.28),
    new THREE.Vector3(0.34, -0.70, -0.50),
    new THREE.Vector3(0.08, -0.30, -0.64),
    new THREE.Vector3(0.00, 0.02, -0.70),
  ];
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 56, 0.055, 8, false);
  g.computeVertexNormals();
  return g;
}

/** Chin → lower incisors (the missing front of the jaw). Jaw-local. */
export function mandibleFrontGeometry(): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector3(1.12, -0.48, 0),
    new THREE.Vector3(1.28, -0.32, 0),
    new THREE.Vector3(1.40, -0.18, 0),
  ];
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.05, 8, false);
  g.computeVertexNormals();
  return g;
}

/** Alveolar ridge (where the lower teeth sit), jaw-local. */
export function alveolarGeometry(): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector3(0.58, -0.22, 0.44),
    new THREE.Vector3(1.05, -0.16, 0.24),
    new THREE.Vector3(1.40, -0.17, 0.00),
    new THREE.Vector3(1.05, -0.16, -0.24),
    new THREE.Vector3(0.58, -0.22, -0.44),
  ];
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.05, 8, false);
  g.computeVertexNormals();
  return g;
}

/** Floor of mouth (mylohyoid), jaw-local — ties the tongue root to the mandible. */
export function oralFloorGeometry(): THREE.BufferGeometry {
  const hyoid = new THREE.Vector3(REST.hyoid[0] - TMJ.x, REST.hyoid[1] - TMJ.y, 0);
  const arch: [number, number, number][] = [
    [0.58, -0.28, 0.40],
    [0.95, -0.30, 0.22],
    [1.20, -0.32, 0.00],
    [0.95, -0.30, -0.22],
    [0.58, -0.28, -0.40],
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  const n = arch.length;
  positions.push(hyoid.x, hyoid.y, 0);
  for (const p of arch) positions.push(...p);
  for (let i = 0; i < n - 1; i++) indices.push(0, i + 1, i + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

export function hyoidGeometry(): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector3(0, 0, 0.16),
    new THREE.Vector3(0.07, 0.01, 0),
    new THREE.Vector3(0, 0, -0.16),
  ];
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.022, 6, false);
  g.computeVertexNormals();
  return g;
}

/** Vaulted hard palate (roof of the mouth / floor of the nose). */
export function hardPalateGeometry(): THREE.BufferGeometry {
  const ulen = 18;
  const vlen = 10;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= ulen; i++) {
    const u = i / ulen;
    for (let j = 0; j <= vlen; j++) {
      const v = (j / vlen) * 2 - 1;
      const x = 0.78 + u * 1.04;
      const z = v * (0.18 + 0.12 * u);
      const vault = 0.085 * Math.sin(u * Math.PI) * (1 - v * v * 0.45);
      const y = 1.225 + vault + (1 - u) * 0.02;
      positions.push(x, y, z);
    }
  }
  const cols = vlen + 1;
  for (let i = 0; i < ulen; i++) {
    for (let j = 0; j < vlen; j++) {
      const a = i * cols + j;
      const b = a + cols;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** Posterior + lateral pharyngeal wall, open toward the mouth. */
export function pharynxGeometry(): THREE.CylinderGeometry {
  const g = new THREE.CylinderGeometry(0.30, 0.24, 1.32, 22, 1, true, Math.PI * 0.52, Math.PI * 0.96);
  g.translate(0.48, 0.74, 0);
  g.computeVertexNormals();
  return g;
}

/** Nasal passage sitting on the hard palate, ending at the nostril. */
export function nasalCavityGeometry(): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.52, 1.36, 0),
    new THREE.Vector3(0.92, 1.42, 0),
    new THREE.Vector3(1.38, 1.38, 0),
    new THREE.Vector3(1.72, 1.34, 0),
    new THREE.Vector3(1.94, 1.32, 0),
  ]);
  const g = new THREE.TubeGeometry(curve, 40, 0.095, 12, false);
  g.computeVertexNormals();
  return g;
}

export const LIP_RING = 40;
export const LIP_TUBE = 12;

/** Empty deformable mouth ring. Vertex positions are written by `shapeLipRing`. */
export function lipGeometry(): THREE.BufferGeometry {
  const cols = LIP_RING + 1;
  const rows = LIP_TUBE + 1;
  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const indices: number[] = [];
  for (let i = 0; i < LIP_RING; i++) {
    for (let j = 0; j < LIP_TUBE; j++) {
      const a = i * rows + j;
      const b = a + rows;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  for (let i = 0; i <= LIP_RING; i++) {
    for (let j = 0; j <= LIP_TUBE; j++) {
      const k = i * rows + j;
      uvs[k * 2] = i / LIP_RING;
      uvs[k * 2 + 1] = j / LIP_TUBE;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  g.setIndex(indices);
  return g;
}

const _lt = new THREE.Vector3();
const _ln = new THREE.Vector3();
const _lb = new THREE.Vector3(1, 0, 0);

/**
 * Fit the lip ring to this pose: an elliptical aperture in the face plane
 * (YZ), hole facing +X. High notes collect into a smaller O; low / open
 * vowels drop into a taller oval; rounding makes a circle and protrudes.
 */
export function shapeLipRing(geo: THREE.BufferGeometry, p: AnatomyPose): void {
  const ring = lipRingPose(p);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const cols = LIP_RING + 1;
  const rows = LIP_TUBE + 1;

  for (let i = 0; i < cols; i++) {
    const theta = (i / LIP_RING) * Math.PI * 2;
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    const ez = ring.rx * ct;
    const ey = ring.ry * st;
    _lt.set(0, ring.ry * ct, -ring.rx * st);
    if (_lt.lengthSq() < 1e-10) _lt.set(0, 1, 0);
    else _lt.normalize();
    _ln.copy(_lb).cross(_lt).normalize();

    // Slight extra anterior on the upper lip so the side view reads as a mouth.
    const xBias = Math.max(0, st) * 0.018;

    for (let j = 0; j < rows; j++) {
      const phi = (j / LIP_TUBE) * Math.PI * 2;
      const cp = Math.cos(phi);
      const sp = Math.sin(phi);
      const k = i * rows + j;
      pos.setXYZ(
        k,
        ring.x + xBias + _ln.x * ring.tube * cp + _lb.x * ring.tube * sp,
        ring.y + ey + _ln.y * ring.tube * cp + _lb.y * ring.tube * sp,
        ez + _ln.z * ring.tube * cp + _lb.z * ring.tube * sp,
      );
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

export function tracheaGeometry(): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(0.11, 0.13, 1.15, 20);
}

export function tracheaRingGeometry(): THREE.TorusGeometry {
  return new THREE.TorusGeometry(0.125, 0.018, 8, 18);
}

export function ribGeometry(): THREE.TorusGeometry {
  return new THREE.TorusGeometry(0.95, 0.022, 6, 28, Math.PI * 0.85);
}

export function vertebraGeometry(): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(0.07, 0.08, 0.12, 8);
}

const cache: Record<string, THREE.BufferGeometry> = {};

export function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  if (!cache[key]) cache[key] = make();
  return cache[key] as T;
}
