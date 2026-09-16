import { secondsToTicks, tuning } from '../config/tuning';
import type { SceneRenderer } from '../render/scene';
import type { SimEvent } from '../sim/events';
import { PLAYER_ID } from '../sim/player';
import type { World } from '../sim/world';

// DOM labels anchored to the field: enemy HP and floating damage numbers (GDD §13, §14).

interface Floater {
  el: HTMLElement;
  x: number;
  y: number;
  startTick: number;
}

export class WorldLabels {
  private readonly root: HTMLElement;
  private readonly hpLabels = new Map<number, HTMLElement>();
  private floaters: Floater[] = [];

  constructor(parent: HTMLElement, private scene: SceneRenderer) {
    this.root = document.createElement('div');
    this.root.className = 'world-labels';
    parent.appendChild(this.root);
  }

  handleEvent(e: SimEvent, world: World): void {
    if (e.type !== 'damaged' || e.amount <= 0) return;
    const el = document.createElement('div');
    el.className = e.targetId === PLAYER_ID ? 'dmg-number player' : 'dmg-number';
    el.textContent = String(e.amount);
    this.root.appendChild(el);
    this.floaters.push({ el, x: e.x, y: e.y, startTick: world.tick });
  }

  reset(): void {
    for (const el of this.hpLabels.values()) el.remove();
    this.hpLabels.clear();
    for (const f of this.floaters) f.el.remove();
    this.floaters = [];
  }

  update(world: World, alpha: number): void {
    const live = new Set<number>();
    for (const e of world.enemies) {
      if (!e.alive) continue;
      live.add(e.id);
      let el = this.hpLabels.get(e.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'enemy-hp';
        this.root.appendChild(el);
        this.hpLabels.set(e.id, el);
      }
      const text = String(e.hp);
      if (el.textContent !== text) el.textContent = text;
      const p = this.scene.actorScreenPos(e.id, -0.12);
      if (p) el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, 0)`;
    }
    for (const [id, el] of this.hpLabels) {
      if (live.has(id)) continue;
      el.remove();
      this.hpLabels.delete(id);
    }

    const life = Math.max(1, secondsToTicks(tuning.fx.DAMAGE_NUMBER_TIME));
    this.floaters = this.floaters.filter((f) => {
      const age = world.tick - f.startTick + alpha;
      if (age >= life) {
        f.el.remove();
        return false;
      }
      const k = age / life;
      const p = this.scene.cellToScreen(f.x, f.y, 0.9 + 0.5 * k);
      f.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
      f.el.style.opacity = String(1 - k * k);
      return true;
    });
  }
}
