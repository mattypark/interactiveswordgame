import type { PrimitiveKind } from '../scene/clay.js';
import type { LinkState, Rig, ToolMode } from '../state/rig.js';

export type HudAction =
  | { type: 'mode'; mode: ToolMode }
  | { type: 'spawn'; kind: PrimitiveKind }
  | { type: 'delete' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'physics' }
  | { type: 'calibrate'; step: 'rest' | 'max' | 'reset' };

type HudHandler = (action: HudAction) => void;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`HUD element #${id} missing from index.html`);
  return node as T;
}

/** Status dot classes, keyed by link state. */
const DOT_CLASS: Record<LinkState, string> = {
  idle: '',
  connecting: '',
  connected: 'is-ok',
  error: 'is-warn',
};

const DOT_TEXT: Record<LinkState, string> = {
  idle: 'idle',
  connecting: 'starting',
  connected: 'connected',
  error: 'failed',
};

export class Hud {
  private readonly handlers = new Set<HudHandler>();

  private readonly nodes = {
    mode: el('mode-label'),
    link: el('link-label'),
    forceFill: el('force-fill'),
    forceLabel: el('force-label'),
    calibFlag: el('calib-flag'),
    calibState: el('calib-state'),
    calibDetail: el('calib-detail'),
    hitLine: el('hit-line'),
    frames: el('st-frames'),
    hands: el('st-hands'),
    video: el('st-video'),
    camera: el('st-camera'),
    vision: el('st-vision'),
    grip: el('st-grip'),
    dotCamera: el('dot-camera'),
    dotVision: el('dot-vision'),
    dotGrip: el('dot-grip'),
    pipLabel: el('pip-label'),
    notice: el('notice'),
    pipVideo: el<HTMLVideoElement>('pip-video'),
  };

  /** Last rendered strings, so we only touch the DOM when something changed. */
  private previous = new Map<string, string>();

  constructor() {
    this.bindButtons();
    this.bindKeys();
  }

  get pipVideo(): HTMLVideoElement {
    return this.nodes.pipVideo;
  }

  on(handler: HudHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private emit(action: HudAction): void {
    for (const handler of this.handlers) handler(action);
  }

  private bindButtons(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        this.emit({ type: 'mode', mode: button.dataset.mode as ToolMode });
      });
    });

    document.querySelectorAll<HTMLButtonElement>('[data-spawn]').forEach((button) => {
      button.addEventListener('click', () => {
        this.emit({ type: 'spawn', kind: button.dataset.spawn as PrimitiveKind });
      });
    });

    document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.action;
        if (action === 'delete') this.emit({ type: 'delete' });
        else if (action === 'undo') this.emit({ type: 'undo' });
        else if (action === 'redo') this.emit({ type: 'redo' });
        else if (action === 'physics') this.emit({ type: 'physics' });
      });
    });

    document.querySelectorAll<HTMLButtonElement>('[data-calib]').forEach((button) => {
      button.addEventListener('click', () => {
        this.emit({
          type: 'calibrate',
          step: button.dataset.calib as 'rest' | 'max' | 'reset',
        });
      });
    });
  }

  private bindKeys(): void {
    window.addEventListener('keydown', (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      if (event.key === 's' || event.key === 'S') {
        this.emit({ type: 'spawn', kind: 'clay' });
      } else if (event.key === 'Backspace' || event.key === 'Delete') {
        this.emit({ type: 'delete' });
      }
    });
  }

  setActiveMode(mode: ToolMode): void {
    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.mode === mode);
    });
  }

  /** Writes `text` into `node` only when it differs from last frame. */
  private write(key: string, node: HTMLElement, text: string): void {
    if (this.previous.get(key) === text) return;
    this.previous.set(key, text);
    node.textContent = text;
  }

  private writeDot(key: string, dot: HTMLElement, label: HTMLElement, state: LinkState): void {
    if (this.previous.get(key) === state) return;
    this.previous.set(key, state);
    dot.className = `dot ${DOT_CLASS[state]}`.trim();
    label.textContent = DOT_TEXT[state];
  }

  sync(rig: Rig): void {
    const { nodes } = this;

    this.write('mode', nodes.mode, rig.mode.toUpperCase());
    this.write('link', nodes.link, rig.vision === 'connected' ? 'vision linked' : 'vision offline');

    const percent = Math.round(rig.force * 100);
    this.write('forceLabel', nodes.forceLabel, `force ${percent}%`);
    if (this.previous.get('forceFill') !== String(percent)) {
      this.previous.set('forceFill', String(percent));
      nodes.forceFill.style.width = `${percent}%`;
    }

    const calibText = rig.calibrated ? 'calibrated' : 'not calibrated';
    this.write('calibFlag', nodes.calibFlag, calibText);
    if (this.previous.get('calibFlagClass') !== calibText) {
      this.previous.set('calibFlagClass', calibText);
      nodes.calibFlag.className = rig.calibrated ? 'ok' : 'warn';
      nodes.calibDetail.className = rig.calibrated ? 'ok' : 'warn';
      nodes.calibDetail.textContent = rig.calibrated ? 'Calibrated' : 'Not calibrated';
    }

    this.write(
      'hit',
      nodes.hitLine,
      `hit: ${rig.hit ? 'yes' : 'no'} · target: ${rig.target ?? '-'} · held: ${rig.held ?? '-'}`,
    );

    this.write('frames', nodes.frames, `frames: ${rig.frames}`);
    this.write('hands', nodes.hands, `hands: ${rig.hands}`);
    this.write('video', nodes.video, `video: rx ${rig.rx} src ${rig.sources}`);

    this.writeDot('dotCamera', nodes.dotCamera, nodes.camera, rig.camera);
    this.writeDot('dotVision', nodes.dotVision, nodes.vision, rig.vision);
    this.writeDot('dotGrip', nodes.dotGrip, nodes.grip, rig.grip);

    this.write('pip', nodes.pipLabel, DOT_TEXT[rig.camera]);
  }

  setCalibrationState(text: string): void {
    this.nodes.calibState.textContent = text;
  }

  /** Show a failure the user can act on, or clear it with null. */
  setNotice(text: string | null): void {
    if (this.previous.get('notice') === (text ?? '')) return;
    this.previous.set('notice', text ?? '');
    this.nodes.notice.textContent = text ?? '';
    this.nodes.notice.hidden = text === null;
  }
}
