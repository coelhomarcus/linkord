// Input for walking around: keyboard and a locked mouse on a computer; on a
// touch screen a joystick under the left thumb and a look-around drag under the
// right. Keys only count while the playground has focus (or the pointer is
// locked), so typing in the chat beside it never walks anyone.

/** First person, third person from behind, and third person from the front (V goes round them). */
export type CameraMode = 'first' | 'third' | 'front';

export const CAMERA_MODES: readonly CameraMode[] = ['first', 'third', 'front'];

/** the playground namespace's name for each mode */
export const CAMERA_LABEL = { first: 'camera.first', third: 'camera.third', front: 'camera.front' } as const satisfies Record<CameraMode, string>;

export function nextCameraMode(mode: CameraMode): CameraMode {
  return CAMERA_MODES[(CAMERA_MODES.indexOf(mode) + 1) % CAMERA_MODES.length]!;
}

export interface MoveIntent {
  /** -1..1, positive is forward */
  forward: number;
  /** -1..1, positive is right */
  right: number;
  sprint: boolean;
  sneak: boolean;
  /** Space held: jumps again on landing */
  jump: boolean;
  /** a thumb on the joystick jumps onto steps by itself */
  autoJump: boolean;
}

const MOUSE_SENSITIVITY = 0.0024;
const TOUCH_SENSITIVITY = 0.006;
const JOYSTICK_RADIUS = 56;
// straight up or down, short of the pole where the heading would flip
const MAX_PITCH = Math.PI / 2 - 0.01;
/** a second press of forward within this long starts a sprint (7 ticks) */
const SPRINT_DOUBLE_TAP_MS = 350;
/** the third-person camera's distance, and how far the wheel can take it */
export const DEFAULT_CAMERA_DISTANCE = 4;
const MIN_CAMERA_DISTANCE = 2;
const MAX_CAMERA_DISTANCE = 8;

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space']);
const FORWARD_KEYS = new Set(['KeyW', 'ArrowUp']);
/** held while moving forward, starts a sprint, as in the game */
const SPRINT_KEYS = new Set(['ControlLeft', 'ControlRight']);

interface Drag { pointerId: number; startX: number; startY: number; x: number; y: number }

export class Controls {
  /** camera heading, radians around +y; 0 looks toward -z (the screen) */
  yaw = 0;
  /** look-up angle, the same in every camera mode */
  pitch = 0;
  /** third-person camera distance */
  distance = DEFAULT_CAMERA_DISTANCE;
  mode: CameraMode = 'third';
  /** a click while the mouse is locked: the arm swings */
  onAction: () => void = () => {};

