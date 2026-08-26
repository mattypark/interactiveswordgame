import * as THREE from 'three';

import { FightAi, DEFAULT_FIGHT, type FightInput, type FightOptions } from '../game/fight-ai.js';

/**
 * The opponent you can see.
 *
 * Built to the same scale as your tracked head, so its head sits where yours
 * does and a punch that looks like it connects does. The arms are one segment
 * from shoulder to fist rather than a jointed elbow — at this size the elbow
 * would be three pixels, and a fist that visibly travels is what you need to
 * read, not anatomy.
 */

const SKIN = 0xc9a37a;
const KIT = 0x2f3a5c;
const KIT_TRIM = 0x4d6bb8;
const GUARD_TINT = 0x7fe0c0;
const HURT_TINT = 0xff8a6a;

/** Metres. Head height matches the middle of the play volume. */
const HEAD_Y = 0.33;
const HEAD_RADIUS = 0.055;
const SHOULDER_Y = 0.26;
const SHOULDER_X = 0.052;
/** How far a fist travels from the shoulder at full extension. */
const ARM_REACH = 0.2;
/** How far it pulls back during the wind-up. */
const ARM_WIND = 0.055;

/**
 * How fast the drawn body catches up to where the AI thinks it is.
 *
 * The AI already moves in small steps, but a dropped frame hands it a big one,
 * and a body that teleports half a step reads as a bug even when the logic was
 * right. Easing costs a few milliseconds of lag and removes every visible jump.
 */
const BODY_FOLLOW_RATE = 12;

export class Fighter {
  readonly group = new THREE.Group();
  readonly ai: FightAi;
  /** World-space box around the head — the thing you're aiming at. */
  readonly headBounds = new THREE.Box3();

  private readonly body = new THREE.Group();
  private readonly head: THREE.Mesh;
  private readonly fists: THREE.Mesh[] = [];
  private readonly arms: THREE.Mesh[] = [];
  private readonly legs: THREE.Mesh[] = [];

  private readonly kitMaterial: THREE.MeshStandardMaterial;
  private readonly baseKit = new THREE.Color(KIT);
  private readonly guardColor = new THREE.Color(GUARD_TINT);
  private readonly hurtColor = new THREE.Color(HURT_TINT);
  private readonly scratch = new THREE.Color();

  private hurtFlash = 0;
  private stride = 0;
  /** Idle clock, kept separate so footwork doesn't reset when it stops. */
  private sway = 0;

