import * as THREE from 'three';
import { tuning } from '../../config/tuning';
import { rectToWorld, type TerminalLayout } from '../layout';

// Darkness (spec §4). The cabinet is never lit as a whole: only the screen, the
// yellow ring and the active chip throw light, and everything outside their reach
// falls into black. Linear falloff (decay 1 with an explicit distance) is easier
// to tune by eye than physical 1/d² and keeps the pools of light readable.

const COLOR = {
  /** Phosphor white-cyan spill from the picture. */
  crt: 0x9fe8dd,
  ring: 0xffbe2e,
  chip: 0xffd45e,
  /** The alarm light of the room around the cabinet when the player is hit. */
  alarm: 0xff2a2a,
};

/** How long the red room flash fades, seconds. */
const ALARM_TIME = 0.45;
/** Extra light at the peak of the flash. */
const ALARM_AMBIENT = 0.55;
const ALARM_CRT = 2.2;

export class DarkLighting {
  readonly group = new THREE.Group();
  private readonly ambient = new THREE.AmbientLight(0xffffff, 0);
  private readonly crt = new THREE.PointLight(COLOR.crt, 0, 0, 1);
  private readonly ring = new THREE.PointLight(COLOR.ring, 0, 0, 1);
  private readonly chip = new THREE.PointLight(COLOR.chip, 0, 0, 1);
  /** Where the chip light sits when no cartridge is active. */
  private readonly chipRest = new THREE.Vector3();
  private alarmLeft = 0;
  private readonly white = new THREE.Color(0xffffff);
  private readonly alarm = new THREE.Color(COLOR.alarm);
  private readonly crtColor = new THREE.Color(COLOR.crt);

  /** The player was hit: red light floods the whole cabinet for a moment. */
  flashAlarm(): void {
    this.alarmLeft = ALARM_TIME;
  }

  constructor() {
    this.group.add(this.ambient, this.crt, this.ring, this.chip);
  }

  /** Places the lights over the current layout. */
  build(layout: TerminalLayout): void {
    const crt = rectToWorld(layout, layout.crt);
    const rail = rectToWorld(layout, layout.rail);
    const deck = rectToWorld(layout, layout.zones.trackball);
    this.crt.position.set(crt.cx, crt.cy, crt.h * 0.55);
    this.crt.distance = crt.h * 1.9;
    // Close and tight: the ball has to read as a lit object against black.
    this.ring.position.set(deck.cx, deck.cy, deck.h * 0.3);
    this.ring.distance = deck.h * 0.9;
    this.chipRest.set(rail.cx, rail.cy, rail.h * 0.8);
    this.chip.position.copy(this.chipRest);
    this.chip.distance = rail.h * 2.2;
  }

  /** Moves the chip light onto the active cartridge, or back to the rail. */
  setChipAt(at: THREE.Vector3 | null): void {
    if (at) this.chip.position.set(at.x, at.y, this.chipRest.z);
    else this.chip.position.copy(this.chipRest);
  }

  /** Copies tuning into the lights; `gaugePulse` brightens the ring as the gauge fills. */
  update(gaugePulse: number, chipActive: boolean, dt = 0): void {
    const t = tuning.terminal;
    this.alarmLeft = Math.max(0, this.alarmLeft - dt);
    const a = this.alarmLeft / ALARM_TIME;
    const k = a * a;
    this.ambient.color.copy(this.white).lerp(this.alarm, Math.min(1, k * 4));
    this.ambient.intensity = t.AMBIENT + ALARM_AMBIENT * k;
    this.crt.color.copy(this.crtColor).lerp(this.alarm, k);
    this.crt.intensity = t.LIGHT_CRT + ALARM_CRT * k;
    this.ring.intensity = t.LIGHT_RING * (0.6 + 0.4 * Math.max(0, Math.min(1, gaugePulse)));
    this.chip.intensity = t.LIGHT_CHIP * (chipActive ? 1 + t.CHIP_ACTIVE_GLOW : 0.35);
  }
}
