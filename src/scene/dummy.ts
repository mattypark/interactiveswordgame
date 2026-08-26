import * as THREE from 'three';

import { Wobble } from '../interact/impact.js';

/**
 * A pell-style training dummy: post, crossbar arms, a canvas torso and a head.
 * Something to hit while the sword is still being built.
 *
 * Built at about half a metre so it sits inside the play volume — a life-sized
 * dummy would be out of reach of a hand tracked at arm's length.
 *
 * It pivots at the base, so a hit rocks the whole thing rather than sliding it.
 */

const CANVAS = 0xc9a37a;
const WOOD = 0x6b5236;
const STRAP = 0x4a3a27;
const HIT_FLASH = 0xffd9a0;

/** How much lean one metre-per-second of impact buys. */
const IMPULSE_PER_SPEED = 1.15;

/** Seconds for the hit flash to fade out. */
const FLASH_DECAY = 0.36;

export class Dummy {
  readonly group = new THREE.Group();
  /** World-space box covering the parts worth hitting. */
  readonly bounds = new THREE.Box3();

  private readonly pivot = new THREE.Group();
  private readonly wobble = new Wobble();
  private readonly hitBox: THREE.Group;

  private readonly canvasMaterial: THREE.MeshStandardMaterial;
  private readonly baseColor = new THREE.Color(CANVAS);
  private readonly flashColor = new THREE.Color(HIT_FLASH);
  private flash = 0;

  constructor(position = new THREE.Vector3(0, 0, -0.3)) {
    this.canvasMaterial = new THREE.MeshStandardMaterial({
      color: CANVAS,
      roughness: 0.92,
      metalness: 0.0,
    });
    const wood = new THREE.MeshStandardMaterial({ color: WOOD, roughness: 0.78 });
    const strap = new THREE.MeshStandardMaterial({ color: STRAP, roughness: 0.85 });

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.022, 28), wood);
    base.position.y = 0.011;

    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.3, 16), wood);
    post.position.y = 0.17;

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.072, 0.1, 8, 20), this.canvasMaterial);
    torso.position.y = 0.37;

    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.073, 0.008, 10, 28), strap);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.335;

    const arms = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.34, 14), wood);
    arms.rotation.z = Math.PI / 2;
    arms.position.y = 0.43;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.052, 24, 18), this.canvasMaterial);
    head.position.y = 0.53;

    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.007, 10, 24), strap);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.475;

    for (const mesh of [base, post, torso, belt, arms, head, collar]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }

    // Everything above the base leans; the base stays planted.
    this.hitBox = new THREE.Group();
    this.hitBox.add(torso, belt, arms, head, collar);

    this.pivot.add(post, this.hitBox);
    this.group.add(base, this.pivot);
    this.group.position.copy(position);

    this.refreshBounds();
  }

  /** Register a hit travelling in `direction` at `speed` metres per second. */
  strike(direction: { x: number; z: number }, speed: number): void {
    this.wobble.impulse(direction.z, -direction.x, speed * IMPULSE_PER_SPEED);
    this.flash = Math.min(1, 0.45 + speed * 0.18);
  }

  update(dtSeconds: number): void {
    this.wobble.step(dtSeconds);
    const { x, z } = this.wobble.lean;
    // Wobble x/z are lean amounts; a lean toward +z is a rotation about x.
    this.pivot.rotation.set(x, 0, z);

    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dtSeconds / FLASH_DECAY);
      this.canvasMaterial.color.copy(this.baseColor).lerp(this.flashColor, this.flash);
    }

    this.refreshBounds();
  }

  private refreshBounds(): void {
    this.bounds.setFromObject(this.hitBox);
  }

  get atRest(): boolean {
    return this.wobble.atRest;
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
