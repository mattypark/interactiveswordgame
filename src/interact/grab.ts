/**
 * Hover and grab, as a pure state machine.
 *
 * Two things keep this from flickering. A Schmitt trigger — squeeze past 0.6
 * to grab, but you have to relax below 0.4 to let go — so a grip hovering near
 * the threshold doesn't drop the block. And once something is held it stays
 * held even if the palm wanders outside its bounds, because the block moves
 * with the hand and re-testing containment every frame would fight itself.
 *
 * Pure — no three.js, no DOM. See hold.ts for the transform that carries the
 * object along.
 */

import type { Vec3 } from '../hands/project.js';

export interface Aabb {
  id: string;
  min: Vec3;
  max: Vec3;
}

/** Squeeze past this to grab. */
export const GRAB_ON = 0.6;
/** Relax below this to let go. */
export const GRAB_OFF = 0.4;

/**
 * Bounds are grown by this much before testing, in metres. Fingers close
 * *around* an object, so the palm centre sits a little outside it at the
 * moment you'd expect a grab to take.
 */
export const GRAB_MARGIN = 0.035;

export interface GrabState {
  /** Palm is inside something grabbable. */
  hit: boolean;
  /** Id of the object under the palm, or null. */
  target: string | null;
  /** Id of the object being carried, or null. */
  held: string | null;
}

export interface GrabEvent {
  type: 'grab' | 'release';
  id: string;
}

function containsWithMargin(box: Aabb, point: Vec3, margin: number): boolean {
  return (
    point.x >= box.min.x - margin &&
    point.x <= box.max.x + margin &&
    point.y >= box.min.y - margin &&
    point.y <= box.max.y + margin &&
    point.z >= box.min.z - margin &&
    point.z <= box.max.z + margin
  );
}

function centre(box: Aabb): Vec3 {
  return {
    x: (box.min.x + box.max.x) / 2,
    y: (box.min.y + box.max.y) / 2,
    z: (box.min.z + box.max.z) / 2,
  };
}

function distanceSquared(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * The grabbable under the palm. When boxes overlap — spawns land on top of one
 * another — the nearest centre wins, which is the one a person would mean.
 */
export function findTarget(
  palm: Vec3,
  boxes: readonly Aabb[],
  margin: number = GRAB_MARGIN,
): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;

  for (const box of boxes) {
    if (!containsWithMargin(box, palm, margin)) continue;
    const distance = distanceSquared(palm, centre(box));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = box.id;
    }
  }

  return best;
}

export class GrabController {
  private heldId: string | null = null;

  get held(): string | null {
    return this.heldId;
  }

  /**
   * @param present whether the hand is being tracked at all
   * @param grip 0..1
   * @returns the new state, plus a grab/release event when one fired
   */
  update(
    present: boolean,
    palm: Vec3,
    grip: number,
    boxes: readonly Aabb[],
  ): { state: GrabState; event: GrabEvent | null } {
    // Losing the hand drops whatever it was carrying — better than leaving a
    // block welded to a hand that no longer exists.
    if (!present) {
      const dropped = this.heldId;
      this.heldId = null;
      return {
        state: { hit: false, target: null, held: null },
        event: dropped ? { type: 'release', id: dropped } : null,
      };
    }

    if (this.heldId !== null) {
      // Still holding: the only question is whether the hand has relaxed.
      const stillExists = boxes.some((box) => box.id === this.heldId);
      if (grip <= GRAB_OFF || !stillExists) {
        const released = this.heldId;
        this.heldId = null;
        return {
          state: { hit: false, target: null, held: null },
          event: stillExists ? { type: 'release', id: released } : null,
        };
      }
      return {
        state: { hit: true, target: this.heldId, held: this.heldId },
        event: null,
      };
    }

    const target = findTarget(palm, boxes);
    if (target !== null && grip >= GRAB_ON) {
      this.heldId = target;
      return {
        state: { hit: true, target, held: target },
        event: { type: 'grab', id: target },
      };
    }

    return { state: { hit: target !== null, target, held: null }, event: null };
  }

  /** Force a release, e.g. when the held object is deleted. */
  clear(): void {
    this.heldId = null;
  }
}
