// Shared live anatomy pose so the 2D vocal-cords inset can match the 3D model
// without extra React state. Anatomy3D writes this every frame.

import { neutralPose, type AnatomyPose } from "./pose";

export const poseBus: {
  you: AnatomyPose;
  glot: number;
  /** Glottis position in the canvas, 0..1. */
  nx: number;
  ny: number;
} = {
  you: neutralPose(),
  glot: 0,
  nx: 0.32,
  ny: 0.5,
};
