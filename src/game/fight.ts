import * as THREE from 'three';

import { Fighter } from '../scene/fighter.js';
import { DIFFICULTIES, type FightOptions } from './fight-ai.js';
import { Match } from './match.js';
import { MIN_PUNCH_SPEED, PunchDetector, punchDamage } from './punch.js';
import type { HudAction } from '../hud/hud.js';
import type { Tracking } from './tracking.js';
import { rig } from '../state/rig.js';

/**
 * A fight against the machine.
 *
 * Your hands land punches on its head; its punches land on yours. Everything
 * that decides a punch is real lives in punch.ts, everything that decides what
 * the opponent does lives in fight-ai.ts, and the score lives in match.ts —
 * this assembles the three and connects them to what the camera sees.
 */

/** Speed at which your hand is considered a visible wind-up. */
const THREAT_SPEED = MIN_PUNCH_SPEED * 0.7;

/** Guarding cuts incoming damage to this fraction. */
const GUARD_REDUCTION = 0.35;

/** Damage one of its punches does to you. */
const OPPONENT_DAMAGE = 8;

export class FightWorld {
  readonly group = new THREE.Group();
  readonly match = new Match();

  private readonly fighter: Fighter;
  private readonly punches: PunchDetector[];
  private readonly headTarget = new THREE.Vector3();

  constructor(
    private readonly tracking: Tracking,
    difficulty: FightOptions = DIFFICULTIES.normal,
  ) {
    this.fighter = new Fighter(difficulty);
    this.punches = tracking.runtimes.map(() => new PunchDetector());
    this.group.add(this.fighter.group);
    // The match stays on 'ready' until setup is out of the way — starting the
    // clock behind the calibration overlay would cost you a round you never
    // got to fight.
  }

  /** @returns whether the action was consumed. */
  handle(action: HudAction): boolean {
    // Nothing in the editor toolbar means anything in a fight.
    return action.type === 'spawn' || action.type === 'delete' || action.type === 'undo'
      ? true
      : false;
  }

  update(dtSeconds: number, nowMs: number): void {
    if (this.match.state.phase === 'ready' && !this.tracking.busy) this.match.start();
    this.match.update(dtSeconds);

    const fighting = this.match.state.phase === 'fighting' && !this.tracking.busy;
    const head = this.tracking.head;

    // It only chases something it can see.
    const playerHead = head.present ? { x: head.position.x, z: head.position.z } : null;

    const result = this.fighter.update(dtSeconds, {
      playerHead: fighting ? playerHead : null,
      playerWindingUp: fighting && this.playerThreatening(),
    });

    if (fighting && result.punched && head.present) {
      this.match.damage('you', OPPONENT_DAMAGE);
      rig.lastHitSpeed = null;
    }

    if (fighting) this.resolvePlayerPunches(nowMs, result.guarding);

    this.publish();
  }

  /** Is either hand moving fast enough to read as a wind-up? */
  private playerThreatening(): boolean {
    return this.tracking.runtimes.some(
      (runtime) => runtime.state.present && runtime.velocity.speed > THREAT_SPEED,
    );
  }

  private resolvePlayerPunches(nowMs: number, guarding: boolean): void {
    this.fighter.headBounds.getCenter(this.headTarget);
    // An empty box means the fighter hasn't been laid out yet this frame.
    if (this.fighter.headBounds.isEmpty()) return;

    const radius = Math.max(
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

      const damage = Math.round(punchDamage(punch) * (guarding ? GUARD_REDUCTION : 1));
      this.match.damage('them', damage);

      const direction = runtime.velocity.velocity();
      const speed = Math.hypot(direction.x, direction.y, direction.z) || 1;
      this.fighter.hurt(
        { x: direction.x / speed, z: direction.z / speed },
        Math.min(1, punch.speed / (MIN_PUNCH_SPEED * 2)),
      );

      rig.hits += 1;
      rig.lastHitSpeed = punch.speed;
    }
  }

  /** Mirror match state into the rig so the HUD can draw it. */
  private publish(): void {
    const { state } = this.match;
    rig.fight = {
      active: true,
      phase: state.phase,
      you: state.health.you,
      them: state.health.them,
      roundsYou: state.rounds.you,
      roundsThem: state.rounds.them,
      round: state.round,
      timeLeft: state.timeLeft,
      winner: state.winner,
      lastRoundWinner: state.lastRoundWinner,
    };
  }

  dispose(): void {
    this.fighter.dispose();
    this.group.clear();
    rig.fight = null;
  }
}
