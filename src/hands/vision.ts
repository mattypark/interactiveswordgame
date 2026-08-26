import type { HandLandmarker, HandLandmarkerResult } from '@mediapipe/tasks-vision';

import { startCamera, CameraError, type CameraFeed } from './camera.js';
import { createHandTracker } from './tracker.js';
import { rig } from '../state/rig.js';

/**
 * Owns the camera and the landmarker, and pumps one detection per new video
 * frame. Everything downstream reads `latest` — this class never touches the
 * scene, so tracking failures can't take rendering down with them.
 */
export class Vision {
  latest: HandLandmarkerResult | null = null;

  /** Set when start() fails, so the HUD can say why rather than just 'failed'. */
  error: string | null = null;

  private feed: CameraFeed | null = null;
  private tracker: HandLandmarker | null = null;
  private lastVideoTime = -1;

  get frameSize(): { width: number; height: number } | null {
    return this.feed ? { width: this.feed.width, height: this.feed.height } : null;
  }

  async start(video: HTMLVideoElement): Promise<void> {
    rig.camera = 'connecting';
    try {
      this.feed = await startCamera(video);
      rig.camera = 'connected';
      rig.sources = 1;
    } catch (error) {
      rig.camera = 'error';
      this.error =
        error instanceof CameraError ? error.message : `Camera failed: ${String(error)}`;
      // Without a camera there is nothing for the landmarker to read.
      rig.vision = 'error';
      rig.grip = 'error';
      return;
    }

    rig.vision = 'connecting';
    try {
      this.tracker = await createHandTracker();
      rig.vision = 'connected';
      rig.grip = 'connected';
    } catch (error) {
      rig.vision = 'error';
      rig.grip = 'error';
      this.error = `Hand model failed to load: ${String(error)}`;
    }
  }

  /**
   * Run detection if the camera has produced a new frame since last call.
   * Cheap no-op otherwise — the camera runs at 30fps and the loop at 60.
   */
  update(): void {
    const { feed, tracker } = this;
    if (!feed || !tracker) return;

    const { video } = feed;
    if (video.readyState < 2 || video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = video.currentTime;

    rig.frames += 1;

    try {
      const result = tracker.detectForVideo(video, performance.now());
      this.latest = result;
      rig.hands = result.landmarks.length;
      if (result.landmarks.length > 0) rig.rx += 1;
    } catch (error) {
      // A single bad frame shouldn't kill tracking; surface it and carry on.
      rig.vision = 'error';
      this.error = `Detection failed: ${String(error)}`;
    }
  }

  stop(): void {
    this.feed?.stop();
    this.tracker?.close();
    this.feed = null;
    this.tracker = null;
  }
}
