/**
 * Undo/redo as a command stack.
 *
 * Commands hold full before/after snapshots rather than deltas. Snapshots are
 * bulkier, but a hand-driven transform produces a continuous stream of tiny
 * changes and accumulating those as deltas drifts. A snapshot restores exactly.
 *
 * Pure — it talks to the scene through the HistoryTarget interface, so the
 * stack logic is testable without three.js.
 */

export interface Transform {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: [number, number, number];
}

export interface ObjectSnapshot {
  id: string;
  kind: string;
  transform: Transform;
}

export type Command =
  | { type: 'spawn'; snapshot: ObjectSnapshot }
  | { type: 'delete'; snapshot: ObjectSnapshot }
  | { type: 'transform'; id: string; before: Transform; after: Transform };

export interface HistoryTarget {
  /** Re-create a previously removed object, keeping its id. */
  create(snapshot: ObjectSnapshot): void;
  destroy(id: string): void;
  setTransform(id: string, transform: Transform): void;
}

/** Deep enough — Transform is three flat arrays. */
export function cloneTransform(transform: Transform): Transform {
  return {
    position: [...transform.position],
    quaternion: [...transform.quaternion],
    scale: [...transform.scale],
  };
}

export function transformsEqual(a: Transform, b: Transform, epsilon = 1e-6): boolean {
  const same = (x: readonly number[], y: readonly number[]): boolean =>
    x.length === y.length && x.every((value, index) => Math.abs(value - y[index]!) <= epsilon);
  return (
    same(a.position, b.position) && same(a.quaternion, b.quaternion) && same(a.scale, b.scale)
  );
}

/** Plenty for a session, and bounded so a long play doesn't grow without limit. */
export const HISTORY_LIMIT = 100;

export class History {
  private readonly done: Command[] = [];
  private readonly undone: Command[] = [];

  constructor(private readonly target: HistoryTarget) {}

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  get depth(): number {
    return this.done.length;
  }

  push(command: Command): void {
    // A no-op transform would make undo appear to do nothing.
    if (command.type === 'transform' && transformsEqual(command.before, command.after)) return;

    this.done.push(command);
    if (this.done.length > HISTORY_LIMIT) this.done.shift();
    // Any new action abandons the redo branch, as every editor does.
    this.undone.length = 0;
  }

  undo(): Command | null {
    const command = this.done.pop();
    if (!command) return null;

    switch (command.type) {
      case 'spawn':
        this.target.destroy(command.snapshot.id);
        break;
      case 'delete':
        this.target.create(command.snapshot);
        break;
      case 'transform':
        this.target.setTransform(command.id, command.before);
        break;
    }

    this.undone.push(command);
    return command;
  }

  redo(): Command | null {
    const command = this.undone.pop();
    if (!command) return null;

    switch (command.type) {
      case 'spawn':
        this.target.create(command.snapshot);
        break;
      case 'delete':
        this.target.destroy(command.snapshot.id);
        break;
      case 'transform':
        this.target.setTransform(command.id, command.after);
        break;
    }

    this.done.push(command);
    return command;
  }

  clear(): void {
    this.done.length = 0;
    this.undone.length = 0;
  }
}
