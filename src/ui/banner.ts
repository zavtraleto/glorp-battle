// Center banner with optional buttons: "ENEMY DELETED!", "GAME OVER"… (GDD §11).
// The full result/defeat screens arrive in M7; this is the minimal version.

export interface BannerButton {
  label: string;
  onClick: () => void;
}

export class Banner {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly buttons: HTMLElement;
  private currentKey = '';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'banner hidden';
    this.title = document.createElement('div');
    this.title.className = 'banner-title';
    this.buttons = document.createElement('div');
    this.buttons.className = 'banner-buttons';
    this.root.append(this.title, this.buttons);
    parent.appendChild(this.root);
  }

  /** Shows the banner; repeated calls with the same key are ignored. */
  show(key: string, text: string, variant: 'win' | 'lose' | 'info', buttons: BannerButton[] = []): void {
    if (key === this.currentKey) return;
    this.currentKey = key;
    this.title.textContent = text;
    this.root.dataset.variant = variant;
    this.buttons.replaceChildren(
      ...buttons.map((b) => {
        const el = document.createElement('button');
        el.className = 'banner-btn interactive';
        el.textContent = b.label;
        el.addEventListener('click', b.onClick);
        return el;
      }),
    );
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.currentKey = '';
    this.root.classList.add('hidden');
  }
}
