import * as THREE from 'three';

import { ClayWorld } from '../scene/clay.js';
import { Dummy } from '../scene/dummy.js';
import { Npc } from '../scene/npc.js';
import { GrabController, type Aabb } from '../interact/grab.js';
import { Hold } from '../interact/hold.js';
import { DEFAULT_PHYSICS, clampThrow, step as stepBody, type Body } from '../interact/physics.js';
import { StrikeDetector } from '../interact/impact.js';
import {
  History,
  cloneTransform,
  type HistoryTarget,
  type ObjectSnapshot,
  type Transform,
} from '../interact/history.js';
import type { HudAction } from '../hud/hud.js';
import type { Tracking } from './tracking.js';
import { rig } from '../state/rig.js';

/**
 * The sandbox map: blocks you can pick up and throw, a training dummy, a
 * pacing NPC, and the editor toolbar. No opponent, no health — this is where
 * you check that tracking feels right before you go and fight something.
 */

function readTransform(object: THREE.Object3D): Transform {
  return {
    position: object.position.toArray() as [number, number, number],
    quaternion: object.quaternion.toArray() as [number, number, number, number],
    scale: object.scale.toArray() as [number, number, number],
  };
}

function writeTransform(object: THREE.Object3D, transform: Transform): void {
  object.position.fromArray(transform.position);
  object.quaternion.fromArray(transform.quaternion);
  object.scale.fromArray(transform.scale);
}

interface Grabber {
  controller: GrabController;
  hold: Hold;
  /** Pose of the held object when it was picked up, for the undo stack. */
  grabbedFrom: { id: string; transform: Transform } | null;
  handStrike: StrikeDetector;
  npcStrike: StrikeDetector;
}

export class SandboxWorld {
  readonly group = new THREE.Group();

  private readonly clay = new ClayWorld();
  private readonly dummy = new Dummy(new THREE.Vector3(-0.24, 0, -0.44));
  private readonly npc = new Npc();
  private readonly history: History;
  private readonly grabbers: Grabber[];

  /** Ballistic state for anything in flight. Absent means at rest. */
  private readonly bodies = new Map<string, Body>();
  private readonly throwStrike = new StrikeDetector(0.9);
  private readonly npcThrowStrike = new StrikeDetector(0.9);
  private physicsEnabled = true;

  /** Rebuilt each frame — objects move, and grabbing changes what's available. */
  private readonly boxes: Aabb[] = [];

  constructor(private readonly tracking: Tracking) {
    this.grabbers = tracking.runtimes.map(() => ({
      controller: new GrabController(),
      hold: new Hold(),
      grabbedFrom: null,
      handStrike: new StrikeDetector(),
      npcStrike: new StrikeDetector(),
    }));

    const target: HistoryTarget = {
      create: (snapshot) => {
        const object = this.clay.restore(snapshot.id, snapshot.kind as never);
        writeTransform(object.mesh, snapshot.transform);
      },
      destroy: (id) => {
        this.releaseEverywhere(id);
        this.clay.remove(id);
      },
      setTransform: (id, transform) => {
        const object = this.clay.find(id);
        if (object) writeTransform(object.mesh, transform);
      },
    };
    this.history = new History(target);

    this.group.add(this.clay.group, this.dummy.group, this.npc.group);
    this.clay.spawn('clay', new THREE.Vector3(0, 0.045, 0));
  }

  private releaseEverywhere(id: string): void {
    for (const grabber of this.grabbers) {
      if (grabber.controller.held === id) grabber.controller.clear();
    }
  }

  private snapshotOf(id: string): ObjectSnapshot | null {
    const object = this.clay.find(id);
    if (!object) return null;
    return { id, kind: object.kind, transform: readTransform(object.mesh) };
  }

  private boxOf(id: string, bounds: THREE.Box3): Aabb {
    return {
      id,
      min: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
      max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
    };
  }

  private landHit(target: 'dummy' | 'npc', direction: { x: number; z: number }, speed: number): void {
    if (target === 'npc') this.npc.strike(direction, speed);
    else this.dummy.strike(direction, speed);
    rig.hits += 1;
    rig.lastHitSpeed = speed;
  }

  private collectBoxes(excludeId: string | null): void {
    this.boxes.length = 0;
    for (const object of this.clay.objects) {
      if (object.id === excludeId) continue;
      this.boxes.push(this.boxOf(object.id, object.bounds));
    }
  }

  /** @returns whether the action was consumed. */
  handle(action: HudAction): boolean {
    switch (action.type) {
      case 'mode':
        rig.mode = action.mode;
        return true;

      case 'spawn': {
        const spawned = this.clay.spawn(action.kind);
        this.history.push({ type: 'spawn', snapshot: this.snapshotOf(spawned.id)! });
        return true;
      }

      case 'delete': {
        // Whatever a hand is holding or hovering, else the most recent spawn.
        const id = rig.held ?? rig.target ?? this.clay.objects.at(-1)?.id ?? null;
        const snapshot = id ? this.snapshotOf(id) : null;
        if (id && snapshot) {
          this.releaseEverywhere(id);
          this.clay.remove(id);
          this.history.push({ type: 'delete', snapshot });
        }
        return true;
      }

      case 'physics': {
        this.physicsEnabled = !this.physicsEnabled;
        if (!this.physicsEnabled) this.bodies.clear();
        document
          .querySelector<HTMLButtonElement>('[data-action="physics"]')
          ?.classList.toggle('is-active', this.physicsEnabled);
        return true;
      }

      case 'undo':
        this.history.undo();
        return true;

      case 'redo':
        this.history.redo();
        return true;

      default:
        return false;
    }
  }

