import { MAPS } from '../maps/registry.js';
import { VersusClient, isConfigured, type MatchSnapshot } from '../net/versus-client.js';

/**
 * The live-versus lobby: pick a name and an arena, queue up, wait for someone.
 *
 * Kept apart from the router because it owns a network connection and a bit of
 * state that outlives a screen change — you stay queued while you read the
 * rules.
 */

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Lobby element #${id} missing from index.html`);
  return node as T;
}

const NAME_KEY = 'onetwo.name';

export class Lobby {
  readonly client = new VersusClient();

  private readonly panel = el('lobby-panel');
  private readonly nameInput = el<HTMLInputElement>('lobby-name');
  private readonly mapSelect = el<HTMLSelectElement>('lobby-map');
  private readonly queueButton = el<HTMLButtonElement>('lobby-queue');
  private readonly status = el('lobby-status');

  constructor(private readonly onMatch: (match: MatchSnapshot) => void) {
    for (const map of MAPS.filter((candidate) => candidate.mode === 'fight')) {
      const option = document.createElement('option');
      option.value = map.id;
      option.textContent = map.name;
      this.mapSelect.append(option);
    }

    try {
      this.nameInput.value = localStorage.getItem(NAME_KEY) ?? '';
    } catch {
      // Blocked storage just means the field starts empty.
    }

    this.queueButton.addEventListener('click', () => void this.queue());

    this.client.onMatch = (match) => {
      if (!match) return;
      this.setStatus(`Matched with ${this.opponentName(match)}. Get your hands up.`, 'ok');
      this.onMatch(match);
    };

    if (!isConfigured()) {
      this.queueButton.disabled = true;
      this.setStatus(
        'Live versus needs a Convex deployment. Run `npx convex dev` once, then reload — ' +
          'Fight and Sandbox work without it.',
        'warn',
      );
    }
  }

  private opponentName(match: MatchSnapshot): string {
    return match.hostId === this.client.id ? match.guestName : match.hostName;
  }

  private setStatus(text: string, tone: 'normal' | 'warn' | 'ok' = 'normal'): void {
    this.status.textContent = text;
    this.status.className = `lobby__status${tone === 'normal' ? '' : ` is-${tone}`}`;
  }

  private async queue(): Promise<void> {
    const name = (this.nameInput.value.trim() || 'anon').slice(0, 18);
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      // Not being able to remember the name is not worth failing over.
    }

    const mapId = this.mapSelect.value;
    this.queueButton.disabled = true;
    this.setStatus('Looking for someone…');

    await this.client.queue(mapId, name);

    if (this.client.status === 'error') {
      this.queueButton.disabled = false;
      this.setStatus(this.client.error ?? 'Could not reach matchmaking.', 'warn');
      return;
    }

    if (this.client.status === 'queued') {
      this.setStatus('In the queue. This stays open — the fight starts the moment someone joins.');
    }
  }

  /** Called when the lobby screen is left without a match. */
  cancel(): void {
    this.queueButton.disabled = !isConfigured();
    void this.client.leave();
    if (isConfigured()) this.setStatus('Both of you need a camera and a bit of room.');
  }

  get mapId(): string {
    return this.mapSelect.value;
  }

  /** Kept for the contract test: the panel is the element the screen owns. */
  get root(): HTMLElement {
    return this.panel;
  }
}
