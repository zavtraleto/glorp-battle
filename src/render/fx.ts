import * as THREE from 'three';
import { secondsToTicks, tuning } from '../config/tuning';
import { CHIPS } from '../data/chips';
import type { Attack } from '../sim/attacks/attack';
import type { PlayerBomb } from '../sim/attacks/bomb';
import type { LaneMover } from '../sim/attacks/shockwave';
import { ROWS } from '../sim/grid';
import type { SimEvent } from '../sim/events';
import type { World } from '../sim/world';
import { CELL_DEPTH, CELL_WIDTH, cellToWorld } from './field';

const CHARGE_COLORS = { 0: 0xbfe9ff, 1: 0x58e08a, 2: 0xff4fd8 } as const;
const TRACER_COLORS = { 0: 0xfff27a, 1: 0x7dff9e, 2: 0xff7ae6 } as const;

/** A short-lived effect driven by simulation ticks (pauses with the battle). */
interface Timed {
  object: THREE.Object3D;
  material: THREE.Material & { opacity: number };
  startTick: number;
  life: number;
  /** k in [0,1] over the lifetime. */
  animate(k: number): void;
}

const tmp = new THREE.Vector3();

/** Simulation-driven effects: enemy attacks, tracers, slashes, bombs, charge ring (GDD §14). */
export class FxView {
  readonly group = new THREE.Group();
  private readonly attackMeshes = new Map<number, THREE.Mesh>();
  private readonly bombMeshes = new Map<number, THREE.Mesh>();
  private readonly waveGeo: THREE.BufferGeometry;
  private readonly waveMat = new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.95 });
  private readonly boxGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly cellGeo = new THREE.PlaneGeometry(CELL_WIDTH * 0.92, CELL_DEPTH * 0.9);
  private readonly slashGeo = new THREE.RingGeometry(0.28, 0.46, 24, 1, Math.PI * 0.1, Math.PI * 0.8);
  private readonly ringGeo = new THREE.RingGeometry(0.3, 0.42, 36);
  private readonly bombGeo = new THREE.SphereGeometry(0.16, 16, 12);
  // Drawn over characters: sprites write depth and would hide the arc.
  private readonly bombMat = new THREE.MeshBasicMaterial({ color: 0x6a6a82, depthTest: false });
  private readonly fireGeo = new THREE.SphereGeometry(0.2, 16, 12);
  private readonly fireMat = new THREE.MeshBasicMaterial({ color: 0xff6a1a, depthTest: false });
  /** Canodron targeting cursors, one mesh per enemy id. */
  private readonly cursors = new Map<number, THREE.Mesh>();
  private readonly cursorGeo = new THREE.RingGeometry(0.2, 0.3, 4, 1, Math.PI / 4);
  private timed: Timed[] = [];
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

    this.chargeRing = new THREE.Mesh(this.ringGeo, this.chargeMat);
    this.chargeRing.rotation.x = -Math.PI / 2;
    this.chargeRing.renderOrder = 5;
    this.chargeRing.visible = false;
    this.group.add(this.chargeRing);
  }

  handleEvent(e: SimEvent, world: World): void {
    const tick = world.tick;
    switch (e.type) {
      case 'busterFired': {
        const width = e.level === 0 ? 0.08 : e.level === 1 ? 0.16 : 0.26;
        this.addTracer(e.x, e.fromY, e.toY, TRACER_COLORS[e.level], width, tuning.fx.BUSTER_TRACER_TIME, tick);
        break;
      }
      case 'chipEffect': {
        const color = new THREE.Color(CHIPS[e.defId].color);
        if (e.pattern === 'lane_hitscan' || e.pattern === 'lane_hitscan_pierce1') {
          this.addTracer(e.x, e.fromY, e.toY, color.getHex(), 0.34, tuning.fx.CANNON_TRACER_TIME, tick);
          for (const c of e.cells) this.addCellFlash(c.x, c.y, 0xffffff, tuning.fx.CANNON_TRACER_TIME, tick);
        } else if (e.pattern.startsWith('melee')) {
          for (const c of e.cells) this.addSlash(c.x, c.y, color.getHex(), tick);
        } else if (e.pattern === 'self_heal') {
          this.addHeal(e.x, e.fromY, tick);
        }
        break;
      }
      case 'bombLanded':
        this.addCellFlash(e.x, e.y, 0xffa040, tuning.fx.EXPLOSION_TIME, tick, true);
        break;
      case 'explosion':
        for (const c of e.cells) this.addCellFlash(c.x, c.y, 0xff5a1a, tuning.fx.EXPLOSION_TIME, tick, true);
        break;
      case 'enemyShot':
        // Tracer from the Canodron toward the player side.
        this.addEnemyTracer(e.x, e.fromY, e.toY, tick);
        if (e.toY < ROWS) this.addCellFlash(e.x, e.toY, 0xff4040, tuning.fx.CANNON_TRACER_TIME, tick);
        break;
      case 'enemyWarped':
        this.addCellFlash(e.fromX, e.fromY, 0xffd0a0, tuning.fx.WARP_FX_TIME, tick);
        this.addCellFlash(e.x, e.y, 0xffffff, tuning.fx.WARP_FX_TIME, tick, true);
        break;
    }
  }

  private push(t: Timed): void {
    this.group.add(t.object);
    this.timed.push(t);
  }

  private addTracer(x: number, fromY: number, toY: number, color: number, width: number, life: number, tick: number): void {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false });
    const mesh = new THREE.Mesh(this.boxGeo, material);
    cellToWorld(x, fromY, tmp);
    const zFrom = tmp.z - CELL_DEPTH * 0.3;
    cellToWorld(x, Math.max(toY, -1), tmp);
    const zTo = toY >= 0 ? tmp.z : tmp.z - CELL_DEPTH;
    mesh.scale.set(width, 0.06, Math.abs(zFrom - zTo));
    mesh.position.set(tmp.x, 0.35, (zFrom + zTo) / 2);
    mesh.renderOrder = 30;
    this.push({
      object: mesh,
      material,
      startTick: tick,
      life: Math.max(1, secondsToTicks(life)),
      animate: (k) => {
        material.opacity = 1 - k;
        mesh.scale.x = width * (1 - 0.5 * k);
      },
    });
  }

  private addEnemyTracer(x: number, fromY: number, toY: number, tick: number): void {
    const material = new THREE.MeshBasicMaterial({ color: 0xff4040, transparent: true, depthTest: false });
    const mesh = new THREE.Mesh(this.boxGeo, material);
    cellToWorld(x, fromY, tmp);
    const zFrom = tmp.z - CELL_DEPTH * 0.5;
    cellToWorld(x, Math.min(toY, ROWS), tmp);
    const zTo = toY < ROWS ? tmp.z : tmp.z + CELL_DEPTH;
    mesh.scale.set(0.22, 0.06, Math.abs(zTo - zFrom));
    mesh.position.set(tmp.x, 0.35, (zFrom + zTo) / 2);
    mesh.renderOrder = 30;
    const life = Math.max(1, secondsToTicks(tuning.fx.CANNON_TRACER_TIME));
    this.push({
      object: mesh,
      material,
      startTick: tick,
      life,
      animate: (k) => {
        material.opacity = 1 - k;
      },
    });
  }

  private addCellFlash(x: number, y: number, color: number, life: number, tick: number, grow = false): void {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(this.cellGeo, material);
    mesh.rotation.x = -Math.PI / 2;
    cellToWorld(x, y, mesh.position);
    mesh.position.y = 0.02;
    mesh.renderOrder = 25;
    this.push({
      object: mesh,
      material,
      startTick: tick,
      life: Math.max(1, secondsToTicks(life)),
      animate: (k) => {
        material.opacity = 0.9 * (1 - k);
        const s = grow ? 0.6 + 0.6 * k : 1;
        mesh.scale.set(s, s, 1);
      },
    });
  }

  private addSlash(x: number, y: number, color: number, tick: number): void {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.slashGeo, material);
    // Upright arc facing the camera-ish, sweeping across the panel.
    cellToWorld(x, y, mesh.position);
    mesh.position.y = 0.35;
    mesh.renderOrder = 35;
    this.push({
      object: mesh,
      material,
      startTick: tick,
      life: Math.max(1, secondsToTicks(tuning.fx.SLASH_TIME)),
      animate: (k) => {
        material.opacity = 1 - k * k;
        mesh.rotation.z = -1.2 + 2.4 * k;
        const s = 1.2 + 0.4 * k;
        mesh.scale.set(s, s, 1);
      },
    });
    this.addCellFlash(x, y, color, tuning.fx.SLASH_TIME, tick);
  }

  private addHeal(x: number, y: number, tick: number): void {
    const material = new THREE.MeshBasicMaterial({
      color: 0x7dff9e,
      transparent: true,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.ringGeo, material);
    mesh.rotation.x = -Math.PI / 2;
    cellToWorld(x, y, mesh.position);
    mesh.renderOrder = 36;
    const baseY = mesh.position.y;
    this.push({
      object: mesh,
      material,
      startTick: tick,
      life: Math.max(1, secondsToTicks(tuning.fx.HEAL_FX_TIME)),
      animate: (k) => {
        material.opacity = 1 - k;
        mesh.position.y = baseY + 0.9 * k;
        const s = 1 + 0.3 * k;
        mesh.scale.set(s, s, 1);
      },
    });
  }

  update(world: World, alpha: number): void {
    const tick = world.tick;
    this.updateAttacks(world.attacks, tick, alpha);
    this.updateCursors(world);
    this.updateBombs(world.bombs, tick, alpha);
    this.updateTimed(tick, alpha);
    this.updateCharge(world);
  }

  private updateAttacks(attacks: readonly Attack[], tick: number, alpha: number): void {
    const live = new Set<number>();
    for (const a of attacks) {
      live.add(a.id);
      let mesh = this.attackMeshes.get(a.id);
      const fire = a.kind === 'heatshot';
      if (!mesh) {
        mesh = fire ? new THREE.Mesh(this.fireGeo, this.fireMat) : new THREE.Mesh(this.waveGeo, this.waveMat);
        mesh.renderOrder = fire ? 42 : 20;
        this.attackMeshes.set(a.id, mesh);
        this.group.add(mesh);
      }
      if (a.kind === 'shockwave' || fire) {
        const m = a as LaneMover;
        // The attack is inside cell `y` for the whole step; slide it across that cell.
        const progress = Math.min(1, Math.max(0, (tick - m.lastStepTick + alpha) / m.stepTicks));
        cellToWorld(m.x, m.y, mesh.position);
        mesh.position.z += (progress - 0.5) * CELL_DEPTH;
        if (fire) {
          mesh.position.y = 0.4;
          mesh.scale.setScalar(1 + 0.15 * Math.sin((tick + alpha) * 1.3));
        } else {
          mesh.scale.set(1, 1 + 0.25 * Math.sin((tick + alpha) * 0.9), 1);
        }
      }
    }
    for (const [id, mesh] of this.attackMeshes) {
      if (live.has(id)) continue;
      this.group.remove(mesh);
      this.attackMeshes.delete(id);
    }
  }

  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();

  private updateBombs(bombs: readonly PlayerBomb[], tick: number, alpha: number): void {
    const live = new Set<number>();
    for (const b of bombs) {
      live.add(b.id);
      let mesh = this.bombMeshes.get(b.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.bombGeo, this.bombMat);
        mesh.renderOrder = 40;
        this.bombMeshes.set(b.id, mesh);
        this.group.add(mesh);
      }
      const k = b.progress(tick, alpha);
      cellToWorld(b.fromX, b.fromY, this.from);
      cellToWorld(b.x, b.y, this.to);
      mesh.position.lerpVectors(this.from, this.to, k);
      // Parabolic arc.
      mesh.position.y = 0.3 + 1.6 * k * (1 - k);
    }
    for (const [id, mesh] of this.bombMeshes) {
      if (live.has(id)) continue;
      this.group.remove(mesh);
      this.bombMeshes.delete(id);
    }
  }

  private updateCursors(world: World): void {
    const live = new Set<number>();
    for (const e of world.enemies) {
      const c = e.alive && world.state === 'ACTION' ? e.cursorCell() : null;
      if (!c) continue;
      live.add(e.id);
      let mesh = this.cursors.get(e.id);
      if (!mesh) {
        mesh = new THREE.Mesh(
          this.cursorGeo,
          new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, side: THREE.DoubleSide }),
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.renderOrder = 6;
        this.cursors.set(e.id, mesh);
        this.group.add(mesh);
      }
      cellToWorld(c.x, c.y, mesh.position);
      mesh.position.y = 0.03;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.setHex(c.locked ? 0xff2d2d : 0xffe066);
      // A locked reticle sits on the player, so it must draw over the sprite.
      mesh.renderOrder = c.locked ? 50 : 6;
      mesh.position.y = c.locked ? 0.45 : 0.03;
      mat.opacity = c.locked ? 0.95 : 0.8;
      const s = c.locked ? 1.9 + 0.2 * Math.sin(world.tick * 1.2) : 1.6;
      mesh.scale.set(s, s, 1);
    }
    for (const [id, mesh] of this.cursors) {
      if (live.has(id)) continue;
      this.group.remove(mesh);
      (mesh.material as THREE.Material).dispose();
      this.cursors.delete(id);
    }
  }

  private updateTimed(tick: number, alpha: number): void {
    this.timed = this.timed.filter((t) => {
      const age = tick - t.startTick + alpha;
      if (age >= t.life || age < -1) {
        this.group.remove(t.object);
        t.material.dispose();
        return false;
      }
      t.animate(Math.max(0, age) / t.life);
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
    for (const mesh of this.bombMeshes.values()) this.group.remove(mesh);
    this.bombMeshes.clear();
    for (const mesh of this.cursors.values()) {
      this.group.remove(mesh);
      (mesh.material as THREE.Material).dispose();
    }
    this.cursors.clear();
    for (const t of this.timed) {
      this.group.remove(t.object);
      t.material.dispose();
    }
    this.timed = [];
  }
}
