import * as THREE from 'three';

import { CONNECTIONS, LANDMARK_COUNT } from './connections';

/**
 * One hand drawn the way the reference build draws it: thin bright bones with
 * a bead at every joint, floating unlit in the scene so it reads as an overlay
 * on the world rather than an object in it.
 */

const BONE_COLOR = 0x5eead4;
const JOINT_COLOR = 0xdffcf5;
/** Colour the whole hand shifts toward as the grip closes. */
const GRIP_COLOR = 0xffc46b;

const JOINT_RADIUS = 0.0042;

export class HandSkeleton {
  readonly group = new THREE.Group();

  private readonly positions = new Float32Array(CONNECTIONS.length * 2 * 3);
  private readonly bones: THREE.LineSegments;
  private readonly joints: THREE.InstancedMesh;

  private readonly boneMaterial: THREE.LineBasicMaterial;
  private readonly jointMaterial: THREE.MeshBasicMaterial;

  private readonly base = new THREE.Color(BONE_COLOR);
  private readonly jointBase = new THREE.Color(JOINT_COLOR);
  private readonly grip = new THREE.Color(GRIP_COLOR);
  private readonly scratch = new THREE.Color();
  private readonly matrix = new THREE.Matrix4();

  constructor() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));

    this.boneMaterial = new THREE.LineBasicMaterial({
      color: BONE_COLOR,
      transparent: true,
      opacity: 0.95,
      depthTest: true,
    });
    this.bones = new THREE.LineSegments(geometry, this.boneMaterial);
    this.bones.frustumCulled = false;

    this.jointMaterial = new THREE.MeshBasicMaterial({ color: JOINT_COLOR });
    this.joints = new THREE.InstancedMesh(
      new THREE.SphereGeometry(JOINT_RADIUS, 10, 8),
      this.jointMaterial,
      LANDMARK_COUNT,
    );
    this.joints.frustumCulled = false;

    this.group.add(this.bones, this.joints);
    this.group.visible = false;
  }

  /**
   * `joints` must hold LANDMARK_COUNT world-space points.
   * `gripAmount` 0..1 tints the hand as the fist closes.
   */
  update(joints: readonly THREE.Vector3[], gripAmount: number): void {
    if (joints.length < LANDMARK_COUNT) {
      this.group.visible = false;
      return;
    }

    let offset = 0;
    for (const [a, b] of CONNECTIONS) {
      const from = joints[a];
      const to = joints[b];
      if (!from || !to) continue;
      this.positions[offset++] = from.x;
      this.positions[offset++] = from.y;
      this.positions[offset++] = from.z;
      this.positions[offset++] = to.x;
      this.positions[offset++] = to.y;
      this.positions[offset++] = to.z;
    }
    this.bones.geometry.attributes.position!.needsUpdate = true;

    for (let i = 0; i < LANDMARK_COUNT; i += 1) {
      const joint = joints[i];
      if (!joint) continue;
      this.matrix.makeTranslation(joint.x, joint.y, joint.z);
      this.joints.setMatrixAt(i, this.matrix);
    }
    this.joints.instanceMatrix.needsUpdate = true;

    this.boneMaterial.color.copy(this.scratch.copy(this.base).lerp(this.grip, gripAmount));
    this.jointMaterial.color.copy(this.scratch.copy(this.jointBase).lerp(this.grip, gripAmount));

    this.group.visible = true;
  }

  hide(): void {
    this.group.visible = false;
  }

  dispose(): void {
    this.bones.geometry.dispose();
    this.boneMaterial.dispose();
    this.joints.geometry.dispose();
    this.jointMaterial.dispose();
  }
}
