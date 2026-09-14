import { Suspense, useEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useStore } from "../state/store";
import type { ViewId } from "../state/store";
import { Anatomy3D } from "./Anatomy3D";
import { HarmonicsView } from "./HarmonicsView";
import { PitchRibbon } from "./PitchRibbon";
import { demoSnapshot, getDemoElapsed } from "../anatomy/demo";

const PRESETS: Record<ViewId, { pos: [number, number, number]; target: [number, number, number] }> = {
  anatomy: { pos: [2.15, 0.95, 4.35], target: [0.45, 0.78, 0] },
  harmonics: { pos: [0, 1.8, 8.2], target: [0, 0.1, 0] },
  pitch: { pos: [0, 0, 7.4], target: [0, 0, 0] },
};

type ControlsHandle = {
  target: THREE.Vector3;
  update?: () => void;
  enabled: boolean;
};

type OrbitState = {
  dragging: boolean;
  /** user orbited/zoomed; scripted demo camera yields until the demo restarts */
  userOwned: boolean;
};

function applyLook(
  camera: THREE.Camera,
  controls: ControlsHandle | null,
  pos: [number, number, number],
  target: [number, number, number],
  k: number,
  scratchPos: THREE.Vector3,
  scratchTarget: THREE.Vector3,
  orbitUpdate: boolean,
) {
  camera.up.set(0, 1, 0);
  camera.position.lerp(scratchPos.set(...pos), k);
  scratchTarget.set(...target);
  if (controls?.target) controls.target.lerp(scratchTarget, k);
  camera.lookAt(controls?.target ?? scratchTarget);
  if (orbitUpdate) controls?.update?.();
}

function snapLook(
  camera: THREE.Camera,
  controls: ControlsHandle | null,
  pos: [number, number, number],
  target: [number, number, number],
) {
  camera.up.set(0, 1, 0);
  camera.position.set(...pos);
  if (controls?.target) controls.target.set(...target);
  camera.lookAt(target[0], target[1], target[2]);
}

function CameraRig({ view }: { view: ViewId }) {
  const demoActive = useStore((s) => s.demoActive);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as ControlsHandle | null;
  useEffect(() => {
    if (view === "anatomy" && demoActive) return;
    const preset = PRESETS[view];
    snapLook(camera, controls, preset.pos, preset.target);
  }, [view, demoActive, camera, controls]);
  return null;
}

function DemoCameraRig({ orbit }: { orbit: MutableRefObject<OrbitState> }) {
  const demoActive = useStore((s) => s.demoActive);
  const view = useStore((s) => s.view);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as ControlsHandle | null;
  const snapped = useRef(false);
  const restoring = useRef(false);
  const scratchPos = useMemo(() => new THREE.Vector3(), []);
  const scratchTarget = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, dt) => {
    const elapsed = getDemoElapsed(demoActive, state.clock.elapsedTime);
    if (view !== "anatomy") {
      snapped.current = false;
      restoring.current = false;
      orbit.current.userOwned = false;
      return;
    }
    if (demoActive) {
      restoring.current = true;
      // Keep ticking the demo clock, but don't steal the view once the user orbits.
      if (orbit.current.userOwned || orbit.current.dragging) {
        snapped.current = true;
        return;
      }
      const cam = demoSnapshot(elapsed).camera;
      if (!snapped.current) {
        snapLook(camera, controls, cam.pos, cam.target);
        snapped.current = true;
        return;
      }
      const k = 1 - Math.exp(-2.6 * dt);
      applyLook(camera, controls, cam.pos, cam.target, k, scratchPos, scratchTarget, false);
      return;
    }
    snapped.current = false;
    orbit.current.userOwned = false;
    if (!restoring.current) return;
    const preset = PRESETS.anatomy;
    const k = 1 - Math.exp(-2.2 * dt);
    applyLook(camera, controls, preset.pos, preset.target, k, scratchPos, scratchTarget, true);
    if (camera.position.distanceTo(scratchPos.set(...preset.pos)) < 0.04) {
      restoring.current = false;
    }
  });
  return null;
}

export function StageCanvas() {
  const view = useStore((s) => s.view);
  const orbit = useRef<OrbitState>({ dragging: false, userOwned: false });

  return (
    <Canvas camera={{ position: [0, 0.2, 7.6], fov: 42 }} dpr={[1, 2]} gl={{ antialias: true }}>
      <color attach="background" args={["#0a0e1a"]} />
      <fog attach="fog" args={["#0a0e1a", 12, 26]} />
      <hemisphereLight args={["#ffe8d6", "#0b1220", 0.55]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[4.5, 7, 5]} intensity={1.25} color="#fff4ea" />
      <directionalLight position={[-3, 2, -4]} intensity={0.35} color="#6fb1ff" />
      <pointLight position={[2.2, 1.4, 2.5]} intensity={0.45} color="#ffd4c0" />
      <Suspense fallback={null}>
        {view === "anatomy" && <Anatomy3D />}
        {view === "harmonics" && <HarmonicsView />}
        {view === "pitch" && <PitchRibbon />}
      </Suspense>
      <CameraRig view={view} />
      <DemoCameraRig orbit={orbit} />
      <OrbitControls
        makeDefault
        enablePan={false}
        enableRotate
        enableZoom
        minDistance={2.4}
        maxDistance={16}
        enableDamping
        dampingFactor={0.08}
        onStart={() => {
          orbit.current.dragging = true;
          orbit.current.userOwned = true;
        }}
        onEnd={() => {
          orbit.current.dragging = false;
        }}
      />
    </Canvas>
  );
}
