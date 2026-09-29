import { CHIPS, type ChipId } from '../../data/chips';
import { chipBrief, enemyName, t } from '../../i18n';
import type { SimEvent } from '../../sim/events';
import { PLAYER_ID } from '../../sim/player';

// Battle log on the 14-segment display left of the trackball (TERMINAL.md §3.1,
// decision 2026-09-28): the newest line on top, older ones slide down and dim. Pure.

/** Character cells of the log display. */
export const LOG_COLS = 14;
export const LOG_ROWS = 6;

/** Brightness of each entry by age, newest first; older entries are gone. */
export const LOG_FADE: readonly number[] = [1, 0.72, 0.52, 0.38, 0.28, 0.2];

/** Hits on one target this close together (seconds) add up in one line. */
export const LOG_MERGE_TIME = 0.4;

interface Entry {
  text: string;
  /** Damage lines add up while they keep coming. */
  merge: { key: string; name: string; amount: number; at: number } | null;
}

export interface LogRow {
  text: string;
  /** 0..1 brightness. */
  level: number;
}

/** Words into lines of at most `cols` characters; a word longer than a line is cut. */
export function wrapText(text: string, cols: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ').filter(Boolean)) {
    const w = word.slice(0, cols);
    if (!line) line = w;
    else if (line.length + 1 + w.length <= cols) line += ` ${w}`;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** A chip as the log names it: `BRIEF POWER` (GDD §6.5). */
export function chipLogName(id: ChipId): string {
  const power = CHIPS[id].power;
  return (power === null ? chipBrief(id) : `${chipBrief(id)} ${power}`).toUpperCase();
}

function damageText(name: string, amount: number): string {
  return t('log.damage', { name, n: amount }).toUpperCase();
}

export class BattleLog {
  /** Newest first. */
  private entries: Entry[] = [];

  constructor(
    readonly cols = LOG_COLS,
    readonly rows = LOG_ROWS,
  ) {}

  clear(): void {
    this.entries = [];
  }

  line(text: string): void {
    this.add({ text: text.toUpperCase(), merge: null });
  }

  /** Damage to `key` (an entity), merged with the newest line when it hit the same target just now. */
  damage(key: string, name: string, amount: number, now: number): void {
    const top = this.entries[0];
    if (top?.merge && top.merge.key === key && now - top.merge.at <= LOG_MERGE_TIME) {
      top.merge.amount += amount;
      top.merge.at = now;
      top.text = damageText(top.merge.name, top.merge.amount);
      return;
    }
    this.add({ text: damageText(name, amount), merge: { key, name, amount, at: now } });
  }

  private add(e: Entry): void {
    this.entries.unshift(e);
    this.entries.length = Math.min(this.entries.length, LOG_FADE.length, this.rows);
  }

  /** Rows to draw, top to bottom; a wrapped entry keeps its brightness on every row. */
  view(): LogRow[] {
    const out: LogRow[] = [];
    this.entries.forEach((e, i) => {
      for (const text of wrapText(e.text, this.cols)) out.push({ text, level: LOG_FADE[i] ?? 0 });
    });
    return out.slice(0, this.rows);
  }

  /** Redraw key. */
  key(): string {
    return this.entries.map((e) => e.text).join('|');
  }
}

/** Looks up an entity for the log: an enemy's kind, or null for anything else. */
export type EnemyKindOf = (id: number) => string | null;

/** Writes one sim event into the log, if it is worth a line (spec: GDD §7.2). */
export function logEvent(log: BattleLog, e: SimEvent, kindOf: EnemyKindOf, now: number): void {
  switch (e.type) {
    case 'chipUsed':
      log.line(t('log.used', { chip: chipLogName(e.defId) }));
      return;
    case 'damaged': {
      if (e.amount <= 0) return;
      if (e.targetId === PLAYER_ID) {
        log.damage('player', t('log.you'), e.amount, now);
        return;
      }
      const kind = kindOf(e.targetId);
      if (kind) log.damage(`e${e.targetId}`, enemyName(kind).toUpperCase(), e.amount, now);
      return;
    }
    case 'enemyKilled': {
      const kind = kindOf(e.id);
      if (kind) log.line(t('log.killed', { name: enemyName(kind) }));
      return;
    }
    case 'comboStarted':
      log.line(t('log.combo', { n: e.size }));
      return;
    case 'comboEnded':
      log.line(t('log.comboOk'));
      return;
    case 'comboBroken':
      log.line(t('log.comboBreak'));
      return;
    case 'waveSpawned':
      log.line(t('log.wave', { n: e.wave }));
      return;
    case 'waveCleared':
      log.line(t('log.waveClear'));
      return;
    default:
  }
}

/** A chip added to the charge being built. */
export function logQueued(log: BattleLog, id: ChipId): void {
  log.line(t('log.queued', { chip: chipLogName(id) }));
}
