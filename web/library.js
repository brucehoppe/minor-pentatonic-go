// The take library: takes kept on this device, rated against one focus, listened to
// again two days later, drawn as a waveform with bars, sections and mistakes, and
// exported as a zip. Loaded before app.js; app state and storage are used only once
// the desk has started. Nothing here leaves the browser.
const lib = {takes:[], selected:null, url:null, peaks:null, timer:null, loaded:false, filter:"", playGeneration:0};

const FOCUS_LABEL = {timing:"timing", clean:"clean notes", bends:"bends in tune", phrasing:"phrasing and space", vibrato:"vibrato", through:"getting through without stopping"};
const RERATE_AFTER_MS = 2*24*60*60*1000;

// ---- shape checks: stored records are read defensively ----
const isRating = n => Number.isInteger(n) && n>=1 && n<=5;
function cleanRatings(r){
  const out = {whole:null, sections:{}};
  if(!r || typeof r!=="object") return out;
  if(isRating(r.whole)) out.whole = r.whole;
  if(r.sections && typeof r.sections==="object")
    for(const [k,v] of Object.entries(r.sections).slice(0,40)) if(isRating(v) && k.length<=60) out.sections[k] = v;
  return out;
}
function validTake(t){
  return !!t && typeof t.id==="string" && t.id.length>0 && t.id.length<160
    && Number.isFinite(t.created) && typeof t.name==="string" && t.name.length<300
    && t.blob instanceof Blob && Number.isFinite(t.seconds) && t.seconds>=0
    && Number.isInteger(t.key) && t.key>=0 && t.key<12 && Number.isFinite(t.bpm);
}
const cleanTake = t => ({...t,
  focus:(t.focus in FOCUS_LABEL)?t.focus:"timing",
  attempt:t.attempt==="retest"?"retest":"cold",
  markers:(Array.isArray(t.markers)?t.markers:[]).filter(m=>m&&Number.isFinite(m.t)&&m.t>=0).slice(0,500).map(m=>({t:m.t,kind:"mistake"})),
  ratings:cleanRatings(t.ratings),
  rerate:t.rerate&&Number.isFinite(t.rerate.at)?{at:t.rerate.at,ratings:cleanRatings(t.rerate.ratings)}:null,
  next:typeof t.next==="string"?t.next.slice(0,200):"",
  songId:typeof t.songId==="string"?t.songId:null,
  backingTakeId:typeof t.backingTakeId==="string"?t.backingTakeId:null,
  stemBlob:t.stemBlob instanceof Blob?t.stemBlob:null,
  onsets:(Array.isArray(t.onsets)?t.onsets:[]).filter(v=>Number.isFinite(v)&&v>=0).slice(0,4000),
  grid:t.grid&&Number.isFinite(t.grid.t0)&&t.grid.beat>0?{t0:t.grid.t0,beat:t.grid.beat}:null});
// A take's timing against its beat grid, with the calibrated latency taken off; null when
// there is nothing to measure against (no song, no backing, no armed trainer bar 1).
function libTiming(t){
  if(!t.grid||t.onsets.length<4)return null;
  return timingReport(t.onsets,t.grid,t.calMs||0,libSections(t).map(x=>({name:x.name,from:x.from,to:x.to})));
}

