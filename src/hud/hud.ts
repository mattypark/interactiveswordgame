import type { PrimitiveKind } from '../scene/clay.js';
import type { LinkState, Rig, ToolMode } from '../state/rig.js';

export type HudAction =
  | { type: 'mode'; mode: ToolMode }
  | { type: 'spawn'; kind: PrimitiveKind }
  | { type: 'delete' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'physics' }
  | { type: 'mirror' }
  | { type: 'invert-depth' }
  | { type: 'swap-hands' }
  | { type: 'set-origin' }
  | { type: 'toggle-view' }
  | { type: 'setup'; action: 'start' | 'skip' }
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
    depthLine: el('depth-line'),
    hitsLine: el('hits-line'),
    lastHitLine: el('last-hit-line'),
    setupLine: el('setup-line'),
    handsLegend: el('hands-legend'),
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
    setupOverlay: el('setup-overlay'),
    setupStep: el('setup-step'),
    setupPrompt: el('setup-prompt'),
    setupProgress: el('setup-progress'),
    setupSkip: el<HTMLButtonElement>('setup-skip'),
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

    this.nodes.setupSkip.addEventListener('click', () => {
      this.emit({ type: 'setup', action: 'skip' });
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
      } else if (event.key === 'm' || event.key === 'M') {
        this.emit({ type: 'mirror' });
      } else if (event.key === 'd' || event.key === 'D') {
        this.emit({ type: 'invert-depth' });
      } else if (event.key === 'h' || event.key === 'H') {
        this.emit({ type: 'swap-hands' });
      } else if (event.key === 'r' || event.key === 'R') {
        this.emit({ type: 'set-origin' });
      } else if (event.key === 'v' || event.key === 'V') {
        this.emit({ type: 'toggle-view' });
      } else if (event.key === 'c' || event.key === 'C') {
        this.emit({ type: 'setup', action: 'start' });
      } else if (event.key === 'Escape') {
        this.emit({ type: 'setup', action: 'skip' });
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

    // Depth in centimetres, plus which way it needs to move to come back into
    // range — losing tracking at the edge otherwise looks like a crash.
    const depthText =
      rig.depth === null
        ? 'depth: -'
        : `depth: ${Math.round(rig.depth * 100)}cm${rig.depthInRange ? '' : ' out of range'}`;
    this.write('depth', nodes.depthLine, depthText);
    if (this.previous.get('depthClass') !== String(rig.depthInRange)) {
      this.previous.set('depthClass', String(rig.depthInRange));
      nodes.depthLine.className = rig.depthInRange ? '' : 'warn';
    }

    // One line for every "depends on your setup" toggle, with its key.
    this.write(
      'setup',
      nodes.setupLine,
      `M mirror ${rig.mirror ? 'on' : 'off'} · D ${rig.invertDepth ? 'push' : 'literal'} · ` +
        `H hands ${rig.swapHands ? 'swapped' : 'normal'} · ` +
        `R ${rig.originSet ? 'spawn set' : 'set spawn'} · V ${rig.view}-person · C recalibrate`,
    );

    this.write('hits', nodes.hitsLine, `hits: ${rig.hits}`);
    this.write(
      'lastHit',
      nodes.lastHitLine,
      rig.lastHitSpeed === null ? 'last: -' : `last: ${rig.lastHitSpeed.toFixed(1)} m/s`,
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

  /** Hide the whole in-game HUD while a menu is up. */
  setVisible(visible: boolean): void {
    for (const panel of document.querySelectorAll<HTMLElement>('.panel, .btn--spawn')) {
      panel.hidden = !visible;
    }
  }

  /** The editor toolbar only means anything in the sandbox. */
  setToolbarVisible(visible: boolean): void {
    const toolbar = document.querySelector<HTMLElement>('.panel--toolbar');
    if (toolbar) toolbar.dataset.mapHidden = visible ? '' : 'true';
    const spawn = document.querySelector<HTMLElement>('.btn--spawn');
    if (spawn) spawn.dataset.mapHidden = visible ? '' : 'true';
  }

  /** Drive the guided setup overlay. Pass null to hide it. */
  setSetup(state: { step: string; prompt: string; progress: number } | null): void {
    const { nodes } = this;
    const hidden = state === null;
    if (nodes.setupOverlay.hidden !== hidden) nodes.setupOverlay.hidden = hidden;
    if (!state) return;

    this.write('setupStep', nodes.setupStep, state.step);
    this.write('setupPrompt', nodes.setupPrompt, state.prompt);

    const percent = Math.round(state.progress * 100);
    if (this.previous.get('setupProgress') !== String(percent)) {
      this.previous.set('setupProgress', String(percent));
      nodes.setupProgress.style.width = `${percent}%`;
    }
  }

  /** Show a failure the user can act on, or clear it with null. */
  setNotice(text: string | null): void {
    if (this.previous.get('notice') === (text ?? '')) return;
    this.previous.set('notice', text ?? '');
    this.nodes.notice.textContent = text ?? '';
    this.nodes.notice.hidden = text === null;
  }
}
