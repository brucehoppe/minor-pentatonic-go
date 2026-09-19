// Pitch from the guitar input: a tuner, and a check for bends and vibrato. Pure functions
// on samples and numbers, so they can be tested against signals with known answers.
// Loaded before app.js; nothing here touches the page.

const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Tunings the tuner knows, as MIDI notes from string 6 to string 1. The open tunings are
// the ones the Open tunings view teaches.
const TUNER_TUNINGS = [
  { id: "standard", name: "Standard", midi: [40, 45, 50, 55, 59, 64] },
  { id: "half-down", name: "Half step down", midi: [39, 44, 49, 54, 58, 63] },
  { id: "drop-d", name: "Dropped D", midi: [38, 45, 50, 55, 59, 64] },
  { id: "open-d", name: "Open D", midi: [38, 45, 50, 54, 57, 62] },
  { id: "open-g", name: "Open G", midi: [38, 43, 50, 55, 59, 62] },
  { id: "open-e", name: "Open E", midi: [40, 47, 52, 56, 59, 64] },
];

// The fundamental of one frame, by YIN (de Cheveigné and Kawahara, 2002): the lag at which
// the signal best matches a copy of itself, normalised so that a lag half or double the
// true period does not win. Returns {hz, clarity} (clarity 0..1), or null for silence,
// noise, or anything outside 60–1400 Hz, which covers a bent note at fret 22 of the high e.
// Above 30 kHz the frame is halved first by averaging sample pairs; a guitar has nothing
// the tuner needs up there, and it quarters the work.
function detectPitch(x, sr, opts = {}) {
  let s = x, rate = sr;
  if (sr > 30000) {
    s = new Float32Array(x.length >> 1);
    for (let i = 0; i < s.length; i++) s[i] = (x[2 * i] + x[2 * i + 1]) / 2;
    rate = sr / 2;
  }
  if (s.length > 2048) s = s.subarray(s.length - 2048);
  let rms = 0;
  for (let i = 0; i < s.length; i++) rms += s[i] * s[i];
  rms = Math.sqrt(rms / s.length);
  if (rms < (opts.floor ?? 0.004)) return null;
  const minLag = Math.max(2, Math.floor(rate / 1400)), maxLag = Math.ceil(rate / 60);
  const w = s.length - maxLag - 1;
  if (w < maxLag) return null;
  // cumulative mean normalised difference
  const d = new Float32Array(maxLag + 2);
  d[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= maxLag + 1; tau++) {
    let sum = 0;
    for (let i = 0; i < w; i++) { const v = s[i] - s[i + tau]; sum += v * v; }
    run += sum;
    d[tau] = run > 0 ? sum * tau / run : 1;
  }
  const threshold = opts.threshold ?? 0.15;
  let tau = -1;
  for (let t = minLag; t <= maxLag; t++) {
    if (d[t] < threshold) {
      while (t + 1 <= maxLag && d[t + 1] < d[t]) t++;
      tau = t; break;
    }
  }
  if (tau < 0) return null;
  // between samples: the bottom of the parabola through the dip and its neighbours
  const a = d[tau - 1], b = d[tau], c = d[tau + 1], den = a - 2 * b + c;
  let exact = den > 0 ? tau + (a - c) / (2 * den) : tau;
  // A high note is only a few samples long at half rate, where the parabola is coarse
  // (1318 Hz reads 3.6 cents sharp). Look again at full rate, a few lags either side.
  if (rate !== sr) exact = refineLag(x.length > 4096 ? x.subarray(x.length - 4096) : x, 2 * exact) / 2;
  return { hz: rate / exact, clarity: Math.max(0, Math.min(1, 1 - b)) };
}
function refineLag(x, near) {
  const lo = Math.max(1, Math.floor(near) - 3), hi = Math.ceil(near) + 3, w = x.length - hi - 2;
  if (w < hi) return near;
  const diff = t => { let sum = 0; for (let i = 0; i < w; i++) { const v = x[i] - x[i + t]; sum += v * v; } return sum; };
  let best = lo, bv = Infinity;
  const vals = new Map();
  for (let t = lo - 1; t <= hi + 1; t++) { const v = diff(t); vals.set(t, v); if (t >= lo && t <= hi && v < bv) { bv = v; best = t; } }
  const a = vals.get(best - 1), c = vals.get(best + 1), den = a - 2 * bv + c;
  return den > 0 ? best + (a - c) / (2 * den) : best;
}

