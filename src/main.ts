import * as THREE from 'three';

import { createStage } from './scene/stage.js';
import { createGrid } from './scene/grid.js';
import { PlayVolumeView } from './scene/volume.js';
import { Dummy } from './scene/dummy.js';
import { Npc } from './scene/npc.js';
import { ClayWorld } from './scene/clay.js';
import { Vision } from './hands/vision.js';
import { HandsRig, setSwapHandedness, type HandState } from './hands/hands.js';
import { normaliseGrip } from './hands/grip.js';
import { VelocityTracker } from './hands/velocity.js';
import { GrabController, type Aabb } from './interact/grab.js';
import { Hold } from './interact/hold.js';
import { DEFAULT_PHYSICS, clampThrow, step as stepBody, type Body } from './interact/physics.js';
import { StrikeDetector } from './interact/impact.js';
import {
  History,
  cloneTransform,
  type HistoryTarget,
  type ObjectSnapshot,
  type Transform,
} from './interact/history.js';
import { CalibrationFlow } from './hud/calibration.js';
import { Hud } from './hud/hud.js';
import { rig } from './state/rig.js';

const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
if (!canvas) throw new Error('#stage canvas missing from index.html');

const stage = createStage(canvas);
stage.scene.add(createGrid());

const world = new ClayWorld();
stage.scene.add(world.group);

// One block waiting on the grid, exactly like the reference build opens.
world.spawn('clay', new THREE.Vector3(0, 0.045, 0));

const hands = new HandsRig();
stage.scene.add(hands.group);

const volumeView = new PlayVolumeView(hands.volume);
stage.scene.add(volumeView.group);

/** Ballistic state for anything in flight. Absent means at rest. */
const bodies = new Map<string, Body>();
let physicsEnabled = true;

const dummy = new Dummy(new THREE.Vector3(-0.24, 0, -0.44));
stage.scene.add(dummy.group);

const npc = new Npc();
stage.scene.add(npc.group);

/** Detectors per hand per target, plus ones shared by everything thrown. */
const handStrikes = hands.hands.map(() => new StrikeDetector());
const npcHandStrikes = hands.hands.map(() => new StrikeDetector());
const throwStrike = new StrikeDetector(0.9);
const npcThrowStrike = new StrikeDetector(0.9);

const calibration = new CalibrationFlow();

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

function snapshotOf(id: string): ObjectSnapshot | null {
  const object = world.find(id);
  if (!object) return null;
  return { id, kind: object.kind, transform: readTransform(object.mesh) };
}

const historyTarget: HistoryTarget = {
  create(snapshot) {
    const object = world.restore(snapshot.id, snapshot.kind as never);
    writeTransform(object.mesh, snapshot.transform);
  },
  destroy(id) {
    releaseEverywhere(id);
    world.remove(id);
  },
  setTransform(id, transform) {
    const object = world.find(id);
    if (object) writeTransform(object.mesh, transform);
  },
};

const history = new History(historyTarget);

/** One grab controller and one carry transform per hand. */
const grabbers = hands.hands.map(() => ({
  controller: new GrabController(),
  hold: new Hold(),
  velocity: new VelocityTracker(),
  /** Pose of the held object when it was picked up, for the undo stack. */
  grabbedFrom: null as { id: string; transform: Transform } | null,
}));

const hud = new Hud();
hud.setActiveMode(rig.mode);

function releaseEverywhere(id: string): void {
  for (const grabber of grabbers) {
    if (grabber.controller.held === id) grabber.controller.clear();
  }
}

