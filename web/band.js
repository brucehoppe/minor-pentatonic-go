/*
 * Backing band for the 12-bar trainer: drums and bass, synthesised live. No
 * samples, no network.
 *
 * Two halves. The score is pure: beatEvents() says what the band plays in one beat
 * — which drum, which bass note, how far into the beat, how loud — from the feel,
 * the swing and the chord. The tests check the grid, the swing and the chords from
 * that alone. The voices turn events into sound on a Web Audio context, each part
 * into its own gain so the app can mix and mute them.
 *
 * Every event's time is a fraction of a beat, so it lands on the same audio-clock
 * grid the trainer's beats are booked on. CSP-safe: no inline anything.
 * Exposes globalThis.Band.
 */
(function (root) {
  'use strict';

  // A beat is a quarter of a bar in every feel, so the trainer's four-beat bars,
  // count-in and readout work unchanged. Slow blues counts its 12/8 as four dotted
  // quarters, each split into three.
  const FEELS = {
    shuffle: { name: 'Shuffle', swing: true, hint: 'swung 8ths, kick on 1 and 3, backbeat on 2 and 4' },
    straight: { name: 'Straight rock', swing: true, hint: 'even 8ths unless you swing them' },
    slow: { name: 'Slow blues 12/8', swing: false, hint: 'three triplets a beat: the swing is built in' },
    funk: { name: 'Funk 16ths', swing: true, hint: 'sixteenths on the hat, swing pushes the in-between ones' }
  };
  const SWING_MIN = 0.5;    // straight
  const SWING_TRIPLET = 2 / 3;
  const SWING_MAX = 0.75;   // hard shuffle

  const clampSwing = (s) => Math.min(SWING_MAX, Math.max(SWING_MIN, Number(s) || SWING_MIN));

  // Where the offbeat 8th falls, as a fraction of the beat: 0.5 is straight, 2/3 a
  // triplet shuffle. In funk the same ratio applies inside each 8th, to the 16ths.
  function offbeat(swing) { return clampSwing(swing); }
  function sixteenths(swing) {
    const s = clampSwing(swing);
    return [0, s / 2, 0.5, 0.5 + s / 2];
  }

  // The drum pattern for one beat (0–3) of the bar.
  function drumBeat(feel, beat, swing, ride) {
    const out = [];
    const cym = ride ? 'ride' : 'hat';
    const hit = (voice, at, vol) => out.push({ part: 'drums', voice, at, vol });
    const back = beat === 1 || beat === 3;
    if (feel === 'slow') {
      [0, 1 / 3, 2 / 3].forEach((at, i) => hit(cym, at, i === 0 ? 0.55 : 0.32));
      if (beat === 0 || beat === 2) hit('kick', 0, 0.9);
      if (beat === 2) hit('kick', 2 / 3, 0.5);
      if (back) hit('snare', 0, 0.75);
    } else if (feel === 'funk') {
      sixteenths(swing).forEach((at, i) => hit(cym, at, i === 0 ? 0.5 : i === 2 ? 0.4 : 0.26));
      if (beat === 0) { hit('kick', 0, 0.95); hit('kick', sixteenths(swing)[3], 0.6); }
      if (beat === 2) hit('kick', 0.5, 0.8);
      if (back) hit('snare', 0, 0.8);
      if (beat === 3) hit('snare', sixteenths(swing)[3], 0.25);   // a ghost note into bar 1
    } else {
      hit(cym, 0, 0.5);
      hit(cym, offbeat(swing), 0.3);
      if (beat === 0 || beat === 2) hit('kick', 0, 0.9);
      if (feel === 'straight' && beat === 2) hit('kick', offbeat(swing), 0.55);
      if (back) hit('snare', 0, 0.75);
    }
    return out;
  }

  // Bass lines, as intervals above the chord's root. The walk is the classic
  // shuffle line — root, 5th, 6th, ♭7 — with a minor chord taking its ♭7 and octave
  // instead, and a diminished one walking its own tones.
  function walkFor(intervals) {
    const has = (i) => intervals.includes(i);
    if (has(3) && has(6)) return [0, 3, 6, 9];
    if (has(3)) return [0, 7, 10, 12];
    return [0, 7, 9, 10];
  }

  // Root of the bass note: the chord's pitch class placed between A1 and G#2.
  const bassRoot = (pc) => 33 + (((pc - 9) % 12) + 12) % 12;

  /**
   * One beat's bass. step: the beat since this chord began in the bar (0–3), so a
   * chord that arrives on beat 3 of a split bar starts its line from the root.
   * style: 'walk' (root–5–6–♭7, swung 8ths in shuffle feels) or 'root5'.
   */
  function bassBeat(feel, step, swing, chord, style, beatSec) {
    const r = bassRoot(chord.pc);
    const out = [];
    const note = (midi, at, len, vol) => out.push({ part: 'bass', midi, at, dur: len * beatSec, vol });
    if (style === 'root5') {
      if (step === 0) note(r, 0, 1.8, 0.8);
      if (step === 2) note(r + 7, 0, 1.8, 0.7);
      return out;
    }
    const m = r + walkFor(chord.intervals)[step % 4];
    if (feel === 'slow') {
      note(m, 0, 0.62, 0.8);
      note(m, 2 / 3, 0.3, 0.55);
    } else if (feel === 'funk') {
      note(m, 0, 0.22, 0.85);
      note(m + 12, sixteenths(swing)[3], 0.15, 0.5);
    } else if (feel === 'shuffle') {
      note(m, 0, offbeat(swing) * 0.9, 0.8);
      note(m, offbeat(swing), (1 - offbeat(swing)) * 0.9, 0.55);
    } else {
      // straight rock: even 8ths, unless the slider swings them — with the hat
      note(m, 0, offbeat(swing) * 0.9, 0.8);
      note(m, offbeat(swing), (1 - offbeat(swing)) * 0.9, 0.6);
    }
    return out;
  }

  /**
   * Everything the band plays in one beat.
   *   feel, swing (0.5–0.75), beatSec (seconds a beat), beat (0–3 in the bar)
   *   chord { pc, intervals }: the chord sounding on this beat, pc absolute
   *   step: beats since that chord began in this bar
   *   bass: 'walk' | 'root5', ride: bool
   *   countIn: true while counting in — drums only, a stick click a beat
   * Returns [{ part, voice?, midi?, at (fraction of the beat), dur? (seconds), vol }].
   */
  function beatEvents(o) {
    const feel = FEELS[o.feel] ? o.feel : 'shuffle';
    const swing = FEELS[feel].swing ? clampSwing(o.swing) : SWING_TRIPLET;
    if (o.countIn) return [{ part: 'drums', voice: 'stick', at: 0, vol: o.beat === 0 ? 0.8 : 0.6 }];
    return [
      ...drumBeat(feel, o.beat, swing, !!o.ride),
      ...bassBeat(feel, o.step, swing, o.chord, o.bass === 'root5' ? 'root5' : 'walk', o.beatSec)
    ];
  }

  // ---------- the voices ----------

  const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  /**
   * Voices on a Web Audio context. parts: { drums, bass } — AudioNodes each part's
   * notes go into (the app puts a gain there for its mixer). Times are absolute,
   * on the context's clock.
   */
  function createVoices(ac, parts) {
    let noise = null;
    // One second of white noise, made once, for snare and cymbals.
    function noiseBuffer() {
      if (noise) return noise;
      noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noise.getChannelData(0);
      let seed = 22222;   // a fixed seed: the same kit every time
      for (let i = 0; i < d.length; i++) { seed = (seed * 16807) % 2147483647; d[i] = seed / 1073741823.5 - 1; }
      return noise;
    }
    function env(t, peak, attack, decay) {
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
      return g;
    }
    function noiseHit(t, vol, type, freq, q, decay, out) {
      const src = ac.createBufferSource();
      src.buffer = noiseBuffer();
      const f = ac.createBiquadFilter();
      f.type = type; f.frequency.value = freq; if (q) f.Q.value = q;
      const g = env(t, vol, 0.001, decay);
      src.connect(f); f.connect(g); g.connect(out);
      src.start(t, Math.random() * 0.5); src.stop(t + decay + 0.05);
    }
    // A sine that drops from 150 to 45 Hz: the thump, then the boom.
    function kick(t, vol) {
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      const g = env(t, 0.9 * vol, 0.002, 0.32);
      o.connect(g); g.connect(parts.drums);
      o.start(t); o.stop(t + 0.4);
    }
    // Filtered noise for the wires, plus a short tone for the drum's body.
    function snare(t, vol) {
      noiseHit(t, 0.45 * vol, 'bandpass', 1900, 0.7, 0.16, parts.drums);
      const o = ac.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(160, t + 0.06);
      const g = env(t, 0.35 * vol, 0.001, 0.08);
      o.connect(g); g.connect(parts.drums);
      o.start(t); o.stop(t + 0.12);
    }
    const hat = (t, vol) => noiseHit(t, 0.4 * vol, 'highpass', 7000, 0, 0.05, parts.drums);
    const ride = (t, vol) => noiseHit(t, 0.16 * vol, 'bandpass', 5200, 1.2, 0.35, parts.drums);
    const stick = (t, vol) => noiseHit(t, 0.3 * vol, 'bandpass', 3000, 3, 0.03, parts.drums);
    // A round bass: a sine for the note, a quiet triangle an octave up for definition.
    function bass(midi, t, dur, vol) {
      const f = midiHz(midi);
      const g = env(t, 0.5 * vol, 0.008, Math.max(0.08, dur));
      [['sine', 1, 1], ['triangle', 2, 0.18]].forEach(([type, mult, lvl]) => {
        const o = ac.createOscillator();
        o.type = type; o.frequency.value = f * mult;
        const og = ac.createGain(); og.gain.value = lvl;
        o.connect(og); og.connect(g);
        o.start(t); o.stop(t + dur + 0.1);
      });
      g.connect(parts.bass);
    }
    const drums = { kick, snare, hat, ride, stick };
    return {
      play(e, t) {
        if (e.part === 'drums' && drums[e.voice]) drums[e.voice](t, e.vol);
        else if (e.part === 'bass') bass(e.midi, t, e.dur, e.vol);
      }
    };
  }

  root.Band = { FEELS, SWING_MIN, SWING_TRIPLET, SWING_MAX, clampSwing, offbeat, sixteenths, walkFor, bassRoot, beatEvents, createVoices };
})(typeof globalThis !== 'undefined' ? globalThis : this);
