import type { Field, Hazard } from './field';
import type { Cell, Side } from './grid';
import { inField } from './grid';
import type { Occupancy } from './occupancy';

export interface MovableActor {
  id: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  lastMoveTick: number;
}

export type MoveResult =
  | { moved: true; from: Cell; to: Cell; hazard: Hazard | null }
  | { moved: false; reason: 'edge' | 'ownership' | 'break' | 'object' | 'actor'; blockerId?: number };

export interface MovementWorld {
  tick: number;
  field: Field;
  occupancy: Occupancy;
  objectAt(x: number, y: number): unknown | null;
}

export function resolveMove(
  world: MovementWorld,
  actor: MovableActor,
  side: Side,
  to: Cell,
  kind: 'voluntary' | 'forced',
): MoveResult {
  if (!inField(to.x, to.y)) return { moved: false, reason: 'edge' };
  if (world.field.panel(to.x, to.y) === 'BROKEN') return { moved: false, reason: 'break' };
  if (kind === 'voluntary' && world.field.owner(to.x, to.y) !== side) {
    return { moved: false, reason: 'ownership' };
  }
  const blockerId = world.occupancy.get(to.x, to.y);
  if (blockerId !== null) {
    return world.objectAt(to.x, to.y)
      ? { moved: false, reason: 'object', blockerId }
      : { moved: false, reason: 'actor', blockerId };
  }
  const from = { x: actor.x, y: actor.y };
  const hazard = world.field.hazard(to.x, to.y);
  world.occupancy.move(actor.id, actor.x, actor.y, to.x, to.y);
  world.field.onLeave(actor.x, actor.y, world.tick);
  actor.prevX = actor.x;
  actor.prevY = actor.y;
  actor.x = to.x;
  actor.y = to.y;
  actor.lastMoveTick = world.tick;
  return { moved: true, from, to, hazard };
}
