// The chord chart: every root in eight kinds of chord, one diagram each, as a
// printed chord poster lays them out. Loaded before app.js and only called once the
// page is up, so app.js's state and helpers are there by then.
//
// Nothing is stored per root. Each chord is either one of the open chords below, or
// one of three movable shapes carried to wherever the root is, so the whole chart is
// a few dozen rows of data and the tests can check every one of the 96 chords by
// spelling its notes.

// Frets are written the way a player writes them: from the low E string up, null for a
// string left unplayed.
const CHART_TYPES = [
  { id: "maj",  sym: "",     name: "Major",          iv: [0, 4, 7] },
  { id: "7",    sym: "7",    name: "Dominant 7",     iv: [0, 4, 7, 10] },
  { id: "min",  sym: "m",    name: "Minor",          iv: [0, 3, 7] },
  { id: "m7",   sym: "m7",   name: "Minor 7",        iv: [0, 3, 7, 10] },
  { id: "maj7", sym: "maj7", name: "Major 7",        iv: [0, 4, 7, 11] },
  { id: "sus4", sym: "sus4", name: "Suspended 4th",  iv: [0, 5, 7] },
  { id: "6",    sym: "6",    name: "Major 6",        iv: [0, 4, 7, 9] },
  { id: "7alt", sym: "7",    name: "Dominant 7, second voicing", iv: [0, 4, 7, 10] },
];

// Movable shapes as offsets from R, the fret of the root on the string the shape is
// named for. E shape: root on the low E string. A shape: root on the A string.
// D shape: root on the D string, four strings only.
const CHORD_E_SHAPE = {
  maj: [0, 2, 2, 1, 0, 0], 7: [0, 2, 0, 1, 0, 0], min: [0, 2, 2, 0, 0, 0], m7: [0, 2, 0, 0, 0, 0],
  maj7: [0, 2, 1, 1, 0, 0], sus4: [0, 2, 2, 2, 0, 0], 6: [0, 2, 2, 1, 2, 0],
};
const CHORD_A_SHAPE = {
  maj: [null, 0, 2, 2, 2, 0], 7: [null, 0, 2, 0, 2, 0], min: [null, 0, 2, 2, 1, 0], m7: [null, 0, 2, 0, 1, 0],
  maj7: [null, 0, 2, 1, 2, 0], sus4: [null, 0, 2, 2, 3, 0], 6: [null, 0, 2, 2, 2, 2],
};
const CHORD_D_SHAPE = { "7alt": [null, null, 0, 2, 1, 2] };

// The open-position chords, by root (0 = C). A root with no entry for a kind, such as
// C minor, is barred instead.
const CHORD_OPEN = {
  0: { maj: [null, 3, 2, 0, 1, 0], 7: [null, 3, 2, 3, 1, 0], maj7: [null, 3, 2, 0, 0, 0], sus4: [null, 3, 3, 0, 1, 1], 6: [null, 3, 2, 2, 1, 0] },
  2: { maj: [null, null, 0, 2, 3, 2], 7: [null, null, 0, 2, 1, 2], min: [null, null, 0, 2, 3, 1], m7: [null, null, 0, 2, 1, 1],
       maj7: [null, null, 0, 2, 2, 2], sus4: [null, null, 0, 2, 3, 3], 6: [null, null, 0, 2, 0, 2] },
  4: { maj: [0, 2, 2, 1, 0, 0], 7: [0, 2, 0, 1, 0, 0], min: [0, 2, 2, 0, 0, 0], m7: [0, 2, 0, 0, 0, 0],
       maj7: [0, 2, 1, 1, 0, 0], sus4: [0, 2, 2, 2, 0, 0], 6: [0, 2, 2, 1, 2, 0] },
  7: { maj: [3, 2, 0, 0, 0, 3], 7: [3, 2, 0, 0, 0, 1], maj7: [3, 2, 0, 0, 0, 2], sus4: [3, 3, 0, 0, 1, 3], 6: [3, 2, 0, 0, 0, 0] },
  9: { maj: [null, 0, 2, 2, 2, 0], 7: [null, 0, 2, 0, 2, 0], min: [null, 0, 2, 2, 1, 0], m7: [null, 0, 2, 0, 1, 0],
       maj7: [null, 0, 2, 1, 2, 0], sus4: [null, 0, 2, 2, 3, 0], 6: [null, 0, 2, 2, 2, 2] },
};

