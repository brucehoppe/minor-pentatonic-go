// Practice desk — raw take capture, run on the audio thread as an AudioWorklet.
//
// It hears the same mix the compressed recording does (the input, and the backing
// when that is recorded) and hands it to the page in blocks of about a second, which
// app.js writes to IndexedDB as they arrive. It counts frames on the audio clock, so
// a take can start on an exact sample — the downbeat of bar 1 — instead of whenever
// a timer on the page happens to fire.
//
// Messages in:  {start: frame}   keep audio from this frame on (0: from now)
//               {stopAt: frame}  keep audio up to this frame, then stop by itself —
//                                a drill ends on the exact downbeat after its last bar
//               {stop: true}     hand over what is left, then {done: frames}
// Messages out: {block: [Float32Array per channel]}, then {done: frames}
class TakeCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.channels = o.channels === 2 ? 2 : 1;
    this.size = Math.max(128, o.block | 0 || 48000);
    this.start = Infinity;
    this.end = Infinity;
    this.frames = 0;
    this.stopped = false;
    this.fresh();
    this.port.onmessage = e => {
      const m = e.data || {};
      if (typeof m.start === "number") this.start = Math.max(m.start, currentFrame);
      if (typeof m.stopAt === "number") this.end = m.stopAt;
      if (m.stop) this.stopped = true;
    };
  }
  fresh() {
    this.buf = [];
    for (let c = 0; c < this.channels; c++) this.buf.push(new Float32Array(this.size));
    this.fill = 0;
  }
  flush() {
    if (!this.fill) return;
    const block = this.buf.map(b => b.slice(0, this.fill));
    this.port.postMessage({ block }, block.map(b => b.buffer));
    this.frames += this.fill;
    this.fresh();
  }
  process(inputs) {
    if (this.stopped) {
      this.flush();
      this.port.postMessage({ done: this.frames });
      return false;
    }
    const input = inputs[0] || [];
    const n = (input[0] && input[0].length) || 128;
    for (let i = 0; i < n; i++) {
      if (currentFrame + i < this.start) continue;
      if (currentFrame + i >= this.end) { this.stopped = true; break; }
      for (let c = 0; c < this.channels; c++) {
        // a missing channel (no input connected yet) records as silence
        const ch = input[c] || input[0];
        this.buf[c][this.fill] = ch ? ch[i] : 0;
      }
      if (++this.fill === this.size) this.flush();
    }
    return true;
  }
}
registerProcessor("take-capture", TakeCapture);