hud.on((action) => {
  switch (action.type) {
    case 'mode':
      rig.mode = action.mode;
      hud.setActiveMode(action.mode);
      break;

    case 'spawn': {
      const spawned = world.spawn(action.kind);
      history.push({ type: 'spawn', snapshot: snapshotOf(spawned.id)! });
      break;
    }

    case 'delete': {
      // Whatever a hand is holding or hovering, else the most recent spawn.
      const id = rig.held ?? rig.target ?? world.objects.at(-1)?.id ?? null;
      const snapshot = id ? snapshotOf(id) : null;
      if (id && snapshot) {
        releaseEverywhere(id);
        world.remove(id);
        history.push({ type: 'delete', snapshot });
      }
      break;
    }

    case 'calibrate':
      if (action.step === 'reset') calibration.reset();
      else calibration.begin(action.step);
      break;

    case 'mirror':
      rig.mirror = !rig.mirror;
      hands.volume = { ...hands.volume, mirror: rig.mirror };
      break;

    case 'toggle-view':
      rig.view = rig.view === 'third' ? 'first' : 'third';
      stage.setView(rig.view, hands.volume);
      break;

    case 'invert-depth':
      rig.invertDepth = !rig.invertDepth;
      hands.volume = { ...hands.volume, invertDepth: rig.invertDepth };
      break;

    case 'swap-hands':
      rig.swapHands = !rig.swapHands;
      setSwapHandedness(rig.swapHands);
      break;

    case 'set-origin': {
      // Hold your hand somewhere comfortable and press R: that pose becomes
      // the middle of the box. Press it with no hand in frame to clear.
      const hand = hands.states.find((state) => state.present);
      if (hand) hands.recentre(hand.raw, hand.depth);
      else hands.clearOrigin();
      rig.originSet = hands.volume.origin !== null;
      break;
    }

    case 'physics': {
      physicsEnabled = !physicsEnabled;
      if (!physicsEnabled) bodies.clear();
      const button = document.querySelector<HTMLButtonElement>('[data-action="physics"]');
      button?.classList.toggle('is-active', physicsEnabled);
      break;
    }

    case 'undo':
      history.undo();
      break;

    case 'redo':
      history.redo();
      break;

    default:
      break;
  }
});

const vision = new Vision();
void vision.start(hud.pipVideo);

/** Rebuilt each frame — objects move, and grabbing changes what's available. */
const boxes: Aabb[] = [];

function npcBox(): Aabb {
  return {
    id: 'npc',
    min: { x: npc.bounds.min.x, y: npc.bounds.min.y, z: npc.bounds.min.z },
    max: { x: npc.bounds.max.x, y: npc.bounds.max.y, z: npc.bounds.max.z },
  };
}

function dummyBox(): Aabb {
  return {
    id: 'dummy',
    min: { x: dummy.bounds.min.x, y: dummy.bounds.min.y, z: dummy.bounds.min.z },
    max: { x: dummy.bounds.max.x, y: dummy.bounds.max.y, z: dummy.bounds.max.z },
  };
}

function landHit(target: 'dummy' | 'npc', direction: { x: number; z: number }, speed: number): void {
  if (target === 'npc') npc.strike(direction, speed);
  else dummy.strike(direction, speed);
  rig.hits += 1;
  rig.lastHitSpeed = speed;
}

function collectBoxes(excludeId: string | null): void {
  boxes.length = 0;
  for (const object of world.objects) {
    if (object.id === excludeId) continue;
    boxes.push({
      id: object.id,
      min: { x: object.bounds.min.x, y: object.bounds.min.y, z: object.bounds.min.z },
      max: { x: object.bounds.max.x, y: object.bounds.max.y, z: object.bounds.max.z },
    });
  }
}

/** The hand whose readout the HUD shows: whichever is holding, else the first seen. */
function primaryHand(states: HandState[]): HandState | null {
  return (
    states.find((state, index) => state.present && grabbers[index]!.controller.held !== null) ??
    states.find((state) => state.present) ??
    null
  );
}

