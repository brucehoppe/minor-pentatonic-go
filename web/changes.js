// One-minute changes, in the Practice view: pick two chords, switch between them for one
// minute, count the changes, and try to beat your best. The count is yours to keep (a tap
// or Space per change); nothing listens. Best and recent scores stay in this browser.
// Loaded before app.js, and only called once the page is up.

const CHANGES_KEY = "minor-pentatonic-changes-v1";
const CHANGE_SECONDS = 60;
// Frets from string 6 to string 1; x is not played. Fingers are the usual first-position ones.
const CHANGE_CHORDS = {
  "A": "x02220", "Am": "x02210", "C": "x32010", "D": "xx0232", "Dm": "xx0231",
  "E": "022100", "Em": "022000", "G": "320003", "F": "133211", "E5": "022xxx", "A5": "x022xx", "E7": "020100", "A7": "x02020",
};
// Pairs in the order most teachers give them: the open chords first, then the ones that
// turn up in blues and in the songs here.
const CHANGE_PAIRS = [["A", "D"], ["D", "E"], ["A", "E"], ["Am", "C"], ["Em", "G"], ["C", "G"], ["G", "D"],
  ["Am", "Dm"], ["Em", "Am"], ["E7", "A7"], ["E5", "A5"], ["C", "F"]];
const pairKey = p => p.join("-");

function readChanges() {
  try { const v = JSON.parse(window.localStorage.getItem(CHANGES_KEY) || "{}"), o = {};
    if (v && typeof v === "object") for (const [k, runs] of Object.entries(v)) {
      if (!CHANGE_PAIRS.some(p => pairKey(p) === k) || !Array.isArray(runs)) continue;
      o[k] = runs.filter(r => r && Number.isInteger(r.n) && r.n >= 0 && r.n < 1000 && typeof r.d === "string").slice(0, 20);
    }
    return o; }
  catch (e) { return {}; }
}
function writeChanges(v) { try { window.localStorage.setItem(CHANGES_KEY, JSON.stringify(v)); } catch (e) { /* this visit only */ } }
const changesBest = runs => runs.reduce((m, r) => Math.max(m, r.n), 0);

// A small chord box: six strings, four frets, x and o over the nut.
function chordBox(name) {
  const sh = CHANGE_CHORDS[name], w = 16, top = 26;
  const frets = [...sh].map(c => c === "x" ? null : +c), hi = Math.max(3, ...frets.filter(f => f !== null));
  const base = hi > 4 ? Math.min(...frets.filter(f => f)) : 1;
  let s = `<svg viewBox="0 0 110 118" width="92" height="99" role="img" aria-label="${name}: ${sh}">
    <text x="47" y="12" font-size="12" font-weight="700" text-anchor="middle" fill="currentColor">${name}</text>`;
  for (let i = 0; i < 6; i++) s += `<line x1="${10 + i * w}" x2="${10 + i * w}" y1="${top}" y2="${top + 4 * 20}" stroke="currentColor" opacity=".5"/>`;
  for (let j = 0; j <= 4; j++) s += `<line x1="10" x2="${10 + 5 * w}" y1="${top + j * 20}" y2="${top + j * 20}" stroke="currentColor" stroke-width="${j === 0 && base === 1 ? 3 : 1}" opacity=".6"/>`;
  frets.forEach((f, i) => {
    const x = 10 + i * w;
    if (f === null) s += `<text x="${x}" y="${top - 5}" font-size="10" text-anchor="middle" fill="currentColor" opacity=".7">×</text>`;
    else if (f === 0) s += `<circle cx="${x}" cy="${top - 8}" r="3.5" fill="none" stroke="currentColor" opacity=".7"/>`;
    else s += `<circle cx="${x}" cy="${top + (f - base + .5) * 20}" r="6" fill="var(--blue)"/>`;
  });
  return s + "</svg>";
}

