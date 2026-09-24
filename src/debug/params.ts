// URL debug parameters (GDD §15.5, TERMINAL.md §14):
// ?debug=1&seed=123&battle=3&encounter=e1&wave=2&folder=basic|field|all&god=1&timescale=0.5
// ?rscale=300&crtres=160x240&bench=1&hitzones=1

import type { FolderId } from '../data/folders';

export interface DebugParams {
  debug: boolean;
  seed: number | null;
  battle: number;
  /** Encounter id to jump into (roguelite spec §6.6). */
  encounter: string | null;
  /** 1-based wave to start the debug battle from (GDD §10.4). */
  wave: number;
  folder: FolderId;
  god: boolean;
  timescale: number;
  /** Overrides `tuning.terminal.RENDER_SCALE_SHORT`. */
  rscale: number | null;
  /** Overrides the CRT render target size `[w, h]`. */
  crtres: [number, number] | null;
  /** Autopilot benchmark (debug/bench.ts). */
  bench: boolean;
  /** Draws the pointer hit zones. */
  hitzones: boolean;
}

export function parseDebugParams(search: string): DebugParams {
  const q = new URLSearchParams(search);
  const flag = (k: string) => q.get(k) === '1' || q.get(k) === 'true';
  const num = (k: string) => {
    const raw = q.get(k);
    if (raw === null || raw.trim() === '') return null;
    const v = Number(raw);
    return Number.isFinite(v) ? v : null;
  };
  const seed = num('seed');
  const battle = num('battle');
  const timescale = num('timescale');
  const wave = num('wave');
  const rscale = num('rscale');
  const crt = /^(\d+)x(\d+)$/.exec(q.get('crtres') ?? '');
  const crtW = crt ? Number(crt[1]) : 0;
  const crtH = crt ? Number(crt[2]) : 0;
  return {
    debug: flag('debug'),
    seed: seed === null ? null : Math.floor(seed) >>> 0,
    battle: battle === null ? 1 : Math.min(4, Math.max(1, Math.floor(battle))),
    encounter: q.get('encounter'),
    wave: wave === null ? 1 : Math.max(1, Math.floor(wave)),
    folder: (['basic', 'field', 'all'] as const).find((f) => f === q.get('folder')) ?? 'basic',
    god: flag('god'),
    timescale: timescale === null ? 1 : Math.min(4, Math.max(0.05, timescale)),
    rscale: rscale === null ? null : Math.min(2160, Math.max(120, Math.round(rscale))),
    crtres: crtW > 0 && crtH > 0 ? [crtW, crtH] : null,
    bench: flag('bench'),
    hitzones: flag('hitzones'),
  };
}
