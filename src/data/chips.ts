// Battle chip catalogue (GDD §6.2, roguelite spec §4). A chip is data: where it
// hits (shape), what a hit does (onHit), what it does to the field, and support
// effects. Values follow MMBN1; use times and effect durations are tunables.
// Names and descriptions live in i18n (`chip.<id>.name` / `chip.<id>.desc`).

export type ChipCode =
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M'
  | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z' | '*';

export type ChipId =
  | 'cannon' | 'hicannon' | 'mcannon' | 'airshot' | 'vgun' | 'sidegun' | 'spreader' | 'shotgun'
  | 'sword' | 'widesword' | 'longsword'
  | 'minibomb' | 'lilbomb' | 'crosbomb' | 'shockwave' | 'quake1' | 'zapring'
  | 'recov10' | 'recover50' | 'recov80' | 'invis'
  | 'crack' | 'geddon1' | 'geddon2' | 'steal' | 'repair' | 'rockcube';

/** Which tunable holds the use (animation) time: `CHIP_USE_TIME_<group>`. */
export type UseTimeGroup = 'CANNON' | 'SWORD' | 'BOMB' | 'RECOVER' | 'FIELD';
export type Rarity = 'common' | 'uncommon' | 'rare';

/** Offset from the player or the target; forward (toward the enemy) is −y. */
export interface Offset {
  x: number;
  y: number;
}

export type Shape =
  /** First target in the player's lane, plus cells around it. */
  | { t: 'lane'; around?: readonly Offset[] }
  /** Fixed cells around the player. */
  | { t: 'near'; cells: readonly Offset[] }
  /** Thrown `depth` rows ahead; `area` is around the landing cell. */
  | { t: 'lob'; depth: number; area: readonly Offset[] }
  /** Ground wave up the lane; stops at holes and objects. */
  | { t: 'wave' }
  | { t: 'self' };
export type ShapeKind = Shape['t'];

export interface OnHit {
  /** Hit enemies step one row back if they can. */
  push?: true;
  /** Hit enemies stop for PARALYZE_TIME. */
  paralyze?: true;
  /** Every cell of the hit area cracks or breaks. */
  panel?: 'crack' | 'break';
}

export type FieldAction = 'crackRow' | 'crackAll' | 'breakEnemy' | 'steal' | 'repair' | 'rock';

export interface ChipDef {
  id: ChipId;
  /** Damage, or null for chips that deal none. */
  power: number | null;
  kind: 'attack' | 'support' | 'field';
  useTime: UseTimeGroup;
  /** Codes this chip can come with (rewards pick one). */
  codes: readonly ChipCode[];
  rarity: Rarity;
  shape: Shape;
  onHit?: OnHit;
  field?: FieldAction;
  heal?: number;
  /** Enemy attacks pass through the player for INVIS_TIME. */
  invis?: true;
}

