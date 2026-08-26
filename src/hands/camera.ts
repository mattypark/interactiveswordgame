/**
 * Webcam capture. Kept separate from tracking so a permission failure can be
 * reported to the HUD without taking the render loop down with it.
 */

export interface CameraFeed {
  video: HTMLVideoElement;
  width: number;
  height: number;
  stop(): void;
}

/** Request the largest sensible frame — depth accuracy scales with pixel size. */
const CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    facingMode: 'user',
  },
};

export class CameraError extends Error {
  constructor(
    message: string,
    readonly reason: 'denied' | 'missing' | 'unsupported' | 'unknown',
  ) {
    super(message);
    this.name = 'CameraError';
  }
}

function classify(error: unknown): CameraError {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new CameraError('Camera permission was denied.', 'denied');
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new CameraError('No camera matching the requested settings.', 'missing');
  }
  return new CameraError(error instanceof Error ? error.message : String(error), 'unknown');
}

export async function startCamera(video: HTMLVideoElement): Promise<CameraFeed> {
  if (!navigator.mediaDevices?.getUserMedia) {
    // getUserMedia only exists in a secure context: https, or localhost.
    throw new CameraError(
      'getUserMedia is unavailable — serve this over https or localhost.',
      'unsupported',
    );
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
  } catch (error) {
    throw classify(error);
  }

  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;

  await new Promise<void>((resolve, reject) => {
    const onReady = (): void => {
      video.removeEventListener('loadedmetadata', onReady);
      resolve();
    };
    video.addEventListener('loadedmetadata', onReady, { once: true });
    video.addEventListener(
      'error',
      () => reject(new CameraError('Video element failed to load the stream.', 'unknown')),
      { once: true },
    );
  });

  await video.play();

  return {
    video,
    width: video.videoWidth,
    height: video.videoHeight,
    stop() {
      for (const track of stream.getTracks()) track.stop();
      video.srcObject = null;
    },
  };
}
