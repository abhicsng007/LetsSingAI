// Harmonic-series comparison in 3D: your live overtone balance (front row)
// against the reference song's ideal timbre (back row). Seeing which harmonics
// are weak/strong explains *why* two voices on the same pitch sound different.

import { useMemo, useRef } from "react";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { liveFrame } from "../audio/featureBus";
import { HARMONIC_COUNT } from "../audio/types";
import { getCurrentSong } from "../data/songs";
import { useStore } from "../state/store";
import { damp } from "./smooth";

const MAX_H = 2.6;
const SPACING = 0.92;

function meanReferenceHarmonics(): number[] {
  const acc = new Array<number>(HARMONIC_COUNT).fill(0);
  const frames = getCurrentSong().frames;
  for (const f of frames) for (let i = 0; i < HARMONIC_COUNT; i++) acc[i] += f.harmonics[i];
  return acc.map((v) => v / Math.max(1, frames.length));
}

export function HarmonicsView() {
  const userBars = useRef<THREE.Mesh[]>([]);
  const smooth = useRef<number[]>(new Array(HARMONIC_COUNT).fill(0));
  const songId = useStore((s) => s.songId);
  const refHarm = useMemo(meanReferenceHarmonics, [songId]);

  const xs = useMemo(
    () =>
      Array.from(
        { length: HARMONIC_COUNT },
        (_, i) => (i - (HARMONIC_COUNT - 1) / 2) * SPACING,
      ),
    [],
  );

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const h = liveFrame.current.harmonics;
    for (let i = 0; i < HARMONIC_COUNT; i++) {
      smooth.current[i] = damp(smooth.current[i], h[i] ?? 0, 9, dt);
      const mesh = userBars.current[i];
      if (!mesh) continue;
      const height = Math.max(0.02, smooth.current[i] * MAX_H);
      mesh.scale.y = height;
      mesh.position.y = height / 2;
    }
  });

  return (
    <group position={[0, -1.3, 0]}>
      {/* ground grid */}
      <gridHelper args={[10, 10, "#2a3550", "#1b2337"]} position={[0, 0, 0]} />

      {xs.map((x, i) => {
        const refH = Math.max(0.02, refHarm[i] * MAX_H);
        const color = new THREE.Color().setHSL(0.58 - i * 0.05, 0.7, 0.55);
        return (
          <group key={i}>
            {/* reference (target timbre) */}
            <mesh position={[x, refH / 2, -0.6]} scale={[1, refH, 1]}>
              <boxGeometry args={[0.55, 1, 0.55]} />
              <meshStandardMaterial
                color="#8895b5"
                transparent
                opacity={0.28}
                wireframe
              />
            </mesh>
            {/* you (live) */}
            <mesh
              ref={(m) => {
                if (m) userBars.current[i] = m;
              }}
              position={[x, 0.02, 0.6]}
            >
              <boxGeometry args={[0.55, 1, 0.55]} />
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={0.35}
                roughness={0.4}
              />
            </mesh>
            <Html position={[x, -0.35, 0]} center distanceFactor={11} pointerEvents="none">
              <div className="axis-label">H{i + 1}</div>
            </Html>
          </group>
        );
      })}

      <Html position={[-4.4, 1.4, 0.6]} center distanceFactor={11} pointerEvents="none">
        <div className="axis-label you">You</div>
      </Html>
      <Html position={[-4.4, 1.4, -0.6]} center distanceFactor={11} pointerEvents="none">
        <div className="axis-label ref">Target</div>
      </Html>
    </group>
  );
}
