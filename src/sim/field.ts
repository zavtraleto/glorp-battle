import { secondsToTicks, tuning } from '../config/tuning';
import type { SimEvent } from './events';
import { COLS, ROWS, inField, sideOfRow, type Side } from './grid';

// Battle panels (roguelite spec §3): state, owner and restore timers per cell.
// Cracked panels break when their occupant leaves; holes and stolen panels
// come back after a while. Timers use the sim tick.

export type Panel = 'NORMAL' | 'CRACKED' | 'BROKEN';
export type TimeDomain = 'player' | 'world';
export interface FieldTicks { playerTick: number; worldTick: number }

export interface Hazard {
  kind: 'mine';
  side: Side;
  damage: number;
}

interface PanelCell {
  panel: Panel;
  owner: Side;
  readonly home: Side;
  restoreAt: number;
  restoreDomain: TimeDomain;
  ownerBackAt: number;
  ownerDomain: TimeDomain;
  hazard: Hazard | null;
}

interface ClaimLayer {
  row: number;
  expiresAt: number;
  domain: TimeDomain;
}

export interface FieldUpdateContext {
  player: { x: number; y: number };
  isFree?: (x: number, y: number) => boolean;
}

export class Field {
  private readonly cells: PanelCell[] = [];
  private readonly claims: ClaimLayer[] = [];

