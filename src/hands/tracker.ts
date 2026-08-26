import type { HandLandmarker, HandLandmarkerResult } from '@mediapipe/tasks-vision';

/**
 * MediaPipe hand tracking, served entirely from public/ — the WASM and the
 * 7.8MB model are bundled, so there is no CDN call at runtime and the app
 * keeps working offline after first load.
 */

const WASM_URL = '/wasm';
const MODEL_URL = '/models/hand_landmarker.task';

export async function createHandTracker(): Promise<HandLandmarker> {
  const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);

  return HandLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

export type { HandLandmarkerResult };
