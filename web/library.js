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
  backingTakeId:typeof t.backingTakeId==="string"?t.backingTakeId:null});

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
  const seconds = meta&&meta.frames ? meta.frames/meta.sampleRate : (kept.wav&&kept.wav.seconds)||(Date.now()-t.t0)/1000;
  const rec = {id:"take-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,7), created:Date.now(),
    name:kept.name, mime:kept.blob.type||"audio/webm", blob:kept.blob, seconds,
    key:t.key, bpm:t.bpm, mode:info.mode||"full", focus:info.focus||"timing", attempt:info.attempt||"cold",
    mono:!!t.mono, backing:!!t.backing, markers:(t.markers||[]).map(m=>({t:m.t,kind:"mistake"})), calMs:kept.calMs,
    songId:info.songId||null, backingTakeId:info.backingTakeId||t.backingTakeId||null, songPlay:t.songPlay||null, section:info.section||null, masterId:meta?meta.id:null, stemId:stemMeta?stemMeta.id:null,
    ratings:cleanRatings(null), rerate:null, next:"", onsets:t.onsets||[]};
  kept.libId = rec.id;
  await libPut(rec);
  if(document.getElementById("takelist")) { await libList(); libDraw(); }
  return rec;
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
}
function libStorage(){
  const el = document.getElementById("takestorage"), st = navigator.storage;
  if(!el || !st || typeof st.estimate!=="function") return;
  st.estimate().then(e=>{ if(e&&e.quota) el.textContent = `Stored: ${fileSize(e.usage||0)} of ${fileSize(e.quota)}`; }).catch(()=>{});
}

// ---- opening a take ----
function libClose(){
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
  libRate(); libMarks();
  lib.peaks = null; libWave();
  const generation = lib.playGeneration;
  libPeaks(t.blob).then(peaks=>{ if(generation===lib.playGeneration){ lib.peaks=peaks; libWave(); } }, ()=>{});
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
  el("takeclose").onclick = libClose;
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
