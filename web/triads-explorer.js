/*
 * Triads explorer: how a triad is built, how one fret changes its quality, and
 * where triads hide inside barre chords.
 *
 * Built on chord-explorer.js (load it first). CSP-safe: no inline scripts, no
 * inline styles, no on… attributes.
 * Exposes globalThis.TriadsExplorer = { chordTones, findMajorGrips,
 * gripInQuality, barreChord, barreWindows, QUALITIES, STRING_SETS, NOTE_NAMES, mount }.
 */
(function (root) {
  'use strict';

  const X = root.ChordExplorer;
  const { NOTE_NAMES, OPEN_MIDI, STRING_NAMES, MAX_FRET, ROLE_CLASSES, INVERSION_NAMES, QUALITIES, STRING_SETS, h, esc, mod12, chordTones, findGrips } = X;
  const THIRD_NAMES = { 3: 'minor 3rd', 4: 'major 3rd' };

  /**
   * The same grip in another quality: move the 3rd and/or 5th by the difference
   * from major. Returns { strings, frets, midi, roles, inversion, moved }, where
   * moved lists { index, delta } for each string whose note changed.
   */
  function gripInQuality(majorGrip, quality) {
    const q = QUALITIES[quality].intervals;
    const shift = [0, q[1] - 4, q[2] - 7];
    const moved = [];
    const frets = majorGrip.frets.map((f, k) => {
      const d = shift[majorGrip.roles[k]];
      if (d !== 0) moved.push({ index: k, delta: d });
      return f + d;
    });
    const midi = majorGrip.midi.map((m, k) => m + shift[majorGrip.roles[k]]);
    return { strings: majorGrip.strings.slice(), frets, midi, roles: majorGrip.roles.slice(), inversion: majorGrip.inversion, moved };
  }

  /**
   * Close-voiced major grips on one string set whose minor, dim and aug versions
   * also fit on the neck (every fret 0–16), low to high: the grips that can show
   * all four qualities.
   */
  function findMajorGrips(rootPc, setIndex) {
    return findGrips(rootPc, 'major', setIndex).filter((grip) =>
      Object.keys(QUALITIES).every((q) => gripInQuality(grip, q).frets.every((f) => f >= 0 && f <= MAX_FRET)));
  }

  /**
   * Full barre chord, E shape (root on the low E string) or A shape (root on the
   * A string), major or minor. frets[s] is null for an unplayed string; roles[s]
   * is 0/1/2 or null.
   */
  function barreChord(rootPc, quality, shape) {
    let frets;
    if (shape === 'E') {
      let r = mod12(rootPc - 4);
      if (r === 0) r = 12;
      frets = quality === 'minor' ? [r, r + 2, r + 2, r, r, r] : [r, r + 2, r + 2, r + 1, r, r];
    } else {
      let r = mod12(rootPc - 9);
      if (r === 0) r = 12;
      frets = quality === 'minor' ? [null, r, r + 2, r + 2, r + 1, r] : [null, r, r + 2, r + 2, r + 2, r];
    }
    const tones = chordTones(rootPc, quality);
    const midi = frets.map((f, s) => (f === null ? null : OPEN_MIDI[s] + f));
    const roles = midi.map((m) => (m === null ? null : tones.indexOf(mod12(m))));
    return { shape, quality, frets, midi, roles };
  }

  /** Every three-adjacent-string window of a barre chord, low to high. */
  function barreWindows(chord) {
    const out = [];
    for (let s = 0; s <= 3; s++) {
      const strings = [s, s + 1, s + 2];
      if (strings.some((k) => chord.frets[k] === null)) continue;
      const roles = strings.map((k) => chord.roles[k]);
      const isTriad = new Set(roles).size === 3;
      out.push({ strings, roles, isTriad, inversion: isTriad ? roles[0] : null });
    }
    return out;
  }

  // ---------- One-string ruler (Build it) ----------

  const RULER_X0 = 30;
  const CELL = 26;
  const rulerX = (n) => RULER_X0 + n * CELL;

  function rulerMarkup(key, quality) {
    const iv = QUALITIES[quality].intervals;
    const names = QUALITIES[quality].roleNames;
    let out = '';
    const y = 62;
    out += `<line class="cx-string cx-active" x1="${rulerX(0) - 13}" y1="${y}" x2="${rulerX(12) + 13}" y2="${y}"/>`;
    for (let n = 0; n <= 13; n++) {
      out += `<line class="cx-fret" x1="${rulerX(n) - 13}" y1="${y - 14}" x2="${rulerX(n) - 13}" y2="${y + 14}"/>`;
    }
    // Brackets: root→3rd and 3rd→5th above, root→5th below.
    const bracket = (a, b, by, up, label, cls) => {
      const x1 = rulerX(a);
      const x2 = rulerX(b);
      const tip = up ? by + 6 : by - 6;
      const ty = up ? by - 6 : by + 14;
      return `<path class="cx-bracket ${cls}" d="M${x1} ${tip} L${x1} ${by} L${x2} ${by} L${x2} ${tip}" fill="none"/>` +
        `<text class="cx-bracket-label ${cls}" x="${(x1 + x2) / 2}" y="${ty}" text-anchor="middle">${esc(label)}</text>`;
    };
    out += bracket(0, iv[1], 34, true, `+${iv[1]}`, 'cx-third');
    out += bracket(iv[1], iv[2], 34, true, `+${iv[2] - iv[1]}`, 'cx-fifth');
    out += bracket(0, iv[2], 90, false, `root to ${names[2]}: ${iv[2]} frets`, 'cx-neutral');
    for (let n = 0; n <= 12; n++) {
      const role = iv.indexOf(n);
      const name = NOTE_NAMES[mod12(key + n)];
      if (role >= 0) out += X.marker(rulerX(n), y, role, 'cx-current', name);
      else out += `<text class="cx-small" x="${rulerX(n)}" y="${y}" text-anchor="middle" dominant-baseline="central">${n}</text>`;
    }
    return out;
  }

  // ---------- Component ----------

  const MODES = [
    { id: 'build', label: 'Build it' },
    { id: 'change', label: 'Change one note' },
    { id: 'barre', label: 'Inside barre chords' }
  ];

  /**
   * mount(el, options) → { setKey(pc), destroy() }
   *   options.key         initial root pitch class, default 7 (G)
   *   options.playNotes   function(midiNotes): arpeggiate low to high, then strum
   *   options.showKey     show the explorer's own Key menu (default true)
   *   options.onKeyChange function(pc) when the user changes key here
   *   options.onNavigate  function(view): when given, the explorer links to the
   *                       app's Inversions view ('inv')
   */
  function mount(el, options) {
    const opts = options || {};
    const state = {
      mode: 'build',
      key: Number.isInteger(opts.key) ? mod12(opts.key) : 7,
      quality: 'major',
      barreQuality: 'major',
      set: 0,
      grip: 0,
      shape: 'E',
      window: 0
    };
    const playNotes = typeof opts.playNotes === 'function' ? opts.playNotes : () => {};
    const timers = [];
    const clearTimers = () => { while (timers.length) clearTimeout(timers.pop()); };

    const keySelect = h('select', { 'aria-label': 'Key' }, NOTE_NAMES.map((n, pc) => h('option', { value: String(pc), text: n })));
    const modeButtons = MODES.map((m) => h('button', { type: 'button', 'data-mode': m.id, text: m.label }));
    const controls = h('div', { class: 'cx-controls' });
    const figure = h('div', { class: 'cx-figure' });
    const stack = h('div', { class: 'cx-stack', 'aria-hidden': 'true' });
    const info = h('div', { class: 'cx-info', 'aria-live': 'polite' });
    const transport = h('div', { class: 'cx-row cx-transport' });

    const parts = [h('div', { class: 'cx-row cx-seg', role: 'group', 'aria-label': 'View' }, modeButtons)];
    if (opts.showKey !== false) parts.push(h('div', { class: 'cx-row' }, [h('label', { class: 'cx-key' }, [h('span', { text: 'Key' }), keySelect])]));
    parts.push(controls, X.legend(), figure, h('div', { class: 'cx-readout' }, [stack, info]), transport);
    el.textContent = '';
    el.appendChild(h('div', { class: 'cx' }, parts));

    const para = (cls, text) => h('p', { class: cls, text });
    // A link into the app's Inversions view, only when the app offers one.
    function inversionsLink(text) {
      if (typeof opts.onNavigate !== 'function') return null;
      return X.button(text, () => opts.onNavigate('inv'));
    }
    const qualityItems = Object.keys(QUALITIES).map((q) => [q, QUALITIES[q].label]);

    function renderBuild() {
      const q = QUALITIES[state.quality];
      const iv = q.intervals;
      controls.appendChild(h('div', { class: 'cx-row' }, [X.segButtons('Chord quality', qualityItems, state.quality, (v) => { state.quality = v; render(); })]));
      const s = X.svg(380, 120, 'cx-ruler');
      s.setAttribute('aria-label', `${NOTE_NAMES[state.key]} ${q.name} on one string: root, then ${iv[1]} frets up to the ${q.roleNames[1]}, then ${iv[2] - iv[1]} more to the ${q.roleNames[2]}.`);
      s.innerHTML = rulerMarkup(state.key, state.quality);
      figure.appendChild(s);
      const midis = iv.map((i) => 48 + state.key + i);
      X.fillStack(stack, [0, 1, 2], midis, q.roleNames);
      info.appendChild(para('cx-info-title', `${NOTE_NAMES[state.key]} ${q.name} = ${THIRD_NAMES[iv[1]]} + ${THIRD_NAMES[iv[2] - iv[1]]}`));
      info.appendChild(para('cx-info-meta', `${iv[1]} frets, then ${iv[2] - iv[1]} more. Count them on any string.`));
      transport.appendChild(X.button('Play', () => playNotes(midis)));
    }

    function renderChange() {
      const grips = findMajorGrips(state.key, state.set);
      if (state.grip >= grips.length) state.grip = 0;
      controls.appendChild(h('div', { class: 'cx-row' }, [X.segButtons('Chord quality', qualityItems, state.quality, (v) => { state.quality = v; render(); })]));
      controls.appendChild(h('div', { class: 'cx-row' }, [X.segButtons('Strings', STRING_SETS.map((x, k) => [k, x.label]), state.set, (v) => { state.set = v; state.grip = 0; render(); })]));
      const major = grips[state.grip];
      const s = X.svg(X.VIEW_W, X.VIEW_H, 'cx-board');
      if (!major) {
        s.innerHTML = X.boardMarkup(STRING_SETS[state.set].strings, []);
        figure.appendChild(s);
        info.appendChild(para('cx-info-title', 'No grip fits here. Try another string set.'));
        return;
      }
      const g = gripInQuality(major, state.quality);
      const q = QUALITIES[state.quality];
      const markers = [];
      g.moved.forEach((m) => markers.push({ s: g.strings[m.index], f: major.frets[m.index], role: major.roles[m.index], state: 'cx-was', label: '' }));
      g.frets.forEach((f, k) => markers.push({ s: g.strings[k], f, role: g.roles[k], state: 'cx-current', label: NOTE_NAMES[mod12(g.midi[k])] }));
      s.innerHTML = X.boardMarkup(g.strings, markers);
      s.setAttribute('aria-label', `${NOTE_NAMES[state.key]} ${q.name}, frets ${g.frets.join(', ')} on ${STRING_SETS[state.set].label}.`);
      figure.appendChild(s);
      X.fillStack(stack, g.roles, g.midi, q.roleNames);
      info.appendChild(para('cx-info-title', `${NOTE_NAMES[state.key]} ${q.name}, position ${state.grip + 1} of ${grips.length}`));
      const moves = g.moved.map((m) => `${QUALITIES.major.roleNames[g.roles[m.index]]} ${m.delta < 0 ? 'down' : 'up'} 1 fret`);
      info.appendChild(para('cx-info-meta', moves.length ? `From major: ${moves.join(', ')}. Dashed outline shows where it was.` : 'Major is the starting shape. Pick another quality to see which note moves.'));
      info.appendChild(para('cx-info-meta', `This grip is the ${INVERSION_NAMES[g.inversion]}: the ${q.roleNames[g.roles[0]]} is on the bottom string.`));
      transport.appendChild(X.button('←', () => { state.grip = (state.grip - 1 + grips.length) % grips.length; render(); }, 'Previous position'));
      transport.appendChild(X.button('→', () => { state.grip = (state.grip + 1) % grips.length; render(); }, 'Next position'));
      transport.appendChild(X.button('Play', () => playNotes(g.midi)));
      transport.appendChild(X.button('Play all four', () => {
        clearTimers();
        ['major', 'minor', 'dim', 'aug'].forEach((qq, k) => timers.push(setTimeout(() => {
          state.quality = qq; render(); playNotes(gripInQuality(major, qq).midi);
        }, k * 1800)));
      }));
      const link = inversionsLink('See every grip of this chord in Inversions →');
      if (link) transport.appendChild(link);
    }

    function renderBarre() {
      const chord = barreChord(state.key, state.barreQuality, state.shape);
      const wins = barreWindows(chord);
      if (state.window >= wins.length) state.window = 0;
      const w = wins[state.window];
      controls.appendChild(h('div', { class: 'cx-row' }, [
        X.segButtons('Chord quality', [['major', 'Major'], ['minor', 'Minor']], state.barreQuality, (v) => { state.barreQuality = v; render(); }),
        X.segButtons('Barre shape', [['E', 'E shape'], ['A', 'A shape']], state.shape, (v) => { state.shape = v; state.window = 0; render(); })
      ]));
      const q = QUALITIES[state.barreQuality];
      const markers = [];
      chord.frets.forEach((f, s) => {
        if (f === null) return;
        markers.push({ s, f, role: chord.roles[s], state: w.strings.includes(s) ? 'cx-current' : 'cx-ghost', label: NOTE_NAMES[mod12(chord.midi[s])] });
      });
      const s = X.svg(X.VIEW_W, X.VIEW_H, 'cx-board');
      s.innerHTML = X.boardMarkup(w.strings, markers);
      const sl = w.strings.map((k) => STRING_NAMES[k]).join(' ');
      s.setAttribute('aria-label', `${NOTE_NAMES[state.key]} ${q.name} ${state.shape}-shape barre chord, strings ${sl} highlighted.`);
      figure.appendChild(s);
      X.fillStack(stack, w.roles, w.strings.map((k) => chord.midi[k]), q.roleNames);
      const counts = [0, 0, 0];
      chord.roles.forEach((r) => { if (r !== null) counts[r] += 1; });
      const played = chord.frets.filter((f) => f !== null).length;
      info.appendChild(para('cx-info-title', w.isTriad
        ? `Strings ${sl}: a triad, ${INVERSION_NAMES[w.inversion]}`
        : `Strings ${sl}: no ${q.roleNames[1]}, so not a triad`));
      info.appendChild(para('cx-info-meta', `${played} strings, only 3 notes: root ×${counts[0]}, ${q.roleNames[1]} ×${counts[1]}, ${q.roleNames[2]} ×${counts[2]}.`));
      if (w.isTriad) info.appendChild(para('cx-info-meta', `The ${q.roleNames[w.roles[0]]} is on the bottom of these three strings, which is what makes it the ${INVERSION_NAMES[w.inversion]}.`));
      transport.appendChild(X.button('←', () => { state.window = (state.window - 1 + wins.length) % wins.length; render(); }, 'Previous strings'));
      transport.appendChild(X.button('→', () => { state.window = (state.window + 1) % wins.length; render(); }, 'Next strings'));
      transport.appendChild(X.button('Play these strings', () => playNotes(w.strings.map((k) => chord.midi[k]))));
      transport.appendChild(X.button('Play full chord', () => playNotes(chord.midi.filter((m) => m !== null))));
      const link = w.isTriad ? inversionsLink(`More on the ${INVERSION_NAMES[w.inversion]} in Inversions →`) : null;
      if (link) transport.appendChild(link);
    }

    function render() {
      keySelect.value = String(state.key);
      modeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
      controls.textContent = '';
      figure.textContent = '';
      stack.textContent = '';
      info.textContent = '';
      transport.textContent = '';
      if (state.mode === 'build') renderBuild();
      else if (state.mode === 'change') renderChange();
      else renderBarre();
    }

    modeButtons.forEach((b) => b.addEventListener('click', () => { clearTimers(); state.mode = b.dataset.mode; render(); }));
    keySelect.addEventListener('change', () => {
      state.key = Number(keySelect.value);
      state.grip = 0;
      state.window = 0;
      render();
      if (typeof opts.onKeyChange === 'function') opts.onKeyChange(state.key);
    });

    render();

    return {
      // The same key again (the app redraws its views often) keeps your place.
      setKey(pc) {
        if (!Number.isInteger(pc) || mod12(pc) === state.key) return;
        clearTimers();
        state.key = mod12(pc); state.grip = 0; state.window = 0; render();
      },
      destroy() { clearTimers(); el.textContent = ''; }
    };
  }

  root.TriadsExplorer = { chordTones, findMajorGrips, gripInQuality, barreChord, barreWindows, QUALITIES, STRING_SETS, NOTE_NAMES, ROLE_CLASSES, mount };
})(typeof globalThis !== 'undefined' ? globalThis : this);
