import * as THREE from 'three';

/**
 * The maps you can play on. Each one owns its scenery and its lighting mood;
 * the tracking rig, HUD and play volume are shared and don't care which is up.
 */

export type MapMode = 'sandbox' | 'fight';

export interface MapDefinition {
  id: string;
  name: string;
  tagline: string;
  mode: MapMode;
  /** Background and fog, so each map reads differently the moment it loads. */
  background: number;
  fog: { near: number; far: number };
  /** Grid line colours: fine, heavy, and the axis line. */
  grid: { fine: number; coarse: number; axis: number };
  lights: { hemiSky: number; hemiGround: number; key: number; fill: number };
  /** Extra scenery, built once when the map loads. */
  build?(): THREE.Object3D;
}

/** A ring of columns, for the dojo. */
function dojoScenery(): THREE.Object3D {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.82 });
  const paper = new THREE.MeshStandardMaterial({
    color: 0xd8cbb0,
    roughness: 0.95,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
  });

  // Four posts and a back screen — enough to say "room" without boxing you in.
  for (const x of [-1.1, 1.1]) {
    for (const z of [-1.1, 0.9]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.9, 0.07), wood);
      post.position.set(x, 0.95, z);
      post.castShadow = true;
      group.add(post);
    }
  }

  const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.5), paper);
  screen.position.set(0, 0.85, -1.14);
  group.add(screen);

  const beam = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.08, 0.08), wood);
  beam.position.set(0, 1.86, -1.1);
  group.add(beam);

  return group;
}

/** A parapet and a skyline, for the rooftop. */
function rooftopScenery(): THREE.Object3D {
  const group = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: 0x3a3f4d, roughness: 0.95 });
  const distant = new THREE.MeshStandardMaterial({ color: 0x191d2b, roughness: 1 });

  // Low wall around the edge of the roof.
  for (const [x, z, w, d] of [
    [0, -1.5, 3.4, 0.14],
    [0, 1.5, 3.4, 0.14],
    [-1.7, 0, 0.14, 3.14],
    [1.7, 0, 0.14, 3.14],
  ] as const) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 0.34, d), concrete);
    wall.position.set(x, 0.17, z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
  }

  // Towers in the middle distance. Deterministic heights — a random skyline
  // that reshuffles on every load is distracting rather than atmospheric.
  const heights = [1.4, 2.6, 1.9, 3.4, 2.1, 2.8, 1.6, 3.0, 2.3, 1.7];
  heights.forEach((height, index) => {
    const tower = new THREE.Mesh(new THREE.BoxGeometry(0.5, height, 0.5), distant);
    const angle = (index / heights.length) * Math.PI * 2;
    tower.position.set(Math.sin(angle) * 4.6, height / 2 - 0.6, Math.cos(angle) * 4.6);
    group.add(tower);
  });

  return group;
}

/** Nothing but the grid, for the void. */
function voidScenery(): THREE.Object3D {
  const group = new THREE.Group();
  const glow = new THREE.PointLight(0x7c5cff, 3.2, 6, 2);
  glow.position.set(0, 1.4, -0.6);
  group.add(glow);
  return group;
}

export const MAPS: readonly MapDefinition[] = [
  {
    id: 'dojo',
    name: 'Dojo',
    tagline: 'Paper screens and lantern light. Where you learn the straight punch.',
    mode: 'fight',
    background: 0x1a1410,
    fog: { near: 3.4, far: 11 },
    grid: { fine: 0xa08a6a, coarse: 0xd8c39a, axis: 0xfff0d8 },
    lights: { hemiSky: 0xffd9a0, hemiGround: 0x2a1f16, key: 0xfff0d0, fill: 0xffb066 },
    build: dojoScenery,
  },
  {
    id: 'rooftop',
    name: 'Rooftop',
    tagline: 'Cold air, long drop, city humming underneath.',
    mode: 'fight',
    background: 0x0e1220,
    fog: { near: 3.8, far: 13 },
    grid: { fine: 0x6f7fa8, coarse: 0x9fb4e0, axis: 0xdce8ff },
    lights: { hemiSky: 0x8fb0ff, hemiGround: 0x141824, key: 0xdfe8ff, fill: 0x4a6cff },
    build: rooftopScenery,
  },
  {
    id: 'void',
    name: 'The Void',
    tagline: 'No walls, no floor to speak of. Just you and whatever finds you.',
    mode: 'fight',
    background: 0x07060d,
    fog: { near: 2.6, far: 8 },
    grid: { fine: 0x5b4a9a, coarse: 0x8b78e0, axis: 0xd8ccff },
    lights: { hemiSky: 0x9a7cff, hemiGround: 0x0a0812, key: 0xc9b8ff, fill: 0x6a3cff },
    build: voidScenery,
  },
  {
    id: 'sandbox',
    name: 'Sandbox',
    tagline: 'Blocks, a training dummy and no one to fight. Where you check the tracking.',
    mode: 'sandbox',
    background: 0x12131c,
    fog: { near: 3.2, far: 9 },
    grid: { fine: 0x8b93b0, coarse: 0xb9c1da, axis: 0xf2f5ff },
    lights: { hemiSky: 0x9fb0ff, hemiGround: 0x1a1b26, key: 0xfff2e0, fill: 0x7fa0ff },
  },
];

export function findMap(id: string): MapDefinition {
  return MAPS.find((map) => map.id === id) ?? MAPS[0]!;
}
