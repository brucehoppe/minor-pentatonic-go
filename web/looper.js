// The looper: record 1, 2, 4, 8 or 12 bars of your own playing at the set tempo, and hear
// them repeat with no gap until you stop, so you can solo over yourself, with or without
// recording the solo. The loop is a buffer played on the audio clock, which repeats
// sample-accurately; it plays into the engine's bus, so a "Guitar + backing" take records
// it. Chords can be entered for it, and the chord-tone overlay follows them.
// Loaded before app.js; app state and audio are used only once the desk has started.
const looper = {bars:4, state:"idle", ac:null, src:null, gain:null, node:null, buf:null, startAt:0, shift:0, bpm:90,
  blocks:[], chordTimer:null, waitTimer:null, level:.9};

function loopSay(m){const el=document.getElementById("loopmsg");if(el)el.textContent=m;}
function loopDraw(){
  const idle=looper.state==="idle",rec=looper.state==="recording",play=looper.state==="looping",has=!!looper.buf;
  const set=(id,dis)=>{const b=document.getElementById(id);if(b)b.disabled=dis;};
  set("looprec",rec||play||!!(typeof state!=="undefined"&&state.rec));set("loopstop",idle||(!rec&&!play));
  set("loopplay",!has||rec||play);set("loopclear",!has&&!rec);set("loopbars",rec||play);
  const st=document.getElementById("loopstate");
  if(st)st.textContent=rec?"Recording…":play?`Looping ${looper.bars} bar${looper.bars===1?"":"s"} at ${looper.bpm} bpm`:has?"Loop ready":"No loop yet";
}
function loopErr(m){looper.state="idle";looperCleanup(false);loopDraw();loopSay(m);}
function looperCleanup(keepBuffer){
  if(looper.chordTimer){clearInterval(looper.chordTimer);looper.chordTimer=null;}
  if(looper.waitTimer){clearInterval(looper.waitTimer);looper.waitTimer=null;}
  if(looper.src){try{looper.src.stop();}catch(e){/* not started */}try{looper.src.disconnect();}catch(e){/* gone */}looper.src=null;}
  if(looper.gain){try{looper.gain.disconnect();}catch(e){/* gone */}looper.gain=null;}
  if(looper.node){try{looper.node.disconnect();}catch(e){/* gone */}looper.node=null;}
  if(!keepBuffer)looper.buf=null;
}
// Count in, record the bars on the audio clock, then loop them from the exact end.
async function looperRecord(){
  if(looper.state!=="idle")return;
  if(state.rec){loopSay("Finish the take first.");return;}
  const a=audio(),ac=a&&a.context;
  if(!ac||!ac.audioWorklet||typeof AudioWorkletNode!=="function"||typeof a.blip!=="function"||typeof a.bus!=="function"){
    loopSay("The looper needs Web Audio and audio worklets, which this browser withholds.");return;}
  const bars=[1,2,4,8,12].includes(+document.getElementById("loopbars").value)?+document.getElementById("loopbars").value:4;
  looper.bars=bars;looper.bpm=state.bpm;looper.state="recording";looperCleanup(false);loopDraw();
  loopSay("Opening the input…");
  try{
    const [ok,input]=await Promise.all([workletReady(ac),acquireInput(false)]);
    if(!ok){loopErr("The capture script couldn't load, so the looper isn't available here.");return;}
    const sr=ac.sampleRate,beat=60/state.bpm,barSec=4*beat,len=Math.round(bars*barSec*sr);
    const count=document.getElementById("loopcount").checked,lead=.35,t0=ac.currentTime;
    const startAt=t0+lead+(count?4*beat:0),startFrame=Math.round(startAt*sr);
    const n=inputNode(ac,input,state.recChannel);
    const node=looper.node=new AudioWorkletNode(ac,"take-capture",{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],
      channelCount:1,channelCountMode:"explicit",channelInterpretation:"speakers",processorOptions:{channels:1,block:4800}});
    n.link(node);node.connect(ac.destination);
    looper.blocks=[];looper.startAt=startAt;
    node.port.onmessage=e=>{
      const m=e.data||{};
      if(Array.isArray(m.block)&&m.block[0])looper.blocks.push(m.block[0]);
      if(typeof m.done==="number")looperFinish(input,len,startAt);};
    node.port.postMessage({start:startFrame});
    node.port.postMessage({stopAt:startFrame+len});
    if(count)for(let k=0;k<4;k++)a.blip(k===0?1400:900,{when:lead+k*beat,dur:.05,vol:.55});
    loopSay(count?`Counting in, then ${bars} bar${bars===1?"":"s"}: play the part you want to loop.`:`Recording ${bars} bar${bars===1?"":"s"}: play the part you want to loop.`);
    // if the capture never reports back, say so rather than wait forever
    const giveUp=startAt+bars*barSec+3;
    looper.waitTimer=whenAudioTime(ac,giveUp,()=>{if(looper.state==="recording")loopErr("The recording didn't finish. Try again.");});
    loopDraw();
  }catch(e){loopErr(inputError(e));}
}
// The recording is in: turn it into a buffer and start it looping at the bar it ended on.
function looperFinish(input,len,startAt){
  if(looper.state!=="recording")return;
  const a=audio(),ac=a.context,sr=ac.sampleRate;
  if(looper.waitTimer){clearInterval(looper.waitTimer);looper.waitTimer=null;}
  const pcm=new Float32Array(len);
  let o=0;for(const b of looper.blocks){const take=Math.min(b.length,len-o);if(take<=0)break;pcm.set(b.subarray(0,take),o);o+=take;}
  if(looper.node){try{looper.node.disconnect();}catch(e){/* gone */}looper.node=null;}
  inputIdle();
  if(o<len*.5){loopErr("Not enough was recorded. Try again.");return;}
  const buf=ac.createBuffer(1,len,sr);
  if(buf.copyToChannel)buf.copyToChannel(pcm,0);else buf.getChannelData(0).set(pcm);
  looper.buf=buf;looper.state="idle";
  looperPlay(startAt+len/sr);
  loopSay("Looping. Solo over it, and press Record in the Play along bar to record your solo with the loop.");
}
// Start (or restart) the loop so that its bars begin at audio time `at` and repeat forever.
function looperPlay(at){
  const a=audio(),ac=a&&a.context;
  if(!looper.buf||!ac)return;
  looperCleanup(true);
  looper.ac=ac;
  const dur=looper.buf.duration,cal=(typeof state!=="undefined"&&state.cal?state.cal.ms:0)/1000;
  // Your playing reached the recording late by the calibrated latency; skipping ahead by it
  // puts the loop back on the beat you played to.
  looper.shift=cal;
  const src=looper.src=ac.createBufferSource();
  src.buffer=looper.buf;src.loop=true;src.loopStart=0;src.loopEnd=dur;
  const gain=looper.gain=ac.createGain();gain.gain.value=looper.level;
  src.connect(gain);gain.connect(a.bus());
  const now=ac.currentTime,when=at===undefined?now:at;
  if(when>now)src.start(when,cal%dur);
  else src.start(0,(((now-when)+cal)%dur+dur)%dur);
  looper.startAt=when;looper.state="looping";
  looper.chordTimer=setInterval(looperTick,25);
  loopDraw();
}
// The loop's own bar and chord, and the chord overlay following them.
function looperTick(){
  if(looper.state!=="looping"||!looper.ac)return;
  const dur=looper.buf.duration,t=((looper.ac.currentTime-looper.startAt+looper.shift)%dur+dur)%dur,barSec=4*60/looper.bpm;
  const bar=Math.floor(t/barSec)+1,ro=document.getElementById("loopreadout");
  if(ro)ro.textContent=`bar ${bar} of ${looper.bars}`;
  const text=document.getElementById("loopchords")?document.getElementById("loopchords").value:"";
  if(text&&typeof chordAt==="function"&&typeof applyLiveChord==="function")
    applyLiveChord(chordAt({bpm:looper.bpm,downbeat:0,chords:text,sections:[]},t));
}
function looperStop(){
  if(looper.state==="recording"){
    if(looper.node)looper.node.port.postMessage({stop:true});
    looper.state="idle";looperCleanup(false);inputIdle();loopDraw();loopSay("Stopped: nothing was kept.");return;}
  looperCleanup(true);looper.state="idle";
  if(typeof applyLiveChord==="function")applyLiveChord(null);
  loopDraw();loopSay(looper.buf?"Stopped. Press Play loop to hear it again.":"Stopped.");
}
function looperClear(){
  looperCleanup(false);looper.state="idle";looper.buf=null;
  const ro=document.getElementById("loopreadout");if(ro)ro.textContent="";
  loopDraw();loopSay("Cleared.");
}
function looperInit(){
  if(looper.wired)return;looper.wired=true;
  const el=id=>document.getElementById(id);
  el("looprec").onclick=()=>looperRecord();
  el("loopstop").onclick=looperStop;
  el("loopplay").onclick=()=>looperPlay();
  el("loopclear").onclick=looperClear;
  el("loopvol").oninput=e=>{looper.level=Math.max(0,Math.min(1,(+e.target.value)/100));if(looper.gain)looper.gain.gain.value=looper.level;};
  el("loopchords").oninput=()=>{const r=parseChords(el("loopchords").value);
    el("loopchordnote").textContent=r.bad.length?`Can't read: ${r.bad.slice(0,4).join(", ")}`:r.bars.length?`${r.bars.length} bar${r.bars.length===1?"":"s"}, repeating`:"";};
}
function renderLooper(){looperInit();loopDraw();}
