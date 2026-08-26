import * as THREE from 'three';

/**
 * The floor from the reference build: a dark plane with a fine grid, a
 * heavier grid every 5 cells, one bright axis line running to the horizon,
 * and a distance fade so it reads as infinite rather than as a big square.
 *
 * Drawn as a shader rather than GridHelper because GridHelper's fixed-width
 * lines alias badly at grazing angles — which is the angle this camera lives at.
 */

const FINE = 0.05; // metres between fine lines
const COARSE = 0.25; // metres between heavy lines
const EXTENT = 24; // half-size of the plane, metres
const FADE_START = 0.8;
const FADE_END = 9.0;

const VERTEX = /* glsl */ `
  varying vec3 vWorld;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;

  varying vec3 vWorld;

  uniform vec3 uFine;
  uniform vec3 uCoarse;
  uniform vec3 uAxis;
  uniform float uFineSize;
  uniform float uCoarseSize;
  uniform float uFadeStart;
  uniform float uFadeEnd;

  // Screen-space-antialiased grid: 1.0 on a line, 0.0 between lines.
  float gridMask(vec2 pos, float size) {
    vec2 coord = pos / size;
    vec2 grid = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
    return 1.0 - min(min(grid.x, grid.y), 1.0);
  }

  // Same idea for a single line at x == 0.
  float axisMask(float x) {
    float w = fwidth(x);
    return 1.0 - smoothstep(0.0, w * 1.4, abs(x));
  }

  void main() {
    vec2 pos = vWorld.xz;

    float fine = gridMask(pos, uFineSize);
    float coarse = gridMask(pos, uCoarseSize);
    float axis = axisMask(vWorld.x);

    vec3 color = uFine * fine;
    color = mix(color, uCoarse, coarse * 0.85);
    color = mix(color, uAxis, axis * 0.9);

    float alpha = max(max(fine * 0.55, coarse * 0.78), axis * 0.9);

    float dist = length(pos);
    alpha *= 1.0 - smoothstep(uFadeStart, uFadeEnd, dist);

    if (alpha < 0.002) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

export function createGrid(): THREE.Group {
  const group = new THREE.Group();

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uFine: { value: new THREE.Color(0x8b93b0) },
      uCoarse: { value: new THREE.Color(0xb9c1da) },
      uAxis: { value: new THREE.Color(0xf2f5ff) },
      uFineSize: { value: FINE },
      uCoarseSize: { value: COARSE },
      uFadeStart: { value: FADE_START },
      uFadeEnd: { value: FADE_END },
    },
  });

  const grid = new THREE.Mesh(new THREE.PlaneGeometry(EXTENT * 2, EXTENT * 2), material);
  grid.rotation.x = -Math.PI / 2;
  grid.renderOrder = -1;
  group.add(grid);

  // Separate plane purely to catch shadows — a ShaderMaterial can't.
  const shadowCatcher = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6),
    new THREE.ShadowMaterial({ opacity: 0.32 }),
  );
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.y = 0.0005;
  shadowCatcher.receiveShadow = true;
  group.add(shadowCatcher);

  return group;
}
