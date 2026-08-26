import * as THREE from 'three';

import { CONNECTIONS, LANDMARK_COUNT } from './connections.js';

/**
 * A hand with some mass to it: tapered bones, rounded knuckles and a solid
 * palm, all lit by the scene rather than drawn as flat lines.
 *
 * The wireframe version read as tracking data rather than as a hand, and thin
 * lines flicker badly at this scale — a shaded solid hides a millimetre of
 * jitter that a one-pixel line puts right in your eye.
 */

/** Per-hand palettes, so you can tell which hand is which at a glance. */
export const HAND_PALETTES = {
  left: { bone: 0x4da3ff, joint: 0xcfe6ff },
  right: { bone: 0xff5a6a, joint: 0xffd0d6 },
  unknown: { bone: 0x5eead4, joint: 0xdffcf5 },
} as const;

export type HandColorKey = keyof typeof HAND_PALETTES;

/** Colour the whole hand shifts toward as the grip closes. */
const GRIP_COLOR = 0xffe9a8;

/**
 * Joint radii, metres. A real hand is thick at the wrist and knuckles and
 * tapers to the fingertips; matching that is most of what makes it read as a
 * hand rather than a stick figure.
 */
const JOINT_RADII: readonly number[] = [
  0.0155, // 0 wrist
  0.0115, 0.0105, 0.0092, 0.0082, // thumb
  0.0112, 0.0096, 0.0086, 0.0076, // index
  0.0114, 0.0098, 0.0087, 0.0076, // middle
  0.0108, 0.0093, 0.0083, 0.0073, // ring
  0.0098, 0.0085, 0.0076, 0.0069, // pinky
];

/** Bones are slightly slimmer than the joints they connect. */
const BONE_THICKNESS = 0.78;

/** The palm is a fan of triangles over these landmarks. */
const PALM_FAN: ReadonlyArray<readonly [number, number, number]> = [
  [0, 5, 9],
  [0, 9, 13],
  [0, 13, 17],
  [5, 9, 13],
];

const UP = new THREE.Vector3(0, 1, 0);

export class HandSkeleton {
  readonly group = new THREE.Group();

  private readonly bones: THREE.InstancedMesh;
  private readonly joints: THREE.InstancedMesh;
  private readonly palm: THREE.Mesh;
  private readonly palmPositions: Float32Array;

  private readonly material: THREE.MeshStandardMaterial;
  private readonly jointMaterial: THREE.MeshStandardMaterial;

  private readonly base = new THREE.Color(HAND_PALETTES.unknown.bone);
  private readonly jointBase = new THREE.Color(HAND_PALETTES.unknown.joint);
  private readonly grip = new THREE.Color(GRIP_COLOR);
  private readonly scratch = new THREE.Color();
  private palette: HandColorKey = 'unknown';

  // Reused every frame — this runs twice per frame at 60fps.
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();

  constructor() {
    this.material = new THREE.MeshStandardMaterial({
      color: HAND_PALETTES.unknown.bone,
      roughness: 0.38,
      metalness: 0.12,
      emissive: new THREE.Color(HAND_PALETTES.unknown.bone),
      emissiveIntensity: 0.16,
    });
    this.jointMaterial = new THREE.MeshStandardMaterial({
      color: HAND_PALETTES.unknown.joint,
      roughness: 0.3,
      metalness: 0.08,
      emissive: new THREE.Color(HAND_PALETTES.unknown.joint),
      emissiveIntensity: 0.2,
    });

    // A unit cylinder along +Y, so a bone is one rotate-and-scale away.
    const boneGeometry = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    this.bones = new THREE.InstancedMesh(boneGeometry, this.material, CONNECTIONS.length);
    this.bones.frustumCulled = false;
    this.bones.castShadow = true;

    const jointGeometry = new THREE.SphereGeometry(1, 14, 10);
    this.joints = new THREE.InstancedMesh(jointGeometry, this.jointMaterial, LANDMARK_COUNT);
    this.joints.frustumCulled = false;
    this.joints.castShadow = true;

    // A soft webbing between wrist and knuckles, so the hand has a body.
    this.palmPositions = new Float32Array(PALM_FAN.length * 3 * 3);
    const palmGeometry = new THREE.BufferGeometry();
    palmGeometry.setAttribute('position', new THREE.BufferAttribute(this.palmPositions, 3));
    this.palm = new THREE.Mesh(
      palmGeometry,
      new THREE.MeshStandardMaterial({
        color: HAND_PALETTES.unknown.bone,
        roughness: 0.5,
        metalness: 0.06,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
      }),
    );
    this.palm.frustumCulled = false;

    this.group.add(this.bones, this.joints, this.palm);
    this.group.visible = false;
  }

