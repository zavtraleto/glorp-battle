import type { Dir, InputState } from './commands';

// Keyboard and browser-level input guards (GDD §12). Touch and mouse go through
// the terminal controls (src/terminal/interaction).

const KEY_DIRS: Record<string, Dir> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}

/** Keys that launch the selected Attack Queue (GDD §12). */
const CHIP_KEYS = new Set(['Space', 'KeyF']);
/** Digits 1..5 pick the chip in that hand slot. */
const SLOT_KEYS = 5;

/**
 * Keyboard: a movement press steps once; holding the key repeats
 * (HOLD_REPEAT_DELAY / HOLD_REPEAT). Space / F fire, digits 1..5 pick chips.
 */
export function attachKeyboard(input: InputState, target: Window = window): () => void {
  const down: Dir[] = [];

  const sync = () => input.setHeld(down[down.length - 1] ?? null);

  const onDown = (e: KeyboardEvent) => {
    if (isTextField(e.target)) return;
    if (CHIP_KEYS.has(e.code)) {
      e.preventDefault();
      if (!e.repeat) input.push({ type: 'useChip' });
      return;
    }
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) {
      const slot = Number(digit[1]) - 1;
      if (slot >= SLOT_KEYS) return;
      e.preventDefault();
      if (!e.repeat) input.push({ type: 'selectChip', slot });
      return;
    }
    const dir = KEY_DIRS[e.code];
    if (!dir) return;
    e.preventDefault();
    if (e.repeat) return; // OS auto-repeat is ignored; the simulation handles hold repeat.
    const i = down.indexOf(dir);
    if (i >= 0) down.splice(i, 1);
    down.push(dir);
    input.push({ type: 'move', dir });
    sync();
  };
  const onUp = (e: KeyboardEvent) => {
    const dir = KEY_DIRS[e.code];
    if (!dir) return;
    const i = down.indexOf(dir);
    if (i >= 0) down.splice(i, 1);
    sync();
  };
  const onBlur = () => {
    down.length = 0;
    sync();
  };

  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  target.addEventListener('blur', onBlur);
  return () => {
    target.removeEventListener('keydown', onDown);
    target.removeEventListener('keyup', onUp);
    target.removeEventListener('blur', onBlur);
  };
}

/**
 * Keeps the browser from turning in-game swipes into its own gestures
 * (back/forward navigation, pull-to-refresh, "swipe to close" in in-app
 * browsers). Touch moves are cancelled everywhere except inside scrollable UI.
 */
export function blockBrowserGestures(doc: Document = document): void {
  const allowScroll = (t: EventTarget | null) => t instanceof Element && t.closest('.debug-panel') !== null;
  doc.addEventListener(
    'touchmove',
    (e) => {
      if (e.cancelable && !allowScroll(e.target)) e.preventDefault();
    },
    { passive: false },
  );
  // Multi-finger touches never zoom or navigate.
  doc.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length > 1 && e.cancelable) e.preventDefault();
    },
    { passive: false },
  );
}

/**
 * Traps history navigation (Android back button, iOS edge swipe in web views):
 * instead of leaving the page, `onBack` is called and the trap is re-armed.
 */
export function trapBackNavigation(onBack: () => void, win: Window = window): void {
  const arm = () => win.history.pushState({ glorpTrap: true }, '');
  arm();
  win.addEventListener('popstate', () => {
    onBack();
    arm();
  });
}
