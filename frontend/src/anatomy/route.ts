// Arc-length parametrized polyline, used to move airflow particles and sound
// pulses smoothly along the airway.

import type { Pt } from "./geometry";

export interface Route {
  pts: Pt[];
  cum: number[]; // cumulative length at each point
  length: number;
}

export function buildRoute(points: Pt[]): Route {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  return { pts: points, cum, length: cum[cum.length - 1] };
}

export interface RoutePoint {
  x: number;
  y: number;
  angle: number; // tangent direction
}

export function pointAt(route: Route, dist: number): RoutePoint {
  const { pts, cum } = route;
  const d = Math.max(0, Math.min(route.length, dist));
  let i = 1;
  while (i < cum.length && cum[i] < d) i++;
  const a = pts[i - 1];
  const b = pts[Math.min(i, pts.length - 1)];
  const segLen = cum[Math.min(i, cum.length - 1)] - cum[i - 1] || 1;
  const t = (d - cum[i - 1]) / segLen;
  return {
    x: a[0] + (b[0] - a[0]) * t,
    y: a[1] + (b[1] - a[1]) * t,
    angle: Math.atan2(b[1] - a[1], b[0] - a[0]),
  };
}