  private readonly keys = new Set<string>();
  private jumpQueued = false;
  private sprinting = false;
  private lastForwardPress = -Infinity;
  private joystick: Drag | null = null;
  private look: Drag | null = null;
  /** a held mouse button turning the view where the pointer cannot be locked */
  private mouseLook: Drag | null = null;
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
    canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  // a right click in the world is the game's, never the browser's menu
  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

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
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    if (this.locked) document.exitPointerLock();
    this.joystickBase.remove();
  }

  /** false while a menu covers the world: keys, drags and the wheel do nothing */
  get enabled(): boolean {
    return this.isEnabled;
  }

  set enabled(value: boolean) {
    this.isEnabled = value;
    if (!value) this.clear();
  }

  private isEnabled = true;

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
  }

  /** Walking into a wall ends a sprint, as it does in the game. */
  stopSprint(): void {
    this.sprinting = false;
  }

  intent(): MoveIntent {
    if (this.joystick) {
      const dx = (this.joystick.x - this.joystick.startX) / JOYSTICK_RADIUS;
      const dy = (this.joystick.y - this.joystick.startY) / JOYSTICK_RADIUS;
      const length = Math.hypot(dx, dy);
      const scale = length > 1 ? 1 / length : 1;
      return { forward: -dy * scale, right: dx * scale, sprint: length > 0.9 && -dy * scale > 0.5, sneak: false, jump: false, autoJump: true };
    }
    const has = (...codes: string[]) => codes.some((code) => this.keys.has(code));
    const forward = Number(has('KeyW', 'ArrowUp')) - Number(has('KeyS', 'ArrowDown'));
    const sneak = has('ShiftLeft', 'ShiftRight');
    if (forward > 0 && !sneak && has('ControlLeft', 'ControlRight')) this.sprinting = true;
    if (forward <= 0 || sneak) this.sprinting = false;
    return {
      forward,
      right: Number(has('KeyD', 'ArrowRight')) - Number(has('KeyA', 'ArrowLeft')),
      sprint: this.sprinting,
      sneak,
      jump: has('Space'),
      autoJump: false,
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
    this.pitch = Math.min(Math.max(this.pitch, -MAX_PITCH), MAX_PITCH);
  }

  private turn(dx: number, dy: number, sensitivity: number): void {
    this.yaw -= dx * sensitivity;
    this.pitch -= dy * sensitivity;
    this.clampPitch();
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.active() || !this.enabled) return;
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"], select')) return;
    if (SPRINT_KEYS.has(event.code)) {
      this.keys.add(event.code);
      return;
    }
    // Ctrl is the sprint key, so walking goes on with it held; every other shortcut, and the
    // game's own keys (V, Tab, T...), are the stage's (gameKeys.ts)
    const sprintHeld = event.ctrlKey && !event.metaKey && !event.altKey;
    if ((event.ctrlKey || event.metaKey || event.altKey) && !sprintHeld) return;
    if (!MOVE_KEYS.has(event.code)) return;
    // Space and the arrows would scroll or press the focused button otherwise
    event.preventDefault();
    if (event.code === 'Space' && !event.repeat) this.jumpQueued = true;
    if (FORWARD_KEYS.has(event.code) && !event.repeat) {
      if (event.timeStamp - this.lastForwardPress < SPRINT_DOUBLE_TAP_MS) this.sprinting = true;
      this.lastForwardPress = event.timeStamp;
    }
    this.keys.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private clear = (): void => {
    this.keys.clear();
    this.sprinting = false;
    this.joystick = null;
    this.look = null;
    this.mouseLook = null;
    this.joystickBase.classList.add('hidden');
  };

  private onPointerLockChange = (): void => {
    if (this.locked) return;
    this.keys.clear();
    this.sprinting = false;
  };

  private onMouseMove = (event: MouseEvent): void => {
    if (this.locked) this.turn(event.movementX, event.movementY, MOUSE_SENSITIVITY);
  };

  /** Asks for the mouse; browsers grant it only during a click or key press. */
  requestLock(): void {
    if (this.locked) return;
    const request = this.canvas.requestPointerLock() as unknown;
    if (request instanceof Promise) request.catch(() => {});
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled) return;
    this.container.focus({ preventScroll: true });
    if (event.pointerType === 'mouse') {
      if (this.locked) {
        if (event.button === 0) this.onAction();
        return;
      }
      // dragging turns the view too, so the mouse still steers where the lock is
      // refused (an older desktop app, a browser setting, no user gesture)
      this.mouseLook = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY };
      this.canvas.setPointerCapture(event.pointerId);
      if (event.button === 0) this.requestLock();
      return;
    }
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
    if (this.mouseLook?.pointerId === event.pointerId) {
      // once locked, document mousemove does the turning
      if (!this.locked) this.turn(event.clientX - this.mouseLook.x, event.clientY - this.mouseLook.y, MOUSE_SENSITIVITY * 1.6);
      this.mouseLook.x = event.clientX;
      this.mouseLook.y = event.clientY;
      return;
    }
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
    if (this.mouseLook?.pointerId === event.pointerId) {
      this.mouseLook = null;
      return;
    }
    if (this.joystick?.pointerId === event.pointerId) {
      this.joystick = null;
      this.joystickBase.classList.add('hidden');
    } else if (this.look?.pointerId === event.pointerId) {
      this.look = null;
    }
  };

  private onWheel = (event: WheelEvent): void => {
    // Ctrl with the wheel would zoom the page
    if (event.ctrlKey) {
      event.preventDefault();
      return;
    }
    if (this.mode === 'first' || !this.enabled) return;
    event.preventDefault();
    this.distance = Math.min(Math.max(this.distance + event.deltaY * 0.004, MIN_CAMERA_DISTANCE), MAX_CAMERA_DISTANCE);
  };
}
