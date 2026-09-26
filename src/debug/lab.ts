import type { Encounter, EncounterTier, EncounterWave, EnemySpawn } from '../data/encounters';
import type { EnemyLevel } from '../data/enemies';
import type { FolderId } from '../data/folders';
import { ENEMY_KINDS, type EnemyKind } from '../sim/enemies/enemyBase';
import { COLS, ROWS, sideOfRow } from '../sim/grid';

// Encounter Lab model (GDD §15.5): a draft of one encounter, painted cell by
// cell, exported as a fragment of data/encounters.ts. Pure; the DOM lives in labView.ts.

export type LabPanel = 'CRACKED' | 'BROKEN';

export interface LabPanelCell {
  x: number;
  y: number;
  panel: LabPanel;
}

export interface LabWave {
  enemies: EnemySpawn[];
  panels: LabPanelCell[];
}

export interface LabDraft {
  id: string;
  tier: EncounterTier;
  depth: number;
  /** Folder the Lab battle is played with; not part of the encounter (the run folder is fixed). */
  folder: FolderId;
  waves: LabWave[];
}

export type LabBrush =
  | { type: 'enemy'; kind: EnemyKind; level: EnemyLevel }
  | { type: 'panel'; panel: LabPanel }
  | { type: 'erase' };

export function emptyDraft(): LabDraft {
  return { id: 'lab1', tier: 'normal', depth: 1, folder: 'starter', waves: [{ enemies: [], panels: [] }] };
}

export function draftFromEncounter(enc: Encounter): LabDraft {
  return {
    id: enc.id,
    tier: enc.tier,
    depth: enc.minDepth,
    folder: 'starter',
    waves: enc.waves.map((w) => ({
      enemies: w.enemies.map((e) => ({ kind: e.kind, x: e.x, y: e.y, level: e.level ?? 1 })),
      panels: (w.panels ?? []).map((p) => ({ ...p })),
    })),
  };
}

export function toEncounter(d: LabDraft): Encounter {
  return {
    id: d.id,
    tier: d.tier,
    minDepth: d.depth,
    maxDepth: d.depth,
    waves: d.waves.map((w): EncounterWave => {
      const enemies = w.enemies.map((e) => ({ ...e, level: e.level ?? 1 }));
      return w.panels.length ? { enemies, panels: w.panels.map((p) => ({ ...p })) } : { enemies };
    }),
  };
}

export function cellContent(d: LabDraft, wave: number, x: number, y: number): { enemy: EnemySpawn | null; panel: LabPanel | null } {
  const w = d.waves[wave];
  return {
    enemy: w?.enemies.find((e) => e.x === x && e.y === y) ?? null,
    panel: w?.panels.find((p) => p.x === x && p.y === y)?.panel ?? null,
  };
}

/** Applies a brush to a cell; painting what is already there erases it. Enemies stand only on the enemy side. */
export function paint(d: LabDraft, wave: number, x: number, y: number, brush: LabBrush): void {
  const w = d.waves[wave];
  if (!w || x < 0 || x >= COLS || y < 0 || y >= ROWS) return;
  const enemyAt = w.enemies.findIndex((e) => e.x === x && e.y === y);
  const panelAt = w.panels.findIndex((p) => p.x === x && p.y === y);
  if (brush.type === 'erase') {
    if (enemyAt >= 0) w.enemies.splice(enemyAt, 1);
    if (panelAt >= 0) w.panels.splice(panelAt, 1);
    return;
  }
  if (brush.type === 'panel') {
    const same = panelAt >= 0 && w.panels[panelAt]!.panel === brush.panel;
    if (panelAt >= 0) w.panels.splice(panelAt, 1);
    if (!same) w.panels.push({ x, y, panel: brush.panel });
    return;
  }
  if (sideOfRow(y) !== 'enemy') return;
  const old = enemyAt >= 0 ? w.enemies[enemyAt]! : null;
  if (old && old.kind === brush.kind && (old.level ?? 1) === brush.level) {
    w.enemies.splice(enemyAt, 1);
    return;
  }
  const spawn: EnemySpawn = { kind: brush.kind, x, y, level: brush.level };
  if (old) w.enemies[enemyAt] = spawn;
  else w.enemies.push(spawn);
}

/** Problems that keep the draft from running. */
export function validateDraft(d: LabDraft): string[] {
  const out: string[] = [];
  if (d.waves.length === 0) out.push('no waves');
  d.waves.forEach((w, i) => {
    if (w.enemies.length === 0) out.push(`wave ${i + 1}: no enemies`);
    for (const e of w.enemies) {
      if (cellContent(d, i, e.x, e.y).panel === 'BROKEN') out.push(`wave ${i + 1}: enemy on a hole at ${e.x},${e.y}`);
    }
  });
  return out;
}

function spawnTs(e: EnemySpawn): string {
  const level = (e.level ?? 1) === 1 ? '' : `, ${e.level}`;
  return `e('${e.kind}', ${e.x}, ${e.y}${level})`;
}

/** A fragment to paste into `STAGES` / `ENCOUNTERS` in data/encounters.ts. */
export function exportTs(d: LabDraft): string {
  const lines = ['{', `  id: '${d.id}', tier: '${d.tier}', minDepth: ${d.depth}, maxDepth: ${d.depth},`, '  waves: ['];
  for (const w of d.waves) {
    const enemies = w.enemies.map(spawnTs).join(', ');
    if (w.panels.length === 0) {
      lines.push(`    wave(${enemies}),`);
    } else {
      const panels = w.panels.map((p) => `{ x: ${p.x}, y: ${p.y}, panel: '${p.panel}' }`).join(', ');
      lines.push(`    { enemies: [${enemies}], panels: [${panels}] },`);
    }
  }
  lines.push('  ],', '},');
  return lines.join('\n');
}

const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

/** A draft saved by the Lab, or null if it no longer fits the current game. */
export function parseDraft(raw: string): LabDraft | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  const d = v as Partial<LabDraft>;
  if (!d || typeof d.id !== 'string' || !Array.isArray(d.waves)) return null;
  if (d.tier !== 'normal' && d.tier !== 'elite') return null;
  if (d.folder !== 'starter' && d.folder !== 'all') return null;
  if (!isInt(d.depth, 1, 99)) return null;
  for (const w of d.waves as LabWave[]) {
    if (!w || !Array.isArray(w.enemies) || !Array.isArray(w.panels)) return null;
    for (const e of w.enemies) {
      if (!ENEMY_KINDS.includes(e.kind) || !isInt(e.x, 0, COLS - 1) || !isInt(e.y, 0, ROWS - 1) || !isInt(e.level ?? 1, 1, 3)) return null;
    }
    for (const p of w.panels) {
      if ((p.panel !== 'CRACKED' && p.panel !== 'BROKEN') || !isInt(p.x, 0, COLS - 1) || !isInt(p.y, 0, ROWS - 1)) return null;
    }
  }
  return d as LabDraft;
}
