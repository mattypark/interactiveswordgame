import { MAPS, type MapDefinition, type MapMode } from '../maps/registry.js';

/**
 * Which full-screen menu is up, if any.
 *
 * The 3D scene runs the whole time underneath — the camera and tracking keep
 * warming up while you're reading the menu, so the first frame of play isn't
 * spent waiting for a model to load.
 */
export type ScreenId = 'welcome' | 'maps' | 'lobby' | 'playing';

export interface RouterEvents {
  /** A map was chosen and play should start. */
  play(map: MapDefinition): void;
  /** The live-versus lobby was asked for. */
  lobby(): void;
  /** A screen became visible; `playing` means the menus are down. */
  screen(id: ScreenId): void;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Screen element #${id} missing from index.html`);
  return node as T;
}

export class Router {
  private readonly welcome = el('screen-welcome');
  private readonly maps = el('screen-maps');
  private readonly lobby = el('screen-lobby');
  private readonly mapsList = el('maps-list');
  private readonly mapsHeading = el('maps-heading');

  private current: ScreenId = 'welcome';
  /** Which set of maps the picker is showing. */
  private mode: MapMode = 'fight';

  constructor(private readonly events: RouterEvents) {
    this.bind();
    this.show('welcome');
  }

  get screen(): ScreenId {
    return this.current;
  }

  private bind(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((button) => {
      button.addEventListener('click', () => {
        const target = button.dataset.go as ScreenId | 'lobby';
        if (target === 'lobby') {
          this.show('lobby');
          this.events.lobby();
          return;
        }
        if (target === 'maps') {
          this.mode = (button.dataset.mode as MapMode) ?? 'fight';
          this.renderMaps();
        }
        this.show(target as ScreenId);
      });
    });

    // Escape backs out of the picker, and out of a match to the menu.
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (this.current === 'maps' || this.current === 'lobby') this.show('welcome');
    });
  }

  private renderMaps(): void {
    const available = MAPS.filter((map) => map.mode === this.mode);
    this.mapsHeading.textContent = this.mode === 'fight' ? 'Fight' : 'Sandbox';

    this.mapsList.replaceChildren(
      ...available.map((map) => {
        const card = document.createElement('button');
        card.className = 'map';
        card.type = 'button';

        const swatch = document.createElement('div');
        swatch.className = 'map__swatch';
        // Built from the map's own palette rather than a stock image, so it
        // always matches what you actually load into.
        swatch.style.background = `linear-gradient(155deg, ${hex(map.lights.key)} -30%, ${hex(
          map.background,
        )} 45%, ${hex(map.lights.fill)} 160%)`;

        const name = document.createElement('div');
        name.className = 'map__name';
        name.textContent = map.name;

        const tagline = document.createElement('p');
        tagline.className = 'map__tagline';
        tagline.textContent = map.tagline;

        card.append(swatch, name, tagline);
        card.addEventListener('click', () => {
          this.show('playing');
          this.events.play(map);
        });
        return card;
      }),
    );
  }

  show(id: ScreenId): void {
    this.current = id;
    this.welcome.hidden = id !== 'welcome';
    this.maps.hidden = id !== 'maps';
    this.lobby.hidden = id !== 'lobby';
    this.events.screen(id);
  }
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
