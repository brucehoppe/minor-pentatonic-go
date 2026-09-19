// Local song library. Loaded before app.js; app state and storage are used only
// after the desk has started. Audio files never leave this browser.
const songs = {list:[], selected:null, player:null, url:null, source:null, bus:null,
  generation:0, playGeneration:0, timer:null, loopTimer:null, taps:[], loaded:false};
function validSong(s){
  return !!s && typeof s.id==="string" && s.id.length>0 && s.id.length<160
    && typeof s.title==="string" && s.title.length>0 && s.title.length<=200
    && Number.isInteger(s.key) && s.key>=0 && s.key<12
    && Number.isFinite(s.bpm) && s.bpm>=40 && s.bpm<=200
    && Number.isFinite(s.downbeat) && s.downbeat>=0
    && Number.isFinite(s.duration) && s.duration>0 && s.downbeat<s.duration;
}
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
  songs.timer=null;songs.loopTimer=null;
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
}
async function songSelect(id){
  if(state.rec){songSay("Finish the take before changing songs.");return;}
  const generation=++songs.generation;
  songRelease();songs.selected=null;songFields();
  const s=songs.list.find(s=>s.id===id);
  if(!s)return;
  try{
    const row=await dbDo("songfiles","readonly",tx=>tx.objectStore("songfiles").get(id));
    if(generation!==songs.generation)return;
    if(!row||!(row.file instanceof Blob))throw new Error("The song file is missing. Import it again.");
    songs.url=URL.createObjectURL(row.file);
    const p=songs.player=new Audio(songs.url);p.preload="metadata";
    songs.selected=s;songs.taps=[];
    p.addEventListener("ended",()=>{if(songs.player===p){songStop();songSay("Song finished.");}});
    p.addEventListener("error",()=>{if(songs.player===p){songStop();songSay("This browser could not play the file. Try a WAV or MP3 copy.");}});
    songFields();songSay("Ready. Use headphones when recording with backing.");
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
async function songImport(file){
  if(state.rec)throw new Error("Finish the take before importing a song.");
  if(!file||!file.size||!(/\.(mp3|m4a|wav)$/i.test(file.name||"")))throw new Error("Choose an MP3, M4A or WAV audio file.");
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
async function songSave(){
  if(!songs.selected)return;
  if(state.rec)throw new Error("Finish the take before editing its song.");
  const s={...songs.selected,title:document.getElementById("songtitle").value.trim(),
    key:Number(document.getElementById("songkey").value),bpm:Number(document.getElementById("songbpm").value),
    downbeat:Number(document.getElementById("songdownbeat").value),form:document.getElementById("songform").value.slice(0,1000)};
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
  const s=songs.selected,loop=document.getElementById("songloop").checked;
  const a=loop?Number(document.getElementById("songloopa").value):s.downbeat;
  const b=loop?Number(document.getElementById("songloopb").value):s.duration;
  if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b>s.duration||b-a<.1)throw new Error("Loop B must be after A and inside the song.");
  return {a,b,loop};
}
async function songPlay(){
  if(!songs.player)return;
  songStop();
  const p=songs.player,s=songs.selected,generation=songs.playGeneration;
  try{
    const {a,b,loop}=songBounds(),rate=Number(document.getElementById("songspeed").value);
    if(![.5,.75,.9,1].includes(rate))throw new Error("Choose one of the playback speeds.");
    const engine=audio();
    if(engine&&engine.context&&!songs.source){
      songs.source=engine.context.createMediaElementSource(p);songs.bus=engine.bus();songs.source.connect(songs.bus);}
    p.preservesPitch=true;p.webkitPreservesPitch=true;p.playbackRate=rate;p.currentTime=a;
    const start=()=>{
      if(generation!==songs.playGeneration)return;
      p.play().then(()=>{
        if(generation!==songs.playGeneration){p.pause();return;}
        songSay(`${s.title} · ${Math.round(s.bpm*rate)} bpm${engine&&engine.context?"":" · compatibility playback; recordings are guitar only"}`);
        songs.loopTimer=setInterval(()=>{
          if(p.currentTime>=b){if(loop)p.currentTime=a;else songStop();}
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
  el("songsetdownbeat").onclick=()=>{if(songs.player)el("songdownbeat").value=songs.player.currentTime.toFixed(3);};
  el("songplay").onclick=songPlay;el("songstop").onclick=()=>{songStop();songSay("Stopped.");};
  if(!songs.loaded)songList().catch(()=>songSay("Song storage is unavailable. Allow local storage for this page, then reload."));
}
