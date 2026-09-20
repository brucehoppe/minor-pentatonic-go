// The CAGED view: one chord in five places. The five open chords C, A, G, E and D are
// five shapes; barred, each moves anywhere, and up the neck any chord passes through
// them in that order, round and round, each sharing a note or two with the next. It is
// the map that joins the Chords half of the desk to the Shapes half: every shape sits
// inside a pentatonic position. Loaded before app.js, and only called once the page is
// up, so app.js's state and helpers are there by then.

// Each shape as fret offsets from R, the fret of the chord's root on the low E string,
// for strings e B G D A E; null is a string left out. Kept in neck order from the E
// shape. The minor shapes are the ones the 5 boxes view rings inside each box.
const CAGED_SHAPES = {
  maj: [
    { id: "E", off: [0, 0, 1, 2, 2, 0], string: "low E", finger: "first", tip: "The everyday barre chord." },
    { id: "D", off: [4, 5, 4, 2, null, null], string: "D", finger: "first", tip: "Small and bright: the top four strings only." },
    { id: "C", off: [4, 5, 4, 6, 7, null], string: "A", finger: "fourth", tip: "A stretch as a full barre; its top three strings alone make a sweet small chord." },
    { id: "A", off: [7, 9, 9, 9, 7, null], string: "A", finger: "first", tip: "The other everyday barre chord." },
    { id: "G", off: [12, 9, 9, 9, 11, 12], string: "low E", finger: "fourth", tip: "Almost never played whole. Take the middle three strings, which are the same three as the A shape's." },
  ],
  min: [
    { id: "E", off: [0, 0, 0, 2, 2, 0], string: "low E", finger: "first", tip: "The everyday minor barre chord." },
    { id: "D", off: [3, 5, 4, 2, null, null], string: "D", finger: "first", tip: "Four strings, high and bright." },
    { id: "C", off: [null, 5, 4, 5, 7, null], string: "A", finger: "fourth", tip: "The awkward one; the top three strings alone make a good small chord." },
    { id: "A", off: [7, 8, 9, 9, 7, null], string: "A", finger: "first", tip: "The other everyday minor barre chord." },
    { id: "G", off: [12, 12, 9, 9, 10, 12], string: "low E", finger: "fourth", tip: "Rarely strummed whole; its notes are where this position's phrases land." },
  ],
};
const CAGED_LAST_FRET = 17;   // the map's right-hand edge: room for every shape at least once

// Every place the chord on screen can be played between the nut and CAGED_LAST_FRET,
// low to high. shift is the octave it was moved by; index is its place in CAGED_SHAPES.
function cagedInstances(quality = state.cagedQuality) {
  const R = baseFret(), out = [];
  CAGED_SHAPES[quality].forEach((shape, index) => [-12, 0, 12].forEach(shift => {
    const notes = shape.off.map((o, s) => o === null ? null : { s, f: o + R + shift }).filter(Boolean);
    const fs = notes.map(n => n.f), lo = Math.min(...fs), hi = Math.max(...fs);
    if (lo >= 0 && hi <= CAGED_LAST_FRET) out.push({ id: shape.id, index, quality, shift, notes, lo, hi });
  }));
  return out.sort((a, b) => a.lo - b.lo);
}
// The notes two neighbouring shapes have in common: the doors between them.
function cagedShared(instances) {
  const seen = new Map();
  instances.forEach(inst => inst.notes.forEach(n => { const k = n.s + ":" + n.f; seen.set(k, (seen.get(k) || 0) + 1); }));
  return new Set([...seen.entries()].filter(([, c]) => c > 1).map(([k]) => k));
}
// The pentatonic position a shape sits inside. A minor shape sits in the box of its own
// key; a major shape in a box of the relative minor, three frets down, which is the
// same five notes read as the major pentatonic.
function cagedPosition(inst) {
  const minor = inst.quality === "min", box = BOXES[(inst.index + (minor ? 0 : 1)) % 5];
  const root = baseFret() + inst.shift + (minor ? 0 : inst.index === 4 ? 9 : -3);
  return boxNotes(box, root).filter(n => n.f >= 0 && n.f <= MAXFRET);
}
// the chord as a player writes it: frets from the low E string up, × for a string left out
function cagedFrets(inst) {
  const bys = new Map(inst.notes.map(n => [n.s, n.f]));
  return [5, 4, 3, 2, 1, 0].map(s => bys.has(s) ? bys.get(s) : "×").join(" ");
}
const cagedSuffix = () => state.cagedQuality === "min" ? "m" : "";
const cagedChordName = () => `${ROOT_NAMES[state.key]} ${state.cagedQuality === "min" ? "minor" : "major"}`;
function cagedLabel(n) {
  if (state.labelMode === "none") return "";
  const pc = noteAt(n.s, n.f);
  return state.labelMode === "interval" ? (IV[deg(pc)] || "") : noteName(pc);
}