// ---- storage ----
async function libList(){
  const rows = await dbDo("library","readonly",tx=>tx.objectStore("library").getAll());
  lib.takes = (Array.isArray(rows)?rows:[]).filter(validTake).map(cleanTake).sort((a,b)=>b.created-a.created);
  lib.loaded = true;
  // the take on screen is the fresh record, never a stale copy of it
  if(lib.selected) lib.selected = lib.takes.find(t=>t.id===lib.selected.id) || lib.selected;
  return lib.takes;
}
const libPut = rec => dbDo("library","readwrite",tx=>{tx.objectStore("library").put(rec);});
// Called by the recorder when a take is finished. The compressed file is kept; the
// WAV master stays with the recorder's own store until you download or discard it.
async function libKeep(kept, t, meta, stemMeta){
  const info = t.info||{};
  if(t.stemDone) await t.stemDone;        // the compressed solo finishes a moment after the mix
  const seconds = meta&&meta.frames ? meta.frames/meta.sampleRate : (kept.wav&&kept.wav.seconds)||(Date.now()-t.t0)/1000;
  const rec = {id:"take-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,7), created:Date.now(),
    name:kept.name, mime:kept.blob.type||"audio/webm", blob:kept.blob, seconds,
    key:t.key, bpm:t.bpm, mode:info.mode||"full", focus:info.focus||"timing", attempt:info.attempt||"cold",
    mono:!!t.mono, backing:!!t.backing, markers:(t.markers||[]).map(m=>({t:m.t,kind:"mistake"})), calMs:kept.calMs,
    songId:info.songId||null, backingTakeId:info.backingTakeId||t.backingTakeId||null, songPlay:t.songPlay||null, section:info.section||null, masterId:meta?meta.id:null, stemId:stemMeta?stemMeta.id:null, stemBlob:t.stemBlob instanceof Blob?t.stemBlob:null,
    ratings:cleanRatings(null), rerate:null, next:"", onsets:[], grid:null};
  // a beat to measure against exists over a song or backing, or from an armed trainer's bar 1
  const g = t.songPlay ? libGrid(rec) : (t.startFrame!==undefined ? {t0:0, bar:4*60/t.bpm} : null);
  rec.grid = g ? {t0:g.t0, beat:g.bar/4} : null;
  kept.libId = rec.id;
  await libPut(rec);
  // your guitar alone: the solo stem when there is backing in the take, else the master
  const guitar = t.backing ? stemMeta : meta;
  if(guitar && typeof masterPcm==="function") libAnalyse(rec.id, guitar).catch(()=>{});
  if(document.getElementById("takelist")) { await libList(); libDraw(); }
  return rec;
}
// Onsets from the stored guitar master, kept with the take so timing can be re-read later.
async function libAnalyse(id, guitarMeta){
  const chunks = await masterPcm(guitarMeta);
  const bits = bitsOf(guitarMeta), ch = guitarMeta.channels||1;
  // the first fifteen minutes: enough to judge timing, and it bounds the memory used
  if(guitarMeta.frames > 15*60*guitarMeta.sampleRate) guitarMeta = {...guitarMeta, frames:15*60*guitarMeta.sampleRate};
  let n = 0; const per = bits===24 ? 3*ch : ch;
  for(const c of chunks) n += Math.floor(c.length/per);
  const x = new Float32Array(n); let o = 0;
  for(const c of chunks){
    const frames = Math.floor(c.length/per);
    for(let i=0;i<frames;i++){
      if(bits===24){ const b=i*3*ch; let v=c[b]|c[b+1]<<8|c[b+2]<<16; if(v&0x800000) v-=0x1000000; x[o++]=v/8388608; }
      else x[o++] = c[i*ch]/32768;       // one channel is enough to hear the notes
    }
  }
  const onsets = detectOnsets(x, guitarMeta.sampleRate).slice(0,4000).map(v=>Math.round(v*1000)/1000);
  await libList();
  const rec = libFind(id); if(!rec) return;
  rec.onsets = onsets;
  await libPut(rec); await libList(); libDraw();
  if(lib.selected && lib.selected.id===id) libTimingShow();
}
async function libDelete(id){
  // a take used as a backing goes with it: the backing's audio lives in this take
  const used = typeof songs!=="undefined" ? songs.list.filter(s=>s.takeId===id) : [];
  await dbDo(["library","songs"],"readwrite",tx=>{
    tx.objectStore("library").delete(id);
    used.forEach(s=>tx.objectStore("songs").delete(s.id));});
  if(lib.selected && lib.selected.id===id) libClose();
  if(used.length && typeof songSelect==="function"){
    const wasSelected = songs.selected && used.some(s=>s.id===songs.selected.id);
    await songList(); if(wasSelected) await songSelect("");
  }
  await libList(); libDraw();
}
// ---- a take as a backing ----
// Your own rhythm part, recorded and kept, becomes a backing like an imported song: same
// sections, loop and slow-down. Its audio is not copied: the backing points at the take.
// Your latency calibration is stored with it, and applied when it plays, so a solo
// recorded over it lines up with it.
async function libUseAsBacking(){
  const t = lib.selected; if(!t){ return; }
  const have = songs.list.find(s=>s.takeId===t.id);
  if(have){ await songSelect(have.id); libSay("That take is already a backing: it is selected under Your songs."); return; }
  if(!(t.seconds>.5)){ libSay("That take is too short to use as a backing."); return; }
  const g = libGrid(t), rate = (t.songPlay&&t.songPlay.rate)||1;
  const s = {id:"song-"+Date.now()+"-"+Math.random().toString(36).slice(2), kind:"take", takeId:t.id,
    title:("Rhythm: "+t.name.replace(/\.\w+$/,"")).slice(0,200), key:t.key,
    bpm:Math.max(40,Math.min(200,Math.round(t.bpm||90))), downbeat:Math.min(g.t0, t.seconds-.1), duration:t.seconds, form:"",
    offsetMs:Number.isFinite(t.calMs)?t.calMs:0,
    sections:libSections(t).map(x=>({name:x.name,start:Math.round(x.from*1000)/1000,end:Math.round(x.to*1000)/1000})).filter(x=>x.end>x.start)};
  if(!validSong(s)){ libSay("That take can't be used as a backing."); return; }
  await dbDo("songs","readwrite",tx=>{tx.objectStore("songs").put(s);});
  await songList(); await songSelect(s.id);
  libSay(`${s.title} is now a backing: pick it under Your songs on this page, press Play song, and record your solo over it.`
    + (state.cal ? ` Aligned by your ${state.cal.ms} ms latency calibration.` : " Latency isn't calibrated yet, so layers may sit a little late: use Calibrate in the Record row."));
}

