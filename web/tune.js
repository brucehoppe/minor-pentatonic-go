// The Tuner & bends view: a tuner, and a check for bends and vibrato, both reading the
// guitar input that the recorder and monitor share (the device and input chosen under
// Record → Settings). The pitch maths is in web/pitch.js; this is the page around it.
// Loaded before app.js, and only called once the page is up, so app.js's state and
// helpers are there by then.

const BEND_KEY = "minor-pentatonic-bends-v1";
const TUNE_TICK_MS = 25;          // 40 readings a second: enough to draw vibrato at 5–7 Hz
const BEND_SILENCE_S = 0.3;       // this long without a pitch and the note is over
const BEND_MIN_S = 0.4;           // shorter than this was a stray noise, not a bend
const BEND_MAX_S = 8;             // a note held longer than this is checked anyway

// The classic bends of the minor pentatonic box, in the key on screen: string (0 = high e)
// and the degree bent from, as semitones above the key's root, with how far it goes.
const BEND_PRESETS = [
  { s: 2, from: 5, by: 2, t: "4 → 5 on the G string" },
  { s: 1, from: 10, by: 2, t: "♭7 → root on the B" },
  { s: 0, from: 3, by: 2, t: "♭3 → 4 on the high e" },
  { s: 1, from: 3, by: 1, t: "♭3 → 3, the blue curl" },
];
// The fret of that degree on that string, in the lower half of the neck but past fret 2,
// where bends are hard work.
const presetFret = (p, key) => { const f = ((key + p.from - STRING_MIDI[p.s]) % 12 + 12) % 12; return f < 3 ? f + 12 : f; };

function readBends() {
  try { const v = JSON.parse(window.localStorage.getItem(BEND_KEY) || "[]");
    return Array.isArray(v) ? v.filter(x => x && typeof x === "object" && Number.isFinite(x.by) && typeof x.verdict === "string") : []; }
  catch (e) { return []; }
}
function writeBends(v) { try { window.localStorage.setItem(BEND_KEY, JSON.stringify(v.slice(0, 40))); } catch (e) { /* this visit only */ } }

function tuneTuning() { return TUNER_TUNINGS.find(t => t.id === state.tuneTuning) || TUNER_TUNINGS[0]; }
function bendSpec() {
  const s = +document.getElementById("bendstring").value || 0;
  const f = Math.max(1, Math.min(22, Math.round(+document.getElementById("bendfret").value) || 7));
  const by = +document.getElementById("bendamt").value;
  return { s, f, by, midi: midiAt(s, f) };
}
const midiName = m => NOTES[((m % 12) + 12) % 12];

function renderTune() {
  const tunings = document.getElementById("tunings");
  if (!tunings.dataset.built) {
    tunings.dataset.built = "1";
    TUNER_TUNINGS.forEach(t => mk(tunings, { tt: t.id }, t.name, () => { state.tuneTuning = t.id; renderTune(); }));
    const sel = document.getElementById("bendstring");
    sel.innerHTML = SL.map((n, i) => `<option value="${i}">${i + 1} · ${n}</option>`).join("");
    sel.value = "2";
    ["bendstring", "bendfret", "bendamt"].forEach(id => document.getElementById(id).onchange = () => { bendReset(); renderBendWhat(); });
    document.getElementById("tunelisten").onclick = () => pitchToggle("tuner");
    document.getElementById("bendlisten").onclick = () => pitchToggle("bend");
    document.getElementById("bendheartarget").onclick = () => { const b = bendSpec(); pluck(b.midi + b.by, 0, 1.2, .55); };
    document.getElementById("bendhearfret").onclick = () => { const b = bendSpec(); pluck(b.midi, 0, 1.2, .55); };
  }
  const t = tuneTuning();
  tunings.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.tt === t.id));
  const refs = document.getElementById("tunerefs");
  refs.innerHTML = '<span class="lbl">Hear a string</span>';
  t.midi.forEach((m, i) => mk(refs, { m }, `${6 - i} · ${midiName(m)}`, () => pluck(m, 0, 1.6, .55)));
  const pre = document.getElementById("bendpresets");
  pre.innerHTML = '<span class="lbl">Classic bends</span>';
  BEND_PRESETS.forEach(p => mk(pre, {}, p.t, () => {
    document.getElementById("bendstring").value = String(p.s);
    document.getElementById("bendfret").value = String(presetFret(p, state.key));
    document.getElementById("bendamt").value = String(p.by);
    bendReset(); renderBendWhat();
  }));
  renderBendWhat(); renderBendLog();
  if (!state.pitch) {
    paintTuner(null);
    document.getElementById("bendtrace").innerHTML = bendSvg([], bendSpec().by);
  }
}

