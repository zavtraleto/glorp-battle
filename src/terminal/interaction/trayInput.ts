import type { TerminalLayout } from '../layout';
import { railDropIndex, trayTargetAt, type TrayLayout, type TrayTarget } from '../chips/trayLayout';
import type { PointerSink } from './pointerEvents';

// Chip tray input (TERMINAL.md §6.4): tap or drag hand chips into the rail,
// tap or drag rail chips back out, press OK / ADD. Pure state machine.

/** Movement (CSS px) that turns a press on a chip into a drag. */
export const DRAG_START_PX = 8;

export interface TrayActions {
  layout(): TerminalLayout;
  tray(): TrayLayout;
  /** Chips currently in the rail. */
  selectedCount(): number;
  /** Whether a hand slot holds a chip that may be picked. */
  canPick(slot: number): boolean;
  /** Whether the tray takes input now (open, Custom Screen active). */
  enabled(): boolean;
  select(slot: number, index: number): void;
  unselect(index: number): void;
  /** Moves a rail chip to another rail position. */
  reorder(from: number, to: number): void;
  refuse(slot: number): void;
  focus(slot: number): void;
  keyDown(key: 'ok' | 'add'): void;
  keyUp(key: 'ok' | 'add', fire: boolean): void;
  /** Drag feedback: pointer position (null when the drag ends) and the rail index it would drop to. */
  drag(source: TrayTarget, x: number, y: number, dropIndex: number | null): void;
  dragEnd(source: TrayTarget): void;
}

interface Press {
  target: TrayTarget;
  x0: number;
  y0: number;
  dragging: boolean;
}

export class TrayInput implements PointerSink {
  private readonly presses = new Map<number, Press>();

  constructor(private a: TrayActions) {}

  isCaptured(id: number): boolean {
    return this.presses.has(id);
  }

  down(id: number, x: number, y: number): boolean {
    if (this.presses.has(id)) return true;
    if (!this.a.enabled()) return false;
    const target = trayTargetAt(this.a.layout(), this.a.tray(), x, y, this.a.selectedCount());
    if (!target) return false;
    if (target.kind === 'hand') {
      this.a.focus(target.slot);
      if (!this.a.canPick(target.slot)) {
        this.a.refuse(target.slot);
        return true;
      }
    }
    if (target.kind === 'ok' || target.kind === 'add') this.a.keyDown(target.kind);
    // One drag at a time: a second finger on a chip only taps.
    this.presses.set(id, { target, x0: x, y0: y, dragging: false });
    return true;
  }

  move(id: number, x: number, y: number): void {
    const p = this.presses.get(id);
    if (!p || (p.target.kind !== 'hand' && p.target.kind !== 'rail')) return;
    if (p.target.kind === 'hand' && !this.a.canPick(p.target.slot)) return;
    if (!p.dragging) {
      if (Math.hypot(x - p.x0, y - p.y0) < DRAG_START_PX) return;
      if ([...this.presses.values()].some((o) => o !== p && o.dragging)) return;
      p.dragging = true;
    }
    this.a.drag(p.target, x, y, this.dropIndex(p.target, x, y));
  }

  up(id: number, x: number, y: number): void {
    const p = this.presses.get(id);
    if (!p) return;
    this.presses.delete(id);
    const t = p.target;
    if (t.kind === 'ok' || t.kind === 'add') {
      const still = trayTargetAt(this.a.layout(), this.a.tray(), x, y, this.a.selectedCount());
      this.a.keyUp(t.kind, still?.kind === t.kind && this.a.enabled());
      return;
    }
    if (!this.a.enabled()) {
      if (p.dragging) this.a.dragEnd(t);
      return;
    }
    if (t.kind === 'hand') {
      if (!this.a.canPick(t.slot)) {
        if (p.dragging) this.a.dragEnd(t);
        return;
      }
      if (!p.dragging) {
        this.a.select(t.slot, this.a.selectedCount());
        return;
      }
      const index = this.dropIndex(t, x, y);
      this.a.dragEnd(t);
      if (index === null) this.a.refuse(t.slot);
      else this.a.select(t.slot, index);
      return;
    }
    // Rail chip: tap pulls it out; a drag moves it along the rail or out of it.
    if (!p.dragging) {
      this.a.unselect(t.index);
      return;
    }
    const index = this.dropIndex(t, x, y);
    this.a.dragEnd(t);
    if (index === null) this.a.unselect(t.index);
    else if (index !== t.index) this.a.reorder(t.index, index);
  }

  cancelAll(): void {
    for (const [id, p] of [...this.presses]) {
      this.presses.delete(id);
      if (p.dragging) this.a.dragEnd(p.target);
      if (p.target.kind === 'ok' || p.target.kind === 'add') this.a.keyUp(p.target.kind, false);
    }
  }

  private dropIndex(source: TrayTarget, x: number, y: number): number | null {
    const selected = this.a.selectedCount();
    // A rail chip being moved does not count itself.
    const count = source.kind === 'rail' ? selected - 1 : selected;
    return railDropIndex(this.a.layout(), x, y, count);
  }
}
