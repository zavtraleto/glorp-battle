// Flight of a used cartridge (spec §9.3). It is thrown out of the port like a
// spent casing: a short rise, then forward past the camera and out of the
// bottom of the frame. Offsets from the slot it left, in world units.

/** Forward travel over the flight. */
const TOWARD = 7.5;
/** How high it hops before gravity wins. */
const ARC_UP = 0.9;
/** How far it ends up below the rail; enough to clear the bottom of the frame. */
const ARC_DROP = 9;
/** Extra growth on top of the perspective, so it reads as thrown at the viewer. */
const GROW = 0.6;
const TUMBLE = 1.6;

/**
 * The camera's near plane sits 10 units in front of the terminal face, so the
 * flight has to finish inside that or the cartridge would vanish mid-air.
 */
export const EJECT_MAX_Z = 9;

export interface EjectPose {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotX: number;
  rotZ: number;
}

/** `p` runs 0..1 over EJECT_TIME; `drift` and `spin` are the per-chip scatter. */
export function ejectPose(p: number, drift: number, spin: number): EjectPose {
  const k = Math.max(0, Math.min(1, p));
  return {
    x: drift * k,
    // Rise and fall: the hop dies out while gravity keeps pulling.
    y: ARC_UP * Math.sin(Math.PI * k) - ARC_DROP * k * k,
    z: TOWARD * Math.pow(k, 1.7),
    scale: 1 + GROW * k,
    rotX: -TUMBLE * k,
    rotZ: spin * k,
  };
}
