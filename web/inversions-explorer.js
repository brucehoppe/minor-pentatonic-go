/*
 * Inversions explorer: every close-voiced triad grip for any key, quality and
 * three-string set, coloured by each note's job in the chord.
 *
 * Built on chord-explorer.js (load it first). CSP-safe: no inline scripts, no
 * inline styles, no on… attributes.
 * Exposes globalThis.InversionsExplorer = { findGrips, chordTones, QUALITIES,
 * STRING_SETS, NOTE_NAMES, mount }.
 */
(function (root) {
  'use strict';

  const X = root.ChordExplorer;
  const { NOTE_NAMES, OPEN_MIDI, STRING_NAMES, MAX_FRET, QUALITIES, STRING_SETS, INVERSION_NAMES, h, mod12, chordTones, findGrips } = X;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /**
   * mount(el, options)
   *   options.key         initial root pitch class (0 = C … 11 = B), default 7 (G)
   *   options.quality     'major' | 'minor' | 'dim' | 'aug', default 'major'
   *   options.set         string-set index 0–3, default 0 (G B e)
   *   options.playGrip    function(midiNotes): play a grip (arpeggio, then strum)
   *   options.showKey     show the explorer's own Key menu (default true); the app
   *                       hides it and drives the key from its Root selector
   *   options.onKeyChange function(pc) when the user changes key here
   *   options.stepMs      delay between grips in "Play all", default 1700
   * Returns { setKey(pc), destroy() }.
   */
  function mount(el, options) {
    const opts = options || {};
    const state = {
      key: Number.isInteger(opts.key) ? mod12(opts.key) : 7,
      quality: QUALITIES[opts.quality] ? opts.quality : 'major',
      set: STRING_SETS[opts.set] ? opts.set : 0,
      index: 0,
      showScale: false,
      grips: [],
      arrive: false
    };
    const playGrip = typeof opts.playGrip === 'function' ? opts.playGrip : () => {};
    const stepMs = opts.stepMs || 1700;
    let timer = null;

    const keySelect = h('select', { 'aria-label': 'Key' },
      NOTE_NAMES.map((n, pc) => h('option', { value: String(pc), text: n })));
    const qualityButtons = Object.keys(QUALITIES).map((q) =>
      h('button', { type: 'button', 'data-quality': q, text: QUALITIES[q].label }));
    const setButtons = STRING_SETS.map((s, k) =>
      h('button', { type: 'button', 'data-set': String(k), text: s.label }));
    const scaleBox = h('input', { type: 'checkbox' });
    const scaleLabel = h('label', { class: 'cx-check' }, [scaleBox, document.createTextNode(' Show pentatonic on these strings')]);

    const board = X.svg(X.VIEW_W, X.VIEW_H, 'cx-board');
    board.setAttribute('tabindex', '0');
    const stack = h('div', { class: 'cx-stack', 'aria-hidden': 'true' });
    const info = h('div', { class: 'cx-info', 'aria-live': 'polite' });
    const pills = h('div', { class: 'cx-pills', 'aria-hidden': 'true' });
    const prev = h('button', { type: 'button', 'aria-label': 'Previous grip', text: '←' });
    const next = h('button', { type: 'button', 'aria-label': 'Next grip', text: '→' });
    const play = h('button', { type: 'button', text: 'Play' });
    const playAll = h('button', { type: 'button', text: 'Play all up the neck' });

    const firstRow = [h('div', { class: 'cx-seg', role: 'group', 'aria-label': 'Chord quality' }, qualityButtons)];
    if (opts.showKey !== false) firstRow.unshift(h('label', { class: 'cx-key' }, [h('span', { text: 'Key' }), keySelect]));
    const wrap = h('div', { class: 'cx' }, [
      h('div', { class: 'cx-row' }, firstRow),
      h('div', { class: 'cx-row' }, [h('div', { class: 'cx-seg', role: 'group', 'aria-label': 'Strings' }, setButtons)]),
      h('div', { class: 'cx-row' }, [scaleLabel]),
      X.legend(),
      h('div', { class: 'cx-figure' }, [board]),
      h('div', { class: 'cx-readout' }, [stack, info]),
      pills,
      h('div', { class: 'cx-row cx-transport' }, [prev, next, play, playAll])
    ]);
    el.textContent = '';
    el.appendChild(wrap);

    function stop() {
      if (timer) { clearTimeout(timer); timer = null; }
    }

    function rebuild() {
      stop();
      state.grips = findGrips(state.key, state.quality, state.set);
      state.index = 0;
      render();
    }

    function roleOf(midi) {
      const k = chordTones(state.key, state.quality).indexOf(mod12(midi));
      return k < 0 ? null : k;
    }

    // The current grip solid, the other grips of the same chord outlined, and
    // (for major and minor) the pentatonic on these strings behind them.
    function drawBoard() {
      const set = STRING_SETS[state.set].strings;
      const grip = state.grips[state.index];
      const markers = [];
      if (grip) {
        const current = new Set(grip.frets.map((f, k) => `${set[k]}:${f}`));
        const ghosts = new Set();
        state.grips.forEach((g, gi) => {
          if (gi === state.index) return;
          g.frets.forEach((f, k) => { const id = `${set[k]}:${f}`; if (!current.has(id)) ghosts.add(id); });
        });
        const q = QUALITIES[state.quality];
        if (state.showScale && q.pentatonic) {
          const scale = q.pentatonic.map((i) => mod12(state.key + i));
          set.forEach((s) => {
            for (let f = 0; f <= MAX_FRET; f++) {
              const id = `${s}:${f}`;
              const pc = mod12(OPEN_MIDI[s] + f);
              if (scale.includes(pc) && !current.has(id) && !ghosts.has(id)) markers.push({ s, f, role: null, state: 'cx-scale', label: NOTE_NAMES[pc] });
            }
          });
        }
        ghosts.forEach((id) => {
          const [s, f] = id.split(':').map(Number);
          const m = OPEN_MIDI[s] + f;
          markers.push({ s, f, role: roleOf(m), state: 'cx-ghost', label: NOTE_NAMES[mod12(m)] });
        });
        grip.frets.forEach((f, k) => markers.push({ s: set[k], f, role: grip.roles[k], state: 'cx-current', label: NOTE_NAMES[mod12(grip.midi[k])] }));
      }
      board.innerHTML = X.boardMarkup(set, markers); // markup only: no scripts, no style attributes
    }

    function render() {
      const q = QUALITIES[state.quality];
      const grip = state.grips[state.index];
      const chordName = `${NOTE_NAMES[state.key]} ${q.name}`;
      keySelect.value = String(state.key);
      qualityButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.quality === state.quality)));
      setButtons.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.set) === state.set)));
      scaleBox.checked = state.showScale;
      scaleBox.disabled = !q.pentatonic;
      scaleLabel.classList.toggle('cx-disabled', !q.pentatonic);
      drawBoard();

      stack.textContent = '';
      info.textContent = '';
      pills.textContent = '';
      if (!grip) {
        info.appendChild(h('p', { class: 'cx-info-title', text: 'No grips fit on these strings below fret 16.' }));
        return;
      }
      X.fillStack(stack, grip.roles, grip.midi, q.roleNames, state.arrive);
      state.arrive = false;
      const lo = Math.min(...grip.frets);
      const hi = Math.max(...grip.frets);
      const where = lo === hi ? `Fret ${lo}` : `Frets ${lo}–${hi}`;
      const bottomName = NOTE_NAMES[mod12(grip.midi[0])];
      const bottomRole = q.roleNames[grip.roles[0]];
      const invText = q.symmetric
        ? 'Every inversion is the same shape, 4 frets apart'
        : cap(INVERSION_NAMES[grip.inversion]);
      info.appendChild(h('p', { class: 'cx-info-title', text: `${chordName}, grip ${state.index + 1} of ${state.grips.length}` }));
      info.appendChild(h('p', { class: 'cx-info-meta', text: `${where}. Bottom note ${bottomName} (${bottomRole})` }));
      info.appendChild(h('p', { class: 'cx-info-inv', text: invText }));
      board.setAttribute('aria-label',
        `${chordName} on ${STRING_SETS[state.set].label} strings, ${invText.toLowerCase()}, ${where.toLowerCase()}. ` +
        `Frets ${grip.frets.join(', ')} from ${STRING_NAMES[grip.strings[0]]} string up. Use left and right arrow keys to move.`);
      state.grips.forEach((_, gi) => pills.appendChild(h('span', { class: gi === state.index ? 'cx-pill cx-pill-on' : 'cx-pill' })));
    }

    // Stepping up the neck takes the bottom card and puts it on top.
    function step(delta) {
      stop();
      const n = state.grips.length;
      if (!n) return;
      state.index = (state.index + delta + n) % n;
      state.arrive = delta > 0;
      render();
    }

    function playCurrent() {
      const grip = state.grips[state.index];
      if (grip) playGrip(grip.midi.slice());
    }

    function playAllGrips() {
      stop();
      if (!state.grips.length) return;
      state.index = 0;
      const go = () => {
        render();
        playCurrent();
        if (state.index < state.grips.length - 1) {
          timer = setTimeout(() => { state.index += 1; state.arrive = true; go(); }, stepMs);
        } else {
          timer = null;
        }
      };
      go();
    }

    keySelect.addEventListener('change', () => {
      state.key = Number(keySelect.value);
      rebuild();
      if (typeof opts.onKeyChange === 'function') opts.onKeyChange(state.key);
    });
    qualityButtons.forEach((b) => b.addEventListener('click', () => { state.quality = b.dataset.quality; rebuild(); }));
    setButtons.forEach((b) => b.addEventListener('click', () => { state.set = Number(b.dataset.set); rebuild(); }));
    scaleBox.addEventListener('change', () => { state.showScale = scaleBox.checked; render(); });
    prev.addEventListener('click', () => step(-1));
    next.addEventListener('click', () => step(1));
    play.addEventListener('click', () => { stop(); playCurrent(); });
    playAll.addEventListener('click', playAllGrips);
    board.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); playCurrent(); }
    });

    rebuild();

    return {
      // The same key again (the app redraws its views often) keeps your place.
      setKey(pc) {
        if (!Number.isInteger(pc) || mod12(pc) === state.key) return;
        state.key = mod12(pc);
        rebuild();
      },
      destroy() {
        stop();
        el.textContent = '';
      }
    };
  }

  root.InversionsExplorer = { findGrips, chordTones, QUALITIES, STRING_SETS, NOTE_NAMES, mount };
})(typeof globalThis !== 'undefined' ? globalThis : this);