// ---- the list ----
const libSay = m => { const el=document.getElementById("takemsg"); if(el) el.textContent=m; };
const libFind = id => lib.takes.find(t=>t.id===id);
function libWhen(ms){ const d=new Date(ms), p=n=>String(n).padStart(2,"0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }
function libDue(t, now=Date.now()){ return !t.rerate && now - t.created >= RERATE_AFTER_MS; }
function libDraw(){
  const list = document.getElementById("takelist"); if(!list) return;
  lib.takes.forEach(t=>{ const r=libTiming(t); t.timingStd = r ? r.std : null; });
  const sel = document.getElementById("takefilter");
  const songs_ = typeof songs!=="undefined" ? songs.list : [];
  sel.innerHTML = '<option value="">All takes</option>' + songs_.map(s=>`<option value="${escapeHTML(s.id)}">${escapeHTML(s.title)}</option>`).join("");
  sel.value = songs_.some(s=>s.id===lib.filter) ? lib.filter : "";
  const shown = lib.takes.filter(t=>!sel.value || t.songId===sel.value);
  list.innerHTML = shown.length ? shown.map(t=>{
    const r = t.ratings.whole, marks = t.markers.length;
    return `<div class="takerow"><b>${escapeHTML(t.name)}</b> · ${escapeHTML(mmss(t.seconds))} · ${escapeHTML(FOCUS_LABEL[t.focus])}, ${t.attempt==="retest"?"retest":"cold attempt"}`
      + (r?` · ${"★".repeat(r)}${"☆".repeat(5-r)}`:" · not rated yet")
      + (marks?` · ${marks} mistake${marks===1?"":"s"}`:"")
      + (libDue(t)?` · <b>time to listen again</b>`:"")
      + ` <button data-open="${escapeHTML(t.id)}">Open</button> <button data-del="${escapeHTML(t.id)}">Delete</button></div>`;
  }).join("") : "<p class=\"tip\">No takes kept yet. Record one and it appears here.</p>";
  const due = lib.takes.filter(t=>libDue(t));
  const box = document.getElementById("rerate");
  box.hidden = !due.length;
  box.innerHTML = due.length ? `<b>Two days on.</b> ${due.length===1?"A take is":due.length+" takes are"} ready to hear again with fresh ears, then rate again: `
    + due.slice(0,3).map(t=>`<button data-open="${escapeHTML(t.id)}">${escapeHTML(t.name)}</button>`).join(" ") : "";
  libStorage();
  libProgress(); abFill(); libBadge();
}
function libStorage(){
  const el = document.getElementById("takestorage"), st = navigator.storage;
  if(!el || !st || typeof st.estimate!=="function") return;
  st.estimate().then(e=>{ if(e&&e.quota) el.textContent = `Stored: ${fileSize(e.usage||0)} of ${fileSize(e.quota)}`; }).catch(()=>{});
}

// A dot on the Songs button when a take is ready to hear again: the two-day prompt is
// visible from any view, not only once you open the library.
function libBadge(){
  const b=[...document.querySelectorAll("#views button")].find(x=>x.dataset&&x.dataset.v==="songs");
  if(!b)return;
  const due=lib.takes.filter(t=>libDue(t)).length;
  b.setAttribute("title",due?`${due} take${due===1?" is":"s are"} ready to hear again`:"");
  b.classList.toggle("due",due>0);
}
// ---- opening a take ----
function libClose(){
  libLayersStop();
  lib.playGeneration++;
  if(lib.url){ try{ URL.revokeObjectURL(lib.url); }catch(e){} lib.url=null; }
  lib.selected=null; lib.peaks=null;
  const d=document.getElementById("takedetail"); if(d) d.hidden=true;
  const p=document.getElementById("takeplay"); if(p){ p.pause(); p.removeAttribute("src"); }
}
async function libOpen(id){
  const t = libFind(id); if(!t){ libSay("That take is no longer stored."); return; }
  libClose();
  lib.selected = t;
  lib.url = URL.createObjectURL(t.blob);
  const p = document.getElementById("takeplay");
  p.src = lib.url; p.preservesPitch = true; p.webkitPreservesPitch = true;
  document.getElementById("takedetail").hidden = false;
  document.getElementById("taketitle").textContent = t.name;
  document.getElementById("takenext").value = t.next;
  document.getElementById("takespeed").value = "1";
  document.getElementById("takeloop").checked = false;
  libRate(); libMarks(); libLayersShow(); libTimingShow();
  lib.peaks = null; libWave();
  const generation = lib.playGeneration;
  libPeaks(t.blob).then(peaks=>{ if(generation===lib.playGeneration){ lib.peaks=peaks; libWave(); } }, ()=>{});
}

// The kept take as a file: the compressed recording, under its own name. (The lossless
// WAV master is offered in the Record row when a take ends, and dropped once downloaded.)
function libDownload(){
  const t = lib.selected;
  if(!t||!t.blob){ libSay("That take is no longer stored."); return null; }
  const url = URL.createObjectURL(t.blob);
  saveFile({url, name:t.name});
  setTimeout(()=>URL.revokeObjectURL(url), 60000);
  return t.name;
}

// ---- the waveform ----
// The loudest sample in each of 600 columns of the decoded take. Needs Web Audio's
// decoder; without it the take still plays and its markers still list.
async function libPeaks(blob, width=600){
  const Ctor = audioContextCtor();
  const own = state.engine&&state.engine.context ? null : (Ctor ? new Ctor() : null), ac = state.engine&&state.engine.context || own;
  if(!ac || !ac.decodeAudioData) throw new Error("no decoder");
  try{
    const buf = await blob.arrayBuffer();
    const ab = await new Promise((ok,fail)=>{ const p=ac.decodeAudioData(buf,ok,fail); if(p&&p.then) p.then(ok,fail); });
    const ch = ab.getChannelData(0), per = Math.max(1, Math.floor(ch.length/width)), peaks = new Float32Array(width);
    for(let i=0;i<width;i++){ let m=0; for(let j=i*per;j<Math.min(ch.length,(i+1)*per);j++){ const v=Math.abs(ch[j]); if(v>m) m=v; } peaks[i]=m; }
    return peaks;
  } finally { if(own&&own.close) own.close(); }
}
// Bar lines in take time. A take over a song counts from the song's own downbeat,
// slowed by the speed it was played at; a take over the trainer starts on bar 1.
function libGrid(t){
  const sp = t.songPlay, song = sp && typeof songs!=="undefined" ? songs.list.find(s=>s.id===t.songId) : null;
  if(song){
    const barSong = 4*60/song.bpm, rate = sp.rate||1, barTake = barSong/rate;
    const first = ((song.downbeat - sp.offset)/rate);
    const t0 = first>=0 ? first : first + Math.ceil(-first/barTake)*barTake;
    return {t0, bar:barTake};
  }
  return {t0:0, bar:4*60/t.bpm};
}
function libSections(t){
  const sp = t.songPlay, song = sp && typeof songs!=="undefined" ? songs.list.find(s=>s.id===t.songId) : null;
  if(!song || !Array.isArray(song.sections)) return [];
  const rate = sp.rate||1;
  return song.sections.map(s=>({name:s.name, from:(s.start-sp.offset)/rate, to:(s.end-sp.offset)/rate}))
    .filter(s=>s.to>0 && s.from<t.seconds).map(s=>({...s, from:Math.max(0,s.from), to:Math.min(t.seconds,s.to)}));
}
function libWave(){
  const t = lib.selected, el = document.getElementById("takewave"); if(!t||!el) return;
  const W=600, H=100, sec=Math.max(t.seconds,.001), x=s=>Math.round(s/sec*W*10)/10;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Waveform of ${escapeHTML(t.name)}, ${escapeHTML(mmss(t.seconds))}. Click to jump.">`;
  libSections(t).forEach((s,i)=>{ svg += `<rect class="wsec${i%2}" x="${x(s.from)}" y="0" width="${Math.max(1,x(s.to)-x(s.from))}" height="${H}"/>`
    + `<text class="wlbl" x="${x(s.from)+3}" y="11">${escapeHTML(s.name)}</text>`; });
  const g = libGrid(t);
  for(let b=g.t0, n=0; b<sec && n<400; b+=g.bar, n++) svg += `<line class="wbar" x1="${x(b)}" y1="0" x2="${x(b)}" y2="${H}"/>`;
  if(lib.peaks){
    let d=""; for(let i=0;i<lib.peaks.length;i++){ const h=Math.max(.5,lib.peaks[i]*H*.46), cx=i+.5; d+=`M${cx},${(H/2-h).toFixed(1)}V${(H/2+h).toFixed(1)}`; }
    svg += `<path class="wpeaks" d="${d}"/>`;
  } else svg += `<text class="wlbl" x="8" y="${H/2}">${typeof AudioContext==="undefined"&&typeof webkitAudioContext==="undefined"?"The waveform needs Web Audio, which this browser withholds.":"Drawing the waveform…"}</text>`;
  // each note's attack, low on the picture, by how close to the beat it was
  if(t.grid) timingOffsets(t.onsets, t.grid, t.calMs||0).forEach(o=>{
    const cls = Math.abs(o.ms)<15 ? "won0" : Math.abs(o.ms)<30 ? "won1" : "won2";
    svg += `<circle class="${cls}" cx="${x(o.t)}" cy="${H-6}" r="2.6"/>`; });
  t.markers.forEach(m=>{ svg += `<line class="wmark" x1="${x(m.t)}" y1="0" x2="${x(m.t)}" y2="${H}"/>`; });
  svg += `<line id="wplayhead" class="wplay" x1="0" y1="0" x2="0" y2="${H}"/></svg>`;
  el.innerHTML = svg;
}
function libSeek(seconds){
  const p=document.getElementById("takeplay"); if(!p||!lib.selected) return;
  p.currentTime = Math.max(0, Math.min(lib.selected.seconds, seconds));
}
function libWaveClick(clientX, rect){
  if(!lib.selected||!rect||!rect.width) return;
  libSeek((clientX-rect.left)/rect.width*lib.selected.seconds);
}
function libMarks(){
  const t=lib.selected, el=document.getElementById("takemarks"); if(!t||!el) return;
  const secs = libSections(t);
  el.innerHTML = (t.markers.length ? "Mistakes: " + t.markers.map((m,i)=>`<button data-jump="${m.t}">${escapeHTML(mmss(m.t))}</button>`).join(" ") : "No mistakes marked.")
    + (secs.length ? " · Sections: " + secs.map(s=>`<button data-jump="${s.from}">${escapeHTML(s.name)}</button>`).join(" ") : "");
}
// A–B loop and slow-down work on takes as they do on songs.
function libLoopTick(){
  const p=document.getElementById("takeplay"), t=lib.selected; if(!p||!t) return;
  const head=document.getElementById("wplayhead");
  if(head){ const x=(p.currentTime/Math.max(t.seconds,.001))*600; head.setAttribute("x1",x); head.setAttribute("x2",x); }
  if(document.getElementById("takeloop").checked){
    const a=Number(document.getElementById("takeloopa").value)||0, b=Number(document.getElementById("takeloopb").value)||t.seconds;
    if(b-a>=.1 && p.currentTime>=b) p.currentTime=a;
  }
}

// ---- timing ----
function libTimingShow(){
  const t=lib.selected, el=document.getElementById("taketiming"); if(!t||!el) return;
  const r = libTiming(t), lean = m => Math.abs(m)<3 ? "right on it" : m<0 ? `${Math.round(-m)} ms ahead of it` : `${Math.round(m)} ms behind it`;
  if(!t.grid) { el.innerHTML = "<p class=\"tip\">No beat to measure your timing against: record over a song, a backing or the 12-bar trainer (start on bar 1) and it can be read.</p>"; return; }
  if(!r || r.std===null){ el.innerHTML = t.onsets.length ? "<p class=\"tip\">Too few notes to say anything about your timing.</p>" : "<p class=\"tip\">Timing is being read from the recording…</p>"; return; }
  el.innerHTML = `<p class="tip">Timing: <b>consistency ±${r.std} ms</b> (${timingWord(r.std)}) over ${r.count} notes against the beat; on average you play ${lean(r.mean)}. `
    + `The dots on the waveform show each note: blue within 15 ms of the beat, gold within 30, pink further off. `
    + (t.calMs ? `Your ${t.calMs} ms latency calibration is taken off.` : `Not calibrated, so a steady offset here may be the gear, not you.`) + `</p>`
    + (r.sections.some(s=>s.std!==null) ? `<p class="tip">By section: ` + r.sections.filter(s=>s.std!==null).map(s=>`${escapeHTML(s.name)} ±${s.std} ms (${timingWord(s.std)}, ${s.count} notes)`).join(" · ") + `</p>` : "");
}

// ---- ratings ----
function libRate(){
  const t=lib.selected, el=document.getElementById("takerate"); if(!t||!el) return;
  const stars = (name,val,scope)=>[1,2,3,4,5].map(n=>`<button data-rate="${n}" data-scope="${escapeHTML(scope)}" aria-pressed="${val===n}" aria-label="${escapeHTML(name)}: ${n} of 5">${n}</button>`).join("");
  const later = t.rerate ? t.rerate.ratings : null, secs = libSections(t);
  const row = (label,scope,first,second)=>`<div class="raterow"><span>${escapeHTML(label)}</span> ${stars(label,first,scope)}`
    + (t.rerate ? ` <span class="ratenote">immediately ${first||"–"} · two days later ${second||"–"}</span>` : "") + `</div>`;
  el.innerHTML = `<p class="tip">Your one focus was <b>${escapeHTML(FOCUS_LABEL[t.focus])}</b>. `
    + (libDue(t) ? `It has been two days: listen again, then rate again below; your first rating stays for comparison.` : (t.rerate?"You have rated it twice.":"Rate it 1 (poor) to 5 (solid).")) + `</p>`
    + row("Whole take", "whole", t.ratings.whole, later&&later.whole)
    + secs.map(s=>row(s.name, "s:"+s.name, t.ratings.sections[s.name], later&&later.sections[s.name])).join("")
    + libSuggest(t);
}
// The section to work on next: the lowest-rated one.
function libWeakest(t){
  const r = t.rerate ? {...t.ratings.sections, ...t.rerate.ratings.sections} : t.ratings.sections;
  const entries = Object.entries(r).sort((a,b)=>a[1]-b[1]);
  return entries.length && entries[0][1] < 5 ? {name:entries[0][0], rating:entries[0][1]} : null;
}
function libSuggest(t){
  const w = libWeakest(t);
  return w ? `<p class="tip">Weakest section: <b>${escapeHTML(w.name)}</b> (${w.rating} of 5). <button data-loopsection="${escapeHTML(w.name)}">Loop it next</button></p>` : "";
}
async function libSetRating(scope, n){
  const t=lib.selected; if(!t || !isRating(n)) return;
  const twoDays = libDue(t) || t.rerate;
  const target = twoDays ? (t.rerate || (t.rerate={at:Date.now(), ratings:cleanRatings(null)})).ratings : t.ratings;
  if(scope==="whole") target.whole=n; else if(scope.startsWith("s:")) target.sections[scope.slice(2)]=n; else return;
  await libPut(t); libRate(); await libList(); libDraw();
}
async function libSaveNext(){
  const t=lib.selected; if(!t) return;
  t.next = document.getElementById("takenext").value.slice(0,200);
  await libPut(t); await libList(); libSay("Saved.");
}

// ---- progress on a song ----
// The song chosen in the list, as a picture: your rating of each take in the order you made
// them, how consistent your timing was, and how many mistakes you marked; plus how many
// run-throughs went all the way through, and the ratings section by section.
function libProgress(){
  const el=document.getElementById("takeprogress"); if(!el) return;
  const takes = lib.takes.filter(t=>lib.filter ? t.songId===lib.filter : false);
  if(!lib.filter || takes.length<2){ el.innerHTML = lib.filter ? "<p class=\"tip\">Progress appears once there are two takes of this song.</p>" : ""; return; }
  const p = progressSeries(takes), W=600, H=150, n=p.ordered.length, x = i => 30 + (n===1 ? 0 : i*(W-60)/(n-1));
  const yr = r => H-24-(r-1)*(H-50)/4, ys = ms => H-24-Math.min(60,ms)/60*(H-50);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Progress across ${n} takes of this song">`;
  for(let r=1;r<=5;r++) svg += `<line class="pgrid" x1="24" y1="${yr(r)}" x2="${W-10}" y2="${yr(r)}"/><text class="wlbl" x="8" y="${yr(r)+3}">${r}</text>`;
  let d=""; p.whole.forEach((r,i)=>{ if(r) d += (d?"L":"M")+x(i)+","+yr(r); });
  if(d) svg += `<path class="pline" d="${d}"/>`;
  p.whole.forEach((r,i)=>{ if(r) svg += `<circle class="pdot" cx="${x(i)}" cy="${yr(r)}" r="3.5"/>`; });
  p.consistency.forEach((s,i)=>{ if(s!==null) svg += `<rect class="pbar" x="${x(i)-5}" y="${ys(s)}" width="10" height="${H-24-ys(s)}"/>`; });
  p.mistakes.forEach((m,i)=>{ if(m) svg += `<text class="pmis" x="${x(i)}" y="12" text-anchor="middle">${m}</text>`; });
  svg += `<text class="wlbl" x="${W-4}" y="${H-6}" text-anchor="end">blue: your rating · gold bars: timing spread (shorter is steadier) · pink: mistakes marked</text></svg>`;
  const sections = {};
  p.ordered.forEach(t=>{ const r = t.rerate ? {...t.ratings.sections, ...t.rerate.ratings.sections} : t.ratings.sections;
    Object.entries(r).forEach(([k,v])=>{ (sections[k] ||= []).push(v); }); });
  el.innerHTML = `<h3 class="cx-more">Progress</h3><p class="tip"><b>${p.clean}</b> of ${p.runs} full run-throughs went all the way through with no mistake marked.</p>` + svg
    + (Object.keys(sections).length ? `<p class="tip">Section ratings, oldest to newest: ` + Object.entries(sections).map(([k,v])=>`${escapeHTML(k)}: ${v.join(" → ")}`).join(" · ") + `</p>` : "");
}

// ---- compare two takes, A and B ----
// Both are started at the same musical place (a section's start, or the first bar), so
// you hear the same passage from each; the switch swaps which one you hear, without a gap.
const ab = {a:null, b:null, urls:[], side:"a"};
function abSection(t, name){ return alignPoint(t, name, libSections(t), t.grid ? {t0:t.grid.t0} : (t.songPlay ? libGrid(t) : null)); }
function abFill(){
  const A=document.getElementById("aba"), B=document.getElementById("abb"); if(!A||!B) return;
  const shown = lib.takes.filter(t=>!lib.filter || t.songId===lib.filter);
  const opts = shown.map(t=>`<option value="${escapeHTML(t.id)}">${escapeHTML(t.name)}</option>`).join("");
  const keepA=A.value, keepB=B.value;
  A.innerHTML = opts; B.innerHTML = opts;
  A.value = shown.some(t=>t.id===keepA) ? keepA : (shown[1]||shown[0]||{}).id||"";
  B.value = shown.some(t=>t.id===keepB) ? keepB : (shown[0]||{}).id||"";
  const names = new Set(); shown.forEach(t=>libSections(t).forEach(s=>names.add(s.name)));
  const sec=document.getElementById("absection"), keep=sec.value;
  sec.innerHTML = `<option value="">From the first bar</option>` + [...names].map(n=>`<option value="${escapeHTML(n)}">${escapeHTML(n)}</option>`).join("");
  sec.value = names.has(keep) ? keep : "";
}
function abStop(){
  [ab.a, ab.b].forEach(el=>{ if(el){ el.pause(); el.removeAttribute("src"); } });
  ab.a = ab.b = null;
  ab.urls.forEach(u=>{ try{ URL.revokeObjectURL(u); }catch(e){} }); ab.urls=[];
  const s=document.getElementById("abside"); if(s) s.textContent="";
}
function abPlay(){
  const ta=libFind(document.getElementById("aba").value), tb=libFind(document.getElementById("abb").value);
  if(!ta||!tb){ libSay("Choose two takes to compare."); return; }
  if(ta.id===tb.id){ libSay("Choose two different takes."); return; }
  abStop();
  const name=document.getElementById("absection").value;
  const mk=(t)=>{ const url=URL.createObjectURL(t.blob); ab.urls.push(url); const el=new Audio(url); el.currentTime=abSection(t,name); return el; };
  ab.a=mk(ta); ab.b=mk(tb); ab.side="a"; abApply();
  [ab.a,ab.b].forEach(el=>{ const p=el.play(); if(p&&p.catch) p.catch(()=>{}); });
  libSay(`Comparing from ${name?name:"the first bar"}: A is ${ta.name}, B is ${tb.name}. Press Switch to hear the other.`);
}
function abApply(){
  if(!ab.a) return;
  ab.a.volume = ab.side==="a" ? 1 : 0; ab.b.volume = ab.side==="b" ? 1 : 0;
  document.getElementById("abside").textContent = `Listening to ${ab.side.toUpperCase()}`;
}
function abSwitch(){ if(!ab.a) return; ab.side = ab.side==="a" ? "b" : "a"; abApply(); }

// ---- layers: the rhythm take, your solo, and a click, each with its own level ----
// A solo recorded over a rhythm take is heard here as it was played: the rhythm take at the
// speed it was recorded over, from where the solo began, and the solo alone (its stem).
// Each can be turned down or off, to hear your own playing bare or the backing without
// it. It is not a studio: GarageBand or similar does that job better; this is the
// listening you want while you are still learning the part.
const layers = {solo:null, rhythm:null, urls:[], clickTimer:null, timer:null};
function libRhythmOf(t){ return t && t.backingTakeId ? libFind(t.backingTakeId) : null; }
function libLayersShow(){
  const t=lib.selected, box=document.getElementById("takelayers"); if(!box) return;
  libLayersStop();
  box.hidden = !(t && t.stemBlob);
  if(box.hidden) return;
  const rt = libRhythmOf(t);
  ["layrhythm","layrhythmv","laydlrhythm"].forEach(id=>{ document.getElementById(id).disabled = !rt; });
  document.getElementById("laynote").textContent = rt ? `Over ${rt.name}.` : "Its rhythm take is no longer in the library, so only your solo can be heard on its own.";
}
function libLayerLevels(){
  const lv = id => Math.max(0, Math.min(1, Number(document.getElementById(id).value)/100));
  const on = id => !!document.getElementById(id).checked;
  return {rhythm:on("layrhythm")?lv("layrhythmv"):0, solo:on("laysolo")?lv("laysolov"):0, click:on("layclick")?lv("layclickv"):0};
}
function libLayersApply(){
  const l = libLayerLevels();
  if(layers.solo) layers.solo.volume = l.solo;
  if(layers.rhythm) layers.rhythm.volume = l.rhythm;
  layers.clickLevel = l.click;
}
function libLayersPlay(){
  const t=lib.selected; if(!t||!t.stemBlob) return;
  libLayersStop();
  const rt = libRhythmOf(t), sp = t.songPlay||{offset:0,rate:1}, rate = sp.rate||1;
  const mk = blob => { const url=URL.createObjectURL(blob); layers.urls.push(url); const el=new Audio(url); el.preservesPitch=true; el.webkitPreservesPitch=true; return el; };
  layers.solo = mk(t.stemBlob);
  layers.solo.currentTime = 0;
  libLayersApply();
  const lag = (Number.isFinite(t.calMs)?t.calMs:0)/1000;     // the solo reached the recording this late
  const start = new Date();
  if(rt){
    layers.rhythm = mk(rt.blob); layers.rhythm.playbackRate = rate;
    // the rhythm take from the song position the solo began at, held back by the same lag
    const from = sp.offset - lag*rate;
    if(from >= 0) layers.rhythm.currentTime = from;
    else { layers.rhythm.currentTime = 0; layers.rhythmDelay = -from/rate; }
    libLayersApply();
  }
  const go = el => { const p=el.play(); if(p&&p.catch) p.catch(()=>{}); };
  go(layers.solo);
  if(layers.rhythm){ if(layers.rhythmDelay>0){ const r=layers.rhythm; setTimeout(()=>{ if(layers.rhythm===r) go(r); }, layers.rhythmDelay*1000); } else go(layers.rhythm); }
  libLayerClick(t);
  layers.timer = setInterval(libLayersApply, 100);
}
// A click on the recording's bar grid, on the audio clock, at its own level.
function libLayerClick(t){
  const a = typeof audio==="function" ? audio() : null;
  if(!a || !a.now || !a.blip) return;
  const g = libGrid(t), beat = 60/t.bpm, sp = t.songPlay||{}, rate = sp.rate||1;
  const t0 = a.now(); let k = 0;
  const first = ((g.t0 % beat) + beat) % beat;
  layers.clickTimer = setInterval(()=>{
    const now = a.now();
    while(t0 + first + k*beat < now + .12){
      const when = t0 + first + k*beat - now;
      if(layers.clickLevel > 0 && when > -.02) a.blip(k%4===0?1300:900,{when:Math.max(0,when),dur:.04,vol:.5*layers.clickLevel});
      k++;
    }
  }, 25);
}
function libLayersStop(){
  if(layers.clickTimer){ clearInterval(layers.clickTimer); layers.clickTimer=null; }
  if(layers.timer){ clearInterval(layers.timer); layers.timer=null; }
  [layers.solo,layers.rhythm].forEach(el=>{ if(el){ el.pause(); el.removeAttribute("src"); } });
  layers.solo=layers.rhythm=null; layers.rhythmDelay=0;
  layers.urls.forEach(u=>{ try{ URL.revokeObjectURL(u); }catch(e){} }); layers.urls=[];
}
// The three parts, as files: your solo alone, the rhythm take alone, and the two mixed —
// which is the recording itself, made with both together.
function libLayerDownload(which){
  const t=lib.selected; if(!t) return;
  const rt=libRhythmOf(t), ext=n=>{ const m=/\.\w+$/.exec(n); return m?m[0]:".webm"; };
  const file = which==="solo" ? {blob:t.stemBlob, name:t.name.replace(/\.\w+$/, "-solo"+ext(t.name))}
    : which==="rhythm" ? {blob:rt&&rt.blob, name:rt&&rt.name.replace(/\.\w+$/, "-rhythm"+ext(rt.name))}
    : {blob:t.blob, name:t.name.replace(/\.\w+$/, "-mixed"+ext(t.name))};
  if(!(file.blob instanceof Blob)){ libSay("That part isn't available."); return; }
  saveFile({url:URL.createObjectURL(file.blob), name:file.name});
  libSay(`${file.name}: ${fileSize(file.blob.size)}.`);
}

// ---- zip (store only) and Export all ----
const CRC_TABLE = (()=>{ const t=new Uint32Array(256); for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c = c&1 ? 0xEDB88320^(c>>>1) : c>>>1; t[n]=c>>>0; } return t; })();
function crc32(bytes){ let c=0xFFFFFFFF; for(let i=0;i<bytes.length;i++) c = CRC_TABLE[(c^bytes[i])&0xFF]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }
// files: [{name, bytes: Uint8Array}] → Blob. Names are UTF-8; nothing is compressed, so
// each file is written whole with its CRC, then the directory that indexes them.
function zipStore(files, when=new Date()){
  const enc = new TextEncoder(), parts = [], central = [];
  const dosTime = (when.getHours()<<11)|(when.getMinutes()<<5)|(when.getSeconds()>>1);
  const dosDate = ((Math.max(1980,when.getFullYear())-1980)<<9)|((when.getMonth()+1)<<5)|when.getDate();
  let offset=0;
  for(const f of files){
    const name=enc.encode(f.name), crc=crc32(f.bytes), h=new DataView(new ArrayBuffer(30));
    h.setUint32(0,0x04034b50,true); h.setUint16(4,20,true); h.setUint16(6,0x0800,true); h.setUint16(8,0,true);
    h.setUint16(10,dosTime,true); h.setUint16(12,dosDate,true); h.setUint32(14,crc,true);
    h.setUint32(18,f.bytes.length,true); h.setUint32(22,f.bytes.length,true); h.setUint16(26,name.length,true); h.setUint16(28,0,true);
    parts.push(new Uint8Array(h.buffer), name, f.bytes);
    const c=new DataView(new ArrayBuffer(46));
    c.setUint32(0,0x02014b50,true); c.setUint16(4,20,true); c.setUint16(6,20,true); c.setUint16(8,0x0800,true); c.setUint16(10,0,true);
    c.setUint16(12,dosTime,true); c.setUint16(14,dosDate,true); c.setUint32(16,crc,true);
    c.setUint32(20,f.bytes.length,true); c.setUint32(24,f.bytes.length,true); c.setUint16(28,name.length,true);
    c.setUint32(42,offset,true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30+name.length+f.bytes.length;
  }
  const cdSize = central.reduce((n,p)=>n+p.length,0), end=new DataView(new ArrayBuffer(22));
  end.setUint32(0,0x06054b50,true); end.setUint16(8,files.length,true); end.setUint16(10,files.length,true);
  end.setUint32(12,cdSize,true); end.setUint32(16,offset,true);
  return new Blob([...parts,...central,new Uint8Array(end.buffer)],{type:"application/zip"});
}
// What Export all writes as JSON: ratings, markers and stats for every take, and the
// details of every song. A song's audio file is never part of an export.
function libExportData(){
  return {app:"Minor Pentatonic Practice Desk", exported:new Date().toISOString(), version:1,
    songs:(typeof songs!=="undefined"?songs.list:[]).map(s=>({id:s.id,title:s.title,key:s.key,bpm:s.bpm,downbeat:s.downbeat,duration:s.duration,form:s.form||"",sections:s.sections||[]})),
    takes:lib.takes.map(t=>({id:t.id,file:"takes/"+libFileName(t),name:t.name,created:new Date(t.created).toISOString(),seconds:t.seconds,key:t.key,bpm:t.bpm,
      mode:t.mode,focus:t.focus,attempt:t.attempt,songId:t.songId,markers:t.markers,calMs:t.calMs??null,
      ratings:t.ratings,rerate:t.rerate,next:t.next,timing:t.timing||null}))};
}
const libFileName = t => t.name.replace(/[^A-Za-z0-9._-]+/g,"-").replace(/^-+/,"") || (t.id+".webm");
async function libExport(){
  if(!lib.takes.length){ libSay("Nothing to export yet."); return null; }
  const files = [{name:"practice-export.json", bytes:new TextEncoder().encode(JSON.stringify(libExportData(),null,2))}];
  for(const t of lib.takes) files.push({name:"takes/"+libFileName(t), bytes:new Uint8Array(await t.blob.arrayBuffer())});
  const blob = zipStore(files);
  const stamp = new Date().toISOString().slice(0,10);
  saveFile({url:URL.createObjectURL(blob), name:`practice-export-${stamp}.zip`});
  libSay(`Exported ${lib.takes.length} take${lib.takes.length===1?"":"s"} (${fileSize(blob.size)}). Song files are never included.`);
  return blob;
}

// ---- wiring, run once by the Songs view ----
function libInit(){
  if(lib.wired) return; lib.wired=true;
  const el = id => document.getElementById(id);
  el("takelist").onclick = e=>{ const d=e.target&&e.target.dataset; if(!d) return;
    if(d.open) libOpen(d.open); else if(d.del) libDelete(d.del).catch(()=>libSay("That take couldn't be deleted.")); };
  el("rerate").onclick = e=>{ const d=e.target&&e.target.dataset; if(d&&d.open) libOpen(d.open); };
  el("takefilter").onchange = ()=>{ lib.filter=el("takefilter").value; libDraw(); };
  el("takeexport").onclick = ()=>libExport().catch(()=>libSay("The export couldn't be made."));
  el("takewave").onclick = e=>libWaveClick(e.clientX, e.currentTarget&&e.currentTarget.getBoundingClientRect?e.currentTarget.getBoundingClientRect():null);
  el("takemarks").onclick = e=>{ const d=e.target&&e.target.dataset; if(d&&d.jump!==undefined) libSeek(Number(d.jump)); };
  el("takerate").onclick = e=>{ const d=e.target&&e.target.dataset;
    if(d&&d.rate) libSetRating(d.scope, Number(d.rate)).catch(()=>libSay("The rating couldn't be saved."));
    else if(d&&d.loopsection) libLoopSection(d.loopsection); };
  el("takenext").onchange = ()=>libSaveNext().catch(()=>libSay("That note couldn't be saved."));
  el("takespeed").onchange = ()=>{ const r=Number(el("takespeed").value); if([.5,.75,.9,1].includes(r)) el("takeplay").playbackRate=r; };
  el("takedl").onclick = libDownload;
  el("takeclose").onclick = libClose;
  el("abplay").onclick = abPlay; el("abswitch").onclick = abSwitch; el("abstop").onclick = abStop;
  el("layplay").onclick = libLayersPlay; el("laystop").onclick = libLayersStop;
  ["layrhythm","laysolo","layclick","layrhythmv","laysolov","layclickv"].forEach(id=>{ el(id).onchange = el(id).oninput = libLayersApply; });
  el("laydlsolo").onclick = ()=>libLayerDownload("solo"); el("laydlrhythm").onclick = ()=>libLayerDownload("rhythm"); el("laydlboth").onclick = ()=>libLayerDownload("both");
  el("takeasbacking").onclick = ()=>libUseAsBacking().catch(()=>libSay("That take couldn't be made a backing."));
  lib.timer = setInterval(libLoopTick, 50);
}
function libLoopSection(name){
  const song = lib.selected && typeof songs!=="undefined" ? songs.list.find(s=>s.id===lib.selected.songId) : null;
  const sec = song && (song.sections||[]).find(s=>s.name===name);
  if(!sec){ libSay("That section isn't on the song any more."); return; }
  if(typeof songLoopSection==="function") songLoopSection(sec);
  libSay(`Set up ${name} to loop on the song: press Play song.`);
}
function renderLibrary(){
  libInit();
  if(!lib.loaded) libList().then(libDraw, ()=>libSay("Take storage is unavailable."));
  else libDraw();
}