function cagedMap() {
  const all = cagedInstances(), shared = cagedShared(all), only = state.cagedShape;
  const w = 44, h = 24, pad = 34, top = 44, cols = CAGED_LAST_FRET, W = pad + cols * w + 16, H = top + 5 * h + 26;
  const xOf = f => f === 0 ? pad - 13 : pad + (f - .5) * w;
  let o = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${cagedChordName()} in every CAGED shape, frets 0 to ${cols}">`;
  // which shape is where: a bracket over each, on two rows so neighbours don't collide
  all.forEach((inst, i) => {
    const y = i % 2 ? 26 : 12, x1 = inst.lo === 0 ? pad - 22 : pad + (inst.lo - 1) * w + 4, x2 = pad + inst.hi * w - 4;
    const op = only && only !== inst.id ? .15 : 1;
    o += `<g opacity="${op}"><line x1="${x1}" y1="${y + 4}" x2="${x2}" y2="${y + 4}" stroke="var(--ink)" stroke-width="1.4"/>`
      + `<text x="${(x1 + x2) / 2}" y="${y}" font-size="10.5" font-weight="600" fill="var(--ink)" text-anchor="middle" font-family="DM Mono,monospace">${inst.id}${cagedSuffix()} shape</text></g>`;
  });
  for (let i = 0; i <= cols; i++) { const x = pad + i * w;
    o += `<line x1="${x}" y1="${top}" x2="${x}" y2="${top + 5 * h}" stroke="var(--ink)" stroke-width="${i === 0 ? 4 : 1.1}" opacity="${i === 0 ? 1 : .32}"/>`;
    if (i > 0) o += `<text x="${x - w / 2}" y="${top + 5 * h + 17}" font-size="10" fill="var(--ink)" opacity=".45" text-anchor="middle" font-family="DM Mono,monospace">${i}</text>`; }
  for (let r = 0; r < 6; r++) o += `<line x1="${pad}" y1="${top + r * h}" x2="${pad + cols * w}" y2="${top + r * h}" stroke="var(--ink)" stroke-width="${.7 + r * .25}" opacity=".5"/>`;
  const drawn = new Set();
  all.forEach(inst => inst.notes.forEach(n => {
    const k = n.s + ":" + n.f; if (drawn.has(k)) return; drawn.add(k);
    const on = !only || all.some(x => x.id === only && x.notes.some(m => m.s === n.s && m.f === n.f));
    const pc = noteAt(n.s, n.f), x = xOf(n.f), y = top + n.s * h;
    const fill = pc === state.key ? "var(--pink)" : shared.has(k) ? "var(--gold)" : "var(--blue)";
    o += `<g class="pn" data-s="${n.s}" data-f="${n.f}" role="button" tabindex="0" aria-label="play ${noteName(pc)}, fret ${n.f} on the ${SL[n.s]} string" opacity="${on ? 1 : .15}">`
      // a shared root stays pink, so it wears the gold as a ring: a door all the same
      + (shared.has(k) && pc === state.key ? `<circle cx="${x}" cy="${y}" r="12.5" fill="none" stroke="var(--gold)" stroke-width="2.4"/>` : "")
      + `<circle cx="${x}" cy="${y}" r="9.5" fill="${fill}"/>`
      + `<text x="${x}" y="${y + 3.4}" font-size="9" font-weight="500" fill="${fill === "var(--gold)" ? "var(--ink)" : "var(--card)"}" text-anchor="middle" font-family="DM Mono,monospace" pointer-events="none">${cagedLabel(n)}</text></g>`;
  }));
  return o + "</svg>";
}

// One card a shape, at the lowest place it fits: the chord solid, the pentatonic
// position it lives in as dashed dots around it.
function cagedCards() {
  const all = cagedInstances(), minor = state.cagedQuality === "min";
  const lowest = CAGED_SHAPES[state.cagedQuality].map(shape => all.find(x => x.id === shape.id)).filter(Boolean).sort((a, b) => a.lo - b.lo);
  return lowest.map((inst, i) => {
    const shape = CAGED_SHAPES[inst.quality][inst.index], chord = new Set(inst.notes.map(n => n.s + ":" + n.f));
    const scale = cagedPosition(inst), fs = [...scale, ...inst.notes].map(n => n.f);
    const notes = scale.map(n => chord.has(n.s + ":" + n.f)
      ? { ...n, kind: noteAt(n.s, n.f) === state.key ? "root" : "tone", ord: cagedLabel(n) }
      : { ...n, kind: "ghost", ord: cagedLabel(n) });
    const open = inst.notes.some(n => n.f === 0);
    return `<div class="card"><h2>${inst.id}${cagedSuffix()} shape<em>frets ${inst.lo}–${inst.hi}${minor ? ` · Box ${inst.index + 1}` : ""}</em></h2>${
      // never narrower than four frets, or a two-fret shape is drawn enormous to fill the card
      fretboard(notes, { plain: true, span: [Math.min(...fs), Math.max(Math.max(...fs), Math.min(...fs) + 3)] })}
      <p class="tip"><b>${cagedFrets(inst)}</b> — ${cagedChordName()}${
        !open ? "" : ROOT_NAMES[state.key] === inst.id ? `: the open ${inst.id}${cagedSuffix()} chord itself, the one this shape is named after` : ", here using open strings"}. Root on the ${shape.string} string${open ? "" : `, under your ${shape.finger} finger`}. ${shape.tip}</p>
      <p class="tip">Solid dots are the chord; dashed dots are the ${minor ? "minor" : "major"} pentatonic around it${minor ? `, which is Box ${inst.index + 1}` : ""}. <button data-strum="${i}">Strum it</button></p></div>`;
  }).join("");
}
function cagedStrum(i) {
  const all = cagedInstances();
  const lowest = CAGED_SHAPES[state.cagedQuality].map(shape => all.find(x => x.id === shape.id)).filter(Boolean).sort((a, b) => a.lo - b.lo);
  const inst = lowest[i]; if (!inst) return;
  playChordNotes([...inst.notes].sort((a, b) => b.s - a.s).map(n => midiAt(n.s, n.f)));
}

