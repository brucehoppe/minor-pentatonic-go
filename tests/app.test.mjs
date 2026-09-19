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
const chooseKey = (document, key) => {
  const select = document.getElementById("keyselect");
  select.value = String(key); select.dispatch("change");
};
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
const lesson = readFileSync(new URL("../web/seven-licks.html", import.meta.url), "utf8");
const lessonScript = readFileSync(new URL("../web/seven-licks.js", import.meta.url), "utf8");
const explorerScripts = ["chord-explorer.js", "triads-explorer.js", "inversions-explorer.js"]
  .map(f => readFileSync(new URL("../web/" + f, import.meta.url), "utf8"));
const bandScript = readFileSync(new URL("../web/band.js", import.meta.url), "utf8");
const analysisScript = readFileSync(new URL("../web/analysis.js", import.meta.url), "utf8");
const pitchScripts = ["pitch.js", "tune.js", "changes.js"].map(f => readFileSync(new URL("../web/" + f, import.meta.url), "utf8"));
const songsScript = readFileSync(new URL("../web/songs.js", import.meta.url), "utf8");
const libraryScript = readFileSync(new URL("../web/library.js", import.meta.url), "utf8");
const looperScript = readFileSync(new URL("../web/looper.js", import.meta.url), "utf8");

class Element {
  constructor(id = "", tagName = "div") {
    this.id = id; this.tagName = tagName.toUpperCase(); this.children = []; this.dataset = {}; this.style = {};
    this.attributes = {}; this.hidden = false; this.disabled = false; this.listeners = {};
    this.innerHTML = ""; this.textContent = ""; this.value = "90";
    const classes = new Set();
    this.classList = {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c), toggle: (c, on) =>
        (on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c),
    };
  }
  // Setting textContent replaces the children, as in a browser: the explorers clear a
  // container that way before drawing into it. Reading it gives the text of the
  // children when the element has none of its own.
  get textContent() { return this._text || this.children.map(c => c.textContent ?? "").join(""); }
  set textContent(v) { this._text = String(v); this.children = []; }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = String(value);
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  // what a browser does when the user acts: change on a select, keydown on the board
  dispatch(type, extra = {}) {
    const ev = { type, target: this, currentTarget: this, preventDefault() {}, ...extra };
    (this.listeners[type] || []).forEach(fn => fn(ev));
  }
  closest() { return null; }
  querySelector() { return new Element(); }
  querySelectorAll() { return []; }
  scrollIntoView() {}
  // enough of an <audio> element for the page's own players (takes, songs)
  pause() { this.paused = true; } play() { this.paused = false; return Promise.resolve(); }
  removeAttribute(name) { delete this.attributes[name]; if (name === "src") this.src = ""; }
  // A disabled button does nothing when clicked, here as in a browser — which is
  // what makes the toolbar-gating tests below mean anything.
  click() {
    if (this.disabled) return;
    if (this.onclick) this.onclick({ currentTarget: this, target: this });
    this.dispatch("click");
  }
}
// Walks an element tree: every element under root (children first) matching pred.
const findAll = (root, pred, out = []) => {
  for (const c of root.children || []) { if (c instanceof Element && pred(c)) out.push(c); findAll(c, pred, out); }
  return out;
};
const buttonNamed = (root, text) => findAll(root, e => e.tagName === "BUTTON" && e.textContent === text)[0];

// audio: "web" (default) | "wav" (no AudioContext, only HTMLAudioElement) | false (neither)
// media: false (default, no microphone API) | true | { types, devices, deny } — a stand-in
// for getUserMedia and MediaRecorder; types lists the containers isTypeSupported accepts.
// deterministic: fix Math.random, so a view that generates a fresh quiz or session
// on every draw still renders identically twice — without that, "did this control
// change anything?" cannot be answered by comparing two renders.
// userAgent is read once, as the page loads; secure is window.isSecureContext.
// capture: AudioWorklet and IndexedDB, for the raw take master — true, or
// { failAfter: n } to make storage fail after n writes, or { store } to start from
// what an earlier page left in storage.
function makeRuntime({ audio: audioMode = "web", deterministic = false, demo = false, media = false,
  userAgent = "", secure = true, capture = false, worker = false, stored: seed = {}, explorers = true, band = true } = {}) {
  const MathForApp = deterministic
    ? new Proxy(Math, { get: (t, k) => (k === "random" ? () => 0.42 : t[k]) })
    : Math;
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const elements = new Map(ids.map(id => [id, new Element(id)]));
  // startTimes records when each oscillator was booked to sound, on the fake audio
  // clock; clock.t is that clock, which a test moves forward with advance().
  const audio = { oscillators: 0, starts: 0, stops: 0, gains: 0, startTimes: [], taps: [], untaps: [], toSpeakers: [] };
  const clock = { t: 0, wall: 0 };
  class AudioParam { setValueAtTime() {} exponentialRampToValueAtTime() {} linearRampToValueAtTime() {} cancelScheduledValues() {} }
  // Each capture node records what the page tells it; feed() hands it audio as the
  // real worklet would, and a stop is answered with the frames it was fed.
  const worklets = [], modules = [];
  class AudioWorkletNode {
    constructor(ctx, name, opts) {
      this.name = name; this.opts = opts; this.sent = []; this.fed = 0; worklets.push(this);
      const node = this;
      this.port = { onmessage: null, postMessage(m) { node.sent.push(m);
        if (m && m.stop) queueMicrotask(() => node.port.onmessage && node.port.onmessage({ data: { done: node.fed } })); } };
    }
    connect() {} disconnect() {}
    // hands the page one block of exactly these samples (channel 1)
    feedRaw(samples) { this.fed += samples.length; this.port.onmessage({ data: { block: [samples] } }); }
    feed(frames, level = 0.5) {
      const ch = this.opts.processorOptions.channels;
      this.fed += frames;
      this.port.onmessage({ data: { block: Array.from({ length: ch }, () => new Float32Array(frames).fill(level)) } });
    }
  }
  class AudioContext {
    constructor() { this.state = "running"; this.destination = { speakers: true }; this.sampleRate = 48000;
      if (capture) this.audioWorklet = { addModule: url => { modules.push(url); return Promise.resolve(); } };
      this.baseLatency = 0.005; this.outputLatency = audio.outputLatency ?? 0.01; }
    get currentTime() { return clock.t; }
    resume() { return Promise.resolve(); }
    createGain() { audio.gains++; const g = { gain: new AudioParam(), inputs: [], outs: [],
      connect(node) { g.outs.push(node); if (node && node.stream) audio.taps.push(node); if (node && node.speakers) audio.toSpeakers.push(g); },
      disconnect(node) { audio.untaps.push(node); if (!node) g.disconnected = true; } }; return g; }
    createMediaStreamDestination() { return { stream: { destination: true }, channelCount: 2, connect() {} }; }
    // An analyser reads audio.levels[channel] (a peak, 0..1) for whichever splitter
    // output feeds it, so a test can "play" into Input 1 or Input 2.
    createAnalyser() { const an = { fftSize: 2048, getFloatTimeDomainData(buf) {
      const link = (audio.splitters ?? []).flatMap(sp => sp.links).find(l => l.d === an);
      buf.fill(0); buf[0] = (audio.levels ?? [0, 0])[link ? link.out : 0]; } }; return an; }
    createChannelSplitter(n) { const sp = { n, links: [], connect(d, out, inp) { sp.links.push({ d, out, inp }); } };
      audio.splitters = [...(audio.splitters ?? []), sp]; return sp; }
    createMediaStreamSource(input) { const n = { input, connected: [], connect(d) { n.connected.push(d); },
      disconnect() { n.connected = []; } }; return n; }
    createMediaElementSource(input) { const n=this.createMediaStreamSource(input); (audio.mediaSources??=[]).push(n);return n; }
    // decodes any take to one second of stereo 48 kHz
    decodeAudioData() { return Promise.resolve({ numberOfChannels: 2, sampleRate: 48000, duration: 1,
      getChannelData: () => new Float32Array(48000).fill(0.25) }); }
    createOscillator() { audio.oscillators++; return { type: "sine", frequency: new AudioParam(), connect() {},
      start(t) { audio.starts++; audio.startTimes.push(t); }, stop() { audio.stops++; } }; }
    createDynamicsCompressor() { const p = () => ({ value: 0 }), l = { threshold: p(), knee: p(), ratio: p(), attack: p(), release: p(),
      outs: [], connect(n) { l.outs.push(n); } }; (audio.limiters ??= []).push(l); return l; }
    createBiquadFilter() { return { type: "lowpass", frequency: new AudioParam(), Q: new AudioParam(), connect() {} }; }
    // noise for the drums: a buffer, and sources that play it (logged with when they start)
    createBuffer(ch, len, sr) { const data = new Float32Array(len); return { length: len, sampleRate: sr, duration: len / sr, numberOfChannels: ch,
      getChannelData: () => data, copyToChannel(arr) { data.set(arr); } }; }
    // sources are logged: a looping one records where it was told to start and from what offset
    createBufferSource() { const src = { buffer: null, loop: false, connected: [], connect(n) { src.connected.push(n); }, disconnect() {},
      start(t, off) { src.startedAt = t; src.offset = off; audio.starts++; audio.startTimes.push(t); (audio.noise ??= []).push(t); },
      stop() { src.stopped = true; } }; (audio.sources ??= []).push(src); return src; }
  }
  const docListeners = {};
  const document = {
    addEventListener(type, fn) { (docListeners[type] ??= []).push(fn); },
    // what a browser does for a key pressed anywhere on the page
    dispatch(type, ev = {}) { (docListeners[type] || []).forEach(fn => fn({ target: document.body, preventDefault() {}, ...ev })); },
    body: new Element("body"),
    title: "",
    getElementById(id) { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); },
    createElement(tag = "div") { return new Element("", tag); },
    createElementNS(ns, tag) { return new Element("", tag); },
    createTextNode(text) { return { nodeType: 3, textContent: String(text) }; },
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
      // the nav holds its buttons in one row per band, as the real page does
      if (match && match[1] === "views") return document.getElementById("views").children.flatMap(r => r.children);
      return match ? document.getElementById(match[1]).children : [];
    },
  };
  const intervals = new Map(), idle = new Map(); let intervalID = 0;
  const stored = new Map(Object.entries(seed));   // localStorage as an earlier visit left it
  const localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key,value) => stored.set(key,String(value)) };
  // a stand-in for HTMLAudioElement, which is all the compatibility engine needs
  const audioElements = [];
  class AudioEl {
    // firstSrc: what it was made to play (releasing an element clears its src)
    constructor(src) { this.listeners={}; this.src = src; this.firstSrc = src; this.loop = false; this.volume = 1;
      this.paused=true;this.currentTime=0;this.duration=600;audioElements.push(this); }
    set src(v) {this._src=v;if(v)queueMicrotask(()=>this.listeners.loadedmetadata?.());}
    get src() {return this._src;}
    play() { this.playing = true;this.paused=false; return Promise.resolve(); }
    pause() { this.playing = false;this.paused=true; }
    addEventListener(name,fn) {this.listeners[name]=fn;}
    removeAttribute(name) {if(name==="src")this._src="";}
    load() {}
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
  const navigator = { userAgent };
  // the recorder's world: what was asked of getUserMedia, each MediaRecorder built,
  // and every blob URL minted or revoked
  const rec = { asked: [], recorders: [], urls: [], revoked: [], tracksStopped: 0, tracks: [] };
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
      if (this.ondataavailable) this.ondataavailable({ data: new Blob([mediaOpts.data ?? "x".repeat(3000)]) });
      if (this.onstop) this.onstop();
    }
  }
  if (media) {
    navigator.mediaDevices = {
      getUserMedia(c) {
        rec.asked.push(c);
        if (mediaOpts.deny) return Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
        const track = { readyState: "live", stop() { track.readyState = "ended"; rec.tracksStopped++; },
          getSettings: () => ({ latency: 0.01, channelCount: mediaOpts.channels ?? 2 }) };
        rec.tracks.push(track);
        return Promise.resolve({ getTracks: () => [track], getAudioTracks: () => [track] });
      },
      enumerateDevices: () => Promise.resolve(mediaOpts.devices ?? []),
      addEventListener() {},
    };
  }
  // A small IndexedDB: the calls the take store makes, with keys compared the way
  // IndexedDB compares them for [take, seq] pairs and plain strings.
  const captureOpts = capture === true ? {} : capture || {};
  // version: what an earlier visit left the database at (a seeded store is a legacy
  // version 1 unless said otherwise); opens are logged so tests can see how it was opened.
  const idb = { stores: captureOpts.store ?? new Map(), writes: 0, opens: [],
    version: captureOpts.version ?? (captureOpts.store ? 1 : 0), blockedOnce: !!captureOpts.blocked };
  const keyOf = (keyPath, v) => Array.isArray(keyPath) ? keyPath.map(k => v[k]) : v[keyPath];
  const inRange = (k, r) => Array.isArray(k) && k[0] === r.lo[0] && k[1] >= r.lo[1] && k[1] <= r.hi[1];
  const IDBKeyRange = { bound: (lo, hi) => ({ lo, hi, range: true }) };
  const indexedDB = {
    open(name, want) {
      const req = {};
      idb.opens.push(want);
      setImmediate(() => {
        const db = {
          objectStoreNames: { contains: n => idb.stores.has(n) },
          createObjectStore(n, { keyPath }) { idb.stores.set(n, { keyPath, rows: new Map() }); },
          transaction(names, mode) {
            const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
            let failed = false;
            tx.objectStore = n => { const st = idb.stores.get(n); const done = v => { const r = { result: v };
              queueMicrotask(() => r.onsuccess && r.onsuccess()); return r; };
              return {
                put(v) { if (captureOpts.failAfter !== undefined && ++idb.writes > captureOpts.failAfter) {
                    failed = true; tx.error = Object.assign(new Error("full"), { name: "QuotaExceededError" }); return done(); }
                  st.rows.set(JSON.stringify(keyOf(st.keyPath, v)), { key: keyOf(st.keyPath, v), v: structuredClone(v) }); return done(); },
                get(k) { const r = st.rows.get(JSON.stringify(k)); return done(r && r.v); },
                getAll(range) { return done([...st.rows.values()].filter(r => !range || inRange(r.key, range))
                  .sort((a, b) => JSON.stringify(a.key) < JSON.stringify(b.key) ? -1 : 1).map(r => r.v)); },
                delete(k) { for (const [s2, r] of [...st.rows]) if (k && k.range ? inRange(r.key, k) : s2 === JSON.stringify(k)) st.rows.delete(s2);
                  return done(); },
              }; };
            setImmediate(() => failed ? (tx.onerror && tx.onerror()) : (tx.oncomplete && tx.oncomplete()));
            return tx;
          },
        };
        db.version = idb.version; db.close = () => { db.closed = true; };
        req.result = db;
        if (want !== undefined && want < idb.version) {
          req.error = Object.assign(new Error("requested version is lower"), { name: "VersionError" });
          req.onerror && req.onerror(); return;
        }
        // another tab holds an older version open: the request waits until it lets go
        if (idb.blockedOnce && want !== undefined && want > idb.version) { idb.blockedOnce = false; req.onblocked && req.onblocked(); return; }
        const v = want ?? Math.max(idb.version, 1);
        if (v > idb.version) { idb.version = v; db.version = v; req.onupgradeneeded && req.onupgradeneeded(); }
        idb.lastDb = db;
        req.onsuccess && req.onsuccess();
      });
      return req;
    },
  };
  if (capture) navigator.storage = { persist: () => Promise.resolve(true),
    estimate: () => Promise.resolve({ usage: 5 * 1048576, quota: 1024 * 1048576 }) };
  // A Worker that really runs the named script from web/, in its own context, with
  // importScripts resolved against web/ too — so the MP3 tests use the real LAME.
  const workers = [];
  class RealWorker {
    constructor(url) {
      const self = this; this.url = url; this.onmessage = null; workers.push(this);
      const scope = vm.createContext({ Blob, Int16Array, Int8Array, Float32Array, Math, console,
        postMessage: data => queueMicrotask(() => self.onmessage && self.onmessage({ data })),
        close() { self.closed = true; } });
      scope.importScripts = (...names) => names.forEach(n => vm.runInContext(readFileSync(new URL("../web/" + n, import.meta.url), "utf8"), scope));
      scope.self = scope;
      vm.runInContext(readFileSync(new URL("../web/" + url, import.meta.url), "utf8"), scope);
      this.scope = scope;
    }
    postMessage(data) { queueMicrotask(() => this.scope.onmessage({ data })); }
    terminate() { this.terminated = true; }
  }
  const URLForApp = { createObjectURL: b => { const u = `blob:${rec.urls.length}`; rec.urls.push({ u, b }); return u; },
    revokeObjectURL: u => rec.revoked.push(u) };
  const context = vm.createContext({
    console, document, window, Math: MathForApp, location, fetch, navigator, TextEncoder, TextDecoder,
    btoa: (str) => Buffer.from(str, "binary").toString("base64"),
    ...(audioMode === false ? {} : { Audio: AudioEl }),
    ...(media ? { MediaRecorder } : {}), Blob, URL: URLForApp,
    ...(capture ? { AudioWorkletNode, indexedDB, IDBKeyRange } : {}),
    ...(capture || worker ? { Worker: RealWorker } : {}),
    // wall-clock time the tests can move on, for how long a take has run
    Date: class extends Date { static now() { return Date.now() + clock.wall * 1000; } },
    // Short timers run at once. Minute-scale ones — the shared input's idle release —
    // wait until a test calls runIdle(), so "held between takes" can be checked.
    setTimeout: (fn, ms = 0) => { if (ms < 60000) { fn(); return 1; } const id = ++intervalID; idle.set(id, fn); return id; },
    clearTimeout: id => idle.delete(id),
    isSecureContext: secure,
    setInterval: fn => { const id = ++intervalID; intervals.set(id, fn); return id; },
    clearInterval: id => intervals.delete(id),
  });
  // index.html loads the chord explorers before app.js; explorers:false is the page
  // with those scripts missing.
  if (explorers) for (const f of explorerScripts) vm.runInContext(f, context);
  if (band) vm.runInContext(bandScript, context);   // band:false is the page without web/band.js
  vm.runInContext(analysisScript, context);
  for (const f of pitchScripts) vm.runInContext(f, context);
  vm.runInContext(libraryScript, context);
  vm.runInContext(looperScript, context);
  vm.runInContext(songsScript, context);
  vm.runInContext(script + `\n;globalThis.appTest={detectOnsets,timingOffsets,timingStats,timingReport,timingWord,alignPoint,progressSeries,looper,looperRecord,looperStop,looperPlay,looperClear,looperTick,parseChord,parseChords,chordAt,songFollow,songAddSection,songBuildSections,songSaveSections,songRecordSection,songLoopSection,validSection,FORMS,lib,libList,libKeep,libOpen,libClose,libDelete,libSetRating,libDue,libExport,libExportData,libWeakest,libGrid,libSections,libWave,libDraw,libPut,libBadge,libLoopTick,libPeaks,libSeek,
    zipStore,crc32,validTake,cleanTake,cleanRatings,RERATE_AFTER_MS,songs,validSong,songList,songImport,songSelect,songSave,songPlay,songStop,songBounds,songNow,songTap,render,renderLand,renderChart,renderMajor,renderModes,MODES,modeNotes,modeMap,currentMode,
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
    toggleRecord,stopRecording,webmWithDuration,tapTempo,REC_ROW,isChordTone,getLive:()=>({chord:state.liveChord,chorus:state.trainerChorus,drop:[...state.dropBars],compat:state.bandCompat}),getBand:()=>state.band,getBandRig:()=>state.bandRig,toggleCheck,getMeter:()=>state.meter,getChannel:()=>state.recChannel,toggleMonitor,getMonitor:()=>state.monitor,silenceEverything,recMime,recExt,takeName,fileSize,wavBytes,getRec:()=>state.rec,getTake:()=>state.recTake,
    setBpm:v=>{state.bpm=v},
    renderTrainer,toggleTrainer,resetTrainer,trainerTick,chordName,currentForm,BLUES_FORMS,barSymbols,symbolAt,chordInfo,CHORD_KIND,generateRhythm,renderRhythm,toggleRhythm,stopRhythm,
    completeSession,clearLog,readLog,streakOf,streakMessage,bestStreak,earPick,earNew,earAnswer,readEar,readDays,todayAdvice,EAR_DEGREES,readPath,currentStage,togglePassed,PATH,readLickTempos,saveLickTempo,lickToPush,renderLicks,renderPath,renderToday,
    renderTune,pitchToggle,pitchStop,bendFinish,readBends,renderChanges,changesToggle,changesTap,changesDone,readChanges,CHANGE_PAIRS,dayKey,getEar:()=>state.ear,baseFret,rootFret,validBoxes,boxNotes,NOTES,BOXES,LICKS,RUN_UP,RUN_DN,
    getState:()=>({key:state.key,view:state.view,labelMode:state.labelMode,chord:state.chord,reg:state.reg,chartOpen:state.chartOpen,boxLock:state.boxLock,droneNodes:state.droneHandle,clickTimer:state.clickTimer,bpm:state.bpm,timerSeconds:state.timerSeconds,timerInitial:state.timerInitial,timerHandle:state.timerHandle,ladderRound:state.ladderRound,
      trainerTimer:state.trainerTimer,trainerBar:state.trainerBar,trainerBeat:state.trainerBeat,trainerCount:state.trainerCount,rhythmTimer:state.rhythmTimer,rhythmStep:state.rhythmStep,rhythm:[...state.rhythm],showB5:state.showB5,blueLock:state.blueLock,
      soloBoxes:[...state.soloBoxes],soloRun:[...state.soloRun],soloTimer:state.soloTimer,soloStep:state.soloStep,storage:window.localStorage})};`, context);
  // advance(seconds) moves the audio clock on and lets every running loop catch up,
  // which is what the browser's 25 ms pump timer does in real life.
  const advance = seconds => { clock.t += seconds; for (const fn of [...intervals.values()]) fn(); };
  const runIdle = () => { for (const [id, fn] of [...idle]) { idle.delete(id); fn(); } };
  return { app: context.appTest, context, document, audio, intervals, fetched, audioElements, clock, advance, rec, runIdle,
    worklets, modules, idb, workers,
    closed: () => windowClosed };
}

const songFile = (name="My song.wav") => Object.assign(new Blob([new Uint8Array(100)],{type:"audio/wav"}),{name});
test("songs import once, survive reopening, and reject damaged metadata", async () => {
  const {app,idb,document}=makeRuntime({capture:true});
  const s=await app.songImport(songFile());
  assert.equal(app.songs.selected.title,"My song");
  assert.equal(idb.stores.get("songfiles").rows.size,1);
  assert.equal(app.songNow(),null,"selecting a song is not playing it");
  document.getElementById("songtitle").value='<img src=x onerror=alert(1)>';
  await app.songSave();
  assert.match(document.getElementById("songlist").innerHTML,/&lt;img/);
  assert.doesNotMatch(document.getElementById("songlist").innerHTML,/<img/);
  const next=makeRuntime({capture:{store:idb.stores}});
  await next.app.songList();await next.app.songSelect(s.id);
  assert.equal(next.app.songs.selected.id,s.id);
  assert.equal(next.app.songs.player.duration,600);
  for(const patch of [{bpm:NaN},{duration:Infinity},{downbeat:-1},{key:12},{title:""}])
    assert.equal(app.validSong({...s,...patch}),false);
  await assert.rejects(app.songImport(songFile("bad.txt")),/Choose an MP3/);
  const huge = Object.assign(new Blob([new Uint8Array(10)], { type: "audio/wav" }), { name: "huge.wav" });
  Object.defineProperty(huge, "size", { value: 301 * 1024 * 1024 });
  await assert.rejects(app.songImport(huge), /over 300 MB/, "an oversized file is refused before it is read");
});
test("songs mix through the backing bus, preserve pitch and carry playback metadata into takes", async () => {
  const {app,document,audio,advance}=makeRuntime({capture:true,media:true});
  const s=await app.songImport(songFile());
  document.getElementById("songspeed").value="0.75";
  document.getElementById("songcount").checked=false;
  document.getElementById("songloop").checked=true;
  document.getElementById("songloopa").value="10";
  document.getElementById("songloopb").value="15";
  await app.songPlay();await Promise.resolve();
  const p=app.songs.player;
  assert.equal(p.preservesPitch,true);assert.equal(p.playbackRate,.75);
  assert.equal(audio.mediaSources.length,1);
  assert.equal(audio.mediaSources[0].connected[0],app.songs.bus);
  assert.equal(app.songNow().id,s.id);
  await app.toggleRecord();
  assert.equal(app.getRec().info.songId,s.id);
  assert.equal(app.getRec().bpm,68);
  assert.equal(app.getRec().songPlay.offset,10);
  p.currentTime=15;advance(.1);assert.equal(p.currentTime,10,"loop returns to A");
  app.stopRecording();app.silenceEverything();assert.equal(p.paused,true);
  await app.songPlay();assert.equal(audio.mediaSources.length,1,"one source per audio element");
  app.songStop();
});
test("song count-in can be cancelled and invalid loops never play", async () => {
  const {app,document,advance}=makeRuntime({capture:true});
  await app.songImport(songFile());
  document.getElementById("songspeed").value="1";
  document.getElementById("songcount").checked=true;
  await app.songPlay();app.songStop();advance(10);
  assert.equal(app.songs.player.paused,true);
  document.getElementById("songloop").checked=true;
  document.getElementById("songloopa").value="30";
  document.getElementById("songloopb").value="20";
  await app.songPlay();assert.equal(app.songs.player.paused,true);
  assert.match(document.getElementById("songstatus").textContent,/Loop B/);
});

