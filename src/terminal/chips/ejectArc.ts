// Flight of a used cartridge (spec §9.3). It is thrown out of the port at the
// player: a short hop, then it tumbles at the camera, accelerating, grows in
// the perspective and passes just under the lens. Offsets from the slot it
// left, in world units (the terminal's world axes, not the tilted panel's).

/** How high it hops before it comes at the viewer. */
const ARC_UP = 0.8;
/** Growth on top of the perspective. */
const GROW = 0.25;
/** Forward tumble and the twist around the vertical axis, full turns. */
const TUMBLE_TURNS = 1.25;
const TWIST_TURNS = 0.6;
/** Acceleration toward the camera: slow out of the port, fast at the lens. */
const TOWARD_EASE = 2.2;

export interface EjectPose {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotX: number;
  rotY: number;
  rotZ: number;
}

/** Where the flight ends, as an offset from the slot: just under the camera, short of it. */
export interface EjectAim {
  x: number;
  y: number;
  z: number;
}

/** `p` runs 0..1 over EJECT_TIME; `drift` and `spin` are the per-chip scatter. */
export function ejectPose(p: number, aim: EjectAim, drift: number, spin: number): EjectPose {
  const k = Math.max(0, Math.min(1, p));
  const ease = Math.pow(k, TOWARD_EASE);
  const turn = Math.PI * 2;
  return {
    x: drift * k + aim.x * ease,
    y: ARC_UP * Math.sin(Math.PI * Math.min(1, k * 1.6)) + aim.y * ease,
    z: aim.z * ease,
    scale: 1 + GROW * k,
    rotX: -TUMBLE_TURNS * turn * k,
    rotY: TWIST_TURNS * turn * k * Math.sign(spin || 1),
    rotZ: spin * k,
  };
}
