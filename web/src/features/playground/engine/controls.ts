// Input for walking around: keyboard and a locked mouse on a computer; on a
// touch screen a joystick under the left thumb and a look-around drag under the
// right. Keys only count while the playground has focus (or the pointer is
// locked), so typing in the chat beside it never walks anyone.

export type CameraMode = 'first' | 'third';

export interface MoveIntent {
  /** -1..1, positive is forward */
  forward: number;
  /** -1..1, positive is right */
  right: number;
  run: boolean;
}

const MOUSE_SENSITIVITY = 0.0024;
const TOUCH_SENSITIVITY = 0.006;
const JOYSTICK_RADIUS = 56;
const PITCH_LIMITS: Record<CameraMode, [number, number]> = {
  // third person: how far the camera may look up from behind (negative is from above)
  third: [-1.15, 0.3],
  first: [-1.45, 1.45],
};
// where the view rests after switching: slightly above the shoulder, or level with the eyes
const RESTING_PITCH: Record<CameraMode, number> = { third: -0.32, first: 0 };

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space']);

interface Drag { pointerId: number; startX: number; startY: number; x: number; y: number }

export class Controls {
  /** camera heading, radians around +y; 0 looks toward -z (the screen) */
  yaw = 0;
  /** look-up angle */
  pitch = RESTING_PITCH.third;
  /** third-person camera distance */
  distance = 5;
  mode: CameraMode = 'third';
  onToggleMode: () => void = () => {};
  onLockChange: (locked: boolean) => void = () => {};
  /** the first key, drag or mouse lock that moves anything */
  onFirstInput: () => void = () => {};
  private engaged = false;

  private readonly keys = new Set<string>();
  private jumpQueued = false;
  private joystick: Drag | null = null;
  private look: Drag | null = null;
  private readonly joystickBase: HTMLDivElement;
  private readonly joystickKnob: HTMLDivElement;

  private readonly canvas: HTMLCanvasElement;
  private readonly container: HTMLElement;

  constructor(canvas: HTMLCanvasElement, container: HTMLElement) {
    this.canvas = canvas;
    this.container = container;
    this.joystickBase = document.createElement('div');
    this.joystickBase.className = 'pointer-events-none absolute z-10 hidden size-28 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/25 bg-black/25';
    this.joystickKnob = document.createElement('div');
    this.joystickKnob.className = 'absolute left-1/2 top-1/2 size-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70';
    this.joystickBase.append(this.joystickKnob);
    container.append(this.joystickBase);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clear);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clear);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    if (this.locked) document.exitPointerLock();
    this.joystickBase.remove();
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.pitch = RESTING_PITCH[mode];
  }

  private engage(): void {
    if (this.engaged) return;
    this.engaged = true;
    this.onFirstInput();
  }

  intent(): MoveIntent {
    if (this.joystick) {
      const dx = (this.joystick.x - this.joystick.startX) / JOYSTICK_RADIUS;
      const dy = (this.joystick.y - this.joystick.startY) / JOYSTICK_RADIUS;
      const length = Math.hypot(dx, dy);
      const scale = length > 1 ? 1 / length : 1;
      return { forward: -dy * scale, right: dx * scale, run: length > 0.9 };
    }
    const has = (...codes: string[]) => codes.some((code) => this.keys.has(code));
    return {
      forward: Number(has('KeyW', 'ArrowUp')) - Number(has('KeyS', 'ArrowDown')),
      right: Number(has('KeyD', 'ArrowRight')) - Number(has('KeyA', 'ArrowLeft')),
      run: has('ShiftLeft', 'ShiftRight'),
    };
  }

  queueJump(): void {
    this.jumpQueued = true;
  }

  consumeJump(): boolean {
    const queued = this.jumpQueued;
    this.jumpQueued = false;
    return queued;
  }

  private active(): boolean {
    return this.locked || this.container.contains(document.activeElement);
  }

  private clampPitch(): void {
    const [min, max] = PITCH_LIMITS[this.mode];
    this.pitch = Math.min(Math.max(this.pitch, min), max);
  }

  private turn(dx: number, dy: number, sensitivity: number): void {
    this.yaw -= dx * sensitivity;
    this.pitch -= dy * sensitivity;
    this.clampPitch();
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.active() || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"], select')) return;
    if (event.code === 'KeyV' && !event.repeat) {
      this.onToggleMode();
      return;
    }
    if (!MOVE_KEYS.has(event.code)) return;
    // Space and the arrows would scroll or press the focused button otherwise
    event.preventDefault();
    if (event.code === 'Space' && !event.repeat) this.jumpQueued = true;
    this.keys.add(event.code);
    this.engage();
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private clear = (): void => {
    this.keys.clear();
    this.joystick = null;
    this.look = null;
    this.joystickBase.classList.add('hidden');
  };

  private onPointerLockChange = (): void => {
    if (!this.locked) this.keys.clear();
    else this.engage();
    this.onLockChange(this.locked);
  };

  private onMouseMove = (event: MouseEvent): void => {
    if (this.locked) this.turn(event.movementX, event.movementY, MOUSE_SENSITIVITY);
  };

  private onPointerDown = (event: PointerEvent): void => {
    this.container.focus({ preventScroll: true });
    if (event.pointerType === 'mouse') {
      if (event.button === 0 && !this.locked) {
        // a browser that refuses (no user gesture, or not supported) leaves the mouse free
        const request = this.canvas.requestPointerLock() as unknown;
        if (request instanceof Promise) request.catch(() => {});
      }
      return;
    }
    this.engage();
    const rect = this.canvas.getBoundingClientRect();
    const drag: Drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY };
    if (event.clientX - rect.left < rect.width / 2 && !this.joystick) {
      this.joystick = drag;
      this.joystickBase.style.left = `${event.clientX - rect.left}px`;
      this.joystickBase.style.top = `${event.clientY - rect.top}px`;
      this.joystickKnob.style.transform = '';
      this.joystickBase.classList.remove('hidden');
    } else if (!this.look) {
      this.look = drag;
    } else {
      return;
    }
    this.canvas.setPointerCapture(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.joystick?.pointerId === event.pointerId) {
      this.joystick.x = event.clientX;
      this.joystick.y = event.clientY;
      const dx = event.clientX - this.joystick.startX;
      const dy = event.clientY - this.joystick.startY;
      const length = Math.hypot(dx, dy);
      const scale = length > JOYSTICK_RADIUS ? JOYSTICK_RADIUS / length : 1;
      this.joystickKnob.style.transform = `translate(calc(-50% + ${dx * scale}px), calc(-50% + ${dy * scale}px))`;
    } else if (this.look?.pointerId === event.pointerId) {
      this.turn(event.clientX - this.look.x, event.clientY - this.look.y, TOUCH_SENSITIVITY);
      this.look.x = event.clientX;
      this.look.y = event.clientY;
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (this.joystick?.pointerId === event.pointerId) {
      this.joystick = null;
      this.joystickBase.classList.add('hidden');
    } else if (this.look?.pointerId === event.pointerId) {
      this.look = null;
    }
  };

  private onWheel = (event: WheelEvent): void => {
    if (this.mode !== 'third') return;
    event.preventDefault();
    this.distance = Math.min(Math.max(this.distance + event.deltaY * 0.004, 2.2), 10);
  };
}
