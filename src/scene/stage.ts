import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  render(): void;
}

const BACKGROUND = 0x12131c;

/** Metres. The reference sits the viewer just above and behind the play volume. */
const CAMERA_START = new THREE.Vector3(0, 0.62, 1.05);
const CAMERA_TARGET = new THREE.Vector3(0, 0.16, 0);

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

  const camera = new THREE.PerspectiveCamera(46, 1, 0.01, 100);
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

  scene.add(new THREE.HemisphereLight(0x9fb0ff, 0x1a1b26, 1.15));

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

  return {
    renderer,
    scene,
    camera,
    controls,
    render() {
      controls.update();
      renderer.render(scene, camera);
    },
  };
}
