import * as THREE from 'three';

export type PrimitiveKind = 'clay' | 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus';

export interface ClayObject {
  id: string;
  kind: PrimitiveKind;
  mesh: THREE.Mesh;
  /** World-space AABB, refreshed each frame for hover/grab tests. */
  bounds: THREE.Box3;
}

/** Metres. Sized so a real hand comfortably closes around it on screen. */
const UNIT = 0.09;

const CLAY_COLOR = 0xd9a06c;

function geometryFor(kind: PrimitiveKind): THREE.BufferGeometry {
  switch (kind) {
    case 'sphere':
      return new THREE.SphereGeometry(UNIT * 0.58, 32, 24);
    case 'cylinder':
      return new THREE.CylinderGeometry(UNIT * 0.5, UNIT * 0.5, UNIT, 32);
    case 'cone':
      return new THREE.ConeGeometry(UNIT * 0.58, UNIT * 1.1, 32);
    case 'torus':
      return new THREE.TorusGeometry(UNIT * 0.44, UNIT * 0.18, 20, 48);
    case 'clay':
    case 'box':
    default:
      return new THREE.BoxGeometry(UNIT, UNIT, UNIT);
  }
}

export class ClayWorld {
  readonly group = new THREE.Group();
  readonly objects: ClayObject[] = [];

  private nextId = 1;
  private readonly material = new THREE.MeshStandardMaterial({
    color: CLAY_COLOR,
    roughness: 0.86,
    metalness: 0.02,
    flatShading: false,
  });

  spawn(kind: PrimitiveKind, position?: THREE.Vector3): ClayObject {
    const mesh = new THREE.Mesh(geometryFor(kind), this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Rest on the grid unless told otherwise; a little scatter so repeated
    // spawns don't stack invisibly on one another.
    const drop =
      position ??
      new THREE.Vector3((Math.random() - 0.5) * 0.24, UNIT * 0.5, (Math.random() - 0.5) * 0.18);
    mesh.position.copy(drop);

    const id = `${kind}-${this.nextId++}`;
    mesh.name = id;

    const object: ClayObject = { id, kind, mesh, bounds: new THREE.Box3() };
    object.bounds.setFromObject(mesh);

    this.objects.push(object);
    this.group.add(mesh);
    return object;
  }

  /**
   * Re-create a removed object under its original id, so undo restores the
   * thing you deleted rather than a lookalike with a new name.
   */
  restore(id: string, kind: PrimitiveKind): ClayObject {
    const object = this.spawn(kind);
    this.group.remove(object.mesh);
    this.objects.pop();

    object.mesh.name = id;
    const restored: ClayObject = { ...object, id };
    this.objects.push(restored);
    this.group.add(restored.mesh);
    return restored;
  }

  remove(id: string): ClayObject | null {
    const index = this.objects.findIndex((object) => object.id === id);
    if (index === -1) return null;

    const [object] = this.objects.splice(index, 1);
    if (!object) return null;

    this.group.remove(object.mesh);
    object.mesh.geometry.dispose();
    return object;
  }

  find(id: string): ClayObject | undefined {
    return this.objects.find((object) => object.id === id);
  }

  /** Call once per frame before hover/grab tests. */
  refreshBounds(): void {
    for (const object of this.objects) {
      object.bounds.setFromObject(object.mesh);
    }
  }

  dispose(): void {
    for (const object of this.objects) object.mesh.geometry.dispose();
    this.objects.length = 0;
    this.material.dispose();
  }
}
