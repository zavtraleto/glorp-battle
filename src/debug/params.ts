// URL debug parameters (GDD §15.5): ?debug=1&seed=123&battle=3&folder=p1&god=1&timescale=0.5

export interface DebugParams {
  debug: boolean;
  seed: number | null;
  battle: number;
  folder: 'mvp' | 'p1';
  god: boolean;
  timescale: number;
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
  return {
    debug: flag('debug'),
    seed: seed === null ? null : Math.floor(seed) >>> 0,
    battle: battle === null ? 1 : Math.min(4, Math.max(1, Math.floor(battle))),
    folder: q.get('folder') === 'p1' ? 'p1' : 'mvp',
    god: flag('god'),
    timescale: timescale === null ? 1 : Math.min(4, Math.max(0.05, timescale)),
  };
}
