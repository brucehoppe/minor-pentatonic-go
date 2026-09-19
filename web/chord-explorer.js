/*
 * Chord explorers: the pieces the Triads and Inversions explorers share. The neck
 * and its tuning, chord recipes, finding close-voiced grips, and drawing a
 * fretboard with notes coloured by their job in the chord (root, 3rd, 5th).
 *
 * The pure functions (chordTones, findGrips) are exposed for the tests. Sound
 * is not here: each explorer is handed a play function by app.js, which goes
 * through the app's own audio engine, so it works in Safari's Lockdown Mode too.
 *
 * CSP-safe: no inline scripts, no inline styles, no on… attributes.
 * Exposes globalThis.ChordExplorer.
 */
(function (root) {
  'use strict';

  // Chord-root spelling: the flats a guitarist reads on chord charts (E♭, A♭, B♭),
  // sharps where those are the usual name (C♯, F♯).
  const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const OPEN_MIDI = [40, 45, 50, 55, 59, 64]; // low E … high e, standard tuning
  const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];
  const MAX_FRET = 16;
  const MAX_SPAN = 4;
  const ROLE_CLASSES = ['cx-root', 'cx-third', 'cx-fifth'];
  const INVERSION_NAMES = ['root position', '1st inversion', '2nd inversion'];

  const QUALITIES = {
    major: { label: 'Major', name: 'major', intervals: [0, 4, 7], roleNames: ['root', '3rd', '5th'], pentatonic: [0, 2, 4, 7, 9] },
    minor: { label: 'Minor', name: 'minor', intervals: [0, 3, 7], roleNames: ['root', '♭3rd', '5th'], pentatonic: [0, 3, 5, 7, 10] },
    dim: { label: 'Dim', name: 'diminished', intervals: [0, 3, 6], roleNames: ['root', '♭3rd', '♭5th'], pentatonic: null },
    aug: { label: 'Aug', name: 'augmented', intervals: [0, 4, 8], roleNames: ['root', '3rd', '♯5th'], pentatonic: null, symmetric: true }
  };

  // Strings listed low to high; index 0 is the bottom (bass) string of the grip.
  const STRING_SETS = [
    { label: 'G B e', strings: [3, 4, 5] },
    { label: 'D G B', strings: [2, 3, 4] },
    { label: 'A D G', strings: [1, 2, 3] },
    { label: 'E A D', strings: [0, 1, 2] }
  ];

  const mod12 = (n) => ((n % 12) + 12) % 12;

  function chordTones(rootPc, quality) {
    return QUALITIES[quality].intervals.map((i) => mod12(rootPc + i));
  }

  // The nearest pitch strictly above `midi` with pitch class `pc`.
  function nextAbove(midi, pc) {
    const step = mod12(pc - midi);
    return midi + (step === 0 ? 12 : step);
  }

  /**
   * Every close-voiced grip of the triad on one string set, low to high on the
   * neck. Each grip: { frets, strings, midi, roles, inversion }, where roles[k]
   * is 0 (root), 1 (3rd) or 2 (5th) for string k, and inversion is the role on
   * the bottom string.
   */
  function findGrips(rootPc, quality, setIndex) {
    const tones = chordTones(rootPc, quality);
    const strings = STRING_SETS[setIndex].strings;
    const found = [];
    const seen = new Set();
    for (let inversion = 0; inversion < 3; inversion++) {
      const roles = [inversion, (inversion + 1) % 3, (inversion + 2) % 3];
      for (let f0 = 0; f0 <= MAX_FRET; f0++) {
        const m0 = OPEN_MIDI[strings[0]] + f0;
        if (mod12(m0) !== tones[roles[0]]) continue;
        const m1 = nextAbove(m0, tones[roles[1]]);
        const m2 = nextAbove(m1, tones[roles[2]]);
        const frets = [f0, m1 - OPEN_MIDI[strings[1]], m2 - OPEN_MIDI[strings[2]]];
        if (frets.some((f) => f < 0 || f > MAX_FRET)) continue;
        if (Math.max(...frets) - Math.min(...frets) > MAX_SPAN) continue;
        const key = frets.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ frets, strings: strings.slice(), midi: [m0, m1, m2], roles, inversion });
      }
    }
    const sum = (g) => g.frets[0] + g.frets[1] + g.frets[2];
    found.sort((a, b) => sum(a) - sum(b) || a.frets[0] - b.frets[0]);
    return found;
  }

  // ---------- DOM ----------

  function h(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    }
    for (const c of children || []) node.appendChild(c);
    return node;
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function svg(viewW, viewH, cls) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`);
    s.setAttribute('role', 'img');
    if (cls) s.setAttribute('class', cls);
    return s;
  }

  // A button row where one choice is pressed. items: [[value, text], …]
  function segButtons(label, items, current, onPick) {
    const group = h('div', { class: 'cx-seg', role: 'group', 'aria-label': label });
    items.forEach(([value, text]) => {
      const b = h('button', { type: 'button', text, 'aria-pressed': String(value === current) });
      b.addEventListener('click', () => onPick(value));
      group.appendChild(b);
    });
    return group;
  }

  function button(text, onClick, aria) {
    const b = h('button', { type: 'button', text });
    if (aria) b.setAttribute('aria-label', aria);
    b.addEventListener('click', onClick);
    return b;
  }

  function legend() {
    return h('ul', { class: 'cx-legend', 'aria-label': 'Colour key' }, [
      h('li', { class: 'cx-root' }, [h('span', { class: 'cx-swatch cx-swatch-square' }), document.createTextNode('Root')]),
      h('li', { class: 'cx-third' }, [h('span', { class: 'cx-swatch' }), document.createTextNode('3rd')]),
      h('li', { class: 'cx-fifth' }, [h('span', { class: 'cx-swatch' }), document.createTextNode('5th')])
    ]);
  }

  // The card stack: one chip per string, top string first, bottom card outlined.
  // arrive marks the top card as the one that just came up from the bottom.
  function fillStack(stack, roles, midis, roleNames, arrive) {
    stack.textContent = '';
    for (let k = roles.length - 1; k >= 0; k--) {
      let cls = `cx-chip ${ROLE_CLASSES[roles[k]]}`;
      if (k === 0) cls += ' cx-chip-bottom';
      if (arrive && k === roles.length - 1) cls += ' cx-chip-arrive';
      stack.appendChild(h('div', { class: cls, text: `${NOTE_NAMES[mod12(midis[k])]} ${roleNames[roles[k]]}` }));
    }
  }

  // ---------- The neck ----------

  const VIEW_W = 380;
  const VIEW_H = 174;
  const NUT_X = 34;
  const FRET_W = 21;
  const OPEN_X = 22;
  const TOP_Y = 18;   // room for the band and a marker above the top string, no more
  const STRING_GAP = 22;
  const DOT_R = 8.5;
  const stringY = (s) => TOP_Y + (5 - s) * STRING_GAP;
  const fretX = (f) => (f === 0 ? OPEN_X : NUT_X + (f - 0.5) * FRET_W);

  // Root is a rounded square, other tones circles: the shape carries the root
  // even without colour.
  function marker(x, y, roleIndex, state, label) {
    const roleClass = roleIndex === null || roleIndex === undefined || roleIndex < 0 ? '' : ROLE_CLASSES[roleIndex];
    const shape = roleIndex === 0
      ? `<rect class="cx-shape" x="${x - DOT_R}" y="${y - DOT_R}" width="${DOT_R * 2}" height="${DOT_R * 2}" rx="4"/>`
      : `<circle class="cx-shape" cx="${x}" cy="${y}" r="${DOT_R}"/>`;
    return `<g class="cx-marker ${state} ${roleClass}">${shape}` +
      `<text class="cx-marker-label" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central">${esc(label)}</text></g>`;
  }

  /**
   * The whole six-string neck to fret 16. band: the three strings in play
   * (highlighted), or null. markers: [{ s, f, role, state, label }], drawn in
   * order, so later ones sit on top.
   */
  function boardMarkup(band, markers) {
    let out = '';
    if (band) {
      const top = stringY(band[2]) - 12;
      out += `<rect class="cx-band" x="10" y="${top}" width="${VIEW_W - 16}" height="${stringY(band[0]) - stringY(band[2]) + 24}" rx="6"/>`;
    }
    out += `<line class="cx-nut" x1="${NUT_X}" y1="${TOP_Y}" x2="${NUT_X}" y2="${stringY(0)}"/>`;
    for (let n = 1; n <= MAX_FRET; n++) {
      out += `<line class="cx-fret" x1="${NUT_X + n * FRET_W}" y1="${TOP_Y}" x2="${NUT_X + n * FRET_W}" y2="${stringY(0)}"/>`;
    }
    const iy = stringY(0) + 15;
    [3, 5, 7, 9, 15].forEach((f) => { out += `<circle class="cx-inlay" cx="${fretX(f)}" cy="${iy}" r="3"/>`; });
    out += `<circle class="cx-inlay" cx="${fretX(12) - 5}" cy="${iy}" r="3"/><circle class="cx-inlay" cx="${fretX(12) + 5}" cy="${iy}" r="3"/>`;
    for (let s = 0; s < 6; s++) {
      const a = band && band.includes(s) ? ' cx-active' : '';
      out += `<line class="cx-string${a}" x1="${NUT_X}" y1="${stringY(s)}" x2="${NUT_X + MAX_FRET * FRET_W}" y2="${stringY(s)}"/>`;
      out += `<text class="cx-string-name${a}" x="4" y="${stringY(s)}" dominant-baseline="central">${STRING_NAMES[s]}</text>`;
    }
    [3, 5, 7, 9, 12, 15].forEach((f) => { out += `<text class="cx-small" x="${fretX(f)}" y="${iy + 19}" text-anchor="middle">${f}</text>`; });
    markers.forEach((m) => { out += marker(fretX(m.f), stringY(m.s), m.role, m.state, m.label); });
    return out;
  }

  root.ChordExplorer = {
    NOTE_NAMES, OPEN_MIDI, STRING_NAMES, MAX_FRET, ROLE_CLASSES, INVERSION_NAMES, QUALITIES, STRING_SETS,
    VIEW_W, VIEW_H, mod12, chordTones, nextAbove, findGrips,
    h, esc, svg, segButtons, button, legend, fillStack, marker, boardMarkup
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
