import type { ChipId, PatternId } from '../data/chips';
import type { Cell } from './grid';
import type { EntityId } from './occupancy';

// Events produced by the simulation during a tick. The app drains them each
// frame and forwards them to FX, HUD, audio and the debug log.

export type SimEvent =
  | {
      type: 'busterFired';
      x: number;
      fromY: number;
      /** Row where the shot stopped: the hit enemy's row, or -1 if it left the field. */
      toY: number;
      level: 0 | 1 | 2;
      damage: number;
      hitId: EntityId | null;
    }
  | { type: 'damaged'; targetId: EntityId; amount: number; x: number; y: number; hpLeft: number }
  | { type: 'enemyKilled'; id: EntityId; x: number; y: number }
  | { type: 'enemyRemoved'; id: EntityId }
  | { type: 'attackSpawned'; id: number; kind: string; x: number; y: number }
  | { type: 'stateChanged'; from: string; to: string }
  | { type: 'chipUsed'; defId: ChipId; x: number; y: number }
  | { type: 'chipInterrupted'; defId: ChipId }
  /** Visual footprint of a resolved chip; `cells` are the panels it swept or hit. */
  | { type: 'chipEffect'; defId: ChipId; pattern: PatternId; x: number; fromY: number; cells: Cell[]; toY: number }
  | { type: 'healed'; amount: number; x: number; y: number }
  | { type: 'bombThrown'; id: number }
  | { type: 'bombLanded'; id: number; x: number; y: number };
