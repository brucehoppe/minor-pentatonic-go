// The landing drill, on the 12-bar trainer: while the band plays, it listens to the
// guitar and, on beat 1 of every bar, asks one question: is the note you are sounding
// in the chord that bar starts on? Following the changes is mostly that, arriving on a
// chord tone when the chord arrives. It reads the input that the recorder and the tuner
// share, with the pitch maths of web/pitch.js. Loaded before app.js, and only called
// once the page is up, so app.js's state and helpers are there by then.

const LANDING_KEY = "minor-pentatonic-landing-v1";
const LANDING_TICK_MS = 25;
// The note has to be sounding around the downbeat: from a little before it (you may
// arrive early) to a third of a second after (the reading trails the string slightly).
const LANDING_BEFORE_S = 0.08, LANDING_AFTER_S = 0.35;
const LANDING_MIN_READINGS = 3;   // fewer than this was a stray noise, not a note
const LANDING_TONES = ["root", "3rd", "5th", "7th"];

function readLanding() {
  try { const v = JSON.parse(window.localStorage.getItem(LANDING_KEY) || "[]");
    return Array.isArray(v) ? v.filter(x => x && typeof x === "object" && Number.isFinite(x.hit) && Number.isFinite(x.of)) : []; }
  catch (e) { return []; }
}
function writeLanding(v) { try { window.localStorage.setItem(LANDING_KEY, JSON.stringify(v.slice(0, 30))); } catch (e) { /* this visit only */ } }

// What was sounding on a downbeat at time `at`, and whether it is in the chord.
// readings are {t, midi} on the audio clock; chord is {pc, intervals}. The pitch class
// heard most in the window wins, so the note you arrive on counts, not the one you left.
function landingJudge(readings, at, chord) {
  const counts = new Map();
  let n = 0;
  readings.forEach(r => {
    if (r.t < at - LANDING_BEFORE_S || r.t > at + LANDING_AFTER_S) return;
    const pc = ((Math.round(r.midi) % 12) + 12) % 12;
    counts.set(pc, (counts.get(pc) || 0) + 1); n++;
  });
  if (n < LANDING_MIN_READINGS) return { silent: true };
  const pc = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const i = chord.intervals.indexOf(((pc - chord.pc) % 12 + 12) % 12);
  const tone = i < 0 ? null : chord.intervals.length > 3 && chord.intervals[3] === 9 && i === 3 ? "6th" : LANDING_TONES[i];
  return { pc, tone, hit: i >= 0 };
}

function landingSay(html) { const el = document.getElementById("landingstatus"); if (el) el.innerHTML = html; }
function landingButton() {
  const b = document.getElementById("landingtoggle"); if (!b) return;
  b.textContent = state.landing ? "Stop listening" : "Landing drill: listen";
  b.setAttribute("aria-pressed", !!state.landing);
}

function landingToggle() {
  if (state.landing) { landingStop(); landingSay(landingBest()); return; }
  const a = audio(), ac = a && a.context;
  if (!ac || !ac.createAnalyser) { landingSay("Listening needs the Web Audio sound engine, which this browser has switched off."); return; }
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    landingSay("This browser gives the page no audio input. Open the desk from the app, or over https."); return; }
  const L = state.landing = { readings: [], pending: [], marks: [], timer: null, an: null, node: null };
  landingButton();
  landingSay("Opening the input…");
  acquireInput(false).then(stream => {
    if (state.landing !== L) return;
    const n = inputNode(ac, stream, state.recChannel);
    L.an = ac.createAnalyser(); L.an.fftSize = 2048; L.buf = new Float32Array(2048);
    n.link(L.an); L.node = n;
    landingSay(state.trainerTimer ? "Listening. Land on a chord tone on beat 1 of each bar."
      : "Listening. Start the trainer, and land on a chord tone on beat 1 of each bar. Use headphones, or an interface: a microphone hears the band too.");
    L.timer = setInterval(() => landingTick(L, ac), LANDING_TICK_MS);
  }).catch(err => {
    if (state.landing === L) state.landing = null;
    landingButton();
    landingSay(err && err.name === "NotAllowedError" ? "The browser was refused the microphone. Allow it for this page and try again."
      : "Couldn't open the input: " + (err && err.message || err));
  });
}
function landingStop() {
  const L = state.landing;
  if (!L) return;
  state.landing = null;
  clearInterval(L.timer);
  try { if (L.node) L.node.src.disconnect(); } catch (e) { /* already gone */ }
  landingButton();
  if (typeof inputIdle === "function") inputIdle();
}

