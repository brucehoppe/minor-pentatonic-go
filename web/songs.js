// Local song library. Loaded before app.js; app state and storage are used only
// after the desk has started. Audio files never leave this browser.
const songs = {list:[], selected:null, player:null, url:null, source:null, bus:null,
  generation:0, playGeneration:0, timer:null, loopTimer:null, taps:[], loaded:false, window:null, pending:null, chordKey:""};
function validSong(s){
  return !!s && typeof s.id==="string" && s.id.length>0 && s.id.length<160
    && typeof s.title==="string" && s.title.length>0 && s.title.length<=200
    && Number.isInteger(s.key) && s.key>=0 && s.key<12
    && Number.isFinite(s.bpm) && s.bpm>=40 && s.bpm<=200
    && Number.isFinite(s.downbeat) && s.downbeat>=0
    && Number.isFinite(s.duration) && s.duration>0 && s.downbeat<s.duration
    && (s.chords===undefined||(typeof s.chords==="string"&&s.chords.length<=400))
    && (s.sections===undefined||(Array.isArray(s.sections)&&s.sections.length<=40&&s.sections.every(validSection)));
}
// A section is a named stretch of the song, in seconds, optionally with its own chords.
function validSection(x){
  return !!x && typeof x.name==="string" && x.name.length>0 && x.name.length<=60
    && Number.isFinite(x.start) && x.start>=0 && Number.isFinite(x.end) && x.end>x.start
    && (x.chords===undefined||(typeof x.chords==="string"&&x.chords.length<=400));
}
// ---- chords ----
// "Am | Dm | E7" is three bars; "Am Dm | E7" splits the first bar in two. The chord
// overlay follows whatever the song is on, so a solo can be aimed at the right notes.
const CHORD_TYPES={"":[0,4,7],m:[0,3,7],"7":[0,4,7,10],m7:[0,3,7,10],maj7:[0,4,7,11],"6":[0,4,7,9],m6:[0,3,7,9],
  "9":[0,4,7,10,2],dim:[0,3,6],dim7:[0,3,6,9],m7b5:[0,3,6,10],add9:[0,4,7,2],m9:[0,3,7,10,2],maj9:[0,4,7,11,2],"11":[0,4,7,10,5],"13":[0,4,7,10,9],"7sus4":[0,5,7,10],"5":[0,7],sus4:[0,5,7],sus2:[0,2,7],aug:[0,4,8]};