function renderBendWhat() {
  const b = bendSpec();
  document.getElementById("bendwhat").innerHTML = b.by
    ? `String ${b.s + 1} (${SL[b.s]}), fret ${b.f}: <b>${midiName(b.midi)}</b>, bent ${["", "a half step", "a whole step", "a step and a half"][b.by]} to <b>${midiName(b.midi + b.by)}</b> (the note at fret ${b.f + b.by}).`
    : `String ${b.s + 1} (${SL[b.s]}), fret ${b.f}: <b>${midiName(b.midi)}</b>, held, with vibrato.`;
}

// ---- listening ----
// One analyser on the shared input, read on a timer; the tuner and the bend check each
// take the readings their own way. Leaving the view, or the input being let go, stops it.
function pitchToggle(mode) {
  if (state.pitch && state.pitch.mode === mode) { pitchStop(); return; }
  if (state.pitch) pitchStop();
  const a = audio(), ac = a && a.context;
  const say = msg => { document.getElementById(mode === "tuner" ? "tunerread" : "bendstatus").textContent = msg; };
  if (!ac || !ac.createAnalyser) { say("Listening needs the Web Audio sound engine, which this browser has switched off."); return; }
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    say("This browser gives the page no audio input. Open the desk from the app, or over https."); return; }
  const p = state.pitch = { mode, readings: [], trace: [], quiet: 0, t0: null, timer: null, an: null, node: null };
  pitchButtons();
  say("Opening the input…");
  acquireInput(true).then(stream => {
    if (state.pitch !== p) return;
    const n = inputNode(ac, stream, state.recChannel);
    // 2048 samples (46 ms at 44.1 kHz) holds two periods of the low E, and is short
    // enough not to average away vibrato: a 4096 frame read a 25-cent wobble as 16.
    p.an = ac.createAnalyser(); p.an.fftSize = 2048; p.buf = new Float32Array(2048);
    n.link(p.an); p.node = n;
    say(mode === "tuner" ? "Listening. Play one open string." : "Listening. Play the fretted note, then bend it.");
    p.timer = setInterval(() => pitchTick(p, ac), TUNE_TICK_MS);
  }).catch(err => {
    if (state.pitch === p) state.pitch = null;
    pitchButtons();
    say(err && err.name === "NotAllowedError" ? "The browser was refused the microphone. Allow it for this page and try again."
      : "Couldn't open the input: " + (err && err.message || err));
  });
}
function pitchStop() {
  const p = state.pitch;
  if (!p) return;
  state.pitch = null;
  clearInterval(p.timer);
  try { if (p.node) p.node.src.disconnect(); } catch (e) { /* already gone */ }
  if (p.mode === "bend") bendFinish(p);
  pitchButtons();
  if (typeof inputIdle === "function") inputIdle();
}
function pitchButtons() {
  const m = state.pitch && state.pitch.mode;
  [["tunelisten", "tuner"], ["bendlisten", "bend"]].forEach(([id, mode]) => {
    const b = document.getElementById(id);
    b.textContent = m === mode ? "Stop listening" : "Start listening";
    b.setAttribute("aria-pressed", m === mode);
  });
}
function pitchTick(p, ac) {
  if (state.pitch !== p || !p.an) return;
  p.an.getFloatTimeDomainData(p.buf);
  const r = detectPitch(p.buf, ac.sampleRate);
  const hz = r && r.clarity > 0.85 ? r.hz : null;
  if (p.mode === "tuner") tunerReading(p, hz); else bendReading(p, hz, ac.currentTime);
}

