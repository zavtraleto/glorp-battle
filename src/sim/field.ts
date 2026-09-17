import { secondsToTicks, tuning } from '../config/tuning';
import type { SimEvent } from './events';
import { COLS, ROWS, inField, sideOfRow, type Side } from './grid';

// Battle panels (roguelite spec §3): state, owner and restore timers per cell.
// Cracked panels break when their occupant leaves; holes and stolen panels
// come back after a while. Timers use the sim tick.

export type Panel = 'NORMAL' | 'CRACKED' | 'BROKEN';

interface PanelCell {
  panel: Panel;
  owner: Side;
  readonly home: Side;
  restoreAt: number;
  ownerBackAt: number;
}

export class Field {
  private readonly cells: PanelCell[] = [];

  constructor(private readonly emit: (e: SimEvent) => void) {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const side = sideOfRow(y);
        this.cells.push({ panel: 'NORMAL', owner: side, home: side, restoreAt: Infinity, ownerBackAt: Infinity });
      }
    }
  }

  private cell(x: number, y: number): PanelCell | null {
    return inField(x, y) ? (this.cells[y * COLS + x] as PanelCell) : null;
  }

  private changed(x: number, y: number, c: PanelCell): void {
    this.emit({ type: 'panelChanged', x, y, panel: c.panel, owner: c.owner });
  }

  private setPanel(x: number, y: number, c: PanelCell, panel: Panel, tick: number): void {
    c.panel = panel;
    c.restoreAt = panel === 'BROKEN' ? tick + secondsToTicks(tuning.field.PANEL_RESTORE_TIME) : Infinity;
    this.changed(x, y, c);
  }

  panel(x: number, y: number): Panel {
    return this.cell(x, y)?.panel ?? 'BROKEN';
  }

  owner(x: number, y: number): Side | null {
    return this.cell(x, y)?.owner ?? null;
  }

  canStand(side: Side, x: number, y: number): boolean {
    const c = this.cell(x, y);
    return c !== null && c.owner === side && c.panel !== 'BROKEN';
  }

  crack(x: number, y: number): boolean {
    const c = this.cell(x, y);
    if (!c || c.panel !== 'NORMAL') return false;
    this.setPanel(x, y, c, 'CRACKED', 0);
    return true;
  }

  /** Heavy hit: a hole, or only a crack while something stands there. */
  breakPanel(x: number, y: number, tick: number, occupied: boolean): boolean {
    if (occupied) return this.crack(x, y);
    const c = this.cell(x, y);
    if (!c || c.panel === 'BROKEN') return false;
    this.setPanel(x, y, c, 'BROKEN', tick);
    return true;
  }

  /** Something left (x, y): a cracked panel gives way. */
  onLeave(x: number, y: number, tick: number): void {
    const c = this.cell(x, y);
    if (c && c.panel === 'CRACKED') this.setPanel(x, y, c, 'BROKEN', tick);
  }

  repair(x: number, y: number): boolean {
    const c = this.cell(x, y);
    if (!c || c.panel === 'NORMAL') return false;
    this.setPanel(x, y, c, 'NORMAL', 0);
    return true;
  }

  setOwner(x: number, y: number, side: Side, tick: number): boolean {
    const c = this.cell(x, y);
    if (!c || c.owner === side) return false;
    c.owner = side;
    c.ownerBackAt = side === c.home ? Infinity : tick + secondsToTicks(tuning.field.STEAL_RESTORE_TIME);
    this.changed(x, y, c);
    return true;
  }

  update(tick: number, isFree: (x: number, y: number) => boolean): void {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const c = this.cell(x, y) as PanelCell;
        if (c.panel === 'BROKEN' && tick >= c.restoreAt) this.setPanel(x, y, c, 'NORMAL', tick);
        if (c.owner !== c.home && tick >= c.ownerBackAt && isFree(x, y)) {
          c.owner = c.home;
          c.ownerBackAt = Infinity;
          this.changed(x, y, c);
        }
      }
    }
  }

  snapshot(): { panel: Panel; owner: Side }[] {
    return this.cells.map((c) => ({ panel: c.panel, owner: c.owner }));
  }
}
