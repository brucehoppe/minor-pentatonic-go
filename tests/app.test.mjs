import assert from "node:assert/strict";

// Values built inside the vm realm have a different Array/Object prototype, so
// assert.deepEqual (strict) rejects them. Compare structurally instead.
const sameShape = (actual, expected, msg) =>
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), msg);

// The nav is a set of labelled bands, each holding its own buttons, so reaching a
// view button means flattening one level and skipping the band headings.
const navButtons = document =>
  document.getElementById("views").children.flatMap(row => row.children)
    .filter(el => el.dataset.v);
const navButton = (document, view) => navButtons(document).find(b => b.dataset.v === view);
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
const lesson = readFileSync(new URL("../web/seven-licks.html", import.meta.url), "utf8");
const lessonScript = readFileSync(new URL("../web/seven-licks.js", import.meta.url), "utf8");

class Element {
  constructor(id = "") {
    this.id = id; this.children = []; this.dataset = {}; this.style = {};
    this.attributes = {}; this.hidden = false; this.disabled = false;
    this.innerHTML = ""; this.textContent = ""; this.value = "90";
    const classes = new Set();
    this.classList = {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c), toggle: (c, on) =>
        (on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c),
    };
  }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener() {}
  closest() { return null; }
  querySelector() { return new Element(); }
  querySelectorAll() { return []; }
  scrollIntoView() {}
  // A disabled button does nothing when clicked, here as in a browser — which is
  // what makes the toolbar-gating tests below mean anything.
  click() { if (!this.disabled && this.onclick) this.onclick({ currentTarget: this, target: this }); }
}

// audio: "web" (default) | "wav" (no AudioContext, only HTMLAudioElement) | false (neither)
// media: false (default, no microphone API) | true | { types, devices, deny } — a stand-in
// for getUserMedia and MediaRecorder; types lists the containers isTypeSupported accepts.
// deterministic: fix Math.random, so a view that generates a fresh quiz or session
// on every draw still renders identically twice — without that, "did this control
// change anything?" cannot be answered by comparing two renders.
function makeRuntime({ audio: audioMode = "web", deterministic = false, demo = false, media = false } = {}) {
  const MathForApp = deterministic
    ? new Proxy(Math, { get: (t, k) => (k === "random" ? () => 0.42 : t[k]) })
    : Math;
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const elements = new Map(ids.map(id => [id, new Element(id)]));
  // startTimes records when each oscillator was booked to sound, on the fake audio
  // clock; clock.t is that clock, which a test moves forward with advance().
  const audio = { oscillators: 0, starts: 0, stops: 0, gains: 0, startTimes: [], taps: [], untaps: [] };
  const clock = { t: 0, wall: 0 };
  class AudioParam { setValueAtTime() {} exponentialRampToValueAtTime() {} cancelScheduledValues() {} }
  class AudioContext {
    constructor() { this.state = "running"; this.destination = {}; }
    get currentTime() { return clock.t; }
    resume() { return Promise.resolve(); }
    createGain() { audio.gains++; return { gain: new AudioParam(),
      connect(node) { if (node && node.stream) audio.taps.push(node); },
      disconnect(node) { audio.untaps.push(node); } }; }
    createMediaStreamDestination() { return { stream: { destination: true }, channelCount: 2, connect() {} }; }
    createMediaStreamSource(input) { const n = { input, connected: [], connect(d) { n.connected.push(d); },
      disconnect() { n.connected = []; } }; return n; }
    // decodes any take to one second of stereo 48 kHz
    decodeAudioData() { return Promise.resolve({ numberOfChannels: 2, sampleRate: 48000,
      getChannelData: () => new Float32Array(48000).fill(0.25) }); }
    createOscillator() { audio.oscillators++; return { type: "sine", frequency: new AudioParam(), connect() {},
      start(t) { audio.starts++; audio.startTimes.push(t); }, stop() { audio.stops++; } }; }
    createBiquadFilter() { return { type: "lowpass", frequency: new AudioParam(), connect() {} }; }
  }
  const document = {
    addEventListener() {},
    body: new Element("body"),
    title: "",
    getElementById(id) { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); },
    createElement() { return new Element(); },
    querySelector() { return null; },
    // SUPPORTED SELECTORS — the whole of it.
    //
    // This mock understands exactly one shape: "#some-id button", which returns
    // the children appended to that host by mk(). Everything else — class
    // selectors (".gchk", ".segrun", ".timerpreset", ".guidekey"), descendant
    // class selectors ("#boxes .card", "#chart .strip", "#quizboard .qn"),
    // attribute selectors ("#path button[data-goto]") and tag.class ("g.pn") —
    // returns an empty list rather than throwing.
    //
    // That means code which only iterates those selectors is NOT covered by these
    // tests: the loop body never runs and the test still passes. When adding a
    // feature that hangs its behaviour off one of them, assert on the generated
    // HTML string instead, or teach this function the selector first.
    querySelectorAll(selector) {
      const match = selector.match(/^#([\w-]+) button$/);
      return match ? document.getElementById(match[1]).children : [];
    },
  };
  const intervals = new Map(); let intervalID = 0;
  const stored = new Map();
  const localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key,value) => stored.set(key,String(value)) };
  // a stand-in for HTMLAudioElement, which is all the compatibility engine needs
  const audioElements = [];
  class AudioEl {
    constructor(src) { this.src = src; this.loop = false; this.volume = 1; audioElements.push(this); }
    play() { this.playing = true; return Promise.resolve(); }
    pause() { this.playing = false; }
    addEventListener() {}
  }
  let windowClosed = false;
  const window = audioMode === "web"
    ? { AudioContext, webkitAudioContext: AudioContext, localStorage, addEventListener() {} }
    : { localStorage, addEventListener() {} };   // Lockdown Mode withholds AudioContext
  // Browsers refuse this for a tab the script did not open, which is the normal
  // case here — the test for Quit covers both answers.
  window.close = () => { windowClosed = true; };
  // the packaged app serves the page over http, so the Quit row is live in tests too
  const fetched = [];
  const location = demo
    ? { protocol: "https:", host: "brucehoppe.github.io", hostname: "brucehoppe.github.io" }
    : { protocol: "http:", host: "127.0.0.1:8080", hostname: "127.0.0.1" };
  const fetch = (url, opts = {}) => {
    fetched.push({ url, method: opts.method ?? "GET", headers: opts.headers ?? {} });
    // The app's /about; demo decides what a static host (GitHub Pages) would answer.
    const body = url === "/about" && !demo ? "Minor Pentatonic Practice Desk 1.2.3\nCoded by Bruce Hoppe\n" : "Not Found";
    return Promise.resolve({ ok: body !== "Not Found", text: () => Promise.resolve(body) });
  };
  const navigator = { userAgent: "" };
  // the recorder's world: what was asked of getUserMedia, each MediaRecorder built,
  // and every blob URL minted or revoked
  const rec = { asked: [], recorders: [], urls: [], revoked: [], tracksStopped: 0 };
  const mediaOpts = media === true ? {} : media || {};
  const types = mediaOpts.types ?? ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  class MediaRecorder {
    static isTypeSupported(t) { return types.includes(t); }
    constructor(stream, opts = {}) {
      this.stream = stream; this.opts = opts; this.mimeType = opts.mimeType ?? ""; this.state = "inactive";
      rec.recorders.push(this);
    }
    start(slice) { this.state = "recording"; this.slice = slice; }
    stop() {
      this.state = "inactive";
      if (this.ondataavailable) this.ondataavailable({ data: new Blob(["x".repeat(3000)]) });
      if (this.onstop) this.onstop();
    }
  }
  if (media) {
    navigator.mediaDevices = {
      getUserMedia(c) {
        rec.asked.push(c);
        if (mediaOpts.deny) return Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
        return Promise.resolve({ getTracks: () => [{ stop() { rec.tracksStopped++; } }] });
      },
      enumerateDevices: () => Promise.resolve(mediaOpts.devices ?? []),
      addEventListener() {},
    };
  }
  const URLForApp = { createObjectURL: b => { const u = `blob:${rec.urls.length}`; rec.urls.push({ u, b }); return u; },
    revokeObjectURL: u => rec.revoked.push(u) };
  const context = vm.createContext({
    console, document, window, Math: MathForApp, location, fetch, navigator,
    btoa: (str) => Buffer.from(str, "binary").toString("base64"),
    ...(audioMode === false ? {} : { Audio: AudioEl }),
    ...(media ? { MediaRecorder } : {}), Blob, URL: URLForApp,
    // wall-clock time the tests can move on, for how long a take has run
    Date: class extends Date { static now() { return Date.now() + clock.wall * 1000; } },
    setTimeout: fn => { fn(); return 1; },
    setInterval: fn => { const id = ++intervalID; intervals.set(id, fn); return id; },
    clearInterval: id => intervals.delete(id),
  });
  vm.runInContext(script + `\n;globalThis.appTest={render,renderLand,renderChart,renderMajor,renderModes,MODES,modeNotes,modeMap,currentMode,
    modeOrigins,renderNotes,neckNames,OCTAVES,NATURALS,
    renderTriads,TRIAD_KINDS,TRIAD_SETS,triadShapes,triadVoicing,midiAt,allTriadVoicings,
    renderInversions,PROGRESSIONS,voiceLead,travel,chordLabel,INVERSION,fretboard,
    setInv:(s,p)=>{state.invSet=s;state.invProg=p},
    fingering,fingerTable,fingerHint,fingerBoard,FINGER,
    doMove:()=>{state.invStep=(state.invStep+1)%3;state.invMoved=true;renderInversions()},
    resetMove:()=>{state.invStep=0;state.invMoved=false;renderInversions()},
    setNoteHL:v=>{state.noteHL=v},setNoteString:v=>{state.noteString=v},
    setTriad:(k,t)=>{state.triadKind=k;state.triadSet=t},setMode:v=>{state.modeId=v},VIEWS,majorBoard,majorTab,majRoot,MAJKEYS,MAJ_PAT,
    setMajor:(k,d,a)=>{state.majorKey=k;state.majorDegrees=d;state.majorArrows=a},keyStrip,runNotes,runTab,
    toggleDrone,toggleClick,restartClick,newQuiz,newSession,setTimer,toggleTimer,resetTimer,ladder,resetLadder,
    audio,audioOff,check,trainerSound,rhythmSound,timerCue,noAudioReason,compatibilityReason,isSafari,
    webAudioEngine,wavEngine,freq,getEngine:()=>state.engine,getAudioFault:()=>state.audioFault,
    renderSolo,soloZone,soloRoot,buildRun,SOLOPATTERNS,saveSolo,loadSolo,playSolo,stopSolo,
    setSoloBoxes:v=>{state.soloBoxes=v},setSoloRun:v=>{state.soloRun=v},
    setUserAgent:v=>{navigator.userAgent=v},
    CH_SCALE,CH_GRID,CH_STR,CH_MARK,CH_TEXT,CH_GOLD,
    boxRoot,groupRoot,boxSpan,fitRoot,moved,regInfo,
    renderGuide,readChecks,writeChecks,CHECKLIST,ROUTINES,FOCUS,SONGPROJ,GUIDEROOTS,GUIDEKEYS,strNo,
    renderTheory,readArrangement,writeArrangement,ARRANGEMENT_KEY,
    renderHijaz,pdBox,pdName,PD_OFFSETS,PD_DEGREES,renderOpen,OPEN_TUNINGS,tuningMidi,TUNING_EXAMPLES,TUNING_OPEN_CHORDS,renderPower,renderForm,pcTab,pc2,pc3,rootOn,PCPAIR,PCSHAPES,PCPROG,PCSONG,SONGKEY,FORMS,SECTIONS,SECCOL,formStrip,
    renderBlues,bluesMap,boxesAt,fitsNeck,midiAt,midiFreq,pluck,playRun,REGS,MAXFRET,ZONES,withB5,b5Notes,noteAt,deg,isB5,
    setKey:k=>{state.key=k},setReg:r=>{state.reg=r},setB5:v=>{state.showB5=v},setBlueLock:z=>{state.blueLock=z},
    setLabelMode:v=>{state.labelMode=v},setChord:v=>{state.chord=v},viewCfg,
    toggleRecord,stopRecording,REC_MAX_SEC,recMime,recExt,takeName,fileSize,wavBytes,getRec:()=>state.rec,getTake:()=>state.recTake,
    setBpm:v=>{state.bpm=v},
    renderTrainer,toggleTrainer,resetTrainer,trainerTick,chordName,currentForm,BLUES_FORMS,barSymbols,symbolAt,chordInfo,CHORD_KIND,generateRhythm,renderRhythm,toggleRhythm,stopRhythm,
    completeSession,clearLog,readLog,baseFret,rootFret,validBoxes,boxNotes,NOTES,BOXES,LICKS,RUN_UP,RUN_DN,
    getState:()=>({key:state.key,view:state.view,labelMode:state.labelMode,chord:state.chord,reg:state.reg,chartOpen:state.chartOpen,boxLock:state.boxLock,droneNodes:state.droneHandle,clickTimer:state.clickTimer,bpm:state.bpm,timerSeconds:state.timerSeconds,timerInitial:state.timerInitial,timerHandle:state.timerHandle,ladderRound:state.ladderRound,
      trainerTimer:state.trainerTimer,trainerBar:state.trainerBar,trainerBeat:state.trainerBeat,trainerCount:state.trainerCount,rhythmTimer:state.rhythmTimer,rhythmStep:state.rhythmStep,rhythm:[...state.rhythm],showB5:state.showB5,blueLock:state.blueLock,
      soloBoxes:[...state.soloBoxes],soloRun:[...state.soloRun],soloTimer:state.soloTimer,soloStep:state.soloStep,storage:window.localStorage})};`, context);
  // advance(seconds) moves the audio clock on and lets every running loop catch up,
  // which is what the browser's 25 ms pump timer does in real life.
  const advance = seconds => { clock.t += seconds; for (const fn of [...intervals.values()]) fn(); };
  return { app: context.appTest, document, audio, intervals, fetched, audioElements, clock, advance, rec,
    closed: () => windowClosed };
}

test("all revised navigation views render", () => {
  const { app, document } = makeRuntime();
  const views = ["hijaz","open","path","song","melody","boxes","solo","connect","land","major","modes","notes","triads","inv","chart","cross","blues","power","form","licks","trainer","rhythm","theory","practice"];
  for (const view of views) {
    navButton(document, view).click();
    assert.equal(app.getState().view, view);
    assert.equal(document.getElementById(`v-${view}`).hidden, false);
  }
  assert.equal(navButtons(document).length, views.length);
});

test("the VIEWS table is the single source of truth for the nav", () => {
  const { app, document } = makeRuntime();
  const buttons = navButtons(document);
  assert.equal(buttons.length, app.VIEWS.length);
  app.VIEWS.forEach(([id, label, draw, cfg], i) => {
    assert.equal(buttons[i].dataset.v, id, `button ${i} is ${id}`);
    assert.equal(buttons[i].textContent, label, `${id} is labelled from the table`);
    assert.equal(typeof draw, "function", `${id} has a renderer`);
    assert.ok(document.getElementById(`v-${id}`), `${id} has a section`);
    assert.ok(cfg && cfg.band, `${id} names the nav band it belongs to`);
  });
});

test("all keys, labels, chords, and registers update state", () => {
  const { app, document } = makeRuntime();
  navButton(document, "boxes").click();   // the view that answers to every control
  for (let key = 0; key < 12; key++) {
    document.getElementById("keys").children[key].click();
    assert.equal(app.getState().key, key);
  }
  for (const mode of ["name", "interval", "none"]) {
    document.getElementById("labels").children.find(b => b.dataset.l === mode).click();
    assert.equal(app.getState().labelMode, mode);
  }
  for (const chord of ["off", "i", "iv", "v"]) {
    document.getElementById("chords").children.find(b => b.dataset.c === chord).click();
    assert.equal(app.getState().chord, chord === "off" ? null : chord);
  }
  document.getElementById("regs").children.find(b => Number(b.dataset.r) === 0).click();
  assert.equal(app.getState().reg, 0);
});

test("5 boxes combines selections and keeps the practice pair across keys and registers", () => {
  const { app, document } = makeRuntime();
  navButton(document, "boxes").click();
  const buttons = document.getElementById("boxselect").children;
  const lit = () => new Set([...document.getElementById("fullmap").innerHTML.matchAll(
    /<circle cx="([^"]+)" cy="([^"]+)" r="8.5"[^>]*opacity="1"/g
  )].map(m => `${m[1]},${m[2]}`));
  buttons[0].click();
  const one = lit();
  buttons[0].click();
  buttons[2].click();
  const three = lit();
  buttons[0].click();
  assert.deepEqual(lit(), new Set([...one, ...three]), "both shapes stay lit together");
  sameShape(app.getState().boxLock, [1, 3]);
  assert.equal(buttons[0].getAttribute("aria-pressed"), "true");
  assert.equal(buttons[2].getAttribute("aria-pressed"), "true");
  assert.equal(buttons[1].getAttribute("aria-pressed"), "false");
  assert.match(document.getElementById("maplabel").textContent, /Boxes 1 \+ 3 selected/);
  buttons[0].click();
  assert.deepEqual(lit(), three, "removing Box 1 leaves Box 3 lit");
  buttons[0].click();
  document.getElementById("keys").children[0].click();
  document.getElementById("regs").children[0].click();
  sameShape(app.getState().boxLock, [1, 3], "the pair survives key and register changes");
  document.getElementById("boxreset").click();
  sameShape(app.getState().boxLock, []);
  assert.doesNotMatch(document.getElementById("fullmap").innerHTML, /opacity="0.12"/);
});

