// A cartridge that spent its last charge bursts into shards after it leaves
// the slot (TERMINAL.md §6.5, GDD §6.1). Pure and deterministic: every shard is
// derived from the cartridge's deal serial, never from the simulation RNG.
// Distances are in cartridge widths, so the burst looks the same at any size.

import { mix, unit, type Point3 } from './ejectArc';

/** Which part of the cartridge a shard came from: its colour. */
export type ShardPart = 'panel' | 'label' | 'body';

export interface ShardSeed {
  part: ShardPart;
  /** Start offset from the cartridge centre, in cartridge widths. */
  offset: Point3;
  /** Unit direction of the burst. */
  dir: Point3;
  /** Multiplies `SHATTER_SPEED`. */
  speed: number;
  /** Shard size, in cartridge widths. */
  size: number;
  /** Spin rates around x, y and z, in turns per second. */
  spin: readonly [number, number, number];
}

export interface ShardParams {
  /** World units per cartridge width. */
  width: number;
  /** Cartridge velocity when it burst, world units per second. */
  inherit: Point3;
  /** Burst speed and downward pull, in cartridge widths per second (squared). */
  speed: number;
  gravity: number;
  /** Life of the burst, seconds. */
  life: number;
}

export interface ShardPose extends Point3 {
  scale: number;
  rotX: number;
  rotY: number;
  rotZ: number;
}

export const SHARD_COUNT = 12;

/** Share of the burst life over which shards shrink away at the end. */
const FADE_SHARE = 0.35;

/**
 * The shards of one cartridge. Parts follow the face: the top ones carry the
 * chip colour, the middle ones the label, the rest the plastic.
 */
export function planShards(deal: number, count = SHARD_COUNT): ShardSeed[] {
  const out: ShardSeed[] = [];
  for (let i = 0; i < count; i++) {
    const h = mix(deal * 131 + i * 7919);
    const r = (k: number) => unit(mix(h + k * 0x9e3779b9));
    // Spread evenly around the centre and fly straight out from where the
    // shard sat, with a small lift, so no shard crosses the middle.
    const angle = ((i + r(1) * 0.6) / count) * Math.PI * 2;
    const c = Math.cos(angle);
    const sn = Math.sin(angle);
    const rad = 0.4 + r(2) * 0.6;
    const ox = c * rad * 0.45;
    const oy = sn * rad * 0.55;
    const part: ShardPart = oy > 0.2 ? 'panel' : oy > -0.15 ? 'label' : 'body';
    // Toward the camera, so the burst reads against the cabinet.
    const dz = 0.35 + r(3) * 0.5;
    const dx = c;
    const dy = sn + 0.35;
    const len = Math.hypot(dx, dy, dz);
    out.push({
      part,
      offset: { x: ox, y: oy, z: 0 },
      dir: { x: dx / len, y: dy / len, z: dz / len },
      speed: 0.6 + r(4) * 0.8,
      size: 0.16 + r(5) * 0.16,
      spin: [(r(6) - 0.5) * 6, (r(7) - 0.5) * 6, (r(8) - 0.5) * 8],
    });
  }
  return out;
}

/** A shard `t` seconds after the burst, relative to the burst centre in world units. */
export function shardPose(seed: ShardSeed, t: number, p: ShardParams): ShardPose {
  const w = p.width;
  const v = seed.speed * p.speed * w;
  const fall = 0.5 * p.gravity * w * t * t;
  const k = p.life > 0 ? Math.min(1, t / p.life) : 1;
  const fadeFrom = 1 - FADE_SHARE;
  const scale = seed.size * w * (k <= fadeFrom ? 1 : Math.max(0, (1 - k) / FADE_SHARE));
  const turn = Math.PI * 2 * t;
  return {
    x: seed.offset.x * w + (seed.dir.x * v + p.inherit.x) * t,
    y: seed.offset.y * w + (seed.dir.y * v + p.inherit.y) * t - fall,
    z: seed.offset.z * w + (seed.dir.z * v + p.inherit.z) * t,
    scale,
    rotX: seed.spin[0] * turn,
    rotY: seed.spin[1] * turn,
    rotZ: seed.spin[2] * turn,
  };
}