  constructor(options: FightOptions = DEFAULT_FIGHT) {
    this.ai = new FightAi(options);

    this.kitMaterial = new THREE.MeshStandardMaterial({
      color: KIT,
      roughness: 0.62,
      metalness: 0.06,
    });
    const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.8 });
    const trim = new THREE.MeshStandardMaterial({ color: KIT_TRIM, roughness: 0.5 });

    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.048, 0.085, 6, 16),
      this.kitMaterial,
    );
    torso.position.y = 0.225;

    this.head = new THREE.Mesh(new THREE.SphereGeometry(HEAD_RADIUS, 22, 16), skin);
    this.head.position.y = HEAD_Y;

    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.049, 0.007, 8, 20), trim);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.175;

    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 1, 10), this.kitMaterial);
      arm.frustumCulled = false;
      this.arms.push(arm);

      const fist = new THREE.Mesh(new THREE.SphereGeometry(0.023, 14, 10), trim);
      this.fists.push(fist);

      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.019, 0.07, 4, 10), trim);
      leg.position.set(side * 0.026, 0.075, 0);
      this.legs.push(leg);
    }

    for (const mesh of [torso, this.head, belt, ...this.arms, ...this.fists, ...this.legs]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }

    this.body.add(torso, this.head, belt, ...this.arms, ...this.fists, ...this.legs);
    this.group.add(this.body);
  }

  /** Register a hit landing on it. */
  hurt(direction: { x: number; z: number }, strength: number): void {
    this.ai.hit(direction, strength);
    this.hurtFlash = Math.min(1, 0.55 + strength * 0.4);
  }

  /**
   * Drive the body straight from network state instead of the local AI.
   *
   * Position comes from where the other player's head actually is, so what you
   * aim at is what they're moving; the arm reads off how far their fist is in
   * front of their head, which is the one thing you need to see coming.
   */
  updateRemote(
    dtSeconds: number,
    pose: {
      head: { x: number; y: number; z: number };
      fist: { x: number; y: number; z: number };
      hurt: boolean;
    },
  ): void {
    // Network state arrives twelve times a second; easing turns that into
    // movement rather than a stop-motion sequence.
    const follow = Math.min(1, dtSeconds * BODY_FOLLOW_RATE);
    this.group.position.x += (pose.head.x - this.group.position.x) * follow;
    this.group.position.z += (pose.head.z - this.group.position.z) * follow;

    // Face the player, who is always on the near side of the volume.
    const desired = Math.atan2(-pose.head.x, 1);
    this.body.rotation.y += (desired - this.body.rotation.y) * Math.min(1, dtSeconds * 8);

    const reach = pose.fist.z - pose.head.z;
    // Their fist coming toward you is negative z; map that onto the extension.
    this.ai.strikeProgress = Math.max(0, Math.min(1, -reach / ARM_REACH));
    this.ai.windProgress = 0;

    if (pose.hurt) this.hurtFlash = 1;
    this.body.rotation.x = this.ai.strikeProgress * 0.1;

    this.poseArms(false);
    this.poseLegs(dtSeconds);
    this.tint(false, dtSeconds);
    this.headBounds.setFromObject(this.head);
  }

  update(dtSeconds: number, input: FightInput): { punched: boolean; guarding: boolean } {
    const result = this.ai.update(dtSeconds, input);

    const follow = Math.min(1, dtSeconds * BODY_FOLLOW_RATE);
    this.group.position.x += (this.ai.x - this.group.position.x) * follow;
    this.group.position.z += (this.ai.z - this.group.position.z) * follow;
    this.body.rotation.y = this.ai.facing;
    // Rock back when staggered, and lean into a strike.
    this.body.rotation.x = -this.ai.staggerAmount * 0.34 + this.ai.strikeProgress * 0.1;

    this.poseArms(result.guarding);
    this.poseLegs(dtSeconds);
    this.tint(result.guarding, dtSeconds);

    this.headBounds.setFromObject(this.head);
    return result;
  }

  /**
   * The lead fist pulls back through the wind-up and drives forward through
   * the strike; the other stays up by the chin. Guarding raises both.
   */
  private poseArms(guarding: boolean): void {
    const extension = this.ai.strikeProgress * ARM_REACH - this.ai.windProgress * ARM_WIND;

    for (let i = 0; i < 2; i += 1) {
      const side = i === 0 ? -1 : 1;
      const shoulder = new THREE.Vector3(side * SHOULDER_X, SHOULDER_Y, 0);
      // Index 1 leads; the other hand only guards.
      const lead = i === 1;

      const fist = guarding
        ? new THREE.Vector3(side * 0.036, HEAD_Y - 0.012, 0.045)
        : lead
          ? new THREE.Vector3(side * SHOULDER_X * 0.55, SHOULDER_Y + 0.012, 0.03 + extension)
          : new THREE.Vector3(side * SHOULDER_X * 0.9, SHOULDER_Y - 0.005, 0.035);

      this.fists[i]!.position.copy(fist);

      // Stretch the upper arm between shoulder and fist.
      const arm = this.arms[i]!;
      const direction = fist.clone().sub(shoulder);
      const length = Math.max(direction.length(), 1e-4);
      arm.position.copy(shoulder).addScaledVector(direction, 0.5);
      arm.scale.set(1, length, 1);
      arm.quaternion.setFromUnitVectors(UP, direction.divideScalar(length));
    }
  }

  private poseLegs(dtSeconds: number): void {
    this.sway += dtSeconds * 2.6;

    const moving = this.ai.state === 'approach' || this.ai.state === 'retreat';
    if (moving) {
      this.stride += dtSeconds * 8;
      const swing = Math.sin(this.stride) * 0.38;
      this.legs[0]!.rotation.x = swing;
      this.legs[1]!.rotation.x = -swing;
      this.body.position.y = Math.abs(Math.sin(this.stride)) * 0.005;
      return;
    }

    // Idle footwork. At a normal sitting distance it can reach you without
    // moving, so it would otherwise stand dead still between punches — and a
    // statue that occasionally lurches reads as broken even when it isn't.
    const shift = Math.sin(this.sway) * 0.12;
    this.legs[0]!.rotation.x += (shift - this.legs[0]!.rotation.x) * Math.min(1, dtSeconds * 6);
    this.legs[1]!.rotation.x += (-shift - this.legs[1]!.rotation.x) * Math.min(1, dtSeconds * 6);
    this.body.position.y = Math.abs(Math.sin(this.sway * 1.5)) * 0.004;
  }

  private tint(guarding: boolean, dtSeconds: number): void {
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - dtSeconds / 0.3);

    this.scratch.copy(this.baseKit);
    if (guarding) this.scratch.lerp(this.guardColor, 0.4);
    if (this.hurtFlash > 0) this.scratch.lerp(this.hurtColor, this.hurtFlash);
    this.kitMaterial.color.copy(this.scratch);
  }

  dispose(): void {
    this.group.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose();
        const material = node.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material.dispose();
      }
    });
  }
}

const UP = new THREE.Vector3(0, 1, 0);