const CHORD_ROOTS={C:0,D:2,E:4,F:5,G:7,A:9,B:11};
function parseChord(text){
  // a slash chord (Am/G) is its chord: the bass note is not a chord tone to aim at
  const m=/^([A-Ga-g])([#b\u266f\u266d]?)(.*)$/.exec(String(text).trim().split("/")[0]);
  if(!m)return null;
  let pc=CHORD_ROOTS[m[1].toUpperCase()];
  if(m[2]==="#"||m[2]==="\u266f")pc++;else if(m[2]==="b"||m[2]==="\u266d")pc--;
  let q=m[3].replace(/^(min|mi|-)/,"m").replace(/^(maj|M)$/,"").replace(/^(maj7|M7|\u0394)/,"maj7");
  if(!Object.prototype.hasOwnProperty.call(CHORD_TYPES,q))return null;
  return {pc:((pc%12)+12)%12,intervals:CHORD_TYPES[q],name:m[1].toUpperCase()+m[2]+q};
}
// text -> {bars:[[chord,…],…], bad:[token,…]}; a bar with nothing usable in it is dropped
function parseChords(text){
  const bars=[],bad=[];
  String(text||"").split("|").forEach(bar=>{
    const chords=[];
    bar.trim().split(/[\s,]+/).filter(Boolean).forEach(tok=>{const c=parseChord(tok);if(c)chords.push(c);else bad.push(tok);});
    if(chords.length)bars.push(chords);});
  return {bars,bad};
}
// The chord sounding at song time t: from the section's own chords if it has them, else
// the whole song's; bars are counted from the section's start (or the downbeat).
function chordAt(song,t){
  const sec=(song.sections||[]).find(x=>t>=x.start&&t<x.end);
  const {bars}=parseChords(sec&&sec.chords?sec.chords:song.chords);
  const base=sec?sec.start:song.downbeat;
  if(!bars.length||t<base)return null;
  const bar=(t-base)/(4*60/song.bpm),chords=bars[Math.floor(bar)%bars.length];
  return chords[Math.min(chords.length-1,Math.floor((bar%1)*chords.length))];
}
// Lights the chord tones of a chord (or none), redrawing only when the chord changes.
// Shared by songs and the looper: whatever is playing, the overlay follows it.
function applyLiveChord(c){
  const key=c?c.pc+":"+c.name:"";
  if(key===songs.chordKey)return;
  songs.chordKey=key;state.liveChord=c?{pc:c.pc,intervals:c.intervals}:null;
  // the Songs view has no fretboard to light, and redrawing it would reset its own fields
  if(state.chord==="band"&&state.view!=="songs")render();
}
// Called as the song plays (Follow backing).
function songFollow(t){const s=songs.selected;applyLiveChord(s?chordAt(s,t):null);}
function songSay(message){document.getElementById("songstatus").textContent=message;}
// Only sounding backing identifies a new take. Merely browsing the library must
// not rename a drill or override the trainer's key and tempo.
function songNow(){return songs.player&&!songs.player.paused?songs.selected:null;}
async function songList(){
  const rows=await dbDo("songs","readonly",tx=>tx.objectStore("songs").getAll());
  songs.list=(Array.isArray(rows)?rows:[]).filter(validSong).sort((a,b)=>a.title.localeCompare(b.title));
  songs.loaded=true;
  const menu=document.getElementById("songlist");
  menu.innerHTML='<option value="">Choose a song</option>'+songs.list.map(s=>
    `<option value="${escapeHTML(s.id)}">${escapeHTML(s.title)}</option>`).join("");
  menu.value=songs.selected?songs.selected.id:"";
  return songs.list;
}
function songRelease(){
  songStop();
  if(songs.source)songs.source.disconnect();
  if(songs.bus)songs.bus.disconnect();
  if(songs.player){songs.player.removeAttribute("src");songs.player.load();}
  if(songs.url)URL.revokeObjectURL(songs.url);
  songs.player=null;songs.source=null;songs.bus=null;songs.url=null;
}
function songStop(){
  songs.playGeneration++;
  if(songs.timer!==null)clearInterval(songs.timer);
  if(songs.loopTimer!==null)clearInterval(songs.loopTimer);
  songs.timer=null;songs.loopTimer=null;songs.chordKey="";
  if(songs.player)songs.player.pause();
}
function songFields(){
  const s=songs.selected;
  document.getElementById("songdetails").hidden=!s;
  if(!s)return;
  document.getElementById("songtitle").value=s.title;
  document.getElementById("songkey").value=String(s.key);
  document.getElementById("songbpm").value=String(s.bpm);
  document.getElementById("songdownbeat").value=String(s.downbeat);
  document.getElementById("songform").value=s.form||"";
  document.getElementById("songloopa").value=String(s.downbeat);
  document.getElementById("songloopb").value=String(s.duration);
  document.getElementById("songloop").checked=false;
  document.getElementById("songchords").value=s.chords||"";
  document.getElementById("songchordnote").textContent="";
  songSectionsDraw();
}
// Sections of the selected song, each with its own chords, a loop and a record button.
function songSectionsDraw(){
  const s=songs.selected,box=document.getElementById("songsections"),mode=document.getElementById("recmode");
  const secs=s&&Array.isArray(s.sections)?s.sections:[];
  box.innerHTML=secs.length?secs.map((x,i)=>`<div class="secrow"><b>${escapeHTML(x.name)}</b> ${Number(x.start).toFixed(1)}\u2013${Number(x.end).toFixed(1)} s `
    +`<input data-chords="${i}" value="${escapeHTML(x.chords||"")}" maxlength="400" placeholder="chords: Am | Dm | E7" aria-label="Chords for ${escapeHTML(x.name)}"> `
    +`<button data-loop="${i}">Loop</button> <button data-rec="${i}">Record this section</button> <button data-del="${i}">Remove</button></div>`).join("")
    :"<p class=\"tip\">No sections yet. Add them by hand below, or build them from a form on the Song structure page.</p>";
  if(mode){const o=[...(mode.options||[])].find(o=>o.value==="section");if(o)o.disabled=!secs.length;}
}
async function songSelect(id){
  if(state.rec){songSay("Finish the take before changing songs.");return;}
  const generation=++songs.generation;
  songRelease();songs.selected=null;songFields();
  const s=songs.list.find(s=>s.id===id);
  if(!s)return;
  try{
    // an imported song's audio is its own file; a take used as a backing plays the take
    const row=s.kind==="take"
      ?await dbDo("library","readonly",tx=>tx.objectStore("library").get(s.takeId))
      :await dbDo("songfiles","readonly",tx=>tx.objectStore("songfiles").get(id));
    if(generation!==songs.generation)return;
    const file=s.kind==="take"?(row&&row.blob):(row&&row.file);
    if(!(file instanceof Blob))throw new Error(s.kind==="take"?"The rhythm take is missing. Record it again.":"The song file is missing. Import it again.");
    songs.url=URL.createObjectURL(file);
    const p=songs.player=new Audio(songs.url);p.preload="metadata";
    songs.selected=s;songs.taps=[];
    p.addEventListener("ended",()=>{if(songs.player===p){songStop();songSay("Song finished.");}});
    p.addEventListener("error",()=>{if(songs.player===p){songStop();songSay("This browser could not play the file. Try a WAV or MP3 copy.");}});
    songFields();songSay("Ready. Use headphones when recording with backing.");
    // the key selector picks the pentatonic boxes, so it follows the song
    if(state.key!==s.key){state.key=s.key;if(state.view!=="songs")render();}
  }catch(e){songSay(e.message||"The song could not be opened.");}
}
function songDuration(file){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(file),p=new Audio();
    let settled=false;
    const timeout=setTimeout(()=>finish(new Error("Reading the song timed out. Try a WAV or MP3 copy.")),60000);
    function finish(error){if(settled)return;settled=true;clearTimeout(timeout);const duration=p.duration;p.removeAttribute("src");p.load();URL.revokeObjectURL(url);
      if(error)reject(error);else if(Number.isFinite(duration)&&duration>0)resolve(duration);
      else reject(new Error("The file has no readable duration."));}
    p.addEventListener("loadedmetadata",()=>finish(),{once:true});
    p.addEventListener("error",()=>finish(new Error("This browser could not read the file. Try a WAV or MP3 copy.")),{once:true});
    p.preload="metadata";p.src=url;
  });
}
// A song is kept whole in browser storage and decoded to play, so a file that is
// hundreds of megabytes is more likely a mistake than a song.
const SONG_MAX_BYTES=300*1024*1024;
async function songImport(file){
  if(state.rec)throw new Error("Finish the take before importing a song.");
  if(!file||!file.size||!(/\.(mp3|m4a|wav)$/i.test(file.name||"")))throw new Error("Choose an MP3, M4A or WAV audio file.");
  if(file.size>SONG_MAX_BYTES)throw new Error("That file is over 300 MB, too large to keep in the browser. Use an MP3 or M4A copy.");
  const duration=await songDuration(file);
  const s={id:"song-"+Date.now()+"-"+Math.random().toString(36).slice(2),
    title:file.name.replace(/\.[^.]+$/,"").slice(0,200)||"Untitled song",key:state.key,
    bpm:Math.max(40,Math.min(200,state.bpm)),downbeat:0,duration,form:""};
  // Both records commit together: quota errors cannot leave a song without audio.
  await dbDo(["songs","songfiles"],"readwrite",tx=>{
    tx.objectStore("songs").put(s);tx.objectStore("songfiles").put({id:s.id,file});});
  if(navigator.storage&&navigator.storage.persist)navigator.storage.persist().catch(()=>{});
  await songList();await songSelect(s.id);return s;
}
async function songSaveSections(mutate){
  const s=songs.selected;
  if(!s)return;
  if(state.rec)throw new Error("Finish the take before editing sections.");
  const secs=[...(s.sections||[])];
  mutate(secs);
  secs.sort((a,b)=>a.start-b.start);
  const next={...s,sections:secs};
  if(!validSong(next))throw new Error("A section needs a name, a start, and an end after its start.");
  await dbDo("songs","readwrite",tx=>tx.objectStore("songs").put(next));
  songs.selected=next;await songList();songSectionsDraw();
}
function songAddSection(){
  const name=document.getElementById("secname").value.trim()||"Section",start=Number(document.getElementById("secstart").value),end=Number(document.getElementById("secend").value);
  return songSaveSections(secs=>{
    if(!(Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end>start&&end<=songs.selected.duration))throw new Error("A section's end must be after its start, inside the song.");
    secs.push({name:name.slice(0,60),start,end});});
}
// Sections from a Song structure form: each part's bars at the song's tempo, from its downbeat.
async function songBuildSections(formIndex){
  const f=typeof FORMS!=="undefined"?FORMS[formIndex]:null;
  if(!f)throw new Error("Choose a form first.");
  const s=songs.selected,bar=4*60/s.bpm;
  return songSaveSections(secs=>{
    secs.length=0;
    let at=s.downbeat;
    for(const [name,bars] of f.secs){
      if(at>=s.duration)break;
      secs.push({name:String(name).slice(0,60),start:Math.round(at*1000)/1000,end:Math.round(Math.min(s.duration,at+bars*bar)*1000)/1000});
      at+=bars*bar;}});
}
function songLoopSection(sec){
  document.getElementById("songloopa").value=String(sec.start);
  document.getElementById("songloopb").value=String(sec.end);
  document.getElementById("songloop").checked=true;
}
// One section, recorded alone: the take starts, the song plays from the section's start
// after its count-in, and both stop at the section's end.
async function songRecordSection(i){
  const s=songs.selected,sec=s&&s.sections&&s.sections[i];
  if(!sec||!songs.player)return;
  state.pendingSection={name:sec.name,start:sec.start,end:sec.end};
  // The take starts before the song does (the count-in comes first), so say now what it
  // will be recording over: the song, at this speed, beginning a count-in before the section.
  const rate=Number(document.getElementById("songspeed").value)||1;
  songs.pending={song:s,rate,offset:sec.start-(document.getElementById("songcount").checked?4*60/s.bpm:0)};
  document.getElementById("recmode").value="section";
  await toggleRecord();
  await songPlay({a:sec.start,b:sec.end});
}
async function songSave(){
  if(!songs.selected)return;
  if(state.rec)throw new Error("Finish the take before editing its song.");
  const s={...songs.selected,title:document.getElementById("songtitle").value.trim(),
    key:Number(document.getElementById("songkey").value),bpm:Number(document.getElementById("songbpm").value),
    downbeat:Number(document.getElementById("songdownbeat").value),form:document.getElementById("songform").value.slice(0,1000),
    chords:document.getElementById("songchords").value.slice(0,400)};
  const parsed=parseChords(s.chords);
  if(parsed.bad.length)throw new Error(`I couldn't read ${parsed.bad.slice(0,3).join(", ")} as a chord. Try Am, Dm7, E7, C#m, Bb, G5.`);
  if(!validSong(s))throw new Error("Use a title, tempo from 40 to 200, and a downbeat inside the song.");
  await dbDo("songs","readwrite",tx=>tx.objectStore("songs").put(s));
  songs.selected=s;await songList();songSay("Song details saved on this device.");
}
function songTap(){
  const now=Date.now(),t=songs.taps;
  if(t.length&&now-t[t.length-1]>2000)t.length=0;
  t.push(now);if(t.length>6)t.shift();
  if(t.length>1){const bpm=Math.round(60000/((now-t[0])/(t.length-1)));
    document.getElementById("songbpm").value=String(Math.max(40,Math.min(200,bpm)));}
}
function songBounds(){
  const s=songs.selected;
  if(songs.window&&songs.window.b-songs.window.a>=.1&&songs.window.b<=s.duration)return {...songs.window,loop:false};
  const loop=document.getElementById("songloop").checked;
  const a=loop?Number(document.getElementById("songloopa").value):s.downbeat;
  const b=loop?Number(document.getElementById("songloopb").value):s.duration;
  if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b>s.duration||b-a<.1)throw new Error("Loop B must be after A and inside the song.");
  return {a,b,loop};
}
async function songPlay(win){
  if(!songs.player)return;
  songStop();
  songs.window=win&&typeof win.a==="number"&&typeof win.b==="number"?win:null;
  const p=songs.player,s=songs.selected,generation=songs.playGeneration;
  try{
    const {a,b,loop}=songBounds(),rate=Number(document.getElementById("songspeed").value);
    if(![.5,.75,.9,1].includes(rate))throw new Error("Choose one of the playback speeds.");
    const engine=audio();
    if(engine&&engine.context&&!songs.source){
      songs.source=engine.context.createMediaElementSource(p);songs.bus=engine.bus();songs.source.connect(songs.bus);}
    // A backing made from a take is played that much early: your guitar reached the
    // recording late by the calibrated latency, and a solo over it will too.
    const off=(s.offsetMs||0)/1000,from=Math.min(a+off,b-.05);
    p.preservesPitch=true;p.webkitPreservesPitch=true;p.playbackRate=rate;p.currentTime=from;
    const start=()=>{
      if(generation!==songs.playGeneration)return;
      p.play().then(()=>{
        if(generation!==songs.playGeneration){p.pause();return;}
        songSay(`${s.title} · ${Math.round(s.bpm*rate)} bpm${engine&&engine.context?"":" · compatibility playback; recordings are guitar only"}`
          +(s.kind==="take"?(state.cal?` · aligned by ${s.offsetMs||0} ms`:" · latency isn't calibrated, so a solo over this may sit a little late"):""));
        songs.loopTimer=setInterval(()=>{
          if(p.currentTime>=b){
            if(loop)p.currentTime=from;
            else{songStop();
              // one section recorded alone ends with its section
              if(state.rec&&state.rec.phase==="recording"&&state.rec.info&&state.rec.info.mode==="section")stopRecording();}}
          else songFollow(p.currentTime);
          document.getElementById("songposition").textContent=mmss(p.currentTime)+" / "+mmss(s.duration);
        },25);
      }).catch(()=>songSay("Playback was blocked. Press Play song again."));
    };
    if(document.getElementById("songcount").checked){
      let beat=0,booked=false;
      songs.timer=beatLoop(60/(s.bpm*rate),when=>{
        if(generation!==songs.playGeneration||booked)return;
        if(beat<4){if(engine)engine.blip(beat===0?1200:800,{when});beat++;}
        else {booked=true;atBeat(when,()=>{if(generation===songs.playGeneration){clearInterval(songs.timer);songs.timer=null;start();}});}
      });
      songSay("Count in: four beats…");
    }else start();
  }catch(e){songStop();songSay(e.message||"The song could not play.");}
}
function renderSongs(){
  const el=id=>document.getElementById(id);
  el("songkey").innerHTML=NOTES.map((n,i)=>`<option value="${i}">${n}</option>`).join("");
  songFields();
  el("songfile").onchange=async()=>{const f=el("songfile").files[0];if(!f)return;
    el("songfile").disabled=true;songSay("Importing audio…");
    try{await songImport(f);}catch(e){songSay(e.message||"Import failed. Check available browser storage.");}
    finally{el("songfile").disabled=false;el("songfile").value="";}};
  el("songlist").onchange=()=>songSelect(el("songlist").value);
  el("songsave").onclick=()=>songSave().catch(e=>songSay(e.message));
  el("songtap").onclick=songTap;
  el("secstartnow").onclick=()=>{if(songs.player)el("secstart").value=songs.player.currentTime.toFixed(2);};
  el("secendnow").onclick=()=>{if(songs.player)el("secend").value=songs.player.currentTime.toFixed(2);};
  el("secadd").onclick=()=>songAddSection().catch(e=>songSay(e.message));
  el("secform").innerHTML='<option value="">Build sections from a form…</option>'+(typeof FORMS!=="undefined"?FORMS.map((f,i)=>`<option value="${i}">${escapeHTML(f.t)}</option>`).join(""):"");
  el("secbuild").onclick=()=>{const v=el("secform").value;if(v==="")return songSay("Choose a form first.");songBuildSections(Number(v)).catch(e=>songSay(e.message));};
  el("songfindkey").onclick=()=>{state.view="song";render();window.scrollTo&&window.scrollTo({top:0,behavior:"smooth"});};
  el("songchords").oninput=()=>{const r=parseChords(el("songchords").value);
    el("songchordnote").textContent=r.bad.length?`Can't read: ${r.bad.slice(0,4).join(", ")}`:r.bars.length?`${r.bars.length} bar${r.bars.length===1?"":"s"}, repeating`:"";};
  el("songsections").onclick=e=>{const d=e.target&&e.target.dataset;if(!d)return;
    const s=songs.selected;if(!s)return;
    if(d.loop!==undefined){songLoopSection(s.sections[+d.loop]);songSay("Loop set. Press Play song.");}
    else if(d.rec!==undefined)songRecordSection(+d.rec).catch(err=>songSay(err.message));
    else if(d.del!==undefined)songSaveSections(secs=>{secs.splice(+d.del,1);}).catch(err=>songSay(err.message));};
  el("songsections").onchange=e=>{const d=e.target&&e.target.dataset;
    if(d&&d.chords!==undefined)songSaveSections(secs=>{const x=secs[+d.chords];if(x)x.chords=e.target.value.slice(0,400);}).catch(err=>songSay(err.message));};
  el("songsetdownbeat").onclick=()=>{if(songs.player)el("songdownbeat").value=songs.player.currentTime.toFixed(3);};
  el("songplay").onclick=()=>songPlay();el("songstop").onclick=()=>{songStop();songSay("Stopped.");};
  if(typeof renderLibrary==="function")renderLibrary();
  if(typeof renderLooper==="function")renderLooper();
  if(!songs.loaded)songList().catch(e=>songSay(`Song storage is unavailable${e&&e.name?` (${e.name})`:""}. Allow local storage for this page, then reload.`));
}
