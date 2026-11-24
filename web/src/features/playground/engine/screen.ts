import * as THREE from 'three';
import { SCREEN } from '@game/layout';
import { PIXEL_FONT } from '../pixelFont';

// The big screen: one shared stream fitted inside its frame, or a resting
// card saying how to put something on it.

export interface ScreenLabels {
  idle: string;
  idleHint: string;
}

export class ScreenDisplay {
  readonly group = new THREE.Group();
  private readonly picture: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly idleCanvas = document.createElement('canvas');
  private readonly idleTexture: THREE.CanvasTexture;
  private video: HTMLVideoElement | null = null;
  private videoTexture: THREE.VideoTexture | null = null;
  private fittedFor = '';

  constructor(labels: ScreenLabels) {
    this.idleTexture = new THREE.CanvasTexture(this.idleCanvas);
    this.idleTexture.colorSpace = THREE.SRGBColorSpace;
    this.drawIdle(labels);
    // unlit and untouched by tone mapping: a screen gives off its own light
    const material = new THREE.MeshBasicMaterial({ map: this.idleTexture, toneMapped: false });
    this.picture = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.picture.scale.set(SCREEN.width, SCREEN.height, 1);
    this.group.add(this.picture);
    this.group.position.set(SCREEN.x, SCREEN.y, SCREEN.z + 0.04);
  }

  setLabels(labels: ScreenLabels): void {
    this.drawIdle(labels);
    this.idleTexture.needsUpdate = true;
  }

  setVideo(video: HTMLVideoElement | null): void {
    if (video === this.video) return;
    this.videoTexture?.dispose();
    this.videoTexture = null;
    this.video = video;
    this.fittedFor = '';
    if (video) {
      this.videoTexture = new THREE.VideoTexture(video);
      this.videoTexture.colorSpace = THREE.SRGBColorSpace;
      this.picture.material.map = this.videoTexture;
    } else {
      this.picture.material.map = this.idleTexture;
      this.picture.scale.set(SCREEN.width, SCREEN.height, 1);
    }
    this.picture.material.needsUpdate = true;
  }

  /** Letterboxes the stream to its own shape; a shared window can be any size and change mid-stream. */
  update(): void {
    const video = this.video;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const key = `${video.videoWidth}x${video.videoHeight}`;
    if (key === this.fittedFor) return;
    this.fittedFor = key;
    const aspect = video.videoWidth / video.videoHeight;
    const frameAspect = SCREEN.width / SCREEN.height;
    if (aspect >= frameAspect) this.picture.scale.set(SCREEN.width, SCREEN.width / aspect, 1);
    else this.picture.scale.set(SCREEN.height * aspect, SCREEN.height, 1);
  }

  private drawIdle(labels: ScreenLabels): void {
    const width = 1280;
    const height = 720;
    this.idleCanvas.width = width;
    this.idleCanvas.height = height;
    const ctx = this.idleCanvas.getContext('2d');
    if (!ctx) return;
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#1c1d22');
    gradient.addColorStop(1, '#0f1013');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f2f3f5';
    ctx.font = `96px ${PIXEL_FONT}, monospace`;
    ctx.fillText(labels.idle, width / 2, height / 2 - 36, width - 160);
    ctx.fillStyle = '#949ba4';
    ctx.font = `48px ${PIXEL_FONT}, monospace`;
    ctx.fillText(labels.idleHint, width / 2, height / 2 + 40, width - 160);
  }

  dispose(): void {
    this.videoTexture?.dispose();
    this.idleTexture.dispose();
    this.picture.geometry.dispose();
    this.picture.material.dispose();
  }
}
