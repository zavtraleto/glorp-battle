import { secondsToTicks, tuning } from '../config/tuning';
import type { SceneRenderer } from '../render/scene';
import { chipIconHtml } from './chipIcon';
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
  /** Queued chips stacked above the player (MMBN shows them over MegaMan's head). */
  private readonly queueStack: HTMLElement;
  private queueKey = '';

  constructor(parent: HTMLElement, private scene: SceneRenderer) {
    this.root = document.createElement('div');
    this.root.className = 'world-labels';
    parent.appendChild(this.root);
    this.queueStack = document.createElement('div');
    this.queueStack.className = 'queue-stack';
    this.root.appendChild(this.queueStack);
  }

  handleEvent(e: SimEvent, world: World): void {
    if (e.type === 'damaged' && e.amount > 0) {
      this.addFloater(e.targetId === PLAYER_ID ? 'dmg-number player' : 'dmg-number', String(e.amount), e.x, e.y, world);
    } else if (e.type === 'healed' && e.amount > 0) {
      this.addFloater('dmg-number heal', `+${e.amount}`, e.x, e.y, world);
    }
  }

  private addFloater(className: string, text: string, x: number, y: number, world: World): void {
    const el = document.createElement('div');
    el.className = className;
    el.textContent = text;
    this.root.appendChild(el);
    this.floaters.push({ el, x, y, startTick: world.tick });
  }

  reset(): void {
    for (const el of this.hpLabels.values()) el.remove();
    this.hpLabels.clear();
    for (const f of this.floaters) f.el.remove();
    this.floaters = [];
    this.queueKey = '';
    this.queueStack.innerHTML = '';
  }

  private updateQueueStack(world: World): void {
    const queue = world.state === 'ACTION' || world.state === 'BATTLE_START' ? world.chips.queue : [];
    const key = queue.map((c) => c.uid).join(',');
    if (key !== this.queueKey) {
      this.queueKey = key;
      // Rendered back-to-front so the next chip sits on top.
      this.queueStack.innerHTML = [...queue]
        .reverse()
        .map((c, i) => `<div class="qs-item" style="--i:${queue.length - 1 - i}">${chipIconHtml(c.defId, c.code, { showPower: false })}</div>`)
        .join('');
    }
    if (!key) return;
    const p = this.scene.actorScreenPos(PLAYER_ID, 1.05);
    if (p) this.queueStack.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
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

    this.updateQueueStack(world);

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
