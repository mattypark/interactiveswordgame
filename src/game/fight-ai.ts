/**
 * The opponent's head.
 *
 * A state machine that closes distance, throws straight punches when it's in
 * range, backs off after committing, and guards when you're winding up. It
 * telegraphs — there's a visible wind-up before every punch — because an
 * opponent you cannot read is not difficult, just unfair.
 *
 * Pure — no three.js, no DOM.
 */

export type FightState = 'idle' | 'approach' | 'retreat' | 'wind' | 'strike' | 'recover' | 'stagger';

export interface FightOptions {
  /** How close it wants to be before punching. Metres. */
  preferredRange: number;
  /** Closer than this and it backs off. */
  tooClose: number;
  /** Metres per second on the move. */
  speed: number;
  /** Seconds of visible wind-up before a punch lands. */
  windSeconds: number;
  /** Seconds committed after a punch, when it can't defend. */
  recoverSeconds: number;
  /** Seconds it's stunned for after being hit. */
  staggerSeconds: number;
  /** Seconds between punch attempts. Lower is harder. */
  cooldownSeconds: number;
  /** How much of your wind-up it reads, 0..1. Higher guards more. */
  awareness: number;
  /**
   * Slack around the range thresholds, metres.
   *
   * Without it, a tracked head that wobbles a couple of centimetres flips the
   * fighter between approaching and standing still every single frame — the
   * legs stutter, the body jerks, and it reads as the whole thing being
   * broken. Same reason grabbing uses two thresholds instead of one.
   */
  rangeBand: number;
  /**
   * Shortest time a movement state has to hold before another can replace it.
   *
   * Belt and braces with the band above: even a hand that crosses the
   * threshold for real shouldn't produce a new decision every 16ms.
   */
  minDwellSeconds: number;
  /** How far it can wander from centre, metres. */
  arena: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Injectable so tests can decide when it chooses to guard. */
  random?: () => number;
}

export const DEFAULT_FIGHT: FightOptions = {
  preferredRange: 0.34,
  tooClose: 0.2,
  speed: 0.42,
  windSeconds: 0.34,
  recoverSeconds: 0.42,
  // 0.3s of hitstun is roughly where Roblox melee systems land: long enough
  // to feel like it connected, short enough that a combo is a skill rather
  // than a lock.
  staggerSeconds: 0.32,
  cooldownSeconds: 1.05,
  awareness: 0.6,
  rangeBand: 0.07,
  minDwellSeconds: 0.18,
  arena: { minX: -0.34, maxX: 0.34, minZ: -0.5, maxZ: -0.05 },
};

/** Named difficulty steps, since "awareness 0.85" means nothing to a player. */
export const DIFFICULTIES = {
  easy: { ...DEFAULT_FIGHT, speed: 0.3, cooldownSeconds: 1.7, awareness: 0.3, windSeconds: 0.46 },
  normal: DEFAULT_FIGHT,
  hard: {
    ...DEFAULT_FIGHT,
    speed: 0.55,
    cooldownSeconds: 0.7,
    awareness: 0.85,
    windSeconds: 0.26,
    // Sharper reactions, but never sharp enough to stutter.
    minDwellSeconds: 0.12,
  },
} as const;

export interface FightInput {
  /** Where your head is. Null when you aren't tracked. */
  playerHead: { x: number; z: number } | null;
  /** Whether either of your hands is moving fast enough to be a threat. */
  playerWindingUp: boolean;
}

