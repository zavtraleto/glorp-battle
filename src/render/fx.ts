import * as THREE from 'three';
import { secondsToTicks, tuning } from '../config/tuning';
import type { Attack } from '../sim/attacks/attack';
import { Shockwave } from '../sim/attacks/shockwave';
import type { SimEvent } from '../sim/events';
import type { World } from '../sim/world';
import { CELL_DEPTH, CELL_WIDTH, cellToWorld } from './field';

const CHARGE_COLORS = { 0: 0xbfe9ff, 1: 0x58e08a, 2: 0xff4fd8 } as const;
const TRACER_COLORS = { 0: 0xfff27a, 1: 0x7dff9e, 2: 0xff7ae6 } as const;

interface Tracer {
  mesh: THREE.Mesh;
  startTick: number;
}

const tmp = new THREE.Vector3();

/** Short-lived and simulation-driven effects: attacks, tracers, charge ring (GDD §14). */
export class FxView {
  readonly group = new THREE.Group();
  private readonly attackMeshes = new Map<number, THREE.Mesh>();
  private readonly waveGeo: THREE.BufferGeometry;
  private readonly waveMat = new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.95 });
  private readonly tracerGeo = new THREE.BoxGeometry(1, 0.06, 1);
  private tracers: Tracer[] = [];
  private readonly chargeRing: THREE.Mesh;
  private readonly chargeMat = new THREE.MeshBasicMaterial({
    color: CHARGE_COLORS[0],
    transparent: true,
    depthTest: false,
    side: THREE.DoubleSide,
  });

  constructor() {
    // Wedge pointing toward the player (+z).
    const shape = new THREE.Shape();
    shape.moveTo(-0.32, 0);
    shape.lineTo(0.32, 0);
    shape.lineTo(0, 0.42);
    shape.closePath();
    this.waveGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false });
    this.waveGeo.rotateX(-Math.PI / 2);
    this.waveGeo.rotateY(Math.PI);
    this.waveGeo.translate(0, 0, 0.05);

    this.chargeRing = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.44, 40), this.chargeMat);
    this.chargeRing.rotation.x = -Math.PI / 2;
    this.chargeRing.renderOrder = 5;
    this.chargeRing.visible = false;
    this.group.add(this.chargeRing);
  }

  handleEvent(e: SimEvent, tick: number): void {
    if (e.type === 'busterFired') this.addTracer(e.x, e.fromY, e.toY, e.level, tick);
  }

  private addTracer(x: number, fromY: number, toY: number, level: 0 | 1 | 2, tick: number): void {
    const mat = new THREE.MeshBasicMaterial({ color: TRACER_COLORS[level], transparent: true, depthTest: false });
    const mesh = new THREE.Mesh(this.tracerGeo, mat);
    cellToWorld(x, fromY, tmp);
    const zFrom = tmp.z - CELL_DEPTH * 0.3;
    cellToWorld(x, Math.max(toY, -1), tmp);
    const zTo = toY >= 0 ? tmp.z : tmp.z - CELL_DEPTH;
    const width = level === 0 ? 0.08 : level === 1 ? 0.16 : 0.26;
    mesh.scale.set(width, 1, Math.abs(zFrom - zTo));
    mesh.position.set(tmp.x, 0.35, (zFrom + zTo) / 2);
    mesh.renderOrder = 30;
    this.group.add(mesh);
    this.tracers.push({ mesh, startTick: tick });
  }

  update(world: World, alpha: number): void {
    const tick = world.tick;
    this.updateAttacks(world.attacks, tick, alpha);
    this.updateTracers(tick, alpha);
    this.updateCharge(world);
  }

  private updateAttacks(attacks: readonly Attack[], tick: number, alpha: number): void {
    const live = new Set<number>();
    for (const a of attacks) {
      live.add(a.id);
      let mesh = this.attackMeshes.get(a.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.waveGeo, this.waveMat);
        mesh.renderOrder = 20;
        this.attackMeshes.set(a.id, mesh);
        this.group.add(mesh);
      }
      if (a instanceof Shockwave) {
        // The wave is inside cell `y` for the whole step; slide it across that cell.
        const progress = Math.min(1, Math.max(0, (tick - a.lastStepTick + alpha) / a.stepTicks));
        cellToWorld(a.x, a.y, mesh.position);
        mesh.position.z += (progress - 0.5) * CELL_DEPTH;
        mesh.scale.set(1, 1 + 0.25 * Math.sin((tick + alpha) * 0.9), 1);
      }
    }
    for (const [id, mesh] of this.attackMeshes) {
      if (live.has(id)) continue;
      this.group.remove(mesh);
      this.attackMeshes.delete(id);
    }
  }

  private updateTracers(tick: number, alpha: number): void {
    const life = Math.max(1, secondsToTicks(tuning.fx.BUSTER_TRACER_TIME));
    this.tracers = this.tracers.filter((t) => {
      const age = tick - t.startTick + alpha;
      if (age >= life || age < -1) {
        this.group.remove(t.mesh);
        (t.mesh.material as THREE.Material).dispose();
        return false;
      }
      (t.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - age / life;
      return true;
    });
  }

  private updateCharge(world: World): void {
    const c = world.chargeDisplay();
    this.chargeRing.visible = c.visible && world.state === 'ACTION';
    if (!this.chargeRing.visible) return;
    const p = world.player;
    cellToWorld(p.x, p.y, this.chargeRing.position);
    this.chargeRing.position.y = 0.03;
    this.chargeMat.color.setHex(CHARGE_COLORS[c.level]);
    this.chargeMat.opacity = c.level === 0 ? 0.35 + 0.4 * c.progress : 0.9;
    const s = c.level === 0 ? 0.8 + 0.2 * c.progress : 1 + 0.06 * Math.sin(world.tick * 0.8);
    this.chargeRing.scale.set(s * CELL_WIDTH, s * CELL_WIDTH, 1);
  }

  clear(): void {
    for (const mesh of this.attackMeshes.values()) this.group.remove(mesh);
    this.attackMeshes.clear();
    for (const t of this.tracers) {
      this.group.remove(t.mesh);
      (t.mesh.material as THREE.Material).dispose();
    }
    this.tracers = [];
  }
}
