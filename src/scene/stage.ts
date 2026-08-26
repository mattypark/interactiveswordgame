import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import type { PlayVolume } from '../hands/project.js';
import type { MapDefinition } from '../maps/registry.js';

export type ViewMode = 'third' | 'first';

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  view: ViewMode;
  /** Move the camera between watching the box and standing in it. */
  setView(mode: ViewMode, volume: PlayVolume): void;
  /** Repaint the background, fog and lights for a map. */
  applyMap(map: MapDefinition): void;
  render(): void;
}

const BACKGROUND = 0x12131c;

/** Metres. The reference sits the viewer just above and behind the play volume. */
const CAMERA_START = new THREE.Vector3(0, 0.78, 1.55);
const CAMERA_TARGET = new THREE.Vector3(0, 0.2, 0);

const THIRD_FOV = 46;
/** Wider in first person — narrow feels like looking down a tube. */
const FIRST_FOV = 62;

/**
 * Where a head sits relative to the hand it's watching: a bit up and a bit
 * back. Putting the camera exactly at the hand would bury it inside the
 * skeleton.
 */
const EYE_ABOVE_HAND = 0.19;
const EYE_BEHIND_HAND = 0.34;

export function createStage(canvas: HTMLCanvasElement): Stage {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  scene.fog = new THREE.Fog(BACKGROUND, 3.2, 9);

  const camera = new THREE.PerspectiveCamera(THIRD_FOV, 1, 0.01, 100);
  camera.position.copy(CAMERA_START);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(CAMERA_TARGET);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = 0.35;
  controls.maxDistance = 5;
  // Stop the orbit dipping under the grid — the reference never shows its underside.
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.update();

  const hemi = new THREE.HemisphereLight(0x9fb0ff, 0x1a1b26, 1.15);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xfff2e0, 1.35);
  key.position.set(1.4, 2.4, 1.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 8;
  const shadowCam = key.shadow.camera;
  shadowCam.left = -1.5;
  shadowCam.right = 1.5;
  shadowCam.top = 1.5;
  shadowCam.bottom = -1.5;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x7fa0ff, 0.35);
  fill.position.set(-1.6, 1.1, -1.4);
  scene.add(fill);

  function resize(): void {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  resize();
  window.addEventListener('resize', resize);

  let view: ViewMode = 'third';

  const stage: Stage = {
    renderer,
    scene,
    camera,
    controls,
    get view() {
      return view;
    },
    applyMap(map) {
      (scene.background as THREE.Color).setHex(map.background);
      const fog = scene.fog as THREE.Fog;
      fog.color.setHex(map.background);
      fog.near = map.fog.near;
      fog.far = map.fog.far;

      hemi.color.setHex(map.lights.hemiSky);
      hemi.groundColor.setHex(map.lights.hemiGround);
      key.color.setHex(map.lights.key);
      fill.color.setHex(map.lights.fill);
    },
    setView(mode, volume) {
      view = mode;

      if (mode === 'first') {
        // Stand where the player stands: just behind and above their hand,
        // looking down the length of the box.
        camera.fov = FIRST_FOV;
        // Measured from the middle of the box, not its near face: the hand
        // spends most of its time near the centre, and that is what should be
        // an arm's length in front of you.
        camera.position.set(
          volume.centre.x,
          volume.centre.y + EYE_ABOVE_HAND,
          volume.centre.z + EYE_BEHIND_HAND,
        );
        controls.target.set(
          volume.centre.x,
          volume.centre.y - 0.04,
          volume.centre.z - volume.size.z / 2,
        );
        // Orbiting would walk the camera off the player's head.
        controls.enabled = false;
      } else {
        camera.fov = THIRD_FOV;
        camera.position.copy(CAMERA_START);
        controls.target.copy(CAMERA_TARGET);
        controls.enabled = true;
      }

      camera.updateProjectionMatrix();
      controls.update();
    },
    render() {
      if (controls.enabled) controls.update();
      renderer.render(scene, camera);
    },
  };

  return stage;
}
