import * as THREE from 'three';

import type { PlayVolume } from '../hands/project.js';

/**
 * Draws the box your hand can actually reach, plus a marker for where the hand
 * currently is.
 *
 * Without this the reachable region is invisible: you find its edges by having
 * the hand stop responding, which reads as a bug. The floor footprint and the
 * drop line matter most — depth is the hardest axis to judge on a flat screen,
 * and a shadow on the ground is how you judge it.
 */

const EDGE_COLOR = 0x6b78a8;
const NEAR_EDGE_COLOR = 0x9fb0e8;
const RETICLE_COLOR = 0x5eead4;
const OUT_OF_RANGE_COLOR = 0xff5a6a;

export class PlayVolumeView {
  readonly group = new THREE.Group();

  private readonly box: THREE.LineSegments;
  private readonly footprint: THREE.LineLoop;
  private readonly reticle: THREE.Mesh;
  private readonly dropLine: THREE.Line;
  private readonly dropPositions = new Float32Array(6);

  private readonly reticleMaterial: THREE.MeshBasicMaterial;
  private readonly dropMaterial: THREE.LineBasicMaterial;
  private readonly footprintMaterial: THREE.LineBasicMaterial;

  private readonly ok = new THREE.Color(RETICLE_COLOR);
  private readonly bad = new THREE.Color(OUT_OF_RANGE_COLOR);

  constructor(volume: PlayVolume) {
    const geometry = new THREE.BoxGeometry(volume.size.x, volume.size.y, volume.size.z);
    this.box = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: 0.8 }),
    );
    this.box.position.set(volume.centre.x, volume.centre.y, volume.centre.z);
    geometry.dispose();

    // The footprint on the ground, where depth is easiest to read.
    const half = { x: volume.size.x / 2, z: volume.size.z / 2 };
    const corners = new Float32Array([
      -half.x, 0, -half.z,
      half.x, 0, -half.z,
      half.x, 0, half.z,
      -half.x, 0, half.z,
    ]);
    const footprintGeometry = new THREE.BufferGeometry();
    footprintGeometry.setAttribute('position', new THREE.BufferAttribute(corners, 3));
    this.footprintMaterial = new THREE.LineBasicMaterial({
      color: NEAR_EDGE_COLOR,
      transparent: true,
      opacity: 0.95,
    });
    this.footprint = new THREE.LineLoop(footprintGeometry, this.footprintMaterial);
    this.footprint.position.set(volume.centre.x, 0.001, volume.centre.z);

    // A ring on the floor directly under the hand.
    this.reticleMaterial = new THREE.MeshBasicMaterial({
      color: RETICLE_COLOR,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
    });
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.026, 0.034, 40), this.reticleMaterial);
    this.reticle.rotation.x = -Math.PI / 2;
    this.reticle.position.y = 0.002;

    // ...and a line connecting the hand to that ring.
    const dropGeometry = new THREE.BufferGeometry();
    dropGeometry.setAttribute('position', new THREE.BufferAttribute(this.dropPositions, 3));
    this.dropMaterial = new THREE.LineBasicMaterial({
      color: RETICLE_COLOR,
      transparent: true,
      opacity: 0.35,
    });
    this.dropLine = new THREE.Line(dropGeometry, this.dropMaterial);
    this.dropLine.frustumCulled = false;

    this.group.add(this.box, this.footprint, this.reticle, this.dropLine);
    this.setHand(null, true);
  }

  /**
   * @param anchor world-space palm position, or null when no hand is tracked
   * @param inRange whether the hand is within the depth band the volume maps
   */
  setHand(anchor: THREE.Vector3 | null, inRange: boolean): void {
    const visible = anchor !== null;
    this.reticle.visible = visible;
    this.dropLine.visible = visible;
    if (!anchor) return;

    this.reticle.position.x = anchor.x;
    this.reticle.position.z = anchor.z;

    this.dropPositions[0] = anchor.x;
    this.dropPositions[1] = anchor.y;
    this.dropPositions[2] = anchor.z;
    this.dropPositions[3] = anchor.x;
    this.dropPositions[4] = 0.002;
    this.dropPositions[5] = anchor.z;
    this.dropLine.geometry.attributes.position!.needsUpdate = true;

    // Going red is the signal that the hand is about to stop being tracked.
    const color = inRange ? this.ok : this.bad;
    this.reticleMaterial.color.copy(color);
    this.dropMaterial.color.copy(color);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  dispose(): void {
    this.box.geometry.dispose();
    (this.box.material as THREE.Material).dispose();
    this.footprint.geometry.dispose();
    this.footprintMaterial.dispose();
    this.reticle.geometry.dispose();
    this.reticleMaterial.dispose();
    this.dropLine.geometry.dispose();
    this.dropMaterial.dispose();
  }
}
