/**
 * Match state: two fighters, health, rounds and who won.
 *
 * Pure — no three.js, no DOM. The same object runs a match against the AI and
 * a match against another person; only who feeds it damage differs.
 */

export type Side = 'you' | 'them';
export type MatchPhase = 'ready' | 'fighting' | 'knockdown' | 'over';

export const MAX_HEALTH = 100;
export const ROUND_SECONDS = 90;

/** How long the knockdown pause lasts before the next round. */
export const KNOCKDOWN_SECONDS = 2.2;

/** Rounds needed to take the match. */
export const ROUNDS_TO_WIN = 2;

export interface MatchState {
  phase: MatchPhase;
  health: Record<Side, number>;
  rounds: Record<Side, number>;
  /** Seconds left in the round. */
  timeLeft: number;
  /** Who won the last round, while phase is 'knockdown'. */
  lastRoundWinner: Side | null;
  /** Who won the match, once phase is 'over'. */
  winner: Side | null;
  /** Round number, from 1. */
  round: number;
}

function other(side: Side): Side {
  return side === 'you' ? 'them' : 'you';
}

export class Match {
  readonly state: MatchState = {
    phase: 'ready',
    health: { you: MAX_HEALTH, them: MAX_HEALTH },
    rounds: { you: 0, them: 0 },
    timeLeft: ROUND_SECONDS,
    lastRoundWinner: null,
    winner: null,
    round: 1,
  };

  private knockdownLeft = 0;

  start(): void {
    this.state.phase = 'fighting';
    this.state.health.you = MAX_HEALTH;
    this.state.health.them = MAX_HEALTH;
    this.state.timeLeft = ROUND_SECONDS;
    this.state.lastRoundWinner = null;
  }

  /** Apply damage to `side`. Ignored unless a round is actually running. */
  damage(side: Side, amount: number): void {
    if (this.state.phase !== 'fighting' || amount <= 0) return;

    this.state.health[side] = Math.max(0, this.state.health[side] - amount);
    if (this.state.health[side] === 0) this.endRound(other(side));
  }

  private endRound(winner: Side): void {
    this.state.rounds[winner] += 1;
    this.state.lastRoundWinner = winner;

    if (this.state.rounds[winner] >= ROUNDS_TO_WIN) {
      this.state.phase = 'over';
      this.state.winner = winner;
      return;
    }

    this.state.phase = 'knockdown';
    this.knockdownLeft = KNOCKDOWN_SECONDS;
  }

  update(dtSeconds: number): void {
    // A stalled tab must not burn the clock or skip the knockdown pause.
    const dt = Math.min(Math.max(dtSeconds, 0), 1 / 15);
    if (dt <= 0) return;

    if (this.state.phase === 'fighting') {
      this.state.timeLeft = Math.max(0, this.state.timeLeft - dt);
      if (this.state.timeLeft === 0) this.onTimeUp();
      return;
    }

    if (this.state.phase === 'knockdown') {
      this.knockdownLeft = Math.max(0, this.knockdownLeft - dt);
      if (this.knockdownLeft === 0) {
        this.state.round += 1;
        this.start();
      }
    }
  }

  /** Whoever has more health left takes the round; equal health is a draw. */
  private onTimeUp(): void {
    const { you, them } = this.state.health;
    if (you === them) {
      // Nobody gets the round, but the match still has to move on.
      this.state.lastRoundWinner = null;
      this.state.phase = 'knockdown';
      this.knockdownLeft = KNOCKDOWN_SECONDS;
      return;
    }
    this.endRound(you > them ? 'you' : 'them');
  }

  reset(): void {
    this.state.phase = 'ready';
    this.state.health.you = MAX_HEALTH;
    this.state.health.them = MAX_HEALTH;
    this.state.rounds.you = 0;
    this.state.rounds.them = 0;
    this.state.timeLeft = ROUND_SECONDS;
    this.state.lastRoundWinner = null;
    this.state.winner = null;
    this.state.round = 1;
    this.knockdownLeft = 0;
  }
}