test("box tips name the strings that actually hold the box's roots", () => {
  const { app } = makeRuntime();
  // A note at offset x on string s is a root when it matches the low-E root at offset 0.
  const OPEN = [4, 11, 7, 2, 9, 4], NAME = ["e", "B", "G", "D", "A", "E"];
  const roots = app.BOXES.map(b => b.off.flatMap((p, s) => p.some(x => (OPEN[s] + x - OPEN[5] + 12) % 12 === 0) ? [NAME[s]] : []));
  sameShape(roots, [["e", "D", "E"], ["B", "D"], ["B", "A"], ["G", "A"], ["e", "G", "E"]], "root strings per box");
  assert.match(app.BOXES[0].tip, /both E strings/);
  assert.match(app.BOXES[1].tip, /Roots land on the D and B strings/);
  assert.match(app.BOXES[2].tip, /Roots on the A and B strings/);
});

test("every register keeps all five boxes on the neck, in every key", () => {
  const { app, document } = makeRuntime();
  navButton(document, "boxes").click();
  for (let key = 0; key < 12; key++) {
    document.getElementById("keys").children[key].click();
    for (const [reg] of app.REGS) {
      const btn = document.getElementById("regs").children.find(b => Number(b.dataset.r) === reg);
      assert.equal(btn.disabled, false, `${app.NOTES[key]} reg ${reg} is always selectable`);
      btn.click();
      assert.equal(app.validBoxes().length, 5, `${app.NOTES[key]} reg ${reg} exposes all five boxes`);
      for (const b of app.BOXES) {
        const { lo, hi } = app.boxSpan(b);
        assert.ok(lo >= 0, `${app.NOTES[key]} reg ${reg} Box ${b.n} starts at or after the nut (${lo})`);
        assert.ok(hi <= app.MAXFRET, `${app.NOTES[key]} reg ${reg} Box ${b.n} ends by fret ${app.MAXFRET} (${hi})`);
        assert.ok(app.boxNotes(b).every(n => n.f >= 0 && n.f <= app.MAXFRET),
          `${app.NOTES[key]} reg ${reg} Box ${b.n} has every note on the neck`);
      }
    }
  }
});

test("Start here opens the views it names, including the newest ones", () => {
  const { app, document } = makeRuntime();
  const html = document.getElementById("path").innerHTML;
  const goto = [...html.matchAll(/data-goto="([^"]+)"/g)].map(m => m[1]);
  const ids = app.VIEWS.map(([id]) => id);
  for (const target of goto) assert.ok(ids.includes(target), `${target} is a real view`);
  for (const target of ["notes", "triads", "inv", "modes", "major", "solo", "melody", "trainer"])
    assert.ok(goto.includes(target), `the path opens ${target} rather than leaving it to be found`);
});

test("the toolbar greys out the controls a view does not use", () => {
  const { app, document } = makeRuntime();
  const rows = ["keys", "labels", "chords", "regs", "extras"];
  const state = () => Object.fromEntries(rows.map(id =>
    [id, document.getElementById(id).children.every(b => b.disabled === false)]));

  navButton(document, "boxes").click();
  sameShape(state(), { keys: true, labels: true, chords: true, regs: true, extras: true },
    "5 boxes answers to the whole bar");

  navButton(document, "path").click();
  sameShape(state(), { keys: false, labels: false, chords: false, regs: false, extras: false },
    "Start here is prose, so nothing in the bar applies");

  navButton(document, "triads").click();
  sameShape(state(), { keys: true, labels: true, chords: false, regs: false, extras: false },
    "Triads take a root and honour the Dots setting, and ignore the rest");

  // Every view has to declare itself, or the bar quietly lies about what it does.
  for (const [id, , , cfg] of app.VIEWS)
    for (const tool of (cfg.tools || "").split(" ").filter(Boolean))
      assert.ok(rows.includes(tool), `${id} names a real toolbar row, not "${tool}"`);
});

// The bar now makes a claim about every view: these controls do something here,
// those do nothing. That claim is checked the only way it can honestly be checked —
// by changing each control and seeing whether the view's own output moves.
//
// Probed in all twelve keys, because a control can be live in general and inert in
// most keys: Box 1 only has room to drop an octave in E minor, so Register moves
// nothing on the Solo runs view in the other eleven. "Live" therefore means it
// changes something in at least one key; "greyed" means it changes nothing in any.
test("every greyed control really is inert, and every live one really works", () => {
  const { app, document } = makeRuntime({ deterministic: true });
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  // the toolbar and nav redraw themselves on every render; what is under test is
  // whether the VIEW changed, so those are excluded from the signature
  const chrome = new Set(["keys", "keylbl", "labels", "chords", "regs", "extras",
    "views", "play", "approw", "appver", "quitmsg", "audiomsg", "credver"]);
  const signature = () => ids.filter(id => !chrome.has(id))
    .map(id => document.getElementById(id).innerHTML).join("\u0001");
  const draw = (fn) => { fn(); app.render(); return signature(); };

  const probeKeys = [...Array(12).keys()];
  const controls = {
    labels: [() => app.setLabelMode("name"), () => app.setLabelMode("interval")],
    chords: [() => app.setChord(null), () => app.setChord("i")],
    regs:   [() => app.setReg(0), () => app.setReg(-1)],
    extras: [() => app.setB5(false), () => app.setB5(true)],
  };

  for (const [view, label, , cfg] of app.VIEWS) {
    const live = new Set((cfg.tools || "").split(" ").filter(Boolean));
    navButton(document, view).click();

    // the key selector: does the view look different in a different key?
    app.setReg(0); app.setChord(null); app.setB5(false); app.setLabelMode("name");
    const byKey = probeKeys.map(k => draw(() => app.setKey(k)));
    assert.equal(new Set(byKey).size > 1, live.has("keys"),
      `${label}: the key selector is ${live.has("keys") ? "offered but changes nothing" : "greyed out but does change the view"}`);

    // the rest: does flipping it change anything, in any key?
    for (const [tool, [off, on]] of Object.entries(controls)) {
      let changed = false;
      for (const k of probeKeys) {
        app.setKey(k);
        changed = changed || draw(off) !== draw(on);
        draw(off);
      }
      assert.equal(changed, live.has(tool),
        live.has(tool)
          ? `${label}: the ${tool} control is offered but changes nothing`
          : `${label}: the ${tool} control is greyed out but does change the view`);
    }
    app.setKey(9);
  }
});

test("the key selector says what the current view means by it", () => {
  const { app, document } = makeRuntime();
  const labels = () => document.getElementById("keys").children.map(b => b.textContent);

  navButton(document, "boxes").click();
  assert.equal(document.getElementById("keylbl").textContent, "Key");
  assert.ok(labels().includes("Am"), "a minor-pentatonic view names minor keys");

  for (const view of ["triads", "inv", "modes"]) {
    navButton(document, view).click();
    assert.equal(document.getElementById("keylbl").textContent, "Root", `${view} asks for a root`);
    assert.ok(labels().includes("A"), `${view} names bare roots`);
    assert.ok(!labels().includes("Am"), `${view} never calls a major triad's root minor`);
  }
});

test("Box 1 and Box 4 landmark lesson renders its full curriculum", () => {
  const { app, document } = makeRuntime();
  app.renderLand();
  const land = document.getElementById("land").innerHTML;
  for (const marker of ["Box 1 — landmark A", "Box 4 — landmark B", "Sliding up",
    "Sliding down", "Call and answer", "All twelve keys"]) assert.match(land, new RegExp(marker));
  assert.equal(app.RUN_UP.length, 10);
  assert.equal(app.RUN_DN.length, 10);
  assert.match(app.runTab(app.RUN_UP), /\//);
  assert.match(land, /pink arrows/i);
});

test("major pentatonic diagonal draws every key, both dot modes, and the arrows", () => {
  const { app, document } = makeRuntime();
  assert.equal(app.MAJKEYS.length, 12);
  // 2-3-2-3-2-3, low E to high e, is the whole shape
  sameShape(app.MAJ_PAT.map(p => p.length), [2, 3, 2, 3, 2, 3]);

  app.MAJKEYS.forEach((k, i) => {
    app.setMajor(i, false, true);
    app.renderMajor();
    const board = document.getElementById("majorboard").innerHTML;
    const root = app.majRoot();
    assert.ok(root >= 0 && root < 12, `${k.n}: root fret ${root} is on the neck`);
    // 15 dots: 2+3+2+3+2+3
    assert.equal((board.match(/class="majdot"/g) ?? []).length, 15, `${k.n}: fifteen notes`);
    // three roots: the A string anchor, then the G and high e strings above it
    assert.equal((board.match(/class="majdot" fill="var\(--pink\)"/g) ?? []).length, 3, `${k.n}: roots`);
    assert.match(board, new RegExp(`${k.n.replace("#", "#")} major pentatonic`));
    assert.match(board, new RegExp(`>${k.n}<`), `${k.n}: the root note is named on the board`);
    // three arrows, one per three-note string
    assert.equal((board.match(/marker-end="url\(#majarrow\)"/g) ?? []).length, 3);
    const tab = document.getElementById("majortab").textContent.split("\n");
    assert.equal(tab.length, 6);
    assert.equal(tab[0], `e | ${root + 5} ${root + 7} ${root + 9}`);
    assert.equal(tab[5], `E | ${root} ${root + 2}`);
    assert.match(document.getElementById("majorcap").textContent, /minor pentatonic/);
  });

  // C major reads as scale degrees, and drops the arrows on request
  app.setMajor(0, true, false);
  app.renderMajor();
  const degrees = document.getElementById("majorboard").innerHTML;
  for (const d of ["1", "2", "3", "5", "6"]) assert.match(degrees, new RegExp(`>${d}<`));
  assert.doesNotMatch(degrees, /majarrow\)/);
  assert.match(document.getElementById("majorcap").textContent, /C major pentatonic/);
  assert.match(document.getElementById("majorcap").textContent, /A minor pentatonic/);
});

test("every mode is a well-formed seven-note scale spelled from the same root", () => {
  const { app } = makeRuntime();
  assert.ok(app.MODES.length >= 13, `${app.MODES.length} modes`);

  const shapes = new Map();
  for (const m of app.MODES) {
    assert.equal(m.offs.length, 7, `${m.name} has seven notes`);
    assert.equal(m.degs.length, 7, `${m.name} spells all seven degrees`);
    assert.equal(m.offs[0], 0, `${m.name} starts on the root — every mode here is parallel`);
    assert.equal(new Set(m.offs).size, 7, `${m.name} has no duplicate notes`);
    for (let i = 1; i < 7; i++) assert.ok(m.offs[i] > m.offs[i - 1], `${m.name} ascends`);
    assert.ok(m.offs[6] < 12, `${m.name} stays inside one octave`);
    assert.ok(m.colour.length >= 1, `${m.name} names its colour tone`);
    for (const c of m.colour) {
      assert.ok(m.offs.includes(c), `${m.name}: colour tone ${c} is in the scale`);
      assert.notEqual(c, 0, `${m.name}: the root is not what distinguishes a mode`);
    }
    for (const field of ["name", "sub", "family", "near", "sound", "vamp"]) {
      assert.ok(m[field] && m[field].length > 0, `${m.name} has ${field}`);
    }
    const key = m.offs.join(",");
    if (shapes.has(key)) assert.fail(`${m.name} is the same scale as ${shapes.get(key)}`);
    shapes.set(key, m.name);
  }
});

test("modes are spelled correctly in A", () => {
  const { app } = makeRuntime();
  app.setKey(9); // A
  const spell = id => {
    const m = app.MODES.find(x => x.id === id);
    return m.offs.map(d => app.NOTES[(9 + d) % 12]);
  };
  sameShape(spell("ionian"), ["A", "B", "C#", "D", "E", "F#", "G#"]);
  sameShape(spell("aeolian"), ["A", "B", "C", "D", "E", "F", "G"]);
  sameShape(spell("dorian"), ["A", "B", "C", "D", "E", "F#", "G"]);
  sameShape(spell("phrygian"), ["A", "A#", "C", "D", "E", "F", "G"]);
  sameShape(spell("lydian"), ["A", "B", "C#", "D#", "E", "F#", "G#"]);
  sameShape(spell("mixolydian"), ["A", "B", "C#", "D", "E", "F#", "G"]);
  sameShape(spell("locrian"), ["A", "A#", "C", "D", "D#", "F", "G"]);
  // 1 b2 3 4 5 b6 7 — the double harmonic major
  sameShape(spell("byzantine"), ["A", "A#", "C#", "D", "E", "F", "G#"]);
  sameShape(spell("harmonicminor"), ["A", "B", "C", "D", "E", "F", "G#"]);
  sameShape(spell("hungarianminor"), ["A", "B", "C", "D#", "E", "F", "G#"]);

  // dorian is aeolian with one note moved, which is the whole point of the parallel view
  const differ = (a, b) => {
    const A = app.MODES.find(m => m.id === a).offs, B = app.MODES.find(m => m.id === b).offs;
    return A.filter(x => !B.includes(x));
  };
  sameShape(differ("dorian", "aeolian"), [9], "dorian raises the 6th");
  sameShape(differ("phrygian", "aeolian"), [1], "phrygian flattens the 2nd");
  sameShape(differ("lydian", "ionian"), [6], "lydian raises the 4th");
  sameShape(differ("mixolydian", "ionian"), [10], "mixolydian flattens the 7th");
});

test("changing mode animates the note that moved, and only on a change", () => {
  const { app, document } = makeRuntime();
  app.setKey(9);
  const map = () => document.getElementById("modesummary").innerHTML;

  app.setMode("aeolian"); app.renderModes();
  assert.doesNotMatch(map(), /modemove/, "natural minor is the reference, so nothing has moved");

  app.setMode("dorian"); app.renderModes();
  assert.match(map(), /class="modemove anim"/, "the 6 slides in from the ♭6");
  assert.match(map(), /class="modewas anim"/, "and leaves an outline where it was");
  assert.match(map(), /--dx:-?\d/, "with a distance to travel");

  app.renderModes();
  assert.match(map(), /class="modemove"/, "a redraw still shows where the note came from");
  assert.doesNotMatch(map(), /anim/, "but does not replay the move");

  app.setMode("ionian"); app.renderModes();
  assert.doesNotMatch(map(), /modemove/, "the major scale is the other reference");

  // every mode either is a reference scale or names the note it moved
  for (const mode of app.MODES) {
    const origins = [...app.modeOrigins(mode)];
    for (const [degree, from] of origins) {
      assert.ok(mode.offs.includes(degree), `${mode.id}: the moved note is in the mode`);
      assert.ok(!mode.offs.includes(from), `${mode.id}: the note it replaced is not`);
      assert.ok(Math.abs(degree - from) <= 2, `${mode.id}: it moved a fret or two, not a leap`);
    }
    if (!["ionian", "aeolian"].includes(mode.id))
      assert.ok(origins.length, `${mode.id} says which note makes it that mode`);
  }
});

