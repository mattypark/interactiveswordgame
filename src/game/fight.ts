import * as THREE from 'three';

import { Fighter } from '../scene/fighter.js';
import { DIFFICULTIES, type FightOptions } from './fight-ai.js';
import { Match } from './match.js';
import { MIN_PUNCH_SPEED, PunchDetector, punchDamage } from './punch.js';
import { Combo, HitStop, Shake, comboMultiplier } from './juice.js';
import { ImpactFx } from '../scene/impact-fx.js';
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

/**
 * How fast the AI's idea of where you are catches up to where you are.
 *
 * The tracked head already has a filter on it, tuned so the marker feels
 * responsive. Decisions want the opposite: a couple of centimetres of residual
 * wobble is nothing to look at and everything to a threshold test, so what the
 * fighter chases is smoothed again, harder. It only walks at 0.4 m/s — it has
 * no use for millisecond precision.
 */
const TARGET_FOLLOW_RATE = 4;

export class FightWorld {
  readonly group = new THREE.Group();
  readonly match = new Match();

  /** Impact feedback: the part that makes a hit feel like one. */
  readonly hitStop = new HitStop();
  readonly shake = new Shake();
  readonly combo = new Combo();
  private readonly fx = new ImpactFx();

  private readonly fighter: Fighter;
  private readonly punches: PunchDetector[];
  private readonly headTarget = new THREE.Vector3();
  /** Smoothed player position, which is what the AI actually chases. */
  private readonly aiTarget = new THREE.Vector3();
  private aiTargetPrimed = false;

  constructor(
    private readonly tracking: Tracking,
    difficulty: FightOptions = DIFFICULTIES.normal,
  ) {
    this.fighter = new Fighter(difficulty);
    this.punches = tracking.runtimes.map(() => new PunchDetector());
    this.group.add(this.fighter.group, this.fx.group);
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

  /** Camera orientation, so impact rings face the viewer. */
  cameraFacing: THREE.Quaternion | null = null;

  /**
   * Advance the impact effects on **real** time, not the frozen time the rest
   * of the fight runs on.
   *
   * Hit-stop hands the game a delta of zero while it's freezing, and the shake
   * and the burst are precisely what the freeze exists to show off — running
   * them on that same clock leaves the camera perfectly still through the one
   * moment it should be moving.
   */
  updateEffects(realDtSeconds: number, nowMs: number): void {
    this.fx.update(realDtSeconds);
    this.shake.step(realDtSeconds);
    this.combo.update(nowMs);
  }

  update(dtSeconds: number, nowMs: number): void {
    if (this.match.state.phase === 'ready' && !this.tracking.busy) this.match.start();
    this.match.update(dtSeconds);

    const fighting = this.match.state.phase === 'fighting' && !this.tracking.busy;
    const head = this.tracking.head;

    // It only chases something it can see.
    const playerHead = head.present ? this.followTarget(head.position, dtSeconds) : null;
    if (!head.present) this.aiTargetPrimed = false;

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

  /** Ease the AI's target toward the tracked head and hand back the flat form. */
  private followTarget(head: THREE.Vector3, dtSeconds: number): { x: number; z: number } {
    if (!this.aiTargetPrimed) {
      // Snap on first sight, so it doesn't glide in from wherever it left off.
      this.aiTarget.copy(head);
      this.aiTargetPrimed = true;
    } else {
      this.aiTarget.lerp(head, Math.min(1, dtSeconds * TARGET_FOLLOW_RATE));
    }
    return { x: this.aiTarget.x, z: this.aiTarget.z };
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
        {
          points: runtime.strike,
          previous: runtime.previousStrike,
          velocity: runtime.velocity.velocity(),
          peakSpeed: runtime.velocity.peakSpeed,
        },
        this.headTarget,
        radius,
        nowMs,
      );
      if (!punch) continue;

      // Tempo: landing one lets you chain, being blocked costs you the beat.
      this.punches[i]!.resolve(guarding ? 'blocked' : 'landed');

      const streak = this.combo.hit(nowMs);
      const damage = Math.round(
        punchDamage(punch) * comboMultiplier(streak) * (guarding ? GUARD_REDUCTION : 1),
      );
      this.match.damage('them', damage);

      const direction = runtime.velocity.velocity();
      const speed = Math.hypot(direction.x, direction.y, direction.z) || 1;
      const strength = Math.min(1, punch.speed / (MIN_PUNCH_SPEED * 2.5));

      this.fighter.hurt({ x: direction.x / speed, z: direction.z / speed }, strength);

      // Everything that sells it: freeze, kick, ring and shards.
      const clout = guarding ? strength * 0.4 : strength;
      this.hitStop.hit(clout);
      this.shake.hit(clout);
      if (this.cameraFacing) this.fx.burst(this.headTarget, this.cameraFacing, clout);

      rig.hits += 1;
      rig.lastHitSpeed = punch.speed;
      rig.lastDamage = { amount: damage, at: nowMs, guarded: guarding };
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
      combo: this.combo.visible ? this.combo.count : 0,
    };
  }

  dispose(): void {
    this.fighter.dispose();
    this.fx.dispose();
    this.group.clear();
    rig.fight = null;
    rig.lastDamage = null;
  }
}