function renderCaged() {
  const chord = cagedChordName(), minor = state.cagedQuality === "min";
  document.getElementById("cagedintro").innerHTML = `
    <div class="card wide"><h2>What CAGED means<em>five shapes, one chord, the whole neck</em></h2>
      <p class="tip">The name is five open chords: <b>C, A, G, E and D</b>. Put a finger across the strings where the nut was and each becomes a
        shape you can move anywhere. The E shape and the A shape are the two barre chords you already know.</p>
      <p class="tip">Going up the neck, any chord passes through the five shapes <b>in the order of the word</b>, C → A → G → E → D, and then round
        again. Which letter it starts on depends on the chord: C starts on the C shape, A on the A shape. Each shape shares a note or two
        with the next one (the gold dots), so you never jump: you step through a door.</p>
      <p class="tip">Every shape sits inside a pentatonic position. That is the point of learning it: the chord tells you which notes of the scale
        are home, and the scale tells you what is within reach of the chord.</p></div>`;
  const q = document.getElementById("cagedquality");
  q.innerHTML = '<span class="lbl">Chord</span>';
  [["maj", "Major"], ["min", "Minor"]].forEach(([id, t]) => mk(q, { q: id }, t, () => { state.cagedQuality = id; state.cagedShape = null; renderCaged(); }));
  q.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.q === state.cagedQuality));
  const pick = document.getElementById("cagedshapes");
  pick.innerHTML = '<span class="lbl">Show one shape</span>';
  [..."CAGED"].forEach(id => mk(pick, { cs: id }, id + cagedSuffix(), () => { state.cagedShape = state.cagedShape === id ? null : id; renderCaged(); }));
  pick.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.cs === state.cagedShape));
  document.getElementById("cagedmaplabel").textContent = state.cagedShape
    ? `${chord} — the ${state.cagedShape}${cagedSuffix()} shape, everywhere it fits`
    : `${chord} — all five shapes, nut to fret ${CAGED_LAST_FRET}`;
  document.getElementById("cagedmap").innerHTML = cagedMap();
  document.getElementById("cagedkey").innerHTML = `Pink = the root, ${ROOT_NAMES[state.key]}. Gold, as a dot or as a ring round a root, = a note two neighbouring shapes share: the door between them. Read the brackets left to right: ${
    cagedInstances().map(x => x.id).join(" → ")}.`;
  const cards = document.getElementById("cagedcards");
  cards.innerHTML = cagedCards();
  cards.onclick = e => { const d = e.target && e.target.dataset; if (d && d.strum !== undefined) cagedStrum(+d.strum); };
  document.getElementById("cagedpractice").innerHTML = `
    <div class="card wide"><h2>How to practise it<em>ten minutes · one chord</em></h2>
      <ol><li><b>Two shapes you know.</b> Play ${chord} as the E shape, then as the A shape. Say the root's string out loud each time.</li>
      <li><b>Find the door.</b> Between two neighbouring shapes, hold the gold note down and move the rest of the hand around it.</li>
      <li><b>All five, in order.</b> Climb the neck through every shape, slowly, then come back down. Small versions count: three strings is enough.</li>
      <li><b>Chord, then scale.</b> In one position, strum the shape, then play the dashed ${minor ? "minor" : "major"} pentatonic around it and end on a solid dot.</li>
      <li><b>Over the band.</b> Open the 12-bar trainer with Chord tones on <i>Follow backing</i>, and find each chord's nearest shape without leaving the position you are in.</li></ol>
      <p class="tip">${minor ? "The minor shapes are the chords ringed by <b>Chord inside each box</b> on the 5 boxes view."
        : "Switch to <b>Minor</b> to see the shapes that sit inside the five minor pentatonic boxes."}
        CAGED is a map, not a rule: players use the two or three shapes that suit their hands and the top strings of the rest.</p></div>`;
}
