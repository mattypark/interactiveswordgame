import * as THREE from 'three';

import { createStage } from './scene/stage';
import { createGrid } from './scene/grid';
import { ClayWorld } from './scene/clay';
import { Hud } from './hud/hud';
import { rig } from './state/rig';

const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
if (!canvas) throw new Error('#stage canvas missing from index.html');

const stage = createStage(canvas);
stage.scene.add(createGrid());

const world = new ClayWorld();
stage.scene.add(world.group);

// One block waiting on the grid, exactly like the reference build opens.
world.spawn('clay', new THREE.Vector3(0, 0.045, 0));

const hud = new Hud();
hud.setActiveMode(rig.mode);

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
      // No hand selection yet (stage 4) — drop the most recent object.
      const last = world.objects.at(-1);
      if (last) world.remove(last.id);
      break;
    }

    default:
      // undo/redo/physics/calibrate land in later stages.
      break;
  }
});

function frame(): void {
  world.refreshBounds();
  hud.sync(rig);
  stage.render();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
