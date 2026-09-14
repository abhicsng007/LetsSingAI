// Scrolling intonation view: your live pitch flows right-to-left, colored by
// how far off you are (green = in tune, warm = off). Faint horizontal bands
// mark the reference song's target notes so you can see where you land.

import { useMemo, useRef } from "react";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { liveFrame } from "../audio/featureBus";
import { getCurrentSong, pitchStaffRange } from "../data/songs";
import { useStore } from "../state/store";
import { freqToMidi, midiToNoteName } from "../analysis/pitch";
import { mapRange } from "./smooth";
import { LISTENER } from "../analysis/humanPitch";

const WINDOW = 6; // seconds visible
const MAX_POINTS = 400;

function midiToY(midi: number, lo: number, hi: number): number {
  return mapRange(midi, lo, hi, -2.35, 2.35);
}

export function PitchRibbon() {
  const geomRef = useRef<THREE.BufferGeometry>(null);
  const positions = useMemo(() => new Float32Array(MAX_POINTS * 3), []);
  const colors = useMemo(() => new Float32Array(MAX_POINTS * 3), []);
  const hist = useRef<{ t: number; midi: number; cents: number; targetMidi: number | null }[]>([]);

  const songId = useStore((s) => s.songId);
  const verifyPlaying = useStore((s) => s.verifyPlaying);
  const song = getCurrentSong();
  const transpose = verifyPlaying ? (song.vocalTranspose ?? 0) : 0;
  const staff = useMemo(() => pitchStaffRange(song, transpose), [songId, transpose]);
  const targetMidis = useMemo(() => {
    const set = new Set<number>();
    for (const n of song.notes) set.add(n.midi + transpose);
    return [...set].sort((a, b) => a - b);
  }, [songId, transpose]);
  useFrame(() => {
    const now = performance.now() / 1000;
    const f = liveFrame.current;
    if (f.hasPitch) {
      const err = f.melodyCents ?? f.cents;
      const targetMidi =
        f.targetF0 > 0 ? freqToMidi(f.targetF0) : null;
      hist.current.push({ t: now, midi: f.midi, cents: err, targetMidi });
    }
    // drop samples older than the window
    while (hist.current.length > 0 && now - hist.current[0].t > WINDOW) {
      hist.current.shift();
    }
    if (hist.current.length > MAX_POINTS) {
      hist.current.splice(0, hist.current.length - MAX_POINTS);
    }

    const geom = geomRef.current;
    if (!geom) return;
    const samples = hist.current;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const age = now - s.t;
      const x = mapRange(age, 0, WINDOW, 4.2, -4.2);
      positions[i * 3] = x;
      positions[i * 3 + 1] = midiToY(s.midi, staff.lo, staff.hi);
      positions[i * 3 + 2] = 0.05;
      // stay green through the listener in-tune window, then warm toward a semitone
      const abs = Math.abs(s.cents);
      const off =
        abs <= LISTENER.inTuneCents
          ? 0
          : Math.min(
              1,
              (abs - LISTENER.inTuneCents) /
                (LISTENER.wrongNoteCents - LISTENER.inTuneCents),
            );
      const c = new THREE.Color().setHSL(mapRange(off, 0, 1, 0.35, 0.0), 0.85, 0.55);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geom.setDrawRange(0, samples.length);
    (geom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geom.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  });

  return (
    <group>
      {/* target note bands + labels */}
      {targetMidis.map((m) => {
        const y = midiToY(m, staff.lo, staff.hi);
        return (
          <group key={m}>
            <mesh position={[0, y, 0]}>
              <boxGeometry args={[9, 0.018, 0.02]} />
              <meshBasicMaterial color="#3f6dd8" transparent opacity={0.38} />
            </mesh>
            <Html position={[5.05, y, 0]} center distanceFactor={14} pointerEvents="none">
              <div className="axis-label note-lab">{midiToNoteName(m)}</div>
            </Html>
          </group>
        );
      })}

      {/* "now" marker */}
      <mesh position={[4.2, 0, 0]}>
        <boxGeometry args={[0.02, 4.8, 0.02]} />
        <meshBasicMaterial color="#5eead4" transparent opacity={0.5} />
      </mesh>

      {/* live pitch trail */}
      <points>
        <bufferGeometry ref={geomRef}>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.16} vertexColors sizeAttenuation transparent />
      </points>

      {/* current melody target at the "now" edge */}
      <TargetDot lo={staff.lo} hi={staff.hi} />
    </group>
  );
}

function TargetDot({ lo, hi }: { lo: number; hi: number }) {
  const mesh = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const f = liveFrame.current;
    const m = mesh.current;
    if (!m) return;
    if (f.targetF0 > 0) {
      m.visible = true;
      m.position.y = midiToY(freqToMidi(f.targetF0), lo, hi);
    } else {
      m.visible = false;
    }
  });
  return (
    <mesh ref={mesh} position={[4.2, 0, 0.08]} visible={false}>
      <sphereGeometry args={[0.12, 16, 16]} />
      <meshBasicMaterial color="#5eead4" />
    </mesh>
  );
}
