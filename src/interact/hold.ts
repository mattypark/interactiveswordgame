import * as THREE from 'three';

/**
 * Carries a grabbed object with the hand.
 *
 * Both the offset and the rotation are recorded relative to the hand at the
 * moment of the grab, so the object keeps the pose it had when you closed
 * around it — and twisting your wrist twists the block, rather than sliding it
 * around a fixed axis.
 */
export class Hold {
  /** Grab-time offset from palm to object, expressed in hand-local space. */
  private readonly offset = new THREE.Vector3();
  /** Grab-time object rotation, relative to the hand. */
  private readonly relativeRotation = new THREE.Quaternion();

  private readonly inverseHand = new THREE.Quaternion();

  begin(handPosition: THREE.Vector3, handRotation: THREE.Quaternion, object: THREE.Object3D): void {
    this.inverseHand.copy(handRotation).invert();

    this.offset.copy(object.position).sub(handPosition).applyQuaternion(this.inverseHand);
    this.relativeRotation.copy(this.inverseHand).multiply(object.quaternion);
  }

  apply(handPosition: THREE.Vector3, handRotation: THREE.Quaternion, object: THREE.Object3D): void {
    object.position.copy(this.offset).applyQuaternion(handRotation).add(handPosition);
    object.quaternion.copy(handRotation).multiply(this.relativeRotation);
  }
}
