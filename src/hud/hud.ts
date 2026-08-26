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
  | { type: 'setup'; action: 'start' | 'skip' | 'capture' }
  | { type: 'calibrate'; step: 'rest' | 'max' | 'reset' };

type HudHandler = (action: HudAction) => void;

/** Round pips drawn per fighter — matches ROUNDS_TO_WIN in match.ts. */
const ROUNDS_SHOWN = 2;

/** Reach ratios the calibration gauge spans, fist to open. */
const GAUGE_LOW = 0.95;
const GAUGE_HIGH = 2.05;

function gaugePercent(ratio: number): number {
  return Math.max(0, Math.min(100, ((ratio - GAUGE_LOW) / (GAUGE_HIGH - GAUGE_LOW)) * 100));
}

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
    face: el('st-face'),
    dotCamera: el('dot-camera'),
    dotVision: el('dot-vision'),
    dotGrip: el('dot-grip'),
    dotFace: el('dot-face'),
    pipLabel: el('pip-label'),
    notice: el('notice'),
    setupOverlay: el('setup-overlay'),
    setupStep: el('setup-step'),
    setupPrompt: el('setup-prompt'),
    setupProgress: el('setup-progress'),
    setupSkip: el<HTMLButtonElement>('setup-skip'),
    setupCapture: el<HTMLButtonElement>('setup-capture'),
    setupReading: el('setup-reading'),
    setupZone: el('setup-zone'),
    setupMark: el('setup-mark'),
    setupNeedle: el('setup-needle'),
    fightHud: el('fight-hud'),
    fightYou: el('fight-you'),
    fightThem: el('fight-them'),
    fightRoundsYou: el('fight-rounds-you'),
    fightRoundsThem: el('fight-rounds-them'),
    fightClock: el('fight-clock'),
    fightRound: el('fight-round'),
    fightBanner: el('fight-banner'),
    fightBannerText: el('fight-banner-text'),
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

    this.nodes.setupCapture.addEventListener('click', () => {
      this.emit({ type: 'setup', action: 'capture' });
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
    const head = rig.headDepth === null ? '' : ` · head ${Math.round(rig.headDepth * 100)}cm`;
    const depthText =
      rig.depth === null
        ? `depth: -${head}`
        : `depth: ${Math.round(rig.depth * 100)}cm${rig.depthInRange ? '' : ' out'}${head}`;
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
    this.write('hands', nodes.hands, `hands: ${rig.hands} · faces: ${rig.faces}`);
    this.write('video', nodes.video, `video: rx ${rig.rx} src ${rig.sources}`);

    this.writeDot('dotCamera', nodes.dotCamera, nodes.camera, rig.camera);
    this.writeDot('dotVision', nodes.dotVision, nodes.vision, rig.vision);
    this.writeDot('dotGrip', nodes.dotGrip, nodes.grip, rig.grip);
    this.writeDot('dotFace', nodes.dotFace, nodes.face, rig.face);

    this.write('pip', nodes.pipLabel, DOT_TEXT[rig.camera]);
  }

  setCalibrationState(text: string): void {
    this.nodes.calibState.textContent = text;
  }

  /** Draw the scoreboard, or hide it outside a fight. */
  syncFight(fight: Rig['fight']): void {
    const { nodes } = this;
    const hidden = fight === null;
    if (nodes.fightHud.hidden !== hidden) nodes.fightHud.hidden = hidden;
    if (!fight) {
      if (!nodes.fightBanner.hidden) nodes.fightBanner.hidden = true;
      return;
    }

    this.writeWidth('fightYou', nodes.fightYou, fight.you);
    this.writeWidth('fightThem', nodes.fightThem, fight.them);

    const seconds = Math.ceil(fight.timeLeft);
    this.write('fightClock', nodes.fightClock, String(seconds));
    const low = seconds <= 10;
    if (this.previous.get('fightClockLow') !== String(low)) {
      this.previous.set('fightClockLow', String(low));
      nodes.fightClock.classList.toggle('is-low', low);
    }

    this.write('fightRound', nodes.fightRound, `Round ${fight.round}`);
    this.writePips('you', nodes.fightRoundsYou, fight.roundsYou);
    this.writePips('them', nodes.fightRoundsThem, fight.roundsThem);

    // One banner for the three moments worth interrupting for.
    const banner =
      fight.phase === 'over'
        ? fight.winner === 'you'
          ? 'YOU WIN'
          : 'YOU LOSE'
        : fight.phase === 'knockdown'
          ? fight.lastRoundWinner === null
            ? 'DRAW'
            : fight.lastRoundWinner === 'you'
              ? 'DOWN'
              : 'YOU ARE DOWN'
          : null;

    if (this.previous.get('banner') !== (banner ?? '')) {
      this.previous.set('banner', banner ?? '');
      nodes.fightBannerText.textContent = banner ?? '';
      nodes.fightBanner.hidden = banner === null;
    }
  }

  /** Needle at the current reading, band over what the step wants. */
  private drawGauge(
    reading: number | null,
    captured: number | null,
    zone: { from: number; to: number },
  ): void {
    const { nodes } = this;

    const from = gaugePercent(zone.from);
    const width = Math.max(0, gaugePercent(zone.to) - from);
    const key = `${from.toFixed(1)}:${width.toFixed(1)}`;
    if (this.previous.get('gaugeZone') !== key) {
      this.previous.set('gaugeZone', key);
      nodes.setupZone.style.left = `${from}%`;
      nodes.setupZone.style.width = `${width}%`;
    }

    if (reading !== null) {
      const needle = gaugePercent(reading).toFixed(1);
      if (this.previous.get('gaugeNeedle') !== needle) {
        this.previous.set('gaugeNeedle', needle);
        nodes.setupNeedle.style.left = `${needle}%`;
      }
    }

    const mark = captured === null ? null : gaugePercent(captured).toFixed(1);
    if (this.previous.get('gaugeMark') !== (mark ?? '')) {
      this.previous.set('gaugeMark', mark ?? '');
      nodes.setupMark.hidden = mark === null;
      if (mark !== null) nodes.setupMark.style.left = `${mark}%`;
    }
  }

  private writeWidth(key: string, node: HTMLElement, percent: number): void {
    const rounded = Math.round(percent);
    if (this.previous.get(key) === String(rounded)) return;
    this.previous.set(key, String(rounded));
    node.style.width = `${rounded}%`;
  }

  private writePips(key: string, node: HTMLElement, won: number): void {
    if (this.previous.get(`pips-${key}`) === String(won)) return;
    this.previous.set(`pips-${key}`, String(won));
    node.replaceChildren(
      ...Array.from({ length: ROUNDS_SHOWN }, (_, index) => {
        const pip = document.createElement('i');
        pip.className = index < won ? 'fight__pip fight__pip--won' : 'fight__pip';
        return pip;
      }),
    );
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
  setSetup(
    state: {
      step: string;
      prompt: string;
      progress: number;
      steadiness: number;
      reading: number | null;
      captured: number | null;
      /** Range of reach ratios this step is asking for. */
      zone: { from: number; to: number };
    } | null,
  ): void {
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

    // Showing the raw reach reading turns "why won't it take my fist" into
    // something you can see: open should read high, a fist low.
    this.drawGauge(state.reading, state.captured, state.zone);

    const reading =
      state.reading === null
        ? 'no hand in frame'
        : `reach ${state.reading.toFixed(2)}${
            state.captured === null ? '' : ` · open was ${state.captured.toFixed(2)}`
          }`;
    this.write('setupReading', nodes.setupReading, reading);

    const unsteady = state.steadiness < 0.45;
    if (this.previous.get('setupSteady') !== String(unsteady)) {
      this.previous.set('setupSteady', String(unsteady));
      nodes.setupProgress.classList.toggle('is-unsteady', unsteady);
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