  /** Left blue, right red. Cheap no-op when the hand hasn't changed. */
  setPalette(key: HandColorKey): void {
    if (key === this.palette) return;
    this.palette = key;
    this.base.setHex(HAND_PALETTES[key].bone);
    this.jointBase.setHex(HAND_PALETTES[key].joint);
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

    this.updateBones(joints);
    this.updateJoints(joints);
    this.updatePalm(joints);

    this.scratch.copy(this.base).lerp(this.grip, gripAmount);
    this.material.color.copy(this.scratch);
    this.material.emissive.copy(this.scratch);
    (this.palm.material as THREE.MeshStandardMaterial).color.copy(this.scratch);

    this.scratch.copy(this.jointBase).lerp(this.grip, gripAmount);
    this.jointMaterial.color.copy(this.scratch);
    this.jointMaterial.emissive.copy(this.scratch);

    this.group.visible = true;
  }

  private updateBones(joints: readonly THREE.Vector3[]): void {
    for (let i = 0; i < CONNECTIONS.length; i += 1) {
      const [a, b] = CONNECTIONS[i]!;
      const from = joints[a]!;
      const to = joints[b]!;

      this.direction.subVectors(to, from);
      const length = this.direction.length();
      if (length < 1e-6) {
        // Degenerate bone: collapse it rather than producing a NaN rotation.
        this.matrix.makeScale(0, 0, 0);
        this.bones.setMatrixAt(i, this.matrix);
        continue;
      }

      this.direction.divideScalar(length);
      this.quaternion.setFromUnitVectors(UP, this.direction);
      this.position.addVectors(from, to).multiplyScalar(0.5);

      const thickness = Math.min(JOINT_RADII[a]!, JOINT_RADII[b]!) * BONE_THICKNESS;
      this.scale.set(thickness, length, thickness);

      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.bones.setMatrixAt(i, this.matrix);
    }
    this.bones.instanceMatrix.needsUpdate = true;
  }

  private updateJoints(joints: readonly THREE.Vector3[]): void {
    for (let i = 0; i < LANDMARK_COUNT; i += 1) {
      const joint = joints[i]!;
      const radius = JOINT_RADII[i]!;
      this.scale.set(radius, radius, radius);
      this.matrix.compose(joint, ZERO_ROTATION, this.scale);
      this.joints.setMatrixAt(i, this.matrix);
    }
    this.joints.instanceMatrix.needsUpdate = true;
  }

  private updatePalm(joints: readonly THREE.Vector3[]): void {
    let offset = 0;
    for (const [a, b, c] of PALM_FAN) {
      for (const index of [a, b, c]) {
        const joint = joints[index]!;
        this.palmPositions[offset++] = joint.x;
        this.palmPositions[offset++] = joint.y;
        this.palmPositions[offset++] = joint.z;
      }
    }
    const attribute = this.palm.geometry.attributes.position!;
    attribute.needsUpdate = true;
    // Lighting needs normals, and the palm changes shape every frame.
    this.palm.geometry.computeVertexNormals();
  }

  hide(): void {
    this.group.visible = false;
  }

  dispose(): void {
    this.bones.geometry.dispose();
    this.joints.geometry.dispose();
    this.palm.geometry.dispose();
    this.material.dispose();
    this.jointMaterial.dispose();
    (this.palm.material as THREE.Material).dispose();
  }
}

const ZERO_ROTATION = new THREE.Quaternion();
