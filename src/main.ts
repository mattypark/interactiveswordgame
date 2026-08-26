import * as THREE from 'three';

import { createStage } from './scene/stage.js';
import { createGrid } from './scene/grid.js';
import { ClayWorld } from './scene/clay.js';
import { Vision } from './hands/vision.js';
import { HandsRig, type HandState } from './hands/hands.js';
import { normaliseGrip } from './hands/grip.js';
import { GrabController, type Aabb } from './interact/grab.js';
import { Hold } from './interact/hold.js';
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

const calibration = new CalibrationFlow();

/** One grab controller and one carry transform per hand. */
const grabbers = hands.hands.map(() => ({ controller: new GrabController(), hold: new Hold() }));

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

    case 'spawn':
      world.spawn(action.kind);
      break;

    case 'delete': {
      // Whatever a hand is holding or hovering, else the most recent spawn.
      const id = rig.held ?? rig.target ?? world.objects.at(-1)?.id ?? null;
      if (id) {
        releaseEverywhere(id);
        world.remove(id);
      }
      break;
    }

    case 'calibrate':
      if (action.step === 'reset') calibration.reset();
      else calibration.begin(action.step);
      break;

    default:
      // undo/redo/physics land in later stages.
      break;
  }
});

const vision = new Vision();
void vision.start(hud.pipVideo);

/** Rebuilt each frame — objects move, and grabbing changes what's available. */
const boxes: Aabb[] = [];

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
    const { controller, hold } = grabbers[i]!;

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
      if (object) hold.begin(state.anchor, state.orientation, object.mesh);
    }

    if (grab.held) {
      const object = world.find(grab.held);
      if (object) hold.apply(state.anchor, state.orientation, object.mesh);
    }

    hit = hit || grab.hit;
    target = target ?? grab.target;
    held = held ?? grab.held;
  }

  const primary = primaryHand(states);
  rig.force = primary?.grip ?? 0;
  rig.calibrated = calibration.calibrated;
  rig.hit = hit;
  rig.target = target;
  rig.held = held;
}

function frame(): void {
  vision.update();
  hands.update(vision.latest, vision.frameSize, performance.now());

  world.refreshBounds();
  updateGrabbing();

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
  };
}
