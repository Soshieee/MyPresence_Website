import * as faceapi from "face-api.js";

let modelLoadPromise: Promise<void> | null = null;

export async function loadFaceApiModels(): Promise<void> {
  if (!modelLoadPromise) {
    modelLoadPromise = Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri("/models"),
      faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
      faceapi.nets.faceRecognitionNet.loadFromUri("/models")
    ]).then(() => undefined);
  }

  return modelLoadPromise;
}

export function getFaceDetectorOptions() {
  return new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 });
}
