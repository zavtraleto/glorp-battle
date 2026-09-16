import { COLS, ROWS, inField } from './grid';

// One character per cell (GDD §2.1). Projectiles and effects never occupy cells.

export type EntityId = number;

export class Occupancy {
  private cells: (EntityId | null)[] = new Array(COLS * ROWS).fill(null);

  private index(x: number, y: number): number {
    return y * COLS + x;
  }

  get(x: number, y: number): EntityId | null {
    return inField(x, y) ? (this.cells[this.index(x, y)] ?? null) : null;
  }

  isFree(x: number, y: number): boolean {
    return inField(x, y) && this.cells[this.index(x, y)] === null;
  }

  place(id: EntityId, x: number, y: number): void {
    if (!this.isFree(x, y)) throw new Error(`cell ${x},${y} is not free`);
    this.cells[this.index(x, y)] = id;
  }

  move(id: EntityId, fromX: number, fromY: number, toX: number, toY: number): void {
    if (this.get(fromX, fromY) !== id) throw new Error(`entity ${id} is not at ${fromX},${fromY}`);
    this.place(id, toX, toY);
    this.cells[this.index(fromX, fromY)] = null;
  }

  remove(id: EntityId, x: number, y: number): void {
    if (this.get(x, y) === id) this.cells[this.index(x, y)] = null;
  }
}
