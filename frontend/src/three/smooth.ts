// Frame-rate-independent exponential smoothing toward a target.
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function mapRange(
  v: number,
  inLo: number,
  inHi: number,
  outLo: number,
  outHi: number,
): number {
  const t = clamp((v - inLo) / (inHi - inLo), 0, 1);
  return outLo + t * (outHi - outLo);
}
