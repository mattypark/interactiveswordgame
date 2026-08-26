import * as THREE from 'three';

/**
 * What a landed punch looks like.
 *
 * A ring that expands and fades out from the contact point, and a burst of
 * shards thrown outward along the punch. Both are pooled and reused — a fight
 * lands dozens of these and allocating geometry per hit would stutter exactly
 * when the game most needs not to.
 */

const RING_LIFETIME = 0.34;
const SHARD_LIFETIME = 0.42;
const SHARD_COUNT = 10;

/** Simultaneous impacts before the oldest is recycled. */
const POOL = 4;

const HIT_COLOR = 0xffd48a;

interface Burst {
  ring: THREE.Mesh;
  shards: THREE.InstancedMesh;
  /** Per-shard direction and speed, packed as velocity vectors. */
  velocities: THREE.Vector3[];
  origin: THREE.Vector3;
  age: number;
  strength: number;
  live: boolean;
}

const SHARD_UP = new THREE.Vector3(0, 1, 0);

export class ImpactFx {
  readonly group = new THREE.Group();

  private readonly bursts: Burst[] = [];
  private next = 0;

  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();

  constructor() {
    for (let i = 0; i < POOL; i += 1) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.4, 0.5, 28),
        new THREE.MeshBasicMaterial({
          color: HIT_COLOR,
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      ring.visible = false;
      ring.frustumCulled = false;

      const shards = new THREE.InstancedMesh(
        new THREE.ConeGeometry(0.4, 1, 4),
        new THREE.MeshBasicMaterial({ color: HIT_COLOR, transparent: true, depthWrite: false }),
        SHARD_COUNT,
      );
      shards.visible = false;
      shards.frustumCulled = false;

      const velocities = Array.from({ length: SHARD_COUNT }, (_, index) => {
        // Fixed directions rather than random ones: a burst should look the
        // same shape every time so it reads as an effect, not as noise.
        const angle = (index / SHARD_COUNT) * Math.PI * 2;
        const lift = 0.35 + (index % 3) * 0.22;
        return new THREE.Vector3(Math.cos(angle), lift, Math.sin(angle)).normalize();
      });

      this.group.add(ring, shards);
      this.bursts.push({
        ring,
        shards,
        velocities,
        origin: new THREE.Vector3(),
        age: 0,
        strength: 1,
        live: false,
      });
    }
  }

  /**
   * @param at where the punch connected
   * @param facing which way the camera is, so the ring faces the viewer
   * @param strength 0..1
   */
  burst(at: THREE.Vector3, facing: THREE.Quaternion, strength = 1): void {
    const burst = this.bursts[this.next]!;
    this.next = (this.next + 1) % POOL;

    burst.origin.copy(at);
    burst.age = 0;
    burst.strength = Math.max(0.25, Math.min(1, strength));
    burst.live = true;

    burst.ring.position.copy(at);
    burst.ring.quaternion.copy(facing);
    burst.ring.visible = true;
    burst.shards.visible = true;
  }

  update(dtSeconds: number): void {
    for (const burst of this.bursts) {
      if (!burst.live) continue;

      burst.age += dtSeconds;
      const ringT = burst.age / RING_LIFETIME;
      const shardT = burst.age / SHARD_LIFETIME;

      if (shardT >= 1) {
        burst.live = false;
        burst.ring.visible = false;
        burst.shards.visible = false;
        continue;
      }

      // Ring: snaps out fast, then eases, fading the whole way.
      if (ringT < 1) {
        const eased = 1 - Math.pow(1 - ringT, 3);
        const radius = (0.05 + eased * 0.22) * burst.strength;
        burst.ring.scale.setScalar(radius);
        (burst.ring.material as THREE.MeshBasicMaterial).opacity = (1 - ringT) * 0.85;
      } else {
        burst.ring.visible = false;
      }

      // Shards: thrown outward, slowing, shrinking.
      const spread = (0.06 + shardT * 0.26) * burst.strength;
      const shrink = (1 - shardT) * 0.045 * burst.strength;
      for (let i = 0; i < SHARD_COUNT; i += 1) {
        const direction = burst.velocities[i]!;
        this.position.copy(burst.origin).addScaledVector(direction, spread);
        this.quaternion.setFromUnitVectors(SHARD_UP, direction);
        this.scale.set(shrink, shrink * 2.2, shrink);
        this.matrix.compose(this.position, this.quaternion, this.scale);
        burst.shards.setMatrixAt(i, this.matrix);
      }
      burst.shards.instanceMatrix.needsUpdate = true;
      (burst.shards.material as THREE.MeshBasicMaterial).opacity = 1 - shardT;
    }
  }

  dispose(): void {
    for (const burst of this.bursts) {
      burst.ring.geometry.dispose();
      (burst.ring.material as THREE.Material).dispose();
      burst.shards.geometry.dispose();
      (burst.shards.material as THREE.Material).dispose();
    }
    this.group.clear();
  }
}
