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
  color: ChipColor;
  shape: Shape;
  onHit?: OnHit;
  field?: FieldAction;
  guard?: true;
}

const AHEAD: readonly Offset[] = [{ x: 0, y: -1 }];
const WIDE: readonly Offset[] = [{ x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 }];
const SIDES: readonly Offset[] = [{ x: -1, y: 0 }, { x: 1, y: 0 }];
const LANE: Shape = { t: 'lane' };
const SELF: Shape = { t: 'self' };
const BASE = { color: 'red' } as const;

export const CHIPS: Record<ChipId, ChipDef> = {
  cannon: {
    id: 'cannon', get power() { return tuning.cannon.DAMAGE; },
    kind: 'attack', shape: LANE, ...BASE,
  },
  sword: {
    id: 'sword', get power() { return tuning.sword.DAMAGE; },
    kind: 'attack', shape: { t: 'near', cells: AHEAD }, ...BASE,
  },
  areagrab: {
    id: 'areagrab', power: null, kind: 'field', shape: SELF, field: 'claim', ...BASE,
  },
  mine: {
    id: 'mine', get power() { return tuning.mine.DAMAGE; },
    kind: 'field', shape: SELF, field: 'arm', ...BASE,
  },
  block: {
    id: 'block', power: null, kind: 'field', shape: SELF, field: 'occupy', ...BASE,
  },
  break: {
    id: 'break', power: null, kind: 'field', shape: SELF, field: 'break', ...BASE,
  },
  airshot: {
    id: 'airshot', get power() { return tuning.airshot.DAMAGE; },
    kind: 'attack', shape: LANE,
    onHit: { push: true, pushRequiresDamage: true }, ...BASE,
  },
  spreader: {
    id: 'spreader', get power() { return tuning.spreader.DAMAGE; },
    get splashPower() { return tuning.spreader.SPLASH_DAMAGE; },
    kind: 'attack', shape: { t: 'lane', around: SIDES }, ...BASE,
  },
  widesword: {
    id: 'widesword', get power() { return tuning.widesword.DAMAGE; },
    kind: 'attack', shape: { t: 'near', cells: WIDE }, ...BASE,
  },
  guard: {
    id: 'guard', power: null, kind: 'support', shape: SELF, guard: true, ...BASE,
  },
};
