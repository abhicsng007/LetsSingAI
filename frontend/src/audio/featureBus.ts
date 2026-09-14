// A single mutable holder for the latest analysis frame.
//
// The 3D views read `liveFrame.current` imperatively inside their render loop
// (useFrame) so that 60fps visual updates never trigger React re-renders. The
// UI reads a throttled copy from the zustand store instead.

import type { FeatureFrame } from "./types";
import { emptyFrame } from "./types";

export const liveFrame: { current: FeatureFrame } = { current: emptyFrame() };

// Dev-only hook so the anatomy/visuals can be driven with synthetic frames
// from the console without a live microphone.
if (import.meta.env.DEV) {
  (globalThis as unknown as { __liveFrame?: typeof liveFrame }).__liveFrame = liveFrame;
}