  constructor(private readonly emit: (e: SimEvent) => void) {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const side = sideOfRow(y);
        this.cells.push({
          panel: 'NORMAL', owner: side, home: side,
          restoreAt: Infinity, restoreDomain: 'world', ownerBackAt: Infinity, ownerDomain: 'world', hazard: null,
        });
      }
    }
  }

  private cell(x: number, y: number): PanelCell | null {
    return inField(x, y) ? (this.cells[y * COLS + x] as PanelCell) : null;
  }

  private changed(x: number, y: number, c: PanelCell): void {
    this.emit({ type: 'panelChanged', x, y, panel: c.panel, owner: c.owner });
  }

  private setPanel(x: number, y: number, c: PanelCell, panel: Panel, tick: number, domain: TimeDomain = 'world'): void {
    c.panel = panel;
    c.restoreAt = panel === 'BROKEN' ? tick + secondsToTicks(tuning.field.PANEL_RESTORE_TIME) : Infinity;
    c.restoreDomain = domain;
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

  hazard(x: number, y: number): Hazard | null {
    return this.cell(x, y)?.hazard ?? null;
  }

  arm(x: number, y: number, hazard: Hazard): boolean {
    const c = this.cell(x, y);
    if (!c || c.panel !== 'NORMAL' || c.hazard) return false;
    c.hazard = { ...hazard };
    this.emit({ type: 'hazardChanged', x, y, armed: true });
    return true;
  }

  takeHazard(x: number, y: number): Hazard | null {
    const c = this.cell(x, y);
    if (!c?.hazard) return null;
    const hazard = c.hazard;
    c.hazard = null;
    this.emit({ type: 'hazardChanged', x, y, armed: false });
    return hazard;
  }

  crack(x: number, y: number): boolean {
    const c = this.cell(x, y);
    if (!c || c.panel !== 'NORMAL') return false;
    this.setPanel(x, y, c, 'CRACKED', 0);
    return true;
  }

  /** Heavy hit: a hole, or only a crack while something stands there. */
  breakPanel(
    x: number,
    y: number,
    tick: number,
    durationOrOccupied: number | boolean,
    domain: TimeDomain = 'world',
  ): boolean {
    if (typeof durationOrOccupied === 'number') {
      const c = this.cell(x, y);
      if (!c || c.panel === 'BROKEN') return false;
      if (c.hazard) this.takeHazard(x, y);
      c.panel = 'BROKEN';
      c.restoreAt = tick + Math.max(0, durationOrOccupied);
      c.restoreDomain = domain;
      this.changed(x, y, c);
      return true;
    }
    const occupied = durationOrOccupied;
    if (occupied) return this.crack(x, y);
    const c = this.cell(x, y);
    if (!c || c.panel === 'BROKEN') return false;
    this.setPanel(x, y, c, 'BROKEN', tick, domain);
    return true;
  }

  /** Something left (x, y): a cracked panel gives way. */
  onLeave(x: number, y: number, tick: number, domain: TimeDomain = 'world'): void {
    const c = this.cell(x, y);
    if (c && c.panel === 'CRACKED') this.setPanel(x, y, c, 'BROKEN', tick, domain);
  }

  repair(x: number, y: number): boolean {
    const c = this.cell(x, y);
    if (!c || c.panel === 'NORMAL') return false;
    this.setPanel(x, y, c, 'NORMAL', 0);
    return true;
  }

  setOwner(x: number, y: number, side: Side, tick: number, domain: TimeDomain = 'world'): boolean {
    const c = this.cell(x, y);
    if (!c || c.owner === side) return false;
    c.owner = side;
    c.ownerBackAt = side === c.home ? Infinity : tick + secondsToTicks(tuning.field.STEAL_RESTORE_TIME);
    c.ownerDomain = domain;
    this.changed(x, y, c);
    return true;
  }

  claimNextRow(tick: number, durationTicks: number, domain: TimeDomain = 'player'): number | null {
    let row = ROWS - 1;
    for (let y = 0; y < ROWS; y++) {
      if (this.owner(0, y) === 'enemy') row = y;
    }
    if (row < 0 || row >= ROWS || this.owner(0, row) !== 'enemy') return null;
    for (let x = 0; x < COLS; x++) {
      const c = this.cell(x, row) as PanelCell;
      c.owner = 'player';
      c.ownerBackAt = Infinity;
      this.changed(x, row, c);
    }
    this.claims.push({ row, expiresAt: tick + Math.max(0, durationTicks), domain });
    this.emit({ type: 'claimChanged', row, claimed: true });
    return row;
  }

  private domainTick(ticks: FieldTicks, domain: TimeDomain): number {
    return domain === 'player' ? ticks.playerTick : ticks.worldTick;
  }

  private updateClaims(ticks: FieldTicks, player: { x: number; y: number }): void {
    while (this.claims.length > 0) {
      const deepest = this.claims[this.claims.length - 1] as ClaimLayer;
      if (this.domainTick(ticks, deepest.domain) < deepest.expiresAt || player.y <= deepest.row) return;
      this.claims.pop();
      for (let x = 0; x < COLS; x++) {
        const c = this.cell(x, deepest.row) as PanelCell;
        c.owner = c.home;
        c.ownerBackAt = Infinity;
        this.changed(x, deepest.row, c);
      }
      this.emit({ type: 'claimChanged', row: deepest.row, claimed: false });
    }
  }

  update(tick: number | FieldTicks, context: ((x: number, y: number) => boolean) | FieldUpdateContext): void {
    const ticks = typeof tick === 'number' ? { playerTick: tick, worldTick: tick } : tick;
    const isFree = typeof context === 'function' ? context : (context.isFree ?? (() => true));
    const player = typeof context === 'function' ? { x: -1, y: ROWS } : context.player;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const c = this.cell(x, y) as PanelCell;
        if (c.panel === 'BROKEN' && this.domainTick(ticks, c.restoreDomain) >= c.restoreAt) {
          this.setPanel(x, y, c, 'NORMAL', this.domainTick(ticks, c.restoreDomain), c.restoreDomain);
        }
        if (c.owner !== c.home && this.domainTick(ticks, c.ownerDomain) >= c.ownerBackAt && isFree(x, y)) {
          c.owner = c.home;
          c.ownerBackAt = Infinity;
          this.changed(x, y, c);
        }
      }
    }
    this.updateClaims(ticks, player);
  }

  snapshot(): { panel: Panel; owner: Side; armed: boolean }[] {
    return this.cells.map((c) => ({ panel: c.panel, owner: c.owner, armed: c.hazard !== null }));
  }
}
