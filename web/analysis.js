// Timing analysis for a take: when each note of your guitar began (onset detection),
// how far each sat from the beat, and how consistent you were. Pure functions on
// samples and numbers, so they can be tested against signals with known answers.
// Loaded before app.js; nothing here touches the page.
//
// The signal is your guitar alone: the solo stem of a take with backing, or the master
// of a guitar-only take. Whatever else is in the room, the backing is not in it.

// Note onsets, in seconds. The energy of the signal is measured every ~4 ms; an onset is
// where it jumps well above what came just before it and above a noise floor. Plain
// energy, not its rate of change, so a low string, whose waveform changes slowly, is
// heard as clearly as a high one. x: mono samples in [-1, 1].
function detectOnsets(x, sr, opts = {}) {
  const hop = Math.max(32, Math.round(sr * 0.004));
  const n = Math.floor(x.length / hop);
  if (n < 12) return [];
  // Energy over a 16 ms window, every 4 ms. The window must span at least one cycle of the
  // lowest note (an 82 Hz string repeats every 12 ms), or the reading wobbles with the
  // waveform's phase and a held low note looks like a series of new ones.
  const wins = 4, e = new Float32Array(n), sq = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = i * hop; j < (i + 1) * hop; j++) s += x[j] * x[j]; sq[i] = s; }
  for (let i = 0; i < n; i++) { let s = 0; for (let k = Math.max(0, i - wins + 1); k <= i; k++) s += sq[k]; e[i] = Math.sqrt(s / (Math.min(i + 1, wins) * hop)); }
  // the noise floor: what the quietest fifth of the take sounds like
  const sorted = Float32Array.from(e).sort();
  const floor = sorted[Math.floor(n * 0.2)];
  const abs = Math.max(opts.floor ?? 0.006, floor * 5);
  const share = opts.share ?? 0.3, refractory = Math.round((opts.refractory ?? 0.09) * sr / hop), look = 10;
  const peak = (a, b) => { let m = 0; for (let j = Math.max(0, a); j < Math.min(x.length, b); j++) { const v = Math.abs(x[j]); if (v > m) m = v; } return m; };
  const out = [];
  let last = -1e9;
  for (let i = look; i < n; i++) {
    if (e[i] < abs || i - last < refractory) continue;
    // Flux: how much energy was added over the last two hops. A new attack adds it, even
    // over a note still ringing; a decaying note only loses it. It must be a real share of
    // the loudest thing just before, so a wobble in a held note is not a new note.
    const flux = Math.max(0, e[i] - e[i - 1]) + Math.max(0, e[i - 1] - e[i - 2]);
    let local = 0;
    for (let k = i - look; k < i; k++) if (e[k] > local) local = e[k];
    if (flux <= share * Math.max(local, abs)) continue;
    // To the sample: the first place in the last few hops that stands clear of the
    // loudest peak before them, so the time is the attack and not the hop it fell in.
    const before = peak((i - wins - 6) * hop, (i - wins - 1) * hop), thr = Math.max(1.6 * before, 0.02);
    let at = (i - wins) * hop;
    for (let j = (i - wins - 1) * hop; j < (i + 1) * hop; j++) if (peak(j, j + 16) > thr) { at = j; break; }
    out.push(at / sr);
    last = i;
  }
  return out;
}

// How each onset sits against a beat grid, corrected for the calibrated latency.
//   grid: { t0, beat } — the first beat in take time, and a beat's length in seconds
//   calMs: how late your playing reaches the recording (subtracted)
//   subdiv: notes per beat the grid allows (2: eighth notes)
// Positive offsets are behind the beat (dragging), negative ahead (rushing). An onset that
// lies too far from every grid point to be told apart is ignored, not forced onto one.
function timingOffsets(onsets, grid, calMs = 0, subdiv = 2) {
  if (!grid || !(grid.beat > 0)) return [];
  const step = grid.beat / subdiv, out = [];
  for (const t of onsets) {
    const rel = (t - calMs / 1000 - grid.t0) / step;
    if (rel < -0.4) continue;                        // before the grid began
    const near = Math.round(rel), off = (rel - near) * step * 1000;
    if (Math.abs(rel - near) > 0.4) continue;        // between two grid points: unreadable
    out.push({ t, ms: off });
  }
  return out;
}
// The headline is consistency: the spread of the offsets (their standard deviation), so
// a steady player who is a little early scores as well as one who is exactly on the beat.
// The mean says which way you lean; it is reported apart from the spread.
function timingStats(offsets) {
  const n = offsets.length;
  if (n < 4) return { count: n, mean: null, std: null };
  const mean = offsets.reduce((s, o) => s + o.ms, 0) / n;
  const std = Math.sqrt(offsets.reduce((s, o) => s + (o.ms - mean) ** 2, 0) / n);
  return { count: n, mean: Math.round(mean * 10) / 10, std: Math.round(std * 10) / 10 };
}
// The same, overall and for each section (sections in take time: [{name, from, to}]).
function timingReport(onsets, grid, calMs, sections = [], subdiv = 2) {
  const all = timingOffsets(onsets, grid, calMs, subdiv);
  return { ...timingStats(all),
    sections: sections.map(s => ({ name: s.name, ...timingStats(all.filter(o => o.t >= s.from && o.t < s.to)) })) };
}
const timingWord = std => std === null ? "" : std < 15 ? "tight" : std < 30 ? "steady" : "loose";

// Where to start a take so that two takes line up: at a section's start if there is one,
// else at the first bar of the grid. Returns seconds into that take.
function alignPoint(take, sectionName, sections, grid) {
  const s = sectionName ? sections.find(x => x.name === sectionName) : null;
  if (s) return s.from;
  return grid && Number.isFinite(grid.t0) ? Math.max(0, grid.t0) : 0;
}

// Progress across a song's takes, oldest first: how many were run-throughs without
// stopping (a full take with no mistake marked), and a series to draw.
function progressSeries(takes, calWords = null) {
  const ordered = [...takes].sort((a, b) => a.created - b.created);
  const clean = ordered.filter(t => t.mode === "full" && t.markers.length === 0).length;
  return {
    ordered, clean, runs: ordered.filter(t => t.mode === "full").length,
    whole: ordered.map(t => (t.rerate && t.rerate.ratings.whole) || t.ratings.whole),
    mistakes: ordered.map(t => t.markers.length),
    consistency: ordered.map(t => t.timingStd ?? null),
  };
}
