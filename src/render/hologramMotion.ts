/** A shallow floor projection begins beyond the feet and ends before the panel edge. */
export function reflectionFootprint(
  feetZ: number,
  cellDepth: number,
  out: { start: number; end: number; center: number; depth: number } = { start: 0, end: 0, center: 0, depth: 0 },
): { start: number; end: number; center: number; depth: number } {
  const start = feetZ + cellDepth * 0.055;
  const end = feetZ + cellDepth * 0.305;
  out.start = start;
  out.end = end;
  out.center = (start + end) / 2;
  out.depth = end - start;
  return out;
}

/** Screen-facing lean and phase breakup rise during a step and settle on landing. */
export function hologramMotion(
  dx: number,
  dy: number,
  progress: number,
  out: { leanX: number; pitch: number; distortion: number } = { leanX: 0, pitch: 0, distortion: 0 },
): { leanX: number; pitch: number; distortion: number } {
  const phase = progress <= 0 || progress >= 1 ? 0 : Math.sin(Math.PI * progress);
  out.leanX = dx * 0.38 * phase;
  out.pitch = dy * 0.28 * phase;
  out.distortion = phase;
  return out;
}
