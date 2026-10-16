// Pointer, keyboard and wheel input for the Meadow, tracked per pointer so a
// phone's second finger, a cancelled touch or a lost window never leaves a
// stale "finger down" behind. The class only records what happened; the
// controller reads it once per frame and decides what it means.
//
// One finger: a quick tap (under 12 px and 250 ms) is a "go there"; anything
// that moves further or is held longer becomes a drag that drives toward the
// finger. Two fingers pinch the zoom and spend the gesture: lifting one of
// them does not turn the other into a drag.
// Drag-to-drive approach adapted from Bruno Simon's folio-2025 (MIT): Inputs/Nipple.js.

export const TAP_MAX_PX = 12;
export const TAP_MAX_MS = 250;

type Mode = "none" | "pending" | "drag" | "pinch" | "spent";

interface Tracked {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startT: number;
}

const DRIVE_KEYS: Record<string, "up" | "down" | "left" | "right"> = {
  KeyW: "up",
  ArrowUp: "up",
  KeyS: "down",
  ArrowDown: "down",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
};

export class MeadowInput {
  private el: HTMLElement | null = null;
  private pointers = new Map<number, Tracked>();
  private mode: Mode = "none";
  private pinchStart = 0;
  private pinchLast = 1;
  private keys = new Set<string>();

  /** Taps since the last frame, in element pixels. */
  readonly taps: Array<{ x: number; y: number }> = [];
  /** The driving finger while a drag is live, in element pixels. */
  readonly drag = { active: false, x: 0, y: 0 };
  /** Multiplicative zoom change since the last frame (pinch and wheel). */
  zoomFactor = 1;
  hopPressed = false;
  respawnPressed = false;
  /** Bumped on any deliberate input, so idle helpers can tell when the player is busy. */
  lastInputAt = 0;

  attach(el: HTMLElement): void {
    this.el = el;
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointercancel", this.onCancel);
    el.addEventListener("lostpointercapture", this.onCancel);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.addEventListener("contextmenu", this.onContext);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.releaseAll);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  detach(): void {
    const el = this.el;
    if (el) {
      el.removeEventListener("pointerdown", this.onDown);
      el.removeEventListener("pointermove", this.onMove);
      el.removeEventListener("pointerup", this.onUp);
      el.removeEventListener("pointercancel", this.onCancel);
      el.removeEventListener("lostpointercapture", this.onCancel);
      el.removeEventListener("wheel", this.onWheel);
      el.removeEventListener("contextmenu", this.onContext);
    }
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.releaseAll);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.releaseAll();
    this.el = null;
  }

  /** Call once per frame before reading: promotes a held finger to a drag. */
  update(now: number): void {
    if (this.mode === "pending") {
      const p = this.first();
      if (p && now - p.startT >= TAP_MAX_MS) this.startDrag(p);
    }
  }

  /** Clears the one-frame edges after the controller has read them. */
  endFrame(): void {
    this.taps.length = 0;
    this.zoomFactor = 1;
    this.hopPressed = false;
    this.respawnPressed = false;
  }

  /** Keyboard throttle and steer, each -1..1; steer is positive to the left. */
  keyAxes(out: { throttle: number; steer: number }): boolean {
    let up = false;
    let down = false;
    let left = false;
    let right = false;
    for (const k of this.keys) {
      const d = DRIVE_KEYS[k];
      if (d === "up") up = true;
      else if (d === "down") down = true;
      else if (d === "left") left = true;
      else if (d === "right") right = true;
    }
    out.throttle = (up ? 1 : 0) - (down ? 1 : 0);
    out.steer = (left ? 1 : 0) - (right ? 1 : 0);
    return up || down || left || right;
  }

  releaseAll = (): void => {
    for (const id of this.pointers.keys()) this.releaseCapture(id);
    this.pointers.clear();
    this.keys.clear();
    this.mode = "none";
    this.drag.active = false;
  };

  private first(): Tracked | undefined {
    for (const p of this.pointers.values()) return p;
    return undefined;
  }

  private local(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const r = this.el!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private startDrag(p: Tracked): void {
    this.mode = "drag";
    this.drag.active = true;
    this.drag.x = p.x;
    this.drag.y = p.y;
  }

  private pinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private releaseCapture(id: number): void {
    try {
      if (this.el?.hasPointerCapture(id)) this.el.releasePointerCapture(id);
    } catch {
      // The pointer may already be gone; nothing to release.
    }
  }

  private onDown = (e: PointerEvent): void => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (this.pointers.size >= 2) return;
    const { x, y } = this.local(e);
    this.pointers.set(e.pointerId, { id: e.pointerId, x, y, startX: x, startY: y, startT: performance.now() });
    try {
      this.el?.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a nicety (drags that leave the canvas); input still works without it.
    }
    this.lastInputAt = performance.now();
    if (this.pointers.size === 1) {
      this.mode = "pending";
    } else {
      // A second finger turns whatever the first was doing into a pinch.
      this.mode = "pinch";
      this.drag.active = false;
      this.pinchStart = Math.max(1, this.pinchDistance());
      this.pinchLast = 1;
    }
  };

  private onMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const { x, y } = this.local(e);
    p.x = x;
    p.y = y;
    if (this.mode === "pending" && Math.hypot(x - p.startX, y - p.startY) >= TAP_MAX_PX) this.startDrag(p);
    if (this.mode === "drag") {
      this.drag.x = x;
      this.drag.y = y;
      this.lastInputAt = performance.now();
    } else if (this.mode === "pinch" && this.pointers.size === 2) {
      const ratio = this.pinchDistance() / this.pinchStart;
      // Fingers apart means closer in: the distance scales by the inverse ratio.
      this.zoomFactor *= this.pinchLast / ratio;
      this.pinchLast = ratio;
      this.lastInputAt = performance.now();
    }
  };

  private onUp = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    this.releaseCapture(e.pointerId);
    if (this.mode === "pending") {
      const moved = Math.hypot(p.x - p.startX, p.y - p.startY);
      if (moved < TAP_MAX_PX && performance.now() - p.startT < TAP_MAX_MS) this.taps.push({ x: p.x, y: p.y });
    }
    this.afterLift();
  };

  private onCancel = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    this.releaseCapture(e.pointerId);
    this.afterLift();
  };

  private afterLift(): void {
    if (this.pointers.size === 0) {
      this.mode = "none";
      this.drag.active = false;
    } else if (this.mode === "pinch" || this.mode === "spent") {
      this.mode = "spent";
    } else {
      this.mode = "none";
      this.drag.active = false;
    }
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // Normalise pixel and line deltas; one notch is about 100 px.
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    this.zoomFactor *= Math.exp(Math.max(-200, Math.min(200, dy)) * 0.0012);
    this.lastInputAt = performance.now();
  };

  private onContext = (e: Event): void => {
    // A long press on a phone would otherwise open the context menu mid-drag.
    e.preventDefault();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code in DRIVE_KEYS || e.code === "Space") e.preventDefault();
    if (e.repeat) return;
    if (e.code in DRIVE_KEYS) this.keys.add(e.code);
    else if (e.code === "Space") this.hopPressed = true;
    else if (e.code === "KeyR") this.respawnPressed = true;
    else return;
    this.lastInputAt = performance.now();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onVisibility = (): void => {
    if (document.visibilityState === "hidden") this.releaseAll();
  };
}
