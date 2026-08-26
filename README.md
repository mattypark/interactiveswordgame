# interactive sword game

A browser game you play with your hands. A webcam watches you, your hand shows up in the
scene as a 3D skeleton, and closing your fist around a block picks it up. Swords come later —
right now the job is making "reach out and grab that thing" feel real.

Built after a demo seen at a YC hackathon. That build used **two** cameras for stereo depth and
a real **EMG armband** for grip force. This one does it with a single laptop webcam and no extra
hardware:

- **Depth from one camera** — MediaPipe's `worldLandmarks` are metric, so the apparent pixel size
  of a known hand bone solves absolute distance through a pinhole model.
- **Grip from vision** — finger curl drives the force bar, calibrated to *your* hand's open and
  closed range. Labelled `grip` / `vision linked`, not `EMG`, because there is no armband.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
```

Allow camera access when the browser asks. `localhost` counts as a secure context, so
`getUserMedia` works in dev without HTTPS; a deployed build needs HTTPS.

```bash
npm run build    # typecheck + production bundle
npm test         # unit tests over the projection / grip / grab math (no camera needed)
```

## Stack

Vanilla TypeScript, Vite, Three.js, MediaPipe Tasks-Vision. No framework — this is one canvas
and a DOM overlay, and a 60fps tracking loop is happier without a render tree in the way.

The MediaPipe WASM and the 7.8MB hand model are served from `public/`, so there is no CDN call
at runtime and the app works offline after first load.

## Stages

| # | Stage | State |
|---|-------|-------|
| 1 | Scaffold, grid scene, orbit camera, full HUD chrome | done |
| 2 | Webcam + MediaPipe tracking, live status readouts | done |
| 3 | 3D hand skeleton in world space | done |
| 4 | Grab: grip meter, calibration, pick up and move a block | done |
| 5 | Toolbar wiring: modes, primitives, undo/redo | |
| 6 | Rapier physics: blocks fall, stack and get thrown | |

## Calibrating

The force bar reads your own hand's range, and reach ratios vary between
hands, so calibrate once per session:

1. Hold your hand open in frame, press **1. Calibrate rest**.
2. Make a fist, press **2. Calibrate max**.

It samples about twenty frames per step and takes the median, so one bad frame
can't skew it. If the two poses come out too close together it says so rather
than quietly keeping a mapping that won't work. Until you calibrate, a default
range for an adult hand is used.

Squeeze past 60% to grab, relax below 40% to let go — the gap is deliberate,
so a grip hovering near the threshold doesn't drop what you're carrying.
