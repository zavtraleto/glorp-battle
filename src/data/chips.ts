import { tuning } from '../config/tuning';

// Ten-chip playtest catalogue. Chips describe geometry and generic world verbs;
// the simulation owns interactions between those verbs.

/**
 * Chip colour, shown on the cartridge (GDD §6.1). Every chip is red for now;
 * colours are the base of the future combination rules.
 */
export type ChipColor = 'red';

export type ChipId =
  | 'cannon'
  | 'sword'
  | 'areagrab'
  | 'mine'
  | 'block'
  | 'break'
  | 'airshot'
  | 'spreader'
  | 'widesword'
  | 'guard';

export type UseTimeGroup = 'CANNON' | 'SWORD' | 'FIELD';

export interface Offset {
  x: number;
  y: number;
}

export type Shape =
  | { t: 'lane'; around?: readonly Offset[] }
  | { t: 'near'; cells: readonly Offset[] }
  | { t: 'self' };
export type ShapeKind = Shape['t'];

export interface OnHit {
  push?: true;
  pushRequiresDamage?: true;
}

export type FieldAction = 'claim' | 'arm' | 'occupy' | 'break';

export interface ChipDef {
  id: ChipId;
  power: number | null;
  splashPower?: number;
  kind: 'attack' | 'support' | 'field';
  useTime: UseTimeGroup;
  color: ChipColor;
  shape: Shape;
  onHit?: OnHit;
  field?: FieldAction;
  guard?: true;
  /** Uses per battle of one copy (GDD §6.1). */
  readonly charges: number;
}

const AHEAD: readonly Offset[] = [{ x: 0, y: -1 }];
const WIDE: readonly Offset[] = [{ x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 }];
const SIDES: readonly Offset[] = [{ x: -1, y: 0 }, { x: 1, y: 0 }];
const LANE: Shape = { t: 'lane' };
const SELF: Shape = { t: 'self' };
const BASE = { color: 'red' } as const;

export const CHIPS: Record<ChipId, ChipDef> = {
  cannon: {
    id: 'cannon', get power() { return tuning.chips.CHIP_DAMAGE_CANNON; },
    kind: 'attack', useTime: 'CANNON', shape: LANE, ...BASE,
    get charges() { return tuning.chips.CHIP_CHARGES_ATTACK; },
  },
  sword: {
    id: 'sword', get power() { return tuning.chips.CHIP_DAMAGE_SWORD; },
    kind: 'attack', useTime: 'SWORD', shape: { t: 'near', cells: AHEAD }, ...BASE,
    get charges() { return tuning.chips.CHIP_CHARGES_ATTACK; },
  },
  areagrab: {
    id: 'areagrab', power: null, kind: 'field', useTime: 'FIELD', shape: SELF, field: 'claim', ...BASE,
    get charges() { return tuning.chips.CHIP_CHARGES_SUPPORT; },
  },
  mine: {
    id: 'mine', get power() { return tuning.chips.CHIP_DAMAGE_MINE; },
    kind: 'field', useTime: 'FIELD', shape: SELF, field: 'arm', ...BASE,
    get charges() { return tuning.chips.CHIP_CHARGES_SUPPORT; },
  },
  block: {
    id: 'block', power: null, kind: 'field', useTime: 'FIELD', shape: SELF, field: 'occupy', ...BASE,
    get charges() { return tuning.chips.CHIP_CHARGES_SUPPORT; },
  },
  break: {
    id: 'break', power: null, kind: 'field', useTime: 'FIELD', shape: SELF, field: 'break', ...BASE,
    get charges() { return tuning.chips.CHIP_CHARGES_SUPPORT; },
  },
  airshot: {
    id: 'airshot', get power() { return tuning.chips.CHIP_DAMAGE_AIRSHOT; },
    kind: 'attack', useTime: 'CANNON', shape: LANE,
    onHit: { push: true, pushRequiresDamage: true }, ...BASE,
    get charges() { return tuning.chips.CHIP_CHARGES_ATTACK; },
  },
  spreader: {
    id: 'spreader', get power() { return tuning.chips.CHIP_DAMAGE_SPREADER_MAIN; },
    get splashPower() { return tuning.chips.CHIP_DAMAGE_SPREADER_SPLASH; },
    kind: 'attack', useTime: 'CANNON', shape: { t: 'lane', around: SIDES }, ...BASE,
    get charges() { return tuning.chips.CHIP_CHARGES_ATTACK; },
  },
  widesword: {
    id: 'widesword', get power() { return tuning.chips.CHIP_DAMAGE_WIDESWORD; },
    kind: 'attack', useTime: 'SWORD', shape: { t: 'near', cells: WIDE }, ...BASE,
    get charges() { return tuning.chips.CHIP_CHARGES_ATTACK; },
  },
  guard: {
    id: 'guard', power: null, kind: 'support', useTime: 'FIELD', shape: SELF, guard: true, ...BASE,
    get charges() { return tuning.chips.CHIP_CHARGES_SUPPORT; },
  },
};
