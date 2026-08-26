import * as THREE from 'three';

import { createStage } from './scene/stage.js';
import { createGrid } from './scene/grid.js';
import { Router } from './app/router.js';
import { findMap, type MapDefinition } from './maps/registry.js';
import { Tracking } from './game/tracking.js';
import { SandboxWorld } from './game/sandbox.js';
import { FightWorld } from './game/fight.js';
import { VersusWorld } from './game/versus.js';
import { Lobby } from './app/lobby.js';
import { Hud } from './hud/hud.js';
import { rig } from './state/rig.js';

const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
if (!canvas) throw new Error('#stage canvas missing from index.html');

const stage = createStage(canvas);

const hud = new Hud();
hud.setActiveMode(rig.mode);
hud.setVisible(false);

const tracking = new Tracking(hud, (view) => stage.setView(view, tracking.hands.volume));
tracking.addTo(stage.scene);

/** Scenery and grid for the loaded map — replaced wholesale on a map change. */
let mapScenery: THREE.Object3D | null = null;
let world: SandboxWorld | FightWorld | VersusWorld | null = null;
let currentMap: MapDefinition | null = null;

/** Set when a live match is running, so loadMap builds the versus world. */
let liveMatch = false;

function loadMap(map: MapDefinition): void {
  if (mapScenery) {
    stage.scene.remove(mapScenery);
    mapScenery = null;
  }
  world?.dispose();
  world = null;

  currentMap = map;
  stage.applyMap(map);

  const scenery = new THREE.Group();
  scenery.add(createGrid(map.grid));
  const extra = map.build?.();
  if (extra) scenery.add(extra);
  stage.scene.add(scenery);
  mapScenery = scenery;

  world =
    map.mode === 'sandbox'
      ? new SandboxWorld(tracking)
      : liveMatch
        ? new VersusWorld(tracking, lobby.client)
        : new FightWorld(tracking);
  stage.scene.add(world.group);

  // The editor toolbar only means anything in the sandbox, and neither does
  // face detection — the cheapest model is the one that doesn't run.
  hud.setToolbarVisible(map.mode === 'sandbox');
  tracking.vision.faceEnabled = map.mode === 'fight';
  hud.setVisible(true);
  tracking.setVisible(true);
}

const lobby = new Lobby((match) => {
  liveMatch = true;
  router.show('playing');
  loadMap(findMap(match.mapId));
});

const router = new Router({
  play(map) {
    liveMatch = false;
    loadMap(map);
  },
  lobby() {
    // The lobby screen is already up; nothing else to do until someone pairs.
  },
  screen(id) {
    if (id !== 'lobby' && id !== 'playing') lobby.cancel();
    const playing = id === 'playing';
    hud.setVisible(playing);
    tracking.setVisible(playing);
  },
});

// A menu is up at boot, but the camera and the hand model start loading now so
// the first frame of play isn't spent waiting for them.
void tracking.start(hud.pipVideo);

hud.on((action) => {
  if (tracking.handle(action)) return;
  if (world?.handle(action)) return;
});

let lastFrameMs = performance.now();

/**
 * Longest step anything is advanced by in one frame.
 *
 * A backgrounded tab, a garbage collection or a slow model frame hands back a
 * huge delta, and every system downstream would apply it at once — the fighter
 * teleports, thrown blocks jump through walls. Losing a little time under load
 * is invisible; the jumps are not.
 */
const MAX_FRAME_STEP = 1 / 20;

function frame(): void {
  const now = performance.now();
  const dt = Math.min((now - lastFrameMs) / 1000, MAX_FRAME_STEP);
  lastFrameMs = now;

  tracking.update(now);
  if (router.screen === 'playing') world?.update(dt, now);

  hud.sync(rig);
  hud.syncFight(router.screen === 'playing' ? rig.fight : null);
  hud.setCalibrationState(tracking.calibration.status);
  if (tracking.vision.error) hud.setNotice(tracking.vision.error);
  stage.render();

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Dev-only handle so the pipeline can be driven with synthetic landmarks from
// the devtools protocol — the only way to exercise hand rendering, grabbing and
// hitting without a real hand in front of a real camera. Stripped from
// production builds.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__isg = {
    stage,
    rig,
    hud,
    router,
    tracking,
    hands: tracking.hands,
    vision: tracking.vision,
    calibration: tracking.calibration,
    setup: tracking.setup,
    volumeView: tracking.volumeView,
    get world() {
      return world;
    },
    get map() {
      return currentMap;
    },
    loadMap,
    findMap,
  };
}
