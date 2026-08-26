import * as THREE from 'three';

import { Fighter } from '../scene/fighter.js';
import { MIN_PUNCH_SPEED, PunchDetector, punchDamage } from './punch.js';
import type { HudAction } from '../hud/hud.js';
import type { Tracking } from './tracking.js';
import type { MatchSnapshot, VersusClient } from '../net/versus-client.js';
import { rig } from '../state/rig.js';

/**
 * A live match against another person.
 *
 * The shape is the same as the AI fight, with two differences: the opponent's
 * body is driven by what their client says rather than by a state machine, and
 * the score lives on the server rather than in a local Match.
 *
 * Each client scores its own punches and reports a running total. The other
 * side applies the difference, so a dropped update costs nothing and a
 * duplicated one repeats nothing.
 */

/** Rounds needed to take the match — matches the server. */
const ROUNDS_TO_WIN = 2;

export class VersusWorld {
  readonly group = new THREE.Group();

  private readonly fighter = new Fighter();
  private readonly punches: PunchDetector[];

  /** Running totals reported to the server. */
  private punchSeq = 0;
  private punchDamage = 0;

  /** Their punch counter last time we looked, to spot a new one. */
  private seenTheirSeq = 0;
  private theirPunchFlash = 0;

  private readonly headTarget = new THREE.Vector3();

  constructor(
    private readonly tracking: Tracking,
    private readonly client: VersusClient,
  ) {
    this.punches = tracking.runtimes.map(() => new PunchDetector());
    this.group.add(this.fighter.group);

    this.client.startPushing(() => this.localSnapshot());
  }

  /** What gets sent to the server every push. */
  private localSnapshot() {
    const head = this.tracking.head;
    const lead = this.tracking.runtimes.find((runtime) => runtime.state.present);

    return {
      head: { x: head.position.x, y: head.position.y, z: head.position.z },
      fist: lead
        ? { x: lead.state.anchor.x, y: lead.state.anchor.y, z: lead.state.anchor.z }
        : { x: head.position.x, y: head.position.y - 0.05, z: head.position.z + 0.1 },
      punchSeq: this.punchSeq,
      punchDamage: this.punchDamage,
    };
  }

  handle(action: HudAction): boolean {
    // The editor toolbar means nothing here.
    return action.type === 'spawn' || action.type === 'delete' || action.type === 'undo';
  }

  update(dtSeconds: number, nowMs: number): void {
    const match = this.client.match;
    const them = this.client.opponent;
    const you = this.client.you;

    if (!match || !them || !you) {
      rig.fight = null;
      return;
    }

    if (this.theirPunchFlash > 0) this.theirPunchFlash = Math.max(0, this.theirPunchFlash - dtSeconds / 0.3);
    if (them.punchSeq > this.seenTheirSeq) {
      this.seenTheirSeq = them.punchSeq;
      this.theirPunchFlash = 1;
    }

    this.fighter.updateRemote(dtSeconds, {
      head: them.head,
      fist: them.fist,
      hurt: false,
    });

    const fighting = match.phase === 'fighting' && !this.tracking.busy;
    if (fighting) this.resolvePunches(nowMs);

    this.publish(match, you, them);
  }

  private resolvePunches(nowMs: number): void {
    if (this.fighter.headBounds.isEmpty()) return;
    this.fighter.headBounds.getCenter(this.headTarget);

    const radius =
      Math.max(
        this.fighter.headBounds.max.x - this.fighter.headBounds.min.x,
        this.fighter.headBounds.max.y - this.fighter.headBounds.min.y,
      ) / 2;

    for (let i = 0; i < this.tracking.runtimes.length; i += 1) {
      const runtime = this.tracking.runtimes[i]!;
      if (!runtime.state.present) continue;

      const punch = this.punches[i]!.test(
        runtime.state.anchor,
        runtime.velocity.velocity(),
        this.headTarget,
        radius,
        nowMs,
      );
      if (!punch) continue;

      this.punchSeq += 1;
      this.punchDamage = punchDamage(punch);

      const velocity = runtime.velocity.velocity();
      const speed = Math.hypot(velocity.x, velocity.y, velocity.z) || 1;
      this.fighter.hurt(
        { x: velocity.x / speed, z: velocity.z / speed },
        Math.min(1, punch.speed / (MIN_PUNCH_SPEED * 2)),
      );

      rig.hits += 1;
      rig.lastHitSpeed = punch.speed;
    }
  }

  private publish(
    match: MatchSnapshot,
    you: { health: number; rounds: number },
    them: { health: number; rounds: number },
  ): void {
    const over = match.phase === 'over';
    rig.fight = {
      active: true,
      phase: match.phase === 'waiting' ? 'ready' : match.phase,
      you: you.health,
      them: them.health,
      roundsYou: you.rounds,
      roundsThem: them.rounds,
      round: match.round,
      // The server owns the score; there's no shared clock, so the timer sits
      // at full rather than showing two players two different numbers.
      timeLeft: 90,
      winner: over ? (you.rounds >= ROUNDS_TO_WIN ? 'you' : 'them') : null,
      lastRoundWinner: null,
    };
  }

  dispose(): void {
    this.client.stopPushing();
    this.fighter.dispose();
    this.group.clear();
    rig.fight = null;
  }
}
