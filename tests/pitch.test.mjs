import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// web/pitch.js is plain functions on samples and numbers; load it as the page does.
const ctx = vm.createContext({ Math, Float32Array, Number, Array, Infinity });
vm.runInContext(readFileSync(new URL("../web/pitch.js", import.meta.url), "utf8") +
  "\n;globalThis.P={detectPitch,noteOf,tunerTarget,bendReport,vibratoReport,TUNER_TUNINGS};", ctx);
const P = ctx.P;
const SR = 48000;

// A plucked-string stand-in: a fundamental plus decaying harmonics, the fundamental
// deliberately no louder than the 2nd harmonic, which is what fools a naive detector
// into reading an octave up.
function tone(hz, seconds = 0.1, { amp = 0.5, h = [0.6, 0.7, 0.4, 0.3, 0.2], noise = 0 } = {}) {
  const n = Math.round(SR * seconds), x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    h.forEach((a, k) => { v += a * Math.sin(2 * Math.PI * hz * (k + 1) * i / SR); });
    x[i] = amp * v / 2 + (noise ? noise * (Math.random() * 2 - 1) : 0);
  }
  return x;
}
const cents = (a, b) => 1200 * Math.log2(a / b);

test("detectPitch reads every open string and a high fretted note within 3 cents", () => {
  for (const hz of [82.41, 110, 146.83, 196, 246.94, 329.63, 659.26, 1046.5]) {
    const r = P.detectPitch(tone(hz, 0.1), SR);
    assert.ok(r, `a pitch for ${hz} Hz`);
    assert.ok(Math.abs(cents(r.hz, hz)) < 3, `${hz} Hz read as ${r.hz.toFixed(2)}`);
    assert.ok(r.clarity > 0.8, `clear at ${hz} Hz (${r.clarity})`);
  }
});

test("detectPitch works on the page's 2048-sample frame, low E included", () => {
  for (const hz of [82.41, 110, 329.63, 1318.5]) {
    const r = P.detectPitch(tone(hz, 2048 / SR), SR);
    assert.ok(r && Math.abs(cents(r.hz, hz)) < 3, `${hz} Hz read as ${r && r.hz}`);
  }
});

test("detectPitch hears nothing in silence or noise, and survives some noise on a note", () => {
  assert.equal(P.detectPitch(new Float32Array(4096), SR), null);
  const noise = Float32Array.from({ length: 4096 }, () => 0.3 * (Math.random() * 2 - 1));
  assert.equal(P.detectPitch(noise, SR), null);
  const r = P.detectPitch(tone(196, 0.1, { noise: 0.05 }), SR);
  assert.ok(r && Math.abs(cents(r.hz, 196)) < 5);
});

test("noteOf names the nearest note and how far off it is", () => {
  const a = P.noteOf(440);
  assert.equal(a.name, "A"); assert.equal(a.midi, 69); assert.ok(Math.abs(a.cents) < 0.01);
  const flat = P.noteOf(440 * Math.pow(2, -20 / 1200));
  assert.equal(flat.name, "A"); assert.ok(Math.abs(flat.cents + 20) < 0.01);
  assert.equal(P.noteOf(82.41).name, "E"); assert.equal(P.noteOf(82.41).octave, 2);
});

test("tunerTarget picks the string you are tuning and says which way to turn", () => {
  const std = P.TUNER_TUNINGS.find(t => t.id === "standard");
  const low = P.tunerTarget(82.41 * Math.pow(2, -30 / 1200), std.midi);
  assert.equal(low.string, 6); assert.ok(low.cents < -25); assert.equal(low.say, "tune up");
  const b = P.tunerTarget(246.94 * Math.pow(2, 12 / 1200), std.midi);
  assert.equal(b.string, 2); assert.equal(b.say, "tune down");
  const g = P.tunerTarget(196, std.midi);
  assert.equal(g.string, 3); assert.equal(g.say, "in tune");
  // a D string tuned a whole step low is still the D string being tuned, not the A
  const dropD = P.TUNER_TUNINGS.find(t => t.id === "drop-d");
  assert.equal(P.tunerTarget(73.42, dropD.midi).string, 6);
  assert.equal(P.tunerTarget(73.42, dropD.midi).say, "in tune");
});

// A pitch trace, as the page keeps it: {t, st} with st in semitones above the fretted note.
const trace = (seconds, fn, rate = 50) =>
  Array.from({ length: Math.round(seconds * rate) }, (_, i) => ({ t: i / rate, st: fn(i / rate) }));

test("bendReport: a whole-step bend that lands 8 cents flat is in tune; a lazy one is flat", () => {
  // fretted note for 0.3 s, a 0.15 s rise, then held at +1.92 semitones
  const good = trace(1.2, t => t < 0.3 ? 0 : t < 0.45 ? 1.92 * (t - 0.3) / 0.15 : 1.92);
  const r = P.bendReport(good, 2);
  assert.ok(Math.abs(r.cents + 8) < 1.5, `landed ${r.cents} cents`);
  assert.equal(r.verdict, "in tune");
  const lazy = trace(1.2, t => t < 0.3 ? 0 : t < 0.5 ? 1.6 * (t - 0.3) / 0.2 : 1.6);
  const l = P.bendReport(lazy, 2);
  assert.ok(Math.abs(l.cents + 40) < 1.5); assert.equal(l.verdict, "flat");
  assert.ok(Math.abs(P.bendReport(trace(1, t => t < 0.2 ? 0 : 2.4), 2).cents - 40) < 1.5);
  // never got near: says how far it got instead of inventing a landing
  const short = P.bendReport(trace(1, t => t < 0.3 ? 0 : 0.6), 2);
  assert.equal(short.verdict, "not reached"); assert.ok(Math.abs(short.peak - 0.6) < 0.01);
  assert.equal(P.bendReport([], 2), null);
});

test("bendReport: vibrato on top of the bend doesn't move where it landed", () => {
  const vib = trace(1.5, t => t < 0.3 ? 0 : 2 + (t > 0.5 ? 0.25 * Math.sin(2 * Math.PI * 6 * t) : 0));
  const r = P.bendReport(vib, 2);
  assert.ok(Math.abs(r.cents) < 6, `centre ${r.cents}`);
});

test("vibratoReport measures rate and width, and hears uneven speed", () => {
  const even = trace(1.5, t => 0.3 * Math.sin(2 * Math.PI * 5.5 * t));
  const r = P.vibratoReport(even);
  assert.ok(Math.abs(r.rate - 5.5) < 0.3, `rate ${r.rate}`);
  assert.ok(Math.abs(r.width - 30) < 6, `width ${r.width}`);
  assert.equal(r.steady, true);
  // speed drifting from 4 to 8 Hz across the note
  let ph = 0; const uneven = trace(1.5, t => { ph += 2 * Math.PI * (4 + 4 * t / 1.5) / 50; return 0.3 * Math.sin(ph); });
  assert.equal(P.vibratoReport(uneven).steady, false);
  // a held note with no vibrato to speak of
  assert.equal(P.vibratoReport(trace(1.5, () => 0.01 * Math.sin(40 * 0))), null);
  assert.equal(P.vibratoReport(trace(0.2, t => 0.3 * Math.sin(2 * Math.PI * 5 * t))), null);
});