// The nearest equal-tempered note (A = 440) and how far off it is, in cents.
function noteOf(hz) {
  const m = 69 + 12 * Math.log2(hz / 440), midi = Math.round(m);
  return { midi, name: PITCH_NAMES[((midi % 12) + 12) % 12], octave: Math.floor(midi / 12) - 1, cents: (m - midi) * 100 };
}

// Which string of a tuning you are tuning (the nearest open string, so a string a little
// off is still itself), and which way to turn the peg. Within 5 cents is in tune.
function tunerTarget(hz, midis) {
  const m = 69 + 12 * Math.log2(hz / 440);
  let best = 0;
  midis.forEach((t, i) => { if (Math.abs(m - t) < Math.abs(m - midis[best])) best = i; });
  const cents = (m - midis[best]) * 100;
  return { string: 6 - best, midi: midis[best], name: PITCH_NAMES[midis[best] % 12], cents,
    say: Math.abs(cents) <= 5 ? "in tune" : cents < 0 ? "tune up" : "tune down" };
}

// A bend, from a pitch trace: points {t, st}, st in semitones above the fretted note. Where
// it landed is the median of everything within half a semitone below the target or above
// it, so the climb doesn't count and vibrato on top averages out. Within 15 cents is in
// tune; a bend that never got within half a semitone reports how far it got.
function bendReport(trace, target) {
  if (!trace || !trace.length) return null;
  const peak = trace.reduce((m, p) => Math.max(m, p.st), -Infinity);
  const top = trace.filter(p => p.st >= target - 0.5).map(p => p.st).sort((a, b) => a - b);
  if (top.length < 3) return { verdict: "not reached", peak, cents: (peak - target) * 100 };
  const mid = top.length >> 1, at = top.length % 2 ? top[mid] : (top[mid - 1] + top[mid]) / 2;
  const cents = (at - target) * 100;
  return { verdict: Math.abs(cents) <= 15 ? "in tune" : cents < 0 ? "flat" : "sharp", cents, peak, at };
}

// Vibrato on a held note, from the same kind of trace: how fast (cycles a second), how wide
// (cents either side of the centre) and whether the speed held steady. The trace is
// straightened first (its own line of best fit taken off), then each crossing of the centre
// is found between samples. Steady means the half-cycles vary by under 15%. Null when
// there are under half a second or three half-cycles to go on, or it is under 8 cents wide.
function vibratoReport(trace) {
  if (!trace || trace.length < 6 || trace[trace.length - 1].t - trace[0].t < 0.5) return null;
  const n = trace.length, mt = trace.reduce((a, p) => a + p.t, 0) / n, ms = trace.reduce((a, p) => a + p.st, 0) / n;
  let num = 0, den = 0;
  trace.forEach(p => { num += (p.t - mt) * (p.st - ms); den += (p.t - mt) ** 2; });
  const slope = den ? num / den : 0;
  const y = trace.map(p => (p.st - ms - slope * (p.t - mt)) * 100);
  const cross = [], peaks = [];
  let ext = 0;
  for (let i = 1; i < n; i++) {
    if (Math.abs(y[i]) > Math.abs(ext)) ext = y[i];
    if ((y[i - 1] < 0) !== (y[i] < 0) && y[i] !== y[i - 1]) {
      const f = y[i - 1] / (y[i - 1] - y[i]);
      cross.push(trace[i - 1].t + f * (trace[i].t - trace[i - 1].t));
      if (cross.length > 1) peaks.push(Math.abs(ext));
      ext = 0;
    }
  }
  if (cross.length < 4) return null;
  const halves = cross.slice(1).map((t, i) => t - cross[i]);
  const mean = halves.reduce((a, b) => a + b, 0) / halves.length;
  const sd = Math.sqrt(halves.reduce((a, b) => a + (b - mean) ** 2, 0) / halves.length);
  const width = peaks.reduce((a, b) => a + b, 0) / peaks.length;
  if (width < 8) return null;
  return { rate: 1 / (2 * mean), width, spread: sd / mean, steady: sd / mean < 0.15 };
}