export interface FightOutput {
  /** A punch connected this tick, with the speed to score it. */
  punched: boolean;
  /** It's guarding, so your punches do less. */
  guarding: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class FightAi {
  x: number;
  z: number;
  /** Radians; 0 faces +z, toward the player. */
  facing = 0;
  state: FightState = 'idle';

  /** 0..1 through the current wind-up — drives the arm pulling back. */
  windProgress = 0;
  /** 0..1 through the current strike — drives the arm extending. */
  strikeProgress = 0;
  /** 0..1 of stagger remaining. */
  staggerAmount = 0;

  private timer = 0;
  private cooldown = 0;
  private guardHold = 0;
  /** How long the current movement state has been held. */
  private dwell = 0;

  constructor(private readonly options: FightOptions = DEFAULT_FIGHT) {
    this.x = 0;
    this.z = (options.arena.minZ + options.arena.maxZ) / 2;
  }

  get guarding(): boolean {
    return this.guardHold > 0 && this.state !== 'strike' && this.state !== 'recover';
  }

  /** Interrupt whatever it's doing and knock it back. */
  hit(direction: { x: number; z: number }, strength: number): void {
    this.state = 'stagger';
    this.dwell = 0;
    this.timer = this.options.staggerSeconds;
    this.staggerAmount = 1;
    this.windProgress = 0;
    this.strikeProgress = 0;
    this.guardHold = 0;

    const push = clamp(strength, 0, 1) * 0.09;
    this.x = clamp(this.x + direction.x * push, this.options.arena.minX, this.options.arena.maxX);
    this.z = clamp(this.z + direction.z * push, this.options.arena.minZ, this.options.arena.maxZ);
  }

  update(dtSeconds: number, input: FightInput): FightOutput {
    const dt = Math.min(Math.max(dtSeconds, 0), 1 / 20);
    if (dt <= 0) return { punched: false, guarding: this.guarding };

    const o = this.options;
    this.cooldown = Math.max(0, this.cooldown - dt);

    // Reading your wind-up is what makes awareness a difficulty knob.
    const random = o.random ?? Math.random;
    if (input.playerWindingUp && random() < o.awareness * dt * 6) {
      this.guardHold = 0.36;
    }
    this.guardHold = Math.max(0, this.guardHold - dt);

    if (!input.playerHead) {
      this.state = 'idle';
      this.decay(dt);
      return { punched: false, guarding: this.guarding };
    }

    const dx = input.playerHead.x - this.x;
    const dz = input.playerHead.z - this.z;
    const distance = Math.hypot(dx, dz);

    // Always turn to face you, whatever else is happening.
    this.faceToward(dx, dz, dt);

    let punched = false;

    switch (this.state) {
      case 'stagger':
        this.timer -= dt;
        this.staggerAmount = Math.max(0, this.timer / o.staggerSeconds);
        if (this.timer <= 0) this.state = 'idle';
        break;

      case 'wind':
        this.timer -= dt;
        this.windProgress = 1 - Math.max(0, this.timer / o.windSeconds);
        if (this.timer <= 0) {
          this.state = 'strike';
          this.timer = 0.11;
          this.windProgress = 1;
        }
        break;

      case 'strike':
        this.timer -= dt;
        this.strikeProgress = 1;
        if (this.timer <= 0) {
          // The punch resolves at the end of the extension, and only if you're
          // still standing in front of it — stepping back beats it.
          punched = distance <= o.preferredRange + 0.08;
          this.state = 'recover';
          this.timer = o.recoverSeconds;
          this.cooldown = o.cooldownSeconds;
        }
        break;

      case 'recover':
        this.timer -= dt;
        this.strikeProgress = Math.max(0, this.timer / o.recoverSeconds);
        this.windProgress = this.strikeProgress;
        if (this.timer <= 0) this.state = 'idle';
        break;

      default: {
        this.dwell += dt;

        // Thresholds widen once you're inside them, so a wobbling target can't
        // push it back out again immediately.
        const approachAt = this.state === 'approach' ? o.preferredRange : o.preferredRange + o.rangeBand;
        const retreatAt = this.state === 'retreat' ? o.tooClose + o.rangeBand : o.tooClose;

        const wanted: FightState =
          distance > approachAt ? 'approach' : distance < retreatAt ? 'retreat' : 'idle';

        // Being crowded is urgent; it doesn't wait out the dwell to react.
        if (wanted === 'retreat' && this.state !== 'retreat') this.dwell = o.minDwellSeconds;

        // Keep moving in the current direction until the state is allowed to
        // change, rather than freezing mid-step.
        const settled = this.dwell >= o.minDwellSeconds;
        const state = settled || wanted === this.state ? wanted : this.state;
        if (state !== this.state) {
          this.state = state;
          this.dwell = 0;
        }

        if (this.state === 'approach') this.step(dx, dz, distance, o.speed * dt);
        else if (this.state === 'retreat') this.step(-dx, -dz, distance, o.speed * dt);
        else if (
          this.cooldown === 0 &&
          distance <= o.preferredRange + o.rangeBand &&
          // Never throw one from inside its own guard: back off first.
          distance >= o.tooClose &&
          // And only once it has genuinely been standing in range, not on the
          // strength of a single frame. One bad tracking frame used to be
          // enough to commit it to a punch at nothing, and a punch is a
          // second-long animation it can't take back.
          this.state === 'idle' &&
          this.dwell >= o.minDwellSeconds
        ) {
          this.state = 'wind';
          this.dwell = 0;
          this.timer = o.windSeconds;
          this.windProgress = 0;
        }

        this.decay(dt);
      }
    }

    this.x = clamp(this.x, o.arena.minX, o.arena.maxX);
    this.z = clamp(this.z, o.arena.minZ, o.arena.maxZ);

    return { punched, guarding: this.guarding };
  }

  private step(dx: number, dz: number, distance: number, amount: number): void {
    if (distance < 1e-5) return;
    this.x += (dx / distance) * amount;
    this.z += (dz / distance) * amount;
  }

  private faceToward(dx: number, dz: number, dt: number): void {
    const desired = Math.atan2(dx, dz);
    let delta = (desired - this.facing) % (Math.PI * 2);
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    this.facing += delta * Math.min(1, dt * 8);
  }

  private decay(dt: number): void {
    const fade = Math.max(0, 1 - dt * 6);
    this.windProgress *= fade;
    this.strikeProgress *= fade;
    this.staggerAmount *= fade;
  }
}