  update(dtSeconds: number, nowMs: number): void {
    // Bounds first, so this frame's hover test sees where things actually are.
    this.clay.refreshBounds();
    this.updateGrabbing(nowMs);
    this.stepPhysics(dtSeconds, nowMs);

    this.dummy.update(dtSeconds);
    const watched = this.tracking.primary();
    this.npc.update(dtSeconds, watched ? { x: watched.anchor.x, z: watched.anchor.z } : null);
  }

  private updateGrabbing(nowMs: number): void {
    const busy = this.tracking.busy;
    let hit = false;
    let target: string | null = null;
    let held: string | null = null;

    const dummyBox = this.boxOf('dummy', this.dummy.bounds);
    const npcBox = this.boxOf('npc', this.npc.bounds);

    for (let i = 0; i < this.grabbers.length; i += 1) {
      const grabber = this.grabbers[i]!;
      const runtime = this.tracking.runtimes[i]!;
      const state = runtime.state;

      // The other hand's block is off limits, so both can't fight over one.
      const otherHeld =
        this.grabbers.find((_, index) => index !== i)?.controller.held ?? null;
      this.collectBoxes(otherHeld);

      // Nothing gets grabbed or hit while the setup overlay is up — you're
      // being asked to hold a pose, not to play.
      const { state: grab, event } = grabber.controller.update(
        state.present && !busy,
        state.anchor,
        state.grip,
        this.boxes,
      );

      if (event?.type === 'grab') {
        const object = this.clay.find(event.id);
        if (object) {
          grabber.hold.begin(state.anchor, state.orientation, object.mesh);
          grabber.grabbedFrom = { id: event.id, transform: readTransform(object.mesh) };
        }
        // Anything caught out of the air stops being ballistic.
        this.bodies.delete(event.id);
      }

      if (grab.held) {
        const object = this.clay.find(grab.held);
        if (object) {
          grabber.hold.apply(state.anchor, state.orientation, object.mesh, rig.mode);
        }
      }

      if (event?.type === 'release' && grabber.grabbedFrom) {
        this.onRelease(grabber, runtime.velocity.velocity());
      }

      if (state.present && !busy) {
        const carried = grab.held ? this.clay.find(grab.held) : null;
        const point = carried ? carried.mesh.position : state.anchor;
        const margin = carried ? Math.max(...carried.mesh.scale.toArray()) * 0.055 : 0.03;
        const velocity = runtime.velocity.velocity();

        // Separate detectors per target, so a swing clipping both counts on
        // both rather than one cooldown eating the other.
        const onDummy = grabber.handStrike.test(dummyBox, point, velocity, nowMs, margin);
        if (onDummy) this.landHit('dummy', onDummy.direction, onDummy.speed);

        const onNpc = grabber.npcStrike.test(npcBox, point, velocity, nowMs, margin);
        if (onNpc) this.landHit('npc', onNpc.direction, onNpc.speed);
      }

      hit = hit || grab.hit;
      target = target ?? grab.target;
      held = held ?? grab.held;
    }

    rig.hit = hit;
    rig.target = target;
    rig.held = held;
  }

  private onRelease(grabber: Grabber, thrownVelocity: { x: number; y: number; z: number }): void {
    const from = grabber.grabbedFrom;
    if (!from) return;

    const object = this.clay.find(from.id);
    if (object) {
      this.history.push({
        type: 'transform',
        id: from.id,
        before: cloneTransform(from.transform),
        after: readTransform(object.mesh),
      });

      if (this.physicsEnabled) {
        // Throw it with whatever the hand was doing over the last ~90ms.
        const thrown = clampThrow(thrownVelocity);
        this.bodies.set(from.id, {
          position: object.mesh.position,
          velocity: { ...thrown },
          radius: Math.max(...object.mesh.scale.toArray()) * 0.045,
          awake: true,
        });
      }
    }

    grabber.grabbedFrom = null;
  }

  private stepPhysics(dtSeconds: number, nowMs: number): void {
    if (!this.physicsEnabled) return;

    const dummyBox = this.boxOf('dummy', this.dummy.bounds);
    const npcBox = this.boxOf('npc', this.npc.bounds);

    for (const [id, body] of this.bodies) {
      const object = this.clay.find(id);
      // Deleted mid-flight, or caught by a hand.
      if (!object || rig.held === id) {
        this.bodies.delete(id);
        continue;
      }

      stepBody(body, dtSeconds, DEFAULT_PHYSICS);
      object.mesh.position.set(body.position.x, body.position.y, body.position.z);

      const radius = object.mesh.scale.x * 0.045;
      const onDummy = this.throwStrike.test(dummyBox, body.position, body.velocity, nowMs, radius);
      const onNpc = this.npcThrowStrike.test(npcBox, body.position, body.velocity, nowMs, radius);
      const strike = onDummy ?? onNpc;
      if (strike) {
        this.landHit(onDummy ? 'dummy' : 'npc', strike.direction, strike.speed);
        // Bounce it off rather than letting it sail through the torso.
        body.velocity.x = -body.velocity.x * 0.45;
        body.velocity.z = -body.velocity.z * 0.45;
      }

      if (!body.awake) this.bodies.delete(id);
    }
  }

  dispose(): void {
    this.clay.dispose();
    this.dummy.dispose();
    this.npc.dispose();
    this.group.clear();
  }
}