function renderChanges() {
  const st = state.changes || (state.changes = { pair: pairKey(CHANGE_PAIRS[0]), run: null });
  const host = document.getElementById("changepairs");
  host.innerHTML = '<span class="lbl">Pair</span>';
  const all = readChanges();
  CHANGE_PAIRS.forEach(p => mk(host, { pair: pairKey(p) }, `${p[0]} ↔ ${p[1]}${all[pairKey(p)] ? " · " + changesBest(all[pairKey(p)]) : ""}`, () => {
    if (st.run) return; st.pair = pairKey(p); renderChanges(); }));
  host.querySelectorAll("button").forEach(b => { b.setAttribute("aria-pressed", b.dataset.pair === st.pair); b.disabled = !!st.run && b.dataset.pair !== st.pair; });
  const pair = st.pair.split("-");
  document.getElementById("changeshapes").innerHTML = pair.map(chordBox).join("");
  const runs = all[st.pair] || [];
  document.getElementById("changelog").innerHTML = runs.length
    ? `<li><span>Best</span><span><b>${changesBest(runs)}</b> a minute</span></li>` +
      runs.slice(0, 5).map(r => `<li><span>${escapeHTML(r.d)}</span><span>${r.n}</span></li>`).join("")
    : `<li><span>No minutes yet for ${pair.join(" ↔ ")}</span><span></span></li>`;
  document.getElementById("changestart").onclick = changesToggle;
  document.getElementById("changetap").onclick = changesTap;
  paintChanges();
}
function paintChanges() {
  const r = state.changes && state.changes.run;
  const left = r ? Math.max(0, Math.ceil(r.end - Date.now() / 1000)) : CHANGE_SECONDS;
  document.getElementById("changeclock").textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  const start = document.getElementById("changestart"), tap = document.getElementById("changetap");
  start.textContent = r ? "Stop, don't count it" : "Start a minute";
  start.setAttribute("aria-pressed", !!r);
  tap.disabled = !r;
  tap.textContent = r ? `Changed · ${r.n}` : "Changed";
}
function changesToggle() {
  const st = state.changes;
  if (st.run) { clearInterval(st.run.timer); st.run = null;
    document.getElementById("changestatus").textContent = "Stopped. That minute wasn't counted.";
    renderChanges(); return; }
  const run = st.run = { n: 0, end: Date.now() / 1000 + CHANGE_SECONDS, timer: null };
  const a = audio(); if (a) a.blip(1400, { dur: .08, vol: .2 });
  document.getElementById("changestatus").textContent = `Go: ${st.pair.replace("-", " → ")}, and back. Tap or press Space on each change.`;
  run.timer = setInterval(() => { if (Date.now() / 1000 >= run.end) changesDone(); else paintChanges(); }, 250);
  renderChanges();
}
function changesTap() {
  const r = state.changes && state.changes.run;
  if (!r) return false;
  r.n++; paintChanges(); return true;
}
function changesDone() {
  const st = state.changes, r = st && st.run;
  if (!r) return null;
  clearInterval(r.timer); st.run = null;
  const a = audio(); if (a) a.blip(880, { dur: .35, vol: .2 });
  const all = readChanges(), runs = all[st.pair] || [], best = changesBest(runs);
  all[st.pair] = [{ n: r.n, d: dayKey(new Date()) }, ...runs].slice(0, 20);
  writeChanges(all); markToday();
  document.getElementById("changestatus").innerHTML = !runs.length ? `<b>${r.n}</b> changes. That's your first score for this pair: now beat it.`
    : r.n > best ? `<b>${r.n}</b> changes: a new best, up from ${best}.`
    : `<b>${r.n}</b> changes. Your best is ${best}. Slow and clean still beats fast and buzzing.`;
  renderChanges();
  if (typeof renderToday === "function") renderToday();
  return r.n;
}
// Space counts a change while a minute is running, unless you're typing somewhere.
document.addEventListener("keydown", e => {
  if (e.key !== " " || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable === true)) return;
  if (typeof state !== "undefined" && state.changes && state.changes.run) { e.preventDefault(); changesTap(); }
});
// A focused button acts on Space when the key comes back up; during a minute, Space is the
// counter, so it mustn't also press whichever button has focus (Stop, most likely).
document.addEventListener("keyup", e => {
  if (e.key === " " && typeof state !== "undefined" && state.changes && state.changes.run && e.target && e.target.tagName === "BUTTON") e.preventDefault();
});