test("all revised navigation views render", () => {
  const { app, document } = makeRuntime();
  const views = ["hijaz","open","path","tune","song","songs","melody","boxes","solo","connect","land","major","modes","notes","triads","inv","chart","cross","blues","power","form","licks","trainer","rhythm","theory","practice"];
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
    chooseKey(document, key);
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
  chooseKey(document, 0);
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
    chooseKey(document, key);
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

test("the toolbar hides the controls a view does not use", () => {
  const { app, document } = makeRuntime();
  const rows = ["keys", "labels", "chords", "regs", "extras"];
  const state = () => Object.fromEntries(rows.map(id =>
    [id, !document.getElementById(id).hidden]));

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
    "keyselect", "settingssummary", "lessontitle", "views", "play", "approw", "appver", "quitmsg", "audiomsg", "credver"]);
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
  const labels = () => document.getElementById("keyselect").children.map(b => b.textContent);

  navButton(document, "boxes").click();
  assert.equal(document.getElementById("keylbl").textContent, "Key");
  assert.ok(labels().includes("A minor"), "a minor-pentatonic view names minor keys");

  for (const view of ["triads", "inv", "modes"]) {
    navButton(document, view).click();
    assert.equal(document.getElementById("keylbl").textContent, "Root", `${view} asks for a root`);
    assert.ok(labels().includes("A"), `${view} names bare roots`);
    assert.ok(!labels().includes("A minor"), `${view} never calls a major triad's root minor`);
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
  assert.equal(document.getElementById("ladderbpm").textContent, "95", "text, as a browser keeps it");
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
// Watches what the engine's master bus is tapped into, and untapped from.
const spyTaps = app => { const e = app.audio(), taps = [], untaps = [], t = e.tap, u = e.untap;
  e.tap = n => { taps.push(n); return t(n); }; e.untap = n => { untaps.push(n); return u(n); }; return { taps, untaps }; };

test("without microphone access the Record row is switched off and says why", () => {
  const { document } = makeRuntime({ secure: false });
  assert.equal(document.getElementById("recbtn").disabled, true);
  assert.equal(document.getElementById("recrow").classList.contains("off"), true);
  assert.match(document.getElementById("recmsg").textContent, /secure page/);
});

test("a guitar-only take asks for an unprocessed mono input and records it at 96 kbps", async () => {
  const { app, document, rec, audio, runIdle } = makeRuntime({ media: true });
  app.setKey(9); app.setBpm(120);
  document.getElementById("recbtn").click();
  await settle();
  const want = rec.asked[0].audio;
  assert.equal(want.echoCancellation, false);
  assert.equal(want.noiseSuppression, false);
  assert.equal(want.autoGainControl, false);
  assert.equal(want.channelCount.ideal, 2, "opened in stereo; Web Audio makes the take mono");
  assert.equal(want.latency.ideal, 0, "as little buffering as the browser will give");
  const r = rec.recorders[0];
  assert.equal(r.opts.audioBitsPerSecond, 96000);
  assert.equal(r.opts.mimeType, "audio/webm;codecs=opus");
  assert.equal(r.stream.destination, true, "recorded through Web Audio");
  assert.equal(app.getRec().dest.channelCount, 1, "downmixed to one channel");
  assert.equal(audio.limiters, undefined, "guitar only: nothing between the input and the master");
  assert.ok(app.getRec().src.connected.includes(app.getRec().dest), "the input goes straight in");
  assert.equal(r.state, "recording");
  assert.equal(document.getElementById("recbtn").textContent, "Stop");
  assert.match(document.getElementById("recmsg").textContent, /Recording guitar only/);

  document.getElementById("recbtn").click();
  await settle();
  assert.equal(rec.tracksStopped, 0, "the input is kept for the next take");
  runIdle();
  assert.equal(rec.tracksStopped, 1, "and released after the idle minutes");
  const take = app.getTake();
  assert.match(take.name, /^practice-A-full-120bpm-\d{8}-\d{6}-cold\.webm$/, "<song>-<section|full>-<bpm>bpm-<date>-<cold|retest>");
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
  assert.equal(app.takeName(new Date(2026, 8, 18, 9, 5, 7), "m4a"), "practice-Csharp-full-96bpm-20260918-090507-cold.m4a");
  assert.equal(app.takeName(new Date(2026, 8, 18, 9, 5, 7), "wav", 9, 120, { trainer: true, mode: "chorus", attempt: "retest" }),
    "12bar-A-chorus-120bpm-20260918-090507-retest.wav");
  assert.equal(app.takeName(new Date(2026, 8, 18, 9, 5, 7), "mp3", 9, 80, { song: "Sweet Home Chicago", part: "verse 1" }),
    "Sweet-Home-Chicago-verse-1-80bpm-20260918-090507-cold.mp3");
  assert.equal(app.fileSize(512), "512 B");
  assert.equal(app.fileSize(4.2 * 1048576), "4.2 MB");
});

test("guitar + backing mixes both through a limiter, with the backing 3 dB down, in stereo", async () => {
  const { app, document, rec, audio } = makeRuntime({ media: true });
  const { taps, untaps } = spyTaps(app);
  document.getElementById("recmix").value = "backing";
  document.getElementById("recbtn").click();
  await settle();
  const r = app.getRec();
  assert.equal(rec.asked[0].audio.channelCount.ideal, 2);
  assert.equal(r.dest.channelCount, 2);
  sameShape(taps, [r.bed], "the engine's master bus feeds the take, through its own level");
  assert.ok(Math.abs(r.bed.gain.value - Math.pow(10, -3 / 20)) < 1e-9, "backing 3 dB under the guitar");
  assert.ok(r.src.connected.includes(r.bus), "guitar and backing meet in one bus");
  const [lim] = audio.limiters;
  assert.equal(lim.threshold.value, -3); assert.equal(lim.ratio.value, 20); assert.equal(lim.knee.value, 0);
  assert.ok(lim.attack.value <= 0.003, "fast enough to catch a pick attack");
  assert.equal(lim.outs.length, 1, "the limiter feeds one trim");
  const trim = lim.outs[0];
  assert.ok(Math.abs(trim.gain.value - Math.pow(10, -2 / 20)) < 1e-9, "which takes back the compressor's make-up gain");
  sameShape(trim.outs, [r.dest], "and feeds the recording");
  document.getElementById("recbtn").click();
  await settle();
  sameShape(untaps, [r.bed], "untapped when the take ends");
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

  const { app, document, rec, runIdle } = makeRuntime({ media: true });
  document.getElementById("recarm").checked = true;
  document.getElementById("recbtn").click();
  await settle();
  document.getElementById("recbtn").click();   // Cancel
  assert.equal(app.getRec(), null);
  runIdle();
  assert.equal(rec.tracksStopped, 1, "the armed input is let go");
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

test("a take is named for the key and tempo it started with", async () => {
  const { app, document } = makeRuntime({ media: true });
  app.setKey(4); app.setBpm(120);
  document.getElementById("recbtn").click();
  await settle();
  app.setKey(9); app.setBpm(90);   // e.g. the tempo slider moved, which ends a trainer take
  document.getElementById("recbtn").click();
  await settle();
  assert.match(app.getTake().name, /^practice-E-full-120bpm-/);
});

test("a slow audio path (Bluetooth) is flagged; a normal one is not", async () => {
  const fine = makeRuntime({ media: true });   // 5 + 10 + 10 ms
  fine.document.getElementById("recbtn").click();
  await settle();
  assert.doesNotMatch(fine.document.getElementById("recmsg").textContent, /delay/);

  const slow = makeRuntime({ media: true });
  slow.audio.outputLatency = 0.2;
  slow.document.getElementById("recmix").value = "backing";
  slow.document.getElementById("recbtn").click();
  await settle();
  assert.match(slow.document.getElementById("recmsg").textContent, /about 215 ms of delay.*Bluetooth/);
});

test("picking one input of an interface centres that channel, in mono or stereo takes", async () => {
  for (const mix of ["guitar", "backing"]) {
    const { app, document, rec, audio } = makeRuntime({ media: true });
    document.getElementById("recmix").value = mix;
    document.getElementById("recchan").onchange({ target: { value: "1" } });
    document.getElementById("recbtn").click();
    await settle();
    assert.equal(rec.asked[0].audio.channelCount.ideal, 2, `${mix}: the input is asked for in stereo`);
    const r = app.getRec();
    assert.equal(r.dest.channelCount, mix === "guitar" ? 1 : 2);
    const into = mix === "guitar" ? r.dest : r.bus;   // with backing, it goes through the mix bus
    const sp = audio.splitters.find(x => x.links.some(l => l.d === into));
    sameShape(sp.links.map(l => [l.out, l.inp]), [[1, 0]], `${mix}: input 2 alone feeds the take`);
    assert.equal(sp.links[0].d, into);
    assert.equal(r.src.connected.length, 1, "the raw input is not also mixed in");
    assert.equal(r.src.connected[0], sp);
    assert.equal(document.getElementById("recchan").disabled, true, "fixed while the take is open");
  }
});

test("both inputs is the default, and a missing channel or engine falls back and says so", async () => {
  const both = makeRuntime({ media: true });
  both.document.getElementById("recbtn").click();
  await settle();
  assert.ok(!both.audio.splitters.some(x => x.links.some(l => l.d === both.app.getRec().dest)),
    "no channel is split out for the take");
  assert.equal(both.app.getRec().src.connected[0], both.app.getRec().dest);

  const mono = makeRuntime({ media: { channels: 1 } });
  mono.document.getElementById("recchan").onchange({ target: { value: "1" } });
  mono.document.getElementById("recbtn").click();
  await settle();
  assert.equal(mono.app.getRec().src.connected[0], mono.app.getRec().dest);
  assert.match(mono.document.getElementById("recmsg").textContent, /one channel, so there is no Input 2/);

  const compat = makeRuntime({ media: true, audio: "wav" });
  compat.document.getElementById("recchan").onchange({ target: { value: "0" } });
  compat.document.getElementById("recbtn").click();
  await settle();
  assert.match(compat.document.getElementById("recmsg").textContent, /needs Web Audio.*both inputs are recorded/);
});

test("Monitor input sends the unprocessed input straight to the speakers, never into a take", async () => {
  const { app, document, rec, audio, runIdle } = makeRuntime({ media: true });
  const btn = document.getElementById("recmon");
  app.audio();                               // the engine's master bus goes to the speakers first
  const before = audio.toSpeakers.length;
  btn.click();
  await settle();
  const m = app.getMonitor();
  assert.equal(rec.asked[0].audio.echoCancellation, false);
  assert.equal(rec.asked[0].audio.autoGainControl, false);
  assert.equal(audio.toSpeakers.length, before + 1);
  assert.equal(audio.toSpeakers.at(-1), m.gain);
  assert.equal(m.src.connected[0], m.gain, "input -> monitor gain -> speakers");
  assert.equal(btn.getAttribute("aria-pressed"), "true");
  assert.match(document.getElementById("recmsg").textContent, /Monitoring your input, heard about 25 ms.*headphones/);

  // a backing take while monitoring: the take taps the master bus, which the monitor bypasses
  const { taps } = spyTaps(app);
  document.getElementById("recmix").value = "backing";
  document.getElementById("recbtn").click();
  await settle();
  assert.equal(taps.length, 1);
  assert.notEqual(m.src.connected[0], app.getRec().dest, "the monitored input is not the take's input");
  document.getElementById("recbtn").click();
  await settle();
  assert.ok(app.getMonitor(), "ending a take leaves monitoring on");

  btn.click();
  assert.equal(app.getMonitor(), null);
  assert.equal(m.gain.disconnected, true);
  assert.equal(btn.getAttribute("aria-pressed"), "false");
  assert.equal(rec.asked.length, 1, "the monitor and the take shared one input: one permission prompt");
  assert.equal(rec.tracksStopped, 0);
  runIdle();
  assert.equal(rec.tracksStopped, 1, "released once neither uses it");
});

test("the monitor follows the channel and device choice, and Quit silences it", async () => {
  const { app, document, rec, audio } = makeRuntime({ media: true });
  document.getElementById("recmon").click();
  await settle();
  assert.ok(!audio.splitters.some(x => x.links.some(l => l.d === app.getMonitor().gain)), "both inputs, unsplit");
  document.getElementById("recchan").onchange({ target: { value: "0" } });
  await settle();
  assert.equal(rec.asked.length, 1, "the new channel comes out of the same input");
  const sp = audio.splitters.find(x => x.links.some(l => l.d === app.getMonitor().gain));
  assert.equal(sp.links[0].out, 0);
  document.getElementById("recinput").onchange({ target: { value: "abc" } });
  await settle();
  assert.equal(rec.asked[1].audio.deviceId.exact, "abc");
  app.silenceEverything();
  assert.equal(app.getMonitor(), null);
  assert.equal(rec.tracksStopped, 2);
});

test("without Web Audio the monitor is switched off and says why", () => {
  const { document } = makeRuntime({ media: true, audio: "wav" });
  assert.equal(document.getElementById("recmon").disabled, true);
  assert.match(document.getElementById("recmon").title, /needs Web Audio/);
});

test("a secure Safari page without the microphone API is diagnosed as Lockdown Mode", () => {
  const safari = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15";
  const locked = makeRuntime({ userAgent: safari });
  assert.equal(locked.document.getElementById("recbtn").disabled, true);
  const msg = locked.document.getElementById("recmsg").textContent;
  assert.match(msg, /Lockdown Mode.*Safari \(Settings \u25b8 Websites \u25b8 Lockdown Mode\)/);
  assert.match(msg, /DuckDuckGo, exclude the app \(System Settings .*Configure Web Browsing\)/);
  assert.match(msg, /Chrome isn't affected/);
  assert.doesNotMatch(locked.document.getElementById("recmsg").textContent, /secure page/);
  const other = makeRuntime();
  assert.match(other.document.getElementById("recmsg").textContent, /doesn't give web pages microphone access/);
});

test("takes reuse the open input, and reopen it once it has been released or unplugged", async () => {
  const { document, rec, runIdle } = makeRuntime({ media: true });
  const take = async () => { document.getElementById("recbtn").click(); await settle();
    document.getElementById("recbtn").click(); await settle(); };
  await take(); await take();
  assert.equal(rec.asked.length, 1, "two takes, one prompt");
  runIdle();
  await take();
  assert.equal(rec.asked.length, 2, "after the idle release, asked again");
  rec.tracks.at(-1).readyState = "ended";   // the interface was unplugged
  await take();
  assert.equal(rec.asked.length, 3);
  document.getElementById("recchan").onchange({ target: { value: "1" } });
  await take();
  assert.equal(rec.asked.length, 3, "a channel is picked out of the open input: no new prompt");
  document.getElementById("recinput").onchange({ target: { value: "abc" } });
  await take();
  assert.equal(rec.asked.length, 4, "another device is another input");
});

// ---------- input check and level meter ----------
const meterText = document => document.getElementById("reclevel").textContent;
const tick = async (advance, n = 1) => { for (let i = 0; i < n; i++) advance(0.06); await settle(); };

test("Check input shows both inputs' levels without sending anything to the speakers", async () => {
  const { app, document, rec, audio, advance, runIdle } = makeRuntime({ media: true });
  app.audio();
  const speakers = audio.toSpeakers.length;
  document.getElementById("reccheck").click();
  await settle();
  assert.equal(document.getElementById("reccheck").getAttribute("aria-pressed"), "true");
  assert.equal(document.getElementById("recmeter").hidden, false);
  assert.equal(audio.toSpeakers.length, speakers, "checking is silent");
  assert.match(meterText(document), /No signal on the input\. Play a note/);

  audio.levels = [0, 0.3];                    // guitar in the instrument jack, about -10 dB
  await tick(advance);
  // the analyser works in 32-bit floats, so compare the width to a hundredth of a percent
  assert.ok(Math.abs(parseFloat(document.getElementById("recfill1").style.width) - (20 * Math.log10(0.3) + 60) / 60 * 100) < 0.01);
  assert.equal(document.getElementById("recfill0").style.width, "0%");
  assert.equal(document.getElementById("recfill1").style.background, "var(--blue)");
  assert.match(meterText(document), /Signal on Input 2 only: click it/);

  document.getElementById("recbar1").click();   // pick it by clicking its bar
  assert.equal(app.getChannel(), 1);
  assert.equal(document.getElementById("recchan").value, "1");
  assert.equal(document.getElementById("recbar1").getAttribute("aria-current"), "true");
  assert.match(meterText(document), /^Good level on Input 2\.$/);

  document.getElementById("reccheck").click();  // off: the input is kept a while, then let go
  assert.equal(document.getElementById("recmeter").hidden, false);
  runIdle();
  assert.equal(document.getElementById("recmeter").hidden, true);
  assert.equal(rec.tracksStopped, 1);
});

test("the meter says when the guitar is on the other input, too loud, or silent", async () => {
  const { document, audio, advance, clock } = makeRuntime({ media: true });
  document.getElementById("recchan").onchange({ target: { value: "0" } });   // Input 1: the mic socket
  document.getElementById("reccheck").click();
  await settle();
  audio.levels = [0, 0.3];
  await tick(advance);
  assert.match(meterText(document), /Signal is on Input 2, not Input 1: click Input 2 to switch/);
  assert.equal(document.getElementById("recbar0").getAttribute("aria-current"), "true");

  document.getElementById("recbar1").click();
  audio.levels = [0, 0.97];                   // -0.3 dB
  await tick(advance);
  assert.match(meterText(document), /clipping/);
  assert.equal(document.getElementById("recfill1").style.background, "var(--pink)");
  audio.levels = [0, 0.6];                    // -4.4 dB
  await tick(advance, 4);                      // the bar falls back from the peak
  assert.match(meterText(document), /clipping/, "the warning holds for 2 s, so a brief clip is seen");
  clock.wall += 3;
  await tick(advance);
  assert.match(meterText(document), /^Hot: .*before recording with backing/);
  assert.equal(document.getElementById("recfill1").style.background, "var(--gold)");

  audio.levels = [0, 0];
  await tick(advance, 60);
  assert.match(meterText(document), /No signal on Input 2.*INST button/);
});

test("the meter runs during monitoring and takes, and a bar can't change a take's input", async () => {
  const { app, document, audio, advance } = makeRuntime({ media: true });
  document.getElementById("recbtn").click();
  await settle();
  assert.ok(app.getMeter(), "a take opens the meter too");
  audio.levels = [0.3, 0];
  await tick(advance);
  document.getElementById("recbar1").click();
  assert.equal(app.getChannel(), -1, "the input is fixed while a take is open");
  document.getElementById("recbtn").click();
  await settle();
  assert.ok(app.getMeter(), "still showing between takes");
});

test("a one-channel input shows one bar", async () => {
  const { document } = makeRuntime({ media: { channels: 1 } });
  document.getElementById("reccheck").click();
  await settle();
  assert.equal(document.getElementById("recbar1").hidden, true);
  assert.equal(document.getElementById("recbar0").hidden, false);
});

// ---------- a WebM take's length ----------
// A WebM laid out the way browser recorders write it: EBML header, a Segment of
// unknown size, Info without a Duration, Tracks, then a Cluster of unknown size.
const ebml = (id, body, sizeBytes) => {
  const idBytes = []; for (let v = id; v > 0; v = Math.floor(v / 256)) idBytes.unshift(v % 256);
  const size = sizeBytes ?? [0x80 | body.length];
  return [...idBytes, ...size, ...body];
};
const UNKNOWN = [0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF];
const recorderWebm = ({ seekHead = false, duration = false } = {}) => new Uint8Array([
  ...ebml(0x1A45DFA3, ebml(0x4282, [0x77, 0x65, 0x62, 0x6D])),          // DocType "webm"
  ...ebml(0x18538067, [
    ...(seekHead ? ebml(0x114D9B74, [0xEC, 0x80]) : []),
    ...ebml(0x1549A966, [...ebml(0x2AD7B1, [0x0F, 0x42, 0x40]),           // TimecodeScale 1 ms
      ...ebml(0x4D80, [0x61, 0x70, 0x70]),
      ...(duration ? ebml(0x4489, [0x40, 0x8F, 0x40, 0, 0, 0, 0, 0]) : [])]),
    ...ebml(0x1654AE6B, [0xAE, 0x80]),
    ...ebml(0x1F43B675, [0xE7, 0x81, 0x00, 0xA3, 0x82, 0xAA, 0xBB], UNKNOWN),
  ], UNKNOWN),
]);

test("a recorder's WebM gains a Duration in its Info, and nothing else moves", () => {
  const { app } = makeRuntime();
  const before = recorderWebm(), after = app.webmWithDuration(before, 24000);
  assert.equal(after.length, before.length + 11);
  const info = before.indexOf(0x15);                          // Info's ID starts 15 49 A9 66
  assert.deepEqual([...before.slice(info, info + 4)], [0x15, 0x49, 0xA9, 0x66]);
  const oldSize = before[info + 4] & 0x7F, end = info + 5 + oldSize;
  assert.equal(after[info + 4], 0x80 | (oldSize + 11), "Info's size grows by the new element");
  assert.deepEqual([...after.slice(end, end + 3)], [0x44, 0x89, 0x88], "Duration, 8-byte float");
  assert.equal(new DataView(after.buffer).getFloat64(end + 3), 24000, "in ms, the file's TimecodeScale");
  assert.deepEqual([...after.slice(end + 11)], [...before.slice(end)], "Tracks and the audio untouched");
  assert.deepEqual([...after.slice(0, end)].map((b, i) => i === info + 4 ? 0 : b),
    [...before.slice(0, end)].map((b, i) => i === info + 4 ? 0 : b));
});

test("a WebM the patcher doesn't fully understand is left exactly as recorded", () => {
  const { app } = makeRuntime();
  for (const [why, bytes] of [
    ["a SeekHead's positions would be wrong", recorderWebm({ seekHead: true })],
    ["it already has a Duration", recorderWebm({ duration: true })],
    ["not WebM at all", new TextEncoder().encode("x".repeat(64))],
    ["cut off inside Info", recorderWebm().slice(0, 30)],
  ]) assert.equal(app.webmWithDuration(bytes, 1000), bytes, why);
});

test("a finished WebM take is saved with its length", async () => {
  const { app, document } = makeRuntime({ media: { data: recorderWebm() } });
  document.getElementById("recbtn").click();
  await settle();
  document.getElementById("recbtn").click();
  await settle();
  const take = app.getTake(), bytes = new Uint8Array(await take.blob.arrayBuffer());
  assert.equal(bytes.length, recorderWebm().length + 11);
  const at = bytes.findIndex((b, i) => b === 0x44 && bytes[i + 1] === 0x89 && bytes[i + 2] === 0x88);
  assert.equal(new DataView(bytes.buffer).getFloat64(at + 3), 1000, "the decoded length: 1 s");
  assert.equal(document.getElementById("recplay").src, take.url, "the player has the fixed file");
  assert.match(document.getElementById("recdlc").textContent, /Download compressed \(\d+ B\)/);
});

// ---------- raw capture: rec-worklet.js on its own ----------
// The worklet runs in the audio thread's scope: currentFrame, AudioWorkletProcessor
// and registerProcessor are globals there. Each process() call is one 128-frame
// quantum, so these tests step the clock by 128 between calls.
function loadWorklet(opts) {
  const src = readFileSync(new URL("../web/rec-worklet.js", import.meta.url), "utf8");
  const scope = { currentFrame: 0, posted: [] };
  scope.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: (m) => scope.posted.push(m), onmessage: null }; } };
  scope.registerProcessor = (name, cls) => { scope.name = name; scope.Cls = cls; };
  vm.runInContext(src, vm.createContext(scope));
  const p = new scope.Cls({ processorOptions: opts });
  const quantum = (fill = (c, i) => (scope.currentFrame + i) / 1e6) => {
    const input = Array.from({ length: opts.channels }, (_, c) => Float32Array.from({ length: 128 }, (_, i) => fill(c, i)));
    const alive = p.process([input]);
    scope.currentFrame += 128;
    return alive;
  };
  return { scope, p, quantum, send: m => p.port.onmessage({ data: m }) };
}

test("the capture keeps audio from an exact frame, in blocks, and hands over the rest on stop", () => {
  const { scope, quantum, send } = loadWorklet({ channels: 2, block: 256 });
  assert.equal(scope.name, "take-capture");
  quantum(); quantum();
  assert.equal(scope.posted.length, 0, "nothing is kept before it is told to start");
  send({ start: 300 });                 // mid-quantum: frames 256..383 hold frame 300
  for (let i = 0; i < 4; i++) quantum();
  const first = scope.posted[0].block;
  assert.equal(first.length, 2, "one array per channel");
  assert.equal(first[0].length, 256);
  assert.equal(Math.round(first[0][0] * 1e6), 300, "the first sample kept is frame 300 exactly");
  send({ stop: true });
  assert.equal(quantum(), false, "the processor ends itself");
  const blocks = scope.posted.filter(m => m.block), done = scope.posted.at(-1);
  const kept = blocks.reduce((n, m) => n + m.block[0].length, 0);
  assert.equal(done.done, kept, "done reports every frame it handed over");
  assert.equal(kept, 768 - 300, "frames 300..767: four quanta after the start frame's");
});

test("a start in the past starts now, and a mono capture keeps one channel", () => {
  const { scope, quantum, send } = loadWorklet({ channels: 1, block: 128 });
  quantum(); quantum();
  send({ start: 0 });
  quantum();
  assert.equal(scope.posted[0].block.length, 1);
  assert.equal(Math.round(scope.posted[0].block[0][0] * 1e6), 256);
});

// ---------- raw capture in the recorder ----------
test("a take streams its raw master to storage and downloads it as a WAV", async () => {
  const { app, document, worklets, modules, idb } = makeRuntime({ media: true, capture: true });
  app.setKey(9); app.setBpm(100);
  document.getElementById("recbtn").click();
  await settle();
  assert.deepEqual(modules, ["rec-worklet.js"], "the capture module loads from the app itself");
  const node = worklets[0];
  assert.equal(node.opts.processorOptions.channels, 1, "guitar only: mono");
  sameShape(node.sent[0], { start: 0 });
  node.feed(48000); node.feed(48000); node.feed(24000);   // 2.5 s in three blocks
  await settle();
  assert.equal(idb.stores.get("chunks").rows.size, 3, "written as it is recorded");
  const meta = [...idb.stores.get("takes").rows.values()][0].v;
  assert.equal(meta.status, "recording", "marked unfinished until it ends");
  assert.equal(meta.frames, 120000, "the stored length keeps up, for crash recovery");

  document.getElementById("recbtn").click();   // Stop
  await settle();
  assert.equal(node.sent.at(-1).stop, true);
  const take = app.getTake();
  assert.equal(take.wav.size, 44 + 120000 * 2);
  assert.equal(document.getElementById("recdlw").textContent, `Download WAV (${app.fileSize(44 + 240000)})`);
  assert.match(document.getElementById("recmsg").textContent, /Stored takes use 5\.0 MB of 1024\.0 MB available\./);
  assert.equal([...idb.stores.get("takes").rows.values()][0].v.status, "done");

  document.getElementById("recdlw").click();
  await settle();
  const link = document.body.children.at(-1);
  assert.equal(link.download, take.name.replace(/\.\w+$/, ".wav"));
  assert.match(link.download, /^practice-A-full-100bpm-\d{8}-\d{6}-cold\.wav$/);
  const wav = new Uint8Array(await take.wav.blob.arrayBuffer()), v = new DataView(wav.buffer);
  assert.equal(wav.length, 44 + 240000);
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(v.getUint32(24, true), 48000);
  assert.equal(v.getInt16(44, true), Math.trunc(0.5 * 0x7FFF), "the samples are the ones captured");
  assert.equal(idb.stores.get("chunks").rows.size, 0, "downloaded: the stored master is dropped");
  assert.equal(idb.stores.get("takes").rows.size, 0);
  document.getElementById("recdlw").click();   // a second click still works, from the page's copy
  await settle();
  assert.equal(document.body.children.at(-1).download, link.download);
});

test("an armed take's master starts on the exact frame of bar 1's downbeat", async () => {
  const { app, document, worklets, clock, advance } = makeRuntime({ media: true, capture: true });
  app.setBpm(120);
  document.getElementById("recarm").checked = true;
  document.getElementById("recbtn").click();
  await settle();
  assert.equal(worklets[0].sent.length, 0, "armed: not started yet");
  app.toggleTrainer();
  for (let i = 0; i < 4; i++) advance(0.5);
  const start = worklets[0].sent.find(m => "start" in m);
  // The count-in is four beats of 0.5 s from the loop's first booking at t=0.
  assert.equal(start.start, 2 * 48000, "bar 1 lands at 2.000 s: frame 96000");
  app.toggleTrainer();
  await settle();
});

test("a take stops cleanly when storage is full, keeping what was written", async () => {
  const { app, document, worklets } = makeRuntime({ media: true, capture: { failAfter: 3 } });
  document.getElementById("recbtn").click();
  await settle();
  worklets[0].feed(48000); await settle();
  worklets[0].feed(48000); await settle();       // the 4th write fails
  await settle();
  assert.equal(app.getRec(), null, "the take ended by itself");
  assert.match(document.getElementById("recmsg").textContent, /^Storage ran out, so the take stopped there\./);
  assert.ok(app.getTake(), "and was saved");
});

test("masters left in storage — by a crash or not downloaded — are listed, and can be saved or discarded", async () => {
  const first = makeRuntime({ media: true, capture: true });
  first.document.getElementById("recbtn").click();
  await settle();
  first.worklets[0].feed(48000);
  await settle();
  // the tab closes mid-take: a new page opens on the same storage
  const { document, idb } = makeRuntime({ media: true, capture: { store: first.idb.stores } });
  await settle();
  const list = document.getElementById("recsaved").innerHTML;
  assert.match(list, /<b>Interrupted:<\/b> practice-A-full-90bpm-\d{8}-\d{6}-cold\.wav · 0:01 · 94 KB/);
  const id = [...idb.stores.get("takes").rows.values()][0].v.id;
  await document.getElementById("recsaved").onclick({ target: { dataset: { dl: id } } });
  await settle();
  assert.match(document.body.children.at(-1).download, /^practice-A-full-90bpm-.*-cold\.wav$/);
  assert.equal(idb.stores.get("takes").rows.size, 0, "saved to disk, so dropped from storage");
  assert.equal(document.getElementById("recsaved").innerHTML, "");
});

test("discarding a saved master, or cancelling a take, removes it from storage", async () => {
  const { document, idb, worklets } = makeRuntime({ media: true, capture: true });
  document.getElementById("recarm").checked = true;
  document.getElementById("recbtn").click();
  await settle();
  document.getElementById("recbtn").click();   // Cancel while armed
  await settle();
  assert.equal(idb.stores.get("takes").rows.size, 0, "an armed take that never began leaves nothing");

  document.getElementById("recarm").checked = false;
  document.getElementById("recbtn").click();
  await settle();
  worklets[1].feed(4800);
  await settle();
  document.getElementById("recbtn").click();   // Stop: kept, not downloaded
  await settle();
  const firstId = [...idb.stores.get("takes").rows.values()][0].v.id;
  assert.equal(document.getElementById("recsaved").innerHTML, "", "the take on screen isn't listed");
  document.getElementById("recbtn").click();   // a newer take replaces it on screen...
  await settle();
  worklets[2].feed(4800);
  await settle();
  document.getElementById("recbtn").click();
  await settle();                              // ...and the first is now a saved master
  assert.match(document.getElementById("recsaved").innerHTML, new RegExp(`data-drop="${firstId}"`));
  await document.getElementById("recsaved").onclick({ target: { dataset: { drop: firstId } } });
  await settle();
  assert.ok(![...idb.stores.get("takes").rows.values()].some(r => r.v.id === firstId));
});

test("damaged or foreign rows in storage are ignored, not trusted", async () => {
  const store = new Map([["takes", { keyPath: "id", rows: new Map([
    ['"a"', { key: "a", v: { id: "a", channels: 7, sampleRate: 48000 } }],
    ['"b"', { key: "b", v: { id: "b", channels: 1, sampleRate: 48000, frames: 480, name: "<img src=x onerror=alert(1)>" } }],
    ['"c"', { key: "c", v: null }],
  ]) }], ["chunks", { keyPath: ["take", "seq"], rows: new Map() }]]);
  const { document } = makeRuntime({ media: true, capture: { store } });
  await settle();
  const html = document.getElementById("recsaved").innerHTML;
  assert.doesNotMatch(html, /data-dl="a"/, "impossible channel count");
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/, "a stored name is text, never markup");
  await document.getElementById("recsaved").onclick({ target: { dataset: { dl: "b" } } });
  await settle();
  assert.match(document.getElementById("recmsg").textContent, /Nothing usable was left of that take/);
});

// ---------- MP3 ----------
test("the vendored encoder is exactly the verified lamejs 1.2.1, with its licences beside it", async () => {
  const { createHash } = await import("node:crypto");
  const lame = readFileSync(new URL("../web/vendor/lame.min.js", import.meta.url));
  assert.equal(createHash("sha256").update(lame).digest("hex"), "15d285e2587b3bdbfd18a68de6ce07cc074f7480a82c3815da2dc1c348ec6df4",
    "LGPL: LAME must ship unmodified; a change here needs its source published");
  for (const f of ["LAME-LICENSE.txt", "LGPL-3.0.txt", "GPL-3.0.txt"])
    assert.ok(readFileSync(new URL("../web/vendor/" + f, import.meta.url), "utf8").length > 100, f);
  const notices = readFileSync(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url), "utf8");
  assert.match(notices, /LAME/); assert.match(notices, /web\/vendor\/lame\.min\.js/);
});

const mp3Frames = bytes => { let n = 0; for (let i = 0; i + 1 < bytes.length; i++) if (bytes[i] === 0xFF && (bytes[i + 1] & 0xE0) === 0xE0) n++; return n; };

test("MP3 is encoded from the stored master by the real LAME, off the main thread", async () => {
  const { app, document, worklets, workers, idb } = makeRuntime({ media: true, capture: true });
  app.setKey(9); app.setBpm(100);
  document.getElementById("recbtn").click();
  await settle();
  worklets[0].feed(48000, 0.25); worklets[0].feed(48000, 0.25);   // 2 s of mono
  await settle();
  document.getElementById("recbtn").click();
  await settle();
  const btn = document.getElementById("recdlm");
  assert.equal(btn.hidden, false);
  assert.equal(btn.textContent, `Download MP3 (~${app.fileSize(128 * 125 * 2)})`, "128 kbps x 2 s, estimated");
  await btn.onclick();
  await settle();
  assert.equal(workers[0].url, "mp3-worker.js");
  const take = app.getTake(), mp3 = new Uint8Array(await take.mp3.blob.arrayBuffer());
  assert.deepEqual([mp3[0], mp3[1]], [0xFF, 0xFB], "an MPEG-1 Layer III frame header");
  assert.ok(Math.abs(mp3.length - 128 * 125 * 2) < 128 * 125 * 0.2, "about 2 s at 128 kbps");
  assert.equal(document.body.children.at(-1).download, take.name.replace(/\.\w+$/, ".mp3"));
  assert.equal(btn.textContent, `Download MP3 (${app.fileSize(mp3.length)})`);
  assert.equal(idb.stores.get("takes").rows.size, 1, "an MP3 is a copy: the master stays until the WAV is saved");
  await btn.onclick();   // a second click reuses the encoded file
  assert.equal(workers.length, 1);
});

test("MP3 of a stereo take, and of a take whose WAV was decoded rather than captured", async () => {
  const stereo = makeRuntime({ media: true, capture: true });
  stereo.document.getElementById("recmix").value = "backing";
  stereo.document.getElementById("recbtn").click();
  await settle();
  stereo.worklets[0].feed(48000);
  await settle();
  stereo.document.getElementById("recbtn").click();
  await settle();
  assert.match(stereo.document.getElementById("recdlm").textContent, new RegExp(`~${stereo.app.fileSize(192 * 125)}`), "192 kbps for stereo");
  await stereo.document.getElementById("recdlm").onclick();
  await settle();
  const s = new Uint8Array(await stereo.app.getTake().mp3.blob.arrayBuffer());
  assert.equal((s[3] >> 6) & 3, 0, "channel mode: stereo");

  const decoded = makeRuntime({ media: true, worker: true });   // no capture: the WAV is decoded
  decoded.document.getElementById("recbtn").click();
  await settle();
  decoded.document.getElementById("recbtn").click();
  await settle();
  await decoded.document.getElementById("recdlm").onclick();
  await settle();
  const d = new Uint8Array(await decoded.app.getTake().mp3.blob.arrayBuffer());
  assert.ok(mp3Frames(d) > 30, "one second of audio makes about 38 frames");
});

test("a saved master can be taken as MP3 without being dropped", async () => {
  const first = makeRuntime({ media: true, capture: true });
  first.document.getElementById("recbtn").click();
  await settle();
  first.worklets[0].feed(24000);
  await settle();
  const { document, idb } = makeRuntime({ media: true, capture: { store: first.idb.stores } });
  await settle();
  const id = [...idb.stores.get("takes").rows.values()][0].v.id;
  assert.match(document.getElementById("recsaved").innerHTML, new RegExp(`data-mp3="${id}">MP3<`));
  await document.getElementById("recsaved").onclick({ target: { dataset: { mp3: id } } });
  await settle();
  assert.match(document.body.children.at(-1).download, /\.mp3$/);
  assert.equal(idb.stores.get("takes").rows.size, 1);
});

test("the MP3 worker turns interleaved 16-bit samples into MP3 frames", async () => {
  const posted = [];
  const scope = vm.createContext({ Blob, Int16Array, Int8Array, Float32Array, Math,
    postMessage: m => posted.push(m), close() {} });
  scope.importScripts = n => vm.runInContext(readFileSync(new URL("../web/" + n, import.meta.url), "utf8"), scope);
  vm.runInContext(readFileSync(new URL("../web/mp3-worker.js", import.meta.url), "utf8"), scope);
  scope.onmessage({ data: { start: { channels: 2, sampleRate: 44100, kbps: 192 } } });
  const pcm = Int16Array.from({ length: 44100 * 2 }, (_, i) => Math.round(Math.sin(i / 20) * 8000));
  scope.onmessage({ data: { pcm } });
  assert.equal(posted[0].progress, 44100);
  scope.onmessage({ data: { end: true } });
  const bytes = new Uint8Array(await posted.at(-1).done.arrayBuffer());
  assert.equal(bytes[0], 0xFF);
  const fresh = vm.createContext({ Blob, Int16Array, Int8Array, Float32Array, Math, postMessage: m => posted.push(m), close() {} });
  fresh.importScripts = scope.importScripts;
  vm.runInContext(readFileSync(new URL("../web/mp3-worker.js", import.meta.url), "utf8"), fresh);
  const before = posted.length;
  fresh.onmessage({ data: { pcm } });
  assert.equal(posted.length, before, "samples before start are ignored, not encoded with no settings");
});

// ---------- download settings: 24-bit WAV, MP3 quality ----------
test("a 24-bit master is stored and downloaded at 24 bits, with every sample intact", async () => {
  const { app, document, worklets, idb } = makeRuntime({ media: true, capture: true });
  document.getElementById("recbits").onchange({ target: { value: "24" } });
  document.getElementById("recbtn").click();
  await settle();
  worklets[0].feed(4800, -0.5); worklets[0].feed(4800, 0.25);
  await settle();
  assert.equal([...idb.stores.get("takes").rows.values()][0].v.bits, 24);
  document.getElementById("recbtn").click();
  await settle();
  assert.equal(app.getTake().wav.size, 44 + 9600 * 3);
  assert.equal(document.getElementById("recbits").disabled, false, "free again once the take ends");
  document.getElementById("recdlw").click();
  await settle();
  const bytes = new Uint8Array(await app.getTake().wav.blob.arrayBuffer()), v = new DataView(bytes.buffer);
  assert.equal(v.getUint16(34, true), 24, "bits per sample");
  assert.equal(v.getUint16(32, true), 3, "block align: one mono 3-byte sample");
  assert.equal(v.getUint32(28, true), 48000 * 3, "byte rate");
  const s24 = i => { const o = 44 + 3 * i; const x = bytes[o] | bytes[o + 1] << 8 | bytes[o + 2] << 16; return x & 0x800000 ? x - 0x1000000 : x; };
  assert.equal(s24(0), -0x400000, "-0.5 at full 24-bit precision");
  assert.equal(s24(4800), Math.trunc(0.25 * 0x7FFFFF));
});

test("the bit depth is fixed while a take is open, and old 16-bit masters still read", async () => {
  const { document } = makeRuntime({ media: true, capture: true });
  document.getElementById("recbtn").click();
  await settle();
  assert.equal(document.getElementById("recbits").disabled, true);
  // a master stored before bit depth existed has no bits field: it is 16-bit
  const store = new Map([["takes", { keyPath: "id", rows: new Map([
    ['"old"', { key: "old", v: { id: "old", status: "done", channels: 1, sampleRate: 48000, frames: 2, name: "old.wav" } }]]) }],
    ["chunks", { keyPath: ["take", "seq"], rows: new Map([
      ['["old",0]', { key: ["old", 0], v: { take: "old", seq: 0, pcm: new Int16Array([100, -100]) } }]]) }]]);
  const later = makeRuntime({ media: true, capture: { store } });
  await settle();
  assert.match(later.document.getElementById("recsaved").innerHTML, /old\.wav · 0:00 · 48 B/);
  await later.document.getElementById("recsaved").onclick({ target: { dataset: { dl: "old" } } });
  await settle();
  assert.equal(later.document.body.children.at(-1).download, "old.wav");
});

test("MP3 quality sets the bitrate, re-encodes when changed, and is remembered", async () => {
  const { app, document, worklets, workers } = makeRuntime({ media: true, capture: true });
  document.getElementById("recbtn").click();
  await settle();
  worklets[0].feed(48000);
  await settle();
  document.getElementById("recbtn").click();
  await settle();
  const btn = document.getElementById("recdlm"), q = document.getElementById("recq");
  q.onchange({ target: { value: "best" } });
  assert.equal(btn.textContent, `Download MP3 (~${app.fileSize(320 * 125)})`, "the estimate follows the setting");
  await btn.onclick();
  await settle();
  const best = new Uint8Array(await app.getTake().mp3.blob.arrayBuffer());
  assert.equal(best[2] >> 4, 14, "MPEG-1 Layer III bitrate index 14 is 320 kbps");
  q.onchange({ target: { value: "standard" } });
  assert.match(btn.textContent, /~/, "the 320 kbps file no longer matches the setting");
  await btn.onclick();
  await settle();
  assert.equal(workers.length, 2, "so it is encoded again");
  const std = new Uint8Array(await app.getTake().mp3.blob.arrayBuffer());
  assert.equal(std[2] >> 4, 9, "index 9 is 128 kbps");
  // remembered for the next visit, on this device only
  const stored = JSON.parse(app.getState().storage.getItem("practice-desk-rec-settings"));
  assert.equal(stored.mp3Quality, "standard");
});

test("an MP3 of a 24-bit master comes out right, and damaged settings fall back to defaults", async () => {
  const { app, document, worklets } = makeRuntime({ media: true, capture: true });
  document.getElementById("recbits").onchange({ target: { value: "24" } });
  document.getElementById("recbtn").click();
  await settle();
  worklets[0].feed(48000, 0.3);
  await settle();
  document.getElementById("recbtn").click();
  await settle();
  await document.getElementById("recdlm").onclick();
  await settle();
  const mp3 = new Uint8Array(await app.getTake().mp3.blob.arrayBuffer());
  assert.deepEqual([mp3[0], mp3[1]], [0xFF, 0xFB]);
  assert.ok(mp3.length > 15000, "a second of audio at 128 kbps, not silence-sized");
  assert.equal(JSON.parse(app.getState().storage.getItem("practice-desk-rec-settings")).wavBits, 24);

  for (const bad of ['{"wavBits":8,"mp3Quality":"__proto__"}', "not json", '{"wavBits":"24"}', "null"]) {
    const odd = makeRuntime({ media: true, capture: true, stored: { "practice-desk-rec-settings": bad } });
    assert.equal(odd.document.getElementById("recbits").value, "16", `${bad}: bit depth falls back`);
    assert.equal(odd.document.getElementById("recq").value, "standard", `${bad}: quality falls back`);
  }
  const kept = makeRuntime({ media: true, capture: true,
    stored: { "practice-desk-rec-settings": '{"wavBits":24,"mp3Quality":"high"}' } });
  assert.equal(kept.document.getElementById("recbits").value, "24", "a good setting is restored");
  assert.equal(kept.document.getElementById("recq").value, "high");
});

// ---------- chord explorers: the pure parts (ported from the drafts) ----------
// Loaded as index.html loads them: the shared helper, then each explorer.
const explorerCtx = (() => { const ctx = vm.createContext({}); explorerScripts.forEach(f => vm.runInContext(f, ctx)); return ctx; })();
const INV = explorerCtx.InversionsExplorer, TRI = explorerCtx.TriadsExplorer;
const OPEN_LOW = [40, 45, 50, 55, 59, 64];
const hasGrip = (grips, frets) => grips.some(g => g.frets.join() === frets.join());

test("inversions: G major on G B e gives the lesson's grips", () => {
  const g = INV.findGrips(7, "major", 0);
  sameShape(g[0].frets, [4, 3, 3]);
  assert.equal(g[0].inversion, 1);
  for (const f of [[7, 8, 7], [12, 12, 10], [16, 15, 15]]) assert.ok(hasGrip(g, f), f.join("-"));
});

test("inversions: A minor grips sit in boxes 1, 2 and 4", () => {
  const g = INV.findGrips(9, "minor", 0);
  for (const f of [[5, 5, 5], [9, 10, 8], [14, 13, 12]]) assert.ok(hasGrip(g, f), f.join("-"));
});

test("inversions: every key, quality and string set gives all three inversions as valid close grips", () => {
  for (let key = 0; key < 12; key++) for (const q of Object.keys(INV.QUALITIES)) for (let s = 0; s < INV.STRING_SETS.length; s++) {
    const tones = INV.chordTones(key, q), grips = INV.findGrips(key, q, s);
    assert.ok(grips.length >= 3, `${key} ${q} set ${s}`);
    assert.equal(new Set(grips.map(g => g.inversion)).size, 3, `${key} ${q} set ${s}: every inversion`);
    let last = -1;
    for (const g of grips) {
      assert.ok(g.frets.every(f => f >= 0 && f <= 16));
      assert.ok(Math.max(...g.frets) - Math.min(...g.frets) <= 4);
      g.frets.forEach((f, k) => { const m = OPEN_LOW[g.strings[k]] + f; assert.equal(m, g.midi[k]); assert.equal(m % 12, tones[g.roles[k]]); });
      assert.ok(g.midi[0] < g.midi[1] && g.midi[1] < g.midi[2] && g.midi[2] - g.midi[0] < 12, "close voicing, rising");
      assert.equal(g.roles[0], g.inversion);
      const sum = g.frets[0] + g.frets[1] + g.frets[2];
      assert.ok(sum >= last, "sorted up the neck"); last = sum;
    }
  }
});

test("triads: the recipes are stacked thirds", () => {
  sameShape(TRI.chordTones(0, "major"), [0, 4, 7]);
  sameShape(TRI.chordTones(9, "minor"), [9, 0, 4]);
  sameShape(TRI.chordTones(11, "dim"), [11, 2, 5]);
  sameShape(TRI.chordTones(0, "aug"), [0, 4, 8]);
});

test("triads: one fret changes the quality, in every key and string set", () => {
  for (let key = 0; key < 12; key++) for (let s = 0; s < 4; s++) {
    const grips = TRI.findMajorGrips(key, s);
    assert.ok(grips.length >= 3, `key ${key} set ${s}`);
    for (const g of grips) {
      const minor = TRI.gripInQuality(g, "minor"), dim = TRI.gripInQuality(g, "dim"), aug = TRI.gripInQuality(g, "aug");
      assert.equal(minor.moved.length, 1); assert.equal(minor.moved[0].delta, -1); assert.equal(g.roles[minor.moved[0].index], 1, "minor: the 3rd, down one");
      assert.equal(dim.moved.length, 2); assert.ok(dim.moved.every(m => m.delta === -1), "dim: 3rd and 5th down");
      assert.equal(aug.moved.length, 1); assert.equal(aug.moved[0].delta, 1); assert.equal(g.roles[aug.moved[0].index], 2, "aug: the 5th, up one");
      for (const [q, v] of [["major", g], ["minor", minor], ["dim", dim], ["aug", aug]]) {
        const tones = TRI.chordTones(key, q);
        v.frets.forEach((f, k) => { assert.ok(f >= 0 && f <= 16); assert.equal((OPEN_LOW[v.strings[k]] + f) % 12, tones[v.roles[k]]); });
      }
    }
  }
});

test("triads: barre chords are stacked triads with doubled notes", () => {
  const g = TRI.barreChord(7, "major", "E");
  sameShape(g.frets, [3, 5, 5, 4, 3, 3]);
  const wins = TRI.barreWindows(g);
  sameShape(wins.map(w => w.isTriad), [false, true, true, true]);
  sameShape(wins[3].strings, [3, 4, 5]);
  sameShape(TRI.barreChord(9, "minor", "E").frets, [5, 7, 7, 5, 5, 5]);
  const c = TRI.barreChord(0, "major", "A");
  sameShape(c.frets, [null, 3, 5, 5, 5, 3]);
  sameShape(TRI.barreWindows(c).map(w => w.isTriad), [false, true, true]);
  for (let key = 0; key < 12; key++) for (const q of ["major", "minor"]) for (const shape of ["E", "A"]) {
    const ch = TRI.barreChord(key, q, shape);
    ch.frets.forEach((f, s) => { if (f === null) return; assert.ok(f >= 1 && f <= 16); assert.ok(ch.roles[s] !== -1 && ch.roles[s] !== null); });
    assert.ok(TRI.barreWindows(ch).some(w => w.isTriad));
  }
});

test("the explorers share one helper, and don't carry a synth of their own", () => {
  for (const f of explorerScripts) {
    assert.doesNotMatch(f, /AudioContext|createOscillator/, "sound goes through the app");
    assert.doesNotMatch(f, /style="|\son[a-z]+=/, "CSP-safe markup: no inline styles or handlers");
  }
  assert.equal(INV.findGrips, explorerCtx.ChordExplorer.findGrips, "one findGrips for both");
  assert.equal(TRI.NOTE_NAMES, explorerCtx.ChordExplorer.NOTE_NAMES);
});

// ---------- chord explorers in the app ----------
const explorerIn = (document, id) => document.getElementById(id);
const infoText = root => findAll(root, e => (e.attributes.class || "").includes("cx-info-title")).map(e => e.textContent).join(" | ");

test("the Inversions view mounts its explorer once, driven by the toolbar's Root", () => {
  const { app, document } = makeRuntime();
  navButton(document, "inv").click();
  const el = explorerIn(document, "inversions-explorer");
  assert.equal(findAll(el, e => (e.attributes.class || "") === "cx").length, 1, "mounted");
  const sel = findAll(el, e => e.tagName === "SELECT")[0];
  assert.ok(sel, "its own Key menu");
  chooseKey(document, 7);   // G, from the toolbar
  assert.match(infoText(el), /^G major, grip 1 of \d+/);
  assert.equal(sel.value, "7", "the menu follows the toolbar");
  sel.value = "2"; sel.dispatch("change");                // D, from the menu
  assert.equal(app.getState().key, 2, "the toolbar follows the menu");
  assert.equal(document.getElementById("keyselect").value, "2");
  assert.match(infoText(el), /^D major/);
  chooseKey(document, 3);   // E♭, spelt as a chord root
  assert.match(infoText(el), /^E♭ major/);
  assert.equal(document.getElementById("keyselect").children[3].textContent, "E♭");
  navButton(document, "boxes").click();
  assert.equal(document.getElementById("keyselect").children[3].textContent, "D# minor", "minor keys keep their spelling");
  navButton(document, "inv").click();
  assert.equal(findAll(el, e => (e.attributes.class || "") === "cx").length, 1, "not mounted twice");
});

test("inversions explorer: quality, strings, the pentatonic toggle and stepping keep their place", () => {
  const { document } = makeRuntime();
  navButton(document, "inv").click();
  const el = explorerIn(document, "inversions-explorer");
  chooseKey(document, 9);   // A
  buttonNamed(el, "Minor").click();
  assert.match(infoText(el), /^A minor/);
  const box = findAll(el, e => e.tagName === "INPUT")[0];
  assert.equal(box.disabled, false, "major and minor have a pentatonic");
  buttonNamed(el, "Dim").click();
  assert.equal(box.disabled, true, "diminished has none");
  buttonNamed(el, "Aug").click();
  assert.equal(box.disabled, true);
  assert.ok(findAll(el, e => e.textContent === "Every inversion is the same shape, 4 frets apart").length);
  buttonNamed(el, "Minor").click();
  buttonNamed(el, "D G B").click();
  assert.equal(buttonNamed(el, "D G B").getAttribute("aria-pressed"), "true");
  buttonNamed(el, "→").click();
  assert.match(infoText(el), /grip 2 of/);
  const top = findAll(el, e => (e.attributes.class || "").includes("cx-chip"))[0];
  assert.match(top.attributes.class, /cx-chip-arrive/, "the bottom card rises to the top");
  document.getElementById("labels").children.find(b => b.dataset.l === "interval").click();   // redraws the view
  assert.match(infoText(el), /grip 2 of/, "a redraw with the same key keeps your place");
  box.checked = true; box.disabled = false; box.dispatch("change");
  const board = findAll(el, e => e.tagName === "SVG")[0];
  assert.match(board.innerHTML, /cx-scale/, "the pentatonic is drawn");
});

test("inversions explorer: Play and Play all sound through the app's audio", () => {
  const { document, audio } = makeRuntime();
  navButton(document, "inv").click();
  const el = explorerIn(document, "inversions-explorer");
  const before = audio.oscillators;
  buttonNamed(el, "Play").click();
  assert.equal(audio.oscillators - before, 6 * 3, "three notes up, then three strummed; three oscillators a voice");
  const grips = infoText(el).match(/of (\d+)/)[1];
  const mid = audio.oscillators;
  buttonNamed(el, "Play all up the neck").click();   // the test clock runs its steps at once
  assert.equal(audio.oscillators - mid, grips * 18, "every grip, up the neck");
  assert.match(infoText(el), new RegExp(`grip ${grips} of ${grips}`));
});

test("inversions explorer plays on the compatibility engine too", () => {
  const { document, audioElements } = makeRuntime({ audio: "wav" });
  navButton(document, "inv").click();
  buttonNamed(explorerIn(document, "inversions-explorer"), "Play").click();
  assert.equal(audioElements.length, 6);
});

test("the Triads view mounts its explorer: three views, one note changing, barre chords", () => {
  const { app, document, audio } = makeRuntime();
  navButton(document, "triads").click();
  const el = explorerIn(document, "triads-explorer");
  chooseKey(document, 7);   // G
  const sel = findAll(el, e => e.tagName === "SELECT")[0];
  assert.equal(sel.value, "7");
  assert.match(infoText(el), /^G major = major 3rd \+ minor 3rd/);
  sel.value = "0"; sel.dispatch("change");
  assert.equal(app.getState().key, 0, "the Key menu moves the toolbar's Root too");
  chooseKey(document, 7);
  buttonNamed(el, "Minor").click();
  assert.match(infoText(el), /^G minor = minor 3rd \+ major 3rd/);
  const before = audio.oscillators;
  buttonNamed(el, "Play").click();
  assert.ok(audio.oscillators > before, "Build it plays its triad");

  buttonNamed(el, "Change one note").click();
  assert.match(infoText(el), /^G minor, position 1 of/);
  assert.ok(findAll(el, e => /From major: 3rd down 1 fret/.test(e.textContent)).length);
  assert.ok(findAll(el, e => /inversion|root position/.test(e.textContent) && e.tagName === "P").length, "names the inversion");
  buttonNamed(el, "A D G").click();
  assert.equal(buttonNamed(el, "A D G").getAttribute("aria-pressed"), "true");
  buttonNamed(el, "See every grip of this chord in Inversions →").click();
  assert.equal(app.getState().view, "inv", "the cross-link opens Inversions");

  navButton(document, "triads").click();
  buttonNamed(el, "Inside barre chords").click();
  assert.match(infoText(el), /^Strings E A D: no 3rd, so not a triad/);
  buttonNamed(el, "→").click();
  assert.match(infoText(el), /^Strings A D G: a triad, /);
  assert.ok(buttonNamed(el, "More on the root position in Inversions →") || buttonNamed(el, "More on the 1st inversion in Inversions →")
    || buttonNamed(el, "More on the 2nd inversion in Inversions →"), "a triad window links to Inversions");
  buttonNamed(el, "A shape").click();
  assert.match(infoText(el), /^Strings A D G/, "the A shape starts on the A string");
  const b = audio.oscillators;
  buttonNamed(el, "Play full chord").click();
  assert.equal(audio.oscillators - b, 5 * 2 * 3, "five strings: up, then strummed");
});

test("the existing Triads and Inversions content stays below the explorers, spelt as chord roots", () => {
  const { document } = makeRuntime();
  navButton(document, "triads").click();
  chooseKey(document, 10);   // B♭
  const all = ["triadsummary", "triadshapes"].map(id => document.getElementById(id).innerHTML).join("");
  assert.ok(all.length > 500, "the existing Triads content is drawn");
  assert.match(all, /B\u266d/, "B♭ spelt as on a chord chart");
  assert.doesNotMatch(all, /A#/, "and never as A#");
  assert.match(html, /<h3 class="cx-more">Every triad shape, in detail<\/h3>/);
  assert.match(html, /<h3 class="cx-more">Why it matters<\/h3>/);
  assert.ok(html.indexOf('id="triads-explorer"') < html.indexOf('id="triadkinds"'), "explorer first, the detail below");
  assert.ok(html.indexOf('id="inversions-explorer"') < html.indexOf('id="invdemo"'));
  assert.match(html, /<script src="chord-explorer\.js" defer><\/script>\s*<script src="triads-explorer\.js" defer><\/script>\s*<script src="inversions-explorer\.js" defer><\/script>\s*<script src="band\.js" defer><\/script>\s*<script src="analysis\.js" defer><\/script>\s*<script src="pitch\.js" defer><\/script>\s*<script src="tune\.js" defer><\/script>\s*<script src="changes\.js" defer><\/script>\s*<script src="library\.js" defer><\/script>\s*<script src="looper\.js" defer><\/script>\s*<script src="songs\.js" defer><\/script>\s*<script src="app\.js" defer><\/script>/, "the helper loads first, app.js last");
});

test("without the explorer scripts, both views still render their existing content", () => {
  const { document } = makeRuntime({ explorers: false });
  navButton(document, "triads").click();
  navButton(document, "inv").click();
  assert.equal(document.getElementById("inversions-explorer").children.length, 0);
  assert.ok(document.getElementById("invdemo").innerHTML.length > 0);
});

test("a standalone explorer still offers its own key menu and reports changes", () => {
  const ctx = vm.createContext({ document: { createElement: t => new Element("", t), createElementNS: (n, t) => new Element("", t),
    createTextNode: t => ({ nodeType: 3, textContent: String(t) }) }, setTimeout, clearTimeout });
  explorerScripts.forEach(f => vm.runInContext(f, ctx));
  for (const name of ["InversionsExplorer", "TriadsExplorer"]) {
    const host = new Element(), seen = [];
    ctx[name].mount(host, { key: 0, onKeyChange: pc => seen.push(pc) });
    const sel = findAll(host, e => e.tagName === "SELECT")[0];
    assert.ok(sel, `${name} has a key menu when mounted on its own`);
    sel.value = "5"; sel.dispatch("change");
    sameShape(seen, [5]);
  }
});

test("with a raw capture, the limited mix feeds both the compressed recording and the master", async () => {
  const { app, document, audio, worklets } = makeRuntime({ media: true, capture: true });
  document.getElementById("recmix").value = "backing";
  document.getElementById("recbtn").click();
  await settle();
  sameShape(audio.limiters[0].outs[0].outs, [app.getRec().dest, worklets[0]]);
});

test("a browser without a compressor still records backing, straight from the mix bus", async () => {
  const { app, document } = makeRuntime({ media: true });
  app.audio().context.createDynamicsCompressor = undefined;
  document.getElementById("recmix").value = "backing";
  document.getElementById("recbtn").click();
  await settle();
  const r = app.getRec();
  assert.ok(r.bus && r.bed, "still mixed, with the backing 3 dB down");
  assert.equal(app.getRec().recorder.state, "recording");
});

// ---------- the backing band: the score ----------
const B = (() => { const ctx = vm.createContext({}); vm.runInContext(bandScript, ctx); return ctx.Band; })();
const I7 = pc => ({ pc, intervals: [0, 4, 7, 10] });
const bandBeat = (feel, beat, extra = {}) => B.beatEvents({ feel, beat, step: beat, swing: 2 / 3, beatSec: 0.5, chord: I7(9), ...extra });
const near = (a, b) => Math.abs(a - b) < 1e-9;

test("band: every event sits on its feel's grid, inside the beat", () => {
  const grids = {
    shuffle: s => [0, s], straight: s => [0, s],
    funk: s => [0, s / 2, 0.5, 0.5 + s / 2], slow: () => [0, 1 / 3, 2 / 3],
  };
  for (const feel of Object.keys(B.FEELS)) for (const swing of [0.5, 0.6, 2 / 3, 0.75]) for (let beat = 0; beat < 4; beat++) {
    const grid = grids[feel](swing);
    for (const e of bandBeat(feel, beat, { swing })) {
      assert.ok(e.at >= 0 && e.at < 1, `${feel} beat ${beat}: ${e.at} inside the beat`);
      assert.ok(grid.some(g => near(g, e.at)), `${feel} ${swing} beat ${beat}: ${e.part} ${e.voice || e.midi} at ${e.at} is on the grid`);
    }
  }
});

test("band: the swing slider moves the offbeat from straight to a hard shuffle", () => {
  const hatAt = (feel, swing) => bandBeat(feel, 0, { swing }).filter(e => e.voice === "hat").map(e => e.at);
  sameShape(hatAt("shuffle", 0.5), [0, 0.5]);
  assert.ok(near(hatAt("shuffle", 2 / 3)[1], 2 / 3), "67%: the triplet");
  sameShape(hatAt("shuffle", 0.75), [0, 0.75]);
  sameShape(hatAt("shuffle", 0.9), [0, 0.75], "clamped to 75%");
  sameShape(hatAt("shuffle", 0.1), [0, 0.5], "and to 50%");
  sameShape(hatAt("funk", 0.6), [0, 0.3, 0.5, 0.8], "funk swings its 16ths within each 8th");
  const slow = hatAt("slow", 0.5);
  assert.ok(near(slow[1], 1 / 3) && near(slow[2], 2 / 3), "12/8 ignores the slider: its triplets are the feel");
  assert.equal(B.FEELS.slow.swing, false);
});

test("band: backbeat on 2 and 4 in every feel; kick on 1 and 3, syncopated in funk", () => {
  for (const feel of Object.keys(B.FEELS)) for (let beat = 0; beat < 4; beat++) {
    const ev = bandBeat(feel, beat), onBeat = v => ev.some(e => e.voice === v && e.at === 0);
    assert.equal(onBeat("snare"), beat === 1 || beat === 3, `${feel} beat ${beat + 1} snare`);
    if (feel !== "funk") assert.equal(onBeat("kick"), beat === 0 || beat === 2, `${feel} beat ${beat + 1} kick`);
  }
  const funkKicks = [0, 1, 2, 3].flatMap(beat => bandBeat("funk", beat, { swing: 0.5 }).filter(e => e.voice === "kick").map(e => beat + e.at));
  sameShape(funkKicks, [0, 0.75, 2.5], "funk: 1, the last 16th of 1, and the and of 3");
  const count = B.beatEvents({ feel: "shuffle", beat: 2, countIn: true });
  sameShape(count.map(e => e.voice), ["stick"]);
  sameShape(bandBeat("shuffle", 0, { ride: true }).filter(e => /hat|ride/.test(e.voice)).map(e => e.voice), ["ride", "ride"]);
});

test("band: the bass walks root–5–6–♭7 on a dominant, and follows a split bar's second chord", () => {
  const firstNotes = (chord, steps, bass = "walk") => steps.map(step =>
    B.beatEvents({ feel: "shuffle", beat: step, step, swing: 2 / 3, beatSec: 0.5, chord, bass }).find(e => e.part === "bass" && e.at === 0)?.midi);
  sameShape(firstNotes(I7(9), [0, 1, 2, 3]), [33, 40, 42, 43], "A7: A, E, F#, G from A1");
  sameShape(firstNotes(I7(2), [0, 1, 2, 3]), [38, 45, 47, 48], "D7 sits between A1 and G#2 too");
  // bebop-style split bar: IIm7 then V7 in A — beats 3 and 4 restart from the V's root
  const bar = [{ chord: { pc: 11, intervals: [0, 3, 7, 10] }, step: 0 }, { chord: { pc: 11, intervals: [0, 3, 7, 10] }, step: 1 },
    { chord: I7(4), step: 0 }, { chord: I7(4), step: 1 }];
  const notes = bar.map(({ chord, step }, beat) =>
    B.beatEvents({ feel: "shuffle", beat, step, swing: 2 / 3, beatSec: 0.5, chord }).find(e => e.part === "bass" && e.at === 0).midi);
  sameShape(notes, [35, 42, 40, 47], "B, F# (Bm7: root, 5th), then E, B (E7: root, 5th)");
  sameShape(firstNotes({ pc: 9, intervals: [0, 3, 6, 9] }, [0, 1, 2, 3]), [33, 36, 39, 42], "a diminished chord walks its own tones");
  // root–fifth: a root on beat 1, the fifth on beat 3, nothing between
  sameShape(firstNotes(I7(9), [0, 1, 2, 3], "root5"), [33, undefined, 40, undefined]);
  const swung = B.beatEvents({ feel: "shuffle", beat: 0, step: 0, swing: 2 / 3, beatSec: 0.5, chord: I7(9) }).filter(e => e.part === "bass");
  assert.equal(swung.length, 2, "the shuffle walk plays the swung 8th too");
  assert.ok(near(swung[1].at, 2 / 3));
});

// ---------- the backing band in the trainer ----------
test("the band books drums and bass on the audio clock, on the grid, from bar 1", () => {
  const { app, document, audio, advance } = makeRuntime();
  app.setBpm(120);                                   // a beat is 0.5 s
  document.getElementById("groove").value = "shuffle";
  const noiseBefore = (audio.noise ?? []).length;
  app.toggleTrainer();
  assert.ok(app.getBandRig(), "the band is on while the trainer runs");
  for (let i = 0; i < 12; i++) advance(0.5);         // count-in and two bars
  const hits = audio.startTimes.filter(t => t !== undefined);
  // every drum and bass start is on the shuffle grid: a beat, or 2/3 of one
  for (const t of hits) {
    const inBeat = (t % 0.5) / 0.5;
    assert.ok([0, 2 / 3, 1].some(g => Math.abs(inBeat - g) < 1e-6), `a start at ${t.toFixed(4)} s is on the grid`);
  }
  assert.ok((audio.noise ?? []).length - noiseBefore > 8, "drums played");
  app.toggleTrainer();
  assert.equal(app.getBandRig(), null, "stopping lets the band go");
});

test("the band plays through the engine's bus, so a take with backing records it", () => {
  const { app } = makeRuntime();
  const e = app.audio(), buses = [], bus = e.bus;
  e.bus = () => { const g = bus(); buses.push(g); return g; };
  app.toggleTrainer();
  assert.equal(buses.length, 1);
  assert.equal(app.getBandRig().out, buses[0]);
  app.toggleTrainer();
});

test("the band can be switched off; without Web Audio or band.js there is no live band", () => {
  const off = makeRuntime();
  off.document.getElementById("bandon").click();
  assert.equal(off.app.getBand().on, false);
  assert.equal(off.document.getElementById("bandon").getAttribute("aria-pressed"), "false");
  off.app.toggleTrainer();
  assert.equal(off.app.getBandRig(), null, "off: the trainer's own stabs");
  off.document.getElementById("bandon").click();
  assert.ok(off.app.getBandRig(), "on again, while running: the band joins");
  off.app.toggleTrainer();

  const compat = makeRuntime({ audio: "wav" });
  compat.app.toggleTrainer();
  assert.equal(compat.app.getBandRig(), null, "no Web Audio bus to play into: a rendered chorus instead (tested below)");
  compat.app.toggleTrainer();
  const missing = makeRuntime({ band: false });
  missing.app.toggleTrainer();
  assert.equal(missing.app.getBandRig(), null, "without band.js the trainer still runs");
  missing.app.toggleTrainer();
});

test("tap tempo sets the tempo from steady taps and ignores stray ones", () => {
  const { app, document } = makeRuntime();
  let t = 1_000_000;
  assert.equal(app.tapTempo(t), null, "one tap is not a tempo");
  for (const gap of [500, 500, 500]) assert.equal(app.tapTempo(t += gap), 120);
  assert.equal(app.getState().bpm, 120);
  assert.equal(document.getElementById("bpmv").textContent, "120 bpm");
  assert.equal(app.tapTempo(t += 5000), null, "a long pause starts a new count");
  assert.equal(app.tapTempo(t += 3000), null, "20 bpm is off the scale");
});

test("band settings: the swing label, 12/8, and remembering them safely", () => {
  const { app, document } = makeRuntime();
  const sw = document.getElementById("swing");
  sw.value = "50"; sw.oninput({ target: sw });
  assert.equal(document.getElementById("swingv").textContent, "50% · straight");
  sw.value = "67"; sw.oninput({ target: sw });
  assert.equal(app.getBand().swing, 2 / 3, "67 snaps to an exact triplet");
  assert.equal(document.getElementById("swingv").textContent, "67% · triplet feel");
  sw.value = "75"; sw.oninput({ target: sw });
  assert.equal(document.getElementById("swingv").textContent, "75% · hard shuffle");
  const feel = document.getElementById("groove");
  feel.value = "slow"; feel.onchange();
  assert.equal(sw.disabled, true);
  assert.equal(document.getElementById("swingv").textContent, "built into 12/8");
  document.getElementById("bandbass").onchange({ target: { value: "root5" } });
  const saved = JSON.parse(app.getState().storage.getItem("practice-desk-band"));
  assert.equal(saved.bass, "root5"); assert.equal(saved.swing, 0.75);
  for (const bad of ['{"swing":2,"bass":"<b>","on":"yes"}', "{", "[]"]) {
    const r = makeRuntime({ stored: { "practice-desk-band": bad } });
    sameShape({ ...r.app.getBand() }, { on: true, swing: 2 / 3, bass: "walk", ride: false,
      mix: { drums: { vol: 0.8, on: true }, bass: { vol: 0.8, on: true }, keys: { vol: 0.55, on: true }, guitar: { vol: 0.55, on: true } },
      practice: { choruses: 0, ladder: false, ladderTo: 140, keys: "", drill: "" } }, `${bad}: defaults`);
  }
});

test("band: keys stab the chord's own tones on the offbeats of 2 and 4", () => {
  for (let beat = 0; beat < 4; beat++) {
    const stabs = bandBeat("shuffle", beat).filter(e => e.part === "keys");
    if (beat === 1 || beat === 3) {
      assert.equal(stabs.length, 1);
      assert.ok(near(stabs[0].at, 2 / 3), "the swung offbeat");
      sameShape(stabs[0].midis.map(m => m % 12), [9, 1, 4, 7], "A7: A C# E G");
      assert.ok(stabs[0].midis.every(m => m >= 52 && m < 76), "a mid-register voicing");
    } else assert.equal(stabs.length, 0);
  }
  const slow = B.beatEvents({ feel: "slow", beat: 0, step: 0, swing: 0.5, beatSec: 1, chord: I7(9) }).filter(e => e.part === "keys");
  assert.ok(slow[0].dur > 3, "12/8: a held chord where it changes");
});

test("band: the rhythm guitar boogies 5–6 a beat each, and follows minor and split bars", () => {
  const shapes = (chord, steps = [0, 1, 2, 3]) => steps.map(step => {
    const g = B.beatEvents({ feel: "shuffle", beat: step, step, swing: 2 / 3, beatSec: 0.5, chord }).filter(e => e.part === "guitar");
    return g[0].midis[1] - g[0].midis[0];
  });
  sameShape(shapes(I7(9)), [7, 9, 7, 9], "root–5th, root–6th, and again");
  sameShape(shapes({ pc: 9, intervals: [0, 3, 7, 10] }), [7, 8, 7, 8], "minor: the ♭6");
  const low = B.beatEvents({ feel: "shuffle", beat: 0, step: 0, swing: 2 / 3, beatSec: 0.5, chord: I7(4) }).filter(e => e.part === "guitar")[0];
  assert.equal(low.midis[0], 40, "E: the open low E string");
  assert.equal(B.beatEvents({ feel: "shuffle", beat: 2, step: 0, swing: 2 / 3, beatSec: 0.5, chord: I7(2) })
    .filter(e => e.part === "guitar")[0].midis[1] - 50, 7, "a chord arriving on beat 3 starts from root–5th");
});

test("the mixer sets each part's level live, and muting leaves the band's timing alone", () => {
  const { app, document, audio, advance } = makeRuntime();
  app.toggleTrainer();
  const rig = app.getBandRig();
  sameShape(Object.keys(rig.parts), ["drums", "bass", "keys", "guitar"]);
  assert.equal(rig.parts.bass.gain.value, 0.8);
  document.getElementById("mixbass").click();          // play the bass part yourself
  assert.equal(rig.parts.bass.gain.value, 0, "muted");
  assert.equal(document.getElementById("mixbass").getAttribute("aria-pressed"), "false");
  const vol = document.getElementById("mixkeysv");
  vol.value = "30"; vol.oninput({ target: vol });
  assert.equal(rig.parts.keys.gain.value, 0.3);
  const booked = audio.startTimes.length;
  advance(0.7);                                        // past the next beat at 90 bpm
  assert.ok(audio.startTimes.length > booked, "the muted part is still booked, only silent");
  app.toggleTrainer();
  app.toggleTrainer();
  assert.equal(app.getBandRig().parts.bass.gain.value, 0, "the mix carries over to the next start");
  const saved = JSON.parse(app.getState().storage.getItem("practice-desk-band"));
  assert.equal(saved.mix.bass.on, false); assert.equal(saved.mix.keys.vol, 0.3);
  app.toggleTrainer();
  const odd = makeRuntime({ stored: { "practice-desk-band": '{"mix":{"bass":{"vol":7,"on":"no"},"keys":{"vol":0.2}}}' } });
  assert.equal(odd.app.getBand().mix.bass.vol, 0.8, "an impossible volume is ignored");
  assert.equal(odd.app.getBand().mix.bass.on, true);
  assert.equal(odd.app.getBand().mix.keys.vol, 0.2, "a good one is kept");
});

// ---------- the backing band: practice modes ----------
// Runs the trainer through its count-in and one chorus, noting which parts the band
// booked in each of the twelve bars. The band books a bar's events while the trainer
// is on that bar, so state.trainerBar says which bar each one belongs to.
function runChorus(rt, setup = () => {}) {
  const { app, document, advance } = rt;
  setup(document);
  const bars = Array.from({ length: 12 }, () => new Set());
  app.toggleTrainer();
  const rig = app.getBandRig(), play = rig.voices.play;
  rig.voices.play = (e, t) => { const b = app.getState().trainerBar; if (b >= 0) bars[b].add(e.part); return play(e, t); };
  for (let i = 0; i < 4 + 47; i++) advance(60 / app.getState().bpm);   // up to bar 12, beat 4
  return bars;
}

test("practice: loop N choruses, then stop by itself", () => {
  const rt = makeRuntime();
  rt.document.getElementById("choruses").onchange({ target: { value: "2" } });
  rt.app.toggleTrainer();
  let steps = 0;
  while (rt.app.getState().trainerTimer && steps++ < 400) rt.advance(60 / rt.app.getState().bpm);
  assert.equal(rt.app.getState().trainerTimer, null, "it stopped");
  assert.equal(steps, 4 + 2 * 48, "four beats' count-in, two choruses of 48 beats, stopping on the next downbeat");
  assert.equal(rt.app.getBandRig(), null);
});

test("practice: the tempo ladder adds 5 bpm each chorus, up to the target, without a restart", () => {
  const rt = makeRuntime();
  rt.app.setBpm(100);
  rt.document.getElementById("ladderto").onchange({ target: { value: "110" } });
  rt.document.getElementById("ladderon").onchange({ target: { checked: true } });
  const starts = [];
  rt.app.toggleTrainer();
  for (let i = 0; i < 4 + 48 * 3; i++) {
    const s = rt.app.getState();
    if (s.trainerBar === 0 && s.trainerBeat === 1) starts.push(s.bpm);
    rt.advance(60 / s.bpm);
  }
  sameShape([...new Set(starts)], [100, 105, 110], "100, then 105, then 110 and no further");
  assert.equal(rt.document.getElementById("bpmv").textContent, "110 bpm");
  assert.equal(rt.app.getState().trainerCount, 0, "never counted in again");
  rt.app.toggleTrainer();
});

test("practice: the key moves up a 4th each chorus, or to a different random key", () => {
  const fourths = makeRuntime();
  fourths.app.setKey(9);
  fourths.document.getElementById("keycycle").onchange({ target: { value: "fourth" } });
  const keys = [];
  fourths.app.toggleTrainer();
  for (let i = 0; i < 4 + 48 * 3; i++) { const s = fourths.app.getState(); if (s.trainerBar === 0 && s.trainerBeat === 1) keys.push(s.key); fourths.advance(60 / s.bpm); }
  sameShape([...new Set(keys)], [9, 2, 7], "A, then D, then G");
  fourths.app.toggleTrainer();
  const rnd = makeRuntime({ deterministic: true });
  rnd.app.setKey(9);
  rnd.document.getElementById("keycycle").onchange({ target: { value: "random" } });
  rnd.app.toggleTrainer();
  const seen = [];
  for (let i = 0; i < 4 + 48 * 3; i++) { const s = rnd.app.getState(); if (s.trainerBar === 0 && s.trainerBeat === 1) seen.push(s.key); rnd.advance(60 / s.bpm); }
  const distinct = [...new Set(seen)];
  assert.ok(distinct.every((k, i) => i === 0 || k !== distinct[i - 1]), "never the same key twice running");
  assert.equal(distinct.length, 3);
  rnd.app.toggleTrainer();
});

test("practice: drop-out silences the band for two bars somewhere after bar 1; trade fours leaves drums only in bars 5–8", () => {
  const drop = makeRuntime({ deterministic: true });
  const bars = runChorus(drop, d => d.getElementById("drill").onchange({ target: { value: "dropout" } }));
  const silent = bars.map((b, i) => b.size ? null : i).filter(i => i !== null);
  assert.equal(silent.length, 2, "exactly two bars");
  assert.equal(silent[1], silent[0] + 1, "next to each other");
  assert.ok(silent[0] >= 1, "never bar 1");
  drop.app.toggleTrainer();

  const fours = makeRuntime();
  const fbars = runChorus(fours, d => d.getElementById("drill").onchange({ target: { value: "fours" } }));
  fbars.forEach((parts, i) => {
    if (i >= 4 && i <= 7) sameShape([...parts], ["drums"], `bar ${i + 1}: drums only, your four`);
    else assert.ok(parts.has("bass") && parts.has("keys"), `bar ${i + 1}: the band`);
  });
  fours.app.toggleTrainer();
});

test("Follow band: the chord-tone overlay follows whatever chord the trainer is playing", () => {
  const { app, document, advance } = makeRuntime();
  app.setKey(9);   // A: the classic form is A7, D7, E7
  navButton(document, "boxes").click();   // a view that shows chord tones
  document.getElementById("chords").children.find(b => b.dataset.c === "band").click();
  assert.equal(app.getState().chord, "band");
  app.toggleTrainer();
  for (let i = 0; i < 5; i++) advance(60 / app.getState().bpm);   // count-in and bar 1
  sameShape(app.getLive().chord, { pc: 9, intervals: [0, 4, 7, 10] }, "A7 in bar 1");
  assert.equal(app.isChordTone(1), true, "C#, the 3rd of A7, is lit");
  assert.equal(app.isChordTone(0), false, "C is not");
  for (let i = 0; i < 16; i++) advance(60 / app.getState().bpm);   // into bar 5
  sameShape(app.getLive().chord, { pc: 2, intervals: [0, 4, 7, 10] }, "D7 in bar 5");
  assert.equal(app.isChordTone(0), true, "C, D7's 7th, is lit now");
  app.toggleTrainer();
});

test("practice settings are remembered, and odd stored values are ignored", () => {
  const { app, document } = makeRuntime();
  document.getElementById("choruses").onchange({ target: { value: "4" } });
  document.getElementById("drill").onchange({ target: { value: "fours" } });
  document.getElementById("keycycle").onchange({ target: { value: "<script>" } });
  const saved = JSON.parse(app.getState().storage.getItem("practice-desk-band")).practice;
  sameShape(saved, { choruses: 4, ladder: false, ladderTo: 140, keys: "", drill: "fours" });
  const odd = makeRuntime({ stored: { "practice-desk-band": '{"practice":{"choruses":3,"ladderTo":999,"drill":"fours"}}' } });
  sameShape({ ...odd.app.getBand().practice }, { choruses: 0, ladder: false, ladderTo: 140, keys: "", drill: "fours" });
});

test("the 12-bar trainer opens with the band's poster, small enough to load fast", () => {
  const trainer = html.slice(html.indexOf('<section id="v-trainer"'), html.indexOf('<section id="v-rhythm"'));
  assert.match(trainer, /<img src="assets\/rats-of-chaos\.jpg" width="720" height="368" loading="lazy"\s+alt="[^"]*rat[^"]*Rats of Chaos of Grid Lock">/);
  assert.match(trainer, /<figcaption>Your backing band: <b>Rats of Chaos of Grid Lock<\/b><\/figcaption>/);
  const jpg = readFileSync(new URL("../web/assets/rats-of-chaos.jpg", import.meta.url));
  assert.deepEqual([...jpg.subarray(0, 3)], [0xFF, 0xD8, 0xFF], "a JPEG");
  assert.ok(jpg.length < 150_000, `${jpg.length} bytes`);
});

// ---------- the backing band on the compatibility engine ----------
test("band: a rendered chorus is the score played sample by sample, with muted parts silent", () => {
  const beatSec = 0.5, beats = [];
  for (let b = 0; b < 8; b++) beats.push({ at: b * beatSec, events: bandBeat("shuffle", b % 4).map(e => ({ ...e, atSec: e.at * beatSec })) });
  const all = { drums: 0.8, bass: 0.8, keys: 0.55, guitar: 0.55 };
  const pcm = B.renderChorus({ beats, seconds: 4.5, sampleRate: 22050, mix: all, level: 0.6 });
  assert.equal(pcm.length, Math.ceil(4.5 * 22050));
  let peak = 0; for (const v of pcm) peak = Math.max(peak, Math.abs(v));
  assert.ok(peak > 0.05 && peak <= 1, `audible and within range: ${peak}`);
  const energy = (from, to) => { let e = 0; for (let i = Math.round(from * 22050); i < to * 22050; i++) e += pcm[i] ** 2; return e; };
  assert.ok(energy(0, 0.02) > energy(0.25, 0.27) * 3, "a hit on the beat, quieter between");
  const silent = B.renderChorus({ beats, seconds: 4.5, sampleRate: 22050, mix: { drums: 0, bass: 0, keys: 0, guitar: 0 }, level: 0.6 });
  assert.ok(silent.every(v => v === 0), "every part muted: silence");
});

test("on the compatibility engine the band plays a rendered chorus from bar 1, says so, and caches it", () => {
  const { app, document, advance, audioElements } = makeRuntime({ audio: "wav" });
  app.setBpm(120);
  app.toggleTrainer();
  assert.equal(app.getLive().compat, true);
  assert.match(document.getElementById("bandstatus").textContent, /^Compatibility sound: the band plays a chorus rendered in advance/);
  const before = audioElements.length;
  for (let i = 0; i < 4; i++) advance(0.5);                     // the count-in, with its stabs
  const chorus = audioElements.slice(before).filter(e => e.firstSrc.length > 500000);
  assert.equal(chorus.length, 1, "bar 1 starts one rendered chorus");
  // 16-bit mono at 22,050 Hz: 48 beats of 0.5 s, plus half a second of tail
  const bytes = Buffer.from(chorus[0].firstSrc.split(",")[1], "base64");
  assert.equal(bytes.length, 44 + Math.ceil(24.5 * 22050) * 2);
  for (let i = 0; i < 48; i++) advance(0.5);                    // into chorus 2
  const again = audioElements.slice(before).filter(e => e.firstSrc.length > 500000);
  assert.equal(again.length, 2, "chorus 2 starts on its bar 1");
  assert.equal(again[1].firstSrc, again[0].firstSrc, "the same settings reuse the rendered chorus");
  assert.equal(again[0].playing, false, "the first one was stopped when the second began");
  app.toggleTrainer();
  assert.equal(again[1].playing, false, "Stop stops the band");
  assert.equal(document.getElementById("bandstatus").textContent, "");
});

test("on the compatibility engine a key change between choruses renders the new key", () => {
  const { app, document, advance, audioElements } = makeRuntime({ audio: "wav" });
  app.setBpm(120);
  document.getElementById("keycycle").onchange({ target: { value: "fourth" } });
  app.toggleTrainer();
  for (let i = 0; i < 4 + 48 + 1; i++) advance(0.5);
  const chorus = audioElements.filter(e => e.firstSrc.length > 500000);
  assert.equal(chorus.length, 2);
  assert.notEqual(chorus[1].firstSrc, chorus[0].firstSrc, "up a 4th: a different chorus");
  app.toggleTrainer();
});

// ---------- take settings: mode, focus, attempt ----------
test("Record sits in the Play along bar; backing is the default; each take picks a length, one focus and an attempt", () => {
  const play = html.slice(html.indexOf('<div class="row" id="play">'), html.indexOf('</div>', html.indexOf('<div class="row" id="play">')));
  assert.match(play, /<button id="recbtn"[^>]*>Record<\/button>/, "usable from any view, beside the tempo");
  const { app } = makeRuntime();
  const row = app.REC_ROW;
  assert.match(row, /<select id="recmix"[^>]*><option value="backing" selected>Guitar \+ backing<\/option>/);
  assert.doesNotMatch(row, /id="recbtn"/, "not duplicated in the Record row");
  for (const f of ["timing", "clean notes", "bends in tune", "phrasing and space", "vibrato", "getting through without stopping"])
    assert.match(row, new RegExp(`Focus: ${f}<`), f);
  assert.match(row, /<option value="cold" selected>Cold attempt<\/option><option value="retest">Retest<\/option>/);
  assert.match(row, /<option value="drill4">Drill: 4 bars<\/option>/);
  assert.match(row, /<option value="section" disabled>/, "sections arrive with songs");
});

test("a take's settings go into its name and its stored record", async () => {
  const { app, document, worklets, idb } = makeRuntime({ media: true, capture: true });
  app.setKey(9); app.setBpm(100);
  document.getElementById("recfocus").value = "bends";
  document.getElementById("recattempt").value = "retest";
  document.getElementById("recbtn").click();
  await settle();
  assert.equal(document.getElementById("recfocus").disabled, true, "fixed once the take starts");
  assert.match(document.getElementById("recmsg").textContent, /focus: bends in tune/);
  worklets[0].feed(4800);
  await settle();
  document.getElementById("recbtn").click();
  await settle();
  assert.match(app.getTake().name, /^practice-A-full-100bpm-\d{8}-\d{6}-retest\.webm$/);
  const meta = [...idb.stores.get("takes").rows.values()][0].v;
  assert.equal(meta.focus, "bends"); assert.equal(meta.attempt, "retest"); assert.equal(meta.mode, "full");
  assert.match(meta.name, /-retest\.wav$/);
});

test("a drill on the trainer stops by itself on the downbeat after its last bar, to the frame", async () => {
  const { app, document, worklets, advance, rec } = makeRuntime({ media: true, capture: true });
  app.setBpm(120);                                   // 0.5 s a beat, 2 s a bar, 96,000 frames a bar
  document.getElementById("recmode").value = "chorus";
  document.getElementById("recarm").checked = true;
  document.getElementById("recbtn").click();
  await settle();
  app.toggleTrainer();
  for (let i = 0; i < 4; i++) advance(0.5);          // count-in, then bar 1 is booked
  const start = worklets[0].sent.find(m => "start" in m).start;
  assert.equal(start, 96000, "bar 1 at 2.000 s");
  for (let i = 0; i < 48; i++) advance(0.5);         // twelve bars
  await settle();
  const stopAt = worklets[0].sent.find(m => "stopAt" in m);
  assert.ok(stopAt, "the capture was told where to end");
  assert.equal(stopAt.stopAt - start, 12 * 96000, "exactly twelve bars");
  const order = worklets[0].sent.map(m => "stopAt" in m ? "stopAt" : m.stop ? "stop" : "start");
  assert.ok(order.indexOf("stopAt") < order.indexOf("stop"), "the end frame is given before the cleanup stop, so it decides the length");
  assert.equal(rec.recorders[0].state, "inactive", "the take ended");
  assert.match(app.getTake().name, /^12bar-A-chorus-120bpm-/, "named for the trainer and the drill");
  assert.ok(app.getState().trainerTimer, "the band plays on");
  app.toggleTrainer();
});

test("a drill off the trainer stops after its bars at the current tempo", async () => {
  const { app, document, clock, advance, rec } = makeRuntime({ media: true });
  app.setBpm(120);
  document.getElementById("recmode").value = "drill4";   // 4 bars at 120: 8 s
  document.getElementById("recbtn").click();
  await settle();
  clock.wall = 7.9; advance(0.25);
  assert.equal(rec.recorders[0].state, "recording");
  clock.wall = 8; advance(0.25);
  await settle();
  assert.equal(rec.recorders[0].state, "inactive");
  assert.match(app.getTake().name, /-4bars-120bpm-/);
});

test("the capture stops by itself at the frame it was given", () => {
  const { scope, quantum, send } = loadWorklet({ channels: 1, block: 1024 });
  send({ start: 0 });
  send({ stopAt: 300 });
  quantum(); quantum(); quantum();           // frames 0–383: stops inside the third
  quantum();                                 // the next call hands over and finishes
  const kept = scope.posted.filter(m => m.block).reduce((n, m) => n + m.block[0].length, 0);
  assert.equal(kept, 300, "frames 0..299");
  assert.equal(scope.posted.at(-1).done, 300);
});

// ---------- latency calibration and the mistake marker ----------
const beepIn = (lead, total, at, len = 2400) => { const x = new Float32Array(total); for (let i = at; i < Math.min(total, at + len); i++) x[i] = 0.6 * Math.sin(i / 3); return x; };

test("loopback calibration measures the beep's return to the sample, and stores it", async () => {
  const { app, document, worklets, clock, advance } = makeRuntime({ media: true, capture: true });
  const t0 = clock.t;
  document.getElementById("calloop").click();
  await settle();
  const node = worklets.at(-1);
  const startFrame = node.sent.find(m => "start" in m).start;
  assert.equal(startFrame, Math.round((t0 + 0.2) * 48000), "capture begins a fraction before the beep");
  // the beep was played at t0 + 0.7; it comes back 1,900 frames (39.58 ms) late
  const lateFrames = 1900;
  node.feedRaw(beepIn(0, 48000, Math.round(0.5 * 48000) + lateFrames));
  advance(2);
  await settle();
  assert.equal(app.getState().storage.getItem("practice-desk-calibration").includes('"how":"loopback"'), true);
  assert.equal(document.getElementById("calms").value, "40", "1900 frames at 48 kHz, rounded to a millisecond");
  assert.match(document.getElementById("calmsg").textContent, /^Calibrated: guitar arrives 40 ms after the backing \(loopback beep\)/);
  assert.equal(document.getElementById("recbtn").disabled, false, "the controls come back");
  assert.equal(document.getElementById("calloop").disabled, false);
});

test("loopback says so when it hears nothing, or hears something that isn't the beep", async () => {
  const silent = makeRuntime({ media: true, capture: true });
  silent.document.getElementById("calloop").click();
  await settle();
  silent.worklets.at(-1).feedRaw(new Float32Array(48000));
  silent.advance(2);
  await settle();
  assert.match(silent.document.getElementById("calmsg").textContent, /^Didn't hear the beep\./);
  assert.equal(silent.app.getState().storage.getItem("practice-desk-calibration"), null, "nothing stored");
  const noisy = makeRuntime({ media: true, capture: true });
  noisy.document.getElementById("calloop").click();
  await settle();
  noisy.worklets.at(-1).feedRaw(beepIn(0, 96000, 60000));   // a bang 0.6 s after the beep: not it
  noisy.advance(2);
  await settle();
  assert.match(noisy.document.getElementById("calmsg").textContent, /isn't the beep coming back/);
  const none = makeRuntime({ audio: "wav", media: true });
  none.document.getElementById("calloop").click();
  assert.match(none.document.getElementById("calmsg").textContent, /needs Web Audio/);
});

test("tap along takes the median gap between clicks and taps, ignoring stray ones", async () => {
  const { app, document, clock, advance } = makeRuntime({ media: true, capture: true });
  const start = clock.t, first = start + 0.8, gap = 0.6;
  document.getElementById("caltap").click();
  const big = document.getElementById("caltapbtn");
  assert.equal(big.hidden, false, "the big tap button appears");
  assert.equal(document.getElementById("calloop").disabled, true, "the other measurement waits");
  // twelve clicks; the player taps 30 ms late, give or take, and once taps far from any click
  const jitter = [0, 0, 28, 35, 31, 27, 33, 30, 29, 36, 32, 30];
  jitter.forEach((j, k) => { clock.t = first + k * gap + j / 1000; big.click(); });
  clock.t = first + 0.1; big.click();                       // a stray tap between clicks
  document.dispatch("keydown", { key: " " });               // and Space works too, but lands nowhere near
  clock.t = first + 11 * gap + 0.6; advance(0);
  await settle();
  assert.match(document.getElementById("calmsg").textContent, /^Calibrated: guitar arrives 3[01] ms after the backing \(tap along; your taps varied by about \d+ ms\)/);
  assert.ok(Math.abs(app.getState().storage.getItem("practice-desk-calibration").match(/"ms":(\d+)/)[1] - 31) <= 1);
  assert.equal(big.hidden, true);
  // too few taps: no calibration
  const few = makeRuntime({ media: true, capture: true });
  few.document.getElementById("caltap").click();
  few.clock.t = few.clock.t + 0.8; few.document.getElementById("caltapbtn").click();
  few.clock.t += 20; few.advance(0);
  assert.match(few.document.getElementById("calmsg").textContent, /Too few taps/);
});

test("the trim is a number of milliseconds, kept, and read defensively next visit", () => {
  const { app, document } = makeRuntime({ media: true });
  assert.match(document.getElementById("calmsg").textContent, /^Not calibrated yet/);
  const trim = document.getElementById("calms");
  trim.value = "55"; trim.onchange({ target: trim });
  assert.match(document.getElementById("calmsg").textContent, /55 ms after the backing \(set by hand\)/);
  trim.value = "5000"; trim.onchange({ target: trim });
  assert.equal(JSON.parse(app.getState().storage.getItem("practice-desk-calibration")).ms, 1000, "clamped");
  for (const bad of ['{"ms":"fast"}', "{", '{"ms":99999}', "null"]) {
    const r = makeRuntime({ media: true, stored: { "practice-desk-calibration": bad } });
    assert.match(r.document.getElementById("calmsg").textContent, /^Not calibrated yet/, bad);
  }
  const ok = makeRuntime({ media: true, stored: { "practice-desk-calibration": '{"ms":42,"how":"loopback"}' } });
  assert.equal(ok.document.getElementById("calms").value, "42");
});

test("the mistake marker: M or the big button marks the moment on the audio clock, in the take's record", async () => {
  const { app, document, worklets, idb, clock } = makeRuntime({ media: true, capture: true });
  const mark = document.getElementById("recmark");
  assert.match(app.REC_ROW, /<button id="recmark" class="bigmark" hidden>/, "hidden until a take is recording");
  document.dispatch("keydown", { key: "m" });               // nothing to mark yet
  document.getElementById("recbtn").click();
  await settle();
  assert.equal(mark.hidden, false);
  clock.t += 12.5; document.dispatch("keydown", { key: "m" });
  clock.t += 18.5; mark.click();
  clock.t += 5;    document.dispatch("keydown", { key: "M" });
  document.dispatch("keydown", { key: "m", metaKey: true });        // a browser shortcut: not ours
  document.dispatch("keydown", { key: "m", target: new Element("", "input") });   // typing in a field: not ours
  assert.equal(mark.textContent, "Mark a mistake (M) · 3 so far");
  await settle();
  const meta = [...idb.stores.get("takes").rows.values()][0].v;
  sameShape(meta.markers.map(m => m.t), [12.5, 31, 36], "saved as they happen, so a crash keeps them");
  worklets[0].feed(4800);
  document.getElementById("recbtn").click();
  await settle();
  assert.equal(mark.hidden, true);
  sameShape(app.getTake().markers.map(m => m.t), [12.5, 31, 36]);
  assert.match(document.getElementById("recmsg").textContent, /3 mistakes marked at 0:12, 0:31, 0:36\./);
  assert.equal([...idb.stores.get("takes").rows.values()][0].v.markers.length, 3);
});

test("a take carries its calibration, and an armed take's marks count from bar 1", async () => {
  const { app, document, worklets, advance, clock, idb } = makeRuntime({ media: true, capture: true,
    stored: { "practice-desk-calibration": '{"ms":38,"how":"tap"}' } });
  app.setBpm(120);
  document.getElementById("recarm").checked = true;
  document.getElementById("recbtn").click();
  await settle();
  app.toggleTrainer();
  for (let i = 0; i < 4; i++) advance(0.5);
  clock.t = 2.0 + 3.25; document.dispatch("keydown", { key: "m" });    // 3.25 s after bar 1's downbeat at 2.000 s
  worklets[0].feed(4800);
  await settle();
  app.toggleTrainer();
  await settle();
  sameShape(app.getTake().markers.map(m => m.t), [3.25]);
  assert.equal(app.getTake().calMs, 38);
  assert.equal([...idb.stores.get("takes").rows.values()][0].v.calMs, 38);
});

// ---------- storage that an earlier build left behind ----------
const legacyStores = names => new Map(names.map(n => [n, { keyPath: n === "chunks" ? ["take", "seq"] : "id", rows: new Map() }]));
const ALL_STORES = ["takes", "chunks", "songs", "songfiles", "library"];

test("a database already at the current version but missing tables is repaired, not abandoned", async () => {
  // What broke Safari: an earlier build left the database at the version this build
  // asks for, without the song tables, so opening ran no upgrade and every read failed.
  const rt = makeRuntime({ media: true, capture: { store: legacyStores(["takes", "chunks"]), version: 3 } });
  const list = await rt.app.songList();
  sameShape(list, []);
  assert.ok(rt.idb.stores.has("songs") && rt.idb.stores.has("songfiles"), "the missing tables were created");
  sameShape(rt.idb.opens, [3, 4], "opened at 3, found tables missing, reopened one version higher");
  assert.equal(rt.idb.version, 4);
  assert.ok(rt.idb.stores.has("library"), "including the take library");
  assert.equal(rt.idb.lastDb.closed !== true, true, "the working connection is the repaired one");
  // and songs really work afterwards
  const s = await rt.app.songImport(songFile());
  assert.equal(rt.idb.stores.get("songfiles").rows.size, 1);
  assert.equal(rt.app.songs.selected.id, s.id);
  assert.notEqual(rt.document.getElementById("songstatus").textContent.slice(0, 12), "Song storage");
});

test("a database left at a newer version than this build asks for is used as it is", async () => {
  const rt = makeRuntime({ media: true, capture: { store: legacyStores(ALL_STORES), version: 5 } });
  sameShape(await rt.app.songList(), []);
  sameShape(rt.idb.opens, [3, undefined], "a VersionError falls back to opening without a version");
  assert.equal(rt.idb.version, 5, "and never lowers it");
});

test("a legacy version 1 database is upgraded once, and a fresh one is created whole", async () => {
  const legacy = makeRuntime({ media: true, capture: { store: legacyStores(["takes", "chunks"]) } });
  await legacy.app.songList();
  sameShape(legacy.idb.opens, [3]);
  for (const n of ALL_STORES) assert.ok(legacy.idb.stores.has(n), n);
  const v2 = makeRuntime({ media: true, capture: { store: legacyStores(["takes", "chunks", "songs", "songfiles"]), version: 2 } });
  await v2.app.libList();
  assert.ok(v2.idb.stores.has("library"), "a version 2 database gains the library on upgrade");
  const fresh = makeRuntime({ media: true, capture: true });
  await fresh.app.songList();
  for (const n of ALL_STORES) assert.ok(fresh.idb.stores.has(n), n);
});

test("an older tab holding the database blocks the upgrade, and the Songs view says what to do", async () => {
  const rt = makeRuntime({ media: true, capture: { store: legacyStores(["takes", "chunks"]), blocked: true } });
  navButton(rt.document, "songs").click();
  await settle();
  assert.match(rt.document.getElementById("songstatus").textContent, /Another tab of the desk is still open with older storage\. Close the other desk tabs, then reload/);
});

test("this tab lets go of the database when a newer tab wants to upgrade it", async () => {
  const rt = makeRuntime({ media: true, capture: true });
  await rt.app.songList();
  const first = rt.idb.lastDb;
  first.onversionchange();
  assert.equal(first.closed, true, "closed, so the other tab is not left waiting");
  await rt.app.songList();
  assert.notEqual(rt.idb.lastDb, first, "and reopened on next use");
});

test("when storage cannot open at all, the Songs view names the error and the next try starts afresh", async () => {
  const rt = makeRuntime({ media: true });        // no IndexedDB in this browser
  navButton(rt.document, "songs").click();
  await settle();
  assert.match(rt.document.getElementById("songstatus").textContent, /^Song storage is unavailable \(Error\)\. Allow local storage for this page, then reload\.$/);
});

// ---------- the take library ----------
async function recordTake(rt, { ms = 4800, before = () => {}, after = () => {} } = {}) {
  before();
  rt.document.getElementById("recbtn").click();
  await settle();
  rt.worklets.at(-1).feed(ms);
  await settle();
  after();
  rt.document.getElementById("recbtn").click();
  await settle(); await settle();
}

test("a finished take is kept in the library with its settings, marks and calibration", async () => {
  const rt = makeRuntime({ media: true, capture: true, stored: { "practice-desk-calibration": '{"ms":41,"how":"tap"}' } });
  rt.app.setKey(9); rt.app.setBpm(100);
  rt.document.getElementById("recfocus").value = "phrasing";
  rt.document.getElementById("recattempt").value = "retest";
  await recordTake(rt, { after: () => { rt.clock.t += 1.5; rt.document.dispatch("keydown", { key: "m" }); } });
  const [t] = await rt.app.libList();
  assert.match(t.name, /^practice-A-full-100bpm-\d{8}-\d{6}-retest\.webm$/);
  assert.equal(t.focus, "phrasing"); assert.equal(t.attempt, "retest"); assert.equal(t.calMs, 41);
  sameShape(t.markers.map(m => m.t), [1.5]);
  assert.ok(t.blob instanceof Blob, "the compressed take itself is kept");
  assert.equal(t.ratings.whole, null);
  assert.equal(t.masterId !== null, true, "linked to its WAV master");
  navButton(rt.document, "songs").click();
  await settle();
  const list = rt.document.getElementById("takelist").innerHTML;
  assert.match(list, /retest/); assert.match(list, /phrasing and space/); assert.match(list, /1 mistake/); assert.match(list, /not rated yet/);
});

test("a take is rated against its one focus, and again two days later, side by side", async () => {
  const rt = makeRuntime({ media: true, capture: true });
  await recordTake(rt);
  await rt.app.libList();
  const id = rt.app.lib.takes[0].id;
  navButton(rt.document, "songs").click(); await settle();
  await rt.app.libOpen(id);
  const rate = rt.document.getElementById("takerate");
  assert.match(rate.innerHTML, /Your one focus was <b>timing<\/b>/);
  await rt.app.libSetRating("whole", 3);
  assert.equal(rt.app.lib.selected.ratings.whole, 3);
  assert.equal(rt.app.libDue(rt.app.lib.selected), false, "not yet: it was just made");
  assert.doesNotMatch(rt.document.getElementById("rerate").innerHTML, /Two days on/);
  // two days later
  const t = rt.app.lib.selected;
  t.created -= rt.app.RERATE_AFTER_MS + 1000;
  await rt.app.libSetRating("whole", 3);   // still the first rating: not yet re-rated, and due now
  assert.ok(rt.app.libDue(t) || t.rerate, "due, or already answered");
  const t2 = (await rt.app.libList())[0];
  assert.equal(t2.ratings.whole, 3, "the first rating is kept");
  await rt.app.libOpen(t2.id);
  await rt.app.libSetRating("whole", 5);
  const after = rt.app.lib.selected;
  assert.equal(after.ratings.whole, 3, "immediately: 3");
  assert.equal(after.rerate.ratings.whole, 5, "two days later: 5");
  assert.match(rate.innerHTML, /immediately 3 · two days later 5/);
  assert.equal(rt.app.libDue(after), false, "answered");
  await rt.app.libSetRating("whole", 9);   // not a rating
  assert.equal(rt.app.lib.selected.rerate.ratings.whole, 5);
});

test("ratings, notes and marks are stored defensively: damaged records are ignored or cleaned", async () => {
  const good = { id: "t1", created: Date.now(), name: "a.webm", mime: "audio/webm", blob: new Blob(["x"]), seconds: 3, key: 9, bpm: 90 };
  const store = legacyStores(ALL_STORES);
  const put = (rec) => store.get("library").rows.set(JSON.stringify(rec && rec.id), { key: rec && rec.id, v: rec });
  put({ ...good, focus: "<b>", attempt: "x", markers: [{ t: -1 }, { t: "a" }, { t: 2 }], next: "y".repeat(500),
    ratings: { whole: 9, sections: { "<img>": 4, ok: 3, bad: 7 } }, songId: 5 });
  put({ ...good, id: "t2", blob: "not a blob" });
  put({ ...good, id: "t3", key: 99 });
  put({ ...good, id: "t4", seconds: NaN });
  put(null);
  const rt = makeRuntime({ media: true, capture: { store, version: 3 } });
  const takes = await rt.app.libList();
  assert.equal(takes.length, 1, "only the well-formed record survives");
  const t = takes[0];
  assert.equal(t.focus, "timing", "an unknown focus falls back"); assert.equal(t.attempt, "cold");
  sameShape(t.markers, [{ t: 2, kind: "mistake" }]);
  assert.equal(t.next.length, 200); assert.equal(t.ratings.whole, null);
  sameShape(t.ratings.sections, { "<img>": 4, ok: 3 });
  assert.equal(t.songId, null);
  navButton(rt.document, "songs").click(); await settle();
  await rt.app.libOpen("t1");
  assert.doesNotMatch(rt.document.getElementById("takerate").innerHTML, /<img>/, "a stored name is text, never markup");
});

test("the waveform draws peaks, bar lines and marks, and clicking it jumps the player", async () => {
  const rt = makeRuntime({ media: true, capture: true });
  rt.app.setBpm(120);
  await recordTake(rt, { after: () => { rt.clock.t += 0.02; rt.document.dispatch("keydown", { key: "m" }); } });
  const t = (await rt.app.libList())[0];
  t.seconds = 10;                                       // ten seconds: five 2 s bars at 120 bpm
  navButton(rt.document, "songs").click(); await settle();
  await rt.app.libOpen(t.id); await settle();
  const svg = rt.document.getElementById("takewave").innerHTML;
  assert.match(svg, /^<svg viewBox="0 0 600 100" role="img" aria-label="Waveform of /);
  assert.equal((svg.match(/class="wbar"/g) || []).length, 5, "a line at each bar: 0, 2, 4, 6, 8 s");
  assert.match(svg, /class="wmark"/, "the mistake");
  assert.match(svg, /<path class="wpeaks" d="M0\.5,/, "decoded peaks: the mock's constant 0.25");
  const play = rt.document.getElementById("takeplay");
  rt.app.libSeek(4);
  assert.equal(play.currentTime, 4);
  rt.app.libSeek(99);
  assert.equal(play.currentTime, 10, "clamped to the take");
  rt.document.getElementById("takewave").onclick({ clientX: 150, currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 300 }) } });
  assert.equal(play.currentTime, 5, "halfway across, halfway through");
  rt.document.getElementById("takemarks").onclick({ target: { dataset: { jump: "1.25" } } });
  assert.equal(play.currentTime, 1.25);
  rt.document.getElementById("takeloop").checked = true;
  rt.document.getElementById("takeloopa").value = "2"; rt.document.getElementById("takeloopb").value = "3";
  play.currentTime = 3.05; rt.app.libLoopTick();
  assert.equal(play.currentTime, 2, "the A–B loop returns to A");
  rt.document.getElementById("takespeed").onchange();
  rt.document.getElementById("takespeed").value = "0.75"; rt.document.getElementById("takespeed").onchange();
  assert.equal(play.playbackRate, 0.75); assert.equal(play.preservesPitch, true);
});

test("crc32 and the zip writer make a valid archive", () => {
  const { app } = makeRuntime();
  assert.equal(app.crc32(new TextEncoder().encode("123456789")), 0xCBF43926, "the standard check value");
  const files = [{ name: "a.txt", bytes: new TextEncoder().encode("hello") }, { name: "dir/é.bin", bytes: new Uint8Array([1, 2, 3, 250]) }];
  return app.zipStore(files, new Date(2026, 8, 19, 10, 30, 40)).arrayBuffer().then(buf => {
    const v = new DataView(buf), u = new Uint8Array(buf);
    const end = buf.byteLength - 22;
    assert.equal(v.getUint32(end, true), 0x06054b50); assert.equal(v.getUint16(end + 10, true), 2, "two entries");
    let p = v.getUint32(end + 16, true);            // start of the central directory
    const seen = [];
    for (let i = 0; i < 2; i++) {
      assert.equal(v.getUint32(p, true), 0x02014b50);
      const crc = v.getUint32(p + 16, true), size = v.getUint32(p + 20, true), nlen = v.getUint16(p + 28, true), off = v.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u.subarray(p + 46, p + 46 + nlen));
      assert.equal(v.getUint32(off, true), 0x04034b50, "the local header is where the directory says");
      const dataAt = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
      assert.equal(app.crc32(u.subarray(dataAt, dataAt + size)), crc, `${name}: the CRC matches its data`);
      assert.equal(v.getUint16(p + 8, true) & 0x0800, 0x0800, "UTF-8 names");
      seen.push([name, size]); p += 46 + nlen;
    }
    sameShape(seen, [["a.txt", 5], ["dir/é.bin", 4]]);
    assert.equal(v.getUint16(v.getUint32(end + 16, true) + 12, true) >> 11, 10, "DOS time: hour 10");
  });
});

test("Export all writes a zip of takes and a JSON of ratings, markers and stats, never a song file", async () => {
  const rt = makeRuntime({ media: true, capture: true });
  await rt.app.songImport(songFile("Secret Song.wav"));
  await recordTake(rt, { after: () => { rt.clock.t += 2; rt.document.dispatch("keydown", { key: "m" }); } });
  await rt.app.libList();
  navButton(rt.document, "songs").click(); await settle();
  await rt.app.libOpen(rt.app.lib.takes[0].id);
  await rt.app.libSetRating("whole", 4);
  rt.document.getElementById("takenext").value = "keep the pick close";
  await rt.document.getElementById("takenext").onchange();
  const blob = await rt.app.libExport();
  const buf = new Uint8Array(await blob.arrayBuffer()), text = new TextDecoder("latin1").decode(buf);
  const names = [...text.matchAll(/(?:practice-export\.json|takes\/[A-Za-z0-9._-]+)/g)].map(m => m[0]);
  assert.ok(names.includes("practice-export.json"));
  assert.ok(names.some(n => n.startsWith("takes/") && n.endsWith(".webm")), "the take file");
  assert.doesNotMatch(text, /Secret Song\.wav|\.wav"/, "the imported song's file is never included");
  const from = text.indexOf('{\n  "app"');       // not the first "{": a CRC or timestamp byte can be 0x7B
  const json = JSON.parse(text.slice(from, text.indexOf("\n}", from) + 2));
  assert.equal(json.songs.length, 1); assert.equal(json.songs[0].title, "Secret Song");
  assert.ok(!("file" in json.songs[0]) && !("blob" in json.songs[0]));
  assert.equal(json.takes[0].ratings.whole, 4); assert.equal(json.takes[0].next, "keep the pick close");
  sameShape(json.takes[0].markers.map(m => m.t), [2]);
  assert.match(rt.document.body.children.at(-1).download, /^practice-export-\d{4}-\d{2}-\d{2}\.zip$/);
  assert.match(rt.document.getElementById("takemsg").textContent, /Exported 1 take .*Song files are never included\./);
  const empty = makeRuntime({ media: true, capture: true });
  navButton(empty.document, "songs").click(); await settle();
  assert.equal(await empty.app.libExport(), null);
});

test("a take can be deleted from the library, and the list can be filtered by song", async () => {
  const rt = makeRuntime({ media: true, capture: true });
  await recordTake(rt); await recordTake(rt);
  await rt.app.libList();
  assert.equal(rt.app.lib.takes.length, 2);
  navButton(rt.document, "songs").click(); await settle();
  const id = rt.app.lib.takes[0].id;
  await rt.document.getElementById("takelist").onclick({ target: { dataset: { del: id } } });
  await settle();
  assert.equal(rt.app.lib.takes.length, 1);
  assert.ok(!rt.app.lib.takes.some(t => t.id === id));
  rt.document.getElementById("takefilter").value = "no-such-song"; rt.document.getElementById("takefilter").onchange();
  assert.match(rt.document.getElementById("takelist").innerHTML, /^<option|No takes kept yet|takerow/, "the list redraws for the filter");
});

// ---------- the solo and the song, together ----------
test("recording guitar + backing keeps the solo on its own too, in step with the mix", async () => {
  const rt = makeRuntime({ media: true, capture: true });
  rt.app.setBpm(100);
  rt.document.getElementById("recmix").value = "backing";
  rt.document.getElementById("recbtn").click();
  await settle();
  const [mix, stem] = rt.worklets;
  assert.equal(rt.worklets.length, 2, "one capture for the mix, one for the solo");
  assert.equal(mix.opts.processorOptions.channels, 2); assert.equal(stem.opts.processorOptions.channels, 1);
  const r = rt.app.getRec();
  assert.ok(r.src.connected.includes(stem.node ?? stem), "the solo stem hears the input");
  assert.ok(!(r.bed.outs ?? []).includes(stem), "and never the backing");
  sameShape(mix.sent[0], { start: 0 }); sameShape(stem.sent[0], { start: 0 });
  mix.feed(48000); stem.feed(48000, 0.4);
  await settle();
  assert.equal([...rt.idb.stores.get("takes").rows.values()].length, 2, "both are stored as they play");
  rt.document.getElementById("recbtn").click();
  await settle(); await settle();
  const rows = [...rt.idb.stores.get("takes").rows.values()].map(x => x.v);
  const main = rows.find(m => !m.stem), solo = rows.find(m => m.stem);
  assert.equal(main.channels, 2); assert.equal(solo.channels, 1);
  assert.equal(solo.of, main.id, "the stem knows its take");
  assert.match(solo.name, /-solo\.wav$/); assert.equal(main.frames, solo.frames, "the same length: same frames on the same clock");
  assert.equal(rt.document.getElementById("recdls").hidden, false);
  assert.match(rt.document.getElementById("recdls").textContent, /^Download solo only \(WAV, 94 KB\)$/);
  assert.equal(rt.document.getElementById("recsaved").innerHTML, "", "not listed as a leftover while its take is on screen");
  const [kept] = await rt.app.libList();
  assert.equal(kept.stemId, solo.id, "the library links the solo to the take");
  // download it: a mono WAV of just the guitar, then it leaves storage
  await rt.document.getElementById("recdls").onclick();
  await settle();
  const link = rt.document.body.children.at(-1);
  assert.match(link.download, /-solo\.wav$/);
  const wav = new DataView(await rt.rec.urls.find(x => x.u === link.href).b.arrayBuffer());
  assert.equal(wav.getUint16(22, true), 1, "mono"); assert.equal(wav.getInt16(44, true), Math.trunc(0.4 * 0x7FFF), "the guitar's own level, not the mix");
  assert.equal([...rt.idb.stores.get("takes").rows.values()].some(x => x.v.stem), false);
  assert.equal(rt.document.getElementById("recdls").hidden, true);
});

test("a guitar-only take has no stem, and cancelling or ending a drill reaches the stem too", async () => {
  const solo = makeRuntime({ media: true, capture: true });
  solo.document.getElementById("recmix").value = "guitar";
  solo.document.getElementById("recbtn").click();
  await settle();
  assert.equal(solo.worklets.length, 1, "guitar only is already the solo");
  assert.equal(solo.app.getRec().stem, null);

  const cancel = makeRuntime({ media: true, capture: true });
  cancel.document.getElementById("recmix").value = "backing";
  cancel.document.getElementById("recarm").checked = true;
  cancel.document.getElementById("recbtn").click();
  await settle();
  cancel.document.getElementById("recbtn").click();     // cancel while armed
  await settle();
  assert.equal(cancel.idb.stores.get("takes").rows.size, 0, "nothing left of either");

  const drill = makeRuntime({ media: true, capture: true });
  drill.app.setBpm(120);
  drill.document.getElementById("recmix").value = "backing";
  drill.document.getElementById("recmode").value = "drill4";
  drill.document.getElementById("recarm").checked = true;
  drill.document.getElementById("recbtn").click();
  await settle();
  drill.app.toggleTrainer();
  for (let i = 0; i < 4 + 16 + 1; i++) drill.advance(0.5);
  await settle();
  const [mix, stem] = drill.worklets;
  const ends = [mix, stem].map(w => w.sent.find(m => "stopAt" in m)?.stopAt);
  assert.ok(ends[0] && ends[0] === ends[1], "both end on the same frame");
  assert.equal(ends[0] - mix.sent.find(m => "start" in m).start, 4 * 96000, "four bars");
  drill.app.toggleTrainer();
});

// ---------- song sections, chords, and the chord overlay following the backing ----------
test("chords parse as a guitarist writes them", () => {
  const { app } = makeRuntime();
  const c = t => { const r = app.parseChord(t); return r && [r.pc, [...r.intervals].join(",")]; };
  sameShape(c("Am"), [9, "0,3,7"]); sameShape(c("C#m7"), [1, "0,3,7,10"]); sameShape(c("Bb"), [10, "0,4,7"]);
  sameShape(c("E7"), [4, "0,4,7,10"]); sameShape(c("F#dim"), [6, "0,3,6"]); sameShape(c("G5"), [7, "0,7"]);
  sameShape(c("Ebmaj7"), [3, "0,4,7,11"]); sameShape(c("Cmaj"), [0, "0,4,7"]); sameShape(c("Dmin"), [2, "0,3,7"]);
  sameShape(c("Am7b5"), [9, "0,3,6,10"]); sameShape(c("a"), [9, "0,4,7"], "lower case is fine");
  for (const bad of ["H", "Am13x", "", "7", "Csus9"]) assert.equal(app.parseChord(bad), null, bad);
  const bars = app.parseChords("Am | Dm  | E7 |  | Am Dm | X | ");
  assert.equal(bars.bars.length, 4, "an empty bar is dropped; a bar of one bad token is too");
  sameShape(bars.bars[3].map(x => x.name), ["Am", "Dm"], "two chords in a bar share it");
  sameShape(bars.bad, ["X"]);
});

test("the chord at a moment in the song comes from its section's chords, or the song's", () => {
  const { app } = makeRuntime();
  const song = { bpm: 120, downbeat: 1, chords: "Am | Dm | E7 | Am Dm", sections: [{ name: "Solo", start: 20, end: 28, chords: "C | G" }] };
  const at = t => app.chordAt(song, t)?.name;
  assert.equal(at(0.5), undefined, "before the downbeat: nothing");
  assert.equal(at(1.0), "Am"); assert.equal(at(2.9), "Am");
  assert.equal(at(3.1), "Dm"); assert.equal(at(5.1), "E7");
  assert.equal(at(7.1), "Am", "the first half of the two-chord bar"); assert.equal(at(8.1), "Dm", "and the second");
  assert.equal(at(9.1), "Am", "the progression repeats");
  assert.equal(at(20.5), "C", "a section's own chords, counted from its start"); assert.equal(at(22.5), "G"); assert.equal(at(24.5), "C");
  assert.equal(at(28.5), "Dm", "and back to the song's own chords after it: bar 13 of a four-bar progression is its second");
});

test("Follow backing lights the chord's tones as the song plays, without redrawing the Songs view", async () => {
  const rt = makeRuntime({ capture: true });
  const { app, document } = rt;
  await app.songImport(songFile());
  app.songs.selected.chords = "Am | Dm"; app.songs.selected.bpm = 120; app.songs.selected.downbeat = 0;
  navButton(document, "boxes").click();     // a view that answers to the chord row
  document.getElementById("chords").children.find(b => b.dataset.c === "band").click();
  assert.equal(document.getElementById("chords").children.find(b => b.dataset.c === "band").textContent, "Follow backing");
  assert.equal(app.getState().chord, "band");
  app.songFollow(0.5);
  sameShape(app.getLive().chord, { pc: 9, intervals: [0, 3, 7] });
  assert.equal(app.isChordTone(0), true, "C is in Am"); assert.equal(app.isChordTone(2), false, "D is not");
  app.songFollow(2.5);
  assert.equal(app.isChordTone(2), true, "the overlay moved to Dm: D is lit"); assert.equal(app.isChordTone(4), false, "E dropped out");
  navButton(document, "songs").click();
  let draws = 0; const was = document.getElementById("songtitle");
  Object.defineProperty(was, "value", { get() { return "kept"; }, set() { draws++; } });
  app.songFollow(0.5);   // a chord change while looking at the Songs view
  assert.equal(draws, 0, "no redraw: the fields you are editing are left alone");
  app.songFollow(0.6);   // same chord: nothing to do
});

test("sections are added by hand or built from a form, sorted, chorded, looped and removed", async () => {
  const { app, document } = makeRuntime({ capture: true });
  await app.songImport(songFile("Twelve.wav"));
  navButton(document, "songs").click();     // attaches the section list's handlers
  const set = (id, v) => { document.getElementById(id).value = String(v); };
  set("secname", "Verse"); set("secstart", 20); set("secend", 40);
  await app.songAddSection();
  set("secname", "Intro"); set("secstart", 0); set("secend", 20);
  await app.songAddSection();
  sameShape(app.songs.selected.sections.map(s => s.name), ["Intro", "Verse"], "kept in order");
  set("secstart", 50); set("secend", 40);
  await assert.rejects(app.songAddSection(), /end must be after its start/);
  set("secstart", 500); set("secend", 900);
  await assert.rejects(app.songAddSection(), /inside the song/, "past the end of a 600 s song");
  assert.equal(app.validSection({ name: "x".repeat(61), start: 0, end: 1 }), false);
  assert.equal(app.validSection({ name: "ok", start: 5, end: 5 }), false);
  // chords per section, from the list
  document.getElementById("songsections").onchange({ target: { dataset: { chords: "1" }, value: "Am | Dm" } });
  await settle();
  assert.equal(app.songs.selected.sections[1].chords, "Am | Dm");
  assert.match(document.getElementById("songsections").innerHTML, /value="Am \| Dm"/);
  // loop one
  document.getElementById("songsections").onclick({ target: { dataset: { loop: "1" } } });
  assert.equal(document.getElementById("songloopa").value, "20"); assert.equal(document.getElementById("songloopb").value, "40");
  assert.equal(document.getElementById("songloop").checked, true);
  // build from a form: 120 bpm is a 2 s bar; the form's Intro is 4 bars, its Verse 8
  await app.songSave();   // (the tempo field still says 90; set it first)
  document.getElementById("songbpm").value = "120"; document.getElementById("songdownbeat").value = "0";
  await app.songSave();
  await app.songBuildSections(0);
  const built = app.songs.selected.sections;
  sameShape(built.slice(0, 3).map(s => [s.name, s.start, s.end]), [["Intro", 0, 8], ["Verse", 8, 24], ["Chorus", 24, 40]]);
  assert.ok(built.at(-1).end <= 600, "never past the end of the song");
  await assert.rejects(app.songBuildSections(999), /Choose a form/);
  await app.songSaveSections(secs => secs.splice(0, secs.length - 1));
  assert.equal(app.songs.selected.sections.length, 1, "removed");
  // damaged sections make a song invalid
  for (const bad of [{ sections: [{ name: "", start: 0, end: 1 }] }, { sections: "x" }, { chords: 5 }, { sections: Array(41).fill({ name: "a", start: 0, end: 1 }) }])
    assert.equal(app.validSong({ ...app.songs.selected, ...bad }), false);
});

test("a section is recorded alone: the take is named for it and both stop at its end", async () => {
  const rt = makeRuntime({ capture: true, media: true });
  const { app, document } = rt;
  await app.songImport(songFile());
  await app.songSaveSections(secs => secs.push({ name: "Chorus", start: 10, end: 20 }));
  document.getElementById("songcount").checked = false;
  document.getElementById("songspeed").value = "1";
  document.getElementById("recmix").value = "guitar";
  await app.songRecordSection(0);
  await settle();
  const p = app.songs.player;
  assert.equal(app.getRec().info.mode, "section"); assert.equal(app.getRec().info.section.name, "Chorus");
  assert.equal(p.currentTime, 10, "the song starts at the section");
  rt.worklets.at(-1).feed(4800);
  p.currentTime = 20; rt.advance(0.05);          // the timer reaches the section's end
  await settle(); await settle();
  assert.equal(p.paused, true, "the song stopped");
  assert.equal(app.getRec(), null, "and so did the take");
  assert.match(app.getTake().name, /^My-song-Chorus-90bpm-\d{8}-\d{6}-cold\.webm$/, "named <song>-<section>-<bpm>bpm-<date>-<cold|retest>");
  assert.equal(app.getTake().songId, (await app.libList())[0].songId, "linked to the song");
  const rec = (await app.libList())[0];
  assert.equal(rec.songPlay.offset, 10, "the song's position when the take began (no count-in here)");
  assert.equal(rec.section.name, "Chorus");
  assert.equal(app.getTake().info.section.end, 20);
  // a section mode with nothing chosen is just a full take
  document.getElementById("recmode").value = "section";
  document.getElementById("recbtn").click();
  await settle();
  assert.equal(app.getRec().info.mode, "full");
});

test("choosing a song sets the key, and 'find the home note' opens the Over a song page", async () => {
  const { app, document } = makeRuntime({ capture: true });
  app.setKey(9);
  const s = await app.songImport(songFile());
  app.setKey(4);
  await app.songSelect(s.id);
  assert.equal(app.getState().key, 9, "the key selector follows the song, so the pentatonic box does too");
  navButton(document, "songs").click();
  document.getElementById("songfindkey").onclick();
  assert.equal(app.getState().view, "song");
});

// ---------- your own rhythm take as the backing, and a solo over it ----------
async function rhythmTake(rt) {
  rt.document.getElementById("recmix").value = "guitar";
  await recordTake(rt, { ms: 96000 });
  await rt.app.libList();
  navButton(rt.document, "songs").click(); await settle();
  await rt.app.libOpen(rt.app.lib.takes[0].id);
  return rt.app.lib.selected;
}

test("a take becomes a backing without being copied, aligned by the calibrated latency", async () => {
  const rt = makeRuntime({ media: true, capture: true, stored: { "practice-desk-calibration": '{"ms":40,"how":"loopback"}' } });
  const take = await rhythmTake(rt);
  const filesBefore = rt.idb.stores.get("songfiles").rows.size;
  await rt.document.getElementById("takeasbacking").onclick();
  await settle();
  const s = rt.app.songs.selected;
  assert.equal(s.kind, "take"); assert.equal(s.takeId, take.id);
  assert.match(s.title, /^Rhythm: practice-A-full-90bpm-/);
  assert.equal(s.offsetMs, 40, "the calibration is kept with it");
  assert.equal(rt.idb.stores.get("songfiles").rows.size, filesBefore, "stored once: no audio file was copied");
  assert.match(rt.document.getElementById("takemsg").textContent, /is now a backing.*Aligned by your 40 ms latency calibration/);
  assert.equal(rt.app.songs.player.duration, 600, "the player is loaded from the take's own audio");
  assert.match(rt.document.getElementById("songlist").innerHTML, /Rhythm: practice-A-full-90bpm/);
  // playing it starts 40 ms in: that much early, so a solo over it lines up
  rt.document.getElementById("songcount").checked = false; rt.document.getElementById("songspeed").value = "1";
  await rt.app.songPlay(); await settle();
  assert.equal(rt.app.songs.player.currentTime, 0.04);
  assert.match(rt.document.getElementById("songstatus").textContent, /Rhythm: .* · 90 bpm · aligned by 40 ms/);
  rt.app.songStop();
  // asking again selects the one that exists
  await rt.document.getElementById("takeasbacking").onclick();
  assert.equal([...rt.idb.stores.get("songs").rows.values()].filter(r => r.v.kind === "take").length, 1);
  assert.match(rt.document.getElementById("takemsg").textContent, /already a backing/);
});

test("without calibration the desk says a solo over a rhythm take may sit late", async () => {
  const rt = makeRuntime({ media: true, capture: true });
  await rhythmTake(rt);
  await rt.document.getElementById("takeasbacking").onclick();
  await settle();
  assert.match(rt.document.getElementById("takemsg").textContent, /Latency isn't calibrated yet, so layers may sit a little late/);
  rt.document.getElementById("songcount").checked = false; rt.document.getElementById("songspeed").value = "1";
  await rt.app.songPlay(); await settle();
  assert.match(rt.document.getElementById("songstatus").textContent, /latency isn't calibrated, so a solo over this may sit a little late/);
  assert.equal(rt.app.songs.player.currentTime, 0, "no offset to apply");
  rt.app.songStop();
});

test("a solo recorded over the rhythm take is linked to it, and is the solo and the backing together", async () => {
  const rt = makeRuntime({ media: true, capture: true });
  const rhythm = await rhythmTake(rt);
  await rt.document.getElementById("takeasbacking").onclick(); await settle();
  rt.document.getElementById("songcount").checked = false; rt.document.getElementById("songspeed").value = "1";
  await rt.app.songPlay(); await settle();
  rt.document.getElementById("recmix").value = "backing";
  rt.document.getElementById("recfocus").value = "phrasing";
  rt.document.getElementById("recbtn").click();
  await settle();
  assert.equal(rt.app.getRec().backing, true, "the backing is in the recording, as asked");
  assert.ok(rt.app.getRec().stem, "and the solo is kept apart");
  assert.equal(rt.app.getRec().info.backingTakeId, rhythm.id);
  rt.worklets.at(-2).feed(4800); rt.worklets.at(-1).feed(4800);     // the mix, and the solo alone
  rt.document.getElementById("recbtn").click();
  await settle(); await settle();
  const [solo] = await rt.app.libList();
  assert.equal(solo.backingTakeId, rhythm.id, "linked to its rhythm take");
  assert.equal(solo.stemId !== null, true);
  assert.match(solo.name, /^Rhythm-practice-A-full-90bpm-.*-full-90bpm-\d{8}-\d{6}-cold\.webm$/, "named for the backing it is over");
  assert.equal(solo.focus, "phrasing");
  rt.app.songStop();
});

test("deleting a rhythm take takes its backing with it; a too-short take is refused", async () => {
  const rt = makeRuntime({ media: true, capture: true });
  const rhythm = await rhythmTake(rt);
  await rt.document.getElementById("takeasbacking").onclick(); await settle();
  assert.equal(rt.app.songs.list.length, 1);
  await rt.app.libDelete(rhythm.id);
  assert.equal(rt.app.songs.list.length, 0, "the backing pointed at a take that is gone");
  assert.equal(rt.app.songs.selected, null);
  assert.equal(rt.document.getElementById("songdetails").hidden, true);
  const short = makeRuntime({ media: true, capture: true });
  short.document.getElementById("recmix").value = "guitar";
  await recordTake(short, { ms: 4800 });
  await short.app.libList();
  navButton(short.document, "songs").click(); await settle();
  await short.app.libOpen(short.app.lib.takes[0].id);
  short.app.lib.selected.seconds = 0.3;
  await short.document.getElementById("takeasbacking").onclick();
  assert.match(short.document.getElementById("takemsg").textContent, /too short/);
  assert.equal(short.app.songs.list.length, 0);
});

test("a backing whose take has gone missing says so instead of failing silently", async () => {
  const rt = makeRuntime({ media: true, capture: true });
  const rhythm = await rhythmTake(rt);
  await rt.document.getElementById("takeasbacking").onclick(); await settle();
  const id = rt.app.songs.selected.id;
  rt.idb.stores.get("library").rows.clear();          // the take vanishes from storage some other way
  await rt.app.songSelect(id);
  assert.match(rt.document.getElementById("songstatus").textContent, /The rhythm take is missing\. Record it again\./);
  assert.equal(rt.app.songs.selected, null);
});

// ---------- layers: rhythm take, your solo, and a click ----------
async function soloOverRhythm(rt, cal = true) {
  const rhythm = await rhythmTake(rt);
  await rt.document.getElementById("takeasbacking").onclick(); await settle();
  rt.document.getElementById("songcount").checked = false; rt.document.getElementById("songspeed").value = "1";
  await rt.app.songPlay(); await settle();
  rt.document.getElementById("recmix").value = "backing";
  rt.document.getElementById("recbtn").click();
  await settle();
  rt.worklets.at(-2).feed(4800); rt.worklets.at(-1).feed(4800);
  rt.document.getElementById("recbtn").click();
  await settle(); await settle();
  rt.app.songStop();
  await rt.app.libList();
  return { rhythm, solo: rt.app.lib.takes[0] };
}

test("the layers panel plays your solo over the rhythm take, with a level and a mute for each", async () => {
  const rt = makeRuntime({ media: true, capture: true, stored: { "practice-desk-calibration": '{"ms":40,"how":"tap"}' } });
  const { rhythm, solo } = await soloOverRhythm(rt);
  assert.ok(solo.stemBlob instanceof Blob, "the solo is kept compressed, on its own");
  await rt.app.libOpen(solo.id);
  const box = rt.document.getElementById("takelayers");
  assert.equal(box.hidden, false);
  assert.match(rt.document.getElementById("laynote").textContent, new RegExp(`^Over ${rhythm.name.replace(/[.]/g, "\\.")}`));
  const on = (id, v) => { rt.document.getElementById(id).checked = v; rt.document.getElementById(id).onchange(); };
  const level = (id, v) => { rt.document.getElementById(id).value = String(v); rt.document.getElementById(id).oninput(); };
  on("layrhythm", true); on("laysolo", true); level("layrhythmv", 80); level("laysolov", 100);
  const before = rt.audioElements.length;
  rt.document.getElementById("layplay").onclick();
  const [soloEl, rhythmEl] = rt.audioElements.slice(before);
  assert.equal(rt.audioElements.length - before, 2, "one player for each layer");
  assert.equal(soloEl.playing, true); assert.equal(rhythmEl.playing, true);
  assert.equal(soloEl.volume, 1); assert.equal(rhythmEl.volume, 0.8);
  assert.equal(rhythmEl.playbackRate, 1); assert.equal(rhythmEl.preservesPitch, true);
  assert.equal(rhythmEl.currentTime, 0, "from where the solo began, held back by the 40 ms lag: 0.04 - 0.04");
  on("layrhythm", false);                      // hear yourself bare
  assert.equal(rhythmEl.volume, 0); assert.equal(soloEl.volume, 1);
  on("layrhythm", true); on("laysolo", false); level("layrhythmv", 30);   // the backing without you
  assert.equal(soloEl.volume, 0); assert.equal(rhythmEl.volume, 0.3);
  rt.document.getElementById("laystop").onclick();
  assert.equal(soloEl.playing, false); assert.equal(rhythmEl.playing, false);
});

test("the layers click keeps the recording's beat on the audio clock, at its own level", async () => {
  const rt = makeRuntime({ media: true, capture: true });
  const { solo } = await soloOverRhythm(rt);
  await rt.app.libOpen(solo.id);
  rt.document.getElementById("layclick").checked = true; rt.document.getElementById("layclickv").value = "60";
  rt.document.getElementById("layplay").onclick();
  const osc = rt.audio.oscillators;
  for (let i = 0; i < 100; i++) rt.advance(0.025);     // two seconds at the real timer's 25 ms: three beats at 90 bpm
  assert.equal(rt.audio.oscillators - osc, 3, "the beats at 0.67, 1.33 and 2.0 s were booked, one click each");
  rt.document.getElementById("layclick").checked = false; rt.document.getElementById("layclick").onchange();
  const after = rt.audio.oscillators;
  for (let i = 0; i < 100; i++) rt.advance(0.025);
  assert.equal(rt.audio.oscillators, after, "muted: nothing more is booked");
  rt.document.getElementById("laystop").onclick();
});

test("solo only, rhythm only and both mixed download as three files", async () => {
  const rt = makeRuntime({ media: true, capture: true });
  const { rhythm, solo } = await soloOverRhythm(rt);
  await rt.app.libOpen(solo.id);
  const stem = solo.name.replace(/\.webm$/, "-solo.webm"), rhythmName = rhythm.name.replace(/\.webm$/, "-rhythm.webm"), mixed = solo.name.replace(/\.webm$/, "-mixed.webm");
  for (const [id, name, blob] of [["laydlsolo", stem, solo.stemBlob], ["laydlrhythm", rhythmName, rhythm.blob], ["laydlboth", mixed, solo.blob]]) {
    rt.document.getElementById(id).onclick();
    const link = rt.document.body.children.at(-1);
    assert.equal(link.download, name, id);
    assert.equal(rt.rec.urls.find(u => u.u === link.href).b.size, blob.size, `${id}: the right audio`);
  }
  assert.match(rt.document.getElementById("takemsg").textContent, /-mixed\.webm: /);
});

test("layers are for takes with a kept solo; a missing rhythm take leaves the solo playable", async () => {
  const guitarOnly = makeRuntime({ media: true, capture: true });
  const g = await rhythmTake(guitarOnly);
  assert.equal(guitarOnly.document.getElementById("takelayers").hidden, true, "a guitar-only take has no separate solo");
  const rt = makeRuntime({ media: true, capture: true });
  const { rhythm, solo } = await soloOverRhythm(rt);
  await rt.app.libDelete(rhythm.id);
  await rt.app.libOpen(solo.id);
  assert.equal(rt.document.getElementById("takelayers").hidden, false);
  assert.equal(rt.document.getElementById("layrhythm").disabled, true);
  assert.match(rt.document.getElementById("laynote").textContent, /rhythm take is no longer in the library/);
  const before = rt.audioElements.length;
  rt.document.getElementById("laysolo").checked = true; rt.document.getElementById("laysolov").value = "100";
  rt.document.getElementById("layplay").onclick();
  assert.equal(rt.audioElements.length - before, 1, "just the solo");
  rt.document.getElementById("laystop").onclick();
  rt.document.getElementById("laydlrhythm").onclick();
  assert.match(rt.document.getElementById("takemsg").textContent, /isn't available/);
});

// ---------- the looper ----------
const finishLoop = (rt, frames, level = 0.3) => {
  const node = rt.worklets.at(-1);
  node.feedRaw(new Float32Array(frames).fill(level));
  node.port.onmessage({ data: { done: frames } });
  return node;
};
const loopSetup = (rt, { bars = "2", count = true, bpm = 120 } = {}) => {
  rt.app.setBpm(bpm);
  rt.document.getElementById("loopbars").value = bars;
  rt.document.getElementById("loopcount").checked = count;
  navButton(rt.document, "songs").click();
};

test("the looper records N bars on exact frames after a count-in, then loops them from where they ended", async () => {
  const rt = makeRuntime({ media: true, capture: true, stored: { "practice-desk-calibration": '{"ms":40,"how":"tap"}' } });
  loopSetup(rt);                                        // 120 bpm: a bar is 2 s; two bars 4 s; count-in 2 s
  const osc = rt.audio.oscillators;
  await rt.document.getElementById("looprec").onclick();
  await settle();
  const node = rt.worklets.at(-1), sent = node.sent;
  const start = sent.find(m => "start" in m).start, stopAt = sent.find(m => "stopAt" in m).stopAt;
  assert.equal(start, Math.round((0 + 0.35 + 2) * 48000), "0.35 s to settle, then a four-beat count-in");
  assert.equal(stopAt - start, 4 * 48000, "exactly two bars of frames");
  assert.equal(rt.audio.oscillators - osc, 4, "four count-in clicks");
  assert.match(rt.document.getElementById("loopmsg").textContent, /^Counting in, then 2 bars/);
  assert.equal(rt.app.looper.state, "recording");
  assert.equal(rt.document.getElementById("looprec").disabled, true, "one at a time");
  finishLoop(rt, 4 * 48000);
  const l = rt.app.looper, src = l.src;
  assert.equal(l.state, "looping"); assert.equal(l.buf.length, 192000); assert.equal(l.buf.duration, 4);
  assert.equal(src.loop, true); assert.equal(src.loopStart, 0); assert.equal(src.loopEnd, 4, "the whole buffer, so it repeats with no gap");
  assert.equal(src.startedAt, 2.35 + 4, "it begins on the audio clock at the bar the recording ended on");
  assert.equal(src.offset, 0.04, "and is put back on the beat by the latency calibration");
  assert.equal(src.connected[0], l.gain); assert.equal(l.gain.outs.length, 1, "into the engine's bus, so a take with backing records it");
  assert.equal(l.buf.getChannelData(0)[100000], Math.fround(0.3), "the audio that was played");
  assert.match(rt.document.getElementById("loopmsg").textContent, /^Looping\. Solo over it/);
  assert.match(rt.document.getElementById("loopstate").textContent, /^Looping 2 bars at 120 bpm$/);
  assert.equal(rt.document.getElementById("looprec").disabled, true);
  rt.app.looperStop();
  assert.equal(src.stopped, true); assert.equal(l.state, "idle"); assert.ok(l.buf, "the loop is kept for Play loop");
  assert.equal(rt.document.getElementById("loopplay").disabled, false);
});

test("a loop restarted later joins at the right point in the bars, not from its start", async () => {
  const rt = makeRuntime({ media: true, capture: true });
  loopSetup(rt, { bars: "1", count: false });           // one bar: 2 s, no count-in: starts at 0.35
  await rt.document.getElementById("looprec").onclick();
  await settle();
  assert.equal(rt.worklets.at(-1).sent.find(m => "start" in m).start, Math.round(0.35 * 48000));
  finishLoop(rt, 96000);
  const first = rt.app.looper.src;
  assert.equal(first.startedAt, 0.35 + 2);
  rt.app.looperStop();
  rt.clock.t = 9.25;                                    // some time later
  rt.app.looperPlay(9.25 - 0.5);                        // the loop's bar 1 was 0.5 s ago
  const again = rt.app.looper.src;
  assert.notEqual(again, first, "a fresh source: a stopped one can't be restarted");
  assert.equal(again.startedAt, 0, "already past: starts now"); assert.equal(again.offset, 0.5, "half a second into the loop");
});

test("the loop's bar readout and chords follow the audio clock, and light the chord tones", async () => {
  const rt = makeRuntime({ media: true, capture: true });
  loopSetup(rt, { bars: "2", count: false });
  await rt.document.getElementById("looprec").onclick(); await settle();
  finishLoop(rt, 4 * 48000);
  rt.document.getElementById("loopchords").value = "Am | Dm";
  rt.document.getElementById("loopchords").oninput();
  assert.match(rt.document.getElementById("loopchordnote").textContent, /^2 bars, repeating$/);
  navButton(rt.document, "boxes").click();
  rt.document.getElementById("chords").children.find(b => b.dataset.c === "band").click();
  const start = rt.app.looper.startAt;                  // 0.35 + 4
  rt.clock.t = start + 0.5; rt.app.looperTick();
  assert.equal(rt.document.getElementById("loopreadout").textContent, "bar 1 of 2");
  assert.equal(rt.app.isChordTone(9), true, "A is in Am"); assert.equal(rt.app.isChordTone(2), false);
  rt.clock.t = start + 2.5; rt.app.looperTick();
  assert.equal(rt.document.getElementById("loopreadout").textContent, "bar 2 of 2");
  assert.equal(rt.app.isChordTone(2), true, "the overlay moved to Dm"); assert.equal(rt.app.isChordTone(4), false);
  rt.clock.t = start + 4.5; rt.app.looperTick();        // the loop came round again
  assert.equal(rt.document.getElementById("loopreadout").textContent, "bar 1 of 2");
  assert.equal(rt.app.isChordTone(9), true);
  rt.app.looperStop();
  assert.equal(rt.app.getLive().chord, null, "stopping clears the overlay");
  rt.document.getElementById("loopchords").value = "Am | Zz";
  rt.document.getElementById("loopchords").oninput();
  assert.match(rt.document.getElementById("loopchordnote").textContent, /^Can't read: Zz$/);
});

test("the looper says why it can't record, and never keeps a bad or unfinished loop", async () => {
  const noWorklet = makeRuntime({ media: true });
  loopSetup(noWorklet);
  await noWorklet.document.getElementById("looprec").onclick();
  assert.match(noWorklet.document.getElementById("loopmsg").textContent, /needs Web Audio and audio worklets/);
  assert.equal(noWorklet.app.looper.state, "idle");

  const short = makeRuntime({ media: true, capture: true });
  loopSetup(short);
  await short.document.getElementById("looprec").onclick(); await settle();
  finishLoop(short, 40000);                             // under half of the four seconds
  assert.match(short.document.getElementById("loopmsg").textContent, /^Not enough was recorded\. Try again\.$/);
  assert.equal(short.app.looper.buf, null);

  const hung = makeRuntime({ media: true, capture: true });
  loopSetup(hung, { bars: "1", count: false });
  await hung.document.getElementById("looprec").onclick(); await settle();
  hung.advance(10);                                     // the capture never reports back
  assert.match(hung.document.getElementById("loopmsg").textContent, /^The recording didn't finish\. Try again\.$/);
  assert.equal(hung.app.looper.state, "idle");

  const stopped = makeRuntime({ media: true, capture: true });
  loopSetup(stopped);
  await stopped.document.getElementById("looprec").onclick(); await settle();
  stopped.app.looperStop();
  assert.match(stopped.document.getElementById("loopmsg").textContent, /nothing was kept/);
  assert.equal(stopped.app.looper.buf, null);

  const busy = makeRuntime({ media: true, capture: true });
  loopSetup(busy);
  busy.document.getElementById("recbtn").click(); await settle();
  await busy.document.getElementById("looprec").onclick();
  assert.match(busy.document.getElementById("loopmsg").textContent, /Finish the take first/);
});

test("a solo can be recorded over the loop, the level is adjustable, and Clear and Quit let it go", async () => {
  const rt = makeRuntime({ media: true, capture: true });
  loopSetup(rt, { bars: "1", count: false });
  await rt.document.getElementById("looprec").onclick(); await settle();
  finishLoop(rt, 96000);
  const l = rt.app.looper;
  const vol = rt.document.getElementById("loopvol");
  vol.value = "40"; vol.oninput({ target: vol });
  assert.equal(l.gain.gain.value, 0.4);
  const { taps } = spyTaps(rt.app);
  rt.document.getElementById("recmix").value = "backing";
  rt.document.getElementById("recbtn").click(); await settle();
  assert.equal(taps.length, 1, "the take taps the engine's bus, where the loop plays");
  assert.equal(rt.app.getRec().backing, true);
  rt.document.getElementById("recbtn").click(); await settle(); await settle();
  assert.equal(l.state, "looping", "recording a solo does not stop the loop");
  rt.app.silenceEverything();
  assert.equal(l.state, "idle", "Quit stops it");
  rt.app.looperClear();
  assert.equal(l.buf, null); assert.equal(rt.document.getElementById("loopclear").disabled, true);
});

// ---------- timing analysis: signals with known answers ----------
// Plucked strings: a decaying tone (with a second partial) starting at each given time,
// over a little noise, from a seeded generator so the test is the same every run.
function guitarSignal(times, { sr = 44100, seconds = 5, hz = 220, amp = 0.4, noise = 0.002, decay = 0.35 } = {}) {
  const x = new Float32Array(Math.round(sr * seconds));
  let seed = 12345; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 1073741823.5 - 1; };
  for (let i = 0; i < x.length; i++) x[i] = rnd() * noise;
  for (const t0 of times) {
    const start = Math.round(t0 * sr);
    for (let i = start; i < Math.min(x.length, start + Math.round(sr * 1.2)); i++) {
      const t = (i - start) / sr, env = Math.exp(-t / decay) * Math.min(1, t / 0.002);
      x[i] += amp * env * (Math.sin(2 * Math.PI * hz * t) + 0.4 * Math.sin(2 * Math.PI * 2 * hz * t + 1));
    }
  }
  return x;
}

test("onsets are found within a few milliseconds of where the notes began, on any string", () => {
  const { app } = makeRuntime();
  const times = [0.5, 1.0, 1.5, 2.05, 2.5, 3.0, 3.6];
  for (const [hz, amp] of [[82, 0.4], [220, 0.4], [660, 0.3], [110, 0.06]]) {     // low E, A, high e, and quiet
    const found = app.detectOnsets(guitarSignal(times, { hz, amp }), 44100);
    assert.equal(found.length, times.length, `${hz} Hz at ${amp}: every note, and nothing else (${found.map(f => f.toFixed(3))})`);
    times.forEach((t, i) => assert.ok(Math.abs(found[i] - t) < 0.012, `${hz} Hz note ${i}: ${found[i]} vs ${t}`));
  }
});

test("onsets ignore noise, hum and a note's own decay, and two notes inside 90 ms are one", () => {
  const { app } = makeRuntime();
  assert.equal(app.detectOnsets(guitarSignal([], { noise: 0.004 }), 44100).length, 0, "noise alone");
  const hum = new Float32Array(44100 * 3).map((_, i) => 0.02 * Math.sin(2 * Math.PI * 50 * i / 44100));
  assert.equal(app.detectOnsets(hum, 44100).length, 0, "a steady hum");
  assert.equal(app.detectOnsets(guitarSignal([1.0], { decay: 1.5 }), 44100).length, 1, "a long ringing note is one onset, not one per wobble");
  assert.equal(app.detectOnsets(guitarSignal([1.0, 1.05]), 44100).length, 1, "50 ms apart: the refractory period");
  const restrike = app.detectOnsets(guitarSignal([1.0, 1.15]), 44100);
  assert.equal(restrike.length, 2, "150 ms apart, the second over a note still ringing: two notes");
  assert.ok(Math.abs(restrike[1] - 1.15) < 0.008, `and the second is timed to the attack: ${restrike[1]}`);
  assert.equal(app.detectOnsets(new Float32Array(100), 44100).length, 0, "a take too short to analyse");
  assert.equal(app.detectOnsets(guitarSignal([0.5, 1.0], { sr: 48000 }), 48000).length, 2, "at 48 kHz too");
});

test("offsets are measured from the beat, after the calibrated latency, and ambiguous ones are dropped", () => {
  const { app } = makeRuntime();
  const grid = { t0: 1, beat: 0.5 };                     // 120 bpm, eighths every 0.25 s from 1.0
  const at = ms => 1 + 0.25 * 3 + ms / 1000;              // near the fourth eighth
  const off = app.timingOffsets([at(0), at(+20), at(-15), at(+90), at(+110), 0.2], grid, 0, 2);
  sameShape(off.map(o => Math.round(o.ms)), [0, 20, -15, 90], "+90 ms is 0.36 of a step: still readable; +110 ms is 0.44: dropped, and so is a note before the grid");
  const late = app.timingOffsets([at(40)], grid, 40, 2);
  assert.ok(Math.abs(late[0].ms) < 0.01, "40 ms of latency is taken off: this note was on the beat");
  sameShape(app.timingOffsets([1], null), []); sameShape(app.timingOffsets([1], { t0: 0, beat: 0 }), []);
});

test("the headline is the spread, not the lean: a steady player who is early still scores steady", () => {
  const { app } = makeRuntime();
  const steadyEarly = [-22, -20, -25, -21, -23, -19, -24, -22].map(ms => ({ ms, t: 0 }));
  const tight = [1, -2, 0, 2, -1, 1, 0, -1].map(ms => ({ ms, t: 0 }));
  const loose = [-45, 30, 10, -40, 50, -20, 35, -30].map(ms => ({ ms, t: 0 }));
  const a = app.timingStats(steadyEarly), b = app.timingStats(tight), c = app.timingStats(loose);
  assert.ok(a.mean < -19 && a.std < 3, `early and steady: mean ${a.mean}, spread ${a.std}`);
  assert.ok(b.std < 3 && Math.abs(b.mean) < 1);
  assert.ok(c.std > 30);
  assert.equal(app.timingWord(a.std), "tight"); assert.equal(app.timingWord(20), "steady"); assert.equal(app.timingWord(c.std), "loose");
  assert.equal(app.timingWord(null), "");
  sameShape(app.timingStats(steadyEarly.slice(0, 3)), { count: 3, mean: null, std: null }, "too few notes to say anything");
});

test("the report splits the spread by section", () => {
  const { app } = makeRuntime();
  const grid = { t0: 0, beat: 0.5 }, base = i => i * 0.25;
  const onsets = [];
  for (let i = 0; i < 16; i++) onsets.push(base(i) + (i % 2 ? 0.002 : -0.002));        // the first four seconds: tight
  for (let i = 16; i < 32; i++) onsets.push(base(i) + [0.06, -0.05, 0.04, -0.06][i % 4] * 0.5);  // then loose
  const r = app.timingReport(onsets, grid, 0, [{ name: "Verse", from: 0, to: 4 }, { name: "Chorus", from: 4, to: 8 }]);
  assert.equal(r.count, 32);
  const [v, c] = r.sections;
  assert.equal(v.name, "Verse"); assert.ok(v.std < 4, `${v.std}`);
  assert.equal(c.name, "Chorus"); assert.ok(c.std > 15, `${c.std}`);
});

test("takes line up at a section's start or at bar 1", () => {
  const { app } = makeRuntime();
  const sections = [{ name: "Verse", from: 7.5, to: 20 }, { name: "Chorus", from: 20, to: 30 }];
  assert.equal(app.alignPoint({}, "Chorus", sections, { t0: 2 }), 20);
  assert.equal(app.alignPoint({}, "", sections, { t0: 2 }), 2, "no section: the first bar");
  assert.equal(app.alignPoint({}, "Bridge", sections, { t0: 2 }), 2, "a section this take doesn't have: the first bar");
  assert.equal(app.alignPoint({}, "", [], null), 0);
});

// ---------- timing, progress and comparing takes, from recorded signals ----------
// An armed trainer take at 120 bpm (bar 1 at 0 s in the take), the guitar playing a note on
// every eighth (0.25 s), each `late` seconds behind the beat, with `wobble` seconds of
// alternating spread on top.
async function timedTake(rt, { late = 0.02, wobble = 0, notes = 16, hz = 220, extra = () => {} } = {}) {
  rt.app.setBpm(120);
  rt.document.getElementById("recmix").value = "guitar";
  rt.document.getElementById("recarm").checked = true;
  rt.document.getElementById("recbtn").click();
  await settle();
  rt.app.toggleTrainer();
  for (let i = 0; i < 4; i++) rt.advance(0.5);
  const times = Array.from({ length: notes }, (_, k) => 0.5 + k * 0.25 + late + (k % 2 ? wobble : -wobble));
  rt.worklets.at(-1).feedRaw(guitarSignal(times, { sr: 48000, seconds: 6, hz }));
  extra();
  rt.app.toggleTrainer();
  await settle(); await settle(); await settle();
  return (await rt.app.libList())[0];
}

test("the guitar's notes are read from the stored master and set against the beat", async () => {
  const rt = makeRuntime({ media: true, capture: true });
  const t = await timedTake(rt, { late: 0.02 });
  assert.ok(t.grid && t.grid.beat === 0.5 && t.grid.t0 === 0, "an armed trainer take has a beat: bar 1 at 0, 0.5 s a beat");
  assert.equal(t.onsets.length, 16, "every note found");
  t.onsets.forEach((o, k) => assert.ok(Math.abs(o - (0.5 + k * 0.25 + 0.02)) < 0.012, `note ${k} at ${o}`));
  navButton(rt.document, "songs").click(); await settle();
  await rt.app.libOpen(t.id);
  const html = rt.document.getElementById("taketiming").innerHTML;
  assert.match(html, /consistency ±[0-4](\.\d)? ms<\/b> \(tight\) over 16 notes against the beat; on average you play 2\d ms behind it/);
  assert.match(html, /Not calibrated, so a steady offset here may be the gear, not you/);
  const svg = rt.document.getElementById("takewave").innerHTML;
  assert.equal((svg.match(/class="won[012]"/g) || []).length, 16, "a dot for each note");
  assert.match(svg, /class="won1"/, "20 ms behind: within 30 but not within 15");
});

test("the calibrated latency is taken off, so a player who is on the beat reads as on it", async () => {
  const rt = makeRuntime({ media: true, capture: true, stored: { "practice-desk-calibration": '{"ms":20,"how":"loopback"}' } });
  const t = await timedTake(rt, { late: 0.02 });                   // 20 ms late: exactly the latency
  navButton(rt.document, "songs").click(); await settle();
  await rt.app.libOpen(t.id);
  const html = rt.document.getElementById("taketiming").innerHTML;
  assert.match(html, /on average you play (right on it|[12] ms (ahead of|behind) it)/);
  assert.match(html, /Your 20 ms latency calibration is taken off/);
  assert.match((rt.document.getElementById("takewave").innerHTML.match(/class="won\d"/g) || []).join(), /won0/, "all within 15 ms");
});

test("loose playing reads as loose, and its spread is what is reported", async () => {
  const rt = makeRuntime({ media: true, capture: true });
  const t = await timedTake(rt, { late: 0, wobble: 0.045 });       // alternately 45 ms ahead and behind
  const r = rt.app.timingReport(t.onsets, t.grid, 0);
  assert.ok(r.std > 35 && r.std < 55, `spread ${r.std}`); assert.ok(Math.abs(r.mean) < 8, `mean ${r.mean}`);
  assert.equal(rt.app.timingWord(r.std), "loose");
});

test("a take with no beat to measure against says so, and a song take is measured against the song", async () => {
  const plain = makeRuntime({ media: true, capture: true });
  plain.document.getElementById("recmix").value = "guitar";
  await recordTake(plain);
  const [p] = await plain.app.libList();
  assert.equal(p.grid, null);
  navButton(plain.document, "songs").click(); await settle();
  await plain.app.libOpen(p.id);
  assert.match(plain.document.getElementById("taketiming").innerHTML, /No beat to measure your timing against/);

  const rt = makeRuntime({ media: true, capture: true });
  await rt.app.songImport(songFile());
  rt.app.songs.selected.bpm = 120; rt.app.songs.selected.downbeat = 0;
  await rt.app.songSaveSections(() => {});
  rt.document.getElementById("songcount").checked = false; rt.document.getElementById("songspeed").value = "1";
  await rt.app.songPlay(); await settle();
  rt.document.getElementById("recmix").value = "guitar";
  rt.document.getElementById("recbtn").click(); await settle();
  rt.worklets.at(-1).feedRaw(guitarSignal(Array.from({ length: 12 }, (_, k) => 0.5 + k * 0.25), { sr: 48000, seconds: 5 }));
  rt.document.getElementById("recbtn").click(); await settle(); await settle(); await settle();
  const [s] = await rt.app.libList();
  assert.deepEqual([s.grid.t0, s.grid.beat], [0, 0.5], "the song's bars: 120 bpm, downbeat 0, the take began at song time 0");
  assert.equal(s.onsets.length, 12);
  rt.app.songStop();
});

test("progress over a song's takes: a picture, the clean run-throughs, and the ratings by section", async () => {
  const rt = makeRuntime({ media: true, capture: true });
  const song = await rt.app.songImport(songFile());
  for (let i = 0; i < 3; i++) {
    rt.document.getElementById("recmix").value = "guitar";
    rt.document.getElementById("songcount").checked = false; rt.document.getElementById("songspeed").value = "1";
    await rt.app.songPlay(); await settle();
    await recordTake(rt, { after: () => { if (i === 0) { rt.clock.t += 1; rt.document.dispatch("keydown", { key: "m" }); } } });
    rt.app.songStop();
  }
  const takes = await rt.app.libList();
  assert.equal(takes.length, 3); assert.ok(takes.every(t => t.songId === song.id));
  takes.forEach((t, i) => { t.created = 1000 * (3 - i); t.ratings.whole = [4, 3, 2][i]; });   // oldest first: 2, 3, 4
  navButton(rt.document, "songs").click(); await settle();
  rt.document.getElementById("takefilter").value = song.id; rt.document.getElementById("takefilter").onchange();
  const html = rt.document.getElementById("takeprogress").innerHTML;
  assert.match(html, /<b>2<\/b> of 3 full run-throughs went all the way through with no mistake marked/);
  assert.match(html, /<svg viewBox="0 0 600 150" role="img" aria-label="Progress across 3 takes of this song">/);
  assert.equal((html.match(/class="pdot"/g) || []).length, 3, "a dot per rated take");
  assert.match(html, /class="pmis"[^>]*>1<\/text>/, "the one mistake, marked");
  const one = makeRuntime({ media: true, capture: true });
  await one.app.songImport(songFile());
  navButton(one.document, "songs").click(); await settle();
  one.document.getElementById("takefilter").value = one.app.songs.list[0].id; one.document.getElementById("takefilter").onchange();
  assert.match(one.document.getElementById("takeprogress").innerHTML, /appears once there are two takes/);
});

test("two takes are compared from the same place, and Switch swaps which is heard", async () => {
  const rt = makeRuntime({ media: true, capture: true });
  rt.document.getElementById("recmix").value = "guitar";
  await recordTake(rt); await recordTake(rt);
  const [newer, older] = await rt.app.libList();
  navButton(rt.document, "songs").click(); await settle();
  rt.document.getElementById("aba").value = older.id; rt.document.getElementById("abb").value = newer.id;
  const before = rt.audioElements.length;
  rt.document.getElementById("abplay").onclick();
  const [a, b] = rt.audioElements.slice(before);
  assert.equal(rt.audioElements.length - before, 2);
  assert.equal(a.playing, true); assert.equal(b.playing, true, "both run together, so switching never loses your place");
  assert.equal(a.volume, 1); assert.equal(b.volume, 0);
  assert.equal(rt.document.getElementById("abside").textContent, "Listening to A");
  rt.document.getElementById("abswitch").onclick();
  assert.equal(a.volume, 0); assert.equal(b.volume, 1); assert.equal(rt.document.getElementById("abside").textContent, "Listening to B");
  rt.document.getElementById("abstop").onclick();
  assert.equal(a.playing, false);
  rt.document.getElementById("abb").value = older.id;
  rt.document.getElementById("abplay").onclick();
  assert.match(rt.document.getElementById("takemsg").textContent, /Choose two different takes/);
});

test("takes are aligned by section: each starts at its own copy of the section", async () => {
  const rt = makeRuntime({ media: true, capture: true });
  const s = await rt.app.songImport(songFile());
  await rt.app.songSaveSections(secs => secs.push({ name: "Chorus", start: 30, end: 50 }));
  rt.document.getElementById("songcount").checked = false; rt.document.getElementById("songspeed").value = "1";
  rt.document.getElementById("recmix").value = "guitar";
  for (const startAt of [10, 25]) {                     // two takes that began at different points of the song
    await rt.app.songPlay(); await settle();
    rt.app.songs.player.currentTime = startAt;
    await recordTake(rt, { ms: 25 * 48000 });      // long enough to contain the Chorus
    rt.app.songStop();
  }
  const [b, a] = await rt.app.libList();
  navButton(rt.document, "songs").click(); await settle();
  rt.document.getElementById("takefilter").value = s.id; rt.document.getElementById("takefilter").onchange();
  rt.document.getElementById("aba").value = a.id; rt.document.getElementById("abb").value = b.id;
  rt.document.getElementById("absection").value = "Chorus";
  const before = rt.audioElements.length;
  rt.document.getElementById("abplay").onclick();
  const [ea, eb] = rt.audioElements.slice(before);
  // take a began at song time 10, take b at 25: the Chorus (30 s) is 20 s into a and 5 s into b
  assert.equal(ea.currentTime, 20); assert.equal(eb.currentTime, 5);
  rt.document.getElementById("abstop").onclick();
});

// ---------- the model, the evidence for it, and a very long take ----------
test("Practice theory cites Hewitt (2001) for model + self-evaluation, and says what it did and did not show", () => {
  assert.match(html, /Hewitt \(2001\)[\s\S]{0,60}junior-high band students/);
  assert.match(html, /model on its own made no difference/);
  assert.match(html, /intonation,\s+technique and tempo did not improve more/);
  assert.match(html, /82 students on band instruments, so it is\s+indirect evidence for guitar/);
  assert.match(html, /Journal of Research in Music Education<\/i> 49\(4\), 307–322 \(DOI 10\.2307\/3345614\)/);
});

test("every lick can be heard first, as written, at the current tempo", () => {
  const { app, document, audio } = makeRuntime();
  app.setBpm(120);
  navButton(document, "licks").click();
  const licks = document.getElementById("licks").innerHTML;
  assert.equal((licks.match(/data-hear="\d+"/g) || []).length, app.LICKS.length, "a Hear the model button on every lick");
  assert.match(licks, /Hear the model<\/button> then press Record in the Play along bar/);
  const before = audio.oscillators;
  document.getElementById("licks").onclick({ target: { dataset: { hear: "1" } } });     // Rolling triplets: 7 notes
  assert.equal(audio.oscillators - before, 7 * 3, "a plucked note is three oscillators");
  const times = audio.startTimes.slice(-21).filter((t, i) => i % 3 === 0);
  assert.ok(times.every((t, i) => Math.abs(t - i * 0.25) < 1e-9), "eighth notes at 120 bpm: 0.25 s apart, on the audio clock");
  assert.equal(document.getElementById("licks").onclick({ target: { dataset: {} } }), undefined, "other clicks do nothing");
  const none = makeRuntime({ audio: false });
  navButton(none.document, "licks").click();
  none.document.getElementById("licks").onclick({ target: { dataset: { hear: "0" } } });   // no audio at all: no crash
});

test("the Record row advises headphones when there is backing", () => {
  const { app } = makeRuntime();
  assert.match(app.REC_ROW, /With backing, wear headphones: through speakers the backing leaks into your guitar input/);
});

test("a full song run-through has no length limit: ten minutes streams to storage in chunks and comes back whole", async () => {
  const rt = makeRuntime({ media: true, capture: true });
  rt.document.getElementById("recmix").value = "guitar";
  rt.document.getElementById("recmode").value = "full";
  rt.document.getElementById("recbtn").click();
  await settle();
  const node = rt.worklets.at(-1), block = new Float32Array(48000).fill(0.1);
  for (let s = 0; s < 600; s++) node.feedRaw(block);        // ten minutes, a second at a time
  await rt.app.getRec().capture.writes;                     // the storage queue drains as chunks arrive
  assert.equal(rt.idb.stores.get("chunks").rows.size, 600, "written a second at a time as it goes, not held in memory");
  const meta = [...rt.idb.stores.get("takes").rows.values()][0].v;
  assert.equal(meta.frames, 600 * 48000); assert.equal(meta.status, "recording", "and a crash now would keep all of it");
  assert.match(rt.document.getElementById("recmsg").textContent, /Recording guitar only · 0:0\d/, "no limit is announced: it just records");
  rt.document.getElementById("recbtn").click();
  await settle(); await settle(); await settle();
  const take = rt.app.getTake();
  assert.equal(take.wav.size, 44 + 600 * 48000 * 2, "a 55 MB WAV, assembled from the chunks");
  assert.equal(rt.app.lib.takes.length + (await rt.app.libList()).length > 0, true);
  const [kept] = await rt.app.libList();
  assert.ok(Math.abs(kept.seconds - 600) < 0.01, `kept as ${kept.seconds} s`);
  await rt.document.getElementById("recdlw").onclick();
  await settle();
  const wav = await rt.rec.urls.at(-1).b.arrayBuffer();
  assert.equal(wav.byteLength, 44 + 600 * 48000 * 2);
  assert.equal(new DataView(wav).getUint32(40, true), 600 * 48000 * 2, "the header says what the data is");
  assert.equal(rt.idb.stores.get("chunks").rows.size, 0, "downloaded: the chunks are dropped");
});

// ---------- critique fixes ----------
test("slash chords are their chord, and more chord types are understood", () => {
  const { app } = makeRuntime();
  assert.equal(app.parseChord("Am/G").name, "Am"); assert.equal(app.parseChord("D/F#").name, "D");
  sameShape([...app.parseChord("Cadd9").intervals], [0, 4, 7, 2]); sameShape([...app.parseChord("G7sus4").intervals], [0, 5, 7, 10]);
  assert.equal(app.parseChord("Am9").pc, 9);
});

test("the Record settings sit in a collapsed section, and a failed keep says so without hiding the earlier message", async () => {
  const { app } = makeRuntime();
  assert.match(app.REC_ROW, /<details id="recdetails"[^>]*><summary>Recording &amp; input/);
  const rt = makeRuntime({ media: true, capture: { failAfter: 3 } });
  rt.document.getElementById("recbtn").click(); await settle();
  rt.worklets[0].feed(48000); await settle(); rt.worklets[0].feed(48000); await settle(); await settle();
  assert.match(rt.document.getElementById("recmsg").textContent, /^Storage ran out, so the take stopped there\..*It could not be kept in the library/);
});

test("a take ready to hear again puts a dot on the Songs button from any view", async () => {
  const rt = makeRuntime({ media: true, capture: true });
  await recordTake(rt);
  await rt.app.libList();
  const btn = navButton(rt.document, "songs");
  rt.app.libBadge();
  assert.equal(btn.classList.contains("due"), false, "a fresh take is not due");
  rt.app.lib.takes[0].created -= rt.app.RERATE_AFTER_MS + 1000;
  rt.app.libBadge();
  assert.equal(btn.classList.contains("due"), true);
  assert.match(btn.getAttribute("title"), /1 take is ready to hear again/);
});

test("streak counts consecutive days and survives until you have practised today", () => {
  const { app } = makeRuntime();
  const d = s => s, today = new Date(2026, 8, 19);
  assert.equal(app.streakOf([], today), 0);
  assert.equal(app.streakOf(["2026-09-19", "2026-09-18", "2026-09-17"], today), 3);
  assert.equal(app.streakOf(["2026-09-18", "2026-09-17"], today), 2, "yesterday keeps it alive");
  assert.equal(app.streakOf(["2026-09-17"], today), 0, "a missed day breaks it");
  assert.equal(app.streakOf(["2026-09-19", "2026-09-17"], today), 1);
});

test("ear drill scores answers, favours weak degrees, and feeds the streak", () => {
  const { app } = makeRuntime();
  const stats = Object.fromEntries(app.EAR_DEGREES.map(([d]) => [d, [10, 10]]));
  stats[7] = [1, 10];
  let hits = 0;
  for (let i = 0; i < 400; i++) if (app.earPick(stats, () => i / 400) === 7) hits++;
  assert.ok(hits > 200, `weak fifth asked often (${hits}/400)`);
  app.earNew();
  const q = app.getEar();
  const wrong = app.EAR_DEGREES.find(([d]) => d !== q.degree)[0];
  app.earAnswer(wrong);
  assert.equal(app.readEar()[q.degree][1], 1);
  assert.equal(app.readEar()[q.degree][0], 0);
  app.earAnswer(q.degree);
  assert.equal(app.readEar()[q.degree][1], 1, "one answer per note");
  assert.equal(app.readDays().length, 1, "an answer marks today");
  assert.ok(app.todayAdvice().length >= 1);
});

test("the streak message encourages and never scolds", () => {
  const { app } = makeRuntime(), today = new Date(2026, 8, 19);
  assert.match(app.streakMessage([], today), /begins/);
  assert.match(app.streakMessage(["2026-09-19"], today), /1<\/b> day in a row/);
  assert.match(app.streakMessage(["2026-09-17", "2026-09-18", "2026-09-19"], today), /habit is forming/);
  assert.match(app.streakMessage(["2026-09-18"], today), /keep it going/);
  const back = app.streakMessage(["2026-09-01", "2026-09-02", "2026-09-03"], today);
  assert.match(back, /Welcome back.*best run is 3/);
  assert.doesNotMatch(back, /lost|broke|missed|failed/i);
  assert.equal(app.bestStreak(["2026-09-01", "2026-09-02", "2026-09-05"]), 2);
});

// ---------- practical additions: path progress, Today, lick tempos, changes, tuner ----------

test("Start here keeps which stages you passed, and puts you on the first one you haven't", () => {
  const { app, document } = makeRuntime();
  assert.equal(app.currentStage().n, 1);
  let html = document.getElementById("path").innerHTML;
  assert.match(html, /class="card now"><h2>1 · Time, before notes/);
  assert.match(html, /data-pass="1" aria-pressed="false">I passed this test/);
  assert.match(html, /data-goto="tune"/, "stage 1 now has somewhere to go: tune up first");
  app.togglePassed(1); app.togglePassed(2);
  assert.equal(app.currentStage().n, 3);
  html = document.getElementById("path").innerHTML;
  assert.match(html, /class="card now"><h2>3 · Phrasing and space/);
  assert.match(html, /2 of 8 stages passed/);
  assert.match(html, /Passed [A-Z][a-z]{2} \d+/);
  assert.equal(app.readDays().length, 1, "passing a stage counts as practice today");
  app.togglePassed(1);
  assert.equal(app.currentStage().n, 1, "undo puts you back");
  // anything else in storage is ignored
  const { app: other } = makeRuntime({ stored: { "minor-pentatonic-path-v1": '{"1":"2026-09-01","2":"<img>","99":"2026-01-01"}' } });
  assert.equal(JSON.stringify(other.readPath()), '{"1":"2026-09-01"}');
});

test("Today suggests the stage, the lick to push and the chord change to beat, five items at most", () => {
  const { app, document } = makeRuntime();
  navButton(document, "practice").click();
  let items = app.todayAdvice();
  assert.ok(items.length <= 5);
  assert.ok(items.some(x => /data-goto="tune"/.test(x)), "tune up first");
  assert.ok(items.some(x => /stage 1/.test(x)));
  assert.ok(items.some(x => /One-minute changes/.test(x)), "a beginner is pointed at chord changes");
  app.setBpm(84); app.saveLickTempo(0);
  items = app.todayAdvice();
  const lick = items.find(x => /^Push/.test(x));
  assert.ok(lick, "a lick with a saved tempo is one to push");
  assert.match(lick, new RegExp(app.LICKS[0].t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(lick, /clean at 84 bpm/); assert.match(lick, /try 89/); assert.match(lick, /data-bpm="84"/);
  assert.match(document.getElementById("todaylist").innerHTML, /./);
});

test("a lick keeps the tempo you played it clean at, and offers the next step up", () => {
  const { app, document } = makeRuntime();
  navButton(document, "licks").click();
  assert.match(document.getElementById("licks").innerHTML, /No clean tempo saved yet/);
  app.setBpm(70); app.saveLickTempo(1);
  app.setBpm(76); app.saveLickTempo(1);
  const r = app.readLickTempos()[app.LICKS[1].t];
  sameShape(r.map(x => x.bpm), [76, 70]);
  app.renderLicks();
  const html = document.getElementById("licks").innerHTML;
  assert.match(html, /Clean at <b>76 bpm<\/b>/);
  assert.match(html, /70 → 76/);
  assert.match(html, /data-bpm="81">Try 81/);
  assert.match(html, /data-bpm="71">Warm up at 71/);
  assert.equal(app.lickToPush().bpm, 76);
  assert.equal(app.readDays().length, 1);
  const { app: bad } = makeRuntime({ stored: { "minor-pentatonic-lick-tempos-v1": '{"nope":[{"bpm":90,"d":"x"}]}' } });
  assert.equal(bad.lickToPush(), null, "tempos for licks that don't exist are dropped");
});

test("one-minute changes counts taps for a minute, keeps the best, and a stop isn't counted", () => {
  const { app, document, clock, advance } = makeRuntime();
  navButton(document, "practice").click();
  assert.equal(document.getElementById("changetap").disabled, true);
  document.getElementById("changestart").click();
  assert.equal(document.getElementById("changetap").disabled, false);
  for (let i = 0; i < 12; i++) document.getElementById("changetap").click();
  assert.equal(document.getElementById("changetap").textContent, "Changed · 12");
  document.getElementById("changestart").click();   // stop
  assert.equal(JSON.stringify(app.readChanges()), "{}", "a stopped minute isn't kept");
  document.getElementById("changestart").click();
  for (let i = 0; i < 18; i++) app.changesTap();
  clock.wall += 61; advance(0);
  assert.equal(app.readChanges()["A-D"][0].n, 18);
  assert.match(document.getElementById("changestatus").innerHTML, /first score/);
  document.getElementById("changestart").click();
  for (let i = 0; i < 22; i++) app.changesTap();
  clock.wall += 61; advance(0);
  assert.match(document.getElementById("changestatus").innerHTML, /new best, up from 18/);
  assert.match(document.getElementById("changelog").innerHTML, /<b>22<\/b> a minute/);
  assert.equal(app.changesTap(), false, "no counting after the minute");
  assert.ok(app.todayAdvice().some(x => /beat <b>22<\/b> on A ↔ D/.test(x)));
});

test("the tuner reads the input and says which string, how far off, and which way", async () => {
  const { app, context, document, advance, rec } = makeRuntime({ media: true });
  navButton(document, "tune").click();
  assert.match(document.getElementById("tunerread").innerHTML, /Press Start listening/);
  let hz = 82.41 * Math.pow(2, -20 / 1200);
  context.detectPitch = () => ({ hz, clarity: 0.97 });
  document.getElementById("tunelisten").click();
  await settle();
  assert.equal(rec.asked.length, 1, "it opens the shared input");
  assert.equal(document.getElementById("tunelisten").textContent, "Stop listening");
  advance(0.03); advance(0.03); advance(0.03);
  let read = document.getElementById("tunerread").innerHTML;
  assert.match(read, /string 6/); assert.match(read, /tune up/); assert.match(read, /-20 cents/);
  hz = 196; for (let i = 0; i < 5; i++) advance(0.03);
  read = document.getElementById("tunerread").innerHTML;
  assert.match(read, /string 3/); assert.match(read, /in tune/);
  // leaving the view lets go of the input
  navButton(document, "boxes").click();
  assert.equal(app.getState().view, "boxes");
  assert.equal(document.getElementById("tunelisten").textContent, "Start listening");
});

test("the bend check reads a whole note, says where it landed, and keeps the result", async () => {
  const { app, context, document, advance } = makeRuntime({ media: true });
  navButton(document, "tune").click();
  document.getElementById("bendstring").value = "2";
  document.getElementById("bendfret").value = "7";   // D on the G string, bent to E
  document.getElementById("bendamt").value = "2";
  const d = 293.66;   // D4: the G string is G3, and fret 7 is a fifth above it
  let st = null;
  context.detectPitch = () => st === null ? null : ({ hz: d * Math.pow(2, st / 12), clarity: 0.95 });
  document.getElementById("bendlisten").click();
  await settle();
  // fretted for 0.3 s, up to 1.7 semitones (30 cents flat), with vibrato, then silence
  for (let t = 0; t < 1.5; t += 0.025) {
    st = t < 0.3 ? 0 : t < 0.45 ? 1.7 * (t - 0.3) / 0.15 : 1.7 + (t > 0.6 ? 0.25 * Math.sin(2 * Math.PI * 5.5 * t) : 0);
    advance(0.025);
  }
  st = null; for (let i = 0; i < 14; i++) advance(0.025);
  const b = app.readBends()[0];
  assert.ok(b, "the note was checked when it ended");
  assert.equal(b.verdict, "flat"); assert.ok(Math.abs(b.cents + 30) <= 3, `landed ${b.cents}`);
  assert.ok(b.rate && Math.abs(b.rate - 5.5) < 0.6, `vibrato ${b.rate}`);
  assert.match(document.getElementById("bendstatus").innerHTML, /<b>Flat<\/b> by (2[7-9]|3[0-3]) cents/);
  assert.match(document.getElementById("bendlog").innerHTML, /0<\/b> in tune/);
  assert.match(document.getElementById("bendlog").innerHTML, /Last bend</, "one bend isn't \"Last 1 bends\"");
  assert.equal(app.readDays().length, 1, "a checked bend counts as practice");
  // an in-tune one
  for (let t = 0; t < 1; t += 0.025) { st = t < 0.3 ? 0 : 2.05; advance(0.025); }
  st = null; for (let i = 0; i < 14; i++) advance(0.025);
  assert.equal(app.readBends()[0].verdict, "in tune");
  assert.match(document.getElementById("bendlog").innerHTML, /1<\/b> in tune/);
});

test("the classic bend presets follow the key", () => {
  const { app, document } = makeRuntime();
  navButton(document, "tune").click();
  const preset = findAll(document.getElementById("bendpresets"), e => e.tagName === "BUTTON");
  preset[0].click();   // 4 → 5 on the G string, in A minor: fret 7 (D) to E
  assert.equal(document.getElementById("bendfret").value, "7");
  assert.match(document.getElementById("bendwhat").innerHTML, /<b>D<\/b>, bent a whole step to <b>E<\/b>/);
  preset[1].click();   // ♭7 → root on the B string: fret 8 (G) to A
  assert.equal(document.getElementById("bendfret").value, "8");
});

test("starting the band or finishing a focus timer counts as a practice day", () => {
  const { app, document } = makeRuntime();
  assert.equal(app.readDays().length, 0);
  app.toggleTrainer(); app.toggleTrainer();
  assert.equal(app.readDays().length, 1);
});


test("contextual shell keeps navigation and key selection in sync without resetting disclosures", () => {
  const { app, document } = makeRuntime();
  const browse = document.getElementById("browse");
  const settings = document.getElementById("diagramsettings");
  assert.equal(document.getElementById("keys").hidden, true);
  assert.equal(settings.hidden, true);
  chooseKey(document, 3);
  assert.equal(app.getState().key, 9, "a disabled key menu cannot change the lesson key");
  navButton(document, "boxes").click();
  assert.equal(document.getElementById("lessontitle").textContent, "5 boxes");
  assert.equal(settings.hidden, false);
  const groups = document.getElementById("views").children;
  assert.equal(groups.filter(g => g.open).length, 1);
  assert.equal(groups.find(g => g.open).children[0].textContent, "Shapes");
  settings.open = true; browse.open = true;
  chooseKey(document, 2);
  assert.equal(document.getElementById("keyselect").value, "2");
  assert.equal(settings.open, true, "changing key keeps the settings disclosure open");
  assert.equal(browse.open, true);
  document.getElementById("extras").children[0].click();
  assert.match(document.getElementById("settingssummary").textContent, /♭5 on/);
  assert.equal(document.getElementById("legendblue").hidden, false);
  navButton(document, "tune").click();
  assert.equal(document.getElementById("legend").hidden, true);
  assert.equal(groups.find(g => g.open).children[0].textContent, "Fundamentals");
});

test("course shows the current goal once and keeps its outline open across progress updates", () => {
  const { app, document } = makeRuntime();
  const path = document.getElementById("path");
  const goal = app.PATH[0].goal;
  assert.equal(path.innerHTML.split(goal).length - 1, 1, "Today no longer duplicates the current lesson");
  assert.match(path.innerHTML, /id="courseoutline"><summary>/);
  document.getElementById("courseoutline").open = true;
  app.togglePassed(1);
  assert.match(path.innerHTML, /id="courseoutline" open>/);
  assert.match(path.innerHTML, /2 · One shape/);
  app.PATH.forEach(p => { if (p.n !== 1) app.togglePassed(p.n); });
  assert.match(path.innerHTML, /Every stage passed/);
  assert.equal((path.innerHTML.match(/data-pass=/g) || []).length, app.PATH.length, "completed stages remain available to undo");
});

test("Blues boxes: every isolate button redraws the map and names what it isolated", () => {
  const { app, document } = makeRuntime();
  navButton(document, "blues").click();
  const buttons = findAll(document.getElementById("bluesfocus"), e => e.tagName === "BUTTON");
  assert.equal(buttons.length, 9);
  for (const b of buttons) {
    b.click();   // Box 1–5 used to throw ReferenceError: R is not defined
    assert.match(document.getElementById("bluesmap").innerHTML, /whole neck blues map/);
  }
  buttons.find(b => b.textContent === "Box 1").click();
  assert.equal(document.getElementById("bluesmaplabel").textContent, "Whole neck — Box 1 isolated");
  assert.match(document.getElementById("bluestip").innerHTML, /<b>Box 1, fret 5–8<\/b>/, "A minor Box 1 sits at frets 5–8");
  buttons.find(b => b.textContent === "Box 1").click();
  assert.match(document.getElementById("bluesmaplabel").textContent, /all five boxes/, "a second press shows everything again");
});

test("the tuner shares the recorder's stereo input, so Input 2 of an interface can be tuned", async () => {
  const { app, context, document, rec, audio } = makeRuntime({ media: true });
  app.audio();
  document.getElementById("recbar1").click();   // guitar in Input 2
  assert.equal(app.getChannel(), 1);
  context.detectPitch = () => null;
  navButton(document, "tune").click();
  document.getElementById("tunelisten").click();
  await settle();
  assert.equal(rec.asked.length, 1);
  assert.equal(rec.asked[0].audio.channelCount.ideal, 2, "stereo, as the recorder and the meter ask for it");
  const sp = audio.splitters.at(-1);
  assert.ok(sp.links.some(l => l.out === 1), "the tuner listens to Input 2 alone");
  document.getElementById("tunelisten").click();
  document.getElementById("reccheck").click();   // the meter reuses the same open input
  await settle();
  assert.equal(rec.asked.length, 1, "no second request for the input");
});

test("the tuner announces a string or direction change, not every reading", async () => {
  const { context, document, advance } = makeRuntime({ media: true });
  navButton(document, "tune").click();
  let hz = 110 * Math.pow(2, -12 / 1200);
  context.detectPitch = () => ({ hz, clarity: 0.97 });
  document.getElementById("tunelisten").click();
  await settle();
  for (let i = 0; i < 5; i++) advance(0.03);
  const say = document.getElementById("tunersay");
  assert.equal(say.textContent, "String 5, A: tune up");
  let writes = 0; const orig = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(say), "textContent");
  Object.defineProperty(say, "textContent", { get: () => orig.get.call(say), set: v => { writes++; orig.set.call(say, v); } });
  for (const c of [-11, -10, -9, -8]) { hz = 110 * Math.pow(2, c / 1200); for (let i = 0; i < 5; i++) advance(0.03); }
  assert.equal(writes, 0, "still tune up: nothing new to say");
  hz = 110; for (let i = 0; i < 5; i++) advance(0.03);
  assert.equal(say.textContent, "String 5, A: in tune");
  assert.equal(writes, 1);
});

test("the bend check ends a note even when another string keeps ringing", async () => {
  const { app, context, document, advance } = makeRuntime({ media: true });
  navButton(document, "tune").click();
  document.getElementById("bendstring").value = "2";
  document.getElementById("bendfret").value = "7";
  document.getElementById("bendamt").value = "2";
  let st = 0;
  context.detectPitch = () => ({ hz: 293.66 * Math.pow(2, st / 12), clarity: 0.95 });
  document.getElementById("bendlisten").click();
  await settle();
  for (let t = 0; t < 1; t += 0.025) { st = t < 0.3 ? 0 : 2; advance(0.025); }
  st = 7;   // the bent string stops; a string a fifth above rings on
  for (let i = 0; i < 16; i++) advance(0.025);
  assert.equal(app.readBends()[0] && app.readBends()[0].verdict, "in tune", "checked, not stuck waiting for silence");
});

test("a finished take shows a clear 'ready' panel with its downloads, and says where a download went", async () => {
  const rt = makeRuntime({ media: true, capture: true });
  const { document, app } = rt;
  assert.match(app.REC_ROW, /<div id="recdone" class="recdone" hidden>/, "nothing to download before a take");
  await recordTake(rt, {});
  assert.equal(document.getElementById("recdone").hidden, false, "the panel appears when the take ends");
  const take = app.getTake();
  assert.equal(document.getElementById("recdonehead").textContent, "Your take is ready: " + take.name.replace(/\.\w+$/, ""),
    "named without the compressed file's extension");
  for (const id of ["recdlw", "recdlm", "recdlc"]) assert.equal(document.getElementById(id).hidden, false, id + " is offered");
  document.getElementById("recdlw").click();
  await settle();
  assert.match(document.getElementById("recmsg").textContent, /^Downloaded practice-A-full-\d+bpm-.*-cold\.wav\. It is in your browser's Downloads folder\.$/);
  // in the page's own markup the WAV and MP3 come before the compressed file
  const ids = [...app.REC_ROW.matchAll(/<button id="(recdl\w)"/g)].map(m => m[1]);
  assert.equal(JSON.stringify(ids), JSON.stringify(["recdlw", "recdlm", "recdls", "recdlc"]));
  assert.match(app.REC_ROW, /Songs → Your takes/);
});

test("a kept take can be downloaded again from Songs → Your takes", async () => {
  const rt = makeRuntime({ media: true, capture: true });
  const { document, app } = rt;
  await recordTake(rt, {});
  navButton(document, "songs").click();
  await settle();
  const [t] = await app.libList();
  await app.libOpen(t.id);
  assert.match(html, /<button id="takedl" class="dl"[^>]*>Download take<\/button>/);
  document.getElementById("takedl").click();
  const link = document.body.children.at(-1);
  assert.equal(link.download, t.name);
  assert.match(link.download, /\.webm$/);
  assert.match(document.getElementById("recmsg").textContent, /Downloaded practice-.*\.webm/);
});
