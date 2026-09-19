// "Pick me" lights of the chip rail (TERMINAL.md §6.3): when no chip has been
// loaded for a while, the cartridge faces glow in slow, soft casino patterns.
// Pure: a face brightness 0..1 per slot at a given time.

/** How long one pattern runs before the next one takes over, in beats. */
export const ATTRACT_PATTERN_BEATS = 12;

type Pattern = (slot: number, slots: number, t: number, step: number) => number;

/**
 * A soft lamp: rises and falls over two beats around `phase` 0 (a raised
 * cosine), so neighbours overlap and the light glides instead of blinking.
 */
const beat = (phase: number): number => (Math.abs(phase) >= 1.5 ? 0 : 0.5 + 0.5 * Math.cos((phase / 1.5) * Math.PI));

/** Distance on a loop of `n` beats, wrapped to [-n/2, n/2). */
const wrap = (v: number, n: number): number => ((((v + n / 2) % n) + n) % n) - n / 2;

const PATTERNS: readonly Pattern[] = [
  // A light gliding left to right.
  (slot, n, t, step) => beat(wrap(t / step - slot, n + 2)),
  // From the centre out to both edges.
  (slot, n, t, step) => {
    const mid = (n - 1) / 2;
    return beat(wrap(t / step - Math.abs(slot - mid), Math.ceil(mid) + 3));
  },
  // Every other one, crossfading.
  (slot, _n, t, step) => 0.5 + 0.5 * Math.cos((t / (step * 4)) * Math.PI * 2 + (slot % 2) * Math.PI),
  // All together, breathing.
  (_slot, _n, t, step) => 0.5 - 0.5 * Math.cos((t / (step * 6)) * Math.PI * 2),
  // A light gliding right to left.
  (slot, n, t, step) => beat(wrap(t / step - (n - 1 - slot), n + 2)),
];

export const ATTRACT_PATTERNS = PATTERNS.length;

/** Brightness 0..1 of `slot` out of `slots`, `t` seconds into the attract loop; `step` is one beat. */
export function attractLevel(slot: number, slots: number, t: number, step: number): number {
  if (t < 0 || step <= 0) return 0;
  const span = ATTRACT_PATTERN_BEATS * step;
  const index = Math.floor(t / span) % PATTERNS.length;
  const local = t - Math.floor(t / span) * span;
  const pattern = PATTERNS[index] as Pattern;
  // Patterns fade in over their first beat and out over their last, so a switch never snaps.
  const fade = Math.min(1, local / step, (span - local) / step);
  return Math.max(0, Math.min(1, pattern(slot, slots, local, step) * fade));
}

/** Which pattern runs `t` seconds into the loop, at `step` seconds per beat. */
export function attractPattern(t: number, step: number): number {
  return Math.floor(Math.max(0, t) / (ATTRACT_PATTERN_BEATS * step)) % PATTERNS.length;
}