function updateGrabbing(): void {
  const states = hands.states;

  // Calibration samples whichever hand is currently visible.
  const visible = states.find((state) => state.present);
  calibration.update(visible?.curl ?? null);

  let hit = false;
  let target: string | null = null;
  let held: string | null = null;

  for (let i = 0; i < states.length; i += 1) {
    const state = states[i]!;
    const grabber = grabbers[i]!;
    const { controller, hold } = grabber;

    state.grip =
      state.present && state.curl !== null
        ? normaliseGrip(state.curl, calibration.calibration)
        : 0;

    // The other hand's block is off limits, so both hands can't fight over one.
    const otherHeld = grabbers.find((_, index) => index !== i)?.controller.held ?? null;
    collectBoxes(otherHeld);

    const { state: grab, event } = controller.update(state.present, state.anchor, state.grip, boxes);

    if (event?.type === 'grab') {
      const object = world.find(event.id);
      if (object) {
        hold.begin(state.anchor, state.orientation, object.mesh);
        grabber.grabbedFrom = { id: event.id, transform: readTransform(object.mesh) };
      }
    }

    if (grab.held) {
      const object = world.find(grab.held);
      if (object) hold.apply(state.anchor, state.orientation, object.mesh, rig.mode);
    }

    if (event?.type === 'grab') {
      // Anything caught out of the air stops being ballistic.
      bodies.delete(event.id);
    }

    if (event?.type === 'release' && grabber.grabbedFrom) {
      const object = world.find(grabber.grabbedFrom.id);
      if (object) {
        history.push({
          type: 'transform',
          id: grabber.grabbedFrom.id,
          before: cloneTransform(grabber.grabbedFrom.transform),
          after: readTransform(object.mesh),
        });
      }
      if (physicsEnabled && object) {
        // Throw it with whatever the hand was doing over the last ~90ms.
        const thrown = clampThrow(grabber.velocity.velocity());
        bodies.set(grabber.grabbedFrom.id, {
          position: object.mesh.position,
          velocity: { ...thrown },
          radius: Math.max(...object.mesh.scale.toArray()) * 0.045,
          awake: true,
        });
      }

      grabber.grabbedFrom = null;
    }

    if (state.present) grabber.velocity.push(state.anchor, performance.now());
    else grabber.velocity.reset();

    // Hitting the dummy. An empty hand punches; a full one swings whatever
    // it's carrying, which is the mechanic the sword will use.
    if (state.present) {
      const held = grab.held ? world.find(grab.held) : null;
      const point = held ? held.mesh.position : state.anchor;
      const margin = held ? Math.max(...held.mesh.scale.toArray()) * 0.055 : 0.03;
      const velocity = grabber.velocity.velocity();
      const now = performance.now();

      // Separate detectors per target, so a swing that clips both counts on
      // both rather than one cooldown eating the other.
      const onDummy = handStrikes[i]!.test(dummyBox(), point, velocity, now, margin);
      if (onDummy) landHit('dummy', onDummy.direction, onDummy.speed);

      const onNpc = npcHandStrikes[i]!.test(npcBox(), point, velocity, now, margin);
      if (onNpc) landHit('npc', onNpc.direction, onNpc.speed);
    }

    hit = hit || grab.hit;
    target = target ?? grab.target;
    held = held ?? grab.held;
  }

  const primary = primaryHand(states);

  // Depth readout, and the marker showing where the hand is on the floor.
  rig.depth = primary?.present ? primary.depth : null;
  rig.depthInRange =
    rig.depth === null ||
    (rig.depth >= hands.volume.nearDepth && rig.depth <= hands.volume.farDepth);
  volumeView.setHand(primary?.present ? primary.anchor : null, rig.depthInRange);

  // The rig centres itself on the first hand it sees; keep the HUD honest.
  rig.originSet = hands.volume.origin !== null;

  rig.force = primary?.grip ?? 0;
  rig.calibrated = calibration.calibrated;
  rig.hit = hit;
  rig.target = target;
  rig.held = held;
}

let lastFrameMs = performance.now();

function stepPhysics(dtSeconds: number): void {
  if (!physicsEnabled) return;

  for (const [id, body] of bodies) {
    const object = world.find(id);
    // Deleted mid-flight, or caught by a hand.
    if (!object || rig.held === id) {
      bodies.delete(id);
      continue;
    }

    stepBody(body, dtSeconds, DEFAULT_PHYSICS);
    object.mesh.position.set(body.position.x, body.position.y, body.position.z);

    const radius = object.mesh.scale.x * 0.045;
    const now = performance.now();

    const onDummy = throwStrike.test(dummyBox(), body.position, body.velocity, now, radius);
    const onNpc = npcThrowStrike.test(npcBox(), body.position, body.velocity, now, radius);
    const strike = onDummy ?? onNpc;
    if (strike) {
      landHit(onDummy ? 'dummy' : 'npc', strike.direction, strike.speed);
      // Bounce it off rather than letting it sail through the torso.
      body.velocity.x = -body.velocity.x * 0.45;
      body.velocity.z = -body.velocity.z * 0.45;
    }

    if (!body.awake) bodies.delete(id);
  }
}

function frame(): void {
  const now = performance.now();
  const dt = (now - lastFrameMs) / 1000;
  lastFrameMs = now;

  vision.update();
  hands.update(vision.latest, vision.frameSize, performance.now());

  // Bounds first, so this frame's hover test sees where things actually are.
  world.refreshBounds();
  updateGrabbing();
  stepPhysics(dt);
  dummy.update(dt);

  // The NPC watches whichever hand is being tracked.
  const watched = hands.states.find((state) => state.present) ?? null;
  npc.update(dt, watched ? { x: watched.anchor.x, z: watched.anchor.z } : null);

  hud.sync(rig);
  hud.setCalibrationState(calibration.status);
  hud.setNotice(vision.error);
  stage.render();

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Dev-only handle so the pipeline can be driven with synthetic landmarks from
// the devtools protocol — the only way to exercise hand rendering and grabbing
// without a real hand in front of a real camera. Stripped from production.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__isg = {
    stage,
    world,
    hands,
    vision,
    rig,
    calibration,
    grabbers,
    history,
    bodies,
    volumeView,
    dummy,
    npc,
  };
}
