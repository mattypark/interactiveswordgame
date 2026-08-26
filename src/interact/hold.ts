import * as THREE from 'three';

/**
 * Carries a grabbed object with the hand.
 *
 * Both the offset and the rotation are recorded relative to the hand at the
 * moment of the grab, so the object keeps the pose it had when you closed
 * around it — twisting your wrist twists the block rather than sliding it
 * around some fixed axis.
 *
 * The tool mode decides which of those degrees of freedom actually apply.
 */

export type CarryMode = 'select' | 'move' | 'rotate' | 'scale' | 'edit' | 'warp';

/** Metres of vertical hand travel that doubles an object's size. */
const SCALE_TRAVEL = 0.14;
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;

export class Hold {
  /** Grab-time offset from palm to object, in hand-local space. */
  private readonly offset = new THREE.Vector3();
  /** The same offset in world space, for modes that ignore hand rotation. */
  private readonly worldOffset = new THREE.Vector3();
  /** Grab-time object rotation, relative to the hand. */
  private readonly relativeRotation = new THREE.Quaternion();

  private readonly grabHandPosition = new THREE.Vector3();
  private readonly grabPosition = new THREE.Vector3();
  private readonly grabRotation = new THREE.Quaternion();
  private readonly grabScale = new THREE.Vector3(1, 1, 1);

  private readonly inverseHand = new THREE.Quaternion();

  begin(handPosition: THREE.Vector3, handRotation: THREE.Quaternion, object: THREE.Object3D): void {
    this.inverseHand.copy(handRotation).invert();

    this.worldOffset.copy(object.position).sub(handPosition);
    this.offset.copy(this.worldOffset).applyQuaternion(this.inverseHand);
    this.relativeRotation.copy(this.inverseHand).multiply(object.quaternion);

    this.grabHandPosition.copy(handPosition);
    this.grabPosition.copy(object.position);
    this.grabRotation.copy(object.quaternion);
    this.grabScale.copy(object.scale);
  }

  apply(
    handPosition: THREE.Vector3,
    handRotation: THREE.Quaternion,
    object: THREE.Object3D,
    mode: CarryMode = 'select',
  ): void {
    switch (mode) {
      case 'rotate':
        // Pinned in place; only the wrist matters.
        object.position.copy(this.grabPosition);
        object.quaternion.copy(handRotation).multiply(this.relativeRotation);
        break;

      case 'scale': {
        const lift = handPosition.y - this.grabHandPosition.y;
        const factor = THREE.MathUtils.clamp(
          Math.pow(2, lift / SCALE_TRAVEL),
          MIN_SCALE,
          MAX_SCALE,
        );
        object.position.copy(this.grabPosition);
        object.quaternion.copy(this.grabRotation);
        object.scale.copy(this.grabScale).multiplyScalar(factor);
        break;
      }

      case 'move':
        // Translation only — the block slides without tumbling.
        object.position.copy(handPosition).add(this.worldOffset);
        object.quaternion.copy(this.grabRotation);
        break;

      case 'select':
      case 'edit':
      case 'warp':
      default:
        // Full six degrees of freedom, the way you'd actually hold something.
        object.position.copy(this.offset).applyQuaternion(handRotation).add(handPosition);
        object.quaternion.copy(handRotation).multiply(this.relativeRotation);
        break;
    }
  }
}
