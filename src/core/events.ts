// Typed event bus (GDD §15.1). FX, HUD, audio and debug log subscribe here.

export interface GameEvents {
  stateChanged: { from: string; to: string };
  seedChanged: { seed: number };
  debugRestart: Record<string, never>;
}

type Handler<T> = (payload: T) => void;

export class EventBus<E extends object = GameEvents> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();
  logEnabled = false;

  on<K extends keyof E>(type: K, handler: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<never>);
    return () => set.delete(handler as Handler<never>);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    if (this.logEnabled) console.debug('[event]', type, payload);
    const set = this.handlers.get(type);
    if (!set) return;
    for (const h of set) (h as Handler<E[K]>)(payload);
  }
}

export const events = new EventBus<GameEvents>();