// Every scale and chord in this app carries prose next to it — "1 ♭3 5", "minor
// with a bright 6", "the ♭6 raised". Prose is the part no diagram can check, so it
// gets checked here: each written degree is converted back to a number of semitones
// and matched against the intervals the code actually draws.
test("the written theory matches the intervals it claims", () => {
  const { app } = makeRuntime();
  const BASE = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11 };
  const semitones = (degree) => {
    const m = degree.match(/^([♭#]*)([1-7])$/);
    assert.ok(m, `"${degree}" is a readable degree name`);
    const [, marks, num] = m;
    return BASE[num] + [...marks].reduce((a, c) => a + (c === "#" ? 1 : -1), 0);
  };

  for (const mode of app.MODES) {
    assert.equal(mode.degs.length, mode.offs.length, `${mode.id}: a name per note`);
    mode.offs.forEach((off, i) => assert.equal(semitones(mode.degs[i]), off,
      `${mode.name}: "${mode.degs[i]}" is ${semitones(mode.degs[i])} semitones, drawn at ${off}`));
    // the colour tones it advertises are notes it actually contains
    for (const d of mode.colour)
      assert.ok(mode.offs.includes(d), `${mode.name}: its colour tone is in the scale`);
  }

  for (const kind of app.TRIAD_KINDS) {
    kind.iv.forEach((iv, i) => assert.equal(semitones(kind.degs[i]), iv,
      `${kind.name} triad: "${kind.degs[i]}" is ${semitones(kind.degs[i])} semitones, built at ${iv}`));
    assert.equal(kind.iv[0], 0, `${kind.name} triad starts on its root`);
  }
});

// The Modes view now states, in words, which note each mode moves and where it
// moved from. That claim is the teaching content of the view, so it is spelled out
// here against the textbook rather than left to the code that generates it.
test("each mode names the right altered note, against the parent scale", () => {
  const { app } = makeRuntime();
  const expected = {
    ionian: [],                                   // the reference itself
    aeolian: [],                                  // the other reference
    dorian: [[9, 8]],                             // natural 6 in place of the ♭6
    phrygian: [[1, 2]],                           // ♭2 in place of the 2
    lydian: [[6, 5]],                             // #4 in place of the 4
    mixolydian: [[10, 11]],                       // ♭7 in place of the 7
    locrian: [[1, 2], [6, 7]],                    // ♭2 and ♭5
    harmonicminor: [[11, 10]],                    // leading tone for the ♭7
    melodicminor: [[9, 8], [11, 10]],             // raised 6 and 7
    phrygiandominant: [[1, 2]],                   // ♭2 over a major 3
    byzantine: [[1, 2], [8, 9]],                  // ♭2 and ♭6 on a major scale
    hungarianminor: [[6, 5], [11, 10]],           // #4 and leading tone
    lydiandominant: [[6, 5], [10, 11]],           // #4 and ♭7
  };
  assert.equal(Object.keys(expected).length, app.MODES.length, "every mode is accounted for");
  for (const mode of app.MODES) {
    const got = [...app.modeOrigins(mode)].sort((a, b) => a[0] - b[0]);
    sameShape(got, expected[mode.id].sort((a, b) => a[0] - b[0]),
      `${mode.name}: the note it moves, and where it moved from`);
  }
});

test("mode positions cover the scale in playable windows, in every key", () => {
  const { app } = makeRuntime();
  for (let key = 0; key < 12; key++) {
    app.setKey(key);
    for (const mode of app.MODES) {
      const found = new Set();
      for (const box of app.validBoxes()) {
        const { lo, hi } = app.boxSpan(box);
        const notes = app.modeNotes(mode, lo, hi);
        const perString = [0, 1, 2, 3, 4, 5].map(s => notes.filter(n => n.s === s).length);
        // a playable position: never a bare string, never more than a stretch
        assert.ok(Math.min(...perString) >= 2 && Math.max(...perString) <= 4,
          `${app.NOTES[key]} ${mode.name} box ${box.n}: ${perString.join(",")} notes per string`);
        for (const n of notes) {
          const d = (app.noteAt(n.s, n.f) - key + 12) % 12;
          assert.ok(mode.offs.includes(d), `${mode.name}: fret ${n.f} is in the scale`);
          const want = d === 0 ? "root" : mode.colour.includes(d) ? "pivot" : "tone";
          assert.equal(n.kind, want, `${mode.name}: degree ${d} is drawn as ${want}`);
          found.add(d);
        }
      }
      assert.equal(found.size, 7, `${app.NOTES[key]} ${mode.name}: all seven degrees appear somewhere`);
    }
  }
});

test("the modes view draws a summary, a neck map and five positions", () => {
  const { app, document } = makeRuntime();
  app.setKey(9);
  for (const mode of app.MODES) {
    app.setMode(mode.id);
    app.renderModes();
    const summary = document.getElementById("modesummary").innerHTML;
    const boxes = document.getElementById("modeboxes").innerHTML;
    assert.match(summary, new RegExp(`A ${mode.name}`), `${mode.id} is titled`);
    assert.match(summary, /<svg /, `${mode.id} draws the whole neck`);
    assert.doesNotMatch(summary, /undefined|NaN/, `${mode.id} summary is complete`);
    assert.equal((boxes.match(/class="card"/g) ?? []).length, 5, `${mode.id} draws five positions`);
    assert.equal((boxes.match(/<svg /g) ?? []).length, 5, `${mode.id} draws five fretboards`);
    assert.doesNotMatch(boxes, /undefined|NaN/, `${mode.id} positions are complete`);
    // the colour tones are gold, and the root is pink, in the neck map
    assert.match(summary, /fill="var\(--gold\)"/, `${mode.id} marks its colour tone`);
    assert.match(summary, /fill="var\(--pink\)"/, `${mode.id} marks the root`);
  }
  // the mode buttons are built from the data
  const buttons = document.getElementById("modes").children;
  assert.equal(buttons.length, app.MODES.length);
  app.MODES.forEach((m, i) => assert.equal(buttons[i].textContent, m.name));
});

test("the note-name neck labels every position on every string", () => {
  const { app, document } = makeRuntime();
  app.setNoteHL(null); app.setNoteString(null);
  app.renderNotes();
  const neck = document.getElementById("neck").innerHTML;
  // 6 strings x 25 frets, every one named
  for (const name of app.NOTES) assert.match(neck, new RegExp(`>${name.replace("#", "#")}<`));
  // 24 fret numbers (fret 0 is the nut), 6 string names, 6 x 25 positions
  assert.equal((neck.match(/<text /g) ?? []).length, 24 + 6 + 6 * 25,
    "a label for every fret number, every string name and every position");
  assert.doesNotMatch(neck, /undefined|NaN/);

  // highlighting a note lights every occurrence and nothing else
  for (let pc = 0; pc < 12; pc++) {
    app.setNoteHL(pc);
    app.renderNotes();
    const lit = document.getElementById("neck").innerHTML;
    let want = 0;
    for (let s = 0; s < 6; s++) for (let f = 0; f <= app.MAXFRET; f++) if (app.noteAt(s, f) === pc) want++;
    assert.equal((lit.match(/fill="var\(--pink\)"/g) ?? []).length, want,
      `${app.NOTES[pc]} appears ${want} times in 24 frets`);
    assert.match(document.getElementById("necklabel").innerHTML, new RegExp(`Every <b>${app.NOTES[pc].replace("#", "#")}</b>`));
  }
  app.setNoteHL(null);
});

// The Note names view teaches four flat facts about the neck in prose. Prose drifts;
// tuning does not. Each claim is checked against the app's own OPEN tuning, and the
// page is checked for still making the claim — so neither half can move alone.
test("the neck facts the Note names view states are true of this tuning", () => {
  const { app } = makeRuntime();
  const notes = app.NOTES;

  // "Fret 5 is the next string open — except G to B, which is fret 4."
  for (let s = 0; s < 5; s++) {                 // 0 is the high e, 5 the low E
    const fret = s === 1 ? 4 : 5;               // the B string is the exception
    assert.equal(app.noteAt(s + 1, fret), app.noteAt(s, 0),
      `fret ${fret} on the ${["e","B","G","D","A","E"][s + 1]} string is the open ${["e","B","G","D","A","E"][s]}`);
  }
  assert.match(html, /Fret 5 is the next string open/);
  assert.match(html, /except G to B, which is fret 4/);

  // "Fret 12 is the open string again."
  for (let s = 0; s < 6; s++)
    assert.equal(app.noteAt(s, 12), app.noteAt(s, 0), "the neck repeats at fret 12");
  assert.match(html, /Fret 12 is the open string again/);

  // "The low E and high e are identical."
  for (let f = 0; f <= app.MAXFRET; f++)
    assert.equal(app.noteAt(0, f), app.noteAt(5, f), `fret ${f} matches on both E strings`);
  assert.match(html, /The low E and high e are identical/);

  // "B to C and E to F have no sharp between them."
  for (const [from, to] of [["B", "C"], ["E", "F"]])
    assert.equal(notes[(notes.indexOf(from) + 1) % 12], to, `${from} is one fret below ${to}`);
  for (const name of notes) assert.ok(!/^(B#|E#)$/.test(name), "no B# or E# is ever drawn");
  assert.match(html, /B to C and E to F have no sharp between them/);

  // and the natural notes the diagram circles really are the seven naturals
  sameShape(app.NATURALS.map(pc => notes[pc]), ["C", "D", "E", "F", "G", "A", "B"]);
});

test("the octave shapes are real octaves, and the G-to-B pair is the odd one", () => {
  const { app, document } = makeRuntime();
  assert.ok(app.OCTAVES.length >= 5);
  for (const o of app.OCTAVES) {
    const [s1, f1] = o.from, [s2, f2] = o.to;
    assert.equal(app.noteAt(s1, f1), app.noteAt(s2, f2), `${o.n}: same note name`);
    const gap = app.midiAt(s2, f2) - app.midiAt(s1, f1);
    assert.equal(gap % 12, 0, `${o.n}: a whole number of octaves apart`);
    assert.ok(gap > 0, `${o.n}: goes up`);
    assert.ok(o.tip && o.tip.length > 40, `${o.n}: explains itself`);
  }
  // skipping one string is two frets — except across the B string, where it is three,
  // which is the same tuning quirk that shifts every shape crossing G to B
  const named = Object.fromEntries(app.OCTAVES.map(o => [o.n, o]));
  const frets = n => named[n].to[1] - named[n].from[1];
  assert.equal(frets("Low E to D string"), 2);
  assert.equal(frets("A to G string"), 2);
  assert.equal(frets("D to B string"), 3, "the B string is tuned a half step tighter");
  assert.equal(frets("G to high e"), 3, "same quirk, same shift");
  assert.equal(frets("Low E to high e"), 0, "the outer strings are identical");
  assert.equal(app.midiAt(0, 5) - app.midiAt(5, 5), 24, "two octaves apart at the same fret");
  app.renderNotes();
  assert.equal((document.getElementById("octaves").innerHTML.match(/class="card"/g) ?? []).length, app.OCTAVES.length);
});

test("every triad is three distinct chord tones, close voiced and ascending", () => {
  const { app } = makeRuntime();
  assert.equal(app.TRIAD_KINDS.length, 4);
  assert.equal(app.TRIAD_SETS.length, 4);

  let combinations = 0;
  for (let key = 0; key < 12; key++) {
    app.setKey(key);
    for (const set of app.TRIAD_SETS) {
      assert.equal(set.strings.length, 3, `${set.name} spans three strings`);
      for (const kind of app.TRIAD_KINDS) {
        combinations++;
        const shapes = app.triadShapes(kind, set);
        assert.equal(shapes.length, 3, `${app.NOTES[key]}${kind.sym} on ${set.name}: three inversions`);
        const wanted = kind.iv.map(i => (key + i) % 12);
        const seen = new Set();
        for (const sh of shapes) {
          assert.ok(!seen.has(sh.inv), "each inversion appears once");
          seen.add(sh.inv);
          const pcs = sh.notes.map(n => app.noteAt(n.s, n.f));
          assert.equal(new Set(pcs).size, 3, `${app.NOTES[key]}${kind.sym} ${set.name}: no doubled note`);
          for (const pc of pcs) assert.ok(wanted.includes(pc), "only chord tones");
          // one note per string, on this set, ascending in pitch from the bottom
          sameShape(sh.notes.map(n => n.s), set.strings);
          const midi = sh.notes.slice().reverse().map(n => app.midiAt(n.s, n.f));
          for (let i = 1; i < 3; i++) assert.ok(midi[i] > midi[i - 1], "close voiced, ascending");
          // grabbable by one hand
          const fs = sh.notes.map(n => n.f);
          assert.ok(Math.max(...fs) - Math.min(...fs) <= 4, `${app.NOTES[key]}${kind.sym}: within four frets`);
          // the inversion is named by whichever chord tone is lowest
          const bass = (app.noteAt(sh.notes[2].s, sh.notes[2].f) - key + 12) % 12;
          assert.equal(kind.iv.indexOf(bass), sh.inv, "inversion named by its bass note");
        }
      }
    }
  }
  assert.equal(combinations, 192);
});

test("known triad shapes come out right in C", () => {
  const { app } = makeRuntime();
  app.setKey(0); // C
  const shape = (kindId, setId, inv) => {
    const kind = app.TRIAD_KINDS.find(k => k.id === kindId);
    const set = app.TRIAD_SETS.find(s => s.id === setId);
    const sh = app.triadShapes(kind, set).find(x => x.inv === inv);
    return { frets: sh.notes.map(n => n.f), notes: sh.notes.slice().reverse().map(n => app.NOTES[app.noteAt(n.s, n.f)]) };
  };
  // C major, top three strings, root position: the familiar 3-5-5 grip
  sameShape(shape("maj", "123", 0).frets, [3, 5, 5]);
  sameShape(shape("maj", "123", 0).notes, ["C", "E", "G"]);
  // second inversion on the middle set is the 5-5-5 shape every rhythm player knows
  sameShape(shape("maj", "234", 2).frets, [5, 5, 5]);
  sameShape(shape("maj", "234", 2).notes, ["G", "C", "E"]);
  // minor is the major with one note moved down a fret
  sameShape(shape("min", "123", 0).frets, [3, 4, 5]);
  sameShape(shape("min", "123", 0).notes, ["C", "D#", "G"]);
});

test("the triads view draws three inversions with teaching text", () => {
  const { app, document } = makeRuntime();
  app.setKey(0);
  for (const kind of app.TRIAD_KINDS) {
    for (const set of app.TRIAD_SETS) {
      app.setTriad(kind.id, set.id);
      app.renderTriads();
      const summary = document.getElementById("triadsummary").innerHTML;
      const shapes = document.getElementById("triadshapes").innerHTML;
      assert.match(summary, new RegExp(`C${kind.sym} on`), `${kind.id}/${set.id} titled`);
      assert.doesNotMatch(summary, /undefined|NaN/);
      assert.equal((shapes.match(/class="card"/g) ?? []).length, 3, `${kind.id}/${set.id}: three cards`);
      // each card carries a note diagram and a fingering diagram
      assert.equal((shapes.match(/<svg /g) ?? []).length, 6);
      assert.equal((shapes.match(/<th>Finger<\/th>/g) ?? []).length, 3, "a fingering table each");
      assert.doesNotMatch(shapes, /undefined|NaN/);
      for (const name of ["Root position", "1st inversion", "2nd inversion"]) assert.match(shapes, new RegExp(name));
      assert.match(document.getElementById("triadcount").innerHTML, /Three shapes/);
    }
  }
});

test("slash names say which note is in the bass", () => {
  const { app } = makeRuntime();
  const maj = app.TRIAD_KINDS.find(k => k.id === "maj"), min = app.TRIAD_KINDS.find(k => k.id === "min");
  assert.equal(app.chordLabel(0, maj, 0), "C");        // root position has no slash
  assert.equal(app.chordLabel(0, maj, 1), "C/E");      // 3rd in the bass
  assert.equal(app.chordLabel(0, maj, 2), "C/G");      // 5th in the bass
  assert.equal(app.chordLabel(2, min, 1), "Dm/F");
  assert.equal(app.chordLabel(7, maj, 1), "G/B");
  assert.equal(app.chordLabel(9, min, 2), "Am/E");
});

test("voice leading plays the same chords as root position, but travels less", () => {
  const { app } = makeRuntime();
  assert.ok(app.PROGRESSIONS.length >= 5);
  for (const prog of app.PROGRESSIONS) {
    assert.ok(prog.steps.length >= 3, `${prog.id} is a progression`);
    assert.ok(prog.name && prog.sub && prog.tip, `${prog.id} is described`);
    for (const [deg, kindId] of prog.steps) {
      assert.ok(deg >= 0 && deg < 12, `${prog.id}: degree ${deg}`);
      assert.ok(app.TRIAD_KINDS.some(k => k.id === kindId), `${prog.id}: quality ${kindId}`);
    }
  }

  let compared = 0;
  for (let key = 0; key < 12; key++) {
    app.setKey(key);
    for (const set of app.TRIAD_SETS) {
      for (const prog of app.PROGRESSIONS) {
        const rooted = app.voiceLead(prog, set, true), smooth = app.voiceLead(prog, set, false);
        compared++;
        assert.equal(rooted.length, prog.steps.length, `${prog.id}: every chord playable in root position`);
        assert.equal(smooth.length, prog.steps.length, `${prog.id}: every chord playable inverted`);
        for (let i = 0; i < rooted.length; i++) {
          // the two routes must be the SAME music, or the comparison is a lie
          assert.equal(rooted[i].rootPc, smooth[i].rootPc, `${prog.id} step ${i}: same chord`);
          assert.equal(rooted[i].inv, 0, "the root-position route stays in root position");
          const pcs = smooth[i].notes.map(n => app.noteAt(n.s, n.f));
          const want = smooth[i].kind.iv.map(iv => (smooth[i].rootPc + iv) % 12);
          assert.equal(new Set(pcs).size, 3, `${prog.id} step ${i}: three distinct notes`);
          for (const pc of pcs) assert.ok(want.includes(pc), `${prog.id} step ${i}: only chord tones`);
        }
        assert.ok(app.travel(smooth) <= app.travel(rooted) + 1e-9,
          `${app.NOTES[key]} ${prog.id} on ${set.id}: inversions travelled further`);
      }
    }
  }
  assert.equal(compared, 12 * 4 * 5);
});

test("the inversions view explains, maps the neck and shows the measurement", () => {
  const { app, document } = makeRuntime();
  app.setKey(0);
  for (const set of app.TRIAD_SETS) {
    for (const prog of app.PROGRESSIONS) {
      app.setInv(set.id, prog.id);
      app.renderInversions();

      // the move itself, in letters: three stacks of three, each note keeping its colour
      const move = document.getElementById("invmove").innerHTML;
      assert.equal((move.match(/class="chip /g) ?? []).length, 9, "three stacks of three notes");
      for (const role of ["root", "third", "fifth"])
        assert.equal((move.match(new RegExp(`chip ${role}`, "g")) ?? []).length, 3,
          `${role} appears once per stack`);
      assert.equal((move.match(/ moved"/g) ?? []).length, 3, "the bottom note is marked in each stack");
      assert.doesNotMatch(move, /undefined|NaN/);

      // the animated demonstration sits above it
      const demo = document.getElementById("invdemo").innerHTML;
      assert.match(demo, /class="stack bigstack"/);
      assert.match(demo, /lifts off, travels over the other/, "the move is stated as an action");
      assert.equal((demo.match(/class="chip /g) ?? []).length, 3, "one stack of three");
      assert.doesNotMatch(demo, /undefined|NaN/);

      // the misconceptions are named before the fretboard appears
      const not = document.getElementById("invnot").innerHTML;
      assert.equal((not.match(/class="notthis"/g) ?? []).length, 3);
      assert.match(not, /is still C major/);
      assert.match(not, /not about the top note/);
      assert.match(not, /slash chord is not decoration/);

      // the two-chord drill: same chord twice, one far and one near
      const two = document.getElementById("invtwo").innerHTML;
      assert.equal((two.match(/class="card"/g) ?? []).length, 3);
      assert.doesNotMatch(two, /data-chord|Hear it/, "no audio controls in the two-chord drill");
      assert.doesNotMatch(two, /undefined|NaN/);

      const what = document.getElementById("invwhat").innerHTML;
      assert.equal((what.match(/class="card"/g) ?? []).length, 3, "three inversions explained");
      for (const label of app.INVERSION) assert.match(what, new RegExp(label));
      // this view teaches by picture, not by sound
      assert.doesNotMatch(what, /data-chord|Hear it/, "no audio controls in the inversion cards");
      assert.match(what, /C\/E/, "the slash name is shown");
      assert.match(what, /C\/G/);
      assert.doesNotMatch(what, /undefined|NaN/);

      assert.match(document.getElementById("invneck").innerHTML, /<svg /);
      assert.match(document.getElementById("invnecklabel").innerHTML, /playable positions/);

      const compare = document.getElementById("invcompare").innerHTML;
      assert.equal((compare.match(/class="card wide"/g) ?? []).length, 2, "both routes drawn");
      assert.match(compare, /Root position only/);
      assert.match(compare, /Nearest inversion/);
      assert.equal((compare.match(/frets travelled/g) ?? []).length, 2);
      assert.doesNotMatch(compare, /undefined|NaN/);

      assert.match(document.getElementById("invverdict").innerHTML, /less movement|save little/);
      assert.equal(document.getElementById("invprogtip").textContent, prog.tip);
    }
  }
});

test("the move animates one note at a time and comes full circle", () => {
  const { app, document } = makeRuntime();
  app.setKey(0);                       // C: root C, 3rd E, 5th G
  app.setInv("123", "145");
  app.resetMove();
  app.renderInversions();

  const stack = () => {
    const m = [...document.getElementById("invdemo").innerHTML.matchAll(/class="chip (\w+)([^"]*)">([A-G]#?)</g)];
    return m.map(x => ({ role: x[1], flags: x[2].trim(), name: x[3] }));
  };
  const say = () => document.getElementById("invdemo").innerHTML;

  // at rest: nothing animates, root on the bottom, no note has moved yet
  let s0 = stack();
  assert.equal(s0.length, 3);
  sameShape(s0.map(c => c.name), ["G", "E", "C"], "top to bottom");
  assert.equal(s0[2].role, "root", "the root is underneath in root position");
  assert.match(s0[2].flags, /moved/, "the bottom note is marked");
  assert.ok(!say().includes("fly"), "nothing flies before the button is pressed");

  // one move: C leaves the bottom and lands on top, the other two settle down one place
  app.doMove();
  let s1 = stack();
  sameShape(s1.map(c => c.name), ["C", "G", "E"]);
  assert.match(s1[0].flags, /fly/, "the note that moved is the one that flies");
  assert.match(s1[1].flags, /settle/);
  assert.match(s1[2].flags, /settle/);
  assert.equal(s1[2].role, "third", "the 3rd is underneath — first inversion");
  assert.match(say(), /<b>C<\/b> left the bottom/);
  assert.match(say(), /first inversion/);

  // two moves: E goes up, the 5th is underneath
  app.doMove();
  let s2 = stack();
  sameShape(s2.map(c => c.name), ["E", "C", "G"]);
  assert.equal(s2[2].role, "fifth", "the 5th is underneath — second inversion");
  assert.match(s2[0].flags, /fly/);
  assert.match(say(), /<b>E<\/b> left the bottom/);

  // three moves: back to the start, and the page says so
  app.doMove();
  let s3 = stack();
  sameShape(s3.map(c => c.name), ["G", "E", "C"], "full circle");
  assert.equal(s3[2].role, "root");
  assert.match(say(), /back where you started/);

  // start over clears the animation as well as the position
  app.resetMove();
  assert.ok(!say().includes("fly"), "reset stops mid-animation state");
  sameShape(stack().map(c => c.name), ["G", "E", "C"]);

  // the guitar strip under the stack follows the step: one shape solid, two ghosted
  app.resetMove();
  const solid = h => (h.match(/fill="var\(--(pink|blue)\)"/g) ?? []).length;
  const ghost = h => (h.match(/stroke-dasharray="3 2"/g) ?? []).length;
  const at0 = say();
  assert.equal(solid(at0) >= 3, true, "the current shape is drawn solid");
  assert.equal(ghost(at0), 6, "the other two inversions are ghosted");
  app.doMove();
  assert.notEqual(say(), at0, "the strip moves with the step");
  assert.equal(ghost(say()), 6, "still two ghosts, a different one solid");
  assert.doesNotMatch(say(), /data-chord|Hear/, "the demonstration is silent");
});

test("fingering is playable for every shape in every key", () => {
  const { app } = makeRuntime();
  let checked = 0, barres = 0, opens = 0;
  for (let key = 0; key < 12; key++) {
    app.setKey(key);
    for (const set of app.TRIAD_SETS) {
      for (const kind of app.TRIAD_KINDS) {
        for (const sh of app.triadShapes(kind, set)) {
          const fs = app.fingering(sh.notes);
          checked++;
          assert.equal(fs.length, 3);
          for (const n of fs) {
            if (n.f === 0) { assert.equal(n.finger, 0, "an open string uses no finger"); opens++; continue; }
            assert.ok(n.finger >= 1 && n.finger <= 4,
              `${app.NOTES[key]}${kind.sym} ${set.id}: finger ${n.finger} does not exist`);
          }
          const fretted = fs.filter(n => n.f > 0);
          // the same fret is one finger; different frets are different fingers
          const byFret = new Map();
          for (const n of fretted) {
            if (byFret.has(n.f)) assert.equal(byFret.get(n.f), n.finger, "one fret, one finger");
            byFret.set(n.f, n.finger);
          }
          const frets = [...byFret.keys()].sort((a, b) => a - b);
          const fingers = frets.map(f => byFret.get(f));
          for (let i = 1; i < fingers.length; i++) {
            assert.ok(fingers[i] > fingers[i - 1],
              `${app.NOTES[key]}${kind.sym} ${set.id}: fingers ${fingers} do not rise with the frets ${frets}`);
          }
          // a fret shared by more than one string is flagged as a barre
          for (const n of fretted) {
            const shared = fretted.filter(o => o.f === n.f).length > 1;
            assert.equal(!!n.barre, shared, "barres are marked");
          }
          if (fretted.some(n => n.barre)) barres++;
        }
      }
    }
  }
  assert.equal(checked, 576);
  assert.ok(barres > 0, "some shapes really do want a barre");
  assert.ok(opens > 0, "some shapes really do use an open string");

  // the widest shapes are exactly where a naive one-finger-per-fret rule would fail
  app.setKey(0);
  const wide = [];
  for (const set of app.TRIAD_SETS)
    for (const kind of app.TRIAD_KINDS)
      for (const sh of app.triadShapes(kind, set)) {
        const f = sh.notes.map(n => n.f);
        if (Math.max(...f) - Math.min(...f) === 4) wide.push(app.fingering(sh.notes));
      }
  for (const fs of wide) {
    const used = fs.filter(n => n.f > 0).map(n => n.finger);
    assert.ok(Math.max(...used) <= 4, "a four-fret span still fits four fingers");
  }
});

test("the fingering guidance names a finger, a string and a fret", () => {
  const { app } = makeRuntime();
  app.setKey(0);
  const set = app.TRIAD_SETS.find(s => s.id === "123");
  const maj = app.TRIAD_KINDS.find(k => k.id === "maj");
  for (const sh of app.triadShapes(maj, set)) {
    const table = app.fingerTable(sh.notes), hint = app.fingerHint(sh.notes);
    assert.equal((table.match(/<tr>/g) ?? []).length, 4, "a header and three strings");
    assert.match(table, /<th>Finger<\/th>/);
    for (const name of ["index", "middle", "ring", "pinky", "—"])
      if (table.includes(name)) assert.ok(true);
    assert.doesNotMatch(table, /undefined|NaN/);
    assert.ok(hint.length > 40, "the hint says something useful");
    assert.doesNotMatch(hint, /undefined|NaN/);
    // the finger diagram labels its dots with numbers, not note names.
    // (the string names down the left edge are labels, not dots — match only dots,
    // which are the ones drawn with pointer-events="none")
    const board = app.fingerBoard(sh.notes);
    const dots = [...board.matchAll(/pointer-events="none">([^<]*)</g)].map(m => m[1]);
    assert.equal(dots.length, 3, "three dots");
    for (const d of dots) assert.match(d, /^[0-4]$/, `dot reads "${d}", want a finger number`);
  }
});

test("the shared fret window makes the two routes comparable", () => {
  const { app } = makeRuntime();
  app.setKey(0);
  // without a forced span a diagram fits its own notes, so the tighter route would
  // simply be drawn smaller — the opposite of what it is meant to show
  const notes = [{ s: 0, f: 5, kind: "root" }, { s: 1, f: 6, kind: "tone" }];
  const fitted = app.fretboard(notes, { plain: true });
  const forced = app.fretboard(notes, { plain: true, span: [0, 12] });
  assert.notEqual(fitted, forced);
  assert.match(forced, /viewBox="0 0 /);
  // the forced window really is 12 frets wide: one label per fret
  assert.equal((forced.match(/font-size="10.5"/g) ?? []).length, 12);
});

test("all-keys chart draws landmarks, full scale, and slide path", () => {
  const { app, document } = makeRuntime();
  app.renderChart();
  const chart = document.getElementById("chart").innerHTML;
  for (const name of app.NOTES) assert.match(chart, new RegExp(`${name.replace("#", "#")} minor`));
  assert.equal((chart.match(/class="card strip/g) ?? []).length, 12);
  assert.match(app.keyStrip(9, { w: 46, h: 26, pad: 26, big: true }), /A minor landmark positions/);
  assert.match(chart, /tap to enlarge/);
});

test("drone and metronome start and stop through the engine", () => {
  const { app, document, audio } = makeRuntime();
  const drone = document.getElementById("drone");
  app.toggleDrone(drone);
  assert.ok(app.getState().droneNodes, "the drone hands back a handle to stop it with");
  assert.equal(audio.starts, 3, "root, octave and twelfth");
  assert.equal(drone.getAttribute("aria-pressed"), "true");
  const stopped = audio.stops;
  app.toggleDrone(drone);
  assert.equal(app.getState().droneNodes, null, "and the handle is released");
  assert.ok(audio.stops > stopped, "after stopping every oscillator");
  assert.equal(drone.getAttribute("aria-pressed"), "false");

  const click = document.getElementById("click");
  app.toggleClick(click); assert.ok(app.getState().clickTimer);
  app.restartClick(); app.toggleClick(click);
  assert.equal(app.getState().clickTimer, null);
});

test("all generated learning content renders", () => {
  const { app, document } = makeRuntime();
  app.newQuiz(); assert.match(document.getElementById("quizboard").innerHTML, /fretboard diagram/);
  app.newSession(); assert.match(document.getElementById("session").innerHTML, /Warm up/);
  for (const [view,id,marker] of [["boxes","boxes","Box 1"],["connect","connect","Box 1 → Box 2"],
    ["cross","cross","One string, whole neck"],["blues","blues","Blues box"],["licks","licks","Descending cascade"]]) {
    navButton(document, view).click();
    assert.match(document.getElementById(id).innerHTML, new RegExp(marker));
  }
});

test("focus timer supports presets, pause, reset, and countdown", () => {
  const { app, document, intervals } = makeRuntime();
  app.setTimer(3);
  assert.equal(app.getState().timerSeconds, 180);
  app.toggleTimer();
  const handle = app.getState().timerHandle;
  assert.ok(handle);
  intervals.get(handle)();
  assert.equal(app.getState().timerSeconds, 179);
  assert.equal(document.getElementById("timerface").textContent, "02:59");
  app.toggleTimer();
  assert.equal(app.getState().timerHandle, null);
  app.resetTimer();
  assert.equal(app.getState().timerSeconds, 180);
});

test("tempo ladder changes both practice tempo and round", () => {
  const { app, document } = makeRuntime();
  app.ladder(5);
  assert.equal(app.getState().bpm, 95);
  assert.equal(app.getState().ladderRound, 2);
  assert.equal(document.getElementById("ladderbpm").textContent, 95);
  app.ladder(-5);
  assert.equal(app.getState().bpm, 90);
  app.resetLadder();
  assert.equal(app.getState().ladderRound, 1);
});

test("completed sessions persist locally and can be cleared", () => {
  const { app, document } = makeRuntime();
  app.completeSession();
  assert.equal(app.readLog().length, 1);
  assert.equal(app.readLog()[0].key, "A");
  assert.match(document.getElementById("logsummary").innerHTML, /Logged today/);
  app.clearLog();
  assert.equal(app.readLog().length, 0);
});

test("12-bar trainer counts in and advances through the blues form", () => {
  const { app, document, advance, audio } = makeRuntime();
  document.getElementById("groove").value = "shuffle";
  app.renderTrainer();
  assert.equal((document.getElementById("bluesbars").innerHTML.match(/class="bluesbar/g) ?? []).length, 12);
  assert.match(document.getElementById("bluesbars").innerHTML, /A7/);
  app.toggleTrainer();
  const handle = app.getState().trainerTimer;
  assert.ok(handle);
  const beat = 60 / app.getState().bpm;
  for (let i = 0; i < 4; i++) advance(beat);
  assert.equal(app.getState().trainerBar, 0);
  assert.equal(app.getState().trainerBeat, 1);
  for (let i = 0; i < 16; i++) advance(beat);
  assert.equal(app.getState().trainerBar, 4);
  assert.match(document.getElementById("trainertarget").innerHTML, /D7/);
  assert.ok(audio.starts > 0);
  app.resetTrainer();
  assert.equal(app.getState().trainerTimer, null);
});

test("12-bar trainer provides distinct classic, quick-change, minor, and jazz harmony", () => {
  const { app, document } = makeRuntime();
  const form = document.getElementById("bluesform");
  const expected = {
    classic: ["A7", "D7", "E7"],
    quick: ["A7", "D7", "E7"],
    minor: ["Am7", "Dm7", "E7"],
    jazz: ["A7", "D7", "D#dim7", "F#7", "Bm7", "E7"],
  };
  const sequences = {};
  for (const [name, chords] of Object.entries(expected)) {
    form.value = name;
    app.renderTrainer();
    const rendered = document.getElementById("bluesbars").innerHTML;
    assert.equal((rendered.match(/class="bluesbar/g) ?? []).length, 12);
    for (const chord of chords) assert.match(rendered, new RegExp(chord.replace("#", "#")));
    sequences[name] = rendered;
  }
  assert.notEqual(sequences.classic, sequences.quick);
  assert.notEqual(sequences.classic, sequences.minor);
  assert.notEqual(sequences.classic, sequences.jazz);
});

test("every blues form is twelve bars of chords the trainer can actually play", () => {
  const { app, document } = makeRuntime();
  const ids = Object.keys(app.BLUES_FORMS);
  assert.ok(ids.length >= 14, `${ids.length} forms`);

  const select = document.getElementById("bluesform");
  for (const id of ids) {
    const form = app.BLUES_FORMS[id];
    assert.equal(form.chords.length, 12, `${id} is twelve bars`);
    assert.ok(form.name && form.family && form.tip && form.heard, `${id} is fully described`);

    for (const [bar, entry] of form.chords.entries()) {
      const syms = app.barSymbols(entry);
      assert.ok(syms.length === 1 || syms.length === 2, `${id} bar ${bar + 1} holds one or two chords`);
      for (const sym of syms) {
        const c = app.chordInfo(sym);
        assert.equal(typeof c.root, "number", `${id}: ${sym} has a known root`);
        assert.ok(Array.isArray(c.intervals), `${id}: ${sym} has a known chord quality`);
      }
      // the second chord of a split bar takes over on beat 3
      assert.equal(app.symbolAt(entry, 0), syms[0]);
      assert.equal(app.symbolAt(entry, 1), syms[0]);
      assert.equal(app.symbolAt(entry, 3), syms[syms.length - 1]);
    }

    select.value = id;
    app.renderTrainer();
    const rendered = document.getElementById("bluesbars").innerHTML;
    assert.equal((rendered.match(/class="bluesbar/g) ?? []).length, 12, `${id} draws twelve bars`);
    assert.doesNotMatch(rendered, /undefined|NaN/, `${id} names every chord`);
    const splits = form.chords.filter(e => app.barSymbols(e).length === 2).length;
    assert.equal((rendered.match(/bluesbar split/g) ?? []).length, splits, `${id} marks its split bars`);
    assert.ok(document.getElementById("formheard").textContent.length > 0, `${id} says where it is heard`);
  }

  // the menu is generated from the data, grouped by family
  const menu = select.innerHTML;
  for (const id of ids) assert.match(menu, new RegExp(`value="${id}"`), `${id} is offered in the menu`);
  const families = [...new Set(ids.map(id => app.BLUES_FORMS[id].family))];
  for (const family of families) assert.match(menu, new RegExp(`<optgroup label="${family}"`));
});

test("the blues forms are harmonically distinct from one another", () => {
  const { app, document } = makeRuntime();
  const select = document.getElementById("bluesform"), seen = new Map();
  for (const id of Object.keys(app.BLUES_FORMS)) {
    select.value = id;
    app.renderTrainer();
    const shape = document.getElementById("bluesbars").innerHTML;
    if (seen.has(shape)) assert.fail(`${id} is identical to ${seen.get(shape)}`);
    seen.set(shape, id);
  }
});

test("known blues forms transpose correctly into A", () => {
  const { app, document } = makeRuntime();
  app.setKey(9); // A
  const bars = id => {
    document.getElementById("bluesform").value = id;
    return app.BLUES_FORMS[id].chords.map(e => app.barSymbols(e).map(app.chordName).join("/"));
  };
  sameShape(bars("classic"),
    ["A7","A7","A7","A7","D7","D7","A7","A7","E7","D7","A7","E7"]);
  sameShape(bars("quick"),
    ["A7","D7","A7","A7","D7","D7","A7","A7","E7","D7","A7","E7"]);
  sameShape(bars("minorbvi"),
    ["Am7","Am7","Am7","Am7","Dm7","Dm7","Am7","Am7","F7","E7","Am7","E7"]);
  // the bebop skeleton: ii-V into IV, diminished bar 6, I-VI-ii-V turnaround
  sameShape(bars("jazz"),
    ["A7","D7","A7","Em7/A7","D7","D#dim7","A7","F#7","Bm7","E7","A7/F#7","Bm7/E7"]);
  // Blues for Alice changes
  sameShape(bars("bird"),
    ["Amaj7","G#m7b5/C#7","F#m7/B7","Em7/A7","D7","Dm7/G7","C#m7/F#7","Cm7/F7","Bm7","E7","Amaj7/F#7","Bm7/E7"]);
});

test("rhythm lab generates a 16-step phrase and loops it at subdivisions", () => {
  const { app, document, advance, audio } = makeRuntime();
  document.getElementById("density").value = "medium";
  const phrase = app.generateRhythm();
  assert.equal(phrase.length, 16);
  assert.equal(phrase[0], 1);
  assert.match(document.getElementById("rhythmcount").innerHTML, /attacks/);
  app.toggleRhythm();
  const handle = app.getState().rhythmTimer;
  assert.ok(handle);
  // At 90 bpm a sixteenth (0.167 s) is longer than the 0.12 s lookahead, so starting
  // books step 0 only, and each sixteenth of clock time books one more.
  assert.equal(app.getState().rhythmStep, 1);
  advance(60 / app.getState().bpm / 4);
  assert.equal(app.getState().rhythmStep, 2);
  assert.ok(audio.starts > 0);
  app.stopRhythm();
  assert.equal(app.getState().rhythmTimer, null);
});

test("supplementary Seven Licks resource still renders all cards", () => {
  assert.doesNotMatch(lesson, /fonts\.googleapis\.com/);
  assert.match(lesson, /<script src="seven-licks.js"><\/script>/);
  assert.doesNotMatch(lesson, /<script>/, "no inline script, so the CSP can forbid them");
  assert.equal((lessonScript.match(/n:"0[1-7]"/g) ?? []).length, 7);
  const host = new Element("licks"), win = { addEventListener() {} };
  const context = vm.createContext({ document: { getElementById: () => host }, window: win, parent: win,
    location: { origin: "http://127.0.0.1" }, requestAnimationFrame: fn => fn() });
  vm.runInContext(lessonScript, context);
  assert.equal((host.innerHTML.match(/<article class="lick">/g) ?? []).length, 7);
  assert.match(host.innerHTML, /aria-label="The pull-off pair: B string fret 8, then B string fret 5, then G string fret 7, then G string fret 5"/,
    "each diagram tells a screen reader which lick it is and its notes in order");
});

test("register moves each box a whole octave, or leaves it where it is", () => {
  const { app } = makeRuntime();
  for (let key = 0; key < 12; key++) {
    app.setKey(key);
    const base = app.baseFret();
    for (const [reg] of app.REGS) {
      app.setReg(reg);
      for (const b of app.BOXES) {
        const r = app.boxRoot(b);
        assert.equal(Math.abs((r - base) % 12), 0, `Box ${b.n} only ever moves by whole octaves`);
        if (reg === 0) assert.equal(r, base, "standard is the home position");
        if (reg < 0) assert.ok(r <= base, "octave down never goes up");
        if (reg > 0) assert.ok(r >= base, "octave up never goes down");
        // a box that stayed put must genuinely have had nowhere to go
        if (reg < 0 && r === base) assert.ok(Math.min(...b.off.flat()) + base - 12 < 0,
          `Box ${b.n} stayed only because a lower octave would fall past the nut`);
        if (reg > 0 && r === base) assert.ok(Math.max(...b.off.flat()) + base + 12 > app.MAXFRET,
          `Box ${b.n} stayed only because a higher octave would run past fret ${app.MAXFRET}`);
      }
    }
  }
  app.setKey(9); app.setReg(0);
});

test("register: boxes that can move do move a full octave", () => {
  const { app } = makeRuntime();
  app.setKey(9);                     // A minor, root at fret 5
  app.setReg(0);
  const std = app.BOXES.map(b => app.boxSpan(b).lo);
  sameShape(std, [5, 7, 9, 12, 14], "standard positions");
  app.setReg(-12);
  sameShape(app.BOXES.map(b => app.boxSpan(b).lo), [5, 7, 9, 0, 2],
    "only boxes 4 and 5 have a lower octave; 1-3 hold their ground");
  app.setReg(12);
  sameShape(app.BOXES.map(b => app.boxSpan(b).lo), [17, 19, 9, 12, 14],
    "only boxes 1 and 2 have a higher octave");
  // E minor: the root sits at fret 12, so the whole scale drops an octave cleanly
  app.setKey(4); app.setReg(-12);
  sameShape(app.BOXES.map(b => app.boxSpan(b).lo), [0, 2, 4, 7, 9], "all five move in E");
  assert.equal(app.BOXES.filter(app.moved).length, 5);
  app.setReg(12);
  assert.equal(app.BOXES.filter(app.moved).length, 0, "and none can go higher than fret 12 in E");
  app.setKey(9); app.setReg(0);
});

test("register buttons describe the neck span rather than a shrinking count", () => {
  const { app, document } = makeRuntime();
  app.setKey(9);
  app.render();
  const labels = document.getElementById("regs").children.map(b => b.textContent);
  assert.ok(labels.every(t => /frets \d+–\d+/.test(t)), `each button states its span: ${labels}`);
  assert.ok(!labels.some(t => /none/.test(t)), "no register is ever empty");
  const info = app.regInfo(-12);
  assert.equal(info.shifted, 2, "two of the five boxes move down an octave in A minor");
  assert.equal(info.lo, 0, "and the lowest of them reaches the nut");
  assert.equal(app.regInfo(0).lo, 5, "standard starts at the root fret");
  app.setReg(0);
});

test("register: E minor is the one key where both registers hold all five boxes", () => {
  const { app } = makeRuntime();
  app.setKey(4);            // E minor -> root at fret 12
  assert.equal(app.baseFret(), 12);
  assert.equal(app.boxesAt(0).length, 5);
  assert.equal(app.boxesAt(-12).length, 5);
  app.setReg(-12);
  assert.equal(app.rootFret(), 0, "octave down in E is the open position, not a repeat");
  app.setReg(0);
  app.setKey(9);
});

test("blues view never renders blank, in any key or register", () => {
  const { app, document } = makeRuntime();
  for (let k = 0; k < 12; k++) {
    app.setKey(k);
    for (const [reg] of app.REGS) {
      if (!app.boxesAt(reg).length) continue;
      app.setReg(reg);
      app.renderBlues();
      const cards = document.getElementById("blues").innerHTML;
      const map = document.getElementById("bluesmap").innerHTML;
      assert.ok(cards.trim().length > 0, `blues cards present for key ${k} reg ${reg}`);
      assert.ok(map.includes("<svg"), `whole-neck map present for key ${k} reg ${reg}`);
    }
  }
  app.setKey(9); app.setReg(0);
});

test("blues whole-neck map covers the full fretboard with pentatonic boxes and flat fives", () => {
  const { app } = makeRuntime();
  app.setKey(9); app.setReg(0);
  const svg = app.bluesMap(null);
  const b5 = (svg.match(/stroke-dasharray="3 2"/g) || []).length;
  const pent = (svg.match(/fill="var\(--(pink|blue)\)"/g) || []).length;
  assert.ok(pent > 60, `whole neck is covered, not one box (${pent} pentatonic dots)`);
  assert.ok(b5 >= 12, `every flat five on the neck is drawn (${b5})`);
  assert.ok(svg.includes(">24</text>"), "fret numbers run to 24");
  assert.ok(!svg.includes(">25</text>"), "and stop at 24");
  assert.equal((svg.match(/class="pn"/g) || []).length, pent + b5, "every dot is playable");
});

test("blues map isolation dims the rest of the neck and repeats the shape each octave", () => {
  const { app } = makeRuntime();
  app.setKey(9); app.setReg(0);
  const all = app.bluesMap(null);
  assert.equal((all.match(/opacity="0.1"/g) || []).length, 0, "nothing is dimmed with no isolation");
  for (const zone of ["box1", "box3", "blues", "bb", "ak"]) {
    const svg = app.bluesMap(zone);
    const dim = (svg.match(/opacity="0.1"/g) || []).length;
    const lit = (svg.match(/opacity="1"/g) || []).length;
    assert.ok(dim > 0 && lit > 0, `${zone} lights some notes and dims others`);
    assert.ok(svg.includes('fill="var(--gold)"'), `${zone} draws its fret-span band`);
  }
  // a shape must light up in more than one octave
  const one = app.bluesMap("box1");
  assert.ok((one.match(/opacity="1"/g) || []).length > 12, "box 1 appears in every octave it reaches");
});

test("flat-five toggle adds the blue note to ordinary box diagrams", () => {
  const { app } = makeRuntime();
  app.setKey(9); app.setReg(0);
  const plain = app.boxNotes(app.BOXES[0]);
  app.setB5(false);
  assert.equal(app.withB5(plain).length, plain.length, "off: box is untouched");
  app.setB5(true);
  const lit = app.withB5(plain);
  assert.ok(lit.length > plain.length, "on: flat fives are added");
  const added = lit.slice(plain.length);
  const lo = Math.min(...plain.map(n => n.f)), hi = Math.max(...plain.map(n => n.f));
  for (const n of added) {
    assert.equal(n.kind, "ghost", "added notes are ghosts, not scale tones");
    assert.ok(n.f >= lo && n.f <= hi, "added notes stay inside the box's fret window");
    assert.ok(app.isB5(app.noteAt(n.s, n.f)), "added notes really are the flat five");
    assert.equal(app.deg(app.noteAt(n.s, n.f)), 6);
  }
  app.setB5(false);
});

test("every fretted note maps to a pitch and diagrams are audible", () => {
  const { app, audio } = makeRuntime();
  // standard tuning: open strings, high e first
  assert.deepEqual([0,1,2,3,4,5].map(s => app.midiAt(s, 0)), [64,59,55,50,45,40]);
  assert.equal(app.midiAt(5, 12), 52, "twelfth fret on the low E is an octave up");
  assert.ok(Math.abs(app.midiFreq(69) - 440) < 1e-9, "A4 is 440 Hz");
  assert.ok(Math.abs(app.midiFreq(64) - 329.6276) < 0.001, "open high e is ~329.63 Hz");
  const before = audio.starts;
  app.pluck(app.midiAt(5, 5));
  assert.ok(audio.starts > before, "plucking a note starts oscillators");
  const stopped = audio.stops;
  app.playRun(app.boxNotes(app.BOXES[0]));
  assert.ok(audio.stops > stopped, "auditioning a box schedules and releases every note");
});

test("power chords: the fifth is two frets up, except on the G string where it is three", () => {
  const { app } = makeRuntime();
  for (const [str, offset] of Object.entries(app.PCPAIR)) {
    const s = Number(str);
    const shape = app.pc2(s, 5);
    assert.equal(shape.length, 2, "a power chord is two notes");
    const [root, fifth] = shape;
    assert.equal(root.kind, "root");
    assert.equal(fifth.s, s - 1, "the fifth sits on the next string up");
    assert.equal(fifth.f - root.f, offset);
    // and it really is a perfect fifth: seven semitones
    assert.equal((app.noteAt(fifth.s, fifth.f) - app.noteAt(root.s, root.f) + 12) % 12, 7,
      `string ${s} with a ${offset}-fret reach gives a perfect fifth`);
  }
  assert.equal(app.PCPAIR[2], 3, "the G-to-B pair needs three frets");
  assert.equal(app.pc2(2, 5)[1].ord, "4", "and the little finger reaches it");
  assert.equal(app.pc2(5, 5)[1].ord, "3", "elsewhere it is the ring finger");
});

test("power chords: the three-note version adds the octave", () => {
  const { app } = makeRuntime();
  for (const s of [5, 4]) {
    const [root, fifth, oct] = app.pc3(s, 7);
    assert.equal((app.noteAt(fifth.s, fifth.f) - app.noteAt(root.s, root.f) + 12) % 12, 7, "fifth");
    assert.equal(app.noteAt(oct.s, oct.f), app.noteAt(root.s, root.f), "octave doubles the root");
    assert.equal(oct.kind, "root", "and is coloured as one");
    sameShape([root.ord, fifth.ord, oct.ord], ["1", "3", "4"], "fingering 1-3-4");
  }
});

test("power chords transpose with the key selector", () => {
  const { app } = makeRuntime();
  const expect = { 9: [5, 12, 7], 4: [12, 7, 2], 11: [7, 2, 9], 0: [8, 3, 10] };
  for (const [k, frets] of Object.entries(expect)) {
    app.setKey(Number(k));
    sameShape([5, 4, 3].map(s => app.rootOn(s)), frets, `roots for key ${k}`);
    for (const s of [5, 4, 3, 2]) {
      assert.equal(app.noteAt(s, app.rootOn(s)), Number(k), "the root really is the selected key");
      assert.ok(app.rootOn(s) > 0, "movable shapes never land on an open string");
    }
  }
  app.setKey(9);
});

test("power chord progressions spell the right chords", () => {
  const { app } = makeRuntime();
  app.setKey(9); // A minor
  const name = d => app.NOTES[(9 + d) % 12] + "5";
  const spelled = app.PCPROG.map(p => p.d.map(name).join("-"));
  sameShape(spelled, [
    "A5-G5-F5",   // i - bVII - bVI
    "A5-G5-D5",   // i - bVII - IV
    "A5-D5-E5",   // i - IV - V
    "G5-A5",      // bVII - i
    "A5-C5-D5",   // i - bIII - IV
  ]);
});

test("example song: the tab matches the source, and its chords are B dorian", () => {
  const { app } = makeRuntime();
  const [riff, chorus] = app.PCSONG.parts;
  // frets, string by string, exactly as written
  sameShape(riff.bars[0].ev.filter(e => !e.rest).map(e => e.c),
    [[[4,2],[3,4]], [[4,2],[3,4]], [[3,2],[2,4]], [[3,4],[2,6]], [[4,4],[3,6]]]);
  sameShape(riff.bars[1].ev.filter(e => !e.rest).map(e => e.c),
    [[[4,5],[3,7]], [[4,5],[3,7]], [[3,6],[2,8]], [[3,7],[2,9]], [[4,7],[3,9]]]);
  sameShape(chorus.bars.map(b => b.ev[0].c), [[[4,0],[3,2]], [[4,2],[3,4]]]);
  sameShape(chorus.bars.map(b => b.rep), [8, 8]);

  const all = [...riff.bars, ...chorus.bars].flatMap(b => b.ev).filter(e => !e.rest);
  for (const e of all) {
    const [[rs, rf], [fs, ff]] = e.c;
    assert.equal((app.noteAt(fs, ff) - app.noteAt(rs, rf) + 12) % 12, 7, `${e.nm} is a real fifth`);
    assert.equal(app.NOTES[app.noteAt(rs, rf)] + "5", e.nm, `${e.nm} is named after its root`);
  }
  // B dorian: B C# D E F# G# A
  const dorian = new Set([11, 1, 2, 4, 6, 8, 9]);
  const roots = [...new Set(all.map(e => app.noteAt(e.c[0][0], e.c[0][1])))];
  for (const r of roots) assert.ok(dorian.has(r), `${app.NOTES[r]}5 is in B dorian`);
  // and the strong chords are exactly B minor pentatonic
  const pent = new Set([11, 2, 4, 6, 9]);
  for (const r of [11, 2, 4, 6, 9]) assert.ok(roots.includes(r), `${app.NOTES[r]}5 is in the riff`);
  const passing = roots.filter(r => !pent.has(r)).map(r => app.NOTES[r]);
  sameShape(passing.sort(), ["C#", "G#"], "only C# and G# fall outside the pentatonic");
  assert.equal(app.SONGKEY, 11, "the song is in B minor");
});

test("example song renders playable tab and a form strip", () => {
  const { app, document } = makeRuntime();
  app.renderPower();
  const song = document.getElementById("pcsong").innerHTML;
  assert.ok(song.includes("P.M."), "the chorus is marked palm muted");
  assert.ok(song.includes("Intro – Verse – Chorus – Solo – Chorus – Interlude – Verse – Chorus ×2")
        || song.includes("Chorus ×2"), "the form is stated");
  const tab = app.pcTab(app.PCSONG.parts[0].bars[0].ev);
  const lines = tab.split("\n");
  assert.equal(lines.length, 6, "six strings");
  assert.ok(lines[0].startsWith("e|") && lines[5].startsWith("E|"), "high e first, low E last");
  assert.ok(lines[3].includes("4") && lines[4].includes("2"), "B5 sits on the A and D strings");
  assert.ok(tab.includes("/"), "the slide into the next chord is marked");
});

test("song structure: every form is made of known sections and real bar counts", () => {
  const { app, document } = makeRuntime();
  const codes = new Set(app.SECTIONS.map(s => s.c));
  for (const f of app.FORMS) {
    assert.ok(f.secs.length >= 2, `${f.t} has sections`);
    const bars = f.secs.reduce((a, [, n]) => a + n, 0);
    assert.ok(bars > 0, `${f.t} has a length`);
    for (const [name, n, c] of f.secs) {
      assert.ok(name.length > 0 && n > 0, `${f.t}: ${name} is well formed`);
      assert.ok(codes.has(c) || c in app.SECCOL, `${f.t}: ${name} uses a known section colour`);
    }
  }
  assert.equal(app.FORMS.find(f => f.t === "12-bar blues").secs.reduce((a, [, n]) => a + n, 0), 12,
    "the 12-bar blues is twelve bars");
  assert.equal(app.FORMS.find(f => f.t === "AABA").secs.reduce((a, [, n]) => a + n, 0), 32,
    "AABA is thirty-two bars");
  app.renderForm();
  const html = document.getElementById("form").innerHTML;
  assert.equal((html.match(/class="formstrip"/g) || []).length, app.FORMS.length, "one strip per form");
  for (const s of app.SECTIONS) assert.ok(html.includes(s.k), `${s.k} is in the glossary`);
});

test("practice guide: the five exercises are transcribed exactly", () => {
  const { app } = makeRuntime();
  const guide = app.LICKS.filter(l => l.g);
  assert.equal(guide.length, 5, "all five guide exercises are present");
  sameShape(guide.map(l => l.t), [
    "Box 1, both directions",
    "Reach into Box 2",
    "Box 2, both directions",
    "The diagonal route",
    "Call and answer across the boxes",
  ]);
  // written as offsets from the root fret; in E minor the root fret is 12
  app.setKey(4);
  assert.equal(app.rootFret(), 12, "E minor sits at the twelfth fret");
  const at = t => app.LICKS.find(l => l.t === t).n.map(([s, o, tk]) => [s, o + 12, tk ?? null]);

  sameShape(at("Box 1, both directions"),
    [[5,12,null],[5,15,null],[4,12,null],[4,14,null],[3,12,null],[3,14,null],
     [2,12,null],[2,14,null],[1,12,null],[1,15,null],[0,12,null],[0,15,null]]);
  sameShape(at("Reach into Box 2"),
    [[2,12,"h"],[2,14,null],[1,12,null],[1,15,null],[1,17,"~"]]);
  sameShape(at("Box 2, both directions"),
    [[5,15,null],[5,17,null],[4,14,null],[4,17,null],[3,14,null],[3,17,null],
     [2,14,null],[2,16,null],[1,15,null],[1,17,null],[0,15,null],[0,17,null]]);
  sameShape(at("The diagonal route"),
    [[5,12,null],[5,15,null],[4,14,null],[4,17,null],[3,14,null],[3,17,null],
     [2,14,null],[2,16,null],[1,15,null],[1,17,null],[0,15,null],[0,17,null]]);
  sameShape(at("Call and answer across the boxes"),
    [[3,12,null],[3,14,null],[2,12,null],[2,14,null],[2,14,null],[2,16,null],[1,15,null],[1,17,"~"]]);
  app.setKey(9);
});

test("practice guide: the exercises are the app's own Box 1 and Box 2", () => {
  const { app } = makeRuntime();
  const offsets = t => new Set(app.LICKS.find(l => l.t === t).n.map(([s, o]) => s + ":" + o));
  const boxSet = i => new Set(app.BOXES[i].off.flatMap((p, s) => p.map(o => s + ":" + o)));
  assert.deepEqual([...offsets("Box 1, both directions")].sort(), [...boxSet(0)].sort(),
    "the guide's Box 1 run is exactly this app's Box 1");
  assert.deepEqual([...offsets("Box 2, both directions")].sort(), [...boxSet(1)].sort(),
    "and its Box 2 run is exactly Box 2");
});

test("practice guide: every listed root really is the key note", () => {
  const { app } = makeRuntime();
  for (const k of app.GUIDEKEYS) {
    app.setKey(k);
    const R = app.rootFret();
    for (const g of app.GUIDEROOTS)
      for (const [s, o] of g.at)
        assert.equal(app.noteAt(s, o + R), k,
          `Box ${g.box}: string ${s + 1} fret ${o + R} is ${app.NOTES[k]}`);
  }
  app.setKey(4);
  // and they match the guide's reference table, counted the way players count strings
  const asWritten = g => g.at.map(([s, o]) => `${s + 1}/${o + app.rootFret()}`).join(" ");
  assert.equal(asWritten(app.GUIDEROOTS[0]), "6/12 4/14 1/12");
  assert.equal(asWritten(app.GUIDEROOTS[1]), "4/14 2/17");
  app.setKey(9);
});

test("practice guide: routines are complete and add up to their stated length", () => {
  const { app } = makeRuntime();
  assert.equal(app.ROUTINES.length, 2);
  for (const r of app.ROUTINES) {
    assert.equal(r.seg[0].a, 0, `Practice ${r.n} starts at 0:00`);
    assert.equal(r.seg[r.seg.length - 1].b, r.len, `Practice ${r.n} ends at ${r.len}:00`);
    for (let i = 1; i < r.seg.length; i++)
      assert.equal(r.seg[i].a, r.seg[i - 1].b, `Practice ${r.n} segment ${i} has no gap before it`);
    for (const s of r.seg) assert.ok(s.b > s.a && s.t && s.d, "each segment has a length and a job");
    assert.ok(r.done.length >= 3, `Practice ${r.n} has finish conditions`);
    // every segment that names a lick names one that exists
    for (const s of r.seg.filter(x => x.lick))
      assert.ok(app.LICKS.some(l => l.t === s.lick), `"${s.lick}" is a real lick`);
  }
  assert.equal(app.ROUTINES.flatMap(r => r.seg).length, 10, "ten segments across the two routines");
});

test("practice guide: the checklist persists and can be reset", () => {
  const { app, document } = makeRuntime();
  app.renderGuide();
  const boxes = document.getElementById("guide").querySelectorAll(".gchk");
  assert.equal(app.CHECKLIST.length, 7);
  assert.equal(app.readChecks().length, 0, "starts empty");
  app.writeChecks([true, false, true]);
  sameShape(app.readChecks(), [true, false, true], "round-trips through storage");
  app.writeChecks([]);
  assert.equal(app.readChecks().filter(Boolean).length, 0, "reset clears it");
});

test("practice guide: the song project and long-term focus are carried over", () => {
  const { app, document } = makeRuntime();
  app.renderGuide();
  const html = document.getElementById("guide").innerHTML;
  assert.ok(html.includes("Zombie"), "the song project is named");
  assert.ok(html.includes("| Em | C | G | D |"), "with its progression");
  assert.equal(app.FOCUS.length, 6, "six long-term focus points");
  for (const f of app.FOCUS) assert.ok(html.includes(f), `"${f.slice(0, 24)}…" is shown`);
  for (const r of app.ROUTINES)
    for (const s of r.seg) assert.ok(html.includes(s.t), `segment "${s.t}" is shown`);
  assert.equal((html.match(/class="segrun"/g) || []).length, 10, "each segment has a timer button");
  sameShape(app.GUIDEKEYS.map(i => app.NOTES[i]), ["E", "B", "A", "G"], "the guide's four keys");
});

test("practice theory is actionable, sourced, and honest about evidence limits", () => {
  const { app, document } = makeRuntime();
  navButton(document, "theory").click();
  const section = document.getElementById("v-theory");
  assert.equal(section.hidden, false);
  assert.match(html, /Cold attempt/);
  assert.match(html, /Hear the result first/);
  assert.match(html, /Let sleep divide attempts/);
  assert.match(html, /Rest protects quality/);
  assert.match(html, /Finish the whole arrangement/);
  assert.match(html, /Ready to share/);
  assert.equal((html.match(/style="--bars:/g) || []).length, 6, "the full arrangement is drawn as six proportional sections");
  assert.equal((html.match(/class="readiness"/g) || []).length, 1, "share readiness is presented as a visual checklist");
  assert.match(html, /sample\s+was small/);
  assert.match(html, /music\s+studies are mixed/);
  assert.match(html, /not a systematic review/);
  for (const source of ["20592043231151416", "EJ763007", "39205981", "PMC12595466"])
    assert.ok(html.includes(source), `${source} is linked from the research notes`);
  assert.equal(app.viewCfg("theory").tools ?? "", "", "theory does not pretend toolbar controls apply");
});

test("practice theory saves both complete-song projects on this device", () => {
  const { app, document } = makeRuntime();
  navButton(document, "theory").click();
  document.getElementById("theory-song-a").value = "Song A";
  document.getElementById("theory-form-a").value = "intro → verse → chorus → ending · 84 bpm";
  document.getElementById("theory-song-b").value = "Song B";
  document.getElementById("theory-form-b").value = "hardest join: bridge → final chorus";
  document.getElementById("save-arrangements").click();
  assert.match(document.getElementById("arrangement-status").textContent, /saved on this device/);
  assert.deepEqual(JSON.parse(JSON.stringify(app.readArrangement())), {
    a:"Song A",fa:"intro → verse → chorus → ending · 84 bpm",
    b:"Song B",fb:"hardest join: bridge → final chorus"
  });
  app.renderTheory();
  assert.equal(document.getElementById("theory-form-b").value, "hardest join: bridge → final chorus");
});

test("the packaged app exposes a Quit control that the served page can use", async () => {
  const { document, fetched } = makeRuntime();
  document.getElementById("approw").hidden = true;   // as index.html starts it; the mock does not read attributes
  await new Promise(r => setImmediate(r));   // let /about answer
  assert.equal(document.getElementById("approw").hidden, false,
    "the Quit row appears when the app itself serves the page");
  assert.ok(fetched.some(f => f.url === "/about"), "the page asks the app who it is");
  assert.equal(document.getElementById("appver").textContent, "version 1.2.3");

  const quit = document.getElementById("quitapp");
  quit.click();
  const call = fetched.find(f => f.url === "/quit");
  assert.ok(call, "clicking Quit calls the endpoint");
  assert.equal(call.method, "POST", "as a POST, so a plain link cannot trigger it");
  assert.equal(call.headers["X-Quit"], "1",
    "with the header that a cross-site form cannot set");
  assert.match(document.getElementById("quitmsg").textContent, /Stopping|Stopped/);
});

test("Quit shuts the page down, not just the server", async () => {
  const { app, document, closed } = makeRuntime();
  // something running in every corner of the app, so the shutdown has work to do
  app.toggleDrone(document.getElementById("drone"));
  app.toggleClick(document.getElementById("click"));
  app.setTimer(5); app.toggleTimer();
  app.toggleTrainer();
  app.toggleRhythm();

  document.getElementById("quitapp").click();
  await Promise.resolve();          // let the fetch settle

  const state = app.getState();
  assert.equal(state.droneNodes, null, "the drone stops");
  assert.equal(state.clickTimer, null, "the metronome stops");
  assert.equal(state.timerHandle, null, "the focus timer stops");
  assert.equal(state.trainerTimer, null, "the 12-bar trainer stops");
  assert.equal(state.rhythmTimer, null, "the rhythm lab stops");
  assert.ok(closed(), "and the browser is asked to close the tab");
  // when the browser refuses to close the tab, what is left is not a live desk
  assert.match(document.body.innerHTML, /Stopped/);
  assert.doesNotMatch(document.body.innerHTML, /id="views"/);
});

test("the author copyright stays in source code without appearing in the page", () => {
  const { document } = makeRuntime();
  assert.ok(script.includes("Copyright © 2026 Bruce Hoppe"), "the source retains the copyright comment");
  assert.ok(!html.includes("© 2026 Bruce Hoppe"), "the copyright is not visible in the interface");
  assert.ok(!html.includes("Source on GitHub"), "the GitHub reference is removed");
  for (const [name, text] of [["page", html], ["app.js", script], ["lesson", lesson], ["lesson script", lessonScript]])
    assert.doesNotMatch(text, /[\w.+-]+@[\w-]+\.[\w.]+/, `no email address in the ${name}`);
  assert.ok(html.includes("A Bruce Hoppe project"), "the project line stays in the footer");
  assert.ok(html.includes('class="credit"'), "in a footer of its own");
  assert.ok(document.getElementById("credver"), "which also carries the build version");
});

// WCAG relative luminance and contrast, so the chart's legibility is a measured
// property rather than a matter of opinion.
const luminance = (hex) => {
  const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const PAPER = "#F2EFE6";

test("contrast helper agrees with the known WCAG anchors", () => {
  assert.ok(Math.abs(contrast("#000000", "#FFFFFF") - 21) < 0.01, "black on white is 21:1");
  assert.ok(Math.abs(contrast("#777777", "#FFFFFF") - 4.48) < 0.02, "#777 on white is ~4.48:1");
  assert.equal(contrast(PAPER, PAPER).toFixed(2), "1.00", "a colour against itself is 1:1");
});

test("all-12-keys chart: nothing is drawn below the visibility floor", () => {
  const { app } = makeRuntime();
  // 3:1 is the WCAG floor for graphical objects, 4.5:1 for text
  const required = {
    CH_SCALE: [3, "the rest of the scale"],
    CH_GRID: [3, "fret wires"],
    CH_STR: [3, "strings"],
    CH_MARK: [3, "inlay markers"],
    CH_GOLD: [3, "Box 4 dots"],
    CH_TEXT: [4.5, "fret numbers and string names"],
  };
  for (const [name, [need, what]] of Object.entries(required)) {
    const colour = app[name];
    assert.match(colour, /^#[0-9A-Fa-f]{6}$/, `${name} is a solid colour, not an opacity trick`);
    const got = contrast(colour, PAPER);
    assert.ok(got >= need,
      `${what} (${name} ${colour}) is ${got.toFixed(2)}:1 on the paper, needs ${need}:1`);
  }
  // the old approach: ink at 22% over the paper, which is what looked washed out
  const washedOut = "#C1BFB9";
  assert.ok(contrast(washedOut, PAPER) < 2,
    "sanity check: the previous low-opacity ink really was under 2:1");
});

test("all-12-keys chart: the scale sits behind the boxes by form, not by fading", () => {
  const { app } = makeRuntime();
  const svg = app.keyStrip(9, { big: true });
  // background scale notes are hollow rings
  assert.ok(svg.includes(`fill="var(--paper)" stroke="${app.CH_SCALE}"`),
    "the rest of the scale is drawn as rings");
  // box dots are solid fills
  assert.ok(svg.includes(`fill="var(--blue)"`), "Box 1 dots are solid");
  assert.ok(svg.includes(`fill="${app.CH_GOLD}"`), "Box 4 dots are solid");
  // and nothing in the chart hides behind a low opacity any more
  const faint = [...svg.matchAll(/opacity="(\.\d+|0?\.\d+)"/g)].map(m => parseFloat(m[1]));
  const tooFaint = faint.filter(v => v > 0 && v < 0.13);
  assert.deepEqual(tooFaint, [],
    `no element is drawn under 0.13 opacity; found ${tooFaint}`);
  // blue and the ring grey are close in lightness — which is exactly why form carries it
  assert.ok(contrast("#0F6FC5", app.CH_SCALE) < 1.5,
    "blue and the ring grey are near-identical in luminance, so shape must do the work");
});

test("solo lab: the zone is the union of the selected boxes at one position", () => {
  const { app } = makeRuntime();
  app.setKey(9); app.setReg(0);
  app.setSoloBoxes([1]);
  const one = app.soloZone();
  assert.equal(one.length, 12, "Box 1 alone is twelve notes");
  assert.ok(one.every(n => n.boxes.length === 1), "none of them are shared");

  app.setSoloBoxes([1, 2]);
  const two = app.soloZone();
  const shared = two.filter(n => n.boxes.length > 1);
  assert.equal(two.length, 18, "Box 1 + Box 2 is eighteen distinct notes, not twenty-four");
  assert.equal(shared.length, 6, "six of them belong to both shapes");
  for (const n of shared)
    assert.equal(n.kind, app.noteAt(n.s, n.f) === 9 ? "root" : "pivot",
      "shared notes are pivots, except where the shared note is the root itself");

  // the whole selection sits at one root, or the shared notes would not line up
  assert.equal(app.soloRoot(), app.groupRoot(app.BOXES[0], app.BOXES[1]));
  for (const n of two) assert.ok(n.f >= 0 && n.f <= app.MAXFRET, "every note is on the neck");

  // and roots are still roots
  for (const n of two.filter(x => x.kind === "root"))
    assert.equal(app.noteAt(n.s, n.f), 9, "pink notes are the key note");
  app.setSoloBoxes([1]);
});

test("solo lab: every fill pattern stays inside the selected zone", () => {
  const { app } = makeRuntime();
  app.setKey(9); app.setReg(0);
  for (const boxes of [[1], [1, 2], [1, 4], [1, 2, 3, 4, 5]]) {
    app.setSoloBoxes(boxes);
    const R = app.soloRoot();
    const inZone = new Set(app.soloZone().map(n => n.s + ":" + n.f));
    for (const p of app.SOLOPATTERNS) {
      const run = app.buildRun(p.id);
      assert.ok(run.length > 0, `${p.t} produces notes for boxes ${boxes}`);
      for (const n of run)
        assert.ok(inZone.has(n.s + ":" + (n.o + R)),
          `${p.t}: string ${n.s} fret ${n.o + R} is inside the zone`);
    }
  }
  app.setSoloBoxes([1]);
});

test("solo lab: the patterns are the shapes they claim to be", () => {
  const { app } = makeRuntime();
  app.setKey(9); app.setReg(0); app.setSoloBoxes([1]);
  const R = app.soloRoot();
  const pitch = n => app.midiAt(n.s, n.o + R);
  const up = app.buildRun("up").map(pitch);
  const down = app.buildRun("down").map(pitch);

  sameShape(up, [...up].sort((a, b) => a - b), "Ascend really ascends");
  sameShape(down, [...up].reverse(), "Descend is the ascent backwards");

  const updown = app.buildRun("updown").map(pitch);
  assert.equal(updown.length, up.length * 2 - 1, "up and back does not repeat the top note");
  assert.equal(updown[0], up[0], "starts at the bottom");
  assert.equal(updown[up.length - 1], up[up.length - 1], "turns around at the top");
  assert.equal(updown[updown.length - 1], up[0], "ends where it started");

  const fours = app.buildRun("fours");
  assert.equal(fours.length % 4, 0, "sequenced fours comes in groups of four");
  const g = fours.slice(0, 4).map(pitch);
  sameShape(g, [...g].sort((a, b) => a - b), "each group of four ascends");

  const thirds = app.buildRun("thirds").map(pitch);
  for (let i = 0; i < thirds.length; i += 2)
    assert.ok(thirds[i + 1] > thirds[i], "each pair in thirds steps upward");
});

test("solo lab: a run is stored as offsets, so it follows key and register", () => {
  const { app, document } = makeRuntime();
  app.setKey(9); app.setReg(0); app.setSoloBoxes([1]);
  app.setSoloRun(app.buildRun("up"));
  const spanAt = () => {
    app.renderSolo();
    return document.getElementById("solocards").innerHTML;
  };
  assert.match(spanAt(), /fret 5–8/, "A minor, standard");
  app.setKey(4);
  assert.match(spanAt(), /fret 12–15/, "E minor moves the same run up seven");
  app.setReg(-12);
  assert.match(spanAt(), /fret 0–3/, "octave down puts it at the nut");
  app.setKey(9); app.setReg(0); app.setSoloRun([]);
});

test("solo lab: playback, editing and persistence", () => {
  const { app, document, audio } = makeRuntime();
  app.setKey(9); app.setReg(0); app.setSoloBoxes([1]);
  app.setSoloRun(app.buildRun("up"));
  app.renderSolo();

  const before = audio.starts;
  document.getElementById("soloplay").click();
  assert.ok(audio.starts > before, "playing the run sounds notes");
  assert.equal(document.getElementById("soloplay").textContent, "Stop");
  assert.equal(app.getState().soloStep, 1, "playback has advanced past the first note");
  assert.ok(app.getState().soloTimer, "and is running on a timer");
  document.getElementById("soloplay").click();
  assert.equal(document.getElementById("soloplay").textContent, "Play run");
  assert.equal(app.getState().soloStep, -1, "stopping resets the position");
  assert.equal(app.getState().soloTimer, null, "and clears the timer");

  const n = app.getState().soloRun.length;
  document.getElementById("soloundo").click();
  assert.equal(app.getState().soloRun.length, n - 1, "undo drops the last note");
  document.getElementById("solorev").click();
  document.getElementById("solorev").click();
  assert.equal(app.getState().soloRun.length, n - 1, "reversing twice is a no-op");

  app.saveSolo();
  const stored = JSON.parse(app.getState().storage.getItem("minor-pentatonic-solo-v1"));
  sameShape(stored.boxes, [1], "the box selection is remembered");
  assert.equal(stored.run.length, n - 1, "and so is the run");

  document.getElementById("soloclear").click();
  assert.equal(app.getState().soloRun.length, 0, "clear empties it");
  app.renderSolo();
  assert.match(document.getElementById("solocards").innerHTML, /nothing yet/,
    "and the empty state explains how to start");
});

test("audio: a browser without Web Audio disables the controls instead of dying", () => {
  const { app, document } = makeRuntime({ audio: false });
  // ctx() used to throw here, which killed the click handler before it could set
  // aria-pressed — the button looked untouched and nothing explained why.
  assert.doesNotThrow(() => app.audio(), "audio() reports failure rather than throwing");
  assert.equal(app.audio(), null, "and hands back no engine to play through");
  assert.match(app.getAudioFault(), /neither the Web Audio API nor HTML audio/, "the reason is recorded");

  assert.match(document.getElementById("audiomsg").innerHTML, /neither the Web Audio API/,
    "and shown to the user");
  for (const id of ["drone", "click"]) {
    assert.equal(document.getElementById(id).disabled, true, `${id} is visibly unavailable`);
    assert.equal(document.getElementById(id).title,
      app.getAudioFault().replace(/<[^>]+>/g, ""), `${id} explains why, without markup`);
  }
});

test("audio: every sound-making function survives having no audio", () => {
  const { app, document } = makeRuntime({ audio: false });
  // none of these may throw — each one sits inside a click handler that has more to do
  assert.doesNotThrow(() => app.toggleDrone(document.getElementById("drone")), "drone");
  assert.doesNotThrow(() => app.toggleClick(document.getElementById("click")), "metronome");
  assert.doesNotThrow(() => app.pluck(64), "single note");
  assert.doesNotThrow(() => app.playRun([{ s: 5, f: 5 }, { s: 5, f: 8 }]), "run audition");
  assert.doesNotThrow(() => app.trainerSound("I7", 0), "12-bar trainer");
  assert.doesNotThrow(() => app.rhythmSound(true), "rhythm lab");
  assert.doesNotThrow(() => app.setTimer(1), "focus timer");
  // and the app is still fully usable without sound
  const boxesBtn = navButton(document, "boxes");
  assert.doesNotThrow(() => boxesBtn.click(), "views still switch");
  assert.ok(document.getElementById("boxes").innerHTML.includes("Box 1"),
    "and still render their content with no audio available");
});

test("audio: solo playback refuses cleanly when there is no audio", () => {
  const { app, document } = makeRuntime({ audio: false });
  app.setSoloBoxes([1]);
  app.setSoloRun(app.buildRun("up"));
  app.renderSolo();
  assert.doesNotThrow(() => app.playSolo(), "Play run does not throw");
  assert.equal(app.getState().soloTimer, null, "and does not pretend to be playing");
  assert.equal(app.getState().soloStep, -1, "and reports no playback position");
  assert.match(document.getElementById("soloplaymsg").innerHTML, /Web Audio/,
    "and says why nothing happened");
});

test("audio: with a working context the controls behave normally", () => {
  const { app, document, audio } = makeRuntime();
  assert.ok(app.audio(), "an engine is created");
  assert.equal(app.getAudioFault(), null, "no fault recorded");
  assert.equal(document.getElementById("audiomsg").textContent, "", "and nothing is reported");
  assert.equal(document.getElementById("drone").disabled, false, "controls stay enabled");
  const before = audio.starts;
  app.toggleDrone(document.getElementById("drone"));
  assert.ok(audio.starts > before, "the drone actually sounds");
  assert.equal(document.getElementById("drone").getAttribute("aria-pressed"), "true",
    "and the button records that it is on");
});

test("audio: Safari's Lockdown Mode is named, not written off as an old browser", () => {
  const { app } = makeRuntime({ audio: false });
  const safariUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Version/26.0 Safari/605.1.15";
  const chromeUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

  app.setUserAgent(safariUA);
  assert.equal(app.isSafari(), true, "Safari's UA is recognised");
  const safari = app.compatibilityReason();
  assert.match(safari, /Lockdown Mode/, "and Lockdown Mode is named as the cause");
  assert.match(safari, /Safari ▸ Settings ▸ Websites/, "with the exact place to change it");
  assert.match(safari, /compatibility mode/, "and says sound still works meanwhile");

  // Chrome's UA contains the word "Safari" — the check must not be fooled by it
  app.setUserAgent(chromeUA);
  assert.equal(app.isSafari(), false, "Chrome is not mistaken for Safari");
  const other = app.compatibilityReason();
  assert.doesNotMatch(other, /Lockdown Mode/, "and is not told to check a Safari setting");
  assert.match(other, /compatibility mode/, "but is told sound still works");
});

// ---- the compatibility (WAV) engine ----------------------------------------
// Decode what the engine actually produced, rather than trusting it not to throw.
function decodeWav(dataUri) {
  assert.match(dataUri, /^data:audio\/wav;base64,/, "is a playable data URI");
  const buf = Buffer.from(dataUri.split(",")[1], "base64");
  assert.equal(buf.toString("ascii", 0, 4), "RIFF", "RIFF header");
  assert.equal(buf.toString("ascii", 8, 12), "WAVE", "WAVE header");
  const n = buf.readUInt32LE(40) / 2, samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = buf.readInt16LE(44 + i * 2) / 32768;
  return {
    channels: buf.readUInt16LE(22), rate: buf.readUInt32LE(24),
    bits: buf.readUInt16LE(34), format: buf.readUInt16LE(20), n, samples,
  };
}
// zero-crossing pitch: no octave errors, which autocorrelation is prone to here
const pitchOf = w => {
  let crossings = 0;
  for (let i = 1; i < w.n; i++) if ((w.samples[i - 1] < 0) !== (w.samples[i] < 0)) crossings++;
  return crossings * w.rate / (2 * w.n);
};
test("compatibility engine is chosen when Web Audio is withheld", () => {
  const { app, document } = makeRuntime({ audio: "wav" });
  const engine = app.audio();
  assert.ok(engine, "an engine is still produced");
  assert.equal(engine.name, "Compatibility", "the WAV engine, not Web Audio");
  assert.equal(app.getAudioFault(), null, "which is not a failure");
  for (const id of ["drone", "click"])
    assert.equal(document.getElementById(id).disabled, false, `${id} stays usable`);
  assert.match(document.getElementById("audiomsg").innerHTML, /compatibility mode/,
    "and the difference is explained rather than hidden");
});

test("compatibility engine renders real, correctly pitched audio", () => {
  const runtime = makeRuntime({ audio: "wav" });
  const engine = runtime.app.audio();

  const grab = fn => {
    const before = runtime.audioElements.length;
    fn();
    const made = runtime.audioElements.slice(before);
    assert.equal(made.length, 1, "exactly one sound was produced");
    return made[0];
  };

  // A4 is midi 69 = 440 Hz; the low E of a guitar is midi 40 = 82.41 Hz
  for (const [midi, hz] of [[69, 440], [40, 82.41], [64, 329.63]]) {
    const w = decodeWav(grab(() => engine.note(midi, { dur: .5 })).src);
    assert.equal(w.format, 1, "uncompressed PCM");
    assert.equal(w.channels, 1, "mono");
    assert.equal(w.bits, 16, "16-bit");
    assert.ok(w.n > 1000, `midi ${midi} has real length (${w.n} samples)`);
    const peak = Math.max(...w.samples.map(Math.abs));
    assert.ok(peak > 0.05 && peak <= 1, `midi ${midi} is audible and unclipped (peak ${peak.toFixed(2)})`);
    const got = pitchOf(w);
    assert.ok(Math.abs(got - hz) / hz < 0.06,
      `midi ${midi} sounds at ${got.toFixed(1)} Hz, wanted ${hz} Hz`);
  }
});

test("compatibility engine's drone loops without a click", () => {
  const runtime = makeRuntime({ audio: "wav" });
  const engine = runtime.app.audio();
  const before = runtime.audioElements.length;
  const handle = engine.startDrone([110, 220, 330]);
  const el = runtime.audioElements[before];
  assert.ok(el, "the drone produced a sound");
  assert.equal(el.loop, true, "which loops, because a drone is continuous");

  const w = decodeWav(el.src);
  const got = pitchOf(w);
  assert.ok(Math.abs(got - 110) / 110 < 0.06, `drone sounds at ${got.toFixed(1)} Hz, wanted 110`);

  // A loop only clicks if the jump across the join is larger than the jumps inside it.
  const seam = Math.abs(w.samples[0] - w.samples[w.n - 1]);
  let biggestStep = 0;
  for (let i = 1; i < w.n; i++)
    biggestStep = Math.max(biggestStep, Math.abs(w.samples[i] - w.samples[i - 1]));
  assert.ok(seam <= biggestStep * 1.5,
    `the loop joins silently (seam ${seam.toFixed(5)} vs largest ordinary step ${biggestStep.toFixed(5)})`);

  assert.doesNotThrow(() => handle.stop(), "and it can be stopped");
  for (let i = 0; i < 5; i++) for (const fn of [...runtime.intervals.values()]) fn();   // let the fade-out run
  assert.equal(el.playing, false, "which actually pauses it once faded");
});

test("compatibility engine renders each distinct sound only once", () => {
  const runtime = makeRuntime({ audio: "wav" });
  const engine = runtime.app.audio();
  const srcOf = fn => {
    const before = runtime.audioElements.length;
    fn();
    return runtime.audioElements[before].src;
  };
  const a = srcOf(() => engine.note(69, { dur: .5 }));
  const b = srcOf(() => engine.note(69, { dur: .5 }));
  assert.equal(a, b, "the same note reuses the cached render");
  const c = srcOf(() => engine.note(70, { dur: .5 }));
  assert.notEqual(a, c, "a different note is rendered separately");
});

test("both engines satisfy the same interface", () => {
  const web = makeRuntime().app.audio();
  const wav = makeRuntime({ audio: "wav" }).app.audio();
  assert.equal(web.name, "Web Audio");
  assert.equal(wav.name, "Compatibility");
  for (const method of ["state", "resume", "note", "blip", "chord", "startDrone", "stopAll"]) {
    assert.equal(typeof web[method], "function", `Web Audio implements ${method}`);
    assert.equal(typeof wav[method], "function", `Compatibility implements ${method}`);
  }
  for (const engine of [web, wav]) {
    assert.doesNotThrow(() => engine.note(60, {}), `${engine.name}: note`);
    assert.doesNotThrow(() => engine.blip(880, {}), `${engine.name}: blip`);
    assert.doesNotThrow(() => engine.chord([220, 330, 440], {}), `${engine.name}: chord`);
    const d = engine.startDrone([110, 220, 330]);
    assert.equal(typeof d.stop, "function", `${engine.name}: drone hands back a stop`);
    assert.doesNotThrow(() => d.stop(), `${engine.name}: drone stops`);
    assert.doesNotThrow(() => engine.stopAll(), `${engine.name}: stopAll`);
  }
});

test("the whole app runs on the compatibility engine", () => {
  const { app, document, audioElements } = makeRuntime({ audio: "wav" });
  const sounds = () => audioElements.length;
  const before = sounds();
  app.toggleDrone(document.getElementById("drone"));
  assert.ok(sounds() > before, "drone");
  assert.equal(document.getElementById("drone").getAttribute("aria-pressed"), "true");
  app.toggleDrone(document.getElementById("drone"));

  const n1 = sounds(); app.toggleClick(document.getElementById("click"));
  assert.ok(sounds() > n1, "metronome");
  app.toggleClick(document.getElementById("click"));

  const n2 = sounds(); app.pluck(64);
  assert.ok(sounds() > n2, "a tapped diagram note");

  const n3 = sounds(); app.trainerSound("I7", 0);
  assert.ok(sounds() > n3, "12-bar trainer");

  const n4 = sounds(); app.rhythmSound(true);
  assert.ok(sounds() > n4, "rhythm lab");

  const n5 = sounds(); app.timerCue();
  assert.ok(sounds() > n5, "focus timer cue");

  app.setSoloBoxes([1]); app.setSoloRun(app.buildRun("up")); app.renderSolo();
  const n6 = sounds(); app.playSolo();
  assert.ok(sounds() > n6, "solo playback");
  assert.ok(app.getState().soloTimer, "which really is running");
  app.stopSolo();
});


test("Phrygian dominant lesson spells the changes and draws valid notes in every key and register", () => {
  const {app,document}=makeRuntime();
  navButton(document,"hijaz").click();
  document.getElementById("hijazexample").click();
  assert.equal(app.getState().key,4);
  assert.equal(app.getState().reg,0);
  assert.match(document.getElementById("hijazlesson").innerHTML,/G → G♯/);
  assert.match(document.getElementById("hijazlesson").innerHTML,/E7 → Am/);
  assert.match(document.getElementById("hijazpractice").innerHTML,/12–13–16–17/);
  assert.equal(app.pdBox(app.BOXES[0]).lo,12);
  app.setKey(9);
  assert.equal(app.pdName(1,2),"B♭");
  assert.equal(app.pdName(4,3),"C♯");
  for(let key=0;key<12;key++)for(const [reg] of app.REGS){
    app.setKey(key);app.setReg(reg);app.renderHijaz();
    assert.equal((document.getElementById("hijazboxes").innerHTML.match(/<svg /g)||[]).length,5);
    for(const b of app.BOXES){
      const {lo,hi,notes}=app.pdBox(b);
      assert.ok(lo>=0&&hi<=24&&notes.length>0);
      for(const note of notes){
        const degree=(app.noteAt(note.s,note.f)-key+12)%12;
        assert.ok([0,1,4,5,7,8,10].includes(degree),"no minor third or foreign scale tone");
        assert.equal(note.kind==="pivot",[1,4,8].includes(degree),"all three added colours are gold");
      }
    }
  }
});

test("open tunings section shows standard-to-open changes and practice guidance", () => {
  const { app, document } = makeRuntime();
  navButton(document, "open").click();
  assert.equal(app.OPEN_TUNINGS.length, 4);
  assert.match(document.getElementById("opentuninglesson").innerHTML, /D · A · D · F♯ · A · D/);
  assert.match(document.getElementById("opentuninglesson").innerHTML, /Root locations in Open D/);
  assert.match(document.getElementById("opentuningcards").innerHTML, /D5 on strings 6–4/);
  assert.equal((document.getElementById("opentuningcards").innerHTML.match(/class="tuning-shape"/g)||[]).length,24);
  assert.equal((document.getElementById("opentuningcards").innerHTML.match(/class="tuning-tab"/g)||[]).length,4);
  assert.match(html, /Check every string twice/);
  document.getElementById("opentuningpick").children[2].click();
  assert.match(document.getElementById("opentuninglesson").innerHTML, /E · B · E · G♯ · B · E/);
});

test("alternate tuning chord voicings and tab pitches match their named harmony", () => {
  const {app}=makeRuntime();
  const expected={"open-d":[38,45,50,54,57,62],"open-g":[38,43,50,55,59,62],"open-e":[40,47,52,56,59,64],"drop-d":[38,45,50,55,59,64]};
  for(const t of app.OPEN_TUNINGS){
    const midi=app.tuningMidi(t);
    sameShape(midi,expected[t.id],`${t.name} tuning pitches and retuning directions`);
    for(const c of app.TUNING_OPEN_CHORDS[t.id]){
      const degrees=c.frets.flatMap((f,i)=>f===null?[]:[(midi[i]+f-c.root+12)%12]);
      assert.deepEqual([...new Set(degrees)].sort((a,b)=>a-b),[0,4,7],`${t.name}: ${c.name} contains exactly a major triad`);
    }
    const ex=app.TUNING_EXAMPLES[t.id];
    sameShape(ex.frets.map(f=>(midi[ex.lead]+f-ex.root+12)%12),t.id==="drop-d"?[0,3,5,3]:[0,2,4,2],`${t.name} tab agrees with its degree labels`);
    for(const fret of [0,5,7]){
      const played=midi.filter((_,i)=>t.id==="drop-d"?i<3:t.id==="open-g"?i>0:true);
      const degrees=[...new Set(played.map(m=>(m+fret-(ex.root+fret)+12)%12))].sort((a,b)=>a-b);
      assert.deepEqual(degrees,t.id==="drop-d"?[0,7]:[0,4,7],`${t.name} barre chord quality`);
    }
  }
});

test("the metronome books clicks on the audio clock, so a late timer does not move them", () => {
  const { app, document, audio, advance } = makeRuntime();
  const beat = 60 / app.getState().bpm;
  app.toggleClick(document.getElementById("click"));
  // The pump timer is meant to run every 25 ms but a busy main thread makes it
  // irregular. As long as each gap is inside the 0.12 s lookahead, every click must
  // still land exactly on the grid.
  for (let i = 0; i < 40; i++) advance([.03, .11, .004, .09, .06, .115, .02, .07][i % 8]);
  const times = audio.startTimes;
  assert.ok(times.length >= 4, `booked ${times.length} clicks`);
  times.forEach((t, i) => assert.ok(Math.abs(t - i * beat) < 1e-9, `click ${i} at ${t}, want ${i * beat}`));
  app.toggleClick(document.getElementById("click"));
  assert.equal(app.getState().clickTimer, null);
});

test("a hidden tab books further ahead, so throttled timers do not drop beats", () => {
  const { app, document, audio } = makeRuntime();
  document.hidden = true;
  app.toggleClick(document.getElementById("click"));
  const beat = 60 / app.getState().bpm;
  assert.equal(audio.startTimes.length, Math.ceil(1.5 / beat), "about 1.5 s of clicks booked at once");
  app.toggleClick(document.getElementById("click"));
});

test("after a long stall the loop resumes from now instead of firing every missed beat", () => {
  const { app, document, audio, advance } = makeRuntime();
  app.toggleClick(document.getElementById("click"));
  const before = audio.startTimes.length;
  advance(30);   // e.g. the laptop slept
  assert.ok(audio.startTimes.length - before <= 2, `fired ${audio.startTimes.length - before} catch-up clicks`);
  app.toggleClick(document.getElementById("click"));
});

test("the trainer readout follows the beats booked on the audio clock", () => {
  const { app, document, advance } = makeRuntime();
  app.toggleTrainer();                          // books count-in beat 1 immediately
  const beat = 60 / app.getState().bpm;
  for (let i = 0; i < 7; i++) advance(beat);    // count-in 2-4, then bar 1 beats 1-4
  assert.match(document.getElementById("trainerreadout").textContent, /^bar 1 · beat 4$/);
  app.resetTrainer();
});

test("the compatibility engine, with no audio clock, still keeps time per beat", () => {
  const { app, document, intervals } = makeRuntime({ audio: "wav" });
  app.toggleClick(document.getElementById("click"));
  assert.equal(app.getEngine().name, "Compatibility");
  assert.ok(intervals.has(app.getState().clickTimer));
  app.toggleClick(document.getElementById("click"));
});

test("the compatibility engine's sound cache stays bounded", () => {
  const { app } = makeRuntime({ audio: "wav" });
  const a = app.audio();
  assert.equal(a.name, "Compatibility");
  // every tempo change makes new note lengths: far more distinct sounds than the cap
  for (let i = 0; i < 400; i++) a.blip(200 + i, { dur: .05 });
  assert.ok(a.cacheSize() <= 200, `cache holds ${a.cacheSize()} sounds`);
  // and a sound in use survives, because use refreshes it
  a.blip(999, { dur: .05 });
  for (let i = 0; i < 199; i++) { a.blip(1000 + i, { dur: .05 }); a.blip(999, { dur: .05 }); }
  assert.ok(a.cacheSize() <= 200);
});

test("drones fade out instead of cutting off", () => {
  const { app, audio } = makeRuntime();
  const web = app.audio();
  const d = web.startDrone([110, 220]);
  const origStops = audio.stops;
  d.stop();
  assert.ok(audio.stops > origStops, "the web audio drone stops its oscillators");

  const { app: wapp, audioElements, intervals: wint } = makeRuntime({ audio: "wav" });
  const el0 = wapp.audio().startDrone([110, 220]);
  el0.stop();
  const el = audioElements.at(-1);
  assert.notEqual(el.src, "", "the compatibility drone is not released at once");
  for (const fn of [...wint.values()]) { fn(); fn(); fn(); fn(); fn(); }
  assert.equal(el.src, "", "but is released once the fade finishes");
});

test("hostile or malformed saved data can neither inject markup nor break a view", () => {
  const { app, document } = makeRuntime();
  const store = app.getState().storage;
  const evil = '<img src=x onerror="alert(1)">';
  for (const [key, value] of [
    ["minor-pentatonic-practice-log-v1", JSON.stringify([{ date: evil, key: evil, bpm: evil }, null, 7, "x"])],
    ["minor-pentatonic-guide-checklist-v1", JSON.stringify({ filter: 1, length: 3 })],
    ["minor-pentatonic-solo-v1", JSON.stringify({ boxes: [evil, 2], run: [{ s: evil, o: 1 }] })],
    ["minor-pentatonic-arrangements-v1", JSON.stringify({ a: evil, fa: 1, b: [], fb: null })],
  ]) store.setItem(key, value);

  assert.doesNotThrow(() => app.renderGuide(), "checklist view draws");
  assert.doesNotThrow(() => app.completeSession(), "practice log draws");
  assert.doesNotThrow(() => app.renderTheory(), "song projects draw");
  assert.doesNotThrow(() => { app.loadSolo(); app.renderSolo(); }, "solo lab draws");
  const log = document.getElementById("loglist").innerHTML;
  assert.doesNotMatch(log, /<img/, "log entries are escaped");
  assert.match(log, /&lt;img/, "and shown as text");
  assert.ok(app.getState().soloBoxes.every(n => typeof n === "number"), "stored boxes are numbers only");
});

test("every fret and string line in a box diagram survives being scaled down", () => {
  const { app } = makeRuntime();
  for (let key = 0; key < 12; key++) {
    app.setKey(key);
    for (const b of app.validBoxes()) {
      const svg = app.fretboard(app.boxNotes(b));
      const lines = svg.match(/<line [^>]*stroke="var\(--ink\)"[^>]*>/g) ?? [];
      const frets = new Set(app.boxNotes(b).map(n => n.f));
      const cols = Math.max(...frets) - Math.max(Math.min(...frets) - 1, 0);
      assert.equal(lines.length, cols + 1 + 6, `key ${key} box ${b.n}: ${cols + 1} fret lines and 6 strings`);
      for (const l of lines) assert.match(l, /vector-effect="non-scaling-stroke"/, `key ${key} box ${b.n}: ${l}`);
    }
  }
});

test("the static live demo shows no Quit control, because there is no app to stop", async () => {
  const { document, fetched } = makeRuntime({ demo: true });
  document.getElementById("approw").hidden = true;   // as index.html starts it
  await new Promise(r => setImmediate(r));
  assert.equal(document.getElementById("approw").hidden, true);
  assert.equal(fetched.length, 0, "and it does not probe the host for an app that cannot be there");
});

// ---------- recording ----------
// Recording is promise-driven (getUserMedia, decodeAudioData, blob.arrayBuffer), so
// the tests let those settle before looking.
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };

test("without microphone access the Record row is switched off and says why", () => {
  const { document } = makeRuntime();
  assert.equal(document.getElementById("recbtn").disabled, true);
  assert.equal(document.getElementById("recrow").classList.contains("off"), true);
  assert.match(document.getElementById("recmsg").textContent, /secure page/);
});

test("a guitar-only take asks for an unprocessed mono input and records it at 96 kbps", async () => {
  const { app, document, rec, audio } = makeRuntime({ media: true });
  app.setKey(9); app.setBpm(120);
  document.getElementById("recbtn").click();
  await settle();
  const want = rec.asked[0].audio;
  assert.equal(want.echoCancellation, false);
  assert.equal(want.noiseSuppression, false);
  assert.equal(want.autoGainControl, false);
  assert.equal(want.channelCount.ideal, 1);
  const r = rec.recorders[0];
  assert.equal(r.opts.audioBitsPerSecond, 96000);
  assert.equal(r.opts.mimeType, "audio/webm;codecs=opus");
  assert.equal(r.stream.destination, true, "recorded through Web Audio");
  assert.equal(app.getRec().dest.channelCount, 1, "downmixed to one channel");
  assert.equal(audio.taps.length, 0, "no backing in the take");
  assert.equal(r.state, "recording");
  assert.equal(document.getElementById("recbtn").textContent, "Stop");
  assert.match(document.getElementById("recmsg").textContent, /Recording guitar only/);

  document.getElementById("recbtn").click();
  await settle();
  assert.equal(rec.tracksStopped, 1, "the input is released when the take ends");
  const take = app.getTake();
  assert.match(take.name, /^practice-A-120bpm-\d{8}-\d{6}\.webm$/);
  assert.equal(take.wav.name, take.name.replace(".webm", ".wav"));
  assert.equal(document.getElementById("recplay").hidden, false);
  assert.equal(document.getElementById("recplay").src, take.url);
  assert.equal(document.getElementById("recdlc").textContent, "Download compressed (3 KB)");
  // one second of 48 kHz mono, 16-bit, plus the 44-byte header
  assert.equal(take.wav.blob.size, 44 + 48000 * 2);
  assert.equal(document.getElementById("recdlw").textContent, "Download WAV (94 KB)");
  const header = new DataView(await take.wav.blob.arrayBuffer());
  assert.equal(header.getUint16(22, true), 1, "mono WAV");
  assert.equal(header.getUint32(24, true), 48000);

  document.getElementById("recdlw").click();
  const link = document.body.children.at(-1);
  assert.equal(link.download, take.wav.name);
  assert.equal(link.href, take.wav.url);
  assert.equal(document.getElementById("recbtn").textContent, "Record");
});

test("the container falls back to MP4/AAC, then to the browser's own choice", () => {
  assert.equal(makeRuntime({ media: { types: ["audio/mp4;codecs=mp4a.40.2", "audio/mp4"] } }).app.recMime(),
    "audio/mp4;codecs=mp4a.40.2");
  assert.equal(makeRuntime({ media: { types: [] } }).app.recMime(), "");
  const { app } = makeRuntime({ media: true });
  assert.equal(app.recExt("audio/mp4;codecs=mp4a.40.2"), "m4a");
  assert.equal(app.recExt("audio/webm;codecs=opus"), "webm");
  app.setKey(1); app.setBpm(96);
  assert.equal(app.takeName(new Date(2026, 8, 18, 9, 5, 7), "m4a"), "practice-Csharp-96bpm-20260918-090507.m4a");
  assert.equal(app.fileSize(512), "512 B");
  assert.equal(app.fileSize(4.2 * 1048576), "4.2 MB");
});

test("guitar + backing taps the Web Audio mix into the take and records stereo", async () => {
  const { app, document, rec, audio } = makeRuntime({ media: true });
  document.getElementById("recmix").value = "backing";
  document.getElementById("recbtn").click();
  await settle();
  assert.equal(rec.asked[0].audio.channelCount, undefined, "no mono request");
  assert.equal(app.getRec().dest.channelCount, 2);
  assert.equal(audio.taps.length, 1, "the engine's master bus feeds the take");
  assert.equal(audio.taps[0], app.getRec().dest);
  document.getElementById("recbtn").click();
  await settle();
  assert.equal(audio.untaps.at(-1), audio.taps[0], "untapped when the take ends");
  const header = new DataView(await app.getTake().wav.blob.arrayBuffer());
  assert.equal(header.getUint16(22, true), 2, "stereo WAV");
});

test("backing with the compatibility engine falls back to guitar only and says so", async () => {
  const { app, document, rec } = makeRuntime({ media: true, audio: "wav" });
  document.getElementById("recmix").value = "backing";
  document.getElementById("recbtn").click();
  await settle();
  const r = rec.recorders[0];
  assert.equal(r.stream.destination, undefined, "the raw input is recorded");
  assert.equal(rec.asked[0].audio.channelCount.ideal, 1);
  assert.match(document.getElementById("recmsg").textContent, /compatibility sound mode.*guitar only/);
  document.getElementById("recbtn").click();
  await settle();
  // no AudioContext to decode with, so only the compressed file is offered
  assert.equal(document.getElementById("recdlc").hidden, false);
  assert.equal(document.getElementById("recdlw").hidden, true);
  assert.match(document.getElementById("recmsg").textContent, /no WAV copy/);
  assert.equal(app.getTake().wav, null);
});

test("an armed take starts on bar 1 after the count-in and ends with the trainer", async () => {
  const { app, document, rec, advance } = makeRuntime({ media: true });
  app.setBpm(120);
  document.getElementById("recarm").checked = true;
  document.getElementById("recbtn").click();
  await settle();
  assert.equal(app.getRec().phase, "armed");
  assert.equal(rec.recorders[0].state, "inactive");
  assert.match(document.getElementById("recmsg").textContent, /Armed/);
  assert.equal(document.getElementById("recarm").disabled, true);

  app.toggleTrainer();                        // books the first count-in beat
  for (let i = 0; i < 2; i++) advance(0.5);   // count-in beats 2 and 3 are booked
  assert.equal(app.getState().trainerCount, 1);
  assert.equal(rec.recorders[0].state, "inactive", "still counting in");
  advance(0.5);   // books count-in beat 4 and, within the look-ahead, bar 1
  advance(0.5);
  assert.equal(app.getState().trainerBar, 0);
  assert.equal(rec.recorders[0].state, "recording", "started on the bar-1 downbeat");
  assert.equal(app.getRec().fromTrainer, true);

  app.toggleTrainer();                        // Stop
  await settle();
  assert.equal(rec.recorders[0].state, "inactive");
  assert.ok(app.getTake(), "stopping the trainer saved the take");
});

test("a refused microphone is explained, and Cancel releases an armed input", async () => {
  const denied = makeRuntime({ media: { deny: true } });
  denied.document.getElementById("recbtn").click();
  await settle();
  assert.match(denied.document.getElementById("recmsg").textContent, /refused/);
  assert.equal(denied.document.getElementById("recbtn").textContent, "Record");

  const { app, document, rec } = makeRuntime({ media: true });
  document.getElementById("recarm").checked = true;
  document.getElementById("recbtn").click();
  await settle();
  document.getElementById("recbtn").click();   // Cancel
  assert.equal(app.getRec(), null);
  assert.equal(rec.tracksStopped, 1);
  assert.equal(app.getTake(), null);
  assert.equal(document.getElementById("recarm").disabled, false);
});

test("input devices are listed by name, escaped, and the choice is used", async () => {
  const { document, rec } = makeRuntime({ media: { devices: [
    { kind: "audioinput", deviceId: "default", label: "Default" },
    { kind: "audioinput", deviceId: "abc", label: "Scarlett <2i2>" },
    { kind: "videoinput", deviceId: "cam", label: "Camera" },
  ] } });
  await settle();
  const html = document.getElementById("recinput").innerHTML;
  assert.match(html, /<option value="abc">Scarlett &lt;2i2&gt;<\/option>/);
  assert.doesNotMatch(html, /Camera|value="default"/);
  document.getElementById("recinput").onchange({ target: { value: "abc" } });
  document.getElementById("recbtn").click();
  await settle();
  assert.equal(rec.asked[0].audio.deviceId.exact, "abc");
});

test("the WAV encoder writes a valid interleaved 16-bit header", () => {
  const { app } = makeRuntime();
  const bytes = app.wavBytes([new Float32Array([1, -1]), new Float32Array([0, 0.5])], 44100);
  const v = new DataView(bytes.buffer);
  assert.equal(bytes.length, 44 + 2 * 2 * 2);
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), "RIFF");
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getUint32(28, true), 44100 * 4, "byte rate");
  assert.equal(v.getUint16(32, true), 4, "block align");
  assert.deepEqual([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true)], [32767, 0, -32768]);
});

test("the hidden attribute wins over any display rule, so Quit stays hidden on the demo", () => {
  // .row sets display:flex, which used to override hidden and show the App row on
  // the static demo. The test DOM applies no CSS, so check the stylesheet itself.
  const css = readFileSync(new URL("../web/app.css", import.meta.url), "utf8");
  assert.match(css, /(^|\s)\[hidden\]\{display:none!important\}/);
});

test("a take stops itself at the 30-minute cap and says so", async () => {
  const { app, document, rec, clock, advance } = makeRuntime({ media: true });
  assert.equal(app.REC_MAX_SEC, 1800);
  document.getElementById("recbtn").click();
  await settle();
  clock.wall = 1799; advance(0.25);
  assert.equal(rec.recorders[0].state, "recording", "still going just under the cap");
  assert.match(document.getElementById("recmsg").textContent, /29:59/);
  clock.wall = 1800; advance(0.25);
  await settle();
  assert.equal(rec.recorders[0].state, "inactive");
  assert.ok(app.getTake());
  assert.match(document.getElementById("recmsg").textContent, /^Stopped at the 30-minute limit\. Take saved: 1800 s, mono\./);
});
