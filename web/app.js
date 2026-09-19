// Minor Pentatonic Practice Desk — the whole interactive desk.
//
// One script, one global scope, no build step: it is embedded in the Go binary
// and served as-is. tests/app.test.mjs runs this file against a small DOM stand-in.
const NOTES=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
// The same twelve as chord roots, for the views where the key selector means a
// chord's root (Triads, Inversions): the spelling on a chord chart.
const ROOT_NAMES=["C","C\u266f","D","E\u266d","E","F","F\u266f","G","A\u266d","A","B\u266d","B"];
// A pitch named the way the current view names it: as a chord root, or sharps only.
function spelled(pc){return viewCfg(state.view).key==="root"?ROOT_NAMES[pc]:NOTES[pc];}
const IV={0:"1",1:"♭2",2:"2",3:"♭3",4:"3",5:"4",6:"♭5",7:"5",8:"♭6",9:"6",10:"♭7",11:"7"};
const OPEN=[4,11,7,2,9,4], SL=["e","B","G","D","A","E"];
const BOXES=[
  {n:1,off:[[0,3],[0,3],[0,2],[0,2],[0,2],[0,3]],tip:"Home base. Root under the first finger on both E strings."},
  {n:2,off:[[3,5],[3,5],[2,4],[2,5],[2,5],[3,5]],tip:"The stretchy one. Roots land on the D and B strings."},
  {n:3,off:[[5,7],[5,8],[4,7],[5,7],[5,7],[5,7]],tip:"Roots on the A and B strings. Top half is the B.B. box."},
  {n:4,off:[[7,10],[8,10],[7,9],[7,9],[7,10],[7,10]],tip:"Box 1's shape moved across a string set."},
  {n:5,off:[[10,12],[10,12],[9,12],[9,12],[10,12],[10,12]],tip:"Closes the loop — its top edge is Box 1, an octave up."}
];
// All mutable app state, in one place, grouped by the feature that owns it. Code
// reads and writes it as state.key, state.bpm and so on, so a search for
// "state.<name>" finds everything that touches a value.
const state={
  // what is on screen - key, view and the shared toolbar
  key:9, view:"path", labelMode:"name", chord:null, reg:0, chartOpen:null, boxLock:[],
  showB5:false, blueLock:null,
  // major pentatonic and modes views
  majorKey:0, majorDegrees:false, majorArrows:true,
  modeId:"dorian", lastMode:null,
  // Solo lab - which shapes are in play, and the run being built inside them. The run
  // is stored as offsets from the zone's root fret, so it follows the key, the
  // register and the box selection instead of being pinned to absolute frets.
  soloBoxes:[1], soloRun:[], soloTimer:null, soloStep:-1,
  // practice - find-the-note quiz, focus timer and tempo ladder
  quiz:null, changes:null,
  // Tuner & bends: the tuning, and the live pitch reading while the view listens
  tuneTuning:"standard", pitch:null,
  timerSeconds:300, timerInitial:300, timerHandle:null, ladderStart:90, ladderRound:1,
  // 12-bar trainer and rhythm lab
  trainerTimer:null, trainerBar:-1, trainerBeat:0, trainerCount:4,
  // the backing band (web/band.js): its settings, remembered, and the live rig of
  // gains its parts play into while the trainer runs
  band:{on:true, swing:2/3, bass:"walk", ride:false, mix:bandMixDefaults(), practice:bandPracticeDefaults()}, bandRig:null, taps:[],
  pendingSection:null, trainerChorus:0, trainerEnding:false, dropBars:[], liveChord:null, liveChordKey:"", bandCompat:false, bandClip:null,
  rhythm:[1,0,0,0,1,0,1,0,1,0,0,0,1,0,1,0], rhythmTimer:null, rhythmStep:0,
  // audio - the chosen engine, why there is none, and what is sounding
  engine:null, audioFault:null, clickTimer:null, droneHandle:null, bpm:90,
  // recorder - the take in progress (its phase, input and MediaRecorder), the chosen
  // input device, and the last finished take with its blob URLs
  rec:null, recDevice:"", recChannel:-1, recTake:null, monitor:null, inputHeld:null, checking:false, meter:null, savedList:[],
  takeDB:null, workletFor:null, wavBits:16, mp3Quality:"standard", cal:null, calRun:null,
  // note names, triads, inversions and open tunings views
  noteHL:null, noteString:null,
  triadKind:"maj", triadSet:"123",
  invSet:"123", invProg:"145", invStep:0, invMoved:false, invRunTimer:null, invRunLeft:0,
  openTuning:"open-d",
};
const MAXFRET=24;
const REGS=[[-12,"Octave down"],[0,"Standard"],[12,"Octave up"]];
const REGLBL=Object.fromEntries(REGS);
const baseFret=()=>{const f=(state.key-OPEN[5]+12)%12;return f===0?12:f;};
const fitsNeck=(b,R)=>Math.min(...b.off.flat())+R>=0&&Math.max(...b.off.flat())+R<=MAXFRET;
// The register is a direction, not a fixed transposition. Each shape is moved by whole
// octaves as far as the register asks and the neck allows; a shape with nowhere to go
// stays at its standard position rather than disappearing. So every box is always
// reachable in every register — only where it sits on the neck changes.
function fitRoot(offs){
  const lo=Math.min(...offs),hi=Math.max(...offs);
  let r=baseFret();
  if(state.reg<0){while(r-12+lo>=0)r-=12;}
  else if(state.reg>0){while(r+12+hi<=MAXFRET)r+=12;}
  return r;}
const boxRoot=b=>fitRoot(b.off.flat());
function regNote(b){
  if(!state.reg||moved(b))return "";
  return `<p class="tip stayed">Standard position — there is no room for this shape ${
    state.reg<0?"an octave lower; its bottom note would fall past the nut":"an octave higher; its top note would run past fret "+MAXFRET}.</p>`;}
const groupRoot=(...bs)=>fitRoot(bs.flatMap(b=>b.off.flat()));
const boxSpan=b=>{const R=boxRoot(b),fl=b.off.flat();
  return {R,lo:Math.min(...fl)+R,hi:Math.max(...fl)+R};};
// true when the register actually moved this shape off its standard position
const moved=b=>boxRoot(b)!==baseFret();
const boxesAt=r=>BOXES;            // every box exists at every register now
// what a register actually does to the neck: the span it puts the five boxes in,
// and how many of them it managed to move off their standard position
function regInfo(r){
  const keep=state.reg;state.reg=r;
  const spans=BOXES.map(boxSpan),shifted=BOXES.filter(moved).length;
  state.reg=keep;
  return {lo:Math.min(...spans.map(s=>s.lo)),hi:Math.max(...spans.map(s=>s.hi)),shifted};}
const validBoxes=()=>BOXES;
const rootFret=()=>fitRoot([0]);
const noteAt=(s,f)=>(OPEN[s]+f)%12;
const deg=pc=>(pc-state.key+12)%12;
const isScale=pc=>[0,3,5,7,10].includes(deg(pc));
const isB5=pc=>deg(pc)===6;
// ghost b5 dots inside a fret window, for any note list
function b5Notes(lo,hi,strings=[0,1,2,3,4,5]){const o=[];
  strings.forEach(st=>{for(let f=Math.max(0,lo);f<=hi;f++)if(isB5(noteAt(st,f)))o.push({s:st,f,kind:"ghost"});});
  return o;}
function withB5(notes){if(!state.showB5||!notes.length)return notes;
  const fs=notes.map(n=>n.f),lo=Math.min(...fs),hi=Math.max(...fs);
  const have=new Set(notes.map(n=>n.s+":"+n.f));
  const strings=[...new Set(notes.map(n=>n.s))];
  return notes.concat(b5Notes(lo,hi,strings).filter(n=>!have.has(n.s+":"+n.f)));}
const CHORDS={i:[0,3,7],iv:[5,8,0],v:[7,10,2]};
// "band" follows the chord the 12-bar trainer is playing, whatever it is (IIm7, VI7,
// a diminished passing chord), rather than one of the key's i, iv and v.
const isChordTone=pc=>{
  if(state.chord==="band"){const c=state.liveChord;return !!c&&c.intervals.includes(((pc-c.pc)%12+12)%12);}
  return state.chord?CHORDS[state.chord].includes(deg(pc)):false;};
function boxNotes(b,R=boxRoot(b)){const o=[];b.off.forEach((p,s)=>p.forEach(x=>o.push({s,f:x+R})));return o;}
const kindOf=n=>noteAt(n.s,n.f)===state.key?"root":"tone";
function dotText(n){
  if(n.ord!==undefined)return n.ord;
  if(state.labelMode==="none")return "";
  const pc=noteAt(n.s,n.f);
  return state.labelMode==="interval"?(IV[deg(pc)]||""):NOTES[pc];
}

// span forces the fret window instead of fitting it to the notes, so two diagrams
// can be compared side by side — without it a shape that moves less simply gets
// drawn smaller, which is the opposite of the point.
function fretboard(notes,{w=52,h=26,pad=30,quiz=false,plain=false,span=null}={}){
  if(!quiz&&!plain)notes=withB5(notes);
  const fs=notes.map(n=>n.f);
  const lo=span?span[0]:Math.min(...fs),hi=span?span[1]:Math.max(...fs);
  const open=lo===0, P=pad+(open?24:0);
  const start=Math.max(lo-1,0),cols=hi-start,W=P+cols*w+16,H=pad+5*h+26;
  const xOf=f=>f===0?P-20:P+(f-start-.5)*w;
  const labelX=open?9:P-13;
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="fretboard diagram">`;
  // Grid lines keep their width in screen pixels (non-scaling-stroke). A five-fret
  // box is drawn wider, so it is scaled down more to fit the same card, and its
  // hairline frets otherwise dropped below a pixel and vanished at 1x.
  for(let i=0;i<=cols;i++){const x=P+i*w;
    s+=`<line x1="${x}" y1="${pad}" x2="${x}" y2="${pad+5*h}" stroke="var(--ink)" stroke-width="${i===0&&start===0?4:1.2}" opacity="${i===0&&start===0?1:.42}" vector-effect="non-scaling-stroke"/>`;
    if(i>0)s+=`<text x="${x-w/2}" y="${pad+5*h+18}" font-size="10.5" fill="var(--ink)" opacity=".5" text-anchor="middle" font-family="DM Mono,monospace">${start+i}</text>`;}
  for(let r=0;r<6;r++){const y=pad+r*h;
    s+=`<line x1="${P}" y1="${y}" x2="${P+cols*w}" y2="${y}" stroke="var(--ink)" stroke-width="${.7+r*.28}" opacity=".55" vector-effect="non-scaling-stroke"/>`;
    s+=`<text x="${labelX}" y="${y+4}" font-size="11" fill="var(--ink)" opacity=".45" text-anchor="middle" font-family="DM Mono,monospace">${SL[r]}</text>`;}
  notes.forEach((n,i)=>{
    const x=xOf(n.f),y=pad+n.s*h,k=n.kind||kindOf(n),pc=noteAt(n.s,n.f);
    const fill=quiz?"var(--blue)":k==="root"?"var(--pink)":k==="pivot"?"var(--gold)":k==="ghost"?"var(--card)":"var(--blue)";
    s+=`<g class="${quiz?"qn":"pn"}" ${quiz?`data-pc="${pc}" data-i="${i}" tabindex="0" role="button" aria-label="fret ${n.f} on ${SL[n.s]} string"`:`data-s="${n.s}" data-f="${n.f}" role="button" tabindex="0" aria-label="play ${spelled(pc)}, fret ${n.f} on the ${SL[n.s]} string"`}>`;
    if(k!=="ghost"&&!quiz)s+=`<circle cx="${x+1.5}" cy="${y+1.5}" r="10.5" fill="${k==="root"?'var(--blue)':'var(--pink)'}" opacity=".2"/>`;
    // Chord-tone rings mean "this note is in the i, iv or v of the current minor
    // key", which is only true talk on a scale diagram. A plain board — an octave
    // shape, a triad, a power chord — is not about that key, so it gets rings only
    // where the note itself asks for one. Same rule the ♭5 ghosts already follow.
    if(!quiz&&(n.ring||(!plain&&isChordTone(pc))))s+=`<circle cx="${x}" cy="${y}" r="13.5" fill="none" stroke="var(--gold)" stroke-width="2.2"/>`;
    s+=`<circle cx="${x}" cy="${y}" r="10.5" fill="${fill}" stroke="var(--ink)" stroke-width="${k==="ghost"?1.6:0}" stroke-dasharray="${k==="ghost"?"3 2":""}"/>`;
    s+=`<text x="${x}" y="${y+3.6}" font-size="9.5" font-weight="500" fill="${k==="ghost"&&!quiz?"var(--ink)":"var(--card)"}" text-anchor="middle" font-family="DM Mono,monospace" pointer-events="none">${quiz?"":dotText(n)}</text></g>`;});
  notes.filter(n=>n.to!==undefined).forEach(n=>{
    const y=pad+n.s*h,up=n.to>n.f,r=11.5;
    const x1=xOf(n.f)+(up?r:-r), x2=xOf(n.to)+(up?-r:r), d=up?1:-1;
    s+=`<line x1="${x1}" y1="${y}" x2="${x2-d*6}" y2="${y}" stroke="var(--pink)" stroke-width="2.2"/>`;
    s+=`<polygon points="${x2},${y} ${x2-d*7},${y-4} ${x2-d*7},${y+4}" fill="var(--pink)"/>`;});
  return s+"</svg>";
}

function fullMap(hl=[]){
  const R=baseFret(),w=36,h=23,pad=30,last=MAXFRET,cols=last,W=pad+cols*w+14,H=pad+5*h+24;
  const inBox=(s,f,span=false)=>BOXES.some(b=>hl.includes(b.n)&&(span
    ?(()=>{const fl=b.off.flat(),lo=Math.min(...fl)+R,hi=Math.max(...fl)+R;
        for(let k=-2;k<=2;k++)if(f>=lo+12*k&&f<=hi+12*k)return true;return false;})()
    :b.off[s].some(o=>(o+R-f)%12===0)));
  let o=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="full neck map">`;
  for(let i=0;i<=cols;i++){const x=pad+i*w;
    o+=`<line x1="${x}" y1="${pad}" x2="${x}" y2="${pad+5*h}" stroke="var(--ink)" stroke-width="${i===0?4:1.1}" opacity="${i===0?1:.32}"/>`;
    if(i>0)o+=`<text x="${x-w/2}" y="${pad+5*h+17}" font-size="10" fill="var(--ink)" opacity=".45" text-anchor="middle" font-family="DM Mono,monospace">${i}</text>`;}
  for(let r=0;r<6;r++)o+=`<line x1="${pad}" y1="${pad+r*h}" x2="${pad+cols*w}" y2="${pad+r*h}" stroke="var(--ink)" stroke-width="${.7+r*.25}" opacity=".5"/>`;
  for(let r=0;r<6;r++)for(let f=0;f<=last;f++){const pc=noteAt(r,f);
    if(!isScale(pc)){
      if(!state.showB5||!isB5(pc))continue;
      const cx=f===0?pad-11:pad+(f-.5)*w,y=pad+r*h,on=hl.length===0||inBox(r,f,true);
      o+=`<circle cx="${cx}" cy="${y}" r="8" fill="var(--card)" stroke="var(--gold)" stroke-width="2" stroke-dasharray="3 2" opacity="${on?1:.12}"/>`;
      continue;}
    const cx=f===0?pad-11:pad+(f-.5)*w,y=pad+r*h,on=hl.length===0||inBox(r,f);
    if(isChordTone(pc)&&on)o+=`<circle cx="${cx}" cy="${y}" r="11" fill="none" stroke="var(--gold)" stroke-width="2"/>`;
    o+=`<circle cx="${cx}" cy="${y}" r="8.5" fill="${pc===state.key?'var(--pink)':'var(--blue)'}" opacity="${on?1:.12}"/>`;}
  return o+"</svg>";
}

// ---------- the example song ----------
// Transcribed from the supplied tab. Two-note power chords throughout; the staff
// places the riff on the A/D/G strings, which puts the whole thing in B minor.
// Every chord in it belongs to B dorian, and the five strong ones (B5 D5 E5 F#5 A5)
// are exactly the notes of B minor pentatonic - which is what the solo is built on.
const SONGKEY=11;                                  // B
const PCSONG={
  form:["Intro","Verse","Chorus","Solo","Chorus","Interlude","Verse","Chorus ×2"],
  parts:[
    {t:"Intro / Verse / Solo / Interlude",e:"2 bars, repeated",pm:false,
     tip:"One two-bar phrase does four jobs. The rest on beat two is as much a part of the riff as the chords are — <b>let the strings go silent</b>, don't fill it. Each bar answers itself: two hits on the home chord, a gap, then three chords that walk somewhere.",
     bars:[
       {n:"Bar 1",ev:[{c:[[4,2],[3,4]],nm:"B5"},{c:[[4,2],[3,4]],nm:"B5"},{rest:true},
                     {c:[[3,2],[2,4]],nm:"E5",sl:true},{c:[[3,4],[2,6]],nm:"F#5"},{c:[[4,4],[3,6]],nm:"C#5"}]},
       {n:"Bar 2",ev:[{c:[[4,5],[3,7]],nm:"D5"},{c:[[4,5],[3,7]],nm:"D5"},{rest:true},
                     {c:[[3,6],[2,8]],nm:"G#5",sl:true},{c:[[3,7],[2,9]],nm:"A5"},{c:[[4,7],[3,9]],nm:"E5"}]}
     ]},
    {t:"Chorus",e:"2 bars, palm muted",pm:true,
     tip:"Eight straight eighth notes a bar, all downstrokes, palm muted. Bar one is an <b>open</b> A5 — the root is an open string, so the edge of your palm is the only thing controlling it. Bar two moves the same shape to B5 and the mute becomes easy again. That ♭VII → i move is the whole chorus.",
     bars:[
       {n:"Bar 1 ×8",ev:[{c:[[4,0],[3,2]],nm:"A5"}],rep:8},
       {n:"Bar 2 ×8",ev:[{c:[[4,2],[3,4]],nm:"B5"}],rep:8}
     ]}
  ]};

// ---------- song structure ----------
// Section codes drive the colour of the timeline blocks.
const SECCOL={i:"#15161A55",v:"var(--blue)",p:"var(--gold)",c:"var(--pink)",b:"var(--gold)",s:"var(--ink)",r:"#0F6FC599"};
const SECTIONS=[
  {k:"Intro",c:"i",bars:"1 beat – 32 bars",job:"Sets the key, the tempo and the sound before anyone has to sing. In rock it is usually the main riff on its own, so the listener has already learned the hook by the time the verse starts."},
  {k:"Verse",c:"v",bars:"8 bars (often 16)",job:"Carries the story, and changes words each time it comes round. Musically it stays out of the way — lower, sparser, less melodic range than the chorus, so the chorus has somewhere to go."},
  {k:"Pre-chorus",c:"p",bars:"2 – 8 bars",job:"Optional ramp. Builds tension and often shifts key centre or rhythm so the chorus lands harder. Same words every time, unlike the verse."},
  {k:"Chorus",c:"c",bars:"8 bars",job:"The hook, and the one section that repeats unchanged. Highest, loudest, most melodic. If a listener remembers one part of the song, this is it."},
  {k:"Bridge / middle eight",c:"b",bars:"8 or 16 bars",job:"New material, once, usually after the second chorus. Breaks the verse–chorus cycle before the last chorus so the repetition doesn't wear out. The name “middle eight” tells you both where it sits and how long it usually is."},
  {k:"Solo",c:"s",bars:"8 – 16 bars",job:"In rock and metal a solo often replaces or extends the bridge, and normally rides over the verse or the main riff's chord changes rather than new ones — which is why learning the riff's key gives you the solo for free."},
  {k:"Interlude / breakdown",c:"r",bars:"4 bars – a minute",job:"An instrumental return to earlier material, or a stripped-back moment. Cheap to write and very effective: it re-sets the ear so the next chorus feels new again."},
  {k:"Outro",c:"i",bars:"4 – 16 bars, or a fade",job:"Lands the song. Either a fading loop of the chorus or the riff, a repeated tag, or a hard stop. A riff-to-fade outro is the most common ending in riff-driven rock."}
];
const FORMS=[
  {t:"Verse – Chorus",e:"the workhorse",
   secs:[["Intro",4,"i"],["Verse",8,"v"],["Chorus",8,"c"],["Verse",8,"v"],["Chorus",8,"c"],["Chorus",8,"c"],["Outro",4,"i"]],
   tip:"The most common form in pop, rock and blues. The chorus differs sharply from the verse in both rhythm and melody — that contrast is what does the work, not the number of sections."},
  {t:"Verse – Chorus – Bridge",e:"the standard full-length song",
   secs:[["Intro",4,"i"],["Verse",8,"v"],["Chorus",8,"c"],["Verse",8,"v"],["Chorus",8,"c"],["Bridge",8,"b"],["Chorus",8,"c"],["Outro",4,"i"]],
   tip:"Verse–chorus with a contrasting bridge dropped in after the second chorus. This is the single most common full-length structure in modern songwriting. Verses move the story, the chorus delivers the hook, the bridge stops the back-and-forth becoming predictable."},
  {t:"Verse – Pre – Chorus",e:"with a ramp",
   secs:[["Intro",4,"i"],["Verse",8,"v"],["Pre",4,"p"],["Chorus",8,"c"],["Verse",8,"v"],["Pre",4,"p"],["Chorus",8,"c"],["Bridge",8,"b"],["Chorus",8,"c"]],
   tip:"The pre-chorus is a short climb — often a key or rhythm shift — that makes the chorus arrive rather than simply happen. Two to eight bars is plenty; longer and it becomes a second verse."},
  {t:"AABA",e:"32-bar form",
   secs:[["A",8,"v"],["A",8,"v"],["B",8,"b"],["A",8,"v"]],
   tip:"Two eight-bar A sections, a contrasting eight-bar B, then A again with the same core melody. It ran popular song for decades and was still all over rock in the 1950s and 60s before verse–chorus took over. There is no chorus — the hook lives inside the A section."},
  {t:"12-bar blues",e:"the one you already know",
   secs:[["I",4,"v"],["IV",2,"p"],["I",2,"v"],["V",1,"c"],["IV",1,"p"],["I",2,"v"]],
   tip:"A form measured in chords rather than sections, and the frame under most of what this app teaches. The <b>12-bar trainer</b> view runs fourteen versions of it — core shuffles, turnaround variants, jazz and minor forms — in every key, with three groove feels."},
  {t:"Strophic",e:"AAA — no chorus at all",
   secs:[["Verse",8,"v"],["Verse",8,"v"],["Verse",8,"v"],["Verse",8,"v"]],
   tip:"The same music every time, only the words change; the hook is usually a repeated last line. Folk, traditional ballads and a lot of Dylan. Nothing contrasts, so the lyric has to carry the entire song."},
  {t:"Riff-driven rock",e:"the riff is the hook",
   secs:[["Riff ×2",8,"r"],["Chorus + riff",8,"c"],["Chorus + riff",8,"c"],["Bridge",8,"b"],["Chorus + riff",8,"c"],["Bridge 2",8,"b"],["Chorus",8,"c"],["Riff to fade",8,"r"]],
   tip:"Your second example. Note what is missing: <b>there is no verse</b>. The main riff does the verse's job, so the structure is riff / chorus / riff / chorus with two bridges to break it up, and the riff loops out to a fade. Rock gives more room to intros, outros and instrumental sections than pop does, and this is that taken to its logical end."},
  {t:"Your power-chord song",e:"one riff, four jobs",
   secs:[["Intro",4,"r"],["Verse",8,"v"],["Chorus",8,"c"],["Solo",8,"s"],["Chorus",8,"c"],["Interlude",4,"r"],["Verse",8,"v"],["Chorus ×2",16,"c"]],
   tip:"Intro–Verse–Chorus–Solo–Chorus–Interlude–Verse–Chorus ×2. The same two-bar riff is the intro, the verse, the solo backing <b>and</b> the interlude — four labels, one piece of music. That is the economy the form is built on, and it is why the solo section needs no new chords: you are still in B minor over the same changes."}
];

// ---------- power chords ----------
// A power chord is a root and its fifth, nothing else. On the four lowest string
// pairs the fifth sits two frets up on the next string; the G-to-B pair is the one
// exception, because that pair is tuned a major third apart rather than a fourth.
const PCPAIR={5:2,4:2,3:2,2:3};          // string index -> fret offset to the fifth
const STRNAME=["high e","B","G","D","A","low E"];
const strNo=s=>s+1;                       // index 0 = high e = "string 1"
// fret of the current key's note on string s; 12 rather than 0 so the shape is movable
const rootOn=s=>{const f=(state.key-OPEN[s]+12)%12;return f===0?12:f;};
const pcName=(s,f)=>NOTES[noteAt(s,f)]+"5";
// two-note power chord rooted on string s at fret f
function pc2(s,f){const o=PCPAIR[s];
  return [{s,f,kind:"root",ord:"1"},{s:s-1,f:f+o,kind:"tone",ord:o===3?"4":"3"}];}
// three-note: root, fifth, octave
function pc3(s,f){const a=PCPAIR[s],b=PCPAIR[s-1];
  return [{s,f,kind:"root",ord:"1"},{s:s-1,f:f+a,kind:"tone",ord:"3"},{s:s-2,f:f+a,kind:"root",ord:"4"}];}

const PCSHAPES=[
  {id:"e6",root:5,three:false,t:"Root on the low E",e:"the “E shape”",
   tip:"The one to learn first. <b>Index finger on the root, ring finger two frets up on the A string.</b> Flatten the ring finger slightly so it also deadens the D string, and let the index finger's tip touch the strings above — a power chord under distortion is as much about what you stop ringing as what you play."},
  {id:"a5",root:4,three:false,t:"Root on the A string",e:"the “A shape”",
   tip:"Identical shape, one string over. Between these two you can play every power chord on the neck without moving more than a couple of frets — the same reason Box 1 and Box 4 cover the pentatonic scale."},
  {id:"d4",root:3,three:false,t:"Root on the D string",e:"thinner, cuts through",
   tip:"Same two-fret shape again. Higher and thinner — useful when a second guitar is already holding down the bottom end, and for the upper half of a riff that started low."},
  {id:"g3",root:2,three:false,t:"Root on the G string",e:"the exception — three frets",
   tip:"<b>The G–B pair is tuned a major third apart, not a fourth</b>, so the fifth is <b>three</b> frets up instead of two — reach it with the little finger. This one trips everybody up exactly once. Above this pair the shape goes back to two frets on the B and high e strings."},
  {id:"e6f",root:5,three:true,t:"Fat version, low E root",e:"root · 5th · octave",
   tip:"Add the octave with the little finger, flat across two strings — or barre the ring finger over both. Thicker and louder, but muddier low down; most players use the two-note version below about the fifth fret and the three-note version above it."},
  {id:"a5f",root:4,three:true,t:"Fat version, A string root",e:"root · 5th · octave",
   tip:"The same addition on the A-string shape. This is the standard chorus voicing in a huge amount of rock — big enough to sound like a chord, small enough to stay clean under gain."}
];

const PCOPEN=[
  {n:[{s:5,f:0,kind:"root",ord:"0"},{s:4,f:2,kind:"tone",ord:"2"}],t:"E5",e:"open low E",
   tip:"Nothing fretted on the root. Open power chords ring longer and louder than fretted ones because the open string has no finger damping it — which is also why they are harder to stop cleanly."},
  {n:[{s:4,f:0,kind:"root",ord:"0"},{s:3,f:2,kind:"tone",ord:"2"}],t:"A5",e:"open A",
   tip:"The chorus of the example song below sits here for a whole bar. With the root open you have a spare finger, so an open power chord is the natural place to add a moving note on top."},
  {n:[{s:3,f:0,kind:"root",ord:"0"},{s:2,f:2,kind:"tone",ord:"2"}],t:"D5",e:"open D",
   tip:"Highest of the three, and the one that most often gets the octave added on the B string at the third fret."}
];

// progressions written as scale degrees from the key's root, in semitones
const PCPROG=[
  {t:"i – ♭VII – ♭VI",e:"the rock cadence",d:[0,10,8],
   tip:"Everything steps down. Available entirely on one string's roots, which is why it turns up in so many riffs — you can play it without your hand leaving one position."},
  {t:"i – ♭VII – IV",e:"the other one",d:[0,10,5],
   tip:"Same first move, then a jump instead of a step. The ♭VII and the IV are both in the minor pentatonic, so a solo over this almost cannot go wrong."},
  {t:"i – IV – V",e:"blues bones",d:[0,5,7],
   tip:"The twelve-bar chords as power chords. Play these while the 12-bar trainer runs and you are hearing the form from the rhythm side."},
  {t:"♭VII – i",e:"the turnaround",d:[10,0],
   tip:"Two chords, a whole step apart, endlessly repeatable. This is the example song's chorus — <b>A5 to B5</b> in B minor."},
  {t:"i – ♭III – IV",e:"lift",d:[0,3,5],
   tip:"The ♭III is the note that makes the scale minor, so this progression states the key harder than i–♭VII does."}
];

// ---------- whole-neck blues map ----------
// Every zone is a set of {s,o} offsets from the root fret, so it can be matched
// against the neck modulo 12 and light up in every octave it reaches.
const ZONES={
  blues:{t:"Blues box",sub:"Box 1 + ♭5",box:0,strings:[0,1,2,3,4,5],
    tip:"Box 1 with the flat five dropped in. Pass <b>through</b> it — the classic move is the chromatic walk from the 4th up to the 5th on the G string. Every octave of the shape is lit, so the same move exists twelve frets away."},
  bb:{t:"B.B. King box",sub:"top of Box 3",box:2,strings:[0,1,2],
    tip:"Top three strings of Box 3, sat around the root on the B string, everything phrased with heavy vibrato. The dashed dots are ♭5s — B.B. mostly avoided them; the sweet note here is the major 6th."},
  ak:{t:"Albert King box",sub:"top of Box 2",box:1,strings:[0,1,2],
    tip:"Top three strings of Box 2, built for bending. Signature move: the high-e's upper note bent a whole step, then dropped in pitch by degrees rather than released all at once."}};
function zoneOffsets(z){const o=[];const Z=ZONES[z];
  BOXES[Z.box].off.forEach((p,st)=>{if(Z.strings.includes(st))p.forEach(x=>o.push({s:st,o:x}));});
  return o;}
function boxOffsets(n){const o=[];BOXES[n-1].off.forEach((p,st)=>p.forEach(x=>o.push({s:st,o:x})));return o;}
// hl: null | "box1".."box5" | "blues" | "bb" | "ak"
function hlOffsets(hl){
  if(!hl)return null;
  return hl.startsWith("box")?boxOffsets(+hl.slice(3)):zoneOffsets(hl);}

const MARKERS=[3,5,7,9,15,17,19,21], DBLMARK=[12,24];
function bluesMap(hl=null){
  const R=baseFret(),w=36,h=23,pad=32,last=MAXFRET,cols=last;
  const W=pad+cols*w+16,H=pad+5*h+26;
  const off=hlOffsets(hl);
  const lit=(st,f)=>!off||off.some(x=>x.s===st&&(((f-x.o-R)%12)+12)%12===0);
  const xOf=f=>f===0?pad-12:pad+(f-.5)*w;
  let o=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="whole neck blues map">`;
  // highlighted region bands, one per octave the shape reaches
  if(off){const lo=Math.min(...off.map(x=>x.o)),hi=Math.max(...off.map(x=>x.o));
    for(let k=-2;k<=2;k++){const a=lo+R+12*k,b=hi+R+12*k;
      if(b<0||a>last)continue;
      const x1=xOf(Math.max(a,0))-w/2-4,x2=xOf(Math.min(b,last))+w/2+4;
      o+=`<rect x="${Math.max(pad-24,x1)}" y="${pad-9}" width="${x2-Math.max(pad-24,x1)}" height="${5*h+18}" fill="var(--gold)" opacity=".10"/>`;}}
  // frets
  for(let i=0;i<=cols;i++){const x=pad+i*w;
    o+=`<line x1="${x}" y1="${pad}" x2="${x}" y2="${pad+5*h}" stroke="var(--ink)" stroke-width="${i===0?4:1.1}" opacity="${i===0?1:.32}"/>`;
    if(i>0)o+=`<text x="${x-w/2}" y="${pad+5*h+18}" font-size="10" fill="var(--ink)" opacity=".45" text-anchor="middle" font-family="DM Mono,monospace">${i}</text>`;}
  // inlay markers
  MARKERS.filter(f=>f<=last).forEach(f=>{
    o+=`<circle cx="${xOf(f)}" cy="${pad+2.5*h}" r="3.6" fill="var(--ink)" opacity=".16"/>`;});
  DBLMARK.filter(f=>f<=last).forEach(f=>{[1.5,3.5].forEach(r=>{
    o+=`<circle cx="${xOf(f)}" cy="${pad+r*h}" r="3.6" fill="var(--ink)" opacity=".16"/>`;});});
  // strings
  for(let r=0;r<6;r++){const y=pad+r*h;
    o+=`<line x1="${pad}" y1="${y}" x2="${pad+cols*w}" y2="${y}" stroke="var(--ink)" stroke-width="${.7+r*.25}" opacity=".5"/>`;
    o+=`<text x="${pad-24}" y="${y+4}" font-size="10.5" fill="var(--ink)" opacity=".45" text-anchor="middle" font-family="DM Mono,monospace">${SL[r]}</text>`;}
  // notes: pentatonic filled, flat five hollow-dashed
  for(let r=0;r<6;r++)for(let f=0;f<=last;f++){
    const pc=noteAt(r,f),scale=isScale(pc),blue=isB5(pc);
    if(!scale&&!blue)continue;
    const on=lit(r,f),x=xOf(f),y=pad+r*h,op=on?1:.10;
    if(blue){
      o+=`<g class="pn" data-s="${r}" data-f="${f}" role="button" tabindex="0" aria-label="play ${NOTES[pc]} flat five, fret ${f} on the ${SL[r]} string" opacity="${op}">`
       +`<circle cx="${x}" cy="${y}" r="8.5" fill="var(--card)" stroke="var(--gold)" stroke-width="2" stroke-dasharray="3 2"/>`
       +`<text x="${x}" y="${y+3.2}" font-size="8.5" fill="var(--ink)" text-anchor="middle" font-family="DM Mono,monospace" pointer-events="none">${state.labelMode==="none"?"":state.labelMode==="interval"?"♭5":NOTES[pc]}</text></g>`;
    }else{
      o+=`<g class="pn" data-s="${r}" data-f="${f}" role="button" tabindex="0" aria-label="play ${NOTES[pc]}, fret ${f} on the ${SL[r]} string" opacity="${op}">`
       +`<circle cx="${x}" cy="${y}" r="8.5" fill="${pc===state.key?'var(--pink)':'var(--blue)'}"/>`
       +`<text x="${x}" y="${y+3.2}" font-size="8.5" fill="var(--card)" text-anchor="middle" font-family="DM Mono,monospace" pointer-events="none">${state.labelMode==="none"?"":state.labelMode==="interval"?(IV[deg(pc)]||""):NOTES[pc]}</text></g>`;}}
  return o+"</svg>";
}

function renderBoxes(){
  const laid=[...validBoxes()].sort((x,y)=>boxSpan(x).lo-boxSpan(y).lo);
  document.getElementById("boxes").innerHTML=laid.map(b=>{
    const {R,lo,hi}=boxSpan(b);
    return `<div class="card" data-box="${b.n}" tabindex="0"><h2>Box ${b.n}<em>fret ${lo}–${hi}</em></h2>${
      fretboard(boxNotes(b,R))}<p class="tip">${b.tip}</p>${regNote(b)}</div>`;}).join("");
  const ord=document.getElementById("boxorder");
  if(ord)ord.innerHTML=state.reg&&laid.some((b,i)=>b.n!==i+1)
    ?`Laid out low to high on the neck: <b>${laid.map(b=>"Box "+b.n).join(" · ")}</b>. At this register the boxes no longer run in numeric order — Box 1 is a shape, not a place.`
    :"";
  const ml=document.getElementById("maplabel");
  const show=()=>{
    document.getElementById("fullmap").innerHTML=fullMap(state.boxLock);
    ml.textContent=state.boxLock.length
      ?`Full neck — ${state.boxLock.length===1?"Box":"Boxes"} ${state.boxLock.join(" + ")} selected`
      :"Full neck — all boxes";
    document.querySelectorAll("#boxselect button").forEach(b=>{
      b.setAttribute("aria-pressed",state.boxLock.includes(+b.dataset.box));});
    document.querySelectorAll("#boxes .card").forEach(c=>{
      const selected=state.boxLock.includes(+c.dataset.box);
      c.classList.toggle("now",selected);
      c.setAttribute("aria-pressed",selected);});
  };
  const toggle=n=>{
    state.boxLock=state.boxLock.includes(n)?state.boxLock.filter(x=>x!==n):[...state.boxLock,n].sort((a,b)=>a-b);
    show();
  };
  const choices=document.getElementById("boxselect");
  choices.innerHTML="";
  BOXES.forEach(b=>mk(choices,{box:b.n},`Box ${b.n}`,()=>toggle(b.n)));
  document.getElementById("boxreset").onclick=()=>{state.boxLock=[];show();};
  document.querySelectorAll("#boxes .card").forEach(c=>{
    c.setAttribute("role","button");
    c.setAttribute("aria-label",`Select Box ${c.dataset.box}`);
    c.addEventListener("click",()=>toggle(+c.dataset.box));
    c.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){
      e.preventDefault();toggle(+c.dataset.box);}});
  });
  show();
}

const SLIDE=["Slide the two top strings with your first finger — Box 1's fourth-finger note becomes Box 2's first-finger note.",
"Pivot on the G string: the note you stretched for in Box 2 sits under finger one in Box 3.",
"The B string is the smoothest door here.",
"Slide on the two E strings and you land on the Box 1 shape an octave up."];

// ---------- solo lab ----------
const SOLO_KEY="minor-pentatonic-solo-v1";
const soloSel=()=>BOXES.filter(b=>state.soloBoxes.includes(b.n));
// The whole selection has to sit at one position or the shared notes do not line up.
const soloRoot=()=>{const sel=soloSel();return sel.length?groupRoot(...sel):boxRoot(BOXES[0]);};
// every note in the zone, tagged with which of the selected boxes it belongs to
function soloZone(){
  const R=soloRoot(),m=new Map();
  soloSel().forEach(b=>b.off.forEach((pr,st)=>pr.forEach(o=>{
    const k=st+":"+(o+R),e=m.get(k);
    if(e)e.boxes.push(b.n);
    else m.set(k,{s:st,f:o+R,boxes:[b.n]});})));
  return [...m.values()].map(n=>({...n,
    kind:noteAt(n.s,n.f)===state.key?"root":n.boxes.length>1?"pivot":"tone",
    ring:n.boxes.length>1&&noteAt(n.s,n.f)===state.key}));}
const inZone=(s,f)=>soloZone().some(n=>n.s===s&&n.f===f);

// ---- run patterns, written as generators over the current zone ----
const byString=()=>{const z=soloZone(),o=[];
  for(let st=5;st>=0;st--)z.filter(n=>n.s===st).sort((a,b)=>a.f-b.f).forEach(n=>o.push(n));
  return o;}
const SOLOPATTERNS=[
  {id:"up",t:"Ascend",tip:"Straight up the zone, low string to high. The plain version — learn it first so the others have something to deviate from."},
  {id:"down",t:"Descend",tip:"Straight back down. Descending runs are harder to keep even, because the picking hand is crossing strings in the direction the wrist does not want to go."},
  {id:"updown",t:"Up and back",tip:"Up, then straight back down without a pause at the top. The turnaround at the top is where runs usually fall apart; this drills exactly that."},
  {id:"fours",t:"Sequenced fours",tip:"Four notes up, back three, four up. Same notes as the ascend, but it stops sounding like a scale and starts sounding like a line."},
  {id:"thirds",t:"In thirds",tip:"Skip a note each time, then come back for it. Wider intervals stop the run feeling like a ladder — this is the quickest way to make a scale sound like music."}
];
function buildRun(id){
  const asc=byString(),R=soloRoot();
  let seq=[];
  if(id==="up")seq=asc;
  else if(id==="down")seq=[...asc].reverse();
  else if(id==="updown")seq=asc.concat([...asc].reverse().slice(1));
  else if(id==="fours"){for(let i=0;i+3<asc.length;i++)seq.push(asc[i],asc[i+1],asc[i+2],asc[i+3]);}
  else if(id==="thirds"){for(let i=0;i+2<asc.length;i++)seq.push(asc[i],asc[i+2]);}
  return seq.map(n=>({s:n.s,o:n.f-R}));}

// ---- persistence: the zone and the run survive a reload ----
function saveSolo(){try{window.localStorage.setItem(SOLO_KEY,
  JSON.stringify({boxes:state.soloBoxes,run:state.soloRun}));}catch(e){}}
function loadSolo(){try{const v=JSON.parse(window.localStorage.getItem(SOLO_KEY)||"null");
  if(v&&Array.isArray(v.boxes)&&v.boxes.length){state.soloBoxes=v.boxes.filter(n=>n>=1&&n<=5);
    if(Array.isArray(v.run))state.soloRun=v.run.filter(n=>n&&typeof n.s==="number"&&typeof n.o==="number");}
  }catch(e){}}

// ---- playback, at whatever the tempo slider says ----
function stopSolo(){if(state.soloTimer){clearInterval(state.soloTimer);state.soloTimer=null;}
  state.soloStep=-1;markSoloStep(-1);
  const b=document.getElementById("soloplay");
  if(b){b.textContent="Play run";b.setAttribute("aria-pressed",false);}}
function markSoloStep(i){
  const host=document.getElementById("solorun");
  if(!host)return;
  host.querySelectorAll("g.pn").forEach(g=>g.classList.remove("playing"));
  if(i<0||i>=state.soloRun.length)return;
  const R=soloRoot(),n=state.soloRun[i];
  const g=host.querySelector(`g.pn[data-s="${n.s}"][data-f="${n.o+R}"]`);
  if(g)g.classList.add("playing");}
function playSolo(){
  if(state.soloTimer){stopSolo();return;}
  const note=document.getElementById("soloplaymsg");
  if(!state.soloRun.length){
    if(note)note.textContent="Nothing to play yet — tap notes on the zone map above, or use Fill with.";
    return;}
  if(!audio()){if(note)note.innerHTML=state.audioFault||"Audio is unavailable in this browser.";return;}
  if(note)note.textContent="";
  const R=soloRoot(),gap=30/state.bpm;          // eighth notes at the current tempo
  state.soloStep=0;
  const tick=when=>{
    if(state.soloStep>=state.soloRun.length){
      // The last note is already booked; stop once it has sounded, not before.
      const t=state.soloTimer;clearInterval(t);
      atBeat(when,()=>{if(state.soloTimer===t)stopSolo();});return;}
    const n=state.soloRun[state.soloStep],step=state.soloStep;
    pluck(midiAt(n.s,n.o+R),when,Math.max(.18,gap*1.7),.5);
    atBeat(when,()=>{if(state.soloTimer)markSoloStep(step);});
    state.soloStep++;};
  state.soloTimer=beatLoop(gap,tick);
  const b=document.getElementById("soloplay");
  b.textContent="Stop";b.setAttribute("aria-pressed",true);}

function renderSolo(){
  const R=soloRoot(),zone=soloZone(),sel=soloSel();
  const lo=zone.length?Math.min(...zone.map(n=>n.f)):R;
  const hi=zone.length?Math.max(...zone.map(n=>n.f)):R;

  // box toggles
  const bx=document.getElementById("soloboxes");
  bx.innerHTML='<span class="lbl">Boxes</span>';
  BOXES.forEach(b=>{const on=state.soloBoxes.includes(b.n),btn=document.createElement("button");
    btn.textContent="Box "+b.n;btn.setAttribute("aria-pressed",on);
    btn.onclick=()=>{stopSolo();
      state.soloBoxes=on?state.soloBoxes.filter(n=>n!==b.n):[...state.soloBoxes,b.n].sort((x,y)=>x-y);
      if(!state.soloBoxes.length)state.soloBoxes=[b.n];
      saveSolo();renderSolo();};
    bx.appendChild(btn);});
  [["All",()=>[1,2,3,4,5]],["Just Box 1",()=>[1]],["1 + 2",()=>[1,2]],["1 + 4",()=>[1,4]]]
    .forEach(([t,f])=>{const btn=document.createElement("button");
      btn.textContent=t;btn.style.opacity=".75";
      btn.onclick=()=>{stopSolo();state.soloBoxes=f();saveSolo();renderSolo();};
      bx.appendChild(btn);});

  // pattern fills
  const pt=document.getElementById("solopatterns");
  pt.innerHTML='<span class="lbl">Fill with</span>';
  SOLOPATTERNS.forEach(p=>{const btn=document.createElement("button");
    btn.textContent=p.t;btn.title=p.tip;
    btn.onclick=()=>{stopSolo();state.soloRun=buildRun(p.id);saveSolo();renderSolo();};
    pt.appendChild(btn);});

  // the zone map — every note here is tappable
  document.getElementById("solomap").innerHTML=fretboard(zone,{w:46,plain:true});
  document.getElementById("solomaplabel").textContent=
    `Zone — ${sel.map(b=>"Box "+b.n).join(" + ")} · fret ${lo}–${hi}`;
  const shared=zone.filter(n=>n.boxes.length>1).length;
  document.getElementById("solozonetip").innerHTML=
    `<b>${zone.length} notes across ${hi-lo+1} frets.</b> `+
    (sel.length>1
      ? `<b style="color:#A87A00">${shared} gold notes belong to more than one of these shapes</b> — those are the doors between them, and a run that crosses on one of them will not sound like a position change. `
      : `Add a second box and the notes shared between them light up gold. `)+
    `Tap any note to add it to the run.`;

  // clicking the zone map builds the run
  document.getElementById("solomap").querySelectorAll("g.pn").forEach(g=>{
    const add=()=>{stopSolo();
      state.soloRun=[...state.soloRun,{s:+g.dataset.s,o:+g.dataset.f-R}];saveSolo();renderSolo();};
    g.addEventListener("click",add);
    g.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();add();}});});

  // ---- the run ----
  const c=[];
  if(!state.soloRun.length){
    c.push(`<div class="card wide"><h2>Your run<em>nothing yet</em></h2>
      <p class="tip">Tap notes on the zone map above to build a run one note at a time, or use
      <b>Fill with</b> to drop in a practice pattern and edit from there. Everything you build is kept on
      this device, so it is still here next time.</p></div>`);
  }else{
    const map=new Map();
    state.soloRun.forEach((n,i)=>{const k=n.s+":"+n.o;
      if(map.has(k))map.get(k).ord+="·"+(i+1);
      else map.set(k,{s:n.s,f:n.o+R,ord:String(i+1),
        kind:noteAt(n.s,n.o+R)===state.key?"root":"tone"});});
    const frets=state.soloRun.map(n=>n.o+R);
    const outside=state.soloRun.filter(n=>!inZone(n.s,n.o+R)).length;
    const strings=new Set(state.soloRun.map(n=>n.s)).size;
    const roots=state.soloRun.filter(n=>noteAt(n.s,n.o+R)===state.key).length;
    const last=state.soloRun[state.soloRun.length-1];
    const endsOnRoot=noteAt(last.s,last.o+R)===state.key;
    c.push(`<div class="card wide"><h2>Your run<em>${state.soloRun.length} notes · fret ${Math.min(...frets)}–${Math.max(...frets)}</em></h2>
      <div id="solorun">${fretboard([...map.values()],{w:44,plain:true})}</div>
      <pre>${tab(state.soloRun.map(n=>[n.s,n.o]),R)}</pre>
      <div class="row" style="margin-top:10px">
        <button id="soloplay">Play run</button>
        <button id="solorev">Reverse</button>
        <button id="soloundo">Undo last</button>
        <button id="soloclear">Clear</button>
        <span id="soloplaymsg" style="font-size:11.5px;color:var(--pink)"></span>
      </div>
      <p class="tip">Numbers are playing order; a note used more than once shows every position it takes.
      Playback follows the <b>tempo slider</b> at the top, one note per eighth note, and lights each note as
      it sounds.</p>
      ${outside?`<p class="tip stayed">${outside} note${outside>1?"s are":" is"} outside the current zone —
        you changed the box selection after building this. They still play; they are just not in the shapes
        selected above.</p>`:""}</div>`);
    c.push(`<div class="card"><h2>What you've built<em>read it back</em></h2>
      <ul class="checklist" style="border-bottom:1px solid var(--rule)">
        <li><label>${state.soloRun.length} notes across ${strings} string${strings>1?"s":""}</label></li>
        <li><label>${roots} root${roots===1?"":"s"} in the run</label></li>
        <li><label>Ends on ${endsOnRoot?"the root":"a "+(IV[deg(noteAt(last.s,last.o+R))]||"note")}</label></li>
        <li><label>Spans ${Math.max(...frets)-Math.min(...frets)+1} frets</label></li>
      </ul>
      <p class="tip">${endsOnRoot
        ? "Ending on the root is what makes a run sound finished rather than interrupted. Now try one that <b>doesn't</b> — end on the ♭7 and leave it hanging."
        : "<b>This run does not land on the root.</b> That is fine as a question, but play it against the drone and hear how unresolved it is. Add a root at the end and hear the difference — that difference is the whole point of knowing where the roots are."}</p>
      ${roots===0?`<p class="tip">There is no root anywhere in it. A run with no roots has nothing to aim at; add one in the middle as well as at the end.</p>`:""}</div>`);
  }
  c.push(`<div class="card"><h2>How to practise it<em>the part that isn't clicking</em></h2>
    <p class="tip">Turn the <b>root drone</b> on and play the run against it, slowly, until it is clean.
    Then use the <b>tempo ladder</b> in Practice: +5 bpm for a clean pass, −5 for a miss. Speed is a
    by-product of accuracy, never the target.</p>
    <p class="tip">When it is solid, <b>stop playing it as written</b>. Same notes, different rhythm. Same
    rhythm, start on a different note. Leave a bar of silence in the middle. A run you can only play one way
    is an exercise; a run you can bend is vocabulary.</p>
    <p class="tip">Two boxes at once is the useful setting here — one box is a shape, two boxes is a
    <b>position change</b>, and position changes are the thing that actually needs the practice.</p></div>`);
  document.getElementById("solocards").innerHTML=c.join("");

  const bind=(id,fn)=>{const el=document.getElementById(id);if(el)el.onclick=fn;};
  bind("soloplay",playSolo);
  bind("solorev",()=>{stopSolo();state.soloRun=[...state.soloRun].reverse();saveSolo();renderSolo();});
  bind("soloundo",()=>{stopSolo();state.soloRun=state.soloRun.slice(0,-1);saveSolo();renderSolo();});
  bind("soloclear",()=>{stopSolo();state.soloRun=[];saveSolo();renderSolo();});
}

function renderConnect(){
  document.getElementById("connect").innerHTML=[0,1,2,3].map(i=>{
    const a=BOXES[i],b=BOXES[i+1],R=groupRoot(a,b),map=new Map();
    const add=(s,f)=>{const k=s+":"+f;
      if(map.has(k))map.get(k).kind="pivot";
      else map.set(k,{s,f,kind:noteAt(s,f)===state.key?"root":"tone"});};
    a.off.forEach((p,s)=>p.forEach(o=>add(s,o+R)));
    b.off.forEach((p,s)=>p.forEach(o=>add(s,o+R)));
    const notes=[...map.values()].map(n=>({...n,ring:n.kind==="pivot"&&noteAt(n.s,n.f)===state.key}));
    // arrow on the high e: slide out of the lower box into the upper one
    const from=notes.find(n=>n.s===0&&n.f===a.off[0][1]+R), toF=b.off[0][1]+R;
    if(from&&toF>from.f)from.to=toF;
    return `<div class="card"><h2>Box ${a.n} → Box ${b.n}<em>fret ${Math.min(...notes.map(n=>n.f))}–${Math.max(...notes.map(n=>n.f))}</em></h2>${fretboard(notes,{w:44})}<p class="tip">${SLIDE[i]} The pink arrow marks the slide on the high e; the same move is available on every string.</p><p class="tip" style="opacity:.65;font-size:11.5px">${notes.filter(n=>n.kind==="pivot").length} shared notes. A pair has to sit at one position, so this diagram uses the lowest place both shapes fit.</p></div>`;}).join("");
}

// ---------- power chord + song form rendering ----------
// absolute-pitch tab (the example song is in its own key, not the app's)
function pcTab(evs){const rows=SL.map(l=>l+"|-");
  evs.forEach(e=>{
    const cells=new Array(6).fill(null);
    if(!e.rest)e.c.forEach(([st,f])=>cells[st]=String(f)+(e.sl?"/":""));
    const wdt=Math.max(1,...cells.map(c=>c?c.length:1));
    for(let i=0;i<6;i++)rows[i]+=(cells[i]||"-".repeat(wdt)).padEnd(wdt,"-")+"--";});
  return rows.map(r=>r+"|").join("\n");}
// one block per section, width proportional to its bar count
function formStrip(secs){
  const total=secs.reduce((a,x)=>a+x[1],0);
  return `<div class="formstrip">`+secs.map(([nm,bars,c])=>
    `<div class="formblk" style="flex:${bars} 1 0;background:${SECCOL[c]}" title="${nm} — ${bars} bars">
       <b>${nm}</b><i>${bars}</i></div>`).join("")+`</div>
    <p class="tip" style="margin:6px 0 0;font-size:11px;opacity:.6">${total} bars — block width is bar count</p>`;}

function renderPower(){
  const c=[],k=NOTES[state.key];
  c.push(`<div class="card"><h2>What it is<em>root + 5th, and nothing else</em></h2>
    <p class="tip">A power chord is <b>two notes</b>: a root and the fifth above it. That is not a full chord —
    it has no third, and <b>the third is the note that decides major or minor</b>. Leaving it out means the
    chord is neither, so the same shape sits happily over a major or a minor progression. That is the whole
    trick, and it is why one shape moved around the neck can carry an entire song.</p>
    <p class="tip">It also matters technically. Under heavy distortion, the intervals inside a full chord
    beat against each other and turn to mud; a root and a fifth are so consonant that they stay clean
    however hard you drive them. Loud rock guitar is built on power chords for a physical reason, not a
    stylistic one.</p>
    <p class="tip">Written <b>${k}5</b> — the “5” says fifth-only, no third. Your minor pentatonic already
    contains the root, the 4th and the 5th, so the chords under a riff and the scale over it are made of
    the same handful of notes.</p></div>`);

  PCSHAPES.forEach(sh=>{
    const f=rootOn(sh.root),n=sh.three?pc3(sh.root,f):pc2(sh.root,f);
    const fr=n.map(x=>x.f);
    c.push(`<div class="card"><h2>${sh.t}<em>${sh.e}</em></h2>${fretboard(n,{w:46,plain:true})}
      <pre>${pcTab([{c:n.map(x=>[x.s,x.f])}])}</pre>
      <p class="tip"><b>${k}5 here — ${STRNAME[sh.root]} string, fret ${f}${fr.length>1?", frets "+Math.min(...fr)+"–"+Math.max(...fr):""}.</b>
      Numbers in the dots are fingers. Move the shape and the name moves with it; the fingering never changes.</p>
      <p class="tip">${sh.tip}</p></div>`);});

  c.push(`<div class="card"><h2>Open power chords<em>E5 · A5 · D5</em></h2>
    <div class="grid" style="gap:12px">${PCOPEN.map(o=>
      `<div><h2 style="font-size:13px">${o.t}<em>${o.e}</em></h2>${fretboard(o.n,{w:44,plain:true})}
       <p class="tip" style="font-size:11.5px">${o.tip}</p></div>`).join("")}</div>
    <p class="tip">These three are fixed — they only exist at the open position, so they only give you E5,
    A5 and D5. Everything else has to be a movable shape. Songs in E, A and D minor are common in rock
    partly because of this.</p></div>`);

  // where every root lives
  let rows="";
  for(let i=0;i<12;i++){
    const e6=((i-OPEN[5]+12)%12),a5=((i-OPEN[4]+12)%12),d4=((i-OPEN[3]+12)%12);
    rows+=`<tr${i===state.key?' class="me"':''}><td>${NOTES[i]}5</td><td>${e6}${e6===0?" (open)":""}</td>`
        +`<td>${a5}${a5===0?" (open)":""}</td><td>${d4}${d4===0?" (open)":""}</td></tr>`;}
  c.push(`<div class="card"><h2>Every power chord<em>root fret on each string</em></h2>
    <table><tr><th>Chord</th><th>Low E root</th><th>A root</th><th>D root</th></tr>${rows}</table>
    <p class="tip">Add 12 to any fret for the same chord an octave up. The fifth is always two frets up on
    the next string — <b>except</b> on the G string, where it is three.</p></div>`);

  PCPROG.forEach(pg=>{
    const ch=pg.d.map(d=>{const pcs=(state.key+d)%12,f=(pcs-OPEN[5]+12)%12;
      return {nm:NOTES[pcs]+"5",f:f===0?12:f};});
    c.push(`<div class="card"><h2>${pg.t}<em>${pg.e}</em></h2>
      <p class="tip" style="font-size:15px;margin:0 0 8px"><b>${ch.map(x=>x.nm).join("  –  ")}</b></p>
      <pre>low E root:  ${ch.map(x=>"fret "+x.f).join("   →   ")}</pre>
      <p class="tip">${pg.tip}</p></div>`);});

  c.push(`<div class="card"><h2>Palm muting<em>the other half of the sound</em></h2>
    <p class="tip">Rest the <b>edge of your picking hand on the strings right where they leave the bridge</b>
    and keep it there while you play. Too far forward and the note dies; too far back and nothing happens.
    The chorus of the example song below is palm muted for two whole bars — that is what the dashed
    <b>P.M.</b> line over a tab means, and it runs until the line stops.</p>
    <p class="tip">Muting is what turns a chord into a riff. An unmuted power chord rings into the next one
    and everything blurs; a muted one is percussive and you hear the rhythm as clearly as the pitch.</p></div>`);
  c.push(`<div class="card"><h2>Downstrokes<em>the ⊓ marks</em></h2>
    <p class="tip">Every stroke in the example song is a downstroke — that is what the <b>⊓</b> symbol over
    each beat means. Alternating up and down is faster but the two strokes do not sound the same; all-down
    is heavier and perfectly even, which is the point. Build it with the metronome slow enough that you
    never miss one, then raise the tempo five bpm at a time.</p>
    <p class="tip">Use the <b>Rhythm lab</b> and the tempo ladder in <b>Practice</b> for this — the same
    ±5 bpm discipline that works for scales works better for downstroke stamina.</p></div>`);
  c.push(`<div class="card"><h2>Killing the strings you're not playing<em>the hardest part</em></h2>
    <p class="tip">Two notes are sounding and four are not — under distortion, silence has to be actively
    produced. The <b>tip of the index finger</b> leans into the strings above the chord; the <b>underside
    of the ring finger</b> lies flat enough to deaden the string below it. Both fingers are doing two jobs
    at once. If a shape sounds messy, it is almost never the fretting — it is the muting.</p></div>`);
  document.getElementById("power").innerHTML=c.join("");

  // ---- the example song ----
  const sc=[];
  sc.push(`<div class="card wide"><h2>The song<em>B minor · one riff, four jobs</em></h2>
    <p class="tip">Read off your tab. Two-note power chords all the way through, roots on the A and D
    strings. <b>Every chord in it belongs to B dorian</b>, and the five that carry the weight —
    B5, D5, E5, F#5, A5 — are exactly the notes of <b>B minor pentatonic</b>. So the riff and the solo are
    made of the same material, which is why the solo section needs no chords of its own.</p>
    <p class="tip">C#5 and G#5 are the two passing chords: neither is in the pentatonic, and both are
    approached by step and left immediately. That is the normal job of a non-scale chord in a riff.</p>
    <button id="pcsetkey">Set the app to B minor →</button></div>`);
  PCSONG.parts.forEach(pt=>{
    pt.bars.forEach(b=>{
      const evs=b.rep?Array(b.rep).fill(b.ev[0]):b.ev;
      const seen=new Map();
      b.ev.forEach(e=>{if(e.rest)return;
        e.c.forEach(([st,f],i)=>seen.set(st+":"+f,{s:st,f,kind:i===0?"root":"tone",ord:i===0?"1":"3"}));});
      const names=[...new Set(b.ev.filter(e=>!e.rest).map(e=>e.nm))];
      sc.push(`<div class="card"><h2>${pt.t}<em>${b.n}</em></h2>
        ${fretboard([...seen.values()],{w:44,plain:true})}
        <pre>${pt.pm?"P.M. ------------------------------\n":""}${pcTab(evs)}</pre>
        <p class="tip"><b>${names.join(" – ")}</b>${b.rep?` · eight downstroked eighth notes, palm muted`:` · downstrokes${b.ev.some(e=>e.rest)?", with a rest on beat two":""}`}</p></div>`);});
    sc.push(`<div class="card"><h2>Playing it<em>${pt.t}</em></h2><p class="tip">${pt.tip}</p></div>`);});
  sc.push(`<div class="card wide"><h2>Form<em>${PCSONG.form.join(" – ")}</em></h2>
    ${formStrip(FORMS[FORMS.length-1].secs)}
    <p class="tip">Eight labels, two pieces of music. The intro, verse, solo and interlude are all the same
    two-bar riff; the chorus is the other two bars. Learn four bars and you have learned the song — then the
    work is entirely in dynamics, muting and where you let it breathe.</p>
    <p class="tip"><b>To solo over it:</b> set the key to B minor, open <b>5 boxes</b>, and start in Box 1 at
    fret 7. Turn the root drone on and play the riff's chord tones on the strong beats — B and F# over B5,
    D and A over D5. The <b>12-bar trainer</b> is not this form, but the <b>Rhythm lab</b> is the right place
    to drill the chorus's straight eighths.</p></div>`);
  document.getElementById("pcsong").innerHTML=sc.join("");
  const sk=document.getElementById("pcsetkey");
  if(sk)sk.onclick=()=>{state.key=SONGKEY;stopDrone();state.blueLock=null;
    render();};
}

function renderForm(){
  const g=[];
  g.push(`<div class="card wide"><h2>What structure is for<em>the listener's map</em></h2>
    <p class="tip">A song's form is a contract about repetition. Sections that repeat unchanged
    (<b>the chorus</b>) are what the listener remembers; sections that change (<b>the verse</b>) are what
    moves things along; sections that happen once (<b>the bridge</b>) exist to stop the other two becoming
    predictable. Almost every popular song is some arrangement of those three jobs.</p>
    <p class="tip">Bar counts cluster hard around <b>eight</b>. Verses and choruses are usually eight bars,
    bridges eight or sixteen — “middle eight” is a description of both position and length. Pre-choruses
    run two to eight. Rock stretches intros, outros and instrumental sections much further than pop does.</p></div>`);
  g.push(`<div class="card wide"><h2>The sections<em>what each one does</em></h2>
    <table><tr><th>Section</th><th>Typical length</th><th>Job</th></tr>${SECTIONS.map(x=>
      `<tr><td><i class="swatch" style="background:${SECCOL[x.c]}"></i>${x.k}</td><td>${x.bars}</td><td style="font-weight:400">${x.job}</td></tr>`).join("")}</table></div>`);
  FORMS.forEach(f=>g.push(`<div class="card wide"><h2>${f.t}<em>${f.e}</em></h2>
    ${formStrip(f.secs)}<p class="tip">${f.tip}</p></div>`));
  g.push(`<div class="card wide"><h2>Building one<em>from a riff you already have</em></h2>
    <p class="tip">Riff-driven rock is the cheapest form to write and the one your two examples both use.
    Take a <b>two-bar riff</b>. Repeat it four times — that is an eight-bar verse. Write a second two-bar
    idea with a different chord as its home, repeat it four times — that is your chorus. You now have a song
    that only needs an order.</p>
    <p class="tip">Then decide three things: <b>where the riff plays alone</b> (intro, interlude, outro),
    <b>where the solo goes</b> (over the verse changes, after the second chorus), and <b>whether you need a
    bridge</b> (only if the verse–chorus pair starts to feel repetitive by the third time round). That is
    the whole craft of arrangement at this level.</p>
    <p class="tip">One rule worth keeping: <b>never let the same section happen three times in a row without
    something changing.</b> Drop the drums, mute the guitar, take the vocal away — a change costs nothing and
    buys another repeat.</p></div>`);
  document.getElementById("form").innerHTML=g.join("");
}

function renderBlues(){
  const c=[],host=document.getElementById("blues");
  // --- whole-neck map: every box, every octave, with the flat five in place ---
  const ml=document.getElementById("bluesmaplabel"),bt=document.getElementById("bluestip");
  const drawMap=()=>{
    document.getElementById("bluesmap").innerHTML=bluesMap(state.blueLock);
    if(!state.blueLock){ml.textContent="Whole neck — all five boxes with the ♭5 dropped in";
      bt.innerHTML="Every pentatonic note on the neck, plus every <b>♭5</b> as a dashed dot. The blues boxes below are slices of this. Isolate one to see where it repeats — each shape comes back twelve frets away, so a lick learned once is available twice. <b>Tap any dot to hear it.</b>";}
    else{const z=ZONES[state.blueLock];
      if(z){ml.textContent=`Whole neck — ${z.t} isolated`;bt.innerHTML=z.tip;}
      else{const n=+state.blueLock.slice(3),b=BOXES[n-1],fl=b.off.flat(),R=boxRoot(b);
        ml.textContent=`Whole neck — Box ${n} isolated`;
        bt.innerHTML=`<b>Box ${n}, fret ${Math.min(...fl)+R}–${Math.max(...fl)+R}</b> and again an octave either side. ${b.tip} The dashed ♭5s inside it are the blues notes available without leaving the shape.`;}}
    document.querySelectorAll("#bluesfocus button").forEach(b=>
      b.setAttribute("aria-pressed",(b.dataset.z||null)===state.blueLock));};
  const focus=document.getElementById("bluesfocus");
  focus.innerHTML='<span class="lbl">Isolate</span>';
  const addBtn=(z,t)=>{const b=document.createElement("button");
    if(z)b.dataset.z=z;b.textContent=t;
    b.onclick=()=>{state.blueLock=(state.blueLock===z)?null:z;drawMap();};focus.appendChild(b);};
  addBtn(null,"All");
  [1,2,3,4,5].forEach(n=>addBtn("box"+n,"Box "+n));
  addBtn("blues","Blues box");addBtn("bb","B.B.");addBtn("ak","Albert King");
  drawMap();

  // --- close-up cards for the boxes that fit at this register ---
  {const R=boxRoot(BOXES[0]),b5=(state.key+6)%12;
   let n1=boxNotes(BOXES[0],R).map(n=>({...n,kind:kindOf(n)}));
   for(let s=0;s<6;s++)for(let f=R;f<=R+3;f++)if(noteAt(s,f)===b5)n1.push({s,f,kind:"ghost"});
   c.push({b:BOXES[0],t:"Blues box",e:`fret ${R}–${R+3}`,n:n1,tip:ZONES.blues.tip});}
  {const R=boxRoot(BOXES[2]);
   let bb=boxNotes(BOXES[2],R).filter(n=>n.s<3).map(n=>({...n,kind:kindOf(n)}));
   bb.push({s:0,f:R+9,kind:"ghost"});
   c.push({b:BOXES[2],t:"B.B. King box",e:`fret ${R+4}–${R+9}`,n:bb,tip:"Top three strings of Box 3, sat around the root on the B string, everything phrased with heavy vibrato. The dashed note is the major 6th — the sweet note that makes this box sound happier than the rest."});}
  {const R=boxRoot(BOXES[1]);
   let ak=boxNotes(BOXES[1],R).filter(n=>n.s<3).map(n=>({...n,kind:kindOf(n)}));
   c.push({b:BOXES[1],t:"Albert King box",e:`fret ${R+2}–${R+5}`,n:ak,tip:ZONES.ak.tip});}
  host.innerHTML=c.map(x=>
    `<div class="card"><h2>${x.t}<em>${x.e}</em></h2>${fretboard(x.n)}<p class="tip">${x.tip}</p>${regNote(x.b)}</div>`).join("");
}

const LICKS=[
  {t:"Descending cascade",e:"Box 1",tip:"The workhorse. Two notes per string, straight down. Then start it from the B string so it stops sounding like a scale.",n:[[0,3],[0,0],[1,3],[1,0],[2,2],[2,0],[3,2],[3,0],[4,2],[4,0],[5,3],[5,0]]},
  {t:"Rolling triplets",e:"Box 1",tip:"Three notes looped as triplets. Speed comes from repetition, not from new notes.",n:[[0,0],[1,3],[2,2],[0,0],[1,3],[2,2],[0,0]]},
  {t:"Bend and answer",e:"Box 1",tip:"Bend the G string a full step so it matches the pitch two frets up, hold, then answer with the notes above it. Check the bend against the target note first.",n:[[2,2,"b"],[2,2,"r"],[1,3],[0,0],[0,3]]},
  {t:"Sequenced fours",e:"Box 1",tip:"Four up, back one, four up. Sounds composed rather than run.",n:[[5,0],[5,3],[4,0],[4,2],[5,3],[4,0],[4,2],[3,0],[4,0],[4,2],[3,0],[3,2]]},
  {t:"B.B. descent",e:"B.B. box",tip:"Land on the root on the B string and hold it with wide, slow vibrato. The lick is mostly the last note.",n:[[0,7],[0,5],[1,8],[1,5,"~"]]},
  {t:"Albert King bend",e:"Albert King box",tip:"Bend the top note of the high e a whole step, then let it fall in stages. Vocal, not mechanical.",n:[[0,5,"b"],[0,5,"r"],[0,3],[1,5],[1,3]]},
  {t:"Blue note walk",e:"Blues box",tip:"The chromatic 4–♭5–5 climb on the G string. Keep it moving.",n:[[3,0],[3,2],[2,0],[2,2],[2,3],[2,4]]},
  {t:"Box 1 to Box 2 slide",e:"Connection",tip:"Ends on the shared note and slides into the next shape. Make it your standard way out of Box 1.",n:[[3,0],[3,2],[2,0],[2,2],[1,0],[1,3,"/"],[1,5],[0,3]]},
  // ---- from the practice guide. Written relative to the root fret, so they
  // ---- transpose with the key selector; in E minor they read exactly as in the guide.
  {g:1,t:"Box 1, both directions",e:"Practice 1 · 4:00–11:00",
   tip:"Two notes per string, straight up and straight back down, slowly. <b>Pause on each root and say “${K}” out loud.</b> The point is to stop seeing a finger pattern and start seeing a map of destinations.",
   n:[[5,0],[5,3],[4,0],[4,2],[3,0],[3,2],[2,0],[2,2],[1,0],[1,3],[0,0],[0,3]]},
  {g:1,t:"Reach into Box 2",e:"Practice 1 · 11:00–16:00",
   tip:"Hammer on from the G string, then walk up the B. The first two notes on the B string are still Box 1; <b>the last one is in Box 2 and it is a root</b>. Play it four times, then improvise an ending that lands on any root.",
   n:[[2,0,"h"],[2,2],[1,0],[1,3],[1,5,"~"]]},
  {g:2,t:"Box 2, both directions",e:"Practice 2 · 3:00–9:00",
   tip:"The same job one position up. Four times up and back, pausing on both roots. Box 2 has only two roots against Box 1's three, which is exactly why it feels less settled — you have to aim for them.",
   n:[[5,3],[5,5],[4,2],[4,5],[3,2],[3,5],[2,2],[2,4],[1,3],[1,5],[0,3],[0,5]]},
  {g:2,t:"The diagonal route",e:"Practice 2 · 9:00–15:00",
   tip:"Start on the Box 1 root on the low E and climb diagonally until you are inside Box 2. Then come back down and stop on the Box 2 root on the D string. <b>It works when you can see where the position change happens</b> rather than relying on memorised fingering.",
   n:[[5,0],[5,3],[4,2],[4,5],[3,2],[3,5],[2,2],[2,4],[1,3],[1,5],[0,3],[0,5]]},
  {g:2,t:"Call and answer across the boxes",e:"Practice 2 · 15:00–19:00",
   tip:"First bar asks the question in Box 1, second bar answers it in Box 2 and lands on a root. <b>Leave space after the last note.</b> Repeat it, then change the rhythm while keeping the destination — the destination is the lick, the rhythm is decoration.",
   n:[[3,0],[3,2],[2,0],[2,2],[2,2],[2,4],[1,3],[1,5,"~"]]}
];
// root locations inside the first two boxes, as {string, offset from the root fret}
const GUIDEROOTS=[
  {box:1,at:[[5,0],[3,2],[0,0]]},
  {box:2,at:[[3,2],[1,5]]}
];
const GUIDEKEYS=[4,11,9,7];   // E, B, A, G minor — the keys the guide works in
function tab(n,R=fitRoot(n.map(e=>e[1]))){const rows=SL.map(l=>l+"|-");
  n.forEach(([s,o,tk])=>{const cell=String(o+R)+(tk||"");
    for(let i=0;i<6;i++)rows[i]+=(i===s?cell:"-".repeat(cell.length))+"--";});
  return rows.map(r=>r+"|").join("\n");}
function renderLicks(){
  const R=groupRoot(BOXES[0],BOXES[1]),k=NOTES[state.key];
  // root reference for the two boxes the guide works in
  const rootCard=`<div class="card wide"><h2>Roots in Box 1 and Box 2<em>${k} minor · what you are aiming at</em></h2>
    ${fretboard((()=>{const m=new Map();
      [BOXES[0],BOXES[1]].forEach(bx=>bx.off.forEach((pp,st)=>pp.forEach(o=>
        m.set(st+":"+o,{s:st,f:o+R,kind:"tone"}))));
      GUIDEROOTS.forEach(g=>g.at.forEach(([st,o])=>{const kk=st+":"+o,e=m.get(kk);
        m.set(kk,{s:st,f:o+R,kind:"root",ord:e&&e.ord?e.ord+"·"+g.box:String(g.box)});}));
      return [...m.values()];})(),{w:44,plain:true})}
    <table><tr><th>Position</th><th>Root locations</th></tr>
      ${GUIDEROOTS.map(g=>`<tr><td>Box ${g.box}</td><td>${g.at.map(([st,o])=>
        `string ${strNo(st)}, fret ${o+R}`).join("; ")}</td></tr>`).join("")}</table>
    <p class="tip">Numbers in the pink dots are which box the root belongs to — the one on the D string
    belongs to <b>both</b>, which is why it is the natural place to change position. Box 1 has three roots,
    Box 2 has two. <b>Identify them without looking at the diagram</b> before moving on.</p>
    <div class="row" style="margin-top:10px"><span class="lbl">Guide keys</span>${
      GUIDEKEYS.map(i=>`<button class="guidekey" data-k="${i}"${i===state.key?' aria-pressed="true"':''}>${NOTES[i]}m</button>`).join("")}</div></div>`;
  document.getElementById("licks").innerHTML=rootCard+LICKS.map(l=>{
    const LR=fitRoot(l.n.map(e=>e[1])),map=new Map();
    l.n.forEach(([s,o],i)=>{const k=s+":"+o;
      if(map.has(k))map.get(k).ord+="·"+(i+1);
      else map.set(k,{s,f:o+LR,ord:String(i+1),kind:noteAt(s,o+LR)===state.key?"root":"tone"});});
    return `<div class="card${l.g?" fromguide":""}"><h2>${l.t}<em>${l.e}</em></h2>${
      l.g?`<p class="badge">Practice guide</p>`:""}${fretboard([...map.values()],{w:44})}<pre>${tab(l.n,LR)}</pre>
      <p class="tip">${l.tip.replace(/\$\{K\}/g,k)}</p>
      <p class="tip"><button data-hear="${LICKS.indexOf(l)}">Hear the model</button> then press Record in the Play along bar and play it back to yourself.</p>
      <p class="tip licktempo" id="licktempo-${LICKS.indexOf(l)}">${lickTempoLine(l)}</p>
      <div class="row"><button data-clean="${LICKS.indexOf(l)}">Played it clean at this tempo</button>${
        (r=>r.length?`<button data-bpm="${Math.max(40,r[0].bpm-5)}">Warm up at ${Math.max(40,r[0].bpm-5)}</button><button data-bpm="${Math.min(220,r[0].bpm+5)}">Try ${Math.min(220,r[0].bpm+5)}</button>`:"")(readLickTempos()[l.t]||[])}</div></div>`;}).join("");
  document.getElementById("licks").onclick=e=>{const d=e.target&&e.target.dataset;if(!d)return;
    if(d.hear!==undefined)hearLick(+d.hear);
    else if(d.clean!==undefined){saveLickTempo(+d.clean);renderLicks();
      const t=document.getElementById("licktempo-"+d.clean);if(t)t.innerHTML=`Saved: clean at <b>${state.bpm} bpm</b>. Next time, start here.`;}
    else if(d.bpm!==undefined)setBpm(+d.bpm);};
  document.querySelectorAll(".guidekey").forEach(b=>b.onclick=()=>{
    state.key=+b.dataset.k;stopDrone();state.blueLock=null;
    render();});
}


// The app's version of a lick, played first: the notes as written, in the key and register on
// screen, at eighth notes at the current tempo. Bends, slides and vibrato are marked in the tab
// but not sounded: the model gives you the pitches and the rhythm to check yourself against.
function hearLick(i){
  const l=LICKS[i],a=audio();
  if(!l||!a)return 0;
  const LR=fitRoot(l.n.map(e=>e[1])),gap=60/state.bpm/2;
  l.n.forEach(([s,o],k)=>a.note(midiAt(s,o+LR),{when:k*gap,dur:Math.max(.3,gap*1.6),vol:.5}));
  return l.n.length*gap;}

// ---------- learning path ----------
const PATH=[
 {n:1,t:"Time, before notes",d:"about a week",go:[["tune","Tune up first"],["rhythm","Rhythm lab"],["trainer","Twelve bars with the band"]],
  goal:"Play <b>one note</b> over the metronome and drone for twelve bars without drifting. Then two notes. Then a note on beat one of every bar, nothing else.",
  why:"Everything that makes a solo sound good is rhythmic. A player with perfect time and five notes sounds better than a player with bad time and fifty. Starting here is not a warm-up, it's the foundation.",
  test:"Twelve bars, one note, click on — you land on beat one every time and can feel the bar turn over without counting out loud."},
 {n:2,t:"One shape, no map",d:"1–2 weeks",go:[["boxes","Open the drills"],["notes","Learn the note names"]],
  goal:"Box 1 only, in one key. Up and down, eyes off the neck, naming the degrees as you go. Use the Find-the-note drill until the ♭3, 4, 5 and ♭7 are instant. Alongside it, five minutes a day on <b>Note names</b> — one string at a time, said out loud.",
  why:"You need one shape that's utterly automatic before a second one helps. Five half-known shapes is worse than one known cold.",
  test:"Play Box 1 both directions without looking at your hands, naming every degree aloud, with no hesitation."},
 {n:3,t:"Phrasing and space",d:"2–4 weeks — the big one",go:[["melody","Open the drills"]],
  goal:"Four notes maximum per phrase, then silence for as long as the phrase lasted. Ask a question, answer it. Sing a line first, then find it.",
  why:"This is what separates playing a scale from playing music, and it's the stage almost everyone skips in a hurry to learn more notes. Space is what makes the notes mean anything.",
  test:"Record twelve bars using no more than four notes that you'd be willing to play to another person. That's the bar. It's harder than it sounds."},
 {n:4,t:"The sound: bends and vibrato",d:"start now, never stops",go:[["tune","Check your bends"],["blues","Open the drills"]],
  goal:"Play the target note, hold it in your head, then bend to it and check. Vibrato from the wrist, even in speed and width, on a held note.",
  why:"Bad bends and shaky vibrato make good note choices sound amateur. Good ones make three notes sound professional. This is the highest-return technical work in blues playing.",
  test:"Five bends in a row that the bend check calls in tune, and a recorded one held with vibrato that doesn't wobble in speed. Listen back — recording is the only honest judge here."},
 {n:5,t:"Vocabulary — three licks, not thirty",d:"2–4 weeks",go:[["licks","Open the drills"]],
  goal:"Take three licks. Learn each in three keys, and save the tempo you can play each one cleanly at, so the next session starts there. Then break each into fragments and rearrange them — first half of one, second half of another.",
  why:"Licks are raw material, not finished sentences. Players who collect fifty licks play fifty licks; players who own three recombine them into hundreds.",
  test:"Play each from memory at two tempos, and use half of one inside an improvisation without planning it first."},
 {n:6,t:"Movement",d:"3–6 weeks",go:[["cross","Open the drills"],["solo","Build a run"]],
  goal:"Work the crossing drills in order: one string whole neck, then the two-box zones, then one motif through every position.",
  why:"Now the other four boxes earn their place — as somewhere to go, not as more shapes to memorise. Position changes should be inaudible.",
  test:"Solo over twelve bars visiting at least three positions, with no audible seam where you shifted."},
 {n:7,t:"Playing the changes",d:"ongoing",go:[["triads","See the chord shapes"],["inv","Move between them"],["trainer","Play it over 12 bars"]],
  goal:"Turn on the chord-tone rings. Land on a chord tone on beat one of each chord change — especially the 3rd. Everything between changes can stay pentatonic. <b>Triads</b> show you those target notes as a shape your hand can grab; <b>Inversions</b> is how you get to the next one without jumping.",
  why:"This is the jump from 'soloing in a key' to 'soloing over a song', and it's where most self-taught players plateau for years without noticing.",
  test:"Play your line unaccompanied to someone and they can hear where the chord changed."},
 {n:8,t:"Colour and voice",d:"open-ended",go:[["blues","Open the drills"],["major","Major pentatonic"],["modes","Modes"]],
  goal:"Add the ♭5 as a passing note, the B.B. major 6th for sweetness, Albert-style overbends for aggression. Then steal two solos by ear — no tab.",
  why:"Transcribing by ear is the single most effective thing a soloist can do, and it's last on this list only because it's miserable before the earlier stages are solid.",
  test:"You can play two solos you learned entirely by ear, and you can hear which of the two Kings someone is borrowing from on a record."}
];
const HOWTO=[
 {t:"How to practise this",items:[
  "<b>Slow enough to be perfect.</b> Speed is a by-product of accuracy, never a goal. If you can't play it clean, you're not practising it, you're rehearsing your mistakes.",
  "<b>One focus per session.</b> Decide the single thing you're working on before you plug in.",
  "<b>Interleave three items</b>, don't drill one for an hour. Cycling between three things feels worse and works better.",
  "<b>Record one take every session.</b> You cannot hear your own time and vibrato while playing. You'll hate it for a month, then it becomes the most useful minute of the day.",
  "<b>Always play with something.</b> Drone, click, or a backing track. Soloing in silence teaches habits that fall apart the moment there's a band.",
  "<b>Twenty minutes daily beats two hours on Sunday.</b> This is motor learning; frequency wins."]},
 {t:"What usually goes wrong",items:[
  "Collecting shapes instead of developing phrasing — five boxes, nothing to say.",
  "Every phrase starting on the root, on beat one. Start on the ♭7 or mid-bar and the same notes sound different.",
  "Playing at the speed you wish you had rather than the one you own.",
  "Never recording, so bad time and uneven vibrato go unnoticed for years.",
  "Practising only alone and unaccompanied.",
  "Moving on from a stage because it got boring rather than because you passed the test."]}
];
// Which stages you have passed, and when: {stage number: "YYYY-MM-DD"}, in this browser.
// The stage you are on is the first one not passed.
const PATH_KEY="minor-pentatonic-path-v1";
function readPath(){try{const v=JSON.parse(window.localStorage.getItem(PATH_KEY)||"{}"),o={};
  if(v&&typeof v==="object")PATH.forEach(p=>{if(typeof v[p.n]==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v[p.n]))o[p.n]=v[p.n];});
  return o;}catch(e){return {};}}
function writePath(v){try{window.localStorage.setItem(PATH_KEY,JSON.stringify(v));}catch(e){/* this visit only */}}
function currentStage(passed=readPath()){return PATH.find(p=>!passed[p.n])||null;}
function togglePassed(n){const v=readPath();
  if(v[n])delete v[n];else{v[n]=dayKey(new Date());markToday();}
  writePath(v);renderPath();renderToday();}
const shortDate=k=>{const [y,m,d]=k.split("-").map(Number);
  return new Date(y,m-1,d).toLocaleDateString(undefined,{month:"short",day:"numeric"});};
function renderPath(){
  const outlineOpen=!!document.getElementById("courseoutline")?.open;
  const focusedPass=document.activeElement?.dataset?.pass;
  const passed=readPath(),now=currentStage(passed),done=PATH.filter(p=>passed[p.n]).length;
  const here=`<div class="card wide pathnow"><h2>Today<em>${done} of ${PATH.length} stages passed</em></h2>
      <div class="status" id="pathstreak">${streakMessage(readDays())}</div>
      ${now?"":`<p class="tip"><b>Every stage passed.</b> Keep going round: a new key, a new song, a faster tempo, the next solo to learn by ear.</p>`}
      <ul class="loglist" id="pathtoday">${todayAdvice().map(x=>`<li><span>${x}</span></li>`).join("")}</ul></div>`;
  const stage=p=>`<div class="card${now&&p.n===now.n?" now":""}${passed[p.n]?" passed":""}"><h2>${p.n} · ${p.t}<em>${p.d}</em></h2>
      ${passed[p.n]?`<p class="badge">Passed ${escapeHTML(shortDate(passed[p.n]))}</p>`:now&&p.n===now.n?`<p class="badge here">You are here</p>`:""}
      <p class="tip"><b>Do this.</b> ${p.goal}</p>
      <p class="tip"><b>Why here.</b> ${p.why}</p>
      <p class="tip"><b>Move on when.</b> ${p.test}</p>
      <div class="row" style="margin-top:10px">${
        p.go.map(([v,t])=>`<button data-goto="${v}">${t}</button>`).join("")}<button data-pass="${p.n}" aria-pressed="${!!passed[p.n]}">${
        passed[p.n]?"Passed ✓ (undo)":"I passed this test"}</button></div>
      </div>`;
  document.getElementById("path").innerHTML=here+(now?stage(now):"")
    +`<details class="course-outline" id="courseoutline"${outlineOpen||focusedPass?" open":""}><summary>Full learning path &amp; practice advice</summary><div class="grid wide">`
    +PATH.filter(p=>p!==now).map(stage).join("")
    +HOWTO.map(h=>`<div class="card"><h2>${h.t}</h2><ol>${h.items.map(i=>`<li>${i}</li>`).join("")}</ol></div>`).join("")+"</div></details>";
  wireGoto("#path");
  document.querySelectorAll("#path button[data-pass]").forEach(b=>b.onclick=()=>togglePassed(+b.dataset.pass));
  // Retain keyboard focus after a pass/undo moves a stage into the outline.
  if(focusedPass)document.querySelector(`#path button[data-pass="${focusedPass}"]`)?.focus();
}
// Buttons that open a view, or set the tempo, inside a block of text: the path's cards
// and the Today lists.
function wireGoto(sel){
  document.querySelectorAll(sel+" button[data-goto]").forEach(b=>
    b.onclick=()=>goToView(b.dataset.goto));
  document.querySelectorAll(sel+" button[data-bpm]").forEach(b=>b.onclick=()=>setBpm(+b.dataset.bpm));
}

// ---------- over a song ----------
function renderSong(){
  const rel=NOTES[(state.key+3)%12], k=NOTES[state.key];
  const steps=[
   {n:"1",t:"Find the home note",
    b:`Play the song and hum the note it keeps wanting to settle on — usually the chord it starts and ends on. Now find that note on the low E string. That's your root, and everything else follows from it. <b>Test it:</b> hold that one note through the whole progression. If it sounds settled and at rest, you're right. If it fights the chords, try the note a fret or two either side until one stops fighting.`},
   {n:"2",t:"Minor or major?",
    b:`If the home chord is minor, use the minor pentatonic of that note — the shapes in this app, unchanged. If the home chord is major, you have two options and they sound completely different. <b>Blues/rock</b>: use the minor pentatonic of the home note anyway. That grind of the ♭3 against the major chord <i>is</i> the blues sound. <b>Sweet/melodic</b>: use the major pentatonic, which is the same five shapes moved <b>three frets lower</b>.`},
   {n:"3",t:"The trick that unlocks it",
    b:`Minor and major pentatonic are the same shapes. You're looking at <b>${k} minor pentatonic</b> right now — those identical dots are also <b>${rel} major pentatonic</b>. Nothing moves; only the home note changes, from ${k} to ${rel}. So for a song in <b>${rel} major</b>, play exactly what's on screen but resolve your phrases to ${rel} instead of ${k}. Going the other way: a song in G major wants E minor pentatonic shapes, three frets below G.`},
   {n:"4",t:"Where on the neck",
    b:`Anywhere the shapes fit — the neck repeats every twelve frets, so a low-position and a high-position answer are both correct. Start with Box 1 sitting on your root, and use the Register toggle if the song's key puts it awkwardly high or low. Pick the position where the bends are comfortable; that matters more than which box it is.`},
   {n:"5",t:"When to play",
    b:`Solo over the <b>chords</b>, not over the singing. In most songs your slots are the intro, the instrumental section, the outro, and the gaps between vocal phrases — that last one is where the Kings did most of their work, answering the voice rather than competing with it. Learn where the sections start by counting bars, not by feel.`},
   {n:"6",t:"Follow the chords",
    b:`Pentatonic is forgiving: one scale works across a whole progression, which is why it's where everyone starts. But the line only sounds like it's <i>about</i> the song when you land on a note belonging to the chord that just arrived. Turn on the chord-tone rings, and aim to arrive on one at each change. Between changes, play anything in the scale.`}];
  const trouble=[
   ["It sounds like a scale, not a solo","That's a phrasing problem, not a note problem. Fewer notes, more space, and land somewhere on purpose. Stage 3 of the path."],
   ["It sounds fine except over one chord","Your key is right; that chord just contains a note the scale doesn't. Land on a chord tone when it arrives and pass through the rest."],
   ["Everything sounds wrong, in every position","Usually one of three things: wrong home note, the record is tuned down a half step (very common in rock), or the original uses a capo. Find the home note by ear against the record rather than trusting a chord sheet."],
   ["It's correct but dull","No contour and no repetition. One high point per solo, hit once, and one idea that comes back changed."]];
  const songs=[
   ["Sympathy for the Devil","E · chords E–D–A","Home note E. The chords are major but the sound is raunchy, so E minor pentatonic is the right call — Box 1 at fret 12, or use Register: octave down for the open position. Land on E when the E chord comes back around; it does constantly, which makes this an unusually forgiving song to learn on."],
   ["Hotel California","B minor","Home note B, minor chord, so B minor pentatonic straight off. Box 1 at fret 7. The chords move a lot here, so this is the one where chord-tone targeting pays off — pentatonic alone will sound vague."],
   ["Wish You Were Here","G major","Home note G, major chord, sweet rather than bluesy — so major pentatonic: the E minor pentatonic shapes, three frets below G, resolving to G instead of E. Exactly the swap in step 3."]];
  document.getElementById("song").innerHTML=
    steps.map(x=>`<div class="card"><h2>${x.n} · ${x.t}</h2><p class="tip">${x.b}</p></div>`).join("")
   +`<div class="card"><h2>Worked examples<em>from your list</em></h2>`
   +songs.map(([a,b,c])=>`<p class="tip"><b>${a}</b> — ${b}<br>${c}</p>`).join("")
   +`<p class="tip" style="opacity:.55">Check these against the recording you actually play along to — versions get transposed, capoed and tuned down.</p></div>`
   +`<div class="card"><h2>When it doesn't work</h2>`
   +trouble.map(([a,b])=>`<p class="tip"><b>${a}.</b> ${b}</p>`).join("")+`</div>`;
}

// ---------- melody ----------
const MELODY=[
 {t:"Sing it first",e:"the whole trick",
  b:"Sing a phrase, then find it on the neck. This isn't a warm-up — it's the test. Your voice won't sing sixteen notes in a row, won't start on beat one every time, and won't run up a scale in order. It does the melodic things automatically because it's constrained by breath and by what actually sounds like something. <b>If you can't sing what you just played, it wasn't a melody.</b> It's brutal the first few times and it fixes more than any amount of scale practice."},
 {t:"Land somewhere on purpose",e:"targets",
  b:"What makes a line sound intentional isn't the middle, it's where it stops. Choose the target before the phrase starts. The <b>♭3 and the 5th</b> are your strongest landing spots; the root is the most final, and therefore the dullest if you use it every time. Ending on the 4th or ♭7 sounds deliberately unfinished, which makes the listener wait for the next phrase — and that waiting is what melody feels like from outside."},
 {t:"Repeat yourself",e:"the embarrassing one",
  b:"A melody is a recognisable idea that comes back changed. Play a three-note figure; play it again higher; play it a third time with a different ending. That's how memorable solos are built, and it feels almost too simple while you're doing it. Constantly new notes give the listener nothing to hold. <b>Repetition is the difference between a solo someone can hum afterwards and one they can't.</b>"},
 {t:"Give it a contour",e:"one peak",
  b:"A solo needs a single high point, hit once. Start low, work up, peak, come down. If your highest note turns up in bar two and again in bar four and again in bar seven, there's no peak — and the whole thing sits flat no matter what's in it."}];
const MELDRILLS=["<b>One note, twelve bars.</b> Rhythm only. When one note sounds musical, everything else is decoration.",
 "<b>Play the vocal melody</b> of a song you know over its chords. Then decorate it slightly. Then more. You arrive at a solo that sounds melodic because it descends from an actual melody — which is essentially what B.B. was doing.",
 "<b>Three-note motif, twelve bars.</b> No new material allowed. Change the rhythm, the register, the ending.",
 "<b>Chord tones on beat one only.</b> Land on the ♭3 of whatever chord just arrived, then do as you like until the next change.",
 "<b>Call and response.</b> Play a phrase, leave a silence exactly as long, then answer it. Two bars on, two bars off, for the whole song."];
function renderMelody(){
  document.getElementById("melody").innerHTML=
    MELODY.map(m=>`<div class="card"><h2>${m.t}<em>${m.e}</em></h2><p class="tip">${m.b}</p></div>`).join("")
   +`<div class="card"><h2>Drills<em>pick one per session</em></h2><ol>${MELDRILLS.map(d=>`<li>${d}</li>`).join("")}</ol></div>`
   +`<div class="card"><h2>For your material<em>atmospheric, not busy</em></h2>
     <p class="tip">Given what you actually listen to — Gary Jules, SQÜRL, Love and Rockets — melodic in that
     world means <b>sustain and space</b> far more than note choice. Long notes with vibrato, a lot of silence,
     and the amp doing half the work. Those players aren't playing many notes at all, and the P-90 into a clean
     Princeton-style setting will hold a note longer than you think if you let it.</p>
     <p class="tip">The thing that'll hold you back longest is playing faster than you can hear. Melody requires
     listening to the note you just played while choosing the next one, and above a certain tempo that's simply
     not possible yet.</p></div>`;
}

// ---------- landmark shapes: box 1 & 4 ----------
// [string, offset, slideToOffset?]
const RUN_UP=[[5,0],[5,3,5],[5,5],[4,2],[4,5,7],[4,7],[3,7],[3,9],[2,7],[2,9]];
const RUN_DN=[[2,9],[2,7],[3,9],[3,7],[4,7,5],[4,5],[4,2],[5,5,3],[5,3],[5,0]];
function runNotes(run,R=fitRoot(run.map(e=>e[1]))){const m=new Map();
  run.forEach(([st,o,to],i)=>{const k=st+":"+o,e=m.get(k);
    if(e){e.ord+="\u00b7"+(i+1);if(to!==undefined)e.to=to+R;}
    else m.set(k,{s:st,f:o+R,ord:String(i+1),kind:noteAt(st,o+R)===state.key?"root":"tone",...(to!==undefined?{to:to+R}:{})});});
  return [...m.values()];}
function runTab(run,R){return tab(run.map(([st,o,to])=>to!==undefined?[st,o,"/"]:[st,o]),R);}
const PHRASE=[[1,3],[0,0],[0,3,"~"],[1,10],[1,8],[2,9,"~"]];
function renderLand(){
  // Box 1 and Box 4 are taught as a pair and the slide runs travel between them,
  // so the whole view sits at the lowest position that holds both shapes.
  const R=groupRoot(BOXES[0],BOXES[3]),k=NOTES[state.key],host=document.getElementById("land");
  const c=[];
  c.push(`<div class="card"><h2>Box 1 — landmark A<em>fret ${R}\u2013${R+3}</em></h2>
    ${fretboard(boxNotes(BOXES[0],R))}
    <p class="tip"><b>Root: index finger, 6th string, fret ${R}.</b> The one everybody learns first,
    and the easiest to find — you locate the root on the low E and the shape falls under your hand.
    Roots also sit on the D string (fret ${R+2}) and the high e (fret ${R}).</p></div>`);
  c.push(`<div class="card"><h2>Box 4 — landmark B<em>fret ${R+7}\u2013${R+10}</em></h2>
    ${fretboard(boxNotes(BOXES[3],R))}
    <p class="tip"><b>Root: index finger, 5th string, fret ${R+7}.</b> Same job as Box 1, seven frets up
    and one string over — so you find it by locating ${k} on the A string instead of the low E. The other
    root is on the G string at fret ${R+9}.</p></div>`);
  c.push(`<div class="card"><h2>Why these two<em>the relationship</em></h2>
    <p class="tip"><b>Box 4 is Box 1 moved up seven frets.</b> Not loosely — literally. Four of the six
    strings are the identical two-fret pattern shifted up seven; only the A string and the B string
    differ, each by a single fret. That's why Box 4 falls under the hand so easily once Box 1 is solid,
    and it's the reason these two became the standard pair.</p>
    <p class="tip">Together they cover the neck: Box 1 at fret ${R} and Box 4 at fret ${R+7}, then Box 1
    again an octave up at fret ${R+12}. Root on the 6th string, root on the 5th string — those are the
    only two things you have to find.</p>
    <p class="tip">Box 2 and 3 sit between them and Box 5 sits above; treat them as the road, not as
    destinations.</p></div>`);
  {
    c.push(`<div class="card"><h2>Sliding up<em>Box 1 \u2192 Box 4</em></h2>
      ${fretboard(runNotes(RUN_UP,R),{w:40})}
      <pre>${runTab(RUN_UP,R)}</pre>
      <p class="tip"><b>Pink arrows are slides</b> — same finger, same string, don't re-pick.
      Two of them carry you the whole way: one on the low E (fret ${R+3} to ${R+5}) and one on the A
      string (fret ${R+5} to ${R+7}). That second slide lands you on the root, and you are in Box 4.
      The run finishes on the root again on the G string at fret ${R+9}.</p>
      <p class="tip">Use the <b>third finger</b> for both slides, so the hand arrives with the index
      free to cover the new position. This one line is the whole connection system — learn it in a
      single key, then move it.</p></div>`);
    c.push(`<div class="card"><h2>Sliding down<em>Box 4 \u2192 Box 1</em></h2>
      ${fretboard(runNotes(RUN_DN,R),{w:40})}
      <pre>${runTab(RUN_DN,R)}</pre>
      <p class="tip">The same road travelled the other way. Slide with the <b>first finger</b> coming
      down — fret ${R+7} to ${R+5} on the A string, then ${R+5} to ${R+3} on the low E. Going up the
      third finger leads; coming down the index does.</p>
      <p class="tip">Practise both in one breath: up, pause on the root, back down. When that feels
      like one movement rather than two shapes joined end to end, the pair is yours.</p></div>`);
    c.push(`<div class="card"><h2>Call and answer<em>phrase across the pair</em></h2>
      ${fretboard(PHRASE.map(([s,o],i)=>({s,f:o+R,ord:String(i+1),kind:noteAt(s,o+R)===state.key?"root":"tone"})),{w:38})}
      <pre>${tab(PHRASE,R)}</pre>
      <p class="tip">First three notes ask the question down in Box 1, ending on a held note with vibrato.
      <b>Leave a full bar of silence.</b> Then answer up in Box 4 and land on the root on the G string.
      Same idea, two landmarks — this is what using both shapes actually sounds like, and it's four
      seconds of music, not an exercise.</p></div>`);
  }
  if(state.reg&&R===baseFret())c.unshift(`<p class="tip stayed" style="grid-column:1/-1">Standard position — Box 1 and Box 4 are taught as a pair and the slide runs travel between them, so they share one position, and in ${k} minor the pair has no room to move ${state.reg<0?"an octave lower":"an octave higher"}. Each box on its own does move: see <b>5 boxes</b>.</p>`);
  // all-keys reference
  let rows="";
  for(let i=0;i<12;i++){
    const base=((i-OPEN[5]+12)%12)||12, low=base-12;
    rows+=`<tr${i===state.key?' class="me"':''}><td>${NOTES[i]}m</td><td>${base}\u2013${base+3}</td>`
        +`<td>${base+7}\u2013${base+10}</td>`
        +`<td>${low>=0?`${low}\u2013${low+3}`:"\u2014"}</td>`
        +`<td>${low+7>=0?`${low+7}\u2013${low+10}`:"\u2014"}</td></tr>`;}
  c.push(`<div class="card"><h2>All twelve keys<em>where the landmarks sit</em></h2>
    <table><thead><tr><th>Key</th><th>Box 1</th><th>Box 4</th><th>Box 1 low</th><th>Box 4 low</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="tip">The last two columns are the same shapes twelve frets lower, where they still fit on the
    neck. Find the root on the 6th string for Box 1 and on the 5th string for Box 4 and you never need
    this table again — but it's a useful check while the root positions are still going in.</p></div>`);
  host.innerHTML=c.join("");
}

// ---------- all-keys landmark chart ----------
// Solid colours rather than low-opacity ink. Ink at 22% over the cream paper lands
// around 1.5:1 contrast — technically drawn, practically invisible. Every value here
// clears 3:1 against the paper (4.5:1 for text), measured, not eyeballed.
//
// The rest of the scale is held back by *form* rather than by lightness: hollow rings
// against the solid box dots. Lightness alone could not do it — the blue and any grey
// dark enough to see sit at nearly the same luminance, so one would have swallowed the
// other. Hollow-versus-solid survives that, and survives colour blindness too.
const CH_SCALE="#5D5F65";   // the rest of the scale — drawn as rings   5.6:1
const CH_GRID="#888A90";    // fret wires                              3.0:1
const CH_STR="#5D5F65";     // strings                                 5.6:1
const CH_MARK="#7E8086";    // inlay markers                           3.5:1
const CH_TEXT="#4E5056";    // fret numbers and string names           7.0:1
const CH_GOLD="#A87A00";    // Box 4 — the app gold is only 2.0:1 here  3.4:1
function keyStrip(ki,{w=25,h=11,pad=16,last=22,big=false}={}){
  const base=((ki-OPEN[5]+12)%12)||12;
  const W=pad+(last+1)*w+4, H=pad+5*h+15;
  const nAt=(st,f)=>(OPEN[st]+f)%12;
  const posns=[];
  [[0,"b1"],[3,"b4"]].forEach(([bi,tag])=>{
    for(let sh=-24;sh<=24;sh+=12){
      const R=base+sh, fl=BOXES[bi].off.flat();
      if(Math.min(...fl)+R>=0&&Math.max(...fl)+R<=last)posns.push({bi,tag,R});}});
  let o=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${NOTES[ki]} minor landmark positions">`;
  // fret grid
  for(let i=0;i<=last+1;i++){const x=pad+i*w;
    o+=`<line x1="${x}" y1="${pad}" x2="${x}" y2="${pad+5*h}" stroke="${i===0?"var(--ink)":CH_GRID}" stroke-width="${i===0?3:.9}"/>`;}
  for(let r=0;r<6;r++)o+=`<line x1="${pad}" y1="${pad+r*h}" x2="${pad+(last+1)*w}" y2="${pad+r*h}" stroke="${CH_STR}" stroke-width="${.6+r*.18}"/>`;
  [3,5,7,9,15,17,19,21].forEach(f=>o+=`<circle cx="${pad+(f-.5)*w}" cy="${pad+2.5*h}" r="${big?3:1.9}" fill="${CH_MARK}"/>`);
  [12].forEach(f=>{o+=`<circle cx="${pad+(f-.5)*w}" cy="${pad+1.5*h}" r="${big?3:1.9}" fill="${CH_MARK}"/>`;
    o+=`<circle cx="${pad+(f-.5)*w}" cy="${pad+3.5*h}" r="${big?3:1.9}" fill="${CH_MARK}"/>`;});
  // the rest of the scale — the neck is continuous, the boxes are just slices of it.
  // Grey and smaller than the box dots, but solidly drawn: recessive, not invisible.
  for(let st=0;st<6;st++)for(let f=0;f<=last;f++){
    if(!isScale(nAt(st,f)))continue;
    const cx=f===0?pad-6:pad+(f-.5)*w;
    o+=`<circle cx="${cx}" cy="${pad+st*h}" r="${big?4.2:2.4}" fill="var(--paper)" stroke="${CH_SCALE}" stroke-width="${big?1.5:1.1}"/>`;}
  // zone shading
  posns.forEach(pn=>{const fl=BOXES[pn.bi].off.flat(),a=Math.min(...fl)+pn.R,b=Math.max(...fl)+pn.R;
    o+=`<rect x="${pad+Math.max(a-1,0)*w}" y="${pad}" width="${(b-Math.max(a-1,0))*w}" height="${5*h}" fill="${pn.tag==="b1"?"var(--blue)":CH_GOLD}" opacity=".13"/>`;});
  // dots
  posns.forEach(pn=>BOXES[pn.bi].off.forEach((pr,st)=>pr.forEach(off=>{
    const f=off+pn.R, cx=f===0?pad-6:pad+(f-.5)*w, cy=pad+st*h;
    const root=nAt(st,f)===ki;
    o+=`<circle cx="${cx}" cy="${cy}" r="${big?(root?8:6.5):(root?4.2:3.2)}" fill="${root?"var(--pink)":pn.tag==="b1"?"var(--blue)":CH_GOLD}"/>`;
    if(root)o+=`<circle cx="${cx}" cy="${cy}" r="${big?11:6}" fill="none" stroke="var(--pink)" stroke-width="${big?1.6:1}"/>`;
    if(big)o+=`<text x="${cx}" y="${cy+3.2}" font-size="8" font-weight="500" font-family="DM Mono,monospace" text-anchor="middle" fill="var(--card)">${IV[deg(nAt(st,f))]}</text>`;})));
  // slide connectors: Box 1 -> Box 4 at each position where both fit
  posns.filter(pn=>pn.tag==="b1"&&posns.some(q=>q.tag==="b4"&&q.R===pn.R)).forEach(pn=>{
    const X=f=>f===0?pad-6:pad+(f-.5)*w;
    RUN_UP.forEach(([st,o1,to])=>{
      const cy=pad+st*h,f=o1+pn.R;
      o+=`<circle cx="${X(f)}" cy="${cy}" r="${big?5:2.6}" fill="var(--pink)"/>`;
      if(to!==undefined){const f2=to+pn.R;
        const g=big?9:4,hd=big?13:8;
        o+=`<circle cx="${X(f2)}" cy="${cy}" r="${big?5:2.6}" fill="var(--pink)"/>`;
        o+=`<line x1="${X(f)+g}" y1="${cy}" x2="${X(f2)-hd}" y2="${cy}" stroke="var(--pink)" stroke-width="${big?2.6:1.5}"/>`;
        o+=`<polygon points="${X(f2)-g+1},${cy} ${X(f2)-hd},${cy-(big?5:3)} ${X(f2)-hd},${cy+(big?5:3)}" fill="var(--pink)"/>`;}});});
  // labels
  posns.forEach(pn=>{const fl=BOXES[pn.bi].off.flat(),a=Math.min(...fl)+pn.R,b=Math.max(...fl)+pn.R;
    o+=`<text x="${pad+((a+b)/2-.5)*w}" y="${pad+5*h+(big?15:11)}" font-size="${big?11:8}" font-family="DM Mono,monospace" text-anchor="middle" fill="${pn.tag==="b1"?"var(--blue)":CH_GOLD}" font-weight="600">${pn.tag==="b1"?1:4}\u00b7${a}</text>`;});
  o+=`<text x="4" y="${pad-5}" font-size="${big?12:9.5}" font-family="DM Mono,monospace" fill="${CH_TEXT}">0</text>`;
  (big?[3,5,7,9,12,15,17,19,21]:[5,12,17]).forEach(f=>o+=`<text x="${pad+(f-.5)*w}" y="${pad-5}" font-size="${big?12:9.5}" font-family="DM Mono,monospace" text-anchor="middle" fill="${f===12?"var(--ink)":CH_TEXT}" font-weight="${f===12?600:400}">${f}</text>`);
  if(big)for(let r=0;r<6;r++)o+=`<text x="${pad-9}" y="${pad+r*h+4}" font-size="11" font-family="DM Mono,monospace" text-anchor="middle" fill="${CH_TEXT}">${SL[r]}</text>`;
  return o+"</svg>";
}
function renderChart(){
  document.getElementById("chart").innerHTML=NOTES.map((n,i)=>{
    const open=i===state.chartOpen;
    return `<div class="card strip${i===state.key?" now":""}${open?" open":""}" data-key="${i}" tabindex="0" role="button" aria-expanded="${open}">
       <h2>${n} minor<em>${open?"tap to close":"tap to enlarge"}</em></h2>
       ${open?keyStrip(i,{w:46,h:26,pad:26,big:true}):keyStrip(i)}
       ${open?`<p class="tip">Dots are labelled with scale degrees. <b style="color:var(--blue)">Blue = Box 1</b>,
         <b style="color:#A87A00">gold = Box 4</b>, pink is the slide run between them, and the
         <b style="color:#5D5F65">grey rings are the rest of the scale</b> — hollow rather than filled, but
         every one of them is a note you can play. This key is now loaded into every other view.</p>`:""}</div>`;}).join("");
  document.querySelectorAll("#chart .strip").forEach(c=>{
    const go=()=>{const i=+c.dataset.key;state.chartOpen=(state.chartOpen===i)?null:i;
      if(state.chartOpen!==null){state.key=i;stopDrone();
        }
      render();
      const el=document.querySelector("#chart .strip.open");
      if(el)el.scrollIntoView({block:"nearest",behavior:"smooth"});};
    c.onclick=go;c.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();go();}};});
}
// ---------- crossing drills ----------
function oneString(s){
  const last=MAXFRET,cells=[];
  for(let f=0;f<=last;f++){const pc=noteAt(s,f);if(isScale(pc))cells.push({f:String(f),d:IV[deg(pc)]});}
  const w=cells.map(c=>Math.max(c.f.length,c.d.length));
  return SL[s]+"|"+cells.map((c,i)=>"-"+c.f.padEnd(w[i],"-")+"-").join("")+"|\n"
       +"  "+cells.map((c,i)=>" "+c.d.padEnd(w[i]," ")+" ").join("");
}
function zoneTab(a,b,R=groupRoot(a,b)){
  const ev=[];
  for(let s=5;s>=0;s--){ev.push([s,a.off[s][0]],[s,a.off[s][1]]);}
  ev.push([0,b.off[0][1],"/"]);
  for(let s=1;s<=5;s++){ev.push([s,b.off[s][1]],[s,b.off[s][0]]);}
  return tab(ev,R);
}
function motifTab(){
  const ev=[];
  validBoxes().forEach(b=>ev.push([1,b.off[1][0]],[1,b.off[1][1]],[0,b.off[0][0]],[0,b.off[0][1]]));
  return tab(ev).split("\n").filter(r=>/\d/.test(r)).join("\n");
}
function renderCross(){
  const c=[];
  c.push({t:"1 · One string, whole neck",e:"say the degrees aloud",
    body:`<pre>${oneString(0)}\n\n${oneString(1)}\n\n${oneString(5)}</pre>`,
    tip:"The whole neck laid flat, nut to fret 24 — this one is the same in every register, because it already contains all of them. Play each line low to high naming the degree out loud, then back down. This kills the habit of thinking in blocks — the boxes are arbitrary slices of this one line."});
  [0,1,2,3].forEach(i=>{
    const a=BOXES[i],b=BOXES[i+1],R=groupRoot(a,b);
    c.push({t:`2 · Zone ${a.n}+${b.n}`,e:`fret ${Math.min(...a.off.flat())+R}–${Math.max(...b.off.flat())+R}`,
      body:`<pre>${zoneTab(a,b,R)}</pre>`,
      tip:`Up through Box ${a.n}, slide at the shared note on the high e, down through Box ${b.n}. Then reverse the whole thing. Ascending, the shared note is your pinky in Box ${a.n} and your first finger in Box ${b.n} — slide up <b>into</b> it with the first finger and you arrive already in position. Move on when the pair feels like one shape.`});});
  c.push({t:"3 · One motif, five positions",e:"same four notes, all night",
    body:`<pre>${motifTab()}</pre>`,
    tip:"Four notes on the top two strings, played in every box. Same rhythm every time. Note there's no slide marked — the shift happens as you cross back down to the B string, and <b>a position change made while moving across strings is inaudible</b>. That's the trick behind position changes you can't hear. This drill forces the crossings to happen under musical pressure instead of as an exercise."});
  const db=BOXES[0],dbs=boxSpan(db);
  const doors=boxNotes(db,dbs.R).map(n=>({...n,kind:"pivot",ring:noteAt(n.s,n.f)===state.key}));
  c.push({t:"4 · Every note is a door",e:`Box ${db.n}, fret ${dbs.lo}–${dbs.hi}`,
    body:fretboard(doors,{w:46}),
    tip:"Each string in a box holds two notes: the lower one is shared with the box below, the upper one with the box above. So <b>every note you play is already a doorway</b>. Drill: drone on, wander in the box above, and shift position the moment you hit the ♭7 — land on a root or chord tone straight after, and the move sounds deliberate instead of lost. Shift in the gaps between phrases, never mid-run."});
  document.getElementById("cross").innerHTML=c.map(x=>
    `<div class="card"><h2>${x.t}<em>${x.e}</em></h2>${x.body}<p class="tip">${x.tip}</p></div>`).join("");
}

// ---------- practice ----------
function newQuiz(){
  const vs=validBoxes(),b=vs[Math.floor(Math.random()*vs.length)],t=[0,3,5,7,10][Math.floor(Math.random()*5)];
  const notes=boxNotes(b);
  state.quiz={box:b,target:t,total:notes.filter(n=>deg(noteAt(n.s,n.f))===t).length,found:0,wrong:0,notes};
  document.getElementById("quizboard").innerHTML=fretboard(notes,{w:46,quiz:true});
  document.getElementById("quizstatus").innerHTML=
    `Box ${b.n}, key ${NOTES[state.key]} minor — tap every <b>${IV[t]}</b> (${NOTES[(state.key+t)%12]}). 0 of ${state.quiz.total}.`;
  document.querySelectorAll("#quizboard .qn").forEach(g=>{
    const hit=()=>answer(g);
    g.addEventListener("click",hit);
    g.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();hit();}});});
}
function answer(g){
  if(g.dataset.done||state.quiz.found===state.quiz.total)return;
  const pc=+g.dataset.pc,c=g.querySelector("circle"),t=g.querySelector("text"),st=document.getElementById("quizstatus");
  if(deg(pc)===state.quiz.target){
    g.dataset.done=1;state.quiz.found++;c.setAttribute("fill","var(--pink)");t.textContent=IV[state.quiz.target];
    st.innerHTML=state.quiz.found===state.quiz.total
      ? `All ${state.quiz.total} found${state.quiz.wrong?` with ${state.quiz.wrong} miss${state.quiz.wrong>1?"es":""}`:" clean"}. Now play them, lowest to highest, saying <b>${IV[state.quiz.target]}</b> out loud.`
      : `Tap every <b>${IV[state.quiz.target]}</b> (${NOTES[(state.key+state.quiz.target)%12]}). ${state.quiz.found} of ${state.quiz.total}.`;
  }else{
    state.quiz.wrong++;c.setAttribute("fill","var(--gold)");
    setTimeout(()=>c.setAttribute("fill","var(--blue)"),320);
    st.innerHTML=`That one's the <b>${IV[deg(pc)]}</b>. Still looking for the ${IV[state.quiz.target]} — ${state.quiz.found} of ${state.quiz.total}.`;
  }
}
const POOL=[...BOXES.map(b=>`<b>Box ${b.n}</b> — two notes per string, up and back, eyes off the neck`),
  ...LICKS.map(l=>`<b>${l.t}</b> (${l.e}) — slow, then one notch faster`),
  "<b>Box 1 → Box 2</b> — same lick, both positions, slide between them",
  "<b>B.B. box</b> — one note, vibrato only, thirty seconds",
  "<b>Root spotting</b> — find every root on the neck in this key, low to high"];
function newSession(){
  const p=[...POOL].sort(()=>Math.random()-.5).slice(0,3);
  document.getElementById("session").innerHTML=
    [`Warm up: root drone on, ${NOTES[state.key]} minor, wander for 3 min`,...p.map(x=>x+" — 5 min"),
     "Interleave: cycle back through all three once more, 4 min",
     "Record one take over the drone. Listen once. Stop."].map(x=>`<li>${x}</li>`).join("");
}

// ---------- guided routines, from the practice guide ----------
const SONGPROJ={t:"“Zombie” — The Cranberries",prog:"| Em | C | G | D |",
  goal:"Play the whole song without restarting. Start with a simplified rhythm, keep the structure, and only add accurate detail once a complete pass is stable."};
const FOCUS=["Learn complete songs instead of isolated parts.",
  "Master the five minor-pentatonic boxes.",
  "Recognise and target root notes.",
  "Connect adjacent positions across the neck.",
  "Become comfortable soloing above the 12th fret.",
  "Apply the patterns in E, B, A and G minor."];
const ROUTINES=[
 {n:1,t:"E minor above the 12th fret",len:25,
  goal:"Establish Box 1 up at the 12th fret, identify its roots, and begin learning the complete song.",
  seg:[
   {a:0,b:4,t:"Song-based warm-up",
    d:"One bar of each chord — <b>| Em | C | G | D |</b> — in steady eighth-note downstrokes at <b>70 bpm</b>. Fretting hand relaxed. Every change happens without stopping, mistakes included."},
   {a:4,b:11,t:"Box 1, up and down",lick:"Box 1, both directions",
    d:"Slowly, both directions. Pause slightly on every root and say the note name aloud. You are building a map of destinations, not a finger pattern."},
   {a:11,b:16,t:"Connect toward Box 2",lick:"Reach into Box 2",
    d:"Four times through, then improvise an ending that lands on a root. The 17th fret on the B string is the door into Box 2, and it is a root."},
   {a:16,b:23,t:"Begin the complete song",
    d:"<b>Em–C–G–D</b> continuously. Verse restrained, chorus with a stronger attack and wider strum, then back to the verse without stopping. Listen to the recording and write a section map: intro, verses, choruses, instrumental passages, ending. Treat it as a whole-song project."},
   {a:23,b:25,t:"Musical application",
    d:"Loop one bar of Em and one bar of C. Improvise in Box 1 and end every two-bar phrase on a root."}],
  done:["Box 1 up and down twice without stopping.",
    "Name all three roots in the box.",
    "The connecting phrase four clean times.",
    "The progression held through a quiet verse and a loud chorus without losing the beat."]},
 {n:2,t:"Connect Boxes 1 and 2",len:25,
  goal:"Stop treating Box 1 as an island, and complete a simplified uninterrupted pass of the song.",
  seg:[
   {a:0,b:3,t:"Rhythm warm-up",
    d:"<b>| Em | C | G | D |</b> at 70 bpm, three rounds: one downstroke per beat, then steady eighths, then a quiet verse followed by a forceful chorus. <b>Keep going through mistakes.</b>"},
   {a:3,b:9,t:"Box 2, up and down",lick:"Box 2, both directions",
    d:"Four times each way. Pause on both roots and name them. Box 2 has two roots where Box 1 had three."},
   {a:9,b:15,t:"Travel into Box 2",lick:"The diagonal route",
    d:"Start on the Box 1 root on the low E and climb the diagonal until you are inside Box 2. Descend and stop on the Box 2 root on the D string. It works when you can <b>see</b> the position change, not when you can remember the fingering."},
   {a:15,b:19,t:"Make the connection musical",lick:"Call and answer across the boxes",
    d:"Over a backing track: bar one in Box 1, bar two in Box 2, final note on a root. Leave space after it. Repeat, then change the rhythm while keeping the destination."},
   {a:19,b:25,t:"Whole-song pass",
    d:"Use the section map and play the song start to finish. Priorities, in order: <b>do not restart</b>; verses quieter than choruses; if a change fails, rejoin on the next bar; finish the ending deliberately instead of trailing off."}],
  done:["One uninterrupted pass of the song.",
    "The diagonal route twice without hesitation.",
    "Both Box 2 roots landed on accurately."]}];
const CHECKLIST=["Play Box 1 cleanly in both directions.",
  "Play Box 2 cleanly in both directions.",
  "Identify the roots without checking the diagrams.",
  "Move from Box 1 to Box 2 through the diagonal route.",
  "Create a short phrase that crosses the position boundary.",
  "Complete the song with simplified rhythm and no restart.",
  "Preserve the contrast between quiet verses and strong choruses."];
const CHECK_KEY="minor-pentatonic-guide-checklist-v1";
// Stored data is read back defensively: anything on this origin can write it, and a
// wrong shape must not stop the view from drawing.
function readChecks(){try{const v=JSON.parse(window.localStorage.getItem(CHECK_KEY)||"[]");
  return Array.isArray(v)?v.map(Boolean):[];}catch(e){return [];}}
function writeChecks(v){try{window.localStorage.setItem(CHECK_KEY,JSON.stringify(v));}catch(e){}}

function renderGuide(){
  const k=NOTES[state.key],done=readChecks();
  const g=[];
  g.push(`<div class="card"><h2>Song project<em>the point of all of it</em></h2>
    <p class="tip" style="font-size:15px;margin:0 0 6px"><b>${SONGPROJ.t}</b></p>
    <pre>${SONGPROJ.prog}</pre>
    <p class="tip">${SONGPROJ.goal}</p>
    <p class="tip"><b>Working principle:</b> don't rush to collect all five boxes. Make each new position
    musical, connect it to one you already know, and use it inside a complete-song routine.</p></div>`);
  g.push(`<div class="card"><h2>Long-term focus<em>where this is going</em></h2>
    <ol>${FOCUS.map(f=>`<li>${f}</li>`).join("")}</ol>
    <div class="row" style="margin-top:10px"><span class="lbl">Work in</span>${
      GUIDEKEYS.map(i=>`<button class="guidekey" data-k="${i}"${i===state.key?' aria-pressed="true"':''}>${NOTES[i]}m</button>`).join("")}</div>
    <p class="tip">The exercises below are written relative to the root, so they move with the key. Set the
    key to <b>Em</b> and the tabs read exactly as the guide has them, at the 12th fret.</p></div>`);
  ROUTINES.forEach(r=>{
    g.push(`<div class="card wide"><h2>Practice ${r.n} — ${r.t}<em>${r.len} minutes</em></h2>
      <p class="tip"><b>Main goal:</b> ${r.goal}</p>
      <ol class="routine">${r.seg.map(sg=>`<li>
        <div class="seghead"><b>${String(sg.a).padStart(2,"0")}:00–${String(sg.b).padStart(2,"0")}:00 · ${sg.t}</b>
          <button class="segrun" data-min="${sg.b-sg.a}">${sg.b-sg.a} min →</button></div>
        <span class="tip">${sg.d}</span>
        ${sg.lick?`<span class="tip" style="opacity:.7">Tab and diagram: <b>${sg.lick}</b>, in the Licks view.</span>`:""}
      </li>`).join("")}</ol>
      <p class="tip"><b>Finish condition — ${r.done.length===1?"":"all "}${r.done.length} of these:</b></p>
      <ol>${r.done.map(d=>`<li>${d}</li>`).join("")}</ol></div>`);});
  g.push(`<div class="card wide"><h2>Progress<em>stored on this device</em></h2>
    <ul class="checklist">${CHECKLIST.map((c,i)=>
      `<li><label><input type="checkbox" class="gchk" data-i="${i}"${done[i]?" checked":""}> ${c}</label></li>`).join("")}</ul>
    <div class="status" id="checkstatus">${done.filter(Boolean).length} of ${CHECKLIST.length} complete</div>
    <div class="row" style="margin-top:8px"><button id="clearchecks">Reset</button></div></div>`);
  const host=document.getElementById("guide");host.innerHTML=g.join("");
  host.querySelectorAll(".segrun").forEach(b=>b.onclick=()=>{
    setTimer(+b.dataset.min);toggleTimer();
    const tf=document.getElementById("timerface");
    if(tf.scrollIntoView)tf.scrollIntoView({block:"nearest",behavior:"smooth"});});
  host.querySelectorAll(".guidekey").forEach(b=>b.onclick=()=>{
    state.key=+b.dataset.k;stopDrone();state.blueLock=null;
    render();});
  host.querySelectorAll(".gchk").forEach(b=>b.onchange=()=>{
    const v=readChecks();v[+b.dataset.i]=b.checked;writeChecks(v);renderGuide();});
  const cc=host.querySelector("#clearchecks");
  if(cc)cc.onclick=()=>{writeChecks([]);renderGuide();};
}

// The evidence and limitations remain readable without JavaScript. JavaScript only
// adds the two private, device-local song-project fields from the source program.
const ARRANGEMENT_KEY="minor-pentatonic-arrangements-v1";
const emptyArrangement=()=>({a:"",fa:"",b:"",fb:""});
function readArrangement(){
  try{
    const v=JSON.parse(window.localStorage.getItem(ARRANGEMENT_KEY)||"null");
    return v&&["a","fa","b","fb"].every(k=>typeof v[k]==="string")?v:emptyArrangement();
  }catch(e){return emptyArrangement();}}
function writeArrangement(v){
  try{window.localStorage.setItem(ARRANGEMENT_KEY,JSON.stringify(v));return true;}
  catch(e){return false;}}
function renderTheory(){
  const v=readArrangement();
  for(const [id,k] of [["theory-song-a","a"],["theory-form-a","fa"],["theory-song-b","b"],["theory-form-b","fb"]])
    document.getElementById(id).value=v[k];
  document.getElementById("save-arrangements").onclick=()=>{
    const saved={a:document.getElementById("theory-song-a").value.trim(),
      fa:document.getElementById("theory-form-a").value.trim(),
      b:document.getElementById("theory-song-b").value.trim(),
      fb:document.getElementById("theory-form-b").value.trim()};
    document.getElementById("arrangement-status").textContent=writeArrangement(saved)
      ?"Song projects saved on this device.":"Browser storage is unavailable; copy these notes before closing.";};}

// ---------- focused practice tools ----------
function timerText(n){return String(Math.floor(n/60)).padStart(2,"0")+":"+String(n%60).padStart(2,"0");}
function paintTimer(){document.getElementById("timerface").textContent=timerText(state.timerSeconds);}
function setTimer(minutes){stopTimer();state.timerInitial=state.timerSeconds=minutes*60;paintTimer();
  document.getElementById("timerstatus").textContent=`Ready for ${minutes} focused minute${minutes===1?"":"s"}.`;
  document.querySelectorAll(".timerpreset").forEach(b=>b.setAttribute("aria-pressed",+b.dataset.min===minutes));}
function stopTimer(){if(state.timerHandle){clearInterval(state.timerHandle);state.timerHandle=null;}
  const b=document.getElementById("toggletimer");if(b){b.textContent="Start";b.setAttribute("aria-pressed",false);}}
function timerCue(){const a=audio();if(!a)return;a.blip(880,{dur:.35,vol:.18});}
function toggleTimer(){if(state.timerHandle){stopTimer();document.getElementById("timerstatus").textContent="Paused — your time is preserved.";return;}
  if(state.timerSeconds===0)state.timerSeconds=state.timerInitial;
  const b=document.getElementById("toggletimer");b.textContent="Pause";b.setAttribute("aria-pressed",true);
  document.getElementById("timerstatus").textContent="Focus on one thing until the cue.";
  state.timerHandle=setInterval(()=>{state.timerSeconds=Math.max(0,state.timerSeconds-1);paintTimer();if(state.timerSeconds===0){stopTimer();timerCue();
    markToday();renderToday();
    document.getElementById("timerstatus").innerHTML="Time. <b>Stop, breathe, and name what improved.</b>";}},1000);}
function resetTimer(){stopTimer();state.timerSeconds=state.timerInitial;paintTimer();document.getElementById("timerstatus").textContent="Reset and ready.";}
function ladder(delta){state.bpm=Math.max(40,Math.min(220,state.bpm+delta));state.ladderRound++;
  document.getElementById("bpm").value=state.bpm;document.getElementById("bpmv").textContent=state.bpm+" bpm";
  document.getElementById("ladderbpm").textContent=state.bpm;restartClick();
  document.getElementById("ladderstatus").innerHTML=`Round ${state.ladderRound} · ${delta>0?"clean — keep the motion relaxed":"miss — rebuild cleanly"}`;}
function resetLadder(){state.bpm=state.ladderStart;state.ladderRound=1;document.getElementById("bpm").value=state.bpm;
  document.getElementById("bpmv").textContent=state.bpm+" bpm";document.getElementById("ladderbpm").textContent=state.bpm;
  document.getElementById("ladderstatus").textContent="Round 1 · starting tempo";restartClick();}
const LOG_KEY="minor-pentatonic-practice-log-v1";
function readLog(){try{const v=JSON.parse(window.localStorage.getItem(LOG_KEY)||"[]");
  return Array.isArray(v)?v.filter(x=>x&&typeof x==="object"):[];}catch(e){return [];}}
function writeLog(log){try{window.localStorage.setItem(LOG_KEY,JSON.stringify(log));}catch(e){}}
function renderLog(){const log=readLog(),host=document.getElementById("loglist");
  document.getElementById("logsummary").innerHTML=log.length?`<b>${log.length}</b> completed session${log.length===1?"":"s"} logged.`:"No completed sessions yet.";
  host.innerHTML=log.slice(0,8).map(x=>`<li><span>${escapeHTML(x.date)}</span><span>${escapeHTML(x.key)} minor · ${Number(x.bpm)||0} bpm</span></li>`).join("");}
// Log entries come back from localStorage, which anything on this origin can write.
function escapeHTML(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);}
function completeSession(){const log=readLog(),date=new Date().toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"});
  log.unshift({date,key:NOTES[state.key],bpm:state.bpm});writeLog(log.slice(0,30));markToday();renderLog();renderToday();
  document.getElementById("logsummary").innerHTML=`Logged today’s <b>${NOTES[state.key]} minor</b> session at ${state.bpm} bpm.`;}
function clearLog(){writeLog([]);renderLog();}


// ---------- ear drill and the day's plan ----------
// Shapes are learned by eye; this ties them to sound. The root plays, then one note of the
// minor pentatonic; you name its degree by ear. Misses are drawn more often. Everything
// stays in this browser.
const EAR_KEY="minor-pentatonic-ear-v1", DAYS_KEY="minor-pentatonic-days-v1";
const EAR_DEGREES=[[0,"1","root"],[3,"♭3","minor third"],[5,"4","fourth"],[7,"5","fifth"],[10,"♭7","minor seventh"]];
function readEar(){try{const v=JSON.parse(window.localStorage.getItem(EAR_KEY)||"{}");const o={};
  for(const [d] of EAR_DEGREES){const x=v&&v[d];o[d]=Array.isArray(x)&&Number.isFinite(x[0])&&Number.isFinite(x[1])&&x[0]>=0&&x[1]>=x[0]?[x[0],x[1]]:[0,0];}
  return o;}catch(e){const o={};for(const [d] of EAR_DEGREES)o[d]=[0,0];return o;}}
function writeEar(v){try{window.localStorage.setItem(EAR_KEY,JSON.stringify(v));}catch(e){/* this visit only */}}
const dayKey=d=>{const p=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;};
function readDays(){try{const v=JSON.parse(window.localStorage.getItem(DAYS_KEY)||"[]");
  return Array.isArray(v)?v.filter(x=>typeof x==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(x)):[];}catch(e){return [];}}
function markToday(){const t=dayKey(new Date()),d=readDays();if(d.includes(t))return;
  d.push(t);try{window.localStorage.setItem(DAYS_KEY,JSON.stringify(d.sort().slice(-400)));}catch(e){/* this visit only */}}
// Days in a row ending today (or yesterday, so the streak survives until you've practised today).
function streakOf(days,today=new Date()){
  const set=new Set(days);let d=new Date(today.getFullYear(),today.getMonth(),today.getDate());
  if(!set.has(dayKey(d)))d.setDate(d.getDate()-1);
  let n=0;while(set.has(dayKey(d))){n++;d.setDate(d.getDate()-1);}
  return n;
}
// Best run of consecutive days in the record.
function bestStreak(days){
  const s=[...new Set(days)].sort();let best=0,run=0,prev=null;
  for(const k of s){const [y,m,d]=k.split("-").map(Number),t=Date.UTC(y,m-1,d);
    run=prev!==null&&t-prev===864e5?run+1:1;prev=t;if(run>best)best=run;}
  return best;
}
// Encouraging, never guilt: celebrate what you did, and treat a gap as a fresh start.
function streakMessage(days,today=new Date()){
  const n=streakOf(days,today),done=days.includes(dayKey(today)),best=bestStreak(days);
  if(!days.length)return "Every player starts with one day. Play a little today and your streak begins.";
  if(!n)return best>1?`Welcome back! Your best run is ${best} days, and you already know you can do it. Play today to start a new one.`
    :"Welcome back! A short session today starts a fresh streak.";
  const milestone={3:"Three days: a habit is forming.",7:"A full week! Your fingers are learning.",14:"Two weeks. This is real progress.",30:"A month of playing. Remarkable."}[n];
  const head=`<b>${n}</b> day${n===1?"":"s"} in a row`;
  const tail=milestone||(done?"Nice work today.":"Play today to keep it going.");
  return `${head}. ${tail}${n>=best&&n>1&&!milestone?" That's your best yet!":n<best?` Your best is ${best}.`:""}`;
}
// The degree to ask next: unseen or weak ones weigh more.
function earPick(stats,rnd=Math.random){
  const w=EAR_DEGREES.map(([d])=>{const [r,t]=stats[d];return t<3?3:1+4*(1-r/t);});
  let x=rnd()*w.reduce((a,b)=>a+b,0);
  for(let i=0;i<w.length;i++){x-=w[i];if(x<0)return EAR_DEGREES[i][0];}
  return EAR_DEGREES[EAR_DEGREES.length-1][0];
}
function earPlay(withRoot=true){
  if(!state.ear)return;const root=48+state.key;
  if(withRoot)pluck(root,0,.8,.5);
  pluck(root+state.ear.degree+(state.ear.up?12:0),withRoot?.9:0,.8,.55);
}
function earNew(){
  state.ear={degree:earPick(readEar()),up:Math.random()<.5,done:false};
  document.getElementById("earstatus").textContent="Listen: which degree is it?";
  earPlay(true);
}
function earAnswer(d){
  if(!state.ear||state.ear.done)return;
  const stats=readEar(),right=d===state.ear.degree;
  stats[state.ear.degree][1]++;if(right)stats[state.ear.degree][0]++;
  writeEar(stats);markToday();state.ear.done=true;
  const name=EAR_DEGREES.find(x=>x[0]===state.ear.degree);
  const note=NOTES[(state.key+state.ear.degree)%12];
  document.getElementById("earstatus").innerHTML=right
    ?`Yes: <b>${name[1]}</b>, ${note}. Now find it on your guitar.`
    :`It was <b>${name[1]}</b> (${name[2]}), ${note}. Hear it again, then find it on your guitar.`;
  renderEar();renderToday();
}
function renderEar(){
  const s=readEar();
  document.getElementById("earbtns").innerHTML=EAR_DEGREES.map(([d,l])=>`<button data-ear="${d}">${l}</button>`).join("");
  document.querySelectorAll("#earbtns button[data-ear]").forEach(b=>b.onclick=()=>earAnswer(+b.dataset.ear));
  document.getElementById("earstats").innerHTML=EAR_DEGREES.map(([d,l,n])=>{const [r,t]=s[d];
    return `<li><span>${l} · ${n}</span><span>${t?Math.round(100*r/t)+"% of "+t:"not tried"}</span></li>`;}).join("");
}
// What to do next, from what this browser knows: whether you have played today, the stage
// you are on, and the drills with a score to beat (lick tempos, chord changes, bends).
// Five items at most, so it stays a plan and not a list of everything.
function todayAdvice(){
  const items=[],days=readDays(),log=readLog(),now=currentStage();
  const go=(v,t)=>` <button data-goto="${v}">${t}</button>`;
  if(!days.includes(dayKey(new Date())))items.push("Practise today: even five minutes keeps the habit.");
  items.push("Tune up before you play: a guitar a little out of tune makes every bend sound wrong."+go("tune","Tuner"));
  if(now&&state.view!=="path")items.push(`You are on stage ${now.n}, <b>${now.t}</b>.`+go("path","Start here"));
  const lick=lickToPush();
  if(lick)items.push(`Push <b>${lick.t}</b>: clean at ${lick.bpm} bpm on ${escapeHTML(shortDate(lick.d))}. Start there, then try ${Math.min(220,lick.bpm+5)}.`+
    ` <button data-bpm="${lick.bpm}">Set ${lick.bpm} bpm</button>`);
  else if(now&&now.n>=5)items.push("Pick three licks and save the tempo you can play each one cleanly at."+go("licks","Licks"));
  const ch=typeof readChanges==="function"?readChanges():{},pairs=Object.entries(ch).filter(([,r])=>r.length);
  if(pairs.length){const [k,r]=pairs.sort((a,b)=>a[1][0].d<b[1][0].d?-1:1)[0];
    items.push(`One-minute changes: beat <b>${changesBest(r)}</b> on ${k.replace("-"," ↔ ")}.`);}
  else if(!now||now.n<=2)items.push("One-minute changes: two chords, one minute, count the changes."+go("practice","Practice"));
  const bends=(typeof readBends==="function"?readBends():[]).filter(x=>x.by).slice(0,10);
  if(bends.length)items.push(`Bends: ${bends.filter(x=>x.verdict==="in tune").length} of your last ${bends.length} landed in tune.`+go("tune","Check more"));
  else if(now&&now.n>=4)items.push("Check five bends against the target before you play."+go("tune","Bend check"));
  const s=readEar(),tried=EAR_DEGREES.filter(([d])=>s[d][1]>=5).sort((a,b)=>s[a[0]][0]/s[a[0]][1]-s[b[0]][0]/s[b[0]][1]);
  if(tried.length&&s[tried[0][0]][0]/s[tried[0][0]][1]<.8)items.push(`Your weakest sound is <b>${tried[0][1]}</b> (${tried[0][2]}): hum it over the root drone, then play it.`);
  const seen=new Set(log.map(x=>x.key));const unseen=NOTES.filter((n,i)=>!seen.has(n)&&i!==state.key);
  if(log.length&&unseen.length)items.push(`Take your box shapes to a new key: <b>${unseen[0]}</b> minor.`);
  items.push("Record one take and listen back once: it shows what practice can't.");
  return items.slice(0,5);
}
function renderToday(){
  document.getElementById("todaystreak").innerHTML=streakMessage(readDays());
  document.getElementById("todaylist").innerHTML=todayAdvice().map(x=>`<li><span>${x}</span></li>`).join("");
  wireGoto("#todaylist");
  const ps=document.getElementById("pathstreak");
  if(ps&&state.view==="path")renderPath();
}

// ---------- lick tempos ----------
// The tempo you last played each lick cleanly at, so a session starts where the last one
// left off instead of from nothing: {lick title: [{bpm, d}], newest first}.
const LICK_TEMPO_KEY="minor-pentatonic-lick-tempos-v1";
function readLickTempos(){try{const v=JSON.parse(window.localStorage.getItem(LICK_TEMPO_KEY)||"{}"),o={};
  if(v&&typeof v==="object")LICKS.forEach(l=>{const r=v[l.t];
    if(Array.isArray(r))o[l.t]=r.filter(x=>x&&Number.isInteger(x.bpm)&&x.bpm>=40&&x.bpm<=220&&typeof x.d==="string").slice(0,12);});
  return o;}catch(e){return {};}}
function saveLickTempo(i){const l=LICKS[i];if(!l)return null;
  const v=readLickTempos(),r=v[l.t]||[];
  v[l.t]=[{bpm:state.bpm,d:dayKey(new Date())},...r].slice(0,12);
  try{window.localStorage.setItem(LICK_TEMPO_KEY,JSON.stringify(v));}catch(e){/* this visit only */}
  markToday();return v[l.t];}
// The lick you have a tempo for but have left longest.
function lickToPush(){const v=readLickTempos(),have=Object.entries(v).filter(([,r])=>r.length);
  if(!have.length)return null;
  const [t,r]=have.sort((a,b)=>a[1][0].d<b[1][0].d?-1:a[1][0].d>b[1][0].d?1:0)[0];
  return {t,bpm:r[0].bpm,d:r[0].d};}
function lickTempoLine(l){const r=readLickTempos()[l.t]||[];
  if(!r.length)return "No clean tempo saved yet. Start slow enough to play it perfectly.";
  const best=Math.max(...r.map(x=>x.bpm)),last=r[0];
  return `Clean at <b>${last.bpm} bpm</b> on ${escapeHTML(shortDate(last.d))}${best>last.bpm?`, best ${best}`:""}${
    r.length>1?` · ${r.slice(0,5).reverse().map(x=>x.bpm).join(" → ")}`:""}.`;}

// ---------- the backing band ----------
// The trainer's beats drive web/band.js: each beat the trainer books, the band
// books its drums and bass for, at fractions of that beat on the same audio clock.
// Its parts play into their own gains on the engine's master bus, so a take with
// backing records the band. The compatibility engine has no bus to give it, so
// there the trainer keeps its chord stabs.
const BAND_KEY="practice-desk-band";
// The mixer: a volume and an on/off per part, so you can drop the bass or the rhythm
// guitar and play that part yourself.
// Practice modes for the trainer, applied each chorus: how many choruses (0: loop
// forever), a tempo ladder, a key cycle, and a drill (drop-out bars or trade fours).
function bandPracticeDefaults(){return {choruses:0,ladder:false,ladderTo:140,keys:"",drill:""};}
function bandMixDefaults(){return {drums:{vol:.8,on:true},bass:{vol:.8,on:true},keys:{vol:.55,on:true},guitar:{vol:.55,on:true}};}
// The band on its own peaked near full scale in Chrome; this sits it about 4 dB
// down, under your guitar, with room for the rest of the desk's sounds.
const BAND_LEVEL=.6;
function readBand(){
  try{const v=JSON.parse(window.localStorage.getItem(BAND_KEY)||"null");
    if(!v||typeof v!=="object")return;
    if(typeof v.on==="boolean")state.band.on=v.on;
    if(typeof v.swing==="number"&&v.swing>=.5&&v.swing<=.75)state.band.swing=v.swing;
    if(v.bass==="walk"||v.bass==="root5")state.band.bass=v.bass;
    if(typeof v.ride==="boolean")state.band.ride=v.ride;
    if(v.mix&&typeof v.mix==="object")Object.keys(state.band.mix).forEach(p=>{
      const m=v.mix[p];if(!m||typeof m!=="object")return;
      if(typeof m.vol==="number"&&m.vol>=0&&m.vol<=1)state.band.mix[p].vol=m.vol;
      if(typeof m.on==="boolean")state.band.mix[p].on=m.on;});
    const pr=v.practice,P=state.band.practice;
    if(pr&&typeof pr==="object"){
      if([0,1,2,4,8].includes(pr.choruses))P.choruses=pr.choruses;
      if(typeof pr.ladder==="boolean")P.ladder=pr.ladder;
      if(Number.isInteger(pr.ladderTo)&&pr.ladderTo>=45&&pr.ladderTo<=220)P.ladderTo=pr.ladderTo;
      if(["","fourth","random"].includes(pr.keys))P.keys=pr.keys;
      if(["","dropout","fours"].includes(pr.drill))P.drill=pr.drill;}}
  catch(e){/* nothing stored, or unreadable: keep the defaults */}}
function writeBand(){try{window.localStorage.setItem(BAND_KEY,JSON.stringify(state.band));}catch(e){/* this visit only */}}
const bandReady=()=>typeof Band!=="undefined"&&Band&&typeof Band.beatEvents==="function";
function bandStart(){
  bandStop();
  const a=audio();
  if(state.band.on&&a&&!a.bus&&typeof a.clip==="function"&&bandReady()&&typeof Band.renderChorus==="function"){
    state.bandCompat=true;
    document.getElementById("bandstatus").textContent="Compatibility sound: the band plays a chorus rendered in advance, "
      +"so it keeps looser time than usual, and any change you make is heard from the next chorus.";
    return;}
  if(!state.band.on||!a||!a.bus||!a.context||!bandReady())return;
  const out=a.bus(),parts={};
  out.gain.value=BAND_LEVEL;
  Object.keys(state.band.mix).forEach(p=>{parts[p]=a.context.createGain();parts[p].connect(out);});
  state.bandRig={out,parts,ac:a.context,voices:Band.createVoices(a.context,parts)};
  applyBandMix();}
// Muting turns a part's gain down rather than leaving it out of the score, so the
// band's timing is the same whichever parts you hear.
function applyBandMix(){
  const r=state.bandRig;if(!r)return;
  Object.entries(state.band.mix).forEach(([p,m])=>{if(r.parts[p])r.parts[p].gain.value=m.on?m.vol:0;});}
// Silence what is already booked with a quick fade on the band's own bus, then let
// it go; the next start builds a fresh one.
function bandStop(){
  if(state.bandClip){state.bandClip.stop();state.bandClip=null;}
  if(state.bandCompat){state.bandCompat=false;document.getElementById("bandstatus").textContent="";}
  const r=state.bandRig;
  if(!r)return;
  state.bandRig=null;
  try{const t=r.ac.currentTime;r.out.gain.setValueAtTime(r.out.gain.value||1,t);r.out.gain.linearRampToValueAtTime(0,t+.06);}
  catch(e){/* already gone */}
  setTimeout(()=>{try{r.out.disconnect();}catch(e){/* already gone */}},200);}
// One beat of the band, when seconds from now.
function bandBeat(when,o){
  const r=state.bandRig;if(!r)return;
  const beatSec=60/state.bpm,t0=r.ac.currentTime+when;
  Band.beatEvents({feel:document.getElementById("groove").value,swing:state.band.swing,bass:state.band.bass,
    ride:state.band.ride,beatSec,...o}).forEach(e=>{if(!o.only||e.part===o.only)r.voices.play(e,t0+e.at*beatSec);});}
// The band on the compatibility engine: the whole chorus, rendered with the same score
// and started on each bar 1 by the trainer's own timer. Rendered per key, tempo, feel,
// mix and drill; the engine keeps the last few.
function chorusBeats(form){
  const beatSec=60/state.bpm,feel=document.getElementById("groove").value,beats=[];
  const fours=state.band.practice.drill==="fours";
  for(let bar=0;bar<12;bar++){
    if(state.dropBars.includes(bar))continue;
    const entry=form.chords[bar],split=barSymbols(entry).length>1;
    for(let beat=0;beat<4;beat++){
      const c=chordInfo(symbolAt(entry,beat));
      const events=Band.beatEvents({feel,swing:state.band.swing,bass:state.band.bass,ride:state.band.ride,beatSec,beat,
        step:split&&beat>=2?beat-2:beat,chord:{pc:(state.key+c.root)%12,intervals:c.intervals}})
        .filter(e=>!(fours&&bar>=4&&bar<=7)||e.part==="drums").map(e=>({...e,atSec:e.at*beatSec}));
      beats.push({events,at:(bar*4+beat)*beatSec});}}
  return {beats,seconds:48*beatSec+.5};}
function playCompatChorus(){
  const a=audio();if(!a||typeof a.clip!=="function")return;
  if(state.bandClip)state.bandClip.stop();
  const form=currentForm(),mix={};
  Object.entries(state.band.mix).forEach(([p,m])=>{mix[p]=m.on?m.vol:0;});
  const key=["band",document.getElementById("bluesform").value,state.key,state.bpm,document.getElementById("groove").value,
    state.band.swing.toFixed(3),state.band.bass,state.band.ride,JSON.stringify(mix),state.band.practice.drill,state.dropBars.join(",")].join("|");
  state.bandClip=a.clip(key,()=>{const {beats,seconds}=chorusBeats(form);
    return Band.renderChorus({beats,seconds,sampleRate:a.sampleRate||22050,mix,level:BAND_LEVEL});});}
// The tempo readout and slider, without restarting anything (the ladder changes tempo
// mid-run; setBpm is for a person changing it).
function showBpm(v){document.getElementById("bpm").value=v;document.getElementById("bpmv").textContent=v+" bpm";}
// A new chorus is starting, when seconds from now. Applies the practice modes; false
// means the last chorus has been played and nothing more should be booked.
function startChorus(when,first){
  const P=state.band.practice;
  if(!first){
    if(P.choruses&&state.trainerChorus>P.choruses){
      state.trainerEnding=true;
      atBeat(when,()=>{if(state.trainerTimer)stopTrainer();});
      return false;}
    if(P.ladder&&state.bpm<P.ladderTo){const v=Math.min(P.ladderTo,state.bpm+5);state.bpm=v;atBeat(when,()=>showBpm(v));}
    if(P.keys==="fourth")state.key=(state.key+5)%12;
    // a different key every time: one of the other eleven
    else if(P.keys==="random")state.key=(state.key+1+Math.floor(Math.random()*11))%12;
    if(P.keys)atBeat(when,render);}
  // two bars alone, somewhere after bar 1 — a different place each chorus
  state.dropBars=P.drill==="dropout"?(b=>[b,b+1])(1+Math.floor(Math.random()*10)):[];
  return true;}
// What the readout adds for a practice mode, in bar (0–11).
function practiceNote(bar){
  const P=state.band.practice,parts=[];
  if(state.dropBars.includes(bar))parts.push("band out: keep time");
  else if(P.drill==="fours"&&bar>=4&&bar<=7)parts.push("your four");
  if(P.choruses)parts.push(`chorus ${Math.min(state.trainerChorus,P.choruses)} of ${P.choruses}`);
  else if(state.trainerChorus>1)parts.push(`chorus ${state.trainerChorus}`);
  return parts.length?" · "+parts.join(" · "):"";}
// Tap tempo: the average of the last few taps, if they come steadily enough.
function tapTempo(now=Date.now()){
  const taps=state.taps.filter(t=>now-t<2500);taps.push(now);state.taps=taps.slice(-6);
  if(state.taps.length<2)return null;
  const gaps=state.taps.slice(1).map((t,i)=>t-state.taps[i]);
  const bpm=Math.round(60000/(gaps.reduce((a,b)=>a+b,0)/gaps.length));
  if(bpm<40||bpm>220)return null;
  setBpm(bpm);return bpm;}
function setBpm(v){
  state.bpm=v;
  const s=document.getElementById("bpm");s.value=v;
  document.getElementById("bpmv").textContent=v+" bpm";
  restartClick();}
function renderBandControls(){
  const feel=document.getElementById("groove").value,swingable=!bandReady()||!Band.FEELS[feel]||Band.FEELS[feel].swing;
  const sw=document.getElementById("swing"),pct=Math.round(state.band.swing*100);
  sw.value=String(pct);sw.disabled=!swingable;
  document.getElementById("swingv").textContent=!swingable?"built into 12/8"
    :pct===50?"50% · straight":pct===67?"67% · triplet feel":pct===75?"75% · hard shuffle":pct+"%";
  document.getElementById("bandon").setAttribute("aria-pressed",state.band.on);
  document.getElementById("bandbass").value=state.band.bass;
  document.getElementById("bandride").checked=state.band.ride;
  const P=state.band.practice;
  document.getElementById("choruses").value=String(P.choruses);
  document.getElementById("ladderon").checked=P.ladder;
  document.getElementById("ladderto").value=String(P.ladderTo);
  document.getElementById("keycycle").value=P.keys;
  document.getElementById("drill").value=P.drill;
  Object.entries(state.band.mix).forEach(([p,m])=>{
    document.getElementById("mix"+p).setAttribute("aria-pressed",m.on);
    document.getElementById("mix"+p+"v").value=String(Math.round(m.vol*100));});}

// ---------- 12-bar blues trainer ----------
// A form is twelve bars. A bar is one chord symbol, or a pair of them when the
// change falls halfway through — bebop and Bird blues need that, and writing it as
// ["IIm7","V7"] keeps the twelve-bar grid honest instead of stretching it to 24.
//
// Symbols are roman numerals so a form transposes to whatever key is selected.
// Everything here is a standard, widely taught skeleton; players substitute freely,
// and recordings of the same tune often differ from the textbook shape.
const BLUES_FORMS={
  // ---- the core shuffle forms ----
  classic:{name:"Classic dominant",family:"Core forms",
    chords:["I7","I7","I7","I7","IV7","IV7","I7","I7","V7","IV7","I7","V7"],
    tip:"The foundational dominant form: four bars home, two on IV, then the V–IV–I turnaround.",
    heard:"The default twelve bars, under more early blues, jump and rock and roll than any other shape."},
  quick:{name:"Quick change",family:"Core forms",
    chords:["I7","IV7","I7","I7","IV7","IV7","I7","I7","V7","IV7","I7","V7"],
    tip:"Bar 2 visits IV immediately. Hear that early answer, then recognize the familiar turnaround at bar 9.",
    heard:"Also called the quick four. Standard in Chicago and Texas shuffles."},
  ending:{name:"Final-chorus ending",family:"Core forms",
    chords:["I7","IV7","I7","I7","IV7","IV7","I7","I7","V7","IV7","I7","I7"],
    tip:"The same form with bar 12 resolved to I instead of V. This is how you stop: V in bar 12 sends you round again, I lands.",
    heard:"Use it on the last chorus of anything above. Practise switching between this and the looping version."},
  stoptime:{name:"Stop-time verse",family:"Core forms",
    chords:["I7","I7","I7","I7","I7","I7","I7","I7","V7","IV7","I7","V7"],
    tip:"Eight bars of one chord, then the last four move. With no chord changes to lean on, phrasing and rhythm carry the whole first half.",
    heard:"The riff-and-stop pattern behind Hoochie Coochie Man and its many descendants."},

  // ---- turnaround variants ----
  iiv:{name:"ii–V turnaround",family:"Turnarounds",
    chords:["I7","I7","I7","I7","IV7","IV7","I7","I7","IIm7","V7","I7","V7"],
    tip:"Bars 9–10 become ii–V instead of V–IV. A smoother, more harmonic pull home — the first step from blues towards jazz phrasing.",
    heard:"The usual choice when a blues sits in a swing or jazz set."},
  onesixtwofive:{name:"I–VI–ii–V turnaround",family:"Turnarounds",
    chords:["I7","IV7","I7","I7","IV7","IV7","I7","I7","V7","IV7",["I7","VI7"],["IIm7","V7"]],
    tip:"The last two bars split into four chords, each lasting two beats. Practise the turnaround alone until the changes stop surprising you.",
    heard:"Everywhere in jazz and soul blues; the same four chords also drive countless doo-wop tunes."},
  jump:{name:"Jump blues (VI7 in bar 8)",family:"Turnarounds",
    chords:["I7","IV7","I7","I7","IV7","IV7","I7","VI7","IIm7","V7","I7","V7"],
    tip:"Bar 8 lifts to VI7, which sets up ii–V across bars 9–10. The second half becomes a chord progression rather than a plateau.",
    heard:"The swing and jump-blues shape — big-band blues and the Kansas City style."},

  // ---- jazz forms ----
  dim:{name:"Diminished passing chord",family:"Jazz forms",
    chords:["I7","IV7","I7","I7","IV7","#IVdim7","I7","I7","IIm7","V7","I7","V7"],
    tip:"Bar 6 rises chromatically through a diminished chord on the way back to I. One new chord, and the whole form sounds jazzier.",
    heard:"The gateway substitution: the smallest change that turns a blues into a jazz blues."},
  jazz:{name:"Bebop blues",family:"Jazz forms",
    chords:["I7","IV7","I7",["Vm7","I7"],"IV7","#IVdim7","I7","VI7","IIm7","V7",["I7","VI7"],["IIm7","V7"]],
    tip:"Bar 4 sets up IV with its own ii–V, bar 6 takes the diminished chord, and the turnaround runs I–VI–ii–V. Follow the chord tones, not one scale shape.",
    heard:"The standard bebop skeleton — Billie's Bounce, Now's the Time, Straight, No Chaser."},
  bird:{name:"Bird blues",family:"Jazz forms",
    chords:["Imaj7",["VIIm7b5","III7"],["VIm7","II7"],["Vm7","I7"],"IV7",["IVm7","bVII7"],["IIIm7","VI7"],["bIIIm7","bVI7"],"IIm7","V7",["Imaj7","VI7"],["IIm7","V7"]],
    tip:"A blues rewritten as a chain of ii–V pairs descending to IV, then back by half steps. The twelve-bar shape survives; almost every chord is new.",
    heard:"Charlie Parker's Blues for Alice changes. The hardest form here — learn the bebop blues first."},

  // ---- minor forms ----
  minor:{name:"Minor blues",family:"Minor forms",
    chords:["Im7","Im7","Im7","Im7","IVm7","IVm7","Im7","Im7","V7","IVm7","Im7","V7"],
    tip:"Minor i and iv darken the form; the dominant V in bars 9 and 12 creates the pull back home.",
    heard:"Keep V dominant rather than minor — that major third is what makes the turnaround pull."},
  minorquick:{name:"Minor, quick change",family:"Minor forms",
    chords:["Im7","IVm7","Im7","Im7","IVm7","IVm7","Im7","Im7","V7","IVm7","Im7","V7"],
    tip:"The minor form with iv in bar 2. Same early answer as the quick change, in the darker key.",
    heard:"Common in minor slow blues, where bar 2 gives the singer somewhere to go."},
  minorbvi:{name:"Minor with ♭VI–V",family:"Minor forms",
    chords:["Im7","Im7","Im7","Im7","IVm7","IVm7","Im7","Im7","bVI7","V7","Im7","V7"],
    tip:"Bars 9–10 step down ♭VI–V instead of V–iv. That half-step fall is the signature sound of the modern minor blues.",
    heard:"The shape behind The Thrill Is Gone and most minor blues written since."},

  // ---- rock ----
  rock:{name:"Rock blues (♭VII)",family:"Rock forms",
    chords:["I7","I7","I7","I7","IV7","IV7","I7","I7","bVII7","IV7","I7","I7"],
    tip:"♭VII replaces V in bar 9, so the second half falls ♭VII–IV–I rather than pulling V–IV–I. Mixolydian rather than dominant-blues.",
    heard:"The riff-rock reading of the twelve bars; ♭VII–IV–I is the same cadence heard all over rock."},
};
const CHORD_KIND={
  "":[0,4,7], "m":[0,3,7], "6":[0,4,7,9],
  "7":[0,4,7,10], "m7":[0,3,7,10], "maj7":[0,4,7,11],
  "m7b5":[0,3,6,10], "dim7":[0,3,6,9],
};
// A bar holds one chord or two; these two make the rest of the code stop caring.
const barSymbols=entry=>Array.isArray(entry)?entry:[entry];
// In a split bar the second chord takes over on beat 3.
const symbolAt=(entry,beat)=>{const s=barSymbols(entry);return s.length>1&&beat>=2?s[1]:s[0];};
function currentForm(){return BLUES_FORMS[document.getElementById("bluesform").value]||BLUES_FORMS.classic;}
function chordInfo(symbol){const roman=symbol.match(/^[b#]?[IV]+/)[0],kind=symbol.slice(roman.length),
  roots={I:0,bII:1,II:2,bIII:3,III:4,IV:5,"#IV":6,V:7,bVI:8,VI:9,bVII:10,VII:11};
  return {symbol,root:roots[roman],kind,intervals:CHORD_KIND[kind]};}
function chordName(symbol){const c=chordInfo(symbol);return NOTES[(state.key+c.root)%12]+c.kind;}
// bar and beat default to the live position; the beat clock passes the ones being
// drawn, because it books beats slightly before they sound.
function renderTrainer(bar=state.trainerBar,beat=state.trainerBeat){const form=currentForm();
  document.getElementById("bluesbars").innerHTML=form.chords.map((entry,i)=>{
    const syms=barSymbols(entry);
    return `<div class="bluesbar${i===bar?" now":""}${syms.length>1?" split":""}"><span>${i+1}</span>${
      syms.map(sym=>`<b>${chordName(sym)}</b>`).join("")}<span>${syms.join(" ")}</span></div>`;}).join("");
  const entry=bar<0?form.chords[0]:form.chords[bar];
  const symbol=symbolAt(entry,bar<0?0:beat),c=chordInfo(symbol),roles=["root","3rd","5th","7th"];
  const targets=c.intervals.map((x,i)=>`${roles[i]} (${NOTES[(state.key+c.root+x)%12]})`).join(" · ");
  document.getElementById("trainertarget").innerHTML=`Target tones for <b>${chordName(symbol)}</b>: ${targets}`;
  document.getElementById("formtip").textContent=form.tip;
  document.getElementById("formheard").textContent=form.heard;
  document.getElementById("trainerreadout").textContent=bar<0?"ready":`bar ${bar+1} · beat ${beat+1}`+practiceNote(bar);}
function trainerSound(symbol,beat,when=0){
  const a=audio();if(!a)return;
  const c=chordInfo(symbol),pc=(state.key+c.root)%12,groove=document.getElementById("groove").value;
  const hzs=c.intervals.map((iv,i)=>freq((pc+iv)%12)*(i?1:.5));
  const hold=groove==="slow"?.38:.1;
  a.chord(hzs,{when,dur:hold,vol:beat===0?.06:.032});
  if(groove==="shuffle")a.chord(hzs,{when:when+(60/state.bpm)*2/3,dur:hold,vol:.018});}
function trainerTick(when=0){const form=currentForm();
  if(state.trainerEnding)return;
  if(state.trainerCount>0){const text=`count in · ${5-state.trainerCount}`;
    if(state.bandRig)bandBeat(when,{countIn:true,beat:4-state.trainerCount});
    else trainerSound(symbolAt(form.chords[0],0),4-state.trainerCount,when);
    state.trainerCount--;
    atBeat(when,()=>{if(state.trainerTimer)document.getElementById("trainerreadout").textContent=text;});return;}
  if(state.trainerBar<0){state.trainerBar=0;state.trainerChorus=1;startChorus(when,true);}
  else if(state.trainerBar===0&&state.trainerBeat===0){state.trainerChorus++;if(!startChorus(when,false))return;}
  const bar=state.trainerBar,beat=state.trainerBeat;
  if(bar===0&&beat===0)recOnBarOne(when);
  if(beat===0)drillBar(when);
  // a split bar's second chord arrives on beat 3, and its line starts from the root there
  const entry=form.chords[bar],split=barSymbols(entry).length>1,c=chordInfo(symbolAt(entry,beat));
  const chord={pc:(state.key+c.root)%12,intervals:c.intervals},chordKey=chord.pc+":"+c.kind;
  if(chordKey!==state.liveChordKey){
    state.liveChordKey=chordKey;
    atBeat(when,()=>{state.liveChord=chord;if(state.chord==="band"&&state.view!=="trainer")render();});}
  const drop=state.dropBars.includes(bar),fours=state.band.practice.drill==="fours"&&bar>=4&&bar<=7;
  if(drop){/* the band is out: you keep time */}
  else if(state.bandRig)bandBeat(when,{beat,step:split&&beat>=2?beat-2:beat,chord,only:fours?"drums":null});
  else if(state.bandCompat){if(bar===0&&beat===0)atBeat(when,()=>{if(state.trainerTimer&&state.bandCompat)playCompatChorus();});}
  else if(!fours)trainerSound(symbolAt(entry,beat),beat,when);
  atBeat(when,()=>{if(state.trainerTimer)renderTrainer(bar,beat);});
  state.trainerBeat++;if(state.trainerBeat===4){state.trainerBeat=0;state.trainerBar=(state.trainerBar+1)%12;}}
function stopTrainer(){if(state.trainerTimer){clearInterval(state.trainerTimer);state.trainerTimer=null;}
  bandStop();state.trainerEnding=false;state.liveChordKey="";
  if(state.rec&&state.rec.fromTrainer)stopRecording();const b=document.getElementById("toggletrainer");
  if(b){b.textContent="Start with count-in";b.setAttribute("aria-pressed",false);}}
function toggleTrainer(){if(state.trainerTimer){stopTrainer();return;}state.trainerCount=4;state.trainerBar=-1;state.trainerBeat=0;
  const b=document.getElementById("toggletrainer");b.textContent="Stop";b.setAttribute("aria-pressed",true);
  markToday();bandStart();state.trainerEnding=false;state.trainerChorus=0;state.dropBars=[];state.liveChordKey="";
  state.trainerTimer=beatLoop(()=>60/state.bpm,trainerTick);}
function resetTrainer(){stopTrainer();state.trainerBar=-1;state.trainerBeat=0;state.trainerCount=4;renderTrainer();}

// ---------- rhythm and phrasing generator ----------
function generateRhythm(){stopRhythm();const density=document.getElementById("density").value,prob={sparse:.24,medium:.4,busy:.62}[density];
  state.rhythm=Array.from({length:16},(_,i)=>i===0?1:(Math.random()<prob?1:0));state.rhythmStep=0;renderRhythm();return state.rhythm;}
function renderRhythm(now=state.rhythmStep){const syllables=["1","e","&","a","2","e","&","a","3","e","&","a","4","e","&","a"];
  document.getElementById("beatgrid").innerHTML=state.rhythm.map((hit,i)=>`<div class="beat${hit?" hit":""}${state.rhythmTimer&&i===now?" now":""}">${hit?syllables[i]:"·"}</div>`).join("");
  const hits=state.rhythm.reduce((a,b)=>a+b,0);document.getElementById("rhythmcount").innerHTML=`${hits} attacks · ${16-hits} rests · <b>count the rests too</b>`;
  document.getElementById("rhythmroot").textContent=NOTES[state.key];document.getElementById("rhythmtip").innerHTML=
    `At ${state.bpm} bpm, one loop lasts ${(240/state.bpm).toFixed(1)} seconds. Accent beats 2 and 4 without changing the written rhythm.`;}
function rhythmSound(accent,when=0){const a=audio();if(!a)return;a.blip(accent?1100:720,{when,dur:.045,vol:.16});}
function rhythmTick(when=0){const step=state.rhythmStep;
  if(state.rhythm[step])rhythmSound(step===4||step===12,when);
  atBeat(when,()=>{if(state.rhythmTimer)renderRhythm(step);});
  state.rhythmStep=(state.rhythmStep+1)%16;}
function stopRhythm(){if(state.rhythmTimer){clearInterval(state.rhythmTimer);state.rhythmTimer=null;}const b=document.getElementById("togglerhythm");
  if(b){b.textContent="Play loop";b.setAttribute("aria-pressed",false);}}
function toggleRhythm(){if(state.rhythmTimer){stopRhythm();renderRhythm();return;}state.rhythmStep=0;const b=document.getElementById("togglerhythm");
  b.textContent="Stop";b.setAttribute("aria-pressed",true);state.rhythmTimer=beatLoop(60/state.bpm/4,rhythmTick);}

// ---------- audio ----------
// The app asks for musical events — a note, a click, a chord strike, a drone — and a
// backend decides how to produce them. Nothing above this section touches an
// AudioContext or an <audio> element directly.
//
//   webAudioEngine  synthesises live. Preferred: low latency, sample-accurate
//                   scheduling, true polyphony.
//   wavEngine       renders each distinct sound to PCM once, caches it as a data: URI
//                   and plays it through an <audio> element. Coarser timing, but it
//                   needs nothing beyond HTMLAudioElement — which is what makes it
//                   work under Safari's Lockdown Mode, where AudioContext is withheld.
//
// Both satisfy the same interface:
//   name, state(), resume(), note(midi,opt), blip(hz,opt), chord(hzs,opt),
//   startDrone(hzs) -> {stop()}, stopAll()
// webAudioEngine also offers tap(node)/untap(node): everything it plays passes one
// master gain, and a tap copies that mix to another node — the recorder's way in.

const freq = pc => 110 * Math.pow(2, (pc - 9) / 12);
const STRING_MIDI = [64, 59, 55, 50, 45, 40];   // high e first, standard tuning
const midiAt = (s, f) => STRING_MIDI[s] + f;
const midiFreq = m => 440 * Math.pow(2, (m - 69) / 12);

// ---- backend 1: Web Audio ----
function webAudioEngine(ac) {
  const at = when => ac.currentTime + when;
  const master = ac.createGain();
  master.connect(ac.destination);
  // one plucked string: two detuned saws plus an octave, through a falling low-pass
  const voice = (f, t, dur, vol) => {
    const g = ac.createGain(), lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(Math.min(9000, f * 9), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(220, f * 2.2), t + dur);
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(.2 * vol, t + .012);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    lp.connect(g); g.connect(master);
    [[1, 0], [1.003, -4], [2, -9]].forEach(([ratio, db]) => {
      const o = ac.createOscillator(), og = ac.createGain();
      o.type = "sawtooth"; o.frequency.value = f * ratio;
      og.gain.value = Math.pow(10, db / 20);
      o.connect(og); og.connect(lp); o.start(t); o.stop(t + dur + .05);
    });
  };
  const ping = (hz, t, dur, vol, type) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || "sine"; o.frequency.value = hz;
    o.connect(g); g.connect(master);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(.001, t + dur);
    o.start(t); o.stop(t + dur + .02);
  };
  return {
    name: "Web Audio",
    context: ac,
    now: () => ac.currentTime,
    tap: node => master.connect(node),
    // A gain into the master bus, for a player with its own mixer (the band).
    bus: () => { const g = ac.createGain(); g.connect(master); return g; },
    untap: node => { try { master.disconnect(node); } catch (e) { /* never connected */ } },
    state: () => ac.state,
    resume: () => (ac.state === "suspended" ? ac.resume() : Promise.resolve()),
    note(m, { when = 0, dur = .55, vol = .5 } = {}) { voice(midiFreq(m), at(when), dur, vol); },
    blip(hz, { when = 0, dur = .05, vol = .22 } = {}) { ping(hz, at(when), dur, vol); },
    chord(hzs, { when = 0, dur = .1, vol = .06 } = {}) {
      const t = at(when);
      hzs.forEach((hz, i) => ping(hz, t, dur, vol / (i + 1), i ? "triangle" : "sine"));
    },
    startDrone(hzs) {
      const g = ac.createGain();
      g.gain.value = .0001; g.connect(master);
      g.gain.exponentialRampToValueAtTime(.09, ac.currentTime + .6);
      const nodes = hzs.map((f, i) => {
        const o = ac.createOscillator();
        o.type = i === 1 ? "triangle" : "sine"; o.frequency.value = f;
        const og = ac.createGain(); og.gain.value = i === 0 ? 1 : .28;
        o.connect(og); og.connect(g); o.start(); return o;
      });
      // Fade out rather than cut: stopping a sine mid-cycle is an audible click.
      return { stop() {
        const t = ac.currentTime;
        if (g.gain.cancelScheduledValues) g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(Math.max(g.gain.value || .09, .0001), t);
        g.gain.exponentialRampToValueAtTime(.0001, t + .08);
        nodes.forEach(n => { try { n.stop(t + .1); } catch (e) { /* already stopped */ } });
      } };
    },
    stopAll() { /* voices stop themselves; nothing is held open */ },
  };
}

// 16-bit PCM WAV, in two parts so a long take can be written a chunk at a time: the
// 44-byte header, which needs only the total size, and the samples. The compatibility
// engine renders its sounds through wavBytes; the recorder streams its master through
// pcm16 into storage and puts wavHeader in front when you download it.
function wavHeader(dataBytes, ch, sampleRate, bits = 16) {
  const bytes = bits / 8;
  const v = new DataView(new ArrayBuffer(44));
  const tag = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  tag(0, "RIFF"); v.setUint32(4, 36 + dataBytes, true); tag(8, "WAVE");
  tag(12, "fmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, ch, true);                        // PCM
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * ch * bytes, true);
  v.setUint16(32, ch * bytes, true); v.setUint16(34, bits, true);             // 16- or 24-bit
  tag(36, "data"); v.setUint32(40, dataBytes, true);
  return new Uint8Array(v.buffer);
}
// One Float32Array per channel to interleaved 16-bit samples. Int16Array uses the
// platform's byte order, which is little-endian on every machine a browser runs on
// — the order WAV wants.
function pcm16(channels) {
  const ch = channels.length, n = channels[0].length, out = new Int16Array(n * ch);
  for (let i = 0, k = 0; i < n; i++)
    for (let c = 0; c < ch; c++, k++) {
      const x = Math.max(-1, Math.min(1, channels[c][i]));
      out[k] = x < 0 ? x * 0x8000 : x * 0x7FFF;
    }
  return out;
}
// 24-bit: three little-endian bytes a sample. Kept for a master that will be edited:
// the extra 8 bits are headroom, so a quiet take can be raised without its hiss.
function pcm24(channels) {
  const ch = channels.length, n = channels[0].length, out = new Uint8Array(n * ch * 3);
  for (let i = 0, k = 0; i < n; i++)
    for (let c = 0; c < ch; c++, k += 3) {
      const x = Math.max(-1, Math.min(1, channels[c][i]));
      const v = Math.trunc(x < 0 ? x * 0x800000 : x * 0x7FFFFF);
      out[k] = v & 0xFF; out[k + 1] = (v >> 8) & 0xFF; out[k + 2] = (v >> 16) & 0xFF;
    }
  return out;
}
function wavBytes(channels, sampleRate) {
  const pcm = pcm16(channels), out = new Uint8Array(44 + pcm.byteLength);
  out.set(wavHeader(pcm.byteLength, channels.length, sampleRate));
  out.set(new Uint8Array(pcm.buffer), 44);
  return out;
}

// ---- backend 2: rendered WAV through <audio> ----
function wavEngine() {
  // Each distinct sound (pitch x length x volume) is rendered once and kept as a
  // data: URI. Tempo and key changes keep minting new ones, so the cache is bounded:
  // a Map iterates in insertion order, so re-inserting on use and dropping the
  // first key evicts the least recently used sound.
  const SR = 22050, MAX_CACHED = 200, cache = new Map(), playing = new Set();
  const MAX_CLIPS = 4, clips = new Map();

  const toBase64 = bytes => {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const toWav = samples => "data:audio/wav;base64," + toBase64(wavBytes([samples], SR));

  // Additive synthesis, band-limited by construction: partials above Nyquist are
  // simply never summed, so there is no aliasing to filter out afterwards.
  const pluckPCM = (f, dur, vol) => {
    const n = Math.max(1, Math.round(SR * dur)), out = new Float32Array(n), parts = [];
    for (let k = 1; k <= 12; k++) {
      const hz = f * k;
      if (hz > SR * .45) break;
      parts.push([hz * 2 * Math.PI / SR, 1 / k, 4.2 + k * 1.1]);  // higher partials die sooner
    }
    for (let i = 0; i < n; i++) {
      const t = i / SR, attack = 1 - Math.exp(-t * 350);
      let x = 0;
      for (let j = 0; j < parts.length; j++) {
        const p = parts[j];
        x += p[1] * Math.exp(-t * p[2]) * Math.sin(p[0] * i);
      }
      out[i] = x * attack * vol * .38;
    }
    return out;
  };
  const pingPCM = (hz, dur, vol) => {
    const n = Math.max(1, Math.round(SR * dur)), out = new Float32Array(n), w = hz * 2 * Math.PI / SR;
    const decay = 3 / dur;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      out[i] = Math.sin(w * i) * Math.exp(-t * decay) * (1 - Math.exp(-t * 800)) * vol;
    }
    return out;
  };
  const chordPCM = (hzs, dur, vol) => {
    const n = Math.max(1, Math.round(SR * dur)), out = new Float32Array(n), decay = 4 / dur;
    hzs.forEach((hz, j) => {
      const w = hz * 2 * Math.PI / SR, amp = vol / (j + 1);
      for (let i = 0; i < n; i++) out[i] += Math.sin(w * i) * Math.exp(-(i / SR) * decay) * amp;
    });
    return out;
  };
  // A loop only joins silently if every partial completes a whole number of cycles in
  // the buffer. Pick the length first, then take the fundamental that fits it exactly —
  // the resulting detune is far under a cent, and the seam is inaudible.
  const dronePCM = hzs => {
    const cycles = Math.max(8, Math.round(hzs[0] / 2));
    const n = Math.max(1, Math.round(SR * cycles / hzs[0]));
    const f0 = SR * cycles / n;
    const out = new Float32Array(n);
    hzs.forEach((hz, j) => {
      const w = f0 * Math.round(hz / hzs[0]) * 2 * Math.PI / SR, amp = j === 0 ? .09 : .026;
      for (let i = 0; i < n; i++) out[i] += Math.sin(w * i) * amp;
    });
    return out;
  };

  const uri = (key, build) => {
    let u = cache.get(key);
    if (u) cache.delete(key); else u = toWav(build());
    cache.set(key, u);
    if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value);
    return u;
  };
  const sound = (key, build, { when = 0, loop = false, volume = 1 } = {}) => {
    const start = () => {
      const el = new Audio(uri(key, build));
      el.loop = loop;
      el.volume = Math.max(0, Math.min(1, volume));
      playing.add(el);
      if (!loop) el.addEventListener("ended", () => playing.delete(el));
      const p = el.play();
      if (p && p.catch) p.catch(() => { /* a refused play must not break the caller */ });
      return el;
    };
    if (when <= 0) return start();
    let el = null;
    const id = setTimeout(() => { el = start(); }, when * 1000);
    return { get el() { return el; }, cancel() { clearTimeout(id); } };
  };
  const release = el => {
    if (!el) return;
    try { el.pause(); el.src = ""; } catch (e) { /* nothing to release */ }
    playing.delete(el);
  };

  return {
    name: "Compatibility",
    state: () => "running",
    resume: () => Promise.resolve(),
    note(m, { when = 0, dur = .55, vol = .5 } = {}) {
      const q = Math.round(dur * 20) / 20;   // quantise so the cache actually hits
      sound(`n:${m}:${q}`, () => pluckPCM(midiFreq(m), q, 1), { when, volume: Math.min(1, vol * 1.6) });
    },
    blip(hz, { when = 0, dur = .05, vol = .22 } = {}) {
      const q = Math.round(dur * 100) / 100;
      sound(`b:${Math.round(hz)}:${q}`, () => pingPCM(hz, Math.max(q, .05), 1), { when, volume: Math.min(1, vol * 2.4) });
    },
    chord(hzs, { when = 0, dur = .1, vol = .06 } = {}) {
      const q = Math.round(dur * 50) / 50;
      const key = "c:" + hzs.map(h => Math.round(h)).join(",") + ":" + q;
      sound(key, () => chordPCM(hzs, Math.max(q, .08), 1), { when, volume: Math.min(1, vol * 5) });
    },
    startDrone(hzs) {
      const key = "d:" + hzs.map(h => Math.round(h)).join(",");
      const el = sound(key, () => dronePCM(hzs), { loop: true, volume: 0 });
      // fade in by hand: an <audio> element has volume but no ramp
      let v = 0;
      const fade = setInterval(() => {
        v = Math.min(1, v + .08);
        try { el.volume = v; } catch (e) { /* element already gone */ }
        if (v >= 1) clearInterval(fade);
      }, 50);
      return { stop() {
        clearInterval(fade);
        const out = setInterval(() => {
          v = Math.max(0, v - .25);
          try { el.volume = v; } catch (e) { /* element already gone */ }
          if (v <= 0) { clearInterval(out); release(el); }
        }, 25);
      } };
    },
    // A whole rendered passage, the band's chorus, played once. It has a cache of
    // its own: a chorus is about a megabyte, where a note is a few kilobytes.
    clip(key, build) {
      let u = clips.get(key);
      if (u) clips.delete(key); else u = toWav(build());
      clips.set(key, u);
      if (clips.size > MAX_CLIPS) clips.delete(clips.keys().next().value);
      const el = new Audio(u);
      playing.add(el);
      el.addEventListener("ended", () => playing.delete(el));
      const p = el.play();
      if (p && p.catch) p.catch(() => { /* a refused play must not break the caller */ });
      return { stop() { release(el); } };
    },
    clipCount: () => clips.size,
    sampleRate: SR,
    stopAll() { [...playing].forEach(release); },
    cacheSize: () => cache.size,
  };
}

// ---- choosing one ----

const isSafari = () => {
  const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
  return /safari/i.test(ua) && !/chrome|chromium|crios|fxios|edg|android/i.test(ua);
};
const audioContextCtor = () =>
  (typeof AudioContext !== "undefined" && AudioContext) ||
  (typeof webkitAudioContext !== "undefined" && webkitAudioContext) ||
  window.AudioContext || window.webkitAudioContext || null;

function noAudioReason() {
  return "This browser exposes neither the Web Audio API nor HTML audio playback, so the "
    + "drone, metronome and note playback are unavailable. Everything else on the page works.";
}
function compatibilityReason() {
  return isSafari()
    ? "Web Audio is unavailable here, which on Safari almost always means <b>Lockdown Mode</b>. "
    + "Sound is running in <b>compatibility mode</b> — everything works, with slightly looser timing. "
    + "For the sharper version turn Lockdown Mode off for this site: "
    + "<b>Safari ▸ Settings ▸ Websites ▸ Lockdown Mode</b>."
    : "Web Audio is unavailable here, so sound is running in <b>compatibility mode</b> — "
    + "everything works, with slightly looser timing.";
}

// Built on first use, which is always inside a click: browsers require a gesture
// before they will start audio, and this is never called before one.
function audio() {
  if (state.engine) return state.engine;
  if (state.audioFault) return null;
  const Ctor = audioContextCtor();
  if (Ctor) {
    try { state.engine = webAudioEngine(new Ctor()); } catch (e) { state.engine = null; }
  }
  if (!state.engine && typeof Audio === "function") {
    try { state.engine = wavEngine(); } catch (e) { state.engine = null; }
  }
  if (!state.engine) { state.audioFault = noAudioReason(); check(); return null; }
  state.engine.resume().then(check).catch(check);
  check();
  return state.engine;
}

// One place decides what the status line says and whether the controls are usable.
function check() {
  const m = document.getElementById("audiomsg");
  if (!m) return;
  if (state.audioFault) { m.innerHTML = state.audioFault; audioOff(true); return; }
  audioOff(false);
  if (state.engine && state.engine.name === "Compatibility") m.innerHTML = compatibilityReason();
  else if (state.engine && state.engine.state() === "suspended")
    m.textContent = "Audio is waiting for a click — press the button once more and it will start.";
  else m.textContent = "";
}
// If audio genuinely cannot work, say so on the controls rather than leaving them
// looking clickable and doing nothing.
function audioOff(dead) {
  ["drone", "click", "soloplay"].forEach(id => {
    const b = document.getElementById(id);
    if (!b) return;
    b.disabled = dead;
    b.style.opacity = dead ? .4 : 1;
    b.title = dead ? (state.audioFault || "Audio unavailable").replace(/<[^>]+>/g, "") : "";
  });
}

// ---- what the rest of the app calls ----
// ---- the beat clock ----
// setInterval alone makes a poor metronome. Each tick lands whenever the main thread
// gets round to it — late while a view is drawing — and browsers slow timers in
// background tabs. So a loop books its beats on the audio hardware's clock a little
// ahead of time, and a coarse timer only keeps that booking topped up (the "two
// clocks" pattern). onBeat(when) receives the seconds until its beat sounds; a hidden
// tab books further ahead because its timer may only run about once a second.
//
// Returns an interval id, so clearInterval stops it like any other loop. The
// compatibility engine has no clock to book against, so it keeps one timer per beat.
// stepSec may be a function, read again for every beat: the 12-bar trainer's tempo
// ladder speeds up between choruses without restarting the loop.
function beatLoop(stepSec, onBeat) {
  const step = typeof stepSec === "function" ? stepSec : () => stepSec;
  const a = audio();
  if (!a || !a.now) { onBeat(0); return setInterval(() => onBeat(0), step() * 1000); }
  let next = a.now();
  const pump = () => {
    const now = a.now();
    const ahead = typeof document !== "undefined" && document.hidden ? 1.5 : .12;
    // After a long stall, carry on from now rather than firing every missed beat at once.
    if (next < now - step()) next = now;
    while (next < now + ahead) { onBeat(Math.max(0, next - now)); next += step(); }
  };
  pump();
  return setInterval(pump, 25);
}
// Runs a visual update when its beat actually sounds, not when it was booked.
function atBeat(when, fn) {
  if (when > .005) setTimeout(fn, when * 1000); else fn();
}

function pluck(m, when = 0, dur = .55, vol = .5) {
  const a = audio(); if (!a) return 0;
  a.note(m, { when, dur, vol });
  return when + dur;
}
// audition a list of {s,f} notes low-to-high as an ascending run
function playRun(notes, gap = .17) {
  const a = audio(); if (!a) return 0;
  const seq = [...notes].map(n => midiAt(n.s, n.f)).sort((x, y) => x - y);
  seq.forEach((m, i) => a.note(m, { when: i * gap, dur: .5, vol: .45 }));
  return seq.length * gap;
}
// one click anywhere on a diagram dot sounds that note
const soundDot = g => { if (g && g.dataset && g.dataset.s) pluck(midiAt(+g.dataset.s, +g.dataset.f)); };
document.addEventListener("click", e => soundDot(e.target.closest && e.target.closest("g.pn")));
document.addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const g = e.target.closest && e.target.closest("g.pn");
  if (!g || !g.dataset.s) return;
  e.preventDefault(); soundDot(g);
});
function toggleDrone(btn) {
  if (state.droneHandle) { state.droneHandle.stop(); state.droneHandle = null; btn.setAttribute("aria-pressed", false); return; }
  const a = audio(); if (!a) return;
  state.droneHandle = a.startDrone([freq(state.key), freq(state.key) * 2, freq(state.key) * 3]);
  btn.setAttribute("aria-pressed", true);
}
function stopDrone() {
  if (!state.droneHandle) return;
  state.droneHandle.stop(); state.droneHandle = null;
  const b = document.getElementById("drone");
  if (b) b.setAttribute("aria-pressed", false);
}
function toggleClick(btn) {
  if (state.clickTimer) { clearInterval(state.clickTimer); state.clickTimer = null; btn.setAttribute("aria-pressed", false); return; }
  let beat = 0;
  const tick = when => {
    const a = audio(); if (!a) return;
    a.blip(beat % 4 === 0 ? 1400 : 900, { when, dur: .05, vol: .22 });
    beat++;
  };
  state.clickTimer = beatLoop(60 / state.bpm, tick);
  btn.setAttribute("aria-pressed", true);
}
function restartClick() {
  const b = document.getElementById("click");
  if (state.clickTimer) { clearInterval(state.clickTimer); state.clickTimer = null; toggleClick(b); }
  if (state.trainerTimer) { stopTrainer(); toggleTrainer(); }
  if (state.rhythmTimer) { stopRhythm(); toggleRhythm(); }
}
// ---------- recording ----------
// Records a take from an audio input — a guitar interface or a microphone. The
// browser's speech processing is switched off: echo cancellation, noise suppression
// and auto gain all mangle a guitar. "Guitar + backing" mixes the input with the Web
// Audio engine's master bus in one MediaStreamDestination. The compatibility engine
// plays through <audio> elements, which cannot be tapped, so there a take is guitar
// only and the status line says so. The input is never sent to the speakers: you
// already hear your guitar, and a live mic into speakers feeds back.
//
// A take gives two files: the MediaRecorder original (small, for sharing) and a 16-bit
// WAV master (for editing). The master is captured raw on the audio thread and
// streamed to IndexedDB as it's recorded (see take storage and raw capture), so a
// take has no length limit beyond the browser's storage, and it survives a crash.
// Where that's unavailable, the WAV is decoded from the compressed file instead. The
// recorder can also be armed to start on the downbeat of bar 1, to the sample.
// Past this much delay between playing a note and the page recording it, a take
// sounds late against the backing — typically Bluetooth headphones.
const REC_LATE_MS=60;
// A backing take mixes guitar and band before they are recorded. Two full-level
// parts add up to more than full level, so the backing goes in 3 dB down and a
// limiter sits after the mix: a loud chorus is held just under the top instead of
// clipping. Guitar-only takes skip both, so their master is exactly your input.
const REC_BACKING_LEVEL=Math.pow(10,-3/20);
// Web Audio's compressor always adds make-up gain (about 1.7 dB at these settings)
// and has no switch for it, so a trim after it takes that back: loud passages land
// near -3 dB, with room for a pick attack the limiter is a moment late for.
const REC_LIMIT_TRIM=Math.pow(10,-2/20);
function recLimiter(ac){
  if(typeof ac.createDynamicsCompressor!=="function")return null;
  const l=ac.createDynamicsCompressor(),trim=ac.createGain();
  l.threshold.value=-3;l.knee.value=0;l.ratio.value=20;l.attack.value=.002;l.release.value=.15;
  trim.gain.value=REC_LIMIT_TRIM;l.connect(trim);
  return {input:l,output:trim};}
const REC_TYPES=["audio/webm;codecs=opus","audio/webm","audio/mp4;codecs=mp4a.40.2","audio/mp4"];
const REC_ROW=`<div class="row" id="recrow">
  <details id="recdetails" style="flex:1 1 100%"><summary>Recording &amp; input</summary><div class="row" style="margin-top:8px">
  <select id="recinput" aria-label="Input device"><option value="">Default input</option></select>
  <select id="recchan" aria-label="Input channel"><option value="-1">Both inputs</option><option value="0">Input 1</option><option value="1">Input 2</option></select>
  <button id="reccheck" aria-pressed="false">Check input</button>
  <button id="recmon" aria-pressed="false">Monitor input</button>
  <select id="recmix" aria-label="What to record"><option value="backing" selected>Guitar + backing</option><option value="guitar">Guitar only</option></select>
  <label style="font-size:12px;display:flex;gap:5px;align-items:center"><input type="checkbox" id="recarm">Start on bar 1 of the 12-bar trainer</label>
  <span id="recadvice" style="font-size:11.5px;opacity:.75;flex-basis:100%;line-height:1.5">With backing, wear headphones: through speakers the backing leaks into your guitar input, muddying the take and the timing reading. A wired pair, or the interface's headphone output, keeps the delay lowest.</span>
  <span class="lbl" style="flex-basis:100%;margin-top:4px">This take</span>
  <select id="recmode" aria-label="Take length"><option value="full" selected>Full run-through (no limit)</option><option value="chorus">One 12-bar chorus</option><option value="drill8">Drill: 8 bars</option><option value="drill4">Drill: 4 bars</option><option value="section" disabled>One song section (add sections to a song first)</option></select>
  <select id="recfocus" aria-label="Focus: pick one"><option value="timing" selected>Focus: timing</option><option value="clean">Focus: clean notes</option><option value="bends">Focus: bends in tune</option><option value="phrasing">Focus: phrasing and space</option><option value="vibrato">Focus: vibrato</option><option value="through">Focus: getting through without stopping</option></select>
  <select id="recattempt" aria-label="Attempt"><option value="cold" selected>Cold attempt</option><option value="retest">Retest</option></select>
  <span class="lbl" style="flex-basis:100%;margin-top:4px">Latency</span>
  <button id="calloop">Calibrate: loopback beep</button>
  <button id="caltap">Calibrate: tap along</button>
  <button id="caltapbtn" class="bigmark" hidden>TAP on each click</button>
  <label style="font-size:12px;display:flex;gap:5px;align-items:center">Trim <input type="number" id="calms" step="1" min="-500" max="1000" style="width:5.5em"> ms</label>
  <span id="calmsg" style="font-size:11.5px;opacity:.75;flex-basis:100%;line-height:1.5"></span>
  <select id="recbits" aria-label="WAV bit depth"><option value="16">WAV 16-bit</option><option value="24">WAV 24-bit</option></select>
  <select id="recq" aria-label="MP3 quality"><option value="standard">MP3 standard</option><option value="high">MP3 high</option><option value="best">MP3 best (320)</option></select>
  </div></details>
  <button id="recmark" class="bigmark" hidden>Mark a mistake (M)</button>
  <div id="recdone" class="recdone" hidden>
    <div class="recdonehead" id="recdonehead">Your take is ready</div>
    <audio id="recplay" controls hidden style="height:32px;max-width:100%"></audio>
    <button id="recdlw" class="dl" hidden>Download WAV</button>
    <button id="recdlm" class="dl" hidden>Download MP3</button>
    <button id="recdls" class="dl" hidden>Download solo only (WAV)</button>
    <button id="recdlc" class="dl" hidden>Download compressed</button>
    <div class="recdonefoot">The file goes to your browser's Downloads folder. Every take is also kept in <b>Songs → Your takes</b>, where you can play it back, rate it and download it again.</div>
  </div>
  <span id="recmeter" hidden style="display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;flex-basis:100%">
    <button id="recbar0" class="lvl" aria-label="Input 1 level; select Input 1" style="display:flex;align-items:center;gap:8px;padding:4px 8px"><span style="font-size:11.5px">Input 1</span><span style="position:relative;width:120px;height:8px;border:1px solid var(--rule)"><span id="recfill0" style="position:absolute;left:0;top:0;bottom:0;width:0"></span></span></button>
    <button id="recbar1" class="lvl" aria-label="Input 2 level; select Input 2" style="display:flex;align-items:center;gap:8px;padding:4px 8px"><span style="font-size:11.5px">Input 2</span><span style="position:relative;width:120px;height:8px;border:1px solid var(--rule)"><span id="recfill1" style="position:absolute;left:0;top:0;bottom:0;width:0"></span></span></button>
    <span id="reclevel" style="font-size:11.5px;line-height:1.5"></span>
  </span>
  <span id="recmsg" style="font-size:11.5px;opacity:.75;flex-basis:100%;line-height:1.5"></span>
  <div id="recsaved" style="flex-basis:100%;font-size:11.5px;line-height:1.7"></div>
</div>`;
function recUnsupported(){
  const md=typeof navigator!=="undefined"&&navigator.mediaDevices;
  if(!md||typeof md.getUserMedia!=="function"){
    if(typeof isSecureContext!=="undefined"&&!isSecureContext)
      return "Recording needs microphone access, which browsers only give a secure page (https, or the app on this computer).";
    // A secure page with no microphone API: on Safari's engine that is Lockdown Mode.
    // Other Mac browsers built on it (DuckDuckGo, for one) also say "Safari", but
    // their exclusion lives in System Settings, so both routes are given.
    return isSafari()
      ? "The microphone is being withheld here, which on a Mac almost always means Lockdown Mode. To record, exclude "
        +"this site in Safari (Settings \u25b8 Websites \u25b8 Lockdown Mode) or, in another browser such as DuckDuckGo, "
        +"exclude the app (System Settings \u25b8 Privacy & Security \u25b8 Lockdown Mode \u25b8 Configure Web Browsing), "
        +"then reload. Chrome isn't affected by Lockdown Mode."
      : "This browser doesn't give web pages microphone access, so recording is unavailable.";}
  if(typeof MediaRecorder!=="function")return "This browser cannot record audio.";
  return "";}
// Download settings, remembered on this device: the WAV master's bit depth (fixed
// when a take starts, since the master is stored that way) and the MP3 quality
// (applied whenever an MP3 is made).
const REC_SETTINGS_KEY="practice-desk-rec-settings";
const MP3_QUALITY={standard:{name:"MP3 standard",kbps:[128,192]},high:{name:"MP3 high",kbps:[192,256]},best:{name:"MP3 best",kbps:[320,320]}};
function readRecSettings(){
  try{const v=JSON.parse(window.localStorage.getItem(REC_SETTINGS_KEY)||"null");
    if(v&&(v.wavBits===16||v.wavBits===24))state.wavBits=v.wavBits;
    if(v&&Object.prototype.hasOwnProperty.call(MP3_QUALITY,v.mp3Quality))state.mp3Quality=v.mp3Quality;}
  catch(e){/* nothing stored, or unreadable: keep the defaults */}}
function writeRecSettings(){
  try{window.localStorage.setItem(REC_SETTINGS_KEY,JSON.stringify({wavBits:state.wavBits,mp3Quality:state.mp3Quality}));}
  catch(e){/* private mode: settings last for this visit */}}
// the first container this browser can write, or "" to let it choose
function recMime(){
  if(typeof MediaRecorder.isTypeSupported!=="function")return "";
  return REC_TYPES.find(t=>MediaRecorder.isTypeSupported(t))||"";}
const recExt=mime=>/mp4|aac/.test(mime)?"m4a":/ogg/.test(mime)?"ogg":"webm";
const fileSize=n=>n<1024?n+" B":n<1048576?Math.round(n/1024)+" KB":(n/1048576).toFixed(1)+" MB";
// practice-<key>-<bpm>bpm-<yyyymmdd-hhmmss>.<ext>; the sharp is spelled out because
// "#" in a file name breaks the link to it. Key and tempo are the ones the take
// started with: moving the tempo slider ends a trainer take before it is named.
// <song>-<section|full>-<bpm>bpm-<date>-<cold|retest>.<ext>. Until songs arrive the
// song is "12bar" over the trainer or "practice", with the key; the section is the
// drill's length. The sharp is spelt out because "#" in a file name breaks a link.
const TAKE_MODES={section:{part:"section",bars:0},full:{part:"full",bars:0},chorus:{part:"chorus",bars:12},drill8:{part:"8bars",bars:8},drill4:{part:"4bars",bars:4}};
const TAKE_FOCUS={timing:"timing",clean:"clean notes",bends:"bends in tune",phrasing:"phrasing and space",vibrato:"vibrato",through:"getting through without stopping"};
const slug=v=>String(v).replace(/#|\u266f/g,"sharp").replace(/\u266d/g,"flat").replace(/[^A-Za-z0-9]+/g,"-").replace(/^-+|-+$/g,"")||"take";
function takeName(date,ext,key=state.key,bpm=state.bpm,info={}){
  const p=n=>String(n).padStart(2,"0");
  const stamp=`${date.getFullYear()}${p(date.getMonth()+1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  const song=info.song||`${info.trainer?"12bar":"practice"}-${NOTES[key]}`;
  const part=info.part||(TAKE_MODES[info.mode]||TAKE_MODES.full).part;
  return `${slug(song)}-${slug(part)}-${bpm}bpm-${stamp}-${info.attempt==="retest"?"retest":"cold"}.${ext}`;}
// This take's settings, read when it starts.
function takeSettings(){
  const pick=(id,ok,dflt)=>{const v=document.getElementById(id).value;return ok(v)?v:dflt;};
  let mode=pick("recmode",v=>v in TAKE_MODES,"full");
  const sec=state.pendingSection;state.pendingSection=null;
  // "one section" needs a section: chosen from the song, else it is a full run-through
  if(mode==="section"&&!sec)mode="full";
  const out={mode,focus:pick("recfocus",v=>v in TAKE_FOCUS,"timing"),attempt:pick("recattempt",v=>v==="retest"||v==="cold","cold")};
  if(mode==="section")Object.assign(out,{part:sec.name,section:sec});
  return out;}
// What the browser reports for output plus input delay, in ms, or 0 when it can't
// say. You play to what you hear, and the input then lags again, so both count.
function recLatencyMs(ac,input){
  let sec=ac?(ac.baseLatency||0)+(ac.outputLatency||0):0;
  const tr=input&&input.getAudioTracks&&input.getAudioTracks()[0];
  const set=tr&&tr.getSettings?tr.getSettings():{};
  if(typeof set.latency==="number")sec+=set.latency;
  return Math.round(sec*1000);}
function recSay(text){document.getElementById("recmsg").textContent=text;}
function recButtons(){
  const r=state.rec,phase=r?r.phase:"idle",b=document.getElementById("recbtn");
  b.textContent={idle:"Record",opening:"Cancel",armed:"Cancel",starting:"Cancel",recording:"Stop",finishing:"Saving…"}[phase];
  b.disabled=phase==="finishing";
  b.setAttribute("aria-pressed",phase!=="idle");
  // what a take records is fixed once its input is open
  ["recinput","recchan","recmix","recarm","recbits","recmode","recfocus","recattempt"].forEach(id=>{document.getElementById(id).disabled=phase!=="idle";});}
// Device labels stay blank until the page has been allowed an input once, so this
// runs again after every take opens its input.
function listInputs(){
  const md=navigator.mediaDevices;
  if(!md||typeof md.enumerateDevices!=="function")return Promise.resolve();
  return md.enumerateDevices().then(list=>{
    const inputs=list.filter(d=>d.kind==="audioinput"&&d.deviceId&&d.deviceId!=="default");
    const sel=document.getElementById("recinput");
    sel.innerHTML=`<option value="">Default input</option>`+inputs.map((d,i)=>
      `<option value="${escapeHTML(d.deviceId)}">${escapeHTML(d.label||"Input "+(i+1))}</option>`).join("");
    if(!inputs.some(d=>d.deviceId===state.recDevice))state.recDevice="";
    sel.value=state.recDevice;
  }).catch(()=>{});}
// What to ask getUserMedia for: the chosen device, with the voice processing off.
// A single channel can only be picked out of an input that arrives in stereo.
function inputWanted(mono){
  const want={echoCancellation:false,noiseSuppression:false,autoGainControl:false};
  if(state.recDevice)want.deviceId={exact:state.recDevice};
  // Stereo whenever Web Audio will handle it: the meter watches both inputs, and a
  // take picks its channel out of that. So the channel choice never reopens it.
  want.channelCount={ideal:mono?1:2};
  // as little buffering as the browser will give: a guitar heard late is a guitar played late
  want.latency={ideal:0};
  return want;}
// ---- the shared input ----
// The recorder and the monitor share one open input, and it stays open for a few
// minutes after the last use. Safari asks again on every getUserMedia call unless
// the site is set to Allow, so this is the difference between one question per
// visit and one per take. Keeping it longer would leave the browser's microphone
// indicator on for no reason.
const INPUT_IDLE_MS=5*60*1000;
function acquireInput(mono){
  const want=inputWanted(mono),key=JSON.stringify(want),h=state.inputHeld;
  const live=h&&h.key===key&&h.stream.getTracks().every(t=>t.readyState!=="ended");
  if(live){clearTimeout(h.idle);h.idle=null;return Promise.resolve(h.stream);}
  releaseInput();   // another device or channel, or it was unplugged
  return navigator.mediaDevices.getUserMedia({audio:want}).then(stream=>{
    state.inputHeld={key,stream,idle:null};
    const a=state.engine;
    if(a&&a.context)meterAttach(a.context,stream);
    return stream;});}
function releaseInput(){
  const h=state.inputHeld;
  if(!h)return;
  state.inputHeld=null;clearTimeout(h.idle);
  meterDetach();
  if(state.pitch&&typeof pitchStop==="function")pitchStop();
  if(state.checking){state.checking=false;checkButton();}
  h.stream.getTracks().forEach(t=>t.stop());}
// Called whenever the recorder, the monitor or Check input lets go of the input.
function inputIdle(){
  const h=state.inputHeld;
  if(!h||state.monitor||state.rec||state.checking||state.pitch)return;
  clearTimeout(h.idle);h.idle=setTimeout(releaseInput,INPUT_IDLE_MS);}
// The input as a Web Audio source, with the chosen channel split out. link(node)
// connects it onward; one splitter output is mono, which a stereo node spreads to
// both sides.
function inputNode(ac,input,chan){
  const src=ac.createMediaStreamSource(input);
  const tr=input.getAudioTracks&&input.getAudioTracks()[0];
  const have=(tr&&tr.getSettings&&tr.getSettings().channelCount)||2;
  if(chan>=0&&chan<have&&ac.createChannelSplitter){
    const split=ac.createChannelSplitter(2);
    src.connect(split);
    return {src,note:"",link:to=>split.connect(to,chan,0)};}
  return {src,link:to=>src.connect(to),
    note:chan>=0?`This input has one channel, so there is no Input ${chan+1}; using the channel it has.`:""};}

// Opens the input and builds a MediaRecorder for it, ready to start.
//
// Input channel: a two-input interface arrives as one stereo stream, guitar on one
// side. "Both inputs" keeps that (averaged to mono for a guitar-only take, so the
// guitar is 6 dB down with the empty input's hiss mixed in). Picking Input 1 or 2
// splits that channel out and sends it to the centre, in a mono or stereo take alike.
function openTake(){
  const a=audio();   // inside the click, so the engine is allowed to start
  const wantBacking=document.getElementById("recmix").value==="backing";
  const ac=a&&a.context||null, backing=wantBacking&&!!(ac&&a.tap), mono=!backing;
  const note=wantBacking&&!backing?(a?"Backing can't be captured in compatibility sound mode, so this take is guitar only."
    :"There is no sound engine to capture backing from, so this take is guitar only."):"";
  const chan=state.recChannel;
  // Web Audio downmixes a mono take itself, so the input is only asked for in mono
  // without it — which also lets the monitor share the same input.
  const channels=mono?1:2;
  let input;
  return acquireInput(mono&&!(ac&&ac.createMediaStreamDestination))
  .then(i=>{input=i;return ac&&ac.createMediaStreamDestination?openCapture(ac,channels):null;})
  // With backing in the take, your guitar is also kept on its own: a second, mono
  // capture that hears only the input. So the take is the solo and the song together,
  // and the solo alone is still there for a WAV, for timing analysis, and for a layer
  // mixer that turns the backing down.
  .then(capture=>(capture&&backing?openCapture(ac,1).then(stem=>[capture,stem]):[capture,null]))
  .then(([capture,stem])=>{
    let stream=input,src=null,dest=null,chanNote="",bus=null,bed=null,sdest=null;
    // Through Web Audio when there is one: that is where backing is mixed in, and a
    // one-channel destination downmixes a stereo interface to a true mono take.
    if(ac&&ac.createMediaStreamDestination){
      dest=ac.createMediaStreamDestination();
      dest.channelCount=mono?1:2;dest.channelCountMode="explicit";dest.channelInterpretation="speakers";
      const n=inputNode(ac,input,chan);
      src=n.src;chanNote=n.note;
      // the raw capture hears exactly what the compressed recording does
      const outs=capture?[dest,capture.node]:[dest];
      if(stem){n.link(stem.node);
        // the solo is also kept compressed, so it can be heard on its own later
        sdest=ac.createMediaStreamDestination();
        sdest.channelCount=1;sdest.channelCountMode="explicit";sdest.channelInterpretation="speakers";
        n.link(sdest);}
      if(backing){
        bus=ac.createGain();bus.channelCount=2;bus.channelCountMode="explicit";bus.channelInterpretation="speakers";
        bed=ac.createGain();bed.gain.value=REC_BACKING_LEVEL;
        a.tap(bed);bed.connect(bus);n.link(bus);
        const lim=recLimiter(ac),last=lim?lim.output:bus;
        if(lim)bus.connect(lim.input);
        outs.forEach(o=>last.connect(o));
      }else outs.forEach(o=>n.link(o));
      stream=dest.stream;}
    else if(chan>=0)chanNote="Picking one input needs Web Audio, which this browser withholds, so both inputs are recorded.";
    const mime=recMime(),opts={audioBitsPerSecond:96000};
    if(mime)opts.mimeType=mime;
    const recorder=new MediaRecorder(stream,opts);
    let stemRecorder=null,stemChunks=[];
    if(sdest){try{stemRecorder=new MediaRecorder(sdest.stream,{...opts,audioBitsPerSecond:64000});}catch(e){stemRecorder=null;}}
    const late=recLatencyMs(ac,input);
    const warn=late>REC_LATE_MS?`Your audio adds about ${late} ms of delay, so the take will sound late against the backing. `
      +"Bluetooth headphones are the usual cause: use wired ones, or your interface's outputs.":"";
    const take={phase:"ready",input,src,dest,bus,bed,recorder,chunks:[],mime:recorder.mimeType||mime,mono,backing,capture,stem,stemRecorder,
      stemDone:null,stemBlob:null,
      note:[note,chanNote,warn].filter(Boolean).join(" ")};
    // Storage full: stop cleanly, keeping everything written so far.
    if(capture)capture.onFail=()=>{if(state.rec===take)stopRecording();};
    if(stem)stem.onFail=capture?capture.onFail:null;
    recorder.ondataavailable=e=>{if(e.data&&e.data.size)take.chunks.push(e.data);};
    recorder.onstop=()=>finishTake(take);
    if(stemRecorder){
      take.stemDone=new Promise(done=>{
        stemRecorder.ondataavailable=e=>{if(e.data&&e.data.size)stemChunks.push(e.data);};
        stemRecorder.onstop=()=>{if(stemChunks.length)take.stemBlob=new Blob(stemChunks,{type:stemRecorder.mimeType||mime||"audio/webm"});done();};});}
    listInputs();
    return take;});}
// Unhooks a take from the input; the input itself is shared, so inputIdle decides
// when it is released.
function closeTake(t){
  if(t.src)try{t.src.disconnect();}catch(e){/* already gone */}
  if(t.bed&&state.engine&&state.engine.untap)state.engine.untap(t.bed);}
function inputError(e){
  const n=e&&e.name;
  if(n==="NotAllowedError"||n==="SecurityError")return "Microphone access was refused. Allow it for this page in the browser's site settings, then press Record again.";
  if(n==="NotFoundError"||n==="OverconstrainedError")return "That input isn't available. Pick another in the list, or plug it back in.";
  return "The input couldn't be opened"+(e&&e.message?": "+e.message:".");}
function toggleRecord(){
  const r=state.rec;
  if(r&&r.phase==="recording"){stopRecording();return;}
  if(r){cancelRecording();return;}
  const armed=!!document.getElementById("recarm").checked;
  const pending=state.rec={phase:"opening"};
  recButtons();recSay("Opening the input…");
  return openTake().then(take=>{
    if(state.rec!==pending){closeTake(take);inputIdle();return;}   // cancelled while it opened
    state.rec=take;
    if(armed){take.phase="armed";recButtons();
      recSay("Armed. Start the 12-bar trainer: recording begins on bar 1, after the count-in."+(take.note?" "+take.note:""));}
    else startTake(take,false);
  }).catch(e=>{if(state.rec===pending){state.rec=null;recButtons();recSay(inputError(e));inputIdle();}});}
function startTake(t,fromTrainer){
  t.phase="recording";t.fromTrainer=fromTrainer;t.date=t.date||new Date();t.t0=Date.now();
  t.key=state.key;t.bpm=state.bpm;t.markers=[];
  // What the take is over: the song playing now, or the one about to start after its count-in.
  const live=!fromTrainer&&typeof songNow==="function"?songNow():null;
  const pend=!fromTrainer&&!live&&typeof songs!=="undefined"?songs.pending:null;
  if(typeof songs!=="undefined")songs.pending=null;
  const sg=live||(pend?pend.song:null);
  if(sg){const rate=live?songs.player.playbackRate:pend.rate;
    t.key=sg.key;t.bpm=Math.round(sg.bpm*rate);
    t.songPlay={offset:live?songs.player.currentTime:pend.offset,rate,downbeat:sg.downbeat};}
  // the audio clock at the take's first sample: the downbeat's frame when armed
  {const ac=state.engine&&state.engine.context;
   t.acStart=ac?(t.startFrame!==undefined?t.startFrame/ac.sampleRate:ac.currentTime):undefined;}
  document.getElementById("recmark").hidden=false;document.getElementById("recmark").textContent="Mark a mistake (M)";
  if(!t.info)t.info={...takeSettings(),trainer:fromTrainer,song:sg?sg.title:undefined,songId:sg?sg.id:undefined,
    // a solo over your own rhythm take points back at it
    backingTakeId:sg&&sg.kind==="take"?sg.takeId:undefined};
  const bars=TAKE_MODES[t.info.mode].bars;
  beginCapture(t.capture,0,takeMeta(t));   // unless bar 1 already booked it to the sample
  beginStem(t,0);
  t.recorder.start(1000);
  if(t.stemRecorder)try{t.stemRecorder.start(1000);}catch(e){/* the solo copy is optional */}
  const say=()=>{const s=Math.floor((Date.now()-t.t0)/1000);
    // A drill on its own, off the trainer, stops after its bars at the current tempo.
    if(bars&&!fromTrainer&&(Date.now()-t.t0)/1000>=bars*4*60/t.bpm){stopRecording();return;}
    recSay(`Recording ${t.backing?"guitar + backing":"guitar only"} · ${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`
      +(bars?` · ${TAKE_MODES[t.info.mode].part}, stops by itself`:fromTrainer?" · stopping the trainer ends the take":"")
      +` · focus: ${TAKE_FOCUS[t.info.focus]}`+(t.note?" · "+t.note:""));};
  say();t.clock=setInterval(say,250);
  recButtons();}
// The solo-only stem starts on the same frame as the take, and is filed as a master of
// its own, named for the take, so it can be listed, downloaded and recovered like one.
function beginStem(t,frame){
  if(!t.stem||!t.capture||t.stem.began)return;
  const meta=takeMeta(t);
  beginCapture(t.stem,frame,{...meta,name:meta.name.replace(/\.wav$/,"-solo.wav"),stem:true,of:t.capture.id,mono:true});}
// What storage keeps about a take, so a saved master can be named and listed later.
function takeMeta(t){
  const info=t.info||{};
  return {name:takeName(t.date||new Date(),"wav",t.key,t.bpm,info),key:t.key,bpm:t.bpm,mono:t.mono,backing:t.backing,
    mode:info.mode,focus:info.focus,attempt:info.attempt,calMs:state.cal?state.cal.ms:null,markers:[],songId:info.songId||null};}
// Called by trainerTick for every bar-1 downbeat, when seconds before it sounds. The
// raw capture is told the downbeat's frame now, so the master starts on that exact
// sample; the compressed recording starts when the beat sounds.
function recOnBarOne(when){
  const r=state.rec;
  if(!r||r.phase!=="armed")return;
  r.phase="starting";
  const ac=state.engine&&state.engine.context;
  if(r.capture&&ac){
    r.key=state.key;r.bpm=state.bpm;r.date=new Date();r.info={...takeSettings(),trainer:true};
    r.startFrame=Math.round((ac.currentTime+when)*ac.sampleRate);
    beginCapture(r.capture,r.startFrame,takeMeta(r));
    beginStem(r,r.startFrame);}
  atBeat(when,()=>{if(state.rec===r&&r.phase==="starting")startTake(r,true);});}
// Every downbeat the trainer books: a drill over the trainer ends on the downbeat after
// its last bar, to the sample for the raw master.
function drillBar(when){
  const r=state.rec;
  if(!r||!r.fromTrainer||!r.info||(r.phase!=="recording"&&r.phase!=="starting"))return;
  const bars=TAKE_MODES[r.info.mode].bars;
  if(!bars)return;
  r.bars=(r.bars||0)+1;
  if(r.bars<=bars)return;
  const ac=state.engine&&state.engine.context;
  if(r.capture&&ac){const end=Math.round((ac.currentTime+when)*ac.sampleRate);
    [r.capture,r.stem].forEach(c=>{if(c){c.node.port.postMessage({stopAt:end});c.ending=true;}});}
  atBeat(when,()=>{if(state.rec===r)stopRecording();});}
function stopRecording(){
  const r=state.rec;
  if(!r||r.phase!=="recording")return;
  r.phase="finishing";clearInterval(r.clock);markToday();
  recButtons();recSay("Saving the take…");
  // a drill's capture was told its last frame; otherwise it stops now
  [r.capture,r.stem].forEach(c=>{if(c&&!c.ending)c.node.port.postMessage({stop:true});});
  if(r.stemRecorder&&r.stemRecorder.state==="recording")r.stemRecorder.stop();
  r.recorder.stop();}
function cancelRecording(){
  const r=state.rec;
  if(!r)return;
  state.rec=null;
  if(r.clock)clearInterval(r.clock);
  if(r.stemRecorder){r.stemRecorder.onstop=null;if(r.stemRecorder.state==="recording")r.stemRecorder.stop();}
  if(r.recorder){r.recorder.onstop=null;if(r.recorder.state==="recording")r.recorder.stop();closeTake(r);}
  [r.capture,r.stem].forEach(c=>{if(c)endCapture(c).then(meta=>meta&&dropTake(meta.id)).catch(()=>{});});
  document.getElementById("recmark").hidden=true;
  inputIdle();recButtons();recSay("Recording cancelled.");}
function releaseTake(t){
  [t,t.wav,t.mp3].forEach(f=>{if(f&&f.url)try{URL.revokeObjectURL(f.url);}catch(e){/* already released */}});}
// Decodes the compressed take and writes it out again as PCM WAV. A guitar-only take
// keeps one channel, so its WAV is mono too.
function takeToWav(blob,mono){
  const a=state.engine,Ctor=audioContextCtor();
  const own=a&&a.context?null:(Ctor?new Ctor():null), ac=a&&a.context||own;
  if(!ac||!ac.decodeAudioData)return Promise.reject(new Error("no decoder"));
  return blob.arrayBuffer()
    .then(buf=>new Promise((ok,fail)=>{const p=ac.decodeAudioData(buf,ok,fail);if(p&&p.then)p.then(ok,fail);}))
    .then(ab=>{
      const chans=[];
      for(let c=0;c<(mono?1:ab.numberOfChannels);c++)chans.push(ab.getChannelData(c));
      return {wav:new Blob([wavBytes(chans,ab.sampleRate)],{type:"audio/wav"}),seconds:ab.duration,channels:chans.length};})
    .finally(()=>{if(own&&own.close)own.close();});}
// ---- take storage ----
// A take's master is written to IndexedDB while it is recorded: 16-bit PCM in chunks
// of about a second. So a long take never has to fit in memory, and what was written
// survives a crash or a closed tab. The WAV is assembled from the chunks when you
// download it, and the chunks are dropped once you have it (or discard it). Stored
// data may come from an older version or be damaged, so every read checks its shape.
const TAKE_DB="practice-desk-takes";
// The tables the desk keeps: what a take is, its raw audio in chunks, the song
// library, and each song's audio file.
const TAKE_STORES=["takes","chunks","songs","songfiles","library"];
function openTakeDB(version){
  return new Promise((ok,fail)=>{
    // version 2 added the song library: what is known about each song, and its audio
    // file, kept apart so listing songs never loads a file
    const r=version===undefined?indexedDB.open(TAKE_DB):indexedDB.open(TAKE_DB,version);
    r.onupgradeneeded=()=>{const db=r.result;
      if(!db.objectStoreNames.contains("takes"))db.createObjectStore("takes",{keyPath:"id"});
      if(!db.objectStoreNames.contains("chunks"))db.createObjectStore("chunks",{keyPath:["take","seq"]});
      if(!db.objectStoreNames.contains("songs"))db.createObjectStore("songs",{keyPath:"id"});
      if(!db.objectStoreNames.contains("songfiles"))db.createObjectStore("songfiles",{keyPath:"id"});
      // version 3: the takes you keep, with their ratings, apart from the WAV masters
      if(!db.objectStoreNames.contains("library"))db.createObjectStore("library",{keyPath:"id"});};
    // Another tab holds this database open at an older version and has not let go.
    r.onblocked=()=>{state.dbBlocked=true;
      if(typeof songSay==="function"&&document.getElementById("songstatus"))
        songSay("Another tab of the desk is still open with older storage. Close the other desk tabs, then reload this one.");};
    r.onsuccess=()=>{const db=r.result;
      // A newer tab wants to upgrade: let go so it can, and reopen on next use.
      db.onversionchange=()=>{db.close();state.takeDB=null;};
      ok(db);};
    r.onerror=()=>fail(r.error||new Error("storage unavailable"));});}
// Opens the database and makes sure every table is there. A database can be at the
// right version yet lack a table — an earlier build made it at version 2 without the
// song library — and then no upgrade runs, so every read of that table fails. When a
// table is missing, reopen one version higher, which is what creates it.
function takeDB(){
  if(state.takeDB)return state.takeDB;
  const missing=db=>TAKE_STORES.filter(n=>!db.objectStoreNames.contains(n));
  state.takeDB=(typeof indexedDB==="undefined"||!indexedDB?Promise.reject(new Error("no IndexedDB")):openTakeDB(3))
    // a newer build already took it past version 2: use it as it is
    .catch(e=>e&&e.name==="VersionError"?openTakeDB():Promise.reject(e))
    .then(db=>{
      if(!missing(db).length)return db;
      const next=db.version+1;
      db.close();
      return openTakeDB(next).then(fixed=>{
        if(missing(fixed).length){fixed.close();throw new Error("the browser's storage is missing tables that could not be created");}
        return fixed;});});
  state.takeDB.catch(()=>{state.takeDB=null;/* callers see the rejection; the next use tries again */});
  return state.takeDB;}
// One transaction over one or more stores. fn gets the transaction and may return a
// request, whose result the promise resolves with once everything is committed.
function dbDo(stores,mode,fn){
  return takeDB().then(db=>new Promise((ok,fail)=>{
    const tx=db.transaction(stores,mode),req=fn(tx);let result;
    if(req)req.onsuccess=()=>{result=req.result;};
    tx.oncomplete=()=>ok(result);
    tx.onerror=tx.onabort=()=>fail(tx.error||new Error("storage failed"));}));}
const chunkRange=id=>IDBKeyRange.bound([id,0],[id,Infinity]);
const isTake=m=>!!m&&typeof m.id==="string"&&(m.channels===1||m.channels===2)&&m.sampleRate>0
  &&(m.bits===undefined||m.bits===16||m.bits===24);
// Takes stored before 24-bit existed have no bits: they are 16-bit.
const bitsOf=m=>m.bits===24?24:16;
const wavSize=(frames,ch,bits)=>44+frames*ch*bits/8;
function savedTakes(){
  return dbDo("takes","readonly",tx=>tx.objectStore("takes").getAll())
    .then(list=>(Array.isArray(list)?list:[]).filter(isTake));}
function dropTake(id){
  return dbDo(["takes","chunks"],"readwrite",tx=>{
    tx.objectStore("chunks").delete(chunkRange(id));tx.objectStore("takes").delete(id);});}
// The stored master as a WAV Blob, or null if nothing usable is left of it.
// The stored master's samples, in order, as interleaved Int16Arrays.
function masterPcm(meta){
  return dbDo("chunks","readonly",tx=>tx.objectStore("chunks").getAll(chunkRange(meta.id))).then(rows=>
    (Array.isArray(rows)?rows:[])
      .filter(r=>r&&ArrayBuffer.isView(r.pcm)&&(bitsOf(meta)===24
        // by tag, not instanceof: a stored array may come from another realm
        ?Object.prototype.toString.call(r.pcm)==="[object Uint8Array]"&&r.pcm.length%(meta.channels*3)===0
        :r.pcm.BYTES_PER_ELEMENT===2&&r.pcm.length%meta.channels===0))
      .sort((a,b)=>a.seq-b.seq).map(r=>r.pcm));}
function masterWav(meta){
  return masterPcm(meta).then(pcm=>{
    const bytes=pcm.reduce((n,p)=>n+p.byteLength,0);
    if(!bytes)return null;
    return new Blob([wavHeader(bytes,meta.channels,meta.sampleRate,bitsOf(meta)),...pcm],{type:"audio/wav"});});}
// Ask the browser not to clear stored takes when it's short of space, and report
// what they take up. Both are best effort: not every browser offers them.
function storageNote(){
  const st=typeof navigator!=="undefined"&&navigator.storage;
  if(!st||typeof st.estimate!=="function")return Promise.resolve("");
  const keep=typeof st.persist==="function"?st.persist().catch(()=>false):Promise.resolve(false);
  return Promise.all([keep,st.estimate()]).then(([kept,e])=>
    e&&e.quota?`Stored takes use ${fileSize(e.usage||0)} of ${fileSize(e.quota)} available`
      +(kept?".":"; the browser may clear them if it runs short of space.")
    :"").catch(()=>"");}

// ---- raw capture ----
// Runs rec-worklet.js on the audio thread beside the MediaRecorder, and streams what
// it hands over into storage. Without AudioWorklet or IndexedDB there is no capture,
// and the WAV falls back to decoding the compressed file (takeToWav).
function workletReady(ac){
  if(!ac||!ac.audioWorklet||typeof AudioWorkletNode!=="function")return Promise.resolve(false);
  if(!state.workletFor||state.workletFor.ac!==ac)
    state.workletFor={ac,ready:ac.audioWorklet.addModule("rec-worklet.js").then(()=>true,()=>false)};
  return state.workletFor.ready;}
function openCapture(ac,channels){
  return Promise.all([workletReady(ac),takeDB().then(()=>true,()=>false)]).then(([w,db])=>{
    if(!w||!db)return null;
    const node=new AudioWorkletNode(ac,"take-capture",{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],
      channelCount:channels,channelCountMode:"explicit",channelInterpretation:"speakers",
      processorOptions:{channels,block:Math.round(ac.sampleRate)}});
    // It writes nothing to its output; being connected is what keeps it running.
    node.connect(ac.destination);
    const cap={node,channels,bits:state.wavBits,sampleRate:ac.sampleRate,id:"take-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,7),
      seq:0,frames:0,writes:Promise.resolve(),failed:null,began:false,onFail:null,done:null};
    cap.finished=new Promise(ok=>{cap.done=ok;});
    node.port.onmessage=e=>{
      const m=e.data||{};
      if(Array.isArray(m.block)&&m.block.length){
        const pcm=cap.bits===24?pcm24(m.block):pcm16(m.block),seq=cap.seq++;
        cap.frames+=m.block[0].length;
        const frames=cap.frames;
        cap.writes=cap.writes.then(()=>cap.failed?null:dbDo(["takes","chunks"],"readwrite",tx=>{
          tx.objectStore("chunks").put({take:cap.id,seq,pcm});
          tx.objectStore("takes").put(Object.assign({},cap.meta,{frames}));}))
          .catch(err=>{if(!cap.failed){cap.failed=err||new Error("storage failed");if(cap.onFail)cap.onFail(cap.failed);}});}
      if(typeof m.done==="number")cap.writes.then(()=>cap.done(cap.frames));};
    return cap;});}
// Starts keeping audio at an exact frame on the audio clock (0: from now).
function beginCapture(cap,frame,meta){
  if(!cap||cap.began)return;
  cap.began=true;
  cap.meta=Object.assign({id:cap.id,status:"recording",channels:cap.channels,bits:cap.bits,sampleRate:cap.sampleRate,started:Date.now(),frames:0},meta);
  cap.writes=cap.writes.then(()=>dbDo("takes","readwrite",tx=>{tx.objectStore("takes").put(cap.meta);})).catch(()=>{});
  cap.node.port.postMessage({start:frame});}
// Stops the capture and marks the take finished; resolves with its stored record.
function endCapture(cap){
  if(!cap)return Promise.resolve(null);
  cap.node.port.postMessage({stop:true});
  return cap.finished.then(frames=>{
    try{cap.node.disconnect();}catch(e){/* already gone */}
    if(!cap.began)return null;
    const meta=Object.assign({},cap.meta,{status:"done",frames});
    return dbDo("takes","readwrite",tx=>{tx.objectStore("takes").put(meta);}).then(()=>meta,()=>meta);});}

// ---- a WebM take's length ----
// A browser recorder writes WebM as a stream, so the file never says how long it is,
// and some players then show no length or can't seek. This writes a Duration into
// the Segment's Info, in the file's own TimecodeScale units (11 bytes). Inserting
// bytes moves everything after Info, so a file with a SeekHead or Cues — positions
// that would then be wrong — or anything else unexpected comes back unchanged: no
// worse than it was.
function webmWithDuration(bytes,ms){
  const vint=(i,isId)=>{
    if(i>=bytes.length)return null;
    const x=bytes[i];let len=1,m=0x80;
    while(len<=8&&!(x&m)){m>>=1;len++;}
    if(len>8||i+len>bytes.length)return null;
    let v=isId?x:x&(m-1);
    for(let k=1;k<len;k++)v=v*256+bytes[i+k];
    return {v,len,unknown:!isId&&v===2**(7*len)-1};};
  const el=i=>{const id=vint(i,true),sz=id&&vint(i+id.len,false);
    return sz?{id:id.v,sizeAt:i+id.len,sizeLen:sz.len,size:sz.v,unknown:sz.unknown,data:i+id.len+sz.len}:null;};
  const head=el(0);
  if(!head||head.id!==0x1A45DFA3)return bytes;                     // not EBML
  const seg=el(head.data+head.size);
  if(!seg||seg.id!==0x18538067)return bytes;
  let info=null;
  for(let i=seg.data;;){
    const e=el(i);
    if(!e||e.id===0x114D9B74||e.id===0x1C53BB6B)return bytes;      // SeekHead, Cues
    if(e.id===0x1549A966){info=e;break;}
    if(e.unknown||e.id===0x1F43B675)return bytes;                  // a Cluster before any Info
    i=e.data+e.size;}
  let scale=1e6;
  for(let i=info.data;i<info.data+info.size;){
    const e=el(i);
    if(!e||e.id===0x4489)return bytes;                             // already has a Duration
    if(e.id===0x2AD7B1){scale=0;for(let k=0;k<e.size;k++)scale=scale*256+bytes[e.data+k];}
    i=e.data+e.size;}
  const grown=info.size+11,fits=(n,len)=>n<2**(7*len)-1;
  if(!scale||!fits(grown,info.sizeLen)||(!seg.unknown&&!fits(seg.size+11,seg.sizeLen)))return bytes;
  const at=info.data+info.size,out=new Uint8Array(bytes.length+11);
  out.set(bytes.subarray(0,at));out.set(bytes.subarray(at),at+11);
  out.set([0x44,0x89,0x88],at);                                     // Duration, 8-byte float
  new DataView(out.buffer).setFloat64(at+3,ms*1e6/scale);
  const putSize=(pos,len,n)=>{for(let k=len-1;k>=0;k--){out[pos+k]=n%256;n=Math.floor(n/256);}out[pos]|=0x80>>(len-1);};
  putSize(info.sizeAt,info.sizeLen,grown);
  if(!seg.unknown)putSize(seg.sizeAt,seg.sizeLen,seg.size+11);
  return out;}
function fixTakeLength(kept,seconds){
  if(!/webm/.test(kept.blob.type)||!(seconds>0))return Promise.resolve();
  return kept.blob.arrayBuffer().then(buf=>{
    const fixed=webmWithDuration(new Uint8Array(buf),seconds*1000);
    if(fixed.length===buf.byteLength||state.recTake!==kept)return;
    try{URL.revokeObjectURL(kept.url);}catch(e){/* already released */}
    kept.blob=new Blob([fixed],{type:kept.blob.type});
    kept.url=URL.createObjectURL(kept.blob);}).catch(()=>{/* keep the file as recorded */});}
function finishTake(t){
  closeTake(t);
  document.getElementById("recmark").hidden=true;
  [t.capture,t.stem].forEach(c=>{if(c&&c.meta){c.meta.markers=t.markers||[];if(t.songPlay)c.meta.songPlay=t.songPlay;}});
  const blob=new Blob(t.chunks,{type:t.mime||"audio/webm"});
  if(state.recTake)releaseTake(state.recTake);
  const kept=state.recTake={blob,url:URL.createObjectURL(blob),name:takeName(t.date,recExt(t.mime),t.key,t.bpm,t.info),wav:null,info:t.info,markers:t.markers||[],calMs:state.cal?state.cal.ms:null,songId:(t.info&&t.info.songId)||null};
  state.rec=null;inputIdle();
  const secs=Math.round((Date.now()-t.t0)/1000);
  const marks=(t.markers||[]).length;
  const what=(t.capture&&t.capture.failed?"Storage ran out, so the take stopped there. ":"")
    +`Take saved: ${secs} s, ${t.mono?"mono":"stereo"}.`
    +(marks?` ${marks} mistake${marks===1?"":"s"} marked at ${t.markers.map(m=>mmss(m.t)).join(", ")}.`:"")+(t.note?" "+t.note:"");
  showTake();recButtons();recSay(what+" Making the WAV…");
  // The raw master, when there is one: its length is exact to the sample, and its WAV
  // is assembled from storage when you download it.
  return Promise.all([endCapture(t.capture),endCapture(t.stem)]).then(([meta,stemMeta])=>{
    if(stemMeta&&stemMeta.frames){kept.stemMeta=stemMeta;kept.stemSize=wavSize(stemMeta.frames,1,bitsOf(stemMeta));}
    if(meta&&meta.frames){
      kept.wav={meta,name:kept.name.replace(/\.\w+$/,".wav"),size:wavSize(meta.frames,meta.channels,bitsOf(meta)),blob:null,url:null,
        channels:meta.channels,seconds:meta.frames/meta.sampleRate};
      return fixTakeLength(kept,meta.frames/meta.sampleRate).then(storageNote).then(note=>{
        if(state.recTake!==kept)return;
        showTake();recSay(what+(note?" "+note:""));listSaved();
        return typeof libKeep==="function"?libKeep(kept,t,meta,stemMeta).catch(keepFailed):null;});}
    return decodedWav(kept,t,blob,what).then(()=>typeof libKeep==="function"?libKeep(kept,t,null,stemMeta&&stemMeta.frames?stemMeta:null).catch(keepFailed):null);});}
// Without a raw master, the WAV is decoded from the compressed file. The decoded
// length is exact; without a decoder, the recorder's own clock will do.
function decodedWav(kept,t,blob,what){
  return takeToWav(blob,t.mono).then(({wav,seconds,channels})=>fixTakeLength(kept,seconds).then(()=>{
    if(state.recTake!==kept)return;
    kept.wav={blob:wav,url:URL.createObjectURL(wav),name:kept.name.replace(/\.\w+$/,".wav"),channels,seconds};
    showTake();recSay(what);
  }),()=>fixTakeLength(kept,(Date.now()-t.t0)/1000).then(()=>{
    if(state.recTake!==kept)return;
    showTake();recSay(what+" This browser can't decode it, so there is no WAV copy.");}));}
// The library could not keep a take: say so (once more storage may be full), unless the
// browser simply has no storage, which needs no warning.
function keepFailed(e){
  if(e&&e.message==="no IndexedDB")return;
  const el=document.getElementById("recmsg");
  recSay((el?el.textContent+" ":"")+"It could not be kept in the library (browser storage may be full): download it now.");}
function showTake(){
  const t=state.recTake,play=document.getElementById("recplay");
  const c=document.getElementById("recdlc"),w=document.getElementById("recdlw"),m=document.getElementById("recdlm");
  document.getElementById("recdone").hidden=!t;
  play.hidden=c.hidden=!t;w.hidden=!(t&&t.wav);m.hidden=w.hidden||typeof Worker!=="function";
  const sd=document.getElementById("recdls");sd.hidden=!(t&&t.stemMeta&&!t.stemGone);
  if(!t)return;
  document.getElementById("recdonehead").textContent=`Your take is ready: ${t.name.replace(/\.\w+$/,"")}`;
  if(t.stemMeta)sd.textContent=`Download solo only (WAV, ${fileSize(t.stemSize||0)})`;
  play.src=t.url;
  c.textContent=`Download compressed (${fileSize(t.blob.size)})`;
  if(!t.wav)return;
  w.textContent=`Download WAV (${fileSize(t.wav.blob?t.wav.blob.size:t.wav.size)})`;
  // MP3 is encoded on the first click; until then its size is the bitrate's estimate.
  if(!t.mp3Busy)m.textContent=t.mp3&&t.mp3.kbps===mp3Kbps(t.wav.channels)?`Download MP3 (${fileSize(t.mp3.blob.size)})`
    :`Download MP3 (~${fileSize(Math.round(mp3Kbps(t.wav.channels)*125*(t.wav.seconds||0)))})`;}
// Your guitar alone from a take that also has backing in it: the stem's master, as a
// WAV. Like the take's own WAV it is your copy once downloaded, so it is dropped from
// storage afterwards.
function downloadSolo(){
  const t=state.recTake;
  if(!t||!t.stemMeta)return Promise.resolve();
  return masterWav(t.stemMeta).then(b=>{
    if(!b){recSay("The solo-only master couldn't be read.");return;}
    saveFile({url:URL.createObjectURL(b),name:t.stemMeta.name&&/\.wav$/.test(t.stemMeta.name)?t.stemMeta.name:t.name.replace(/\.\w+$/,"-solo.wav")});
    t.stemGone=true;showTake();
    return dropTake(t.stemMeta.id).then(listSaved,listSaved);
  }).catch(()=>recSay("The solo-only master couldn't be read."));}
// ---- MP3 ----
// Encoded from the lossless master (never from the compressed file, which would
// compress it twice) by LAME in mp3-worker.js, off the main thread.
const mp3Kbps=ch=>MP3_QUALITY[state.mp3Quality].kbps[ch===2?1:0];
// The samples of a take's WAV: the stored master while it is there, else the page's
// WAV copy with its 44-byte header skipped.
function wavPcm(w){
  if(!w.blob)return masterPcm(w.meta).then(pcm=>({pcm,channels:w.meta.channels,sampleRate:w.meta.sampleRate,bits:bitsOf(w.meta)}));
  return w.blob.arrayBuffer().then(buf=>{
    const v=new DataView(buf),bits=v.getUint16(34,true)===24?24:16;
    return {pcm:[bits===24?new Uint8Array(buf.slice(44)):new Int16Array(buf.slice(44))],
      channels:v.getUint16(22,true),sampleRate:v.getUint32(24,true),bits};});}
function encodeMp3({pcm,channels,sampleRate,bits=16},onProgress){
  if(typeof Worker!=="function")return Promise.reject(new Error("no Worker"));
  const total=pcm.reduce((n,p)=>n+p.length/channels/(bits===24?3:1),0);
  if(!total)return Promise.reject(new Error("nothing to encode"));
  return new Promise((ok,fail)=>{
    const w=new Worker("mp3-worker.js");
    w.onmessage=e=>{
      const m=e.data||{};
      if(typeof m.progress==="number"&&onProgress)onProgress(m.progress/total);
      if(m.done){w.terminate();ok(m.done);}
      if(m.error){w.terminate();fail(new Error(m.error));}};
    w.onerror=()=>{w.terminate();fail(new Error("the MP3 encoder failed to start"));};
    w.postMessage({start:{channels,sampleRate,kbps:mp3Kbps(channels)}});
    pcm.forEach(p=>w.postMessage({pcm:p,bits}));
    w.postMessage({end:true});});}
function downloadMp3(){
  const t=state.recTake;
  if(!t||!t.wav||t.mp3Busy)return Promise.resolve();
  if(t.mp3&&t.mp3.kbps===mp3Kbps(t.wav.channels)){saveFile(t.mp3);return Promise.resolve();}
  const b=document.getElementById("recdlm");
  t.mp3Busy=true;b.disabled=true;b.textContent="Encoding MP3\u2026";
  const done=()=>{t.mp3Busy=false;b.disabled=false;if(state.recTake===t)showTake();};
  return wavPcm(t.wav).then(src=>encodeMp3(src,f=>{b.textContent=`Encoding MP3\u2026 ${Math.round(f*100)}%`;})).then(blob=>{
    if(t.mp3&&t.mp3.url)try{URL.revokeObjectURL(t.mp3.url);}catch(e){/* already released */}
    t.mp3={blob,url:URL.createObjectURL(blob),name:t.name.replace(/\.\w+$/,".mp3"),kbps:mp3Kbps(t.wav.channels)};
    done();saveFile(t.mp3);
  },()=>{done();recSay("The MP3 couldn't be made in this browser. The WAV and compressed files are still there.");});}
// The WAV of the take on screen. A stored master is assembled on the first click and
// then dropped from storage — the download is your copy — while this page keeps it
// for another click.
function downloadWav(){
  const t=state.recTake,w=t&&t.wav;
  if(!w)return Promise.resolve();
  if(w.blob){saveFile(w);return Promise.resolve();}
  return masterWav(w.meta).then(b=>{
    if(!b){recSay("The stored master couldn't be read, so there is no WAV to download.");return;}
    w.blob=b;w.url=URL.createObjectURL(b);saveFile(w);
    return dropTake(w.meta.id).then(listSaved,listSaved);
  }).catch(()=>recSay("The stored master couldn't be read, so there is no WAV to download."));}
// ---- saved takes ----
// Masters still in storage: not downloaded yet, or cut off by a crash or a closed
// tab. Each can be downloaded as a WAV or discarded. The Songs view will grow from
// this list.
function listSaved(){
  const box=document.getElementById("recsaved");
  const current=[state.recTake&&state.recTake.wav&&state.recTake.wav.meta&&state.recTake.wav.meta.id,
    state.recTake&&state.recTake.stemMeta&&state.recTake.stemMeta.id,
    state.rec&&state.rec.capture&&state.rec.capture.id,state.rec&&state.rec.stem&&state.rec.stem.id];
  return savedTakes().then(list=>{
    list=list.filter(m=>!current.includes(m.id)).sort((a,b)=>(b.started||0)-(a.started||0));
    state.savedList=list;
    box.innerHTML=list.length?`<b>Saved masters</b> (not downloaded yet)<br>`+list.map(m=>{
      const secs=Math.round((m.frames||0)/m.sampleRate),len=`${Math.floor(secs/60)}:${String(secs%60).padStart(2,"0")}`;
      const name=typeof m.name==="string"?m.name:"practice take";
      return `${m.status==="done"?"":"<b>Interrupted:</b> "}${escapeHTML(name)} \u00b7 ${len} \u00b7 ${fileSize(wavSize(m.frames||0,m.channels,bitsOf(m)))} `
        +`<button data-dl="${escapeHTML(m.id)}">Download WAV</button> `
        +(typeof Worker==="function"?`<button data-mp3="${escapeHTML(m.id)}">MP3</button> `:"")
        +`<button data-drop="${escapeHTML(m.id)}">Discard</button>`;}).join("<br>"):"";
  }).catch(()=>{box.innerHTML="";});}
function savedAction(e){
  const d=e&&e.target&&e.target.dataset;
  if(!d)return Promise.resolve();
  const m=(state.savedList||[]).find(x=>x.id===d.dl||x.id===d.drop||x.id===d.mp3);
  if(!m)return Promise.resolve();
  if(d.drop)return dropTake(m.id).then(listSaved,listSaved);
  // An MP3 is a copy for sharing, not the master, so the master stays stored.
  if(d.mp3)return masterPcm(m).then(pcm=>encodeMp3({pcm,channels:m.channels,sampleRate:m.sampleRate,bits:bitsOf(m)})).then(b=>{
    const base=typeof m.name==="string"&&/\.wav$/.test(m.name)?m.name:"practice-take.wav";
    saveFile({url:URL.createObjectURL(b),name:base.replace(/\.wav$/,".mp3")});
  },()=>recSay("The MP3 couldn't be made from that take."));
  return masterWav(m).then(b=>{
    if(!b){recSay("Nothing usable was left of that take, so it has been discarded.");return dropTake(m.id).then(listSaved);}
    const name=typeof m.name==="string"&&/\.wav$/.test(m.name)?m.name:"practice-take.wav";
    saveFile({url:URL.createObjectURL(b),name});
    return dropTake(m.id).then(listSaved,listSaved);
  }).catch(()=>recSay("That take couldn't be read from storage."));}
// ---- input check and level meter ----
// While the input is open — Check input, monitoring, armed, recording, or the idle
// minutes after — two bars show the level of Input 1 and Input 2, so you can see
// which one the guitar is in (a Scarlett Solo's mic socket is 1, its instrument jack
// 2). Clicking a bar picks that input. The line beside them says what to fix.
const METER_FLOOR=-60, METER_SILENT=-55, METER_HOT=-6, METER_CLIP=-1;
const dbOf=x=>x>0?20*Math.log10(x):-Infinity;
function meterAttach(ac,stream){
  if(state.meter&&state.meter.stream===stream)return;
  meterDetach();
  if(!ac.createAnalyser||!ac.createChannelSplitter)return;
  const src=ac.createMediaStreamSource(stream),split=ac.createChannelSplitter(2);
  src.connect(split);
  const an=[0,1].map(i=>{const x=ac.createAnalyser();x.fftSize=1024;split.connect(x,i,0);return x;});
  const tr=stream.getAudioTracks&&stream.getAudioTracks()[0];
  const chans=(tr&&tr.getSettings&&tr.getSettings().channelCount)||2;
  const m=state.meter={stream,src,an,chans,shown:[METER_FLOOR,METER_FLOOR],buf:new Float32Array(1024),clipAt:0,quiet:0,timer:null};
  document.getElementById("recmeter").hidden=false;
  document.getElementById("recbar1").hidden=chans<2;
  m.timer=setInterval(()=>meterTick(m),60);
  meterTick(m);}
function meterDetach(){
  const m=state.meter;
  if(!m)return;
  state.meter=null;clearInterval(m.timer);
  try{m.src.disconnect();}catch(e){/* already gone */}
  document.getElementById("recmeter").hidden=true;}
// Peak level of each input in dB, falling back slowly so a note stays readable.
function meterRead(m){
  return m.an.map((x,i)=>{
    x.getFloatTimeDomainData(m.buf);
    let pk=0;for(let j=0;j<m.buf.length;j++){const v=Math.abs(m.buf[j]);if(v>pk)pk=v;}
    const db=i<m.chans?dbOf(pk):-Infinity;
    return m.shown[i]=Math.max(db,m.shown[i]-1.5,METER_FLOOR);});}
function meterTick(m){
  const lv=meterRead(m),now=Date.now(),sel=state.recChannel;
  lv.forEach((db,i)=>{
    const f=document.getElementById("recfill"+i),pct=Math.max(0,Math.min(100,(db-METER_FLOOR)/-METER_FLOOR*100));
    f.style.width=pct+"%";
    f.style.background=db>=METER_CLIP?"var(--pink)":db>=METER_HOT?"var(--gold)":"var(--blue)";
    const b=document.getElementById("recbar"+i);
    // aria-current, not aria-pressed: pressed buttons are painted solid blue, which
    // would hide the level inside the very bar you chose
    b.setAttribute("aria-current",sel===i);
    b.style.outline=sel===i?"2px solid var(--blue)":"";});
  // the input that counts: the chosen one, or with Both inputs the louder
  const at=sel>=0?sel:(lv[1]>lv[0]?1:0),other=1-at,name=sel>=0?`Input ${sel+1}`:"the input";
  if(lv[at]>=METER_CLIP)m.clipAt=now;
  m.quiet=lv[at]<METER_SILENT?m.quiet+1:0;
  let say;
  if(sel>=0&&m.chans>1&&lv[at]<METER_SILENT&&lv[other]>=METER_SILENT)
    say=`Signal is on Input ${other+1}, not Input ${sel+1}: click Input ${other+1} to switch.`;
  else if(sel<0&&m.chans>1&&lv[at]>=METER_SILENT&&lv[other]<METER_SILENT)
    say=`Signal on Input ${at+1} only: click it to record just that input, centred at full level.`;
  else if(now-m.clipAt<2000)say="Too loud: it's clipping. Turn the gain knob down until the ring stays green.";
  else if(lv[at]<METER_SILENT)
    say=`No signal on ${name}. Play a note; if no bar moves, check the cable, the gain and the INST button.`;
  else if(lv[at]>=METER_HOT)say="Hot: fine on its own, but turn the gain down a little before recording with backing.";
  else say=`Good level on ${name}.`;
  document.getElementById("reclevel").textContent=say;}
function checkButton(){document.getElementById("reccheck").setAttribute("aria-pressed",state.checking);}
function toggleCheck(){
  if(state.checking){state.checking=false;checkButton();inputIdle();return;}
  const a=audio(),ac=a&&a.context;
  if(!ac||!ac.createAnalyser){recSay("Checking the input needs Web Audio, which this browser withholds.");return;}
  return openCheck().then(()=>{listInputs();recSay("Checking the input: play a note and watch which bar moves. Nothing goes to the speakers.");});}
// Opening a different device releases the old input, which clears checking, so it
// is set once the new one is open.
function openCheck(){
  return acquireInput(false).then(()=>{state.checking=true;checkButton();})
    .catch(e=>{state.checking=false;checkButton();recSay(inputError(e));});}
function restartCheck(){if(state.checking)openCheck();}
function pickChannel(i){
  state.recChannel=i;
  document.getElementById("recchan").value=String(i);
  restartMonitor();
  if(state.meter)meterTick(state.meter);}

// ---- latency calibration ----
// Playing a note and hearing it recorded takes a moment: the output's delay, then the
// input's. Against a backing take, your guitar lands that much late. Two ways to
// measure it, and a manual trim; the result is stored with every take so timing
// feedback and overdubs (later passes) can put layers back on the beat.
//   loopback: a beep is played, and the raw capture hears it come back on the input —
//   through speakers to a microphone, or an interface's output patched to its
//   input. Sample-accurate: the beep's frame is known, and so is the frame it appears at.
//   tap along: for headphones, where nothing can come back. You tap on each click
//   of a steady beat; the median gap between click and tap is your offset.
const CAL_KEY="practice-desk-calibration";
function readCal(){
  try{const v=JSON.parse(window.localStorage.getItem(CAL_KEY)||"null");
    if(v&&Number.isFinite(v.ms)&&v.ms>=-500&&v.ms<=1000)
      state.cal={ms:Math.round(v.ms),how:["loopback","tap","manual"].includes(v.how)?v.how:"manual",at:Number.isFinite(v.at)?v.at:0};}
  catch(e){/* nothing stored, or unreadable: not calibrated */}}
function writeCal(){try{window.localStorage.setItem(CAL_KEY,JSON.stringify(state.cal));}catch(e){/* this visit only */}}
const CAL_HOW={loopback:"loopback beep",tap:"tap along",manual:"set by hand"};
function calSay(text){document.getElementById("calmsg").textContent=text;}
function calShow(){
  const c=state.cal,ms=document.getElementById("calms");
  ms.value=c?String(c.ms):"";
  calSay(c?`Calibrated: guitar arrives ${c.ms} ms after the backing (${CAL_HOW[c.how]}). Stored with every take.`
    :"Not calibrated yet. Overdubs and timing feedback line up better once this is done.");}
function setCal(ms,how){
  if(!Number.isFinite(ms))return;
  state.cal={ms:Math.max(-500,Math.min(1000,Math.round(ms))),how,at:Date.now()};
  writeCal();calShow();}
function calBusy(on){
  ["calloop","caltap"].forEach(id=>{document.getElementById(id).disabled=on;});
  document.getElementById("recbtn").disabled=on;}
// Waits for the audio clock to reach a time, then calls back. Polling a timer keeps it
// on the same clock as everything else; a page timer alone would drift from it.
function whenAudioTime(ac,t,fn){
  const id=setInterval(()=>{if(ac.currentTime>=t){clearInterval(id);fn();}},25);
  return id;}
// The first sample that stands clear of the noise before the beep, or -1.
function findOnset(samples,quietFrames){
  let noise=0,n=Math.max(1,Math.min(quietFrames,samples.length));
  for(let i=0;i<n;i++)noise+=samples[i]*samples[i];
  noise=Math.sqrt(noise/n);
  let peak=0;for(let i=0;i<samples.length;i++)peak=Math.max(peak,Math.abs(samples[i]));
  const thr=Math.max(.02,noise*6);
  if(peak<thr*1.5)return -1;
  for(let i=Math.round(n);i<samples.length;i++)if(Math.abs(samples[i])>thr)return i;
  return -1;}
function calibrateLoopback(){
  if(state.calRun)return;
  const a=audio(),ac=a&&a.context;
  if(!ac||!ac.audioWorklet||typeof AudioWorkletNode!=="function"||typeof a.blip!=="function"){
    calSay("Loopback needs Web Audio and audio worklets, which this browser withholds. Try tapping along instead.");return;}
  calBusy(true);calSay("Listening: a short beep is about to play. Keep the input's gain up, and the beep loud enough to reach it.");
  const fail=msg=>{state.calRun=null;calBusy(false);calSay(msg);};
  state.calRun={};
  Promise.all([workletReady(ac),acquireInput(false)]).then(([ok,input])=>{
    if(!ok){fail("The capture script couldn't load, so loopback isn't available here. Try tapping along instead.");return;}
    const sr=ac.sampleRate,src=ac.createMediaStreamSource(input);
    const node=new AudioWorkletNode(ac,"take-capture",{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],
      channelCount:1,channelCountMode:"explicit",channelInterpretation:"speakers",processorOptions:{channels:1,block:2400}});
    src.connect(node);node.connect(ac.destination);
    const blocks=[],t0=ac.currentTime,startFrame=Math.round((t0+.2)*sr),beepFrame=Math.round((t0+.7)*sr);
    node.port.onmessage=e=>{const m=e.data||{};if(Array.isArray(m.block)&&m.block[0])blocks.push(m.block[0]);};
    node.port.postMessage({start:startFrame});
    a.blip(1200,{when:.7,dur:.18,vol:.9});
    whenAudioTime(ac,t0+1.9,()=>{
      node.port.postMessage({stop:true});
      try{src.disconnect();node.disconnect();}catch(e){/* already gone */}
      inputIdle();
      const n=blocks.reduce((k,b)=>k+b.length,0),all=new Float32Array(n);
      let o=0;for(const b of blocks){all.set(b,o);o+=b.length;}
      const at=findOnset(all,Math.round(.4*sr)),ms=at<0?NaN:(startFrame+at-beepFrame)/sr*1000;
      if(!Number.isFinite(ms))fail("Didn't hear the beep. Loopback needs the input to hear the output: turn the speakers up near the microphone, or patch the interface's output back into its input, then try again. With headphones, use tap along.");
      else if(ms<0||ms>500)fail(`Heard something ${Math.round(ms)} ms off, which isn't the beep coming back (a room's own noise, probably). Try again somewhere quieter.`);
      else{state.calRun=null;calBusy(false);setCal(ms,"loopback");}});
  }).catch(e=>{fail(inputError(e));});}
function calibrateTap(){
  if(state.calRun)return;
  const a=audio(),ac=a&&a.context;
  if(!ac||typeof a.blip!=="function"){calSay("Tap along needs Web Audio, which this browser withholds. Set the trim by hand instead.");return;}
  const gap=.6,count=12,first=ac.currentTime+.8,clicks=[],taps=[];
  for(let k=0;k<count;k++){clicks.push(first+k*gap);a.blip(k%4===0?1400:900,{when:first+k*gap-ac.currentTime,dur:.05,vol:.6});}
  calBusy(true);
  const btn=document.getElementById("caltapbtn");btn.hidden=false;
  calSay("Tap the big button (or press Space) exactly on each click, the way you would play a note on it. Twelve clicks.");
  state.calRun={taps};
  const tap=()=>{if(state.calRun&&state.calRun.taps===taps)taps.push(ac.currentTime);};
  state.calRun.tap=tap;
  whenAudioTime(ac,first+(count-1)*gap+.5,()=>{
    state.calRun=null;btn.hidden=true;calBusy(false);
    // each tap against the nearest click; the first two clicks are for getting the feel
    const diffs=[];
    taps.forEach(t=>{const k=Math.round((t-first)/gap);if(k>=2&&k<count&&Math.abs(t-clicks[k])<gap/2)diffs.push(t-clicks[k]);});
    if(diffs.length<5){calSay("Too few taps landed near the clicks. Try again, tapping on each click.");return;}
    diffs.sort((x,y)=>x-y);
    const med=diffs[diffs.length>>1],spread=diffs[Math.floor(diffs.length*.75)]-diffs[Math.floor(diffs.length*.25)];
    setCal(med*1000,"tap");
    calSay(`Calibrated: guitar arrives ${state.cal.ms} ms after the backing (tap along; your taps varied by about ${Math.round(spread*1000)} ms). Stored with every take.`);});}

// ---- the mistake marker ----
// M, or the big button, marks the moment in the take that you want to come back to.
// Its time is on the audio clock, from the take's first sample.
function markMistake(){
  const r=state.rec;
  if(!r||r.phase!=="recording")return false;
  const ac=state.engine&&state.engine.context;
  const t=ac&&r.acStart!==undefined?ac.currentTime-r.acStart:(Date.now()-r.t0)/1000;
  (r.markers||(r.markers=[])).push({t:Math.max(0,Math.round(t*1000)/1000),kind:"mistake"});
  if(r.capture&&r.capture.meta){r.capture.meta.markers=r.markers;
    r.capture.writes=r.capture.writes.then(()=>dbDo("takes","readwrite",tx=>{tx.objectStore("takes").put(Object.assign({},r.capture.meta));})).catch(()=>{});}
  const b=document.getElementById("recmark");b.textContent=`Mark a mistake (M) · ${r.markers.length} so far`;
  return true;}
const typingIn=el=>!!el&&(el.tagName==="INPUT"||el.tagName==="SELECT"||el.tagName==="TEXTAREA"||el.isContentEditable===true);
document.addEventListener("keydown",e=>{
  if(e.metaKey||e.ctrlKey||e.altKey||typingIn(e.target))return;
  if(state.calRun&&state.calRun.tap&&e.key===" "){e.preventDefault();state.calRun.tap();return;}
  if(e.key==="m"||e.key==="M"){if(markMistake())e.preventDefault();}});
const mmss=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`;

// ---- monitor input ----
// Sends the input to the speakers, for headphones that aren't on the interface — a
// USB headphone amp, say. It goes straight to the output, past the engine's master
// bus, so a backing take never records the guitar twice. Through the browser it is
// heard late by the round trip: fine to play to, not as tight as the interface's
// own direct monitoring.
function monButton(){
  const b=document.getElementById("recmon"),m=state.monitor;
  b.textContent=m&&m.opening?"Opening…":"Monitor input";
  b.setAttribute("aria-pressed",!!m);}
function toggleMonitor(){
  if(state.monitor){stopMonitor();recSay("Monitoring off.");return;}
  const a=audio(),ac=a&&a.context;
  if(!ac||!ac.createMediaStreamSource){recSay("Monitoring needs Web Audio, which this browser withholds.");return;}
  const pending=state.monitor={opening:true};
  monButton();
  return acquireInput(false).then(input=>{
    if(state.monitor!==pending){inputIdle();return;}
    const n=inputNode(ac,input,state.recChannel),gain=ac.createGain();
    n.link(gain);gain.connect(ac.destination);
    state.monitor={input,src:n.src,gain};
    monButton();listInputs();
    const late=recLatencyMs(ac,input);
    recSay("Monitoring your input"+(late?`, heard about ${late} ms after you play`:"")
      +". Use headphones: through speakers, a microphone feeds back."+(n.note?" "+n.note:""));
  }).catch(e=>{if(state.monitor===pending){state.monitor=null;monButton();recSay(inputError(e));inputIdle();}});}
function stopMonitor(){
  const m=state.monitor;
  if(!m)return;
  state.monitor=null;
  [m.gain,m.src].forEach(n=>{if(n)try{n.disconnect();}catch(e){/* already gone */}});
  inputIdle();monButton();}
// A new device or channel applies at once to a running monitor.
function restartMonitor(){if(state.monitor&&!state.monitor.opening){stopMonitor();toggleMonitor();}}
function saveFile(f){
  if(!f)return;
  const a=document.createElement("a");
  a.href=f.url;a.download=f.name;a.hidden=true;
  document.body.appendChild(a);a.click();if(a.remove)a.remove();
  // say where it went: the browser, not this page, decides, and it saves without asking
  if(f.name&&typeof recSay==="function")recSay(`Downloaded ${f.name}. It is in your browser's Downloads folder.`);}
// ---------- major pentatonic: the diagonal shape ----------
// A different diagram from everything above: the neck runs downwards, low E on the
// left, so one continuous run up the fretboard reads as a single diagonal. It keeps
// its own tuning array (low E first, the reverse of OPEN) and its own key list,
// because major keys need the flat spellings that the sharps-only NOTES table has no
// room for.
const MAJ_OPEN=[4,9,2,7,11,4], MAJ_SL=["E","A","D","G","B","e"];
const MAJ_PAT=[[0,2],[0,2,4],[2,4],[2,4,6],[5,7],[5,7,9]];
const FLATS=["C","D\u266d","D","E\u266d","E","F","G\u266d","G","A\u266d","A","B\u266d","B"];
const MAJ_DEG={0:"1",2:"2",4:"3",7:"5",9:"6"};
// s = pitch class of the root, f = spell this key with flats
const MAJKEYS=[
  {n:"C",s:0,f:0},{n:"G",s:7,f:0},{n:"D",s:2,f:0},{n:"A",s:9,f:0},
  {n:"E",s:4,f:0},{n:"B",s:11,f:0},{n:"F#",s:6,f:0},{n:"D\u266d",s:1,f:1},
  {n:"A\u266d",s:8,f:1},{n:"E\u266d",s:3,f:1},{n:"B\u266d",s:10,f:1},{n:"F",s:5,f:1}];
const majName=(sem,flat)=>(flat?FLATS:NOTES)[((sem%12)+12)%12];
// The root sits on the A string, so its fret is the distance from that string's
// open A up to the key.
const majRoot=()=>(((MAJKEYS[state.majorKey].s-9)%12)+12)%12;

function majorBoard(){
  const K=MAJKEYS[state.majorKey],R=majRoot(),start=Math.max(0,R-1),rows=13;
  const X=[62,110,158,206,254,302],TOP=44,BH=42,H=TOP+rows*BH+16;
  let o=`<svg viewBox="0 0 340 ${H}" role="img" aria-label="${K.n} major pentatonic, root at fret ${R} on the A string">`;
  o+=`<defs><marker id="majarrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">`
    +`<path d="M2 1L8 5L2 9" fill="none" stroke="var(--gold)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>`;
  for(let i=0;i<6;i++)o+=`<text x="${X[i]}" y="28" text-anchor="middle" font-size="11" fill="var(--ink)" opacity=".5" font-family="DM Mono,monospace">${MAJ_SL[i]}</text>`;
  for(let i=0;i<rows;i++){const f=start+i,yb=TOP+(i+1)*BH,yc=TOP+i*BH+BH/2;
    o+=`<line x1="62" y1="${yb}" x2="302" y2="${yb}" stroke="var(--ink)" stroke-width="${f===0?4:1.2}" opacity="${f===0?1:.42}"/>`;
    o+=`<text x="34" y="${yc}" text-anchor="middle" dominant-baseline="central" font-size="10.5" fill="var(--ink)" opacity=".5" font-family="DM Mono,monospace">${f}</text>`;
    if(MARKERS.includes(f))o+=`<circle cx="182" cy="${yc}" r="3.5" fill="var(--ink)" opacity=".3"/>`;
    if(DBLMARK.includes(f))o+=`<circle cx="134" cy="${yc}" r="3.5" fill="var(--ink)" opacity=".3"/><circle cx="230" cy="${yc}" r="3.5" fill="var(--ink)" opacity=".3"/>`;}
  for(let st=0;st<6;st++)o+=`<line x1="${X[st]}" y1="${TOP}" x2="${X[st]}" y2="${TOP+rows*BH}" stroke="var(--ink)" stroke-width="${1.6-st*.2}" opacity=".45"/>`;
  for(let st=0;st<6;st++){const p=MAJ_PAT[st];
    if(state.majorArrows&&p.length===3){
      const y2=TOP+((R+p[1])-start)*BH+BH/2,y3=TOP+((R+p[2])-start)*BH+BH/2;
      o+=`<line x1="${X[st]}" y1="${y2+18}" x2="${X[st]}" y2="${y3-19}" stroke="var(--gold)" stroke-width="1.8" marker-end="url(#majarrow)"/>`;}
    for(let i=0;i<p.length;i++){
      const fr=R+p[i],y=TOP+(fr-start)*BH+BH/2;
      const iv=(((MAJ_OPEN[st]+fr-K.s)%12)+12)%12,rt=iv===0;
      o+=`<circle cx="${X[st]+1.5}" cy="${y+1.5}" r="15" fill="${rt?"var(--blue)":"var(--pink)"}" opacity=".2"/>`;
      o+=`<circle class="majdot" fill="${rt?"var(--pink)":"var(--blue)"}" cx="${X[st]}" cy="${y}" r="15"/>`;
      o+=`<text x="${X[st]}" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="11" font-weight="500" fill="var(--card)" font-family="DM Mono,monospace">${state.majorDegrees?MAJ_DEG[iv]:majName(MAJ_OPEN[st]+fr,K.f)}</text>`;}}
  return o+"</svg>";
}

function majorTab(){const R=majRoot(),rows=[];
  for(let st=5;st>=0;st--)rows.push(MAJ_SL[st]+" |"+MAJ_PAT[st].map(v=>" "+(R+v)).join(""));
  return rows.join("\n");}

function renderMajor(){
  const K=MAJKEYS[state.majorKey],R=majRoot();
  document.getElementById("majorboard").innerHTML=majorBoard();
  document.getElementById("majorpos").textContent=`root \u00b7 A string, fret ${R}`;
  document.getElementById("majorcap").textContent=
    `${K.n} major pentatonic \u2014 the same notes as ${majName(K.s+9,K.f)} minor pentatonic, started from a different degree.`;
  document.getElementById("majortab").textContent=majorTab();
}

// ---------- modes ----------
// Two things the teaching literature agrees on, and this view is built around both.
//
// First: learn modes in PARALLEL, not relative. Comparing D dorian to C major tells
// you they share notes; it does not tell you what dorian sounds like. Holding the
// root still and changing one note does. So every mode here is drawn from the same
// root — the key selected at the top — and each one names the single note that
// separates it from the major or minor scale you already know.
//
// Second, and it is the reason this view leads with a warning: a shape is not a
// mode. Play A dorian's notes over an Am–D vamp and you hear dorian; play exactly
// the same notes over a C chord and you hear C major. The shape is fingering. The
// harmony underneath is what makes it modal, which is what the drone is for.
const MODES=[
  {id:"ionian",name:"Ionian",sub:"the major scale",family:"Major-scale modes",
   offs:[0,2,4,5,7,9,11],degs:["1","2","3","4","5","6","7"],colour:[11],
   near:"This is the major scale — the reference the other six are measured against.",
   sound:"Bright, resolved, unambiguous. Every other mode here is this scale with something moved.",
   vamp:"Imaj7 — hold the root drone and play the 7 against it."},
  {id:"dorian",name:"Dorian",sub:"minor with a bright 6",family:"Major-scale modes",
   offs:[0,2,3,5,7,9,10],degs:["1","2","♭3","4","5","6","♭7"],colour:[9],
   near:"Natural minor with the ♭6 raised to a natural 6. That one note is the whole mode.",
   sound:"Minor but not sad — hopeful, rolling. The workhorse minor mode of rock, funk and modal jazz.",
   vamp:"Im7 to IV7 — that IV chord is major only because of the natural 6."},
  {id:"phrygian",name:"Phrygian",sub:"minor with a ♭2",family:"Major-scale modes",
   offs:[0,1,3,5,7,8,10],degs:["1","♭2","♭3","4","5","♭6","♭7"],colour:[1],
   near:"Natural minor with the 2 flattened. The half step right above the root is the sound.",
   sound:"Dark, Spanish, tense. Resolving down onto the root from the ♭2 is the signature move.",
   vamp:"Im to ♭II — the ♭II chord a half step above home."},
  {id:"lydian",name:"Lydian",sub:"major with a #4",family:"Major-scale modes",
   offs:[0,2,4,6,7,9,11],degs:["1","2","3","#4","5","6","7"],colour:[6],
   near:"The major scale with the 4 raised. Nothing else changes.",
   sound:"Floating, weightless, wide-eyed. The film-score major sound.",
   vamp:"Imaj7 held still — the #4 only floats if nothing resolves it."},
  {id:"mixolydian",name:"Mixolydian",sub:"major with a ♭7",family:"Major-scale modes",
   offs:[0,2,4,5,7,9,10],degs:["1","2","3","4","5","6","♭7"],colour:[10],
   near:"The major scale with the 7 flattened — which is exactly what makes I a dominant 7 chord.",
   sound:"Major but bluesy and unresolved. The sound over every I7 in the 12-bar trainer.",
   vamp:"I7 — the mode and the chord are the same seven notes."},
  {id:"aeolian",name:"Aeolian",sub:"the natural minor scale",family:"Major-scale modes",
   offs:[0,2,3,5,7,8,10],degs:["1","2","♭3","4","5","♭6","♭7"],colour:[8],
   near:"The natural minor scale, and the parent of the minor pentatonic this whole app is built on.",
   sound:"Plain minor: sad, settled, familiar. Add the 2 and ♭6 to your pentatonic box and you are here.",
   vamp:"Im to ♭VI to ♭VII — the standard minor-key progression."},
  {id:"locrian",name:"Locrian",sub:"minor with ♭2 and ♭5",family:"Major-scale modes",
   offs:[0,1,3,5,6,8,10],degs:["1","♭2","♭3","4","♭5","♭6","♭7"],colour:[1,6],
   near:"Phrygian with the 5 flattened too. With no perfect fifth, the root barely holds.",
   sound:"Unstable by construction. Rare as a key; useful over a m7♭5 chord passing through.",
   vamp:"Im7♭5 — and expect to want to leave."},

  {id:"harmonicminor",name:"Harmonic minor",sub:"minor with a leading tone",family:"Beyond the major scale",
   offs:[0,2,3,5,7,8,11],degs:["1","2","♭3","4","5","♭6","7"],colour:[11],
   near:"Natural minor with the ♭7 raised to a natural 7, so V becomes a dominant chord that really pulls home.",
   sound:"Classical, dramatic. The three-semitone jump from ♭6 to 7 is the whole character.",
   vamp:"Im to V7 — the reason this scale exists."},
  {id:"melodicminor",name:"Melodic minor",sub:"minor with a major top",family:"Beyond the major scale",
   offs:[0,2,3,5,7,9,11],degs:["1","2","♭3","4","5","6","7"],colour:[9,11],
   near:"Natural minor with both the 6 and 7 raised — a major scale with a ♭3, if you prefer.",
   sound:"Smooth and modern; the parent scale behind most jazz alterations.",
   vamp:"Im(maj7) or Im6 — a minor chord with a major-scale top half."},
  {id:"phrygiandominant",name:"Phrygian dominant",sub:"♭2 over a major 3",family:"Beyond the major scale",
   offs:[0,1,4,5,7,8,10],degs:["1","♭2","3","4","5","♭6","♭7"],colour:[1,4],
   near:"Phrygian with the ♭3 raised to a major 3, which opens a three-semitone gap above the ♭2.",
   sound:"Flamenco, klezmer, Middle Eastern. The fifth mode of harmonic minor.",
   vamp:"I7 with a ♭9 — hold it and let the ♭2 grind."},
  {id:"byzantine",name:"Byzantine",sub:"double harmonic major",family:"Beyond the major scale",
   offs:[0,1,4,5,7,8,11],degs:["1","♭2","3","4","5","♭6","7"],colour:[1,8],
   near:"The major scale with both the 2 and the 6 flattened — 1 ♭2 3 4 5 ♭6 7.",
   sound:"The most dramatic scale here. Two three-semitone jumps, ♭2 to 3 and ♭6 to 7, one in each half.",
   vamp:"A major triad or a bare root drone — the scale supplies all the tension by itself."},
  {id:"hungarianminor",name:"Hungarian minor",sub:"4th mode of Byzantine",family:"Beyond the major scale",
   offs:[0,2,3,6,7,8,11],degs:["1","2","♭3","#4","5","♭6","7"],colour:[6,11],
   near:"Harmonic minor with the 4 raised, giving it a second three-semitone jump.",
   sound:"Harmonic minor pushed further: the same drama with a raised 4 on top.",
   vamp:"Im(maj7) — the raised 4 wants to fall to 5."},
  {id:"lydiandominant",name:"Lydian dominant",sub:"#4 and ♭7 together",family:"Beyond the major scale",
   offs:[0,2,4,6,7,9,10],degs:["1","2","3","#4","5","6","♭7"],colour:[6,10],
   near:"Mixolydian with a raised 4, or Lydian with a flattened 7 — both changes at once.",
   sound:"The bright, slightly unhinged dominant sound. Fourth mode of melodic minor.",
   vamp:"I7#11 — the #4 sits on top of a dominant chord instead of fighting it."},
];
const modeById=id=>MODES.find(m=>m.id===id)||MODES[1];
const currentMode=()=>modeById(state.modeId);

// A mode note carries its own label, because a mode spells its degrees its own way:
// the raised fourth is #4 in lydian, not the ♭5 the pentatonic table would call it.
function modeLabel(mode,i,pc){
  if(state.labelMode==="none")return "";
  return state.labelMode==="interval"?mode.degs[i]:NOTES[pc];
}
// Every note of the mode inside one fret window, across all six strings. The windows
// are the five pentatonic box neighbourhoods, so the shapes land where the hand
// already knows to go — the extra scale tones fill in around the box.
function modeNotes(mode,lo,hi){
  const out=[];
  for(let s=0;s<6;s++)for(let f=Math.max(0,lo);f<=hi;f++){
    const d=(noteAt(s,f)-state.key+12)%12,i=mode.offs.indexOf(d);
    if(i<0)continue;
    out.push({s,f,kind:d===0?"root":mode.colour.includes(d)?"pivot":"tone",
      ord:modeLabel(mode,i,noteAt(s,f))});}
  return out;
}
// Where each colour tone came from. A mode is the scale you already know with one
// or two notes moved, and the note it moved FROM is the thing worth showing: dorian
// is aeolian with the ♭6 pushed up a fret, and that is easier to watch than to read.
// The reference is natural minor for any mode with a ♭3, the major scale otherwise —
// whichever of the two the player already has under their fingers.
const MAJ_REF=[0,2,4,5,7,9,11], MIN_REF=[0,2,3,5,7,8,10];
function modeOrigins(mode){
  const ref=mode.offs.includes(3)?MIN_REF:MAJ_REF, o=new Map();
  mode.colour.forEach(d=>{
    if(ref.includes(d))return;                       // that note never moved
    const from=ref.filter(r=>!mode.offs.includes(r))
      .sort((a,b)=>Math.abs(a-d)-Math.abs(b-d))[0];
    if(from!==undefined&&Math.abs(from-d)<=2)o.set(d,from);});
  return o;
}
// The same scale across the whole neck, so a position can be seen in context.
// When the mode has just changed, each colour tone slides in from the note it
// replaced, with the old note left behind as a fading outline — the move an
// instructor makes with one finger while saying "this one goes up a fret".
function modeMap(mode,moved=false){
  const w=36,h=23,pad=30,cols=MAXFRET,W=pad+cols*w+14,H=pad+5*h+24;
  const from=modeOrigins(mode), anim=moved?" anim":"";
  let o=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${NOTES[state.key]} ${mode.name} across the neck">`;
  for(let i=0;i<=cols;i++){const x=pad+i*w;
    o+=`<line x1="${x}" y1="${pad}" x2="${x}" y2="${pad+5*h}" stroke="var(--ink)" stroke-width="${i===0?4:1.1}" opacity="${i===0?1:.32}"/>`;
    if(i>0)o+=`<text x="${x-w/2}" y="${pad+5*h+17}" font-size="10" fill="var(--ink)" opacity=".45" text-anchor="middle" font-family="DM Mono,monospace">${i}</text>`;}
  for(let r=0;r<6;r++)o+=`<line x1="${pad}" y1="${pad+r*h}" x2="${pad+cols*w}" y2="${pad+r*h}" stroke="var(--ink)" stroke-width="${.7+r*.25}" opacity=".5"/>`;
  for(let r=0;r<6;r++)for(let f=0;f<=cols;f++){
    const d=(noteAt(r,f)-state.key+12)%12;
    if(!mode.offs.includes(d))continue;
    const cx=f===0?pad-11:pad+(f-.5)*w,y=pad+r*h;
    const was=from.get(d), shift=was===undefined?null:f+(was-d);
    if(shift!==null&&shift>=0&&shift<=cols){
      const ox=shift===0?pad-11:pad+(shift-.5)*w;
      o+=`<circle class="modewas${anim}" cx="${ox}" cy="${y}" r="8.5" fill="none" stroke="var(--ink)" stroke-width="1.6"/>`;
      o+=`<circle class="modemove${anim}" style="--dx:${(ox-cx).toFixed(1)}px" cx="${cx}" cy="${y}" r="8.5" fill="var(--gold)"/>`;
      continue;}
    o+=`<circle cx="${cx}" cy="${y}" r="8.5" fill="${d===0?"var(--pink)":mode.colour.includes(d)?"var(--gold)":"var(--blue)"}"/>`;}
  return o+"</svg>";
}
function renderModes(){
  const mode=currentMode(),root=NOTES[state.key];
  const moved=state.lastMode!==null&&state.lastMode!==mode.id;   // a redraw is not a change
  state.lastMode=mode.id;
  const origins=modeOrigins(mode);
  document.querySelectorAll("#modes button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.m===state.modeId));
  const spelled=mode.offs.map((d,i)=>`${mode.degs[i]} <b>${NOTES[(state.key+d)%12]}</b>`).join(" · ");
  const colours=mode.colour.map(d=>`${mode.degs[mode.offs.indexOf(d)]} (${NOTES[(state.key+d)%12]})`).join(" and ");
  document.getElementById("modesummary").innerHTML=
    `<div class="card wide"><h2>${root} ${mode.name}<em>${mode.sub}</em></h2>
      <p class="tip" style="font-size:13px">${spelled}</p>
      <p class="tip"><b>What makes it this mode:</b> ${colours} — drawn gold in every diagram below.
        ${mode.near}</p>
      <p class="tip"><b>How it sounds:</b> ${mode.sound}</p>
      <p class="tip"><b>Play it over:</b> ${mode.vamp} Start the <b>Root drone</b> above, then play the shapes.
        Without that root under you, these are just notes from some major scale.</p>
      ${modeMap(mode,moved)}
      <p class="tip">The whole neck. Pink is the root ${root}; gold is the note that makes it ${mode.name}.${
        origins.size?` Each hollow ring is where that note sits in ${
          mode.offs.includes(3)?"natural minor":"the major scale"} — ${
          [...origins].map(([d,r])=>`the ${mode.degs[mode.offs.indexOf(d)]} is ${
            Math.abs(d-r)===1?"one fret":"two frets"} ${d>r?"above":"below"} the ${
            IV[r]}`).join(", ")}. Switch modes and watch the gold notes move.`:""}</p>
    </div>`;
  const laid=[...validBoxes()].sort((x,y)=>boxSpan(x).lo-boxSpan(y).lo);
  document.getElementById("modeboxes").innerHTML=laid.map((b,i)=>{
    const {lo,hi}=boxSpan(b),notes=modeNotes(mode,lo,hi);
    const has=d=>notes.some(n=>(noteAt(n.s,n.f)-state.key+12)%12===d);
    return `<div class="card"><h2>Position ${i+1}<em>fret ${Math.max(0,lo)}–${hi}</em></h2>
      ${fretboard(notes,{plain:true})}
      <p class="tip">${has(0)?"The root is in this shape — start and end phrases on it.":"No root in this window; lean on the note above or below it."}
        ${mode.colour.some(has)?`The gold ${mode.colour.length>1?"notes are":"note is"} here too: that is the sound to aim at.`
          :"None of the colour tones fall here — this window will sound neutral on its own."}</p>
      <p class="tip" style="opacity:.55">Same neighbourhood as pentatonic Box ${b.n}, with the rest of the scale filled in.</p>
    </div>`;}).join("");
}

// ---------- fretboard note names ----------
// The gap most players carry out of the beginner stage. Everything else in this app
// is a shape that can be moved without knowing what any of it is called; this is the
// view where the neck gets names.
//
// Two things do the work, in this order: the open strings and the octave shape,
// which together let any note be worked out in a second or two; then repetition on
// one string at a time, which is practice away from a screen rather than on it.
const NATURALS=[0,2,4,5,7,9,11];
// The five ways an octave sits on the neck. Two frets up and one string over is the
// one to learn first — it covers the E and A strings, which is where roots live.
const OCTAVES=[
  {n:"Low E to D string",from:[5,5],to:[3,7],
   tip:"Two frets up, skip one string. The bread-and-butter shape: the fret-5 A on the low E is the same A at fret 7 on the D."},
  {n:"A to G string",from:[4,5],to:[2,7],
   tip:"Identical shape one string set over. Root on the A string is where most barre chords and boxes are anchored."},
  {n:"D to B string",from:[3,5],to:[1,8],
   tip:"Three frets up, because the B string is tuned a half step tighter than the rest. Every shape crossing G to B shifts like this."},
  {n:"G to high e",from:[2,5],to:[0,8],
   tip:"Same three-fret version, same reason. Once the G-to-B step is in your hand, the whole neck behaves."},
  {n:"Low E to high e",from:[5,5],to:[0,5],
   tip:"The outer strings are the same note two octaves apart, so anything you know on one you already know on the other — at the same fret, no counting."},
];

// The whole neck, every position named. Naturals are drawn solid and sharps hollow,
// because the naturals are the map — the sharps are just the gaps between them.
function neckNames(){
  const w=40,h=30,pad=34,cols=MAXFRET,W=pad+cols*w+18,H=pad+5*h+28;
  let o=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="every note name on the fretboard">`;
  for(let i=0;i<=cols;i++){const x=pad+i*w;
    o+=`<line x1="${x}" y1="${pad}" x2="${x}" y2="${pad+5*h}" stroke="var(--ink)" stroke-width="${i===0?4:1.1}" opacity="${i===0?1:.3}"/>`;
    if(i>0){const mk=MARKERS.includes(i)||DBLMARK.includes(i);
      o+=`<text x="${x-w/2}" y="${pad+5*h+19}" font-size="${mk?11:10}" fill="var(--ink)" opacity="${mk?.75:.4}" text-anchor="middle" font-family="DM Mono,monospace">${i}</text>`;}}
  for(let r=0;r<6;r++){const y=pad+r*h;
    o+=`<line x1="${pad}" y1="${y}" x2="${pad+cols*w}" y2="${y}" stroke="var(--ink)" stroke-width="${.7+r*.25}" opacity=".45"/>`;
    o+=`<text x="${pad-16}" y="${y+4}" font-size="11" fill="var(--ink)" opacity=".55" text-anchor="middle" font-family="DM Mono,monospace">${SL[r]}</text>`;}
  for(let r=0;r<6;r++)for(let f=0;f<=cols;f++){
    const pc=noteAt(r,f),nat=NATURALS.includes(pc),lit=state.noteHL===pc,dim=state.noteString!==null&&state.noteString!==r;
    if(!nat&&!lit&&state.noteHL!==null)continue;
    const cx=f===0?pad-11:pad+(f-.5)*w,y=pad+r*h,op=dim?.12:1;
    if(lit)o+=`<circle cx="${cx}" cy="${y}" r="12" fill="var(--pink)" opacity="${op}"/>`;
    else if(nat)o+=`<circle cx="${cx}" cy="${y}" r="11" fill="var(--card)" stroke="var(--ink)" stroke-width="1.1" opacity="${op*.9}"/>`;
    o+=`<text x="${cx}" y="${y+3.6}" font-size="${NOTES[pc].length>1?8.5:10}" font-weight="${lit||nat?600:400}" opacity="${op*(nat||lit?1:.42)}" fill="${lit?"var(--card)":"var(--ink)"}" text-anchor="middle" font-family="DM Mono,monospace">${NOTES[pc]}</text>`;}
  return o+"</svg>";
}
// One octave shape, drawn on a bare fretboard so only the two dots and the gap
// between them are visible.
function octaveCard(o){
  const [s1,f1]=o.from,[s2,f2]=o.to;
  const notes=[{s:s1,f:f1,kind:"root",ord:NOTES[noteAt(s1,f1)]},
               {s:s2,f:f2,kind:"pivot",ord:NOTES[noteAt(s2,f2)]}];
  const dF=f2-f1,dS=s1-s2,octs=(midiAt(s2,f2)-midiAt(s1,f1))/12;
  const how=dF===0?"same fret":`${dF} fret${dF===1?"":"s"} up`;
  return `<div class="card"><h2>${o.n}<em>${how} · ${dS} strings over · ${octs===1?"one octave":octs+" octaves"}</em></h2>
    ${fretboard(notes,{plain:true,w:46})}<p class="tip">${o.tip}</p></div>`;
}
function renderNotes(){
  document.getElementById("neck").innerHTML=neckNames();
  document.querySelectorAll("#notepick button").forEach(b=>b.setAttribute("aria-pressed",+b.dataset.pc===state.noteHL));
  document.querySelectorAll("#stringpick button").forEach(b=>b.setAttribute("aria-pressed",+b.dataset.st===state.noteString));
  document.getElementById("necklabel").innerHTML=
    state.noteHL===null
      ? `Naturals are circled; the sharps between them are faint. <b>Pick a note above</b> to light up every place it lives.`
      : `Every <b>${NOTES[state.noteHL]}</b> on the neck — ${
          [0,1,2,3,4,5].reduce((n,r)=>n+[...Array(MAXFRET+1).keys()].filter(f=>noteAt(r,f)===state.noteHL).length,0)
        } of them in 24 frets. The same note, over and over: that is all the neck is.`;
  document.getElementById("octaves").innerHTML=OCTAVES.map(octaveCard).join("");
}

// ---------- triads ----------
// Chords are spelled as a guitarist reads them on a chart — E♭, A♭, B♭ rather than
// D#, G#, A# — here and in the explorers above these views (chord-explorer.js).
// The rung missing between a power chord and a scale. Three notes, one per string,
// covering three adjacent strings — small enough to grab anywhere on the neck, and
// the shape the chord tones in every other view are actually making.
const TRIAD_KINDS=[
  {id:"maj",name:"Major",sym:"",iv:[0,4,7],degs:["1","3","5"],
   tip:"Root, major 3rd, 5th. The 3rd is what makes it major — move it down one fret and the chord turns minor."},
  {id:"min",name:"Minor",sym:"m",iv:[0,3,7],degs:["1","♭3","5"],
   tip:"Root, ♭3, 5th. One fret lower than the major on exactly one note, and that one note carries the whole mood."},
  {id:"dim",name:"Diminished",sym:"dim",iv:[0,3,6],degs:["1","♭3","♭5"],
   tip:"A minor triad with the 5th flattened too. Tense and unstable — it wants to move somewhere."},
  {id:"aug",name:"Augmented",sym:"aug",iv:[0,4,8],degs:["1","3","#5"],
   tip:"A major triad with the 5th raised. Symmetrical, so the same shape repeats every four frets."},
];
// String indices are high-e-first, so set [0,1,2] is the top three strings.
const TRIAD_SETS=[
  {id:"123",name:"Strings 1–2–3",sub:"e B G",strings:[0,1,2],
   tip:"The top set. Highest and brightest — this is where triads sit over a band without covering the singer."},
  {id:"234",name:"Strings 2–3–4",sub:"B G D",strings:[1,2,3],
   tip:"The middle set. Fat enough to carry a rhythm part on its own, high enough to stay out of the bass."},
  {id:"345",name:"Strings 3–4–5",sub:"G D A",strings:[2,3,4],
   tip:"Lower and thicker. Start here if the top set sounds thin against a full band."},
  {id:"456",name:"Strings 4–5–6",sub:"D A E",strings:[3,4,5],
   tip:"The bottom set. Muddy on a clean amp and worse with distortion — useful, but use it sparingly."},
];
const triadKindById=id=>TRIAD_KINDS.find(k=>k.id===id)||TRIAD_KINDS[0];
const triadSetById=id=>TRIAD_SETS.find(s=>s.id===id)||TRIAD_SETS[0];

// One close voicing: put a chord tone on the lowest string of the set, then take the
// next chord tone above it on each higher string. Close voicing is what makes a triad
// a grabbable shape instead of three notes that happen to belong together.
function triadVoicing(strings,pcs,lowFret){
  const lo=strings[strings.length-1];
  const start=pcs.indexOf(noteAt(lo,lowFret));
  if(start<0)return null;
  const out=[{s:lo,f:lowFret}];
  let prev=midiAt(lo,lowFret);
  // Each higher string takes the NEXT chord tone in sequence, not merely the next
  // chord tone that happens to be higher. Adjacent strings overlap by five semitones,
  // so "any higher chord tone" can land on the note you just played an octave up —
  // which is how a C minor triad ends up spelled G C G.
  for(let i=strings.length-2,step=1;i>=0;i--,step++){
    const st=strings[i],want=pcs[(start+step)%pcs.length];
    let found=null;
    for(let f=0;f<=MAXFRET;f++){
      if(noteAt(st,f)!==want||midiAt(st,f)<=prev)continue;
      found=f;break;}
    if(found===null)return null;
    out.unshift({s:st,f:found});prev=midiAt(st,found);}
  const fs=out.map(n=>n.f);
  if(Math.max(...fs)-Math.min(...fs)>4)return null;   // beyond one hand position
  return out;
}
// Every close voicing of one triad on one string set, all the way up the neck.
// centre is the average fret, which is what "where the hand is" means when deciding
// which shape is nearest to the one before it.
function allTriadVoicings(rootPc,kind,set){
  const pcs=kind.iv.map(i=>(rootPc+i)%12),out=[];
  for(let f=0;f<=MAXFRET;f++){
    const v=triadVoicing(set.strings,pcs,f);
    if(!v)continue;
    const bass=(noteAt(v[v.length-1].s,v[v.length-1].f)-rootPc+12)%12;
    const inv=kind.iv.indexOf(bass);
    if(inv<0)continue;
    out.push({inv,notes:v,centre:v.reduce((a,n)=>a+n.f,0)/v.length});}
  return out;
}
// The three inversions of one triad on one string set, lowest on the neck first.
// Which chord tone is on the bottom string names the inversion.
function triadShapes(kind,set,rootPc=state.key){
  const out=[];
  for(const v of allTriadVoicings(rootPc,kind,set)){
    if(out.some(o=>o.inv===v.inv))continue;
    out.push(v);
    if(out.length===3)break;}
  return out.sort((a,b)=>a.inv-b.inv);
}
const INVERSION=["Root position","1st inversion","2nd inversion"];
// ---- the explorers at the top of Triads and Inversions ----
// Mounted the first time their view opens (web/triads-explorer.js and
// web/inversions-explorer.js, on web/chord-explorer.js). Each keeps its own Key
// menu, synced both ways with the toolbar's Root buttons. Their sound goes through
// the app's audio, so it works on the compatibility engine too.
const explorers={};
// The explorers' links into another view, as the Start here buttons do it.
function goToView(v){
  if(!VIEWS.some(([id])=>id===v))return;
  state.view=v;render();
  const title=document.getElementById("lessontitle");
  if(typeof title.focus==="function")title.focus({preventScroll:true});
  if(typeof title.scrollIntoView==="function")title.scrollIntoView({block:"start"});}
// A grip or chord: each note low to high, then all of them strummed together.
function playChordNotes(midis){
  const a=audio();if(!a||!Array.isArray(midis)||!midis.length)return;
  const gap=.22,strum=midis.length*gap+.25;
  midis.forEach((m,k)=>a.note(m,{when:k*gap,dur:1.3,vol:.45}));
  midis.forEach((m,k)=>a.note(m,{when:strum+k*.025,dur:1.6,vol:.38}));}
function mountExplorer(name,elId){
  const Mod=typeof globalThis!=="undefined"?globalThis[name]:undefined;
  if(explorers[name]){explorers[name].setKey(state.key);return;}
  const el=document.getElementById(elId);
  if(!Mod||typeof Mod.mount!=="function"||!el)return;   // its script didn't load: the rest of the view still works
  try{
    explorers[name]=Mod.mount(el,{key:state.key,playNotes:playChordNotes,playGrip:playChordNotes,
      onKeyChange:pc=>{state.key=pc;render();},onNavigate:goToView});
  }catch(e){explorers[name]=null;}}
function renderTriads(){
  mountExplorer("TriadsExplorer","triads-explorer");
  const kind=triadKindById(state.triadKind),set=triadSetById(state.triadSet),root=ROOT_NAMES[state.key];
  document.querySelectorAll("#triadkinds button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.tk===state.triadKind));
  document.querySelectorAll("#triadsets button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.ts===state.triadSet));
  const spelled=kind.iv.map((iv,i)=>`${kind.degs[i]} <b>${ROOT_NAMES[(state.key+iv)%12]}</b>`).join(" · ");
  document.getElementById("triadsummary").innerHTML=
    `<div class="card wide"><h2>${root}${kind.sym} on ${set.name.toLowerCase()}<em>${set.sub}</em></h2>
      <p class="tip" style="font-size:13px">${spelled}</p>
      <p class="tip">${kind.tip}</p>
      <p class="tip">${set.tip}</p>
      <p class="tip"><b>Three notes, three orders.</b> Whichever chord tone you put on the lowest string
        names the shape. All three are the same chord — they just sit in different places on the neck,
        which is how you play one chord anywhere without jumping.</p></div>`;
  const shapes=triadShapes(kind,set);
  document.getElementById("triadshapes").innerHTML=shapes.map(sh=>{
    const notes=sh.notes.map(n=>{
      const d=(noteAt(n.s,n.f)-state.key+12)%12,i=kind.iv.indexOf(d);
      return {...n,kind:d===0?"root":"tone",ord:state.labelMode==="none"?"":state.labelMode==="interval"?kind.degs[i]:ROOT_NAMES[noteAt(n.s,n.f)]};});
    const bass=notes[notes.length-1],lo=Math.min(...sh.notes.map(n=>n.f)),hi=Math.max(...sh.notes.map(n=>n.f));
    return `<div class="card"><h2>${INVERSION[sh.inv]}<em>fret ${lo}${hi>lo?"–"+hi:""}</em></h2>
      ${fretboard(notes,{plain:true,w:46})}
      <p class="tip" style="margin-top:12px"><b>Fingering</b>:</p>
      ${fingerBoard(sh.notes,{w:46})}
      ${fingerTable(sh.notes)}
      <p class="tip">${fingerHint(sh.notes)}</p>
      <p class="tip"><b>${kind.degs[sh.inv]} on the bottom</b> (${ROOT_NAMES[noteAt(bass.s,bass.f)]} on the ${SL[bass.s]} string).
        Reading up: ${notes.map(n=>ROOT_NAMES[noteAt(n.s,n.f)]).reverse().join(" – ")}.</p>
      <p class="tip" style="opacity:.6">${["The root is lowest, so this is the shape that sounds most settled.",
        "The 3rd is lowest, which lightens the chord and makes it lead somewhere.",
        "The 5th is lowest — the most open and least rooted of the three."][sh.inv]}</p></div>`;}).join("");
  document.getElementById("triadcount").innerHTML=shapes.length===3
    ? `Three shapes, then they repeat an octave higher. Learn these three on this string set and you can play ${root}${kind.sym} anywhere on the neck.`
    : `Only ${shapes.length} shape${shapes.length===1?"":"s"} fits inside the first 24 frets on this string set in this key.`;
}

// ---------- inversions ----------
// The Triads view shows the three shapes. This one is about why you would ever use
// the second and third, which is a different question and the one that actually
// changes how somebody plays.
//
// The argument is made by measurement rather than assertion: play a progression in
// root position only, then let each chord pick its nearest inversion, and count the
// frets the hand travels. The second number is usually a fraction of the first, and
// that is the whole case for inversions in one figure.
const PROGRESSIONS=[
  {id:"145",name:"I – IV – V",sub:"the three chords of the blues",
   steps:[[0,"maj"],[5,"maj"],[7,"maj"]],
   tip:"The bones of nearly every blues and rock song, and the progression behind the 12-bar trainer."},
  {id:"1645",name:"I – vi – IV – V",sub:"the fifties turnaround",
   steps:[[0,"maj"],[9,"min"],[5,"maj"],[7,"maj"]],
   tip:"Doo-wop, ballads, and the last two bars of a jazz blues. Four chords, and inversions keep them all under one hand."},
  {id:"1564",name:"I – V – vi – IV",sub:"the four-chord song",
   steps:[[0,"maj"],[7,"maj"],[9,"min"],[5,"maj"]],
   tip:"The one every pop song is accused of using. Worth playing in inversions purely to stop it sounding like everyone else's."},
  {id:"251",name:"ii – V – I",sub:"the jazz cadence",
   steps:[[2,"min"],[7,"maj"],[0,"maj"]],
   tip:"The most common progression in jazz. Its whole character comes from smooth voice leading, so root position is the wrong way to play it."},
  {id:"1415",name:"I – IV – I – V",sub:"the 12-bar in miniature",
   steps:[[0,"maj"],[5,"maj"],[0,"maj"],[7,"maj"]],
   tip:"Bars 1, 5, 7 and 9 of a twelve-bar. Practise the move to IV and back until it needs no thought."},
];
const progById=id=>PROGRESSIONS.find(p=>p.id===id)||PROGRESSIONS[0];

// C, C/E, C/G — the slash name says which note is in the bass, which is exactly what
// an inversion is. Naming them this way is how they appear on real chord charts.
function chordLabel(rootPc,kind,inv){
  const name=ROOT_NAMES[rootPc]+kind.sym;
  if(inv===0)return name;
  return `${name}/${ROOT_NAMES[(rootPc+kind.iv[inv])%12]}`;
}
// Walk a progression, each chord taking the voicing whose hand position is nearest
// to the chord before it. Root position everywhere is the same walk with the choice
// removed.
function voiceLead(prog,set,rootOnly){
  const out=[];let prev=null;
  for(const [deg,kindId] of prog.steps){
    const kind=triadKindById(kindId),rootPc=(state.key+deg)%12;
    let options=allTriadVoicings(rootPc,kind,set);
    if(rootOnly)options=options.filter(v=>v.inv===0);
    if(!options.length)return out;
    const pick=prev===null
      ? options.reduce((a,b)=>b.centre<a.centre?b:a)       // start low on the neck
      : options.reduce((a,b)=>Math.abs(b.centre-prev)<Math.abs(a.centre-prev)?b:a);
    out.push({...pick,kind,rootPc,label:chordLabel(rootPc,kind,pick.inv),
      move:prev===null?0:Math.abs(pick.centre-prev)});
    prev=pick.centre;}
  return out;
}
const travel=steps=>steps.reduce((a,s)=>a+s.move,0);
// One neck carrying a whole progression, each dot labelled with the step it belongs
// to. Root position scatters them across the neck; inversions pile them up.
function progBoard(steps,span){
  const seen=new Map();
  steps.forEach((st,i)=>st.notes.forEach(n=>{
    const k=n.s+":"+n.f,was=seen.get(k);
    seen.set(k,{s:n.s,f:n.f,kind:i===0?"root":"tone",ord:was?was.ord+"·"+(i+1):String(i+1)});}));
  return fretboard([...seen.values()],{plain:true,w:42,span});
}
// The move itself, drawn with letters rather than frets. Each chord tone keeps its
// colour across all three columns, so the eye watches the same note travel from the
// bottom of one stack to the top of the next — which is the entire operation, and
// the thing a fretboard diagram hides rather than shows.
const CHIP=["root","third","fifth"];
function stopInvRun(){if(state.invRunTimer){clearInterval(state.invRunTimer);state.invRunTimer=null;}state.invRunLeft=0;}
// Three moves on a timer, so the whole cycle can be watched rather than clicked
// through. It is the repetition an instructor gives you without being asked.
function runInvCycle(){
  stopInvRun();
  state.invStep=0;state.invMoved=false;state.invRunLeft=3;renderInversions();
  state.invRunTimer=setInterval(()=>{
    if(state.invRunLeft<=0){stopInvRun();renderInversions();return;}
    state.invRunLeft--;state.invStep=(state.invStep+1)%3;state.invMoved=true;renderInversions();
  },1300);
}

// ---------- fingering ----------
// One finger per fret is the rule beginners are taught, and it is right most of the
// time. It breaks on the widest shapes: a four-fret span would ask for a fifth
// finger. So fingers are assigned by rank rather than by distance, then pushed apart
// where two frets would otherwise land on the same finger.
//
// Notes sharing a fret share a finger, which is a barre — the shape is not harder for
// having one, it is easier, and saying so out loud saves a lot of fumbling.
const FINGER=["open","index","middle","ring","pinky"];
function fingering(notes){
  const fretted=notes.filter(n=>n.f>0);
  if(!fretted.length)return notes.map(n=>({...n,finger:0}));
  const lo=Math.min(...fretted.map(n=>n.f));
  const distinct=[...new Set(fretted.map(n=>n.f))].sort((a,b)=>a-b);
  const pick=off=>off===0?1:off===1?2:off===2?3:4;
  const map=new Map(distinct.map(f=>[f,pick(f-lo)]));
  // walk down from the top so two frets never share a finger
  for(let i=distinct.length-2;i>=0;i--){
    const here=map.get(distinct[i]),above=map.get(distinct[i+1]);
    if(here>=above)map.set(distinct[i],above-1);}
  const perFret={};
  fretted.forEach(n=>perFret[n.f]=(perFret[n.f]||0)+1);
  return notes.map(n=>n.f===0?{...n,finger:0}
    :{...n,finger:map.get(n.f),barre:perFret[n.f]>1});
}
// Low string first, because that is the order you build the shape in: the bass note
// is the one that names the inversion, so it goes down first.
function fingerTable(notes){
  const withF=fingering(notes).slice().sort((a,b)=>b.s-a.s);
  return `<table><tr><th>String</th><th>Fret</th><th>Finger</th><th>Note</th></tr>${
    withF.map(n=>`<tr><td>${SL[n.s]}</td><td>${n.f===0?"open":n.f}</td><td>${
      n.finger===0?"—":n.finger+" "+FINGER[n.finger]}${n.barre?" (barre)":""}</td><td>${ROOT_NAMES[noteAt(n.s,n.f)]}</td></tr>`).join("")}</table>`;
}
function fingerHint(notes){
  const withF=fingering(notes),fretted=withF.filter(n=>n.f>0);
  if(!fretted.length)return "All three strings open — nothing to fret.";
  const barred=withF.filter(n=>n.barre);
  const lowest=withF.slice().sort((a,b)=>b.s-a.s)[0];
  const lead=lowest.finger===0
    ? `The lowest note is an open ${SL[lowest.s]} string, so start by making sure it rings.`
    : `Put the <b>${FINGER[lowest.finger]}</b> down first, on the ${SL[lowest.s]} string at fret ${lowest.f} — that is the bass note, the one that names the inversion.`;
  if(barred.length>1){
    const f=barred[0];
    return `${lead} <b>Flatten the ${FINGER[f.finger]} across fret ${f.f}</b> to cover ${
      barred.length===3?"all three strings":"both of those strings"} at once. A small barre is easier here than three separate fingers, not harder.`;}
  const span=Math.max(...fretted.map(n=>n.f))-Math.min(...fretted.map(n=>n.f));
  return `${lead} ${span<=1?"Everything sits within a fret of it, so the hand barely opens."
    :span===2?"The rest is within two frets — one finger per fret from there."
    :"This one stretches across "+(span+1)+" frets, so keep the thumb low behind the neck."}`;
}
// a diagram whose dots carry finger numbers instead of note names
function fingerBoard(notes,opt={}){
  return fretboard(fingering(notes).map(n=>({...n,ord:n.finger===0?"0":String(n.finger)})),
    {plain:true,...opt});
}

// The move as an instructor would show it: one stack, one note at a time. Each render
// draws the chips where they have just landed; the CSS keyframes start them where
// they were, so the page animates by being redrawn rather than by scripting frames.
function bigStack(kind){
  const names=kind.iv.map(iv=>ROOT_NAMES[(state.key+iv)%12]);
  const order=[0,1,2].map(i=>(state.invStep+i)%3).reverse();   // top of the stack first
  const flier=(state.invStep+2)%3;                             // whichever note just came up
  const chips=order.map((ci,row)=>{
    const bottom=row===2;
    const anim=!state.invMoved?"":ci===flier?" fly":" settle";
    return `<div class="chip ${CHIP[ci]}${bottom?" moved":""}${anim}">${names[ci]}<i>${kind.degs[ci]}${bottom?" · bottom":""}</i></div>`;
  }).join("");
  return `<div class="stack bigstack">${chips}</div>`;
}
// All three positions on one neck: the one you are on drawn solid, the other two left
// as ghosts. Pressing the button makes the chord visibly climb, which is the thing
// the letters alone cannot show.
function positionsStrip(kind,set){
  const shapes=triadShapes(kind,set);
  if(!shapes.length)return "";
  const fs=shapes.flatMap(v=>v.notes.map(n=>n.f));
  const span=[Math.max(0,Math.min(...fs)-1),Math.max(...fs)+1];
  const notes=[];
  shapes.forEach(v=>v.notes.forEach(n=>{
    const here=v.inv===state.invStep,pc=noteAt(n.s,n.f);
    notes.push({s:n.s,f:n.f,
      kind:here?(pc===state.key?"root":"tone"):"ghost",
      ord:here?ROOT_NAMES[pc]:String(v.inv+1)});}));
  return fretboard(notes,{plain:true,w:40,span});
}
function moveCaption(kind){
  const names=kind.iv.map(iv=>ROOT_NAMES[(state.key+iv)%12]),flier=(state.invStep+2)%3;
  if(!state.invMoved&&state.invStep===0)
    return `<b>${names[0]}</b> is at the bottom, so this is root position. Press the button and watch what happens to it.`;
  return `<b>${names[flier]}</b> left the bottom and went over the top. Same three notes, nothing added —
    but <b>${names[state.invStep]}</b> is underneath now, so this is ${["root position","first inversion","second inversion"][state.invStep]}${
    state.invStep===0?", back where you started. Three moves and it comes full circle.":"."}`;
}
function rotationStrip(kind){
  const names=kind.iv.map(iv=>ROOT_NAMES[(state.key+iv)%12]);
  const cols=[0,1,2].map(inv=>{
    // reading order for a stack is top first; the chord sounds bottom to top
    const order=[0,1,2].map(i=>(inv+i)%3).reverse();
    const chips=order.map((ci,row)=>{
      const bottom=row===order.length-1;
      return `<div class="chip ${CHIP[ci]}${bottom?" moved":""}">${names[ci]}<i>${kind.degs[ci]}${bottom?" · bottom":""}</i></div>`;
    }).join("");
    return `<div><div class="rotname">${["Root position","1st inversion","2nd inversion"][inv]}</div>
      <div class="stack">${chips}</div>
      <div class="rotfoot">${chordLabel(state.key,kind,inv)}</div></div>`;});
  return `<div class="rot">${cols.join("")}</div>`;
}
function renderInversions(){
  mountExplorer("InversionsExplorer","inversions-explorer");
  const set=triadSetById(state.invSet),prog=progById(state.invProg),kind=triadKindById("maj");
  document.querySelectorAll("#invsets button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.ts===state.invSet));
  document.querySelectorAll("#invprogs button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.pg===state.invProg));

  // ---- the move, in letters ----
  const root=ROOT_NAMES[state.key],nm=kind.iv.map(iv=>ROOT_NAMES[(state.key+iv)%12]);
  const shapeNow=triadShapes(kind,set).find(v=>v.inv===state.invStep);
  document.getElementById("invdemo").innerHTML=
    `<div class="card wide"><h2>Watch the move<em>${["root position","first inversion","second inversion"][state.invStep]} · ${chordLabel(state.key,kind,state.invStep)}</em></h2>
      <p class="tip" style="font-size:13px">The bottom note of the stack lifts off, travels over the other
        two, and lands on top. That is the entire operation. Press it three times and you are back to the
        beginning.</p>
      ${bigStack(kind)}
      <p class="movesay">${moveCaption(kind)}</p>
      <div class="row" style="justify-content:center;margin-top:6px">
        <button id="invdo">Move the bottom note up &uarr;</button>
        <button id="invrun">Run through all three</button>
        <button id="invback">Start over</button>
      </div>
      <p class="tip" style="text-align:center;margin-top:16px">
        <b>And this is the same move on the guitar.</b> The solid shape is what you just built; the two
        faint ones are where the other inversions sit. Press the button again and watch the chord climb.</p>
      ${positionsStrip(kind,set)}
      <p class="tip" style="text-align:center;opacity:.7">
        Step ${state.invStep+1} of 3 &middot; ${["root position","first inversion","second inversion"][state.invStep]}
        &middot; lowest note <b>${shapeNow?ROOT_NAMES[noteAt(shapeNow.notes[2].s,shapeNow.notes[2].f)]:""}</b>
        on the ${shapeNow?SL[shapeNow.notes[2].s]:""} string</p>
      ${shapeNow?`<p class="tip" style="text-align:center;margin-top:14px"><b>How to hold this one.</b>
        ${fingerHint(shapeNow.notes)}</p>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;align-items:start">
          <div>${fingerBoard(shapeNow.notes,{w:44})}
            <p class="tip" style="text-align:center;opacity:.6">Finger numbers: 1 index, 2 middle, 3 ring, 4 pinky</p></div>
          <div>${fingerTable(shapeNow.notes)}</div>
        </div>`:""}
    </div>`;
  // The animation is spent once it has been drawn. Without this, changing the string
  // set or the progression would re-run the flight for no reason.
  state.invMoved=false;

  // rebound on every render, because the card they live on is redrawn each time
  document.getElementById("invdo").onclick=()=>{stopInvRun();state.invStep=(state.invStep+1)%3;state.invMoved=true;renderInversions();};
  document.getElementById("invback").onclick=()=>{stopInvRun();state.invStep=0;state.invMoved=false;renderInversions();};
  document.getElementById("invrun").onclick=runInvCycle;

  document.getElementById("invmove").innerHTML=
    `<div class="card wide"><h2>All three at once<em>same three notes, rolled over</em></h2>
      <p class="tip" style="font-size:13px">${root} major is <b>${nm.join(", ")}</b>. Above, one stack
        rolled over three times. Here are all three side by side, which is what you are choosing between
        when you pick an inversion.</p>
      ${rotationStrip(kind)}
      <p class="tip">Each colour is the same note in all three stacks: <b style="color:var(--pink)">${nm[0]} the root</b>,
        <b style="color:var(--blue)">${nm[1]} the 3rd</b>, <b style="color:var(--gold)">${nm[2]} the 5th</b>.
        Watch the pink square: it starts at the bottom and climbs to the top. Nothing else happened.</p>
      <p class="tip">Three notes, so three orders, so three inversions — and then it repeats. The dashed
        outline marks the bottom note, because <b>the bottom note is what names the inversion</b>.</p>
    </div>`;

  // ---- the three things beginners are told wrong ----
  document.getElementById("invnot").innerHTML=
    `<div class="card wide"><h2>Three things it is not<em>clear these up first</em></h2>
      <p class="notthis"><b>It is not a different chord.</b> ${chordLabel(state.key,kind,1)} is still ${root} major.
        Same three notes, same name, same job in the song. If a chart says ${chordLabel(state.key,kind,1)} and you
        play a plain ${root}, you are not wrong — just less specific.</p>
      <p class="notthis"><b>It is not about the top note.</b> People reach for the highest note because it is
        the loudest. The <b>lowest</b> note names the inversion. ${nm[1]} on the bottom makes it first
        inversion no matter what is on top.</p>
      <p class="notthis"><b>A slash chord is not decoration.</b> ${chordLabel(state.key,kind,1)} means
        &ldquo;${root} chord, ${nm[1]} in the bass&rdquo;. The letter after the slash is just the bottom note.
        That is the whole notation.</p>
    </div>`;

  // ---- what an inversion is: one chord, three orders ----
  const shapes=triadShapes(kind,set);
  document.getElementById("invwhat").innerHTML=shapes.map(sh=>{
    const notes=sh.notes.map(n=>{
      const d=(noteAt(n.s,n.f)-state.key+12)%12,i=kind.iv.indexOf(d);
      return {...n,kind:d===0?"root":"tone",ord:state.labelMode==="interval"?kind.degs[i]:ROOT_NAMES[noteAt(n.s,n.f)]};});
    const stack=sh.notes.slice().reverse().map(n=>ROOT_NAMES[noteAt(n.s,n.f)]);
    const degs=sh.notes.slice().reverse().map(n=>kind.degs[kind.iv.indexOf((noteAt(n.s,n.f)-state.key+12)%12)]);
    return `<div class="card"><h2>${INVERSION[sh.inv]}<em>${chordLabel(state.key,kind,sh.inv)}</em></h2>
      ${fretboard(notes,{plain:true,w:46})}
      <p class="tip" style="margin-top:12px"><b>Fingering</b> — the dots are finger numbers:</p>
      ${fingerBoard(sh.notes,{w:46})}
      ${fingerTable(sh.notes)}
      <p class="tip">${fingerHint(sh.notes)}</p>
      <p class="tip">Bottom to top: <b>${stack.join(" – ")}</b> &nbsp;(${degs.join(" – ")}).
        ${["The root is underneath, so it sounds like home. This is the version that ends a song.",
           "The 3rd is underneath. Lighter, and it leans forward — it wants to go somewhere.",
           "The 5th is underneath. The most open and the least settled of the three."][sh.inv]}</p>
      <p class="tip" style="opacity:.6">${sh.inv===0?"Written plainly, as "+root+kind.sym+"."
        :"Written "+chordLabel(state.key,kind,sh.inv)+" — the letter after the slash is the note in the bass. That is all a slash chord is."}</p>
    </div>`;}).join("");

  // ---- the same chord, all the way up the neck ----
  const all=allTriadVoicings(state.key,kind,set);
  const upNeck=new Map();
  all.forEach(v=>v.notes.forEach(n=>upNeck.set(n.s+":"+n.f,
    {s:n.s,f:n.f,kind:noteAt(n.s,n.f)===state.key?"root":"tone",ord:String(v.inv+1)})));
  document.getElementById("invneck").innerHTML=fretboard([...upNeck.values()],{plain:true,w:38,span:[0,MAXFRET]});
  document.getElementById("invnecklabel").innerHTML=
    `<b>${root} major on ${set.sub}</b>, every position. The numbers are which inversion:
     1 root, 2 first, 3 second. They run 1–2–3–1–2–3 up the neck and then repeat.
     <b>${all.length} playable positions</b>, but only three shapes.`;

  // ---- the smallest useful version: two chords ----
  // A whole progression is too much to hold on a first read. Two chords is the drill
  // that makes the point in ten seconds of playing.
  const four=(state.key+5)%12,rootC=triadShapes(kind,set,state.key)[0];
  const farF=triadShapes(kind,set,four).find(v=>v.inv===0);
  const nearF=allTriadVoicings(four,kind,set)
    .reduce((a,b)=>Math.abs(b.centre-rootC.centre)<Math.abs(a.centre-rootC.centre)?b:a);
  const twoSpan=[Math.max(0,Math.min(...[rootC,farF,nearF].flatMap(v=>v.notes.map(n=>n.f)))-1),
                 Math.max(...[rootC,farF,nearF].flatMap(v=>v.notes.map(n=>n.f)))+1];
  const one=(v,label,note)=>`<div class="card"><h2>${label}<em>${chordLabel(v===rootC?state.key:four,kind,v.inv)}</em></h2>
    ${fretboard(v.notes.map(n=>({...n,kind:noteAt(n.s,n.f)===(v===rootC?state.key:four)?"root":"tone",
      ord:ROOT_NAMES[noteAt(n.s,n.f)]})),{plain:true,w:44,span:twoSpan})}
    <p class="tip">${note}</p></div>`;
  document.getElementById("invtwo").innerHTML=
    one(rootC,"1. Start here",`<b>${root}${kind.sym}</b> in root position. Leave your hand exactly where it is.`)
    +one(farF,`2. The obvious ${ROOT_NAMES[four]}`,
      `<b>${ROOT_NAMES[four]}${kind.sym}</b> in root position — the shape you already know. Look how far your hand had to go: <b>${Math.abs(farF.centre-rootC.centre).toFixed(1)} frets</b>.`)
    +one(nearF,"3. The near one",
      `The same <b>${ROOT_NAMES[four]}${kind.sym}</b>, ${INVERSION[nearF.inv].toLowerCase()}. <b>${Math.abs(nearF.centre-rootC.centre).toFixed(1)} frets</b> away. Play 1 and 3 back to back: your fingers barely move, and it still sounds like ${ROOT_NAMES[four]}.`);

  // ---- the measurement ----
  const rootOnly=voiceLead(prog,set,true),smooth=voiceLead(prog,set,false);
  const frets=[...rootOnly,...smooth].flatMap(st=>st.notes.map(n=>n.f));
  const span=[Math.max(0,Math.min(...frets)-1),Math.max(...frets)+1];
  const row=(steps,title,note)=>`<div class="card wide"><h2>${title}<em>${
      travel(steps).toFixed(1)} frets travelled</em></h2>
    ${progBoard(steps,span)}
    <p class="tip">${steps.map((st,i)=>`<b>${i+1}. ${st.label}</b> (${INVERSION[st.inv].toLowerCase()}, fret ${
      Math.min(...st.notes.map(n=>n.f))})`).join(" &nbsp;→&nbsp; ")}</p>
    <p class="tip">${note}</p></div>`;
  const saved=travel(rootOnly)-travel(smooth);
  document.getElementById("invcompare").innerHTML=
    row(rootOnly,"Root position only","Every chord starts on its root, so the hand jumps to wherever that root happens to be. Notice how far apart the numbers are.")
    +row(smooth,"Nearest inversion","Each chord takes whichever of its three shapes is closest to the one before. Same chords, same order, same notes — the hand barely moves.");
  document.getElementById("invverdict").innerHTML= saved>0.05
    ? `Over <b>${prog.name}</b> on ${set.sub}, root position travels <b>${travel(rootOnly).toFixed(1)} frets</b>
       and inversions travel <b>${travel(smooth).toFixed(1)}</b> — <b>${Math.round(saved/travel(rootOnly)*100)}% less movement</b>
       for the identical progression. That is what inversions buy: not new chords, less distance.`
    : `On this string set these chords already sit close together, so inversions save little here.
       Try another string set or a progression that moves further.`;
  document.getElementById("invprogtip").textContent=prog.tip;
}

// ---------- shell ----------
// Practice is the one view built from several pieces, so it gets a name of its own
// and joins the table below like any other.
function renderPractice(){
  renderGuide();newQuiz();newSession();paintTimer();renderLog();renderEar();renderToday();
  if(typeof renderChanges==="function")renderChanges();
  document.getElementById("ladderbpm").textContent=state.bpm;
}

// Copyright © 2026 Bruce Hoppe.
// ---------- pentatonic to Phrygian dominant ----------
const PD_OFFSETS=[0,1,4,5,7,8,10], PD_DEGREES=["1","♭2","3","4","5","♭6","♭7"];
// Spell by letter and scale degree, so A's flat second is B-flat, not A-sharp.
function pdName(offset,degree){
  const letters="CDEFGAB",natural=[0,2,4,5,7,9,11];
  const idx=(letters.indexOf(NOTES[state.key][0])+degree-1)%7;
  let delta=((state.key+offset-natural[idx])%12+12)%12;
  if(delta>6)delta-=12;
  return letters[idx]+(delta>0?"♯".repeat(delta):"♭".repeat(-delta));
}
function pdBox(b){
  const span=boxSpan(b),lo=Math.max(0,span.lo),hi=Math.min(MAXFRET,span.hi+1),notes=[];
  for(let st=0;st<6;st++)for(let f=lo;f<=hi;f++){
    const d=(noteAt(st,f)-state.key+12)%12,i=PD_OFFSETS.indexOf(d);
    if(i<0)continue;
    notes.push({s:st,f,kind:d===0?"root":[1,4,8].includes(d)?"pivot":"tone",
      ord:state.labelMode==="none"?"":state.labelMode==="interval"?PD_DEGREES[i]:pdName(d,i+1)});
  }
  return {lo,hi,notes};
}
function renderHijaz(){
  const n=(d,degree)=>pdName(d,degree),root=n(0,1),minorThird=n(3,3),third=n(4,3),flatTwo=n(1,2),flatSix=n(8,6);
  const scale=PD_OFFSETS.map((d,i)=>`${PD_DEGREES[i]} <b>${n(d,i+1)}</b>`).join(" · ");
  document.getElementById("hijazexample").onclick=()=>{stopDrone();state.key=4;state.reg=0;render();};
  document.getElementById("hijazlesson").innerHTML=`
    <div class="card"><h2>${root} pentatonic → Phrygian dominant<em>change one note, add two</em></h2>
      <p>${scale}</p>
      <p class="tip">Minor pentatonic: <b>1 ♭3 4 5 ♭7</b>. Phrygian dominant: <b>1 ♭2 3 4 5 ♭6 ♭7</b>.</p>
      <ul><li>Keep <b>1, 4, 5, ♭7</b>: ${root}, ${n(5,4)}, ${n(7,5)}, ${n(10,7)}.</li>
      <li>Raise <b>♭3 → 3</b>: ${minorThird} → ${third}, one fret higher on the same string.</li>
      <li>Add <b>♭2</b> (${flatTwo}) and <b>♭6</b> (${flatSix}).</li></ul>
      <p class="tip">Adding all the new notes while keeping ${minorThird} gives an eight-note mixture.
        That can be an experiment later; first learn the seven-note sound with ${third} and without ${minorThird}.</p></div>
    <div class="card"><h2>Hear the centre<em>why “dominant”?</em></h2>
      <p class="tip">The major 3 and flat 7 form a dominant seventh with the root and fifth:
        <b>${root}7 = ${root}, ${third}, ${n(7,5)}, ${n(10,7)}</b>.
        The scale is the fifth mode of <b>${n(5,4)} harmonic minor</b>, but ${root} is home for this exercise.</p>
      <p class="tip">Start the <b>Root drone</b>. Play <b>1–♭2–1</b>, then <b>1–♭2–3–4–3–♭2–1</b>.
        The ♭2–3 gap is three semitones: hear the leap, then its release. Sing the phrase before playing it.</p>
      <p class="tip">Phrygian has a ♭3; Phrygian dominant has a 3. Double harmonic major has a natural 7;
        this scale has ♭7. Listen for these differences instead of relying on the names.</p></div>
    <div class="card"><h2>Choose the backing deliberately<em>one sound at a time</em></h2>
      <ol><li><b>Bare ${root} drone or ${root}5:</b> leaves the third open. Best place to compare both sounds.</li>
      <li><b>${root} major or ${root}7:</b> makes ${third} feel settled. Use ♭2 and ♭6 as tension;
        resolve ♭2 down to 1 and ♭6 down to 5. Let 4 move to 3 when it rubs against the chord.</li>
      <li><b>${root}7 → ${n(5,4)}m:</b> a different experiment. Play this scale over the dominant,
        then resolve ${third} up to ${n(5,4)} as the minor chord arrives.</li></ol>
      <p class="tip">A generic ${root} minor backing contains ${minorThird}, which clashes with ${third}.
        The app's minor i/iv/v chord rings and blue-note overlay are disabled here for that reason.
        The root drone supplies a single pitch, not a chord progression.</p></div>
    <div class="card"><h2>Hijaz and the fretted guitar<em>a useful connection, with context</em></h2>
      <p class="tip">The lower four degrees, 1–♭2–3–4, give a fretted-guitar approximation of the Hijaz colour.
        Arabic Jins Hijaz uses four notes; its second and third are often tuned closer together than equal temperament suggests.
        Maqam Hijaz also involves melodic pathways and choices of upper jins. A seven-note guitar shape does not capture all of that practice.</p>
      <p class="tip">Listen to the Jins Hijaz and Maqam Hijaz examples on MaqamWorld.
        Copy a short contour and its pauses by ear. Treat this lesson as Phrygian dominant guitar practice.</p></div>`;
  document.getElementById("hijazboxes").innerHTML=validBoxes().map(b=>{
    const {lo,hi,notes}=pdBox(b);
    return `<div class="card"><h2>Box ${b.n} area<em>frets ${lo}–${hi}</em></h2>${fretboard(notes,{plain:true,span:[lo,hi]})}
      <p class="tip">Find a ${root} first. Locate ${third}; leave ${minorThird} out. Add one gold note to a short phrase, then return to the root.</p></div>`;
  }).join("");
  document.getElementById("hijazpractice").innerHTML=`
    <div class="card"><h2>A slow ten-minute session<em>40–60 bpm · no rush</em></h2>
      <ol><li><b>Minutes 0–2: anchors.</b> Stay in one box area. Over the drone, play 1–4–5–♭7–5–1.
        One note per two clicks; pause for two clicks after the phrase.</li>
      <li><b>Minutes 2–4: change the third.</b> Compare 1–♭3–4–1 with 1–3–4–1.
        Keep exactly the same rhythm. For the first phrase use the familiar pentatonic shape; the diagrams above omit ♭3.</li>
      <li><b>Minutes 4–6: hear the lower fragment.</b> Play 1–♭2–3–4, then 4–3–♭2–1.
        Slide or shift if the augmented second is uncomfortable.</li>
      <li><b>Minutes 6–8: add the upper tension.</b> Play 5–♭6–5–4–3–♭2–1. Hold the final root.</li>
      <li><b>Minutes 8–10: travel.</b> Choose two box areas. Play in the first, pause, find a root in the second,
        then answer there. A silent, accurate move is progress. Speed comes after three relaxed repetitions.</li></ol></div>
    <div class="card"><h2>Three small experiments<em>change one variable</em></h2>
      <ol><li><b>Call and answer:</b> two bars of minor pentatonic, two bars of Phrygian dominant over a bare root or power chord.
        Finish each phrase on 1 or 5. Keep the rhythm and change the third.</li>
      <li><b>One colour:</b> improvise with only 1, 3 and 5, then allow ♭2. Next take ♭2 away and allow ♭6.
        Record both; name which note creates each tension.</li>
      <li><b>Intentional mixture:</b> once both sounds are familiar, try ♭3→3 as a brief chromatic move.
        Resolve it clearly. Keeping both thirds is your hybrid vocabulary, not the pure seven-note scale.</li></ol>
      <p class="tip"><b>Ready to expand?</b> You can sing ♭2→1, find the major third without searching,
        play a phrase without accidentally landing on ♭3, and move to your second box with relaxed hands.
        If any step fails, reduce the notes and slow down.</p>
      <p class="tip">For the supplied E example, the signature notes are <b>E–F–G♯–A</b>.
        On high e above fret 12: <b>12–13–16–17</b>. Try <b>17–16–13–12</b> as an answer.
        These fret numbers are specifically for E, regardless of the selected root above.</p></div>`;
}

// ---------- open tunings ----------
const OPEN_TUNINGS=[
  {id:"open-d",name:"Open D",notes:["D","A","D","F♯","A","D"],changes:["↓2","—","—","↓1","↓2","↓2"],chord:"D major",use:"A bright major drone; a natural home for slide and bottleneck phrasing."},
  {id:"open-g",name:"Open G",notes:["D","G","D","G","B","D"],changes:["↓2","↓2","—","—","—","↓2"],chord:"G major",use:"The classic slide and roots-blues tuning; the middle four strings retain useful standard-tuning relationships."},
  {id:"open-e",name:"Open E",notes:["E","B","E","G♯","B","E"],changes:["—","↑2","↑2","↑1","—","—"],chord:"E major",use:"Raised strings add tension. Open D with a capo at fret 2 is another way to get the open E pitches."},
  {id:"drop-d",name:"Dropped D",notes:["D","A","D","G","B","E"],changes:["↓2","—","—","—","—","—"],chord:"D5 on strings 6–4",use:"Drop D is an alternate tuning, not an open major tuning. Play only the lowest three strings for these power chords."}
];
const TUNING_STANDARD=[40,45,50,55,59,64]; // MIDI, low to high; never changes the other views' tuning.
const TUNING_EXAMPLES={
  "open-d":{root:2,names:["D","G","A"],strings:6,lead:5,frets:[0,2,4,2],degrees:["1","2","3","2"]},
  "open-g":{root:7,names:["G","C","D"],strings:5,lead:3,frets:[0,2,4,2],degrees:["1","2","3","2"]},
  "open-e":{root:4,names:["E","A","B"],strings:6,lead:5,frets:[0,2,4,2],degrees:["1","2","3","2"]},
  "drop-d":{root:2,names:["D5","G5","A5"],strings:3,lead:0,frets:[0,3,5,3],degrees:["1","♭3","4","♭3"]}
};
// Frets run from string 6 to string 1. null means mute; 0 means open.
const TUNING_OPEN_CHORDS={
  "open-d":[{name:"D",root:2,frets:[0,0,0,0,0,0]},{name:"G",root:7,frets:[null,null,5,5,5,0]},{name:"A",root:9,frets:[null,0,2,3,4,2]}],
  "open-g":[{name:"G",root:7,frets:[null,0,0,0,0,0]},{name:"C/G",root:0,frets:[null,0,2,0,1,2]},{name:"D/A",root:2,frets:[null,2,0,2,3,4]}],
  "open-e":[{name:"E",root:4,frets:[0,0,0,0,0,0]},{name:"A",root:9,frets:[null,null,5,5,5,0]},{name:"B",root:11,frets:[null,0,2,3,4,2]}],
  "drop-d":[{name:"D",root:2,frets:[0,0,0,2,3,2]},{name:"G",root:7,frets:[5,null,0,0,0,3]},{name:"A",root:9,frets:[null,0,2,2,2,0]}]
};
function tuningMidi(t){return TUNING_STANDARD.map((m,i)=>m+(t.changes[i]==="—"?0:(t.changes[i][0]==="↑"?1:-1)*Number(t.changes[i].slice(1))));}
function tuningStrings(t){const midi=tuningMidi(t);return `<div class="tuning-strip" aria-label="${t.name}: strings 6 to 1, low to high">${t.notes.map((n,i)=>{
  const delta=midi[i]-TUNING_STANDARD[i],change=delta===0?"keep":`${delta<0?"↓":"↑"}${Math.abs(delta)}`;
  return `<div class="tuning-lane ${delta?"retuned":""}"><small>String ${6-i}</small><span class="tuning-before">${["E","A","D","G","B","E"][i]}</span>
    <span class="tuning-wire" style="--weight:${3-i*.4}px"></span><strong>${n}</strong><span class="tuning-delta">${change}</span></div>`;
}).join("")}</div>`;}
function tuningShape(t,fret,label,voicing=null){
  const ex=TUNING_EXAMPLES[t.id],active=i=>t.id==="drop-d"?i<3:t.id==="open-g"?i>0:true;
  const lo=fret||1,rows=voicing?5:3,step=81/rows;
  const frets=voicing||t.notes.map((_,i)=>active(i)?fret:null);
  let svg=`<svg viewBox="0 0 164 178" role="img" aria-label="${t.name}: ${label}, frets low to high ${frets.map(f=>f===null?"mute":f).join(", ")}"><title>${label}</title>`;
  for(let row=0;row<=rows;row++)svg+=`<line x1="28" x2="138" y1="${44+row*step}" y2="${44+row*step}" stroke="var(--ink)" stroke-width="${row===0&&fret===0?4:1}"/>`;
  for(let i=0;i<6;i++){
    const x=28+i*22;
    svg+=`<line x1="${x}" x2="${x}" y1="44" y2="125" stroke="var(--ink)" stroke-width="${2-i*.25}"/>`;
    svg+=`<text x="${x}" y="20" text-anchor="middle" font-size="15" fill="var(--ink)">${frets[i]===null?"×":frets[i]===0?"○":""}</text>`;
    if(voicing&&frets[i]>0){const y=44+(frets[i]-.5)*step;
      svg+=`<circle cx="${x}" cy="${y}" r="7" fill="var(--blue)"/><text x="${x}" y="${y+3.5}" text-anchor="middle" font-size="9" fill="white">${frets[i]}</text>`;}
    svg+=`<text x="${x}" y="147" text-anchor="middle" font-size="11" fill="var(--ink)">${t.notes[i]}</text>`;
    svg+=`<text x="${x}" y="166" text-anchor="middle" font-size="10" fill="var(--ink)">${6-i}</text>`;
  }
  if(fret){const start=t.id==="open-g"?1:0,end=t.id==="drop-d"?2:5;
    svg+=`<line x1="${28+start*22}" x2="${28+end*22}" y1="57.5" y2="57.5" stroke="var(--blue)" stroke-width="13" stroke-linecap="round"/>`;
  }
  svg+=`<text x="9" y="62" text-anchor="middle" font-size="12" fill="var(--ink)">${lo}</text></svg>`;
  return `<figure class="tuning-shape"><figcaption><b>${label}</b><small>${voicing?"Frets 1–5":fret?`Fret ${fret}`:"Open"}</small></figcaption>${svg}<div class="tuning-fretcode">${frets.map(f=>f===null?"×":f).join(" ")}</div></figure>`;
}
function tuningTab(t){
  const ex=TUNING_EXAMPLES[t.id];
  let svg=`<svg viewBox="0 0 380 168" role="img" aria-label="${t.name} phrase: string ${6-ex.lead}, frets ${ex.frets.join(", ")}, one note per beat"><title>One-bar phrase in ${t.name}</title>`;
  for(let beat=0;beat<4;beat++)svg+=`<text x="${100+beat*74}" y="16" text-anchor="middle" font-size="12" fill="var(--ink)">${beat+1}</text>`;
  for(let row=0;row<6;row++){
    const i=5-row,y=38+row*21;
    svg+=`<text x="8" y="${y+4}" font-size="11" fill="var(--ink)">${6-i} · ${t.notes[i]}</text><line x1="64" x2="364" y1="${y}" y2="${y}" stroke="var(--ink)" opacity=".4"/>`;
    if(i===ex.lead)ex.frets.forEach((f,beat)=>{svg+=`<rect x="${89+beat*74}" y="${y-9}" width="22" height="18" fill="var(--card)"/><text x="${100+beat*74}" y="${y+5}" text-anchor="middle" font-size="16" font-weight="700" fill="var(--blue)">${f}</text>`;});
  }
  return svg+"</svg>";
}
function tuningRootMap(t){
  const midi=tuningMidi(t),root=TUNING_EXAMPLES[t.id].root;
  let svg=`<svg viewBox="0 0 750 188" role="img" aria-label="Root locations in ${t.name}, frets zero to twelve; thin string at top"><title>Find the ${NOTES[root]} roots</title>`;
  for(let f=0;f<=12;f++){
    const x=64+f*52;
    svg+=`<text x="${x}" y="18" text-anchor="middle" font-size="12" fill="var(--ink)">${f}</text>`;
    if(f)svg+=`<line x1="${x-26}" x2="${x-26}" y1="34" y2="169" stroke="var(--ink)" opacity=".2"/>`;
  }
  for(let row=0;row<6;row++){
    const i=5-row,y=34+row*27;
    svg+=`<text x="4" y="${y+4}" font-size="12" fill="var(--ink)">${6-i} ${t.notes[i]}</text><line x1="64" x2="708" y1="${y}" y2="${y}" stroke="var(--ink)" stroke-width="${.7+row*.3}" opacity=".45"/>`;
    for(let f=0;f<=12;f++)if((midi[i]+f)%12===root)svg+=`<circle cx="${64+f*52}" cy="${y}" r="10" fill="var(--pink)"/><text x="${64+f*52}" y="${y+4}" text-anchor="middle" font-size="10" fill="var(--ink)">${f}</text>`;
  }
  return svg+"</svg>";
}
function renderOpen(){
  const t=OPEN_TUNINGS.find(x=>x.id===state.openTuning)||OPEN_TUNINGS[0];
  const pick=document.getElementById("opentuningpick");
  pick.innerHTML='<span class="lbl">Tuning</span>';
  OPEN_TUNINGS.forEach(x=>mk(pick,{t:x.id},x.name,()=>{state.openTuning=x.id;renderOpen();}));
  pick.querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.t===t.id));
  document.getElementById("opentuninglesson").innerHTML=`<div class="card wide"><h2>Find home in ${t.name}<em>${t.notes.join(" · ")}</em></h2>
    <p class="tip">Pink dots = ${NOTES[TUNING_EXAMPLES[t.id].root]} roots. Numbers = frets. Thin string at top.</p>
    <div class="tuning-map">${tuningRootMap(t)}</div></div>`;
  document.getElementById("opentuningcards").innerHTML=OPEN_TUNINGS.map(x=>{
    const ex=TUNING_EXAMPLES[x.id];
    return `<article class="card tuning-card"><h2>${x.name}<em>${x.chord}</em></h2>
    ${tuningStrings(x)}
    <p class="tuning-caption">Low / thick ← strings 6 to 1 → high / thin<br>↓ lower · ↑ raise · numbers = semitones</p>
    <h3>One shape, three chords</h3><div class="tuning-shapes">${[0,5,7].map((f,i)=>tuningShape(x,f,ex.names[i])).join("")}</div>
    <p class="tuning-caption">○ open · × mute · blue bar = one finger<br>${x.id==="drop-d"?"Strum strings 6–4 only.":x.id==="open-g"?"Mute string 6 to put G, C or D in the bass.":"Strum all six strings."} Return to the open chord.</p>
    <h3>Chords with open strings</h3><div class="tuning-shapes">${TUNING_OPEN_CHORDS[x.id].map(c=>tuningShape(x,0,c.name,c.frets)).join("")}</div>
    <p class="tuning-caption">Dots = fretted notes; numbers = frets, not fingers.<br>${x.id==="open-g"?"C/G = C with G in the bass. D/A = D with A in the bass.":"Let the open strings ring. Place the shape silently first."}</p>
    <h3>Play a one-bar answer</h3><div class="tuning-tab">${tuningTab(x)}</div>
    <p class="tuning-caption">Thin string at top · one note per click at 60 bpm<br>Degrees: ${ex.degrees.join(" → ")}. Rest one bar; repeat.</p>
    <details><summary>Practice notes</summary><p class="tip">${x.use}</p><p class="tip">Play the open chord, count four beats, then play the answer. The tab belongs to this tuning; other app views still use standard tuning.</p></details></article>`;
  }).join("");
}


// Every view in one place: id, nav label, what draws it, and a small config: the
// nav band it sits in, which toolbar controls actually do anything there, and what
// the Key selector means. The id also names the <section id="v-...">. Adding a view
// means adding the section and one row here — nothing else in this file needs to
// know about it.
//
// The table is kept in band order, because the nav is built by walking it: the
// buttons appear in exactly this sequence, grouped under the band headings.
const BANDS=["Fundamentals","Shapes","Chords","Playing","Practice"];
const VIEWS=[
  ["path",    "Start here",       renderPath,       {band:"Fundamentals"}],
  ["song",    "Over a song",      renderSong,       {band:"Fundamentals",tools:"keys"}],
  ["notes",   "Note names",       renderNotes,      {band:"Fundamentals"}],
  ["tune",    "Tuner & bends",    renderTune,       {band:"Fundamentals"}],

  ["boxes",   "5 boxes",          renderBoxes,      {band:"Shapes",tools:"keys labels chords regs extras"}],
  ["land",    "Box 1 & 4",        renderLand,       {band:"Shapes",tools:"keys labels chords regs extras"}],
  ["connect", "Connections",      renderConnect,    {band:"Shapes",tools:"keys labels chords regs extras"}],
  ["cross",   "Crossing drills",  renderCross,      {band:"Shapes",tools:"keys labels chords regs extras"}],
  ["blues",   "Blues boxes",      renderBlues,      {band:"Shapes",tools:"keys labels chords regs extras"}],
  ["chart",   "All 12 keys",      renderChart,      {band:"Shapes",tools:"keys"}],
  ["major",   "Major pentatonic", renderMajor,      {band:"Shapes"}],
  ["modes",   "Modes",            renderModes,      {band:"Shapes",tools:"keys labels regs",key:"root"}],

  ["triads",  "Triads",           renderTriads,     {band:"Chords",tools:"keys labels",key:"root"}],
  ["inv",     "Inversions",       renderInversions, {band:"Chords",tools:"keys labels",key:"root"}],
  ["power",   "Power chords",     renderPower,      {band:"Chords",tools:"keys"}],

  ["hijaz",   "Phrygian dominant", renderHijaz,     {band:"Playing",tools:"keys labels regs",key:"root"}],
  ["open",    "Open tunings",      renderOpen,       {band:"Playing"}],
  ["melody",  "Melody",           renderMelody,     {band:"Playing"}],
  ["solo",    "Solo runs",        renderSolo,       {band:"Playing",tools:"keys labels regs"}],
  ["licks",   "Licks",            renderLicks,      {band:"Playing",tools:"keys labels chords regs extras"}],
  ["form",    "Song structure",   renderForm,       {band:"Playing"}],
  ["rhythm",  "Rhythm lab",       renderRhythm,     {band:"Playing"}],

  ["songs",   "Songs",            renderSongs,      {band:"Practice"}],
  ["trainer", "12-bar trainer",   renderTrainer,    {band:"Practice",tools:"keys"}],
  ["theory",  "Practice theory",  renderTheory,     {band:"Practice"}],
  // The find-the-note board is deliberately blank — naming the dots would give the
  // answer away — so Dots is the one control Practice ignores.
  ["practice","Practice",         renderPractice,   {band:"Practice",tools:"keys regs"}],
];
const viewCfg=v=>(VIEWS.find(([id])=>id===v)||[])[3]||{};

// One capability table drives both rendering and the contextual controls.
const TOOLROWS=["keys","labels","chords","regs","extras"];
function applyTools(){
  const live=new Set((viewCfg(state.view).tools||"").split(" ").filter(Boolean));
  TOOLROWS.forEach(id=>{
    const row=document.getElementById(id),on=live.has(id);
    row.hidden=!on;
    row.setAttribute("aria-disabled",!on);
    document.querySelectorAll("#"+id+" button").forEach(b=>{b.disabled=!on;});});
  document.getElementById("keyselect").disabled=!live.has("keys");
  document.getElementById("diagramsettings").hidden=!TOOLROWS.slice(1).some(id=>live.has(id));
  const summary=[];
  if(live.has("labels")&&state.labelMode!=="name")summary.push(state.labelMode==="interval"?"Intervals":"Blank dots");
  if(live.has("regs")&&state.reg!==0)summary.push(REGLBL[state.reg]);
  if(live.has("chords")&&state.chord)summary.push(state.chord==="band"?"Follow backing":"Chord "+state.chord);
  if(live.has("extras")&&state.showB5)summary.push("♭5 on");
  document.getElementById("settingssummary").textContent=summary.join(" · ");
  document.getElementById("legend").hidden=!live.has("labels");
  document.getElementById("legendchord").hidden=!live.has("chords")||!state.chord;
  document.getElementById("legendblue").hidden=!live.has("extras")||!state.showB5;
  document.getElementById("legendcolour").hidden=!["modes","hijaz","blues"].includes(state.view);
}

function applyKeyNames(){
  const asRoot=viewCfg(state.view).key==="root",select=document.getElementById("keyselect");
  document.getElementById("keylbl").textContent=asRoot?"Root":"Key";
  select.setAttribute("aria-label",asRoot?"Root":"Key");
  Array.from(select.children).forEach((option,k)=>{option.textContent=asRoot?ROOT_NAMES[k]:NOTES[k]+" minor";});
  select.value=String(state.key);
}
let shellView=null;
const navGroups=new Map();
const narrowScreen=()=>typeof window.matchMedia==="function"&&window.matchMedia("(max-width: 740px)").matches;
function renderShell(){
  document.getElementById("lessontitle").textContent=state.view==="path"?"Your practice today":VIEWS.find(v=>v[0]===state.view)[1];
  if(shellView!==state.view){
    navGroups.forEach((group,band)=>{group.open=band===viewCfg(state.view).band;});
    if(narrowScreen())document.getElementById("browse").open=false;
    shellView=state.view;
  }
}
function render(){
  // Hide everything first, then draw: a view's own renderer may measure or reach
  // into the page, and should not see a half-switched shell.
  VIEWS.forEach(([v])=>document.getElementById("v-"+v).hidden=(v!==state.view));
  // the tuner stops listening when you leave it: the microphone light should mean something
  if(state.view!=="tune"&&state.pitch&&typeof pitchStop==="function")pitchStop();
  VIEWS.forEach(([v,,draw])=>{if(v===state.view)draw();});
  document.querySelectorAll("#views button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===state.view));
  document.querySelectorAll("#majorkeys button").forEach(b=>b.setAttribute("aria-pressed",+b.dataset.mk===state.majorKey));
  document.querySelectorAll("#labels button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.l===state.labelMode));
  document.querySelectorAll("#chords button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.c===(state.chord||"off")));
  document.querySelectorAll("#regs button").forEach(b=>{
    const r=+b.dataset.r,i=regInfo(r);
    b.setAttribute("aria-pressed",r===state.reg);
    b.disabled=false;b.style.opacity=1;
    b.textContent=r===0?`Standard · frets ${i.lo}–${i.hi}`
      :`${REGLBL[r]} · frets ${i.lo}–${i.hi}${i.shifted<5?` (${i.shifted} of 5 move)`:""}`;
    b.title=r===0?"Every box at its home position."
      :`All five boxes, each as ${r<0?"low":"high"} as it goes. ${
        i.shifted===5?"All five move an octave.":`${i.shifted} of the five have room to move; the rest stay at their standard position.`}`;});
  document.querySelectorAll("#extras button").forEach(b=>{
    b.setAttribute("aria-pressed",state.showB5);
    b.textContent=`♭5 blue note: ${state.showB5?"on":"off"}`;});
  // Last, because both of these overrule what the loops above just set.
  applyKeyNames();
  applyTools();
  renderShell();
}
// host is an id or an element, because the nav builds its rows on the fly.
const mk=(host,data,txt,fn)=>{const b=document.createElement("button");
  Object.entries(data).forEach(([k,v])=>b.dataset[k]=v);b.textContent=txt;b.onclick=fn;
  (typeof host==="string"?document.getElementById(host):host).appendChild(b);};
NOTES.forEach((n,i)=>{const option=document.createElement("option");
  option.value=String(i);option.textContent=n+" minor";document.getElementById("keyselect").appendChild(option);});
document.getElementById("keyselect").addEventListener("change",e=>{
  const key=Number(e.target.value);
  if(e.target.disabled||!Number.isInteger(key)||key<0||key>11)return;
  state.key=key;stopDrone();state.blueLock=null;render();
});
BANDS.forEach(band=>{
  const group=document.createElement("details");group.className="nav-group";
  const heading=document.createElement("summary");heading.textContent=band;group.appendChild(heading);
  document.getElementById("views").appendChild(group);navGroups.set(band,group);
  VIEWS.filter(([,,,c])=>c.band===band).forEach(([v,label])=>mk(group,{v},label,()=>goToView(v)));
});
[["name","Note names"],["interval","Intervals"],["none","Blank"]]
  .forEach(([l,t])=>mk("labels",{l},t,()=>{state.labelMode=l;render()}));
[["off","Off"],["i","i"],["iv","iv"],["v","v"],["band","Follow backing"]]
  .forEach(([c,t])=>mk("chords",{c},t,()=>{state.chord=c==="off"?null:c;render()}));
REGS.forEach(([r,t])=>mk("regs",{r},t,()=>{state.reg=r;state.blueLock=null;render()}));
mk("extras",{},"♭5 blue note: off",function(){state.showB5=!state.showB5;render();});
MAJKEYS.forEach((k,i)=>mk("majorkeys",{mk:i},k.n,()=>{state.majorKey=i;render();}));
MODES.forEach(m=>mk("modes",{m:m.id},m.name,()=>{state.modeId=m.id;render();}));
NOTES.forEach((n,pc)=>mk("notepick",{pc},n,()=>{state.noteHL=state.noteHL===pc?null:pc;render();}));
SL.forEach((n,st)=>mk("stringpick",{st},n,()=>{state.noteString=state.noteString===st?null:st;render();}));
TRIAD_KINDS.forEach(k=>mk("triadkinds",{tk:k.id},k.name,()=>{state.triadKind=k.id;render();}));
TRIAD_SETS.forEach(t=>mk("triadsets",{ts:t.id},t.name,()=>{state.triadSet=t.id;render();}));
TRIAD_SETS.forEach(t=>mk("invsets",{ts:t.id},t.name,()=>{state.invSet=t.id;render();}));
PROGRESSIONS.forEach(p=>mk("invprogs",{pg:p.id},p.name,()=>{state.invProg=p.id;render();}));
document.getElementById("majormode").onclick=function(){state.majorDegrees=!state.majorDegrees;
  this.textContent=state.majorDegrees?"Scale degrees":"Note names";
  this.setAttribute("aria-pressed",state.majorDegrees);render();};
document.getElementById("majorarrows").onclick=function(){state.majorArrows=!state.majorArrows;
  this.setAttribute("aria-pressed",state.majorArrows);render();};
// Quitting has to mean the app is gone, not merely quiet. The server stops itself
// the moment /quit is answered, so everything ticking in the page is now driving a
// desk that no longer exists: stop it all, ask the browser to close the tab, and
// when it refuses — a tab the user opened is not one a script is allowed to close —
// replace the desk with a plain notice rather than leave a page that still looks
// live and answers no requests.
function silenceEverything(){
  stopDrone();stopSolo();stopRhythm();stopTrainer();stopTimer();stopInvRun();stopRecording();stopMonitor();releaseInput();
  if(typeof songStop==="function")songStop();
  if(typeof looperStop==="function")looperStop();
  if(state.clickTimer){clearInterval(state.clickTimer);state.clickTimer=null;}
}
function farewellPage(){
  document.title="Practice desk \u2014 stopped";
  document.body.innerHTML=`<div class="wrap gone">
    <h1>Stopped</h1>
    <p class="sub">The practice desk is no longer running</p>
    <p class="tip">This tab can be closed. Open the app again when you next pick up the guitar.</p>
  </div>`;
}
function shutDownPage(){
  silenceEverything();
  try{window.close();}catch(e){/* a tab the browser will not let a script close */}
  // Give the close a moment to happen; if the tab is still here, say so plainly.
  setTimeout(farewellPage,250);
}

// The packaged builds have no console to Ctrl-C, so offer a Quit button — but only
// when the page is actually being served by the app: not opened as a local file, and
// not on the static live demo, where there is no app to stop. The app only ever
// listens on loopback, so nowhere else is asked at all; /about then names the app
// and its version, and its answer is what reveals the row.
const ABOUT=/^Minor Pentatonic Practice Desk (\S+)/;
if(typeof location!=="undefined"&&typeof fetch==="function"&&/^https?:$/.test(location.protocol)
   &&/^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname||"")){
  fetch("/about").then(r=>r.ok?r.text():"").then(t=>{
    const m=ABOUT.exec(t||"");if(!m)return;
    document.getElementById("approw").hidden=false;
    document.getElementById("appver").textContent="version "+m[1];
    document.getElementById("credver").textContent="Version "+m[1];}).catch(()=>{});
  document.getElementById("quitapp").onclick=()=>{
    document.getElementById("quitmsg").textContent="Stopping\u2026";
    document.getElementById("quitapp").disabled=true;
    // Either way the server is on its way down, so the page has to follow: a
    // failed fetch here usually means it shut down before answering.
    fetch("/quit",{method:"POST",headers:{"X-Quit":"1"}}).then(shutDownPage,shutDownPage);};
}
document.getElementById("drone").onclick=e=>toggleDrone(e.currentTarget);
document.getElementById("click").onclick=e=>toggleClick(e.currentTarget);
document.getElementById("bpm").oninput=e=>{state.bpm=+e.target.value;
  document.getElementById("bpmv").textContent=state.bpm+" bpm";restartClick();};
document.getElementById("newquiz").onclick=newQuiz;
document.getElementById("newsession").onclick=newSession;
document.getElementById("completesession").onclick=completeSession;
document.querySelectorAll(".timerpreset").forEach(b=>b.onclick=()=>setTimer(+b.dataset.min));
document.getElementById("toggletimer").onclick=toggleTimer;
document.getElementById("resettimer").onclick=resetTimer;
document.getElementById("ladderclean").onclick=()=>ladder(5);
document.getElementById("laddermiss").onclick=()=>ladder(-5);
document.getElementById("ladderreset").onclick=resetLadder;
document.getElementById("clearlog").onclick=clearLog;
document.getElementById("earagain").onclick=()=>earPlay(true);
document.getElementById("earroot").onclick=()=>pluck(48+state.key,0,.9,.5);
document.getElementById("earnext").onclick=earNew;
document.getElementById("toggletrainer").onclick=toggleTrainer;
document.getElementById("resettrainer").onclick=resetTrainer;
document.getElementById("groove").onchange=()=>{renderTrainer();renderBandControls();};
readBand();
document.getElementById("swing").oninput=e=>{state.band.swing=Math.min(.75,Math.max(.5,(+e.target.value)/100));
  if(Math.abs(state.band.swing-2/3)<.006)state.band.swing=2/3;writeBand();renderBandControls();};
document.getElementById("bandbass").onchange=e=>{state.band.bass=e.target.value==="root5"?"root5":"walk";writeBand();};
document.getElementById("bandride").onchange=e=>{state.band.ride=!!e.target.checked;writeBand();};
document.getElementById("bandon").onclick=()=>{state.band.on=!state.band.on;writeBand();renderBandControls();
  if(state.trainerTimer){if(state.band.on)bandStart();else bandStop();}};
document.getElementById("taptempo").onclick=()=>tapTempo();
Object.keys(state.band.mix).forEach(p=>{
  document.getElementById("mix"+p).onclick=()=>{state.band.mix[p].on=!state.band.mix[p].on;writeBand();applyBandMix();renderBandControls();};
  document.getElementById("mix"+p+"v").oninput=e=>{state.band.mix[p].vol=Math.min(1,Math.max(0,(+e.target.value)/100));
    writeBand();applyBandMix();};});
const practiceSet=(k,v)=>{state.band.practice[k]=v;writeBand();renderBandControls();};
document.getElementById("choruses").onchange=e=>practiceSet("choruses",[0,1,2,4,8].includes(+e.target.value)?+e.target.value:0);
document.getElementById("ladderon").onchange=e=>{
  const P=state.band.practice;
  if(e.target.checked&&P.ladderTo<=state.bpm)P.ladderTo=Math.min(220,Math.ceil((state.bpm+20)/5)*5);
  practiceSet("ladder",!!e.target.checked);};
document.getElementById("ladderto").onchange=e=>{const v=Math.round(+e.target.value/5)*5;
  practiceSet("ladderTo",Math.min(220,Math.max(45,Number.isFinite(v)?v:140)));};
document.getElementById("keycycle").onchange=e=>practiceSet("keys",["fourth","random"].includes(e.target.value)?e.target.value:"");
document.getElementById("drill").onchange=e=>practiceSet("drill",["dropout","fours"].includes(e.target.value)?e.target.value:"");
renderBandControls();
// The form menu is built from BLUES_FORMS, grouped by family, so adding a form up
// there is the only edit needed to offer it here.
document.getElementById("bluesform").innerHTML=(()=>{
  const families=[];
  Object.entries(BLUES_FORMS).forEach(([id,f])=>{
    let g=families.find(x=>x.name===f.family);
    if(!g)families.push(g={name:f.family,options:[]});
    g.options.push(`<option value="${id}">${f.name}</option>`);});
  return families.map(g=>`<optgroup label="${g.name}">${g.options.join("")}</optgroup>`).join("");
})();
document.getElementById("bluesform").onchange=resetTrainer;
document.getElementById("newrhythm").onclick=generateRhythm;
document.getElementById("togglerhythm").onclick=toggleRhythm;
// The Record row sits under Play along. Where the browser cannot record, it stays
// visible but switched off, with the reason — the same as the audio controls.
(()=>{const play=document.getElementById("play");
  if(play.insertAdjacentHTML)play.insertAdjacentHTML("afterend",REC_ROW);
  const why=recUnsupported();
  if(why){["recinput","recchan","reccheck","recmon","recmix","recarm","recbtn","recmode","recfocus","recattempt","calloop","caltap","calms"].forEach(id=>{document.getElementById(id).disabled=true;});
    document.getElementById("recrow").classList.add("off");recSay(why);return;}
  document.getElementById("recbtn").onclick=toggleRecord;
  document.getElementById("recinput").onchange=e=>{state.recDevice=e.target.value;restartMonitor();restartCheck();};
  document.getElementById("recchan").onchange=e=>{state.recChannel=+e.target.value;restartMonitor();};
  // a bar is a shortcut for the channel menu, until a take has fixed the input
  [0,1].forEach(i=>{document.getElementById("recbar"+i).onclick=()=>{if(!state.rec)pickChannel(i);};});
  if(audioContextCtor()){document.getElementById("recmon").onclick=toggleMonitor;document.getElementById("reccheck").onclick=toggleCheck;}
  else["recmon","reccheck"].forEach(id=>{const b=document.getElementById(id);b.disabled=true;
    b.title="This needs Web Audio, which this browser withholds.";});
  document.getElementById("recdlc").onclick=()=>saveFile(state.recTake);
  document.getElementById("recdlw").onclick=downloadWav;
  document.getElementById("recdlm").onclick=downloadMp3;
  document.getElementById("recdls").onclick=downloadSolo;
  readCal();calShow();
  document.getElementById("calloop").onclick=calibrateLoopback;
  document.getElementById("caltap").onclick=calibrateTap;
  document.getElementById("caltapbtn").onclick=()=>{if(state.calRun&&state.calRun.tap)state.calRun.tap();};
  document.getElementById("recmark").onclick=markMistake;
  document.getElementById("calms").onchange=e=>{const v=Math.round(+e.target.value);
    if(e.target.value!==""&&Number.isFinite(v))setCal(v,"manual");else calShow();};
  readRecSettings();
  document.getElementById("recbits").value=String(state.wavBits);
  document.getElementById("recq").value=state.mp3Quality;
  document.getElementById("recbits").onchange=e=>{state.wavBits=+e.target.value===24?24:16;writeRecSettings();};
  document.getElementById("recq").onchange=e=>{
    if(Object.prototype.hasOwnProperty.call(MP3_QUALITY,e.target.value))state.mp3Quality=e.target.value;
    writeRecSettings();if(state.recTake)showTake();};
  document.getElementById("recsaved").onclick=savedAction;
  listSaved();
  if(navigator.mediaDevices.addEventListener)navigator.mediaDevices.addEventListener("devicechange",listInputs);
  listInputs();})();
loadSolo();
render();
// the two-day re-listen prompt shows on the Songs button from the start, on any view
if(typeof libList==="function"&&typeof libBadge==="function")libList().then(libBadge,()=>{});