// The trainer calls this as it books beat 1 of a bar, `when` seconds ahead of it.
function landingBar(bar, chord, when) {
  const L = state.landing, a = audio();
  if (!L || !a || !a.now) return;
  if (bar === 0) { landingChorusDone(L); L.marks = []; }
  // a bar "changes" when it starts on a different chord from the one just before it
  const form = currentForm().chords, before = barSymbols(form[(bar + 11) % 12]);
  const change = before[before.length - 1] !== barSymbols(form[bar])[0];
  // the guitar arrives late by the input's latency, so look that much later
  L.pending.push({ bar, chord, change, at: a.now() + when + (state.cal ? state.cal.ms / 1000 : 0) });
}
function landingTick(L, ac) {
  if (state.landing !== L || !L.an) return;
  L.an.getFloatTimeDomainData(L.buf);
  const r = detectPitch(L.buf, ac.sampleRate), now = ac.currentTime;
  if (r && r.clarity > 0.85 && r.hz > 0) L.readings.push({ t: now, midi: 69 + 12 * Math.log2(r.hz / 440) });
  while (L.readings.length && L.readings[0].t < now - 3) L.readings.shift();
  while (L.pending.length && now > L.pending[0].at + LANDING_AFTER_S) {
    const p = L.pending.shift();
    L.marks[p.bar] = { ...landingJudge(L.readings, p.at, p.chord), change: p.change };
    // the chorus just finished stays in view while the next one fills in
    landingSay(landingLine(landingScore(L.marks), "This chorus") + (L.last ? " " + L.last : ""));
  }
}

function landingScore(marks) {
  const played = marks.filter(m => m && !m.silent), ch = played.filter(m => m.change);
  return { hit: played.filter(m => m.hit).length, of: played.length, rests: marks.filter(m => m && m.silent).length,
    chHit: ch.filter(m => m.hit).length, chOf: ch.length };
}
function landingLine(s, label) {
  if (!s.of) return `${label}: nothing heard on a beat 1 yet.`;
  return `${label}: chord tones on beat 1, <b>${s.hit} of ${s.of}</b>`
    + (s.chOf ? ` · on the changes, ${s.chHit} of ${s.chOf}` : "")
    + (s.rests ? ` · ${s.rests} ${s.rests === 1 ? "rest" : "rests"}` : "") + ".";
}
// A whole chorus is kept; a chorus the trainer was stopped in is not.
function landingChorusDone(L) {
  if (L.marks.filter(Boolean).length < 12) return;
  const s = landingScore(L.marks);
  if (!s.of) return;
  writeLanding([{ d: dayKey(new Date()), form: document.getElementById("bluesform").value, key: state.key, bpm: state.bpm,
    hit: s.hit, of: s.of, chHit: s.chHit, chOf: s.chOf }, ...readLanding()]);
  markToday();
  L.last = landingLine(s, "Last chorus") + " " + landingBest();
  landingSay(L.last);
}
function landingBest() {
  const full = readLanding().filter(x => x.of >= 8);
  if (!full.length) return "";
  const best = full.reduce((a, b) => b.hit / b.of > a.hit / a.of ? b : a);
  return `Best so far: ${best.hit} of ${best.of}.`;
}
// The mark the trainer draws in a bar: the tone you landed on, the note you missed
// with, or a rest. Resting on beat 1 is a musical choice, so it is not a miss.
function landingMark(bar) {
  const L = state.landing, m = L && L.marks[bar];
  if (!m) return "";
  if (m.silent) return `<i class="land rest">rest</i>`;
  return m.hit ? `<i class="land hit">${m.tone}</i>` : `<i class="land miss">${escapeHTML(ROOT_NAMES[m.pc])}: not in the chord</i>`;
}
