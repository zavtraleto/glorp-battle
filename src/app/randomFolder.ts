import type { Rng } from '../core/rng';
import { CHIPS, type ChipCode, type ChipDef, type Rarity } from '../data/chips';
import { FOLDER_SIZE } from '../data/folders';
import type { FolderChip } from '../sim/chips/chipSystem';

// RANDOM starting folder (decision 2026-09-18): weighted by rarity, capped
// copies, a few heals, few field chips, codes leaning on three "core" codes so
// multi-selections sometimes line up. Pure and seeded.

export const RANDOM_MAX_COPIES = 4;
export const RANDOM_MIN_HEALS = 3;
export const RANDOM_MAX_FIELD = 4;
/** Chance a chip takes a core code when it has one. [оценка] */
const CORE_CODE_CHANCE = 0.7;
const CORE_CODES = 3;
const WEIGHT: Record<Rarity, number> = { common: 6, uncommon: 3, rare: 1 };

function weightedPick(rng: Rng, pool: readonly ChipDef[]): ChipDef {
  const total = pool.reduce((s, d) => s + WEIGHT[d.rarity], 0);
  let roll = rng.next() * total;
  for (const d of pool) {
    roll -= WEIGHT[d.rarity];
    if (roll < 0) return d;
  }
  return pool[pool.length - 1] as ChipDef;
}

export function randomFolder(rng: Rng): FolderChip[] {
  const all = Object.values(CHIPS);
  const letters = [...new Set(all.flatMap((d) => d.codes).filter((c) => c !== '*'))] as ChipCode[];
  const core = rng.shuffle(letters).slice(0, CORE_CODES);
  const counts = new Map<string, number>();
  const picked: ChipDef[] = [];
  const take = (pool: readonly ChipDef[]) => {
    const open = pool.filter((d) => (counts.get(d.id) ?? 0) < RANDOM_MAX_COPIES);
    if (open.length === 0) return;
    const d = weightedPick(rng, open);
    counts.set(d.id, (counts.get(d.id) ?? 0) + 1);
    picked.push(d);
  };
  const heals = all.filter((d) => d.heal);
  for (let i = 0; i < RANDOM_MIN_HEALS; i++) take(heals);
  while (picked.length < FOLDER_SIZE) {
    const field = picked.filter((d) => d.kind === 'field').length;
    const before = picked.length;
    take(field >= RANDOM_MAX_FIELD ? all.filter((d) => d.kind !== 'field') : all);
    // Every chip could be capped out (impossible with 27 chips × 4 copies,
    // but a stalled `take` must not spin forever).
    if (picked.length === before) break;
  }
  return picked.map((d) => {
    const coreCodes = d.codes.filter((c) => core.includes(c) || c === '*');
    const code: ChipCode = coreCodes.length > 0 && rng.next() < CORE_CODE_CHANCE ? rng.pick(coreCodes) : rng.pick(d.codes);
    return { defId: d.id, code };
  });
}