const RING: readonly Offset[] = [
  { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
  { x: -1, y: 0 }, { x: 1, y: 0 },
  { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 },
];
const SPOT: readonly Offset[] = [{ x: 0, y: 0 }];
const FIELD_CHIP = { power: null, kind: 'field', useTime: 'FIELD', shape: { t: 'self' } } as const;
const AHEAD: readonly Offset[] = [{ x: 0, y: -1 }];
const LANE: Shape = { t: 'lane' };

export const CHIPS: Record<ChipId, ChipDef> = {
  cannon: { id: 'cannon', power: 40, kind: 'attack', useTime: 'CANNON', codes: ['A', 'B', 'C', 'D', 'E'], rarity: 'common', shape: LANE },
  hicannon: { id: 'hicannon', power: 80, kind: 'attack', useTime: 'CANNON', codes: ['F', 'G', 'H', 'I', 'J'], rarity: 'uncommon', shape: LANE },
  sword: { id: 'sword', power: 80, kind: 'attack', useTime: 'SWORD', codes: ['B', 'K', 'L', 'P', 'S'], rarity: 'common', shape: { t: 'near', cells: AHEAD } },
  widesword: {
    id: 'widesword',
    power: 80,
    kind: 'attack',
    useTime: 'SWORD',
    codes: ['C', 'K', 'M', 'N', 'S'],
    rarity: 'uncommon',
    shape: { t: 'near', cells: [{ x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 }] },
  },
  longsword: {
    id: 'longsword',
    power: 80,
    kind: 'attack',
    useTime: 'SWORD',
    codes: ['D', 'E', 'N', 'O', 'S'],
    rarity: 'uncommon',
    shape: { t: 'near', cells: [{ x: 0, y: -1 }, { x: 0, y: -2 }] },
  },
  shotgun: {
    id: 'shotgun',
    power: 30,
    kind: 'attack',
    useTime: 'CANNON',
    codes: ['K', 'M', 'N', 'Q', 'R'],
    rarity: 'common',
    shape: { t: 'lane', around: [{ x: 0, y: -1 }] },
  },
  minibomb: {
    id: 'minibomb',
    power: 50,
    kind: 'attack',
    useTime: 'BOMB',
    codes: ['C', 'E', 'J', 'L', 'P'],
    rarity: 'common',
    shape: { t: 'lob', depth: 3, area: SPOT },
  },
  recover50: {
    id: 'recover50',
    power: null,
    kind: 'support',
    useTime: 'RECOVER',
    codes: ['A', 'C', 'E', 'G', 'L'],
    rarity: 'uncommon',
    shape: { t: 'self' },
    heal: 50,
  },
  mcannon: { id: 'mcannon', power: 120, kind: 'attack', useTime: 'CANNON', codes: ['K', 'L', 'M', 'N', 'O'], rarity: 'rare', shape: LANE },
  airshot: { id: 'airshot', power: 20, kind: 'attack', useTime: 'CANNON', codes: ['*'], rarity: 'common', shape: LANE, onHit: { push: true } },
  vgun: {
    id: 'vgun', power: 30, kind: 'attack', useTime: 'CANNON', codes: ['D', 'E', 'L', 'M', 'S'], rarity: 'common',
    shape: { t: 'lane', around: [{ x: -1, y: -1 }, { x: 1, y: -1 }] },
  },
  sidegun: {
    id: 'sidegun', power: 30, kind: 'attack', useTime: 'CANNON', codes: ['A', 'G', 'H', 'R', 'S'], rarity: 'common',
    shape: { t: 'lane', around: [{ x: -1, y: 0 }, { x: 1, y: 0 }] },
  },
  spreader: { id: 'spreader', power: 30, kind: 'attack', useTime: 'CANNON', codes: ['M', 'N', 'O', 'P', 'Q'], rarity: 'uncommon', shape: { t: 'lane', around: RING } },
  lilbomb: {
    id: 'lilbomb', power: 50, kind: 'attack', useTime: 'BOMB', codes: ['B', 'G', 'L', 'O', 'T'], rarity: 'common',
    shape: { t: 'lob', depth: 3, area: [{ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }] },
  },
  crosbomb: {
    id: 'crosbomb', power: 60, kind: 'attack', useTime: 'BOMB', codes: ['B', 'G', 'L', 'O', 'V'], rarity: 'uncommon',
    shape: { t: 'lob', depth: 3, area: [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }] },
  },
  shockwave: { id: 'shockwave', power: 60, kind: 'attack', useTime: 'CANNON', codes: ['C', 'D', 'J', 'L', 'M'], rarity: 'common', shape: { t: 'wave' } },
  quake1: {
    id: 'quake1', power: 90, kind: 'attack', useTime: 'BOMB', codes: ['A', 'B', 'Q', 'R', 'S'], rarity: 'uncommon',
    shape: { t: 'lob', depth: 3, area: SPOT }, onHit: { panel: 'crack' },
  },
  zapring: { id: 'zapring', power: 20, kind: 'attack', useTime: 'CANNON', codes: ['A', 'B', 'C', 'D', 'E'], rarity: 'common', shape: LANE, onHit: { paralyze: true } },
  recov10: { id: 'recov10', power: null, kind: 'support', useTime: 'RECOVER', codes: ['A', 'C', 'E', 'G', 'L'], rarity: 'common', shape: { t: 'self' }, heal: 10 },
  recov80: { id: 'recov80', power: null, kind: 'support', useTime: 'RECOVER', codes: ['A', 'C', 'E', 'G', 'L'], rarity: 'rare', shape: { t: 'self' }, heal: 80 },
  invis: { id: 'invis', power: null, kind: 'support', useTime: 'RECOVER', codes: ['*'], rarity: 'uncommon', shape: { t: 'self' }, invis: true },
  crack: { id: 'crack', ...FIELD_CHIP, codes: ['A', 'B', 'C', '*'], rarity: 'common', field: 'crackRow' },
  geddon1: { id: 'geddon1', ...FIELD_CHIP, codes: ['F', 'H', 'J', 'L', 'N'], rarity: 'uncommon', field: 'crackAll' },
  geddon2: { id: 'geddon2', ...FIELD_CHIP, codes: ['E', 'G', 'I', 'K', 'M'], rarity: 'rare', field: 'breakEnemy' },
  steal: { id: 'steal', ...FIELD_CHIP, codes: ['A', 'L', 'S', '*'], rarity: 'uncommon', field: 'steal' },
  repair: { id: 'repair', ...FIELD_CHIP, codes: ['A', 'B', 'C', 'D', '*'], rarity: 'common', field: 'repair' },
  rockcube: { id: 'rockcube', ...FIELD_CHIP, codes: ['*'], rarity: 'common', field: 'rock' },
};
