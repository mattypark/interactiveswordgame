import type { FaceDetector, Detection } from '@mediapipe/tasks-vision';

/**
 * Face detection, from the same local WASM the hands use.
 *
 * The short-range BlazeFace model, not the full landmarker: this only needs a
 * box and the eyes, and the landmarker's 478 points would cost far more per
 * frame for information nothing here uses.
 */

const WASM_URL = '/wasm';
const MODEL_URL = '/models/blaze_face_short_range.tflite';

export async function createFaceTracker(): Promise<FaceDetector> {
  const { FilesetResolver, FaceDetector } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);

  return FaceDetector.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    minDetectionConfidence: 0.5,
  });
}

export type { Detection };