// The chord for root pc (0 = C, as everywhere in the app) and kind id: its six frets,
// the shape it came from, and the barre fret if it is one.
function chartVoicing(pc, kind) {
  const open = CHORD_OPEN[pc] && CHORD_OPEN[pc][kind];
  if (open) return { frets: open.slice(), shape: "open", barre: null };
  if (kind === "7alt") {
    const R = (pc - 2 + 12) % 12;      // where the root sits on the D string
    return { frets: CHORD_D_SHAPE[kind].map(o => o === null ? null : o + R), shape: "D shape", barre: R || null };
  }
  const eR = (pc - 4 + 12) % 12, aR = (pc - 9 + 12) % 12;
  // the lower barre fret wins; a barre at the nut is not a barre, so 0 counts as 12
  const useE = (eR || 12) <= (aR || 12), R = (useE ? eR : aR) || 12, tpl = (useE ? CHORD_E_SHAPE : CHORD_A_SHAPE)[kind];
  return { frets: tpl.map(o => o === null ? null : o + R), shape: useE ? "E shape" : "A shape", barre: R };
}
const CHORD_HEADINGS = ["C", "C♯ / D♭", "D", "D♯ / E♭", "E", "F", "F♯ / G♭", "G", "G♯ / A♭", "A", "A♯ / B♭", "B"];
const chartName = (pc, kind) => ROOT_NAMES[pc] + CHART_TYPES.find(t => t.id === kind).sym;
// notes as {s, f} with s = 0 for the high e string, as the rest of the app has it
const chartNotes = v => v.frets.map((f, i) => f === null ? null : { s: 5 - i, f }).filter(Boolean);
const chartFretText = v => v.frets.map(f => f === null ? "×" : f).join(" ");

function chartLabel(n) {
  if (state.labelMode === "none") return "";
  const pc = noteAt(n.s, n.f);
  return state.labelMode === "interval" ? (IV[((pc - state.key) % 12 + 12) % 12] || "") : noteName(pc);
}

function chartCard(pc, kind) {
  const v = chartVoicing(pc, kind), type = CHART_TYPES.find(t => t.id === kind), name = chartName(pc, kind);
  const notes = chartNotes(v).map(n => ({ ...n, kind: noteAt(n.s, n.f) === pc ? "root" : "tone", ord: chartLabel(n) }));
  const fs = notes.map(n => n.f), lo = fs.some(f => f === 0) ? 0 : Math.min(...fs);
  const isOpen = v.shape === "open" || !v.barre;
  const how = !isOpen ? `${v.shape}, barre at fret ${v.barre}` : kind === "7alt" ? "open chord, the same as the first D7" : "open chord";
  return `<div class="card"><h2>${name}${kind === "7alt" ? " (2nd)" : ""}<em>${isOpen ? "open" : "fret " + v.barre}</em></h2>${
    fretboard(notes, { plain: true, span: [lo, Math.max(Math.max(...fs), lo + 3)] })}
    <p class="tip"><b>${chartFretText(v)}</b> — ${type.name}. ${how}.
      <button data-cstrum="${pc}:${kind}">Strum it</button></p></div>`;
}
function chartStrum(pc, kind) {
  const v = chartVoicing(pc, kind);
  playChordNotes(chartNotes(v).sort((a, b) => b.s - a.s).map(n => midiAt(n.s, n.f)));
}

function renderChords() {
  const roots = state.chordsAll ? [...Array(12).keys()] : [state.key];
  const grid = document.getElementById("chordcards");
  grid.innerHTML = roots.map(pc => `<h2 class="chordroot">${CHORD_HEADINGS[pc]}</h2>`
    + `<div class="grid chordrow">${CHART_TYPES.map(t => chartCard(pc, t.id)).join("")}</div>`).join("");
  grid.onclick = e => {
    const d = e.target && e.target.dataset;
    if (d && d.cstrum) { const [pc, kind] = d.cstrum.split(":"); chartStrum(+pc, kind); }
  };
  const btn = document.getElementById("chordsall");
  btn.textContent = state.chordsAll ? "Show one root" : "Show all 12 roots";
  btn.setAttribute("aria-pressed", !!state.chordsAll);
  btn.onclick = () => { state.chordsAll = !state.chordsAll; renderChords(); };
}