// ---- the tuner ----
// The median of the last five readings, so one stray frame doesn't flick the needle.
function tunerReading(p, hz) {
  if (!hz) { if (++p.quiet > 20) { p.readings = []; paintTuner(null); } return; }
  p.quiet = 0;
  p.readings.push(hz); if (p.readings.length > 5) p.readings.shift();
  const s = [...p.readings].sort((a, b) => a - b), mid = s[s.length >> 1];
  paintTuner(tunerTarget(mid, tuneTuning().midi), noteOf(mid));
}
function paintTuner(tg, heard) {
  const host = document.getElementById("tunerread");
  const c = tg ? Math.max(-50, Math.min(50, tg.cents)) : 0, x = 150 + c * 2.6;
  const col = !tg ? "var(--rule)" : Math.abs(tg.cents) <= 5 ? "var(--blue)" : Math.abs(tg.cents) <= 15 ? "var(--gold)" : "var(--pink)";
  host.innerHTML = `<svg viewBox="0 0 300 70" width="300" height="70" role="img" aria-label="${tg ? `String ${tg.string}, ${tg.name}: ${Math.round(tg.cents)} cents, ${tg.say}` : "No note heard"}">
      <rect x="137" y="10" width="26" height="30" fill="var(--blue)" opacity=".12"/>
      ${[-50, -25, 0, 25, 50].map(v => `<line x1="${150 + v * 2.6}" x2="${150 + v * 2.6}" y1="${v ? 18 : 8}" y2="42" stroke="currentColor" opacity=".35"/>
        <text x="${150 + v * 2.6}" y="56" font-size="9" text-anchor="middle" fill="currentColor" opacity=".55">${v > 0 ? "+" + v : v}</text>`).join("")}
      ${tg ? `<line x1="${x}" x2="${x}" y1="4" y2="46" stroke="${col}" stroke-width="4" stroke-linecap="round"/>` : ""}
    </svg>
    <div class="tunernote" style="color:${col}">${tg ? `${tg.name}<small>string ${tg.string}</small>` : "&nbsp;"}</div>
    <div class="tip">${tg ? `<b>${tg.say}</b> · ${tg.cents > 0 ? "+" : ""}${Math.round(tg.cents)} cents · hearing ${heard.name}${heard.octave}, ${Math.round(440 * Math.pow(2, (heard.midi + heard.cents / 100 - 69) / 12) * 10) / 10} Hz`
      : state.pitch && state.pitch.mode === "tuner" ? "Play one open string and let it ring." : "Press Start listening, then play one open string."}</div>`;
}

