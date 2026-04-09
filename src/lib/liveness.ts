type PointLike = { x: number; y: number };

type LandmarksLike = {
  getLeftEye?: () => PointLike[];
  getRightEye?: () => PointLike[];
  getNose?: () => PointLike[];
};

type LivenessMetrics = {
  ear: number;
  noseRatio: number;
};

function distance(a: PointLike, b: PointLike) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function eyeAspectRatio(eye: PointLike[]) {
  if (eye.length < 6) return 0;

  const vertical = distance(eye[1], eye[5]) + distance(eye[2], eye[4]);
  const horizontal = Math.max(distance(eye[0], eye[3]), 1e-6);
  return vertical / (2 * horizontal);
}

export function extractLivenessMetrics(landmarks: LandmarksLike | null, box: { x: number; width: number }): LivenessMetrics | null {
  if (!landmarks || !box || box.width <= 0) return null;

  const leftEye = landmarks.getLeftEye?.() as PointLike[] | undefined;
  const rightEye = landmarks.getRightEye?.() as PointLike[] | undefined;
  const nose = landmarks.getNose?.() as PointLike[] | undefined;

  if (!leftEye || !rightEye || !nose || nose.length === 0) return null;

  const ear = (eyeAspectRatio(leftEye) + eyeAspectRatio(rightEye)) / 2;
  const noseTip = nose[Math.floor(nose.length / 2)];
  const noseRatio = (noseTip.x - box.x) / box.width;

  return { ear, noseRatio };
}

export class LivenessGate {
  private blinkDetected = false;
  private eyeWasOpen = false;
  private noseRatioMin = Infinity;
  private noseRatioMax = -Infinity;
  private startedAt = Date.now();

  reset() {
    this.blinkDetected = false;
    this.eyeWasOpen = false;
    this.noseRatioMin = Infinity;
    this.noseRatioMax = -Infinity;
    this.startedAt = Date.now();
  }

  update(metrics: LivenessMetrics) {
    if (metrics.ear > 0.24) {
      this.eyeWasOpen = true;
    }

    if (this.eyeWasOpen && metrics.ear < 0.18) {
      this.blinkDetected = true;
      this.eyeWasOpen = false;
    }

    this.noseRatioMin = Math.min(this.noseRatioMin, metrics.noseRatio);
    this.noseRatioMax = Math.max(this.noseRatioMax, metrics.noseRatio);
  }

  hasPassed() {
    const headTurnDelta = this.noseRatioMax - this.noseRatioMin;
    return this.blinkDetected && headTurnDelta >= 0.04;
  }

  getElapsedMs() {
    return Date.now() - this.startedAt;
  }
}
