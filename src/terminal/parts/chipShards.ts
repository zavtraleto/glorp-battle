import * as THREE from 'three';
import { tuning } from '../../config/tuning';
import { CHIPS, type ChipId } from '../../data/chips';
import { CART_BODY_COLOR } from '../chips/cartridge';
import { CHIP_COLOR, LABEL_COLOR } from '../chips/chipFace';
import { planShards, shardPose, type ShardPart, type ShardSeed } from '../chips/shatter';
import type { Point3 } from '../chips/ejectArc';

// Shards of cartridges that spent their last charge (TERMINAL.md §6.5): one
// InstancedMesh for every burst, so any number of them costs one draw call.
// Shards live in world space: the mesh cancels its parent's transform, the
// same way the eject flight ignores the tilt of the control panel.

/** Shards are born red-hot and cool to their own paint (red = loss, spec §6.5). */
const HOT = new THREE.Color(0xff2a3a);

/** Two bursts at once is the most a combo can make; a third reuses the oldest. */
const MAX_BURSTS = 2;

interface Burst {
  seeds: ShardSeed[];
  colors: Record<ShardPart, THREE.Color>;
  at: THREE.Vector3;
  inherit: Point3;
  width: number;
  t: number;
}

/** A flat triangle, thick enough to catch the light as it spins. */
function shardGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.5, -0.4);
  s.lineTo(0.5, -0.3);
  s.lineTo(-0.1, 0.55);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.25, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -0.125);
  return g;
}

export class ChipShards {
  readonly mesh: THREE.InstancedMesh;
  private bursts: Burst[] = [];
  private readonly perBurst = planShards(0).length;
  private readonly inv = new THREE.Matrix4();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor() {
    // Unlit like the cartridge face: the shards keep their paint in the dark cabinet.
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(shardGeometry(), mat, MAX_BURSTS * this.perBurst);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
  }

  /** Bursts a cartridge of `width` world units at world point `at`, moving at `inherit` per second. */
  burst(defId: ChipId, deal: number, at: THREE.Vector3, inherit: Point3, width: number): void {
    if (this.bursts.length >= MAX_BURSTS) this.bursts.shift();
    this.bursts.push({
      seeds: planShards(deal),
      colors: {
        panel: new THREE.Color(CHIP_COLOR[CHIPS[defId].color]),
        label: new THREE.Color(LABEL_COLOR),
        body: new THREE.Color(CART_BODY_COLOR),
      },
      at: at.clone(),
      inherit: { ...inherit },
      width,
      t: 0,
    });
  }

  clear(): void {
    this.bursts = [];
    this.mesh.count = 0;
  }

  update(dt: number): void {
    const t = tuning.terminal;
    for (const b of this.bursts) b.t += dt;
    this.bursts = this.bursts.filter((b) => b.t < t.SHATTER_TIME);
    const parent = this.mesh.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      this.mesh.matrix.copy(this.inv.copy(parent.matrixWorld).invert());
      this.mesh.matrixWorldNeedsUpdate = true;
    }
    let n = 0;
    for (const b of this.bursts) {
      const cool = t.SHATTER_FLASH_TIME > 0 ? Math.min(1, b.t / t.SHATTER_FLASH_TIME) : 1;
      const params = { width: b.width, inherit: b.inherit, speed: t.SHATTER_SPEED, gravity: t.SHATTER_GRAVITY, life: t.SHATTER_TIME };
      for (const seed of b.seeds) {
        const pose = shardPose(seed, b.t, params);
        this.p.set(b.at.x + pose.x, b.at.y + pose.y, b.at.z + pose.z);
        this.q.setFromEuler(this.e.set(pose.rotX, pose.rotY, pose.rotZ));
        this.s.setScalar(Math.max(1e-4, pose.scale));
        this.mesh.setMatrixAt(n, this.m.compose(this.p, this.q, this.s));
        this.mesh.setColorAt(n, this.c.copy(HOT).lerp(b.colors[seed.part], cool));
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
