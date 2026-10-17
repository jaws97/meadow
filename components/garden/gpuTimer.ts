// GPU time per frame from EXT_disjoint_timer_query_webgl2, where the browser
// offers it (Chromium on desktop; not Safari, not most phones). The governor
// reads it to see headroom a vsynced frame interval hides: on a 60 Hz screen
// a frame that took the GPU 6 ms and one that took 15 ms both arrive 16.7 ms
// apart. Results come back a frame or two late, so queries are pooled and
// read when ready; a disjoint event (a clock change on the GPU) voids them.

interface TimerExt {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

/** More unread queries than this means results have stopped coming; start over. */
const MAX_PENDING = 6;

export class GpuTimer {
  private pool: WebGLQuery[] = [];
  private pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;

  private constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly ext: TimerExt,
  ) {}

  static create(context: WebGLRenderingContext | WebGL2RenderingContext): GpuTimer | null {
    if (typeof WebGL2RenderingContext === "undefined" || !(context instanceof WebGL2RenderingContext)) return null;
    const ext = context.getExtension("EXT_disjoint_timer_query_webgl2") as TimerExt | null;
    return ext ? new GpuTimer(context, ext) : null;
  }

  begin(): void {
    if (this.active) return;
    if (this.pending.length >= MAX_PENDING) this.drop();
    const q = this.pool.pop() ?? this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end(): void {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  /** The newest finished measurement in milliseconds, or null if none finished since the last call. */
  poll(): number | null {
    const gl = this.gl;
    const disjoint = Boolean(gl.getParameter(this.ext.GPU_DISJOINT_EXT));
    let ms: number | null = null;
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = Number(gl.getQueryParameter(q, gl.QUERY_RESULT));
      this.pending.shift();
      this.pool.push(q);
      if (!disjoint) ms = ns / 1e6;
    }
    return ms;
  }

  private drop(): void {
    for (const q of this.pending) this.pool.push(q);
    this.pending.length = 0;
  }

  dispose(): void {
    if (this.active) this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    for (const q of [...this.pool, ...this.pending]) this.gl.deleteQuery(q);
    this.pool.length = 0;
    this.pending.length = 0;
    this.active = null;
  }
}
