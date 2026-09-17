import { tuning } from '../../config/tuning';
import type { Dir, InputState } from './commands';
import { SwipeRecognizer } from './swipe';

// DOM input devices → InputState (GDD §12). Touch and mouse share the swipe logic.

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

/** Elements that own their pointer input: UI buttons, menus and the debug panel. */
function isUiTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.interactive, .lil-gui') !== null;
}

function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}

/** Keyboard: a press steps once; holding the key repeats (HOLD_REPEAT_DELAY / HOLD_REPEAT). */
export function attachKeyboard(input: InputState, target: Window = window): () => void {
  const down: Dir[] = [];

  const sync = () => input.setHeld(down[down.length - 1] ?? null);

  const onDown = (e: KeyboardEvent) => {
    if (isTextField(e.target)) return;
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
 * Swipe movement for touch and mouse drag: one swipe = one step. Only one
 * pointer drives movement at a time; other fingers stay free for buttons.
 */
export function attachSwipe(input: InputState, target: Window = window): () => void {
  const swipe = new SwipeRecognizer(tuning.input.SWIPE_MIN_PX);
  let pointerId: number | null = null;

  const onDown = (e: PointerEvent) => {
    if (pointerId !== null || isUiTarget(e.target)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointerId = e.pointerId;
    swipe.threshold = tuning.input.SWIPE_MIN_PX;
    swipe.begin(e.clientX, e.clientY);
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    // Coalesced events keep fast flicks from skipping over the threshold logic.
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const p of events.length ? events : [e]) {
      const dir = swipe.move(p.clientX, p.clientY);
      if (dir) input.push({ type: 'move', dir });
    }
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    swipe.end();
  };

  target.addEventListener('pointerdown', onDown);
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onUp);
  return () => {
    target.removeEventListener('pointerdown', onDown);
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onUp);
    target.removeEventListener('pointercancel', onUp);
  };
}

/**
 * Keeps the browser from turning in-game swipes into its own gestures
 * (back/forward navigation, pull-to-refresh, "swipe to close" in in-app
 * browsers). Touch moves are cancelled everywhere except inside scrollable UI.
 */
export function blockBrowserGestures(doc: Document = document): void {
  const allowScroll = (t: EventTarget | null) => t instanceof Element && t.closest('.custom-screen, .lil-gui') !== null;
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