// ---- the bend check ----
// Every reading goes on a trace, in semitones above the fretted note. A note is over when
// the pitch has been gone for a moment; then the whole note is checked.
function bendReading(p, hz, now) {
  const b = bendSpec();
  if (hz) {
    const st = 12 * Math.log2(hz / midiFreq(b.midi));
    // an octave slip or the next string ringing: not part of this bend
    if (st < -1.5 || st > b.by + 2.5) return;
    if (p.t0 === null) p.t0 = now;
    p.trace.push({ t: now - p.t0, st }); p.quiet = 0;
    if (now - p.t0 > BEND_MAX_S) { bendFinish(p); return; }
    // drawn only while a note sounds, so the last bend stays up until the next begins
    document.getElementById("bendtrace").innerHTML = bendSvg(p.trace, b.by);
  } else if (p.trace.length && ++p.quiet * TUNE_TICK_MS / 1000 >= BEND_SILENCE_S) {
    bendFinish(p);
  }
}
function bendReset() {
  const p = state.pitch;
  if (p && p.mode === "bend") { p.trace = []; p.t0 = null; p.quiet = 0; }
}
// Checks the note just played, keeps the result, and gets ready for the next one.
function bendFinish(p) {
  const tr = p.trace, b = bendSpec();
  p.trace = []; p.t0 = null; p.quiet = 0;
  if (!tr.length || tr[tr.length - 1].t < BEND_MIN_S) return null;
  document.getElementById("bendtrace").innerHTML = bendSvg(tr, b.by);
  const bend = b.by ? bendReport(tr, b.by) : null;
  // the held part: from reaching the target, staying near where it landed
  const at = bend && bend.at !== undefined ? bend.at : 0;
  const from = tr.findIndex(x => x.st >= b.by - 0.5);
  const held = from < 0 ? [] : tr.slice(from).filter(x => Math.abs(x.st - at) < 1);
  const vib = vibratoReport(held.slice(Math.min(3, held.length)));
  const out = { d: dayKey(new Date()), by: b.by, s: b.s, f: b.f,
    verdict: b.by ? bend.verdict : "held", cents: bend ? Math.round(bend.cents) : null,
    rate: vib ? Math.round(vib.rate * 10) / 10 : null, width: vib ? Math.round(vib.width) : null, steady: vib ? vib.steady : null };
  document.getElementById("bendstatus").innerHTML = bendSentence(out, bend);
  writeBends([out, ...readBends()]);
  markToday(); renderBendLog();
  if (typeof renderToday === "function") renderToday();
  return out;
}
function bendSentence(o, bend) {
  const parts = [];
  if (o.by) parts.push(o.verdict === "not reached"
    ? `<b>Not reached</b>: it got ${Math.round(bend.peak * 100)} cents up of ${o.by * 100}. Push further, with more fingers behind the one bending.`
    : o.verdict === "in tune" ? `<b>In tune</b>: landed ${o.cents > 0 ? "+" : ""}${o.cents} cents from the target.`
    : `<b>${o.verdict === "flat" ? "Flat" : "Sharp"}</b> by ${Math.abs(o.cents)} cents. ${o.verdict === "flat" ? "Push a little further." : "Ease off a little."}`);
  parts.push(o.rate ? `Vibrato ${o.rate} a second, ${o.width} cents either side, ${o.steady ? "an even speed" : "the speed wandering: slow it down and make each one the same"}.`
    : "No vibrato heard. Hold the note and try a slow, even one.");
  return parts.join(" ");
}
function renderBendLog() {
  const log = readBends(), host = document.getElementById("bendlog");
  const bends = log.filter(x => x.by).slice(0, 10), good = bends.filter(x => x.verdict === "in tune").length;
  host.innerHTML = (bends.length ? `<li><span>Last ${bends.length} bends</span><span><b>${good}</b> in tune</span></li>` : "")
    + log.slice(0, 5).map(x => `<li><span>${x.by ? `${["", "½", "whole", "1½"][x.by]} step, string ${x.s + 1} fret ${x.f}` : `vibrato, string ${x.s + 1} fret ${x.f}`}</span><span>${
      escapeHTML(x.by ? (x.verdict === "not reached" ? "not reached" : `${x.verdict}${x.cents !== null ? ` (${x.cents > 0 ? "+" : ""}${x.cents})` : ""}`) : "")}${x.rate ? ` · ${x.rate}/s` : ""}</span></li>`).join("");
}
// The last few seconds of the note, drawn: the fretted note and the target as lines, the
// in-tune band around the target shaded, and where the pitch went.
function bendSvg(tr, by) {
  const W = 520, H = 150, lo = -0.5, hi = Math.max(by, 0) + 1, span = 4;
  const t1 = tr.length ? Math.max(span, tr[tr.length - 1].t) : span, t0 = t1 - span;
  const X = t => 30 + (t - t0) / span * (W - 40), Y = st => 10 + (hi - st) / (hi - lo) * (H - 30);
  const pts = tr.filter(p => p.t >= t0).map(p => `${X(p.t).toFixed(1)},${Y(p.st).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px" role="img" aria-label="Pitch of the note over the last four seconds">
    ${by ? `<rect x="30" y="${Y(by + 0.15)}" width="${W - 40}" height="${Y(by - 0.15) - Y(by + 0.15)}" fill="var(--blue)" opacity=".13"/>` : ""}
    <line x1="30" x2="${W - 10}" y1="${Y(0)}" y2="${Y(0)}" stroke="currentColor" opacity=".3" stroke-dasharray="3 3"/>
    <text x="4" y="${Y(0) + 3}" font-size="9" fill="currentColor" opacity=".6">fret</text>
    ${by ? `<line x1="30" x2="${W - 10}" y1="${Y(by)}" y2="${Y(by)}" stroke="var(--blue)" stroke-dasharray="5 3"/>
    <text x="4" y="${Y(by) + 3}" font-size="9" fill="var(--blue)">target</text>` : ""}
    ${pts ? `<polyline points="${pts}" fill="none" stroke="var(--pink)" stroke-width="2" stroke-linejoin="round"/>` : ""}
  </svg>`;
}
