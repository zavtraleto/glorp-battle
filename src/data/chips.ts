// Battle chip catalogue (GDD §6.2, roguelite spec §4). A chip is data: where it
// hits (shape), what a hit does (onHit), what it does to the field, and support
// effects. Values and codes follow MMBN3 (MMKB chip list); use times and effect
// durations are tunables. Names and descriptions live in i18n
// (`chip.<id>.name` / `chip.<id>.desc`).

export type ChipCode =
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M'
  | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z' | '*';

export type ChipId =
  | 'cannon' | 'hicannon' | 'mcannon' | 'airshot' | 'shotgun' | 'vgun' | 'sidegun' | 'spreader'
  | 'sword' | 'widesword' | 'longsword'
  | 'minibomb' | 'shockwave' | 'zapring'
  | 'recov10' | 'recov30' | 'recover50' | 'recov80' | 'invis'
  | 'geddon1' | 'geddon2' | 'areagrab' | 'panlgrab' | 'panlout1' | 'panlout3' | 'repair' | 'rockcube';

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
}

export type FieldAction =
  | 'crackAll' | 'breakEnemy' | 'areaGrab' | 'grabPanel' | 'breakAhead' | 'breakRowAhead' | 'repair' | 'rock';

export interface ChipDef {
  id: ChipId;
  /** Damage, or null for chips that deal none. */
  power: number | null;
  kind: 'attack' | 'support' | 'field';
  useTime: UseTimeGroup;
  /** Seconds before this chip's spent slot refills; the common tuning is used when omitted. */
  cooldown?: number;
  /** Codes this chip can come with. */
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
  cannon: { id: 'cannon', power: 40, kind: 'attack', useTime: 'CANNON', codes: ['A', 'B', 'C', 'D', 'E', '*'], rarity: 'common', shape: LANE },
  hicannon: { id: 'hicannon', power: 60, kind: 'attack', useTime: 'CANNON', codes: ['H', 'I', 'J', 'K', 'L', '*'], rarity: 'uncommon', shape: LANE },
  mcannon: { id: 'mcannon', power: 80, kind: 'attack', useTime: 'CANNON', codes: ['O', 'P', 'Q', 'R', 'S'], rarity: 'rare', shape: LANE },
  airshot: { id: 'airshot', power: 20, kind: 'attack', useTime: 'CANNON', codes: ['*'], rarity: 'common', shape: LANE, onHit: { push: true } },
  shotgun: {
    id: 'shotgun',
    power: 30,
    kind: 'attack',
    useTime: 'CANNON',
    codes: ['B', 'F', 'J', 'N', 'T', '*'],
    rarity: 'common',
    shape: { t: 'lane', around: [{ x: 0, y: -1 }] },
  },
  vgun: {
    id: 'vgun', power: 30, kind: 'attack', useTime: 'CANNON', codes: ['D', 'G', 'L', 'P', 'V', '*'], rarity: 'common',
    shape: { t: 'lane', around: [{ x: -1, y: -1 }, { x: 1, y: -1 }] },
  },
  sidegun: {
    id: 'sidegun', power: 30, kind: 'attack', useTime: 'CANNON', codes: ['C', 'H', 'M', 'S', 'Y', '*'], rarity: 'common',
    shape: { t: 'lane', around: [{ x: -1, y: 0 }, { x: 1, y: 0 }] },
  },
  spreader: { id: 'spreader', power: 30, kind: 'attack', useTime: 'CANNON', codes: ['M', 'N', 'O', 'P', 'Q', '*'], rarity: 'uncommon', shape: { t: 'lane', around: RING } },
  sword: { id: 'sword', power: 80, kind: 'attack', useTime: 'SWORD', codes: ['E', 'H', 'L', 'S', 'Y'], rarity: 'common', shape: { t: 'near', cells: AHEAD } },
  widesword: {
    id: 'widesword',
    power: 80,
    kind: 'attack',
    useTime: 'SWORD',
    codes: ['C', 'E', 'L', 'Q', 'Y'],
    rarity: 'uncommon',
    shape: { t: 'near', cells: [{ x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 }] },
  },
  longsword: {
    id: 'longsword',
    power: 80,
    kind: 'attack',
    useTime: 'SWORD',
    codes: ['E', 'I', 'L', 'R', 'Y'],
    rarity: 'uncommon',
    shape: { t: 'near', cells: [{ x: 0, y: -1 }, { x: 0, y: -2 }] },
  },
  minibomb: {
    id: 'minibomb',
    power: 50,
    kind: 'attack',
    useTime: 'BOMB',
    codes: ['B', 'G', 'L', 'O', 'S', '*'],
    rarity: 'common',
    shape: { t: 'lob', depth: 3, area: SPOT },
  },
  shockwave: { id: 'shockwave', power: 60, kind: 'attack', useTime: 'CANNON', codes: ['D', 'H', 'J', 'L', 'R'], rarity: 'common', shape: { t: 'wave' } },
  zapring: { id: 'zapring', power: 20, kind: 'attack', useTime: 'CANNON', codes: ['A', 'M', 'P', 'Q', 'S', '*'], rarity: 'common', shape: LANE, onHit: { paralyze: true } },
  recov10: { id: 'recov10', power: null, kind: 'support', useTime: 'RECOVER', codes: ['A', 'C', 'E', 'G', 'L', '*'], rarity: 'common', shape: { t: 'self' }, heal: 10 },
  recov30: { id: 'recov30', power: null, kind: 'support', useTime: 'RECOVER', codes: ['B', 'D', 'F', 'H', 'M', '*'], rarity: 'common', shape: { t: 'self' }, heal: 30 },
  recover50: {
    id: 'recover50',
    power: null,
    kind: 'support',
    useTime: 'RECOVER',
    codes: ['C', 'E', 'G', 'I', 'N', '*'],
    rarity: 'uncommon',
    shape: { t: 'self' },
    heal: 50,
  },
  recov80: { id: 'recov80', power: null, kind: 'support', useTime: 'RECOVER', codes: ['D', 'F', 'H', 'J', 'O', '*'], rarity: 'rare', shape: { t: 'self' }, heal: 80 },
  invis: { id: 'invis', power: null, kind: 'support', useTime: 'RECOVER', codes: ['B', 'E', 'F', 'R', 'S', '*'], rarity: 'uncommon', shape: { t: 'self' }, invis: true },
  geddon1: { id: 'geddon1', ...FIELD_CHIP, codes: ['D', 'J', 'M', 'O', 'S', '*'], rarity: 'uncommon', field: 'crackAll' },
  geddon2: { id: 'geddon2', ...FIELD_CHIP, codes: ['F', 'H', 'N', 'O', 'W'], rarity: 'rare', field: 'breakEnemy' },
  areagrab: { id: 'areagrab', ...FIELD_CHIP, codes: ['E', 'L', 'R', 'S', 'Y', '*'], rarity: 'uncommon', field: 'areaGrab' },
  panlgrab: { id: 'panlgrab', ...FIELD_CHIP, codes: ['A', 'H', 'L', 'S', 'Y', '*'], rarity: 'common', field: 'grabPanel' },
  panlout1: { id: 'panlout1', ...FIELD_CHIP, codes: ['A', 'B', 'D', 'L', 'S', '*'], rarity: 'common', field: 'breakAhead' },
  panlout3: { id: 'panlout3', ...FIELD_CHIP, codes: ['C', 'E', 'N', 'R', 'Y'], rarity: 'uncommon', field: 'breakRowAhead' },
  repair: { id: 'repair', ...FIELD_CHIP, codes: ['A', 'C', 'D', 'F', 'S', '*'], rarity: 'common', field: 'repair' },
  rockcube: { id: 'rockcube', ...FIELD_CHIP, codes: ['A', 'C', 'E', 'H', 'R', '*'], rarity: 'common', field: 'rock' },
};
