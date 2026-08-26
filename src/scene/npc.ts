import * as THREE from 'three';

import { NpcBrain, DEFAULT_NPC, type NpcOptions } from '../interact/npc-brain.js';

/**
 * A small figure that paces inside the box, watches you when you get close,
 * and staggers when hit. Distinct from the dummy in both colour and behaviour
 * — the dummy is a target that stands still, this one moves, which is a very
 * different thing to actually connect with.
 */

const CLOTH = 0x5c6b96;
const SKIN = 0xc9a37a;
const TRIM = 0x39445f;
const HIT_FLASH = 0xff9d7a;

/** Metres. Sized to sit comfortably inside the play volume. */
const HEIGHT = 0.4;

export class Npc {
  readonly group = new THREE.Group();
  readonly brain: NpcBrain;
  /** World-space box covering the parts worth hitting. */
  readonly bounds = new THREE.Box3();

  private readonly body = new THREE.Group();
  private readonly hitBox: THREE.Group;
  private readonly legs: THREE.Mesh[] = [];
  private readonly arms: THREE.Mesh[] = [];

  private readonly clothMaterial: THREE.MeshStandardMaterial;
  private readonly baseColor = new THREE.Color(CLOTH);
  private readonly flashColor = new THREE.Color(HIT_FLASH);
  private flash = 0;
  private stride = 0;

  constructor(options: NpcOptions = DEFAULT_NPC) {
    this.brain = new NpcBrain(options);

    this.clothMaterial = new THREE.MeshStandardMaterial({
      color: CLOTH,
      roughness: 0.72,
      metalness: 0.04,
    });
    const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.85 });
    const trim = new THREE.MeshStandardMaterial({ color: TRIM, roughness: 0.6 });

    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.045, 0.09, 6, 16),
      this.clothMaterial,
    );
    torso.position.y = 0.255;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.037, 20, 16), skin);
    head.position.y = 0.352;

    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.006, 8, 20), trim);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.312;

    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.014, 0.075, 4, 10),
        this.clothMaterial,
      );
      arm.position.set(side * 0.056, 0.255, 0);
      this.arms.push(arm);

      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.017, 0.075, 4, 10), trim);
      leg.position.set(side * 0.024, 0.09, 0);
      this.legs.push(leg);
    }

    this.hitBox = new THREE.Group();
    this.hitBox.add(torso, head, collar, ...this.arms);

    this.body.add(this.hitBox, ...this.legs);
    this.group.add(this.body);

    for (const mesh of [torso, head, collar, ...this.arms, ...this.legs]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }

    this.refreshBounds();
  }

  get height(): number {
    return HEIGHT;
  }

  strike(direction: { x: number; z: number }, speed: number): void {
    this.brain.hit(direction, speed);
    this.flash = Math.min(1, 0.5 + speed * 0.16);
  }

  update(dtSeconds: number, player: { x: number; z: number } | null): void {
    this.brain.update(dtSeconds, player);

    this.group.position.x = this.brain.x;
    this.group.position.z = this.brain.z;
    this.body.rotation.y = this.brain.facing;

    // Lean away from the blow while staggered, and stand up as it wears off.
    this.hitBox.rotation.x = -this.brain.staggerAmount * 0.44;

    // A simple stride: legs swing only while it's actually walking.
    if (this.brain.state === 'patrol') {
      this.stride += dtSeconds * 7.5;
      const swing = Math.sin(this.stride) * 0.42;
      this.legs[0]!.rotation.x = swing;
      this.legs[1]!.rotation.x = -swing;
      // A little bob, so it doesn't glide.
      this.body.position.y = Math.abs(Math.sin(this.stride)) * 0.006;
    } else {
      for (const leg of this.legs) leg.rotation.x *= 0.85;
      this.body.position.y *= 0.85;
    }

    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dtSeconds / 0.34);
      this.clothMaterial.color.copy(this.baseColor).lerp(this.flashColor, this.flash);
    }

    this.refreshBounds();
  }

  private refreshBounds(): void {
    this.bounds.setFromObject(this.hitBox);
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
