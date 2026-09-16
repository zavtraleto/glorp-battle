// Battle chip catalogue (GDD §6.2). Values follow MMBN1; use times are tunables.

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
  name: string;
  /** Short label for placeholder icons. */
  abbr: string;
  /** Placeholder icon color. */
  color: string;
  /** Damage, or null for support chips. */
  power: number | null;
  kind: 'attack' | 'support';
  pattern: PatternId;
  useTime: UseTimeGroup;
  description: string;
}

export const CHIPS: Record<ChipId, ChipDef> = {
  cannon: {
    id: 'cannon',
    name: 'Cannon',
    abbr: 'CN',
    color: '#8fb3ff',
    power: 40,
    kind: 'attack',
    pattern: 'lane_hitscan',
    useTime: 'CANNON',
    description: 'Hits the first enemy in your lane.',
  },
  hicannon: {
    id: 'hicannon',
    name: 'HiCannon',
    abbr: 'HC',
    color: '#5f86ff',
    power: 80,
    kind: 'attack',
    pattern: 'lane_hitscan',
    useTime: 'CANNON',
    description: 'A bigger cannon. Hits the first enemy in your lane.',
  },
  sword: {
    id: 'sword',
    name: 'Sword',
    abbr: 'SW',
    color: '#ffd166',
    power: 80,
    kind: 'attack',
    pattern: 'melee_1',
    useTime: 'SWORD',
    description: 'Slashes the panel in front of you.',
  },
  widesword: {
    id: 'widesword',
    name: 'WideSword',
    abbr: 'WS',
    color: '#ffb347',
    power: 80,
    kind: 'attack',
    pattern: 'melee_wide',
    useTime: 'SWORD',
    description: 'Slashes the whole row in front of you.',
  },
  longsword: {
    id: 'longsword',
    name: 'LongSword',
    abbr: 'LS',
    color: '#ff9f1c',
    power: 80,
    kind: 'attack',
    pattern: 'melee_long',
    useTime: 'SWORD',
    description: 'Slashes two panels ahead.',
  },
  shotgun: {
    id: 'shotgun',
    name: 'Shotgun',
    abbr: 'SG',
    color: '#b8c0ff',
    power: 30,
    kind: 'attack',
    pattern: 'lane_hitscan_pierce1',
    useTime: 'CANNON',
    description: 'Hits an enemy and the panel behind it.',
  },
  minibomb: {
    id: 'minibomb',
    name: 'MiniBomb',
    abbr: 'MB',
    color: '#ff6b6b',
    power: 50,
    kind: 'attack',
    pattern: 'lob_3',
    useTime: 'BOMB',
    description: 'Throws a bomb 3 panels ahead.',
  },
  recover50: {
    id: 'recover50',
    name: 'Recover50',
    abbr: 'R50',
    color: '#7dff9e',
    power: null,
    kind: 'support',
    pattern: 'self_heal',
    useTime: 'RECOVER',
    description: 'Restores 50 HP.',
  },
};
