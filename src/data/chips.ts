// Battle chip catalogue (GDD §6.2). Values follow MMBN1; use times are tunables.
// Names and descriptions live in i18n (`chip.<id>.name` / `chip.<id>.desc`).

export type ChipId = 'cannon' | 'hicannon' | 'sword' | 'widesword' | 'longsword' | 'shotgun' | 'minibomb' | 'recover50';

export type ChipCode =
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M'
  | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z' | '*';

export type PatternId =
  | 'lane_hitscan'
  | 'lane_hitscan_pierce1'
  | 'melee_1'
  | 'melee_wide'
  | 'melee_long'
  | 'lob_3'
  | 'self_heal';

/** Which tunable holds the use (animation) time: `CHIP_USE_TIME_<group>`. */
export type UseTimeGroup = 'CANNON' | 'SWORD' | 'BOMB' | 'RECOVER';

export interface ChipDef {
  id: ChipId;
  /** Short label for placeholder icons. */
  abbr: string;
  /** Placeholder icon color. */
  color: string;
  /** Damage, or null for support chips. */
  power: number | null;
  kind: 'attack' | 'support';
  pattern: PatternId;
  useTime: UseTimeGroup;
}

export const CHIPS: Record<ChipId, ChipDef> = {
  cannon: {
    id: 'cannon',
    abbr: 'CN',
    color: '#8fb3ff',
    power: 40,
    kind: 'attack',
    pattern: 'lane_hitscan',
    useTime: 'CANNON',
  },
  hicannon: {
    id: 'hicannon',
    abbr: 'HC',
    color: '#5f86ff',
    power: 80,
    kind: 'attack',
    pattern: 'lane_hitscan',
    useTime: 'CANNON',
  },
  sword: {
    id: 'sword',
    abbr: 'SW',
    color: '#ffd166',
    power: 80,
    kind: 'attack',
    pattern: 'melee_1',
    useTime: 'SWORD',
  },
  widesword: {
    id: 'widesword',
    abbr: 'WS',
    color: '#ffb347',
    power: 80,
    kind: 'attack',
    pattern: 'melee_wide',
    useTime: 'SWORD',
  },
  longsword: {
    id: 'longsword',
    abbr: 'LS',
    color: '#ff9f1c',
    power: 80,
    kind: 'attack',
    pattern: 'melee_long',
    useTime: 'SWORD',
  },
  shotgun: {
    id: 'shotgun',
    abbr: 'SG',
    color: '#b8c0ff',
    power: 30,
    kind: 'attack',
    pattern: 'lane_hitscan_pierce1',
    useTime: 'CANNON',
  },
  minibomb: {
    id: 'minibomb',
    abbr: 'MB',
    color: '#ff6b6b',
    power: 50,
    kind: 'attack',
    pattern: 'lob_3',
    useTime: 'BOMB',
  },
  recover50: {
    id: 'recover50',
    abbr: 'R50',
    color: '#7dff9e',
    power: null,
    kind: 'support',
    pattern: 'self_heal',
    useTime: 'RECOVER',
  },
};
