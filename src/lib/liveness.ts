type PointLike = { x: number; y: number };

type LandmarksLike = {
  getLeftEye?: () => PointLike[];
  getRightEye?: () => PointLike[];
  getNose?: () => PointLike[];
  _positions?: Array<{ x: number; y: number }>;
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

  let leftEye: PointLike[] | undefined;
  let rightEye: PointLike[] | undefined;
  let nose: PointLike[] | undefined;

  // Try method-based access first (standard face-api.js)
  leftEye = landmarks.getLeftEye?.() as PointLike[] | undefined;
  rightEye = landmarks.getRightEye?.() as PointLike[] | undefined;
  nose = landmarks.getNose?.() as PointLike[] | undefined;

  // Fallback: try array-based access via _positions (face-api.js uses 68 point landmarks)
  if ((!leftEye || !rightEye || !nose) && Array.isArray((landmarks as any)._positions)) {
    const positions = (landmarks as any)._positions as PointLike[];
    if (positions.length >= 68) {
      leftEye = leftEye || positions.slice(42, 48);   // Left eye: points 42-47
      rightEye = rightEye || positions.slice(36, 42); // Right eye: points 36-41
      nose = nose || positions.slice(27, 35);         // Nose: points 27-35
      console.log("[Liveness] Using _positions fallback for landmarks");
    }
  }

  if (!leftEye || !rightEye) {
    console.warn("[Liveness] Missing eye landmarks", { hasLeftEye: !!leftEye, hasRightEye: !!rightEye });
    return null;
  }

  if (!nose || nose.length === 0) {
    console.warn("[Liveness] Missing nose landmarks", { hasNose: !!nose, noseLength: nose?.length ?? 0 });
    return null;
  }

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
    // Blink detection: lower thresholds for better sensitivity
    if (metrics.ear > 0.22) {
      this.eyeWasOpen = true;
    }

    if (this.eyeWasOpen && metrics.ear < 0.15) {
      this.blinkDetected = true;
      this.eyeWasOpen = false;
    }

    this.noseRatioMin = Math.min(this.noseRatioMin, metrics.noseRatio);
    this.noseRatioMax = Math.max(this.noseRatioMax, metrics.noseRatio);
  }

  hasPassed() {
    // Require either blink OR significant head movement (reduced from 0.04 to 0.03)
    const headTurnDelta = this.noseRatioMax - this.noseRatioMin;
    return this.blinkDetected || headTurnDelta >= 0.03;
  }

  getElapsedMs() {
    return Date.now() - this.startedAt;
  }
}
