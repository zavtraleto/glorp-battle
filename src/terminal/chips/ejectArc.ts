// Pure, deterministic flight planning for a used cartridge. The rail chooses
// one of six non-overlapping corridors around the CRT; this module turns that
// choice into a lively world-space arc. Decorative variation never touches the
// simulation RNG, so replays and combat remain reproducible.

export type EjectSide = 'left' | 'right' | 'bottom';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface EjectAim extends Point3 {}

export interface EjectProfile {
  corridor: number;
  slot: number;
  side: EjectSide;
  durationScale: number;
  curve: number;
  /** Downward acceleration over normalized flight time, in world units. */
  gravity: number;
  grow: number;
  depthEase: number;
  /** Full turns around x, y and z. */
  turns: readonly [number, number, number];
}

export interface EjectPose extends Point3 {
  scale: number;
  rotX: number;
  rotY: number;
  rotZ: number;
}

interface Corridor {
  side: EjectSide;
  lane: number;
}

const CORRIDORS: readonly Corridor[] = [
  { side: 'left', lane: -1 },
  { side: 'left', lane: 1 },
  { side: 'bottom', lane: -1 },
  { side: 'bottom', lane: 1 },
  { side: 'right', lane: 1 },
  { side: 'right', lane: -1 },
];

// Outer slots never travel across the battle picture to reach the other side.
const SLOT_CORRIDORS: readonly (readonly number[])[] = [
  [0, 1, 2],
  [1, 0, 2],
  [2, 3, 0, 4, 1, 5],
  [4, 5, 3],
  [5, 4, 3],
];

function mix(value: number): number {
  let x = (value | 0) + 0x6d2b79f5;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return (x ^ (x >>> 14)) >>> 0;
}

function unit(bits: number): number {
  return (bits >>> 0) / 0xffffffff;
}

/** Selects a deterministic free route around the CRT. */
export function chooseEjectProfile(seed: number, slot: number, occupied: readonly number[]): EjectProfile {
  const safeSlot = Math.max(0, Math.min(SLOT_CORRIDORS.length - 1, slot | 0));
  const preferred = SLOT_CORRIDORS[safeSlot]!;
  const h = mix(seed ^ Math.imul(safeSlot + 1, 0x9e3779b1));
  const start = h % preferred.length;
  let corridor = preferred[start]!;
  for (let offset = 0; offset < preferred.length; offset++) {
    const candidate = preferred[(start + offset) % preferred.length]!;
    if (!occupied.includes(candidate)) {
      corridor = candidate;
      break;
    }
  }
  // At most five cartridges exist, so one of the six global corridors is free.
  if (occupied.includes(corridor)) corridor = CORRIDORS.findIndex((_, index) => !occupied.includes(index));

  const route = CORRIDORS[corridor]!;
  const h1 = mix(h + 1);
  const h2 = mix(h + 2);
  const h3 = mix(h + 3);
  const signX = (h1 & 1) === 0 ? -1 : 1;
  const signY = (h2 & 1) === 0 ? -1 : 1;
  const signZ = (h3 & 1) === 0 ? -1 : 1;
  return {
    corridor,
    slot: safeSlot,
    side: route.side,
    durationScale: 1.12 + unit(h1) * 0.36,
    curve: 0.28 + unit(h2) * 0.48,
    gravity: 22 + unit(h3) * 8,
    grow: 0.18 + unit(mix(h + 4)) * 0.16,
    depthEase: 1.2 + unit(mix(h + 5)) * 0.35,
    turns: [
      signX * (0.55 + unit(mix(h + 6)) * 0.4),
      signY * (0.45 + unit(mix(h + 7)) * 0.4),
      signZ * (0.3 + unit(mix(h + 8)) * 0.35),
    ],
  };
}

/** Absolute boundary target expressed as an offset from the launch point. */
export function ejectAim(profile: EjectProfile, origin: Point3, camera: Point3): EjectAim {
  const route = CORRIDORS[profile.corridor]!;
  const targetZ = origin.z + (camera.z - origin.z) * 0.76;
  const lensGap = camera.z - targetZ;
  let targetX = camera.x;
  let targetY = camera.y;
  if (route.side === 'left' || route.side === 'right') {
    const outerLane = route.side === 'left' ? route.lane > 0 : route.lane < 0;
    targetX += (route.side === 'left' ? -1 : 1) * lensGap * (outerLane ? 1.5 : 1.25);
    targetY += route.lane * lensGap * 0.24;
  } else {
    targetX += route.lane * lensGap * 0.3;
    targetY -= lensGap * 1.34;
  }
  return { x: targetX - origin.x, y: targetY - origin.y, z: targetZ - origin.z };
}

/** The cartridge must begin its free flight in front of the CRT and bezel. */
export function safeEjectDepth(worldZ: number, frontPlaneZ: number): number {
  return Math.max(worldZ, frontPlaneZ);
}

export function ejectPose(p: number, aim: EjectAim, profile: EjectProfile): EjectPose {
  const k = Math.max(0, Math.min(1, p));
  if (k === 0) return { x: 0, y: 0, z: 0, scale: 1, rotX: 0, rotY: 0, rotZ: 0 };
  // Lateral travel begins before depth travel, separating the cartridges before
  // they grow large near the lens.
  const outward = 1 - Math.pow(1 - k, 1.75);
  const toward = Math.pow(k, profile.depthEase);
  const bow = Math.sin(Math.PI * k);
  const route = CORRIDORS[profile.corridor]!;
  const side = route.side === 'left' ? -1 : route.side === 'right' ? 1 : route.lane;
  // Side exits get a sharp casing-like kick so the upward part of the arc is
  // already outside the battle picture; the motion then loses lateral speed.
  const lateral = route.side === 'bottom' ? outward : 1 - Math.pow(1 - k, 8);
  // Constant downward acceleration gives the chip a shell-like ballistic arc.
  // The launch velocity is derived so the parabola still lands on its corridor.
  const ballisticY = aim.y * k + 0.5 * profile.gravity * k * (1 - k);
  // Rotation carries the initial impulse, then loses angular speed in the air.
  const spin = 1 - Math.pow(1 - k, 1.35);
  const turn = Math.PI * 2;
  return {
    x: aim.x * lateral + side * profile.curve * bow,
    y: ballisticY,
    z: aim.z * toward,
    scale: 1 + profile.grow * k,
    rotX: profile.turns[0] * turn * spin,
    rotY: profile.turns[1] * turn * spin,
    rotZ: profile.turns[2] * turn * spin,
  };
}
