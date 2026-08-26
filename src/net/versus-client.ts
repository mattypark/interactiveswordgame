/**
 * The client half of live versus.
 *
 * Wraps the Convex browser client so the rest of the game doesn't have to know
 * about it, and so a build with no Convex deployment configured degrades to a
 * clear message rather than a stack trace.
 *
 * State is pushed on a timer rather than every frame: at 60Hz this would be
 * 3,600 writes a minute per player for motion the other end interpolates
 * anyway.
 */

export interface Vec3Lite {
  x: number;
  y: number;
  z: number;
}

export interface FighterSnapshot {
  head: Vec3Lite;
  fist: Vec3Lite;
  health: number;
  rounds: number;
  punchSeq: number;
  punchDamage: number;
  updatedAt: number;
}

export interface MatchSnapshot {
  _id: string;
  mapId: string;
  hostId: string;
  guestId: string;
  hostName: string;
  guestName: string;
  phase: 'waiting' | 'fighting' | 'knockdown' | 'over';
  round: number;
  host: FighterSnapshot;
  guest: FighterSnapshot;
}

export type VersusStatus = 'unconfigured' | 'idle' | 'queued' | 'matched' | 'error';

/** How often local state is pushed to the server. Hz. */
export const PUSH_HZ = 12;

export function isConfigured(): boolean {
  return Boolean(import.meta.env.VITE_CONVEX_URL);
}

/** A stable per-browser id, so a refresh rejoins as the same player. */
export function playerId(): string {
  const key = 'onetwo.playerId';
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const fresh = `p_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(key, fresh);
    return fresh;
  } catch {
    // Private windows and blocked storage: a per-session id still works.
    return `p_${Math.random().toString(36).slice(2, 10)}`;
  }
}

type Unsubscribe = () => void;

interface ConvexLike {
  mutation(name: string, args: Record<string, unknown>): Promise<unknown>;
  onUpdate(
    name: string,
    args: Record<string, unknown>,
    callback: (value: unknown) => void,
  ): Unsubscribe;
  close(): void;
}

export class VersusClient {
  status: VersusStatus = isConfigured() ? 'idle' : 'unconfigured';
  error: string | null = null;
  match: MatchSnapshot | null = null;

  readonly id = playerId();

  private client: ConvexLike | null = null;
  private unsubscribeMatch: Unsubscribe | null = null;
  private unsubscribeQueue: Unsubscribe | null = null;
  private pushTimer: ReturnType<typeof setInterval> | null = null;

  /** Called whenever the match row changes. */
  onMatch: ((match: MatchSnapshot | null) => void) | null = null;

  private async connect(): Promise<ConvexLike | null> {
    if (this.client) return this.client;
    const url = import.meta.env.VITE_CONVEX_URL;
    if (!url) {
      this.status = 'unconfigured';
      return null;
    }

    try {
      const { ConvexClient } = await import('convex/browser');
      this.client = new ConvexClient(url) as unknown as ConvexLike;
      return this.client;
    } catch (error) {
      this.status = 'error';
      this.error = `Could not reach the matchmaking server: ${String(error)}`;
      return null;
    }
  }

  async queue(mapId: string, name: string): Promise<void> {
    const client = await this.connect();
    if (!client) return;

    try {
      this.status = 'queued';
      await client.mutation('matchmaking:join', { playerId: this.id, name, mapId });

      // Whether you paired immediately or are waiting for someone, the same
      // subscription tells you the moment a match exists.
      this.unsubscribeMatch?.();
      this.unsubscribeMatch = client.onUpdate(
        'matchmaking:myMatch',
        { playerId: this.id },
        (value) => {
          const match = value as MatchSnapshot | null;
          this.match = match;
          if (match) this.status = 'matched';
          this.onMatch?.(match);
        },
      );
    } catch (error) {
      this.status = 'error';
      this.error = `Matchmaking failed: ${String(error)}`;
    }
  }

  /** Which half of the match row is yours. */
  get side(): 'host' | 'guest' | null {
    if (!this.match) return null;
    if (this.match.hostId === this.id) return 'host';
    if (this.match.guestId === this.id) return 'guest';
    return null;
  }

  get opponent(): FighterSnapshot | null {
    if (!this.match) return null;
    return this.side === 'host' ? this.match.guest : this.match.host;
  }

  get you(): FighterSnapshot | null {
    if (!this.match) return null;
    return this.side === 'host' ? this.match.host : this.match.guest;
  }

  /** Start pushing local state. `read` is called on each tick. */
  startPushing(read: () => { head: Vec3Lite; fist: Vec3Lite; punchSeq: number; punchDamage: number }): void {
    this.stopPushing();
    this.pushTimer = setInterval(() => {
      void this.pushOnce(read());
    }, 1000 / PUSH_HZ);
  }

  private async pushOnce(payload: {
    head: Vec3Lite;
    fist: Vec3Lite;
    punchSeq: number;
    punchDamage: number;
  }): Promise<void> {
    const client = this.client;
    const match = this.match;
    if (!client || !match) return;

    try {
      await client.mutation('live:push', { matchId: match._id, playerId: this.id, ...payload });
    } catch (error) {
      // One dropped push is nothing; a broken connection surfaces on the next.
      this.error = String(error);
    }
  }

  stopPushing(): void {
    if (this.pushTimer !== null) clearInterval(this.pushTimer);
    this.pushTimer = null;
  }

  async leave(): Promise<void> {
    this.stopPushing();
    this.unsubscribeMatch?.();
    this.unsubscribeQueue?.();
    this.unsubscribeMatch = null;
    this.unsubscribeQueue = null;

    try {
      if (this.match) await this.client?.mutation('live:forfeit', { matchId: this.match._id });
      else await this.client?.mutation('matchmaking:leave', { playerId: this.id });
    } catch {
      // Leaving is best-effort; stale queue entries time out server-side.
    }

    this.match = null;
    this.status = isConfigured() ? 'idle' : 'unconfigured';
  }

  dispose(): void {
    void this.leave();
    this.client?.close();
    this.client = null;
  }
}
