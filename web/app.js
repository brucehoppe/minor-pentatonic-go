// Minor Pentatonic Practice Desk — the whole interactive desk.
//
// One script, one global scope, no build step: it is embedded in the Go binary
// and served as-is. tests/app.test.mjs runs this file against a small DOM stand-in.
const NOTES=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const IV={0:"1",1:"♭2",2:"2",3:"♭3",4:"3",5:"4",6:"♭5",7:"5",8:"♭6",9:"6",10:"♭7",11:"7"};
const OPEN=[4,11,7,2,9,4], SL=["e","B","G","D","A","E"];
const BOXES=[
  {n:1,off:[[0,3],[0,3],[0,2],[0,2],[0,2],[0,3]],tip:"Home base. Root under the first finger on both E strings."},
  {n:2,off:[[3,5],[3,5],[2,4],[2,5],[2,5],[3,5]],tip:"The stretchy one. Roots land on the D and B strings."},
  {n:3,off:[[5,7],[5,8],[4,7],[5,7],[5,7],[5,7]],tip:"Roots on the A and B strings. Top half is the B.B. box."},
  {n:4,off:[[7,10],[8,10],[7,9],[7,9],[7,10],[7,10]],tip:"Box 1's shape moved across a string set."},
  {n:5,off:[[10,12],[10,12],[9,12],[9,12],[10,12],[10,12]],tip:"Closes the loop — its top edge is Box 1, an octave up."}
];
let key=9, view="path", labelMode="name", chord=null, reg=0, chartOpen=null, boxLock=[];
let showB5=false, blueLock=null;
let majorKey=0, majorDegrees=false, majorArrows=true;
let modeId="dorian";
// Solo lab: which shapes are in play, and the run being built inside them.
// The run is stored as offsets from the zone's root fret, so it follows the key,
// the register and the box selection instead of being pinned to absolute frets.
let soloBoxes=[1], soloRun=[], soloTimer=null, soloStep=-1;

const MAXFRET=24;
const REGS=[[-12,"Octave down"],[0,"Standard"],[12,"Octave up"]];
const REGLBL=Object.fromEntries(REGS);
const baseFret=()=>{const f=(key-OPEN[5]+12)%12;return f===0?12:f;};
const fitsNeck=(b,R)=>Math.min(...b.off.flat())+R>=0&&Math.max(...b.off.flat())+R<=MAXFRET;
// The register is a direction, not a fixed transposition. Each shape is moved by whole
// octaves as far as the register asks and the neck allows; a shape with nowhere to go
// stays at its standard position rather than disappearing. So every box is always
// reachable in every register — only where it sits on the neck changes.
function fitRoot(offs){
  const lo=Math.min(...offs),hi=Math.max(...offs);
  let r=baseFret();
  if(reg<0){while(r-12+lo>=0)r-=12;}
  else if(reg>0){while(r+12+hi<=MAXFRET)r+=12;}
  return r;}
const boxRoot=b=>fitRoot(b.off.flat());
function regNote(b){
  if(!reg||moved(b))return "";
  return `<p class="tip stayed">Standard position — there is no room for this shape ${
    reg<0?"an octave lower; its bottom note would fall past the nut":"an octave higher; its top note would run past fret "+MAXFRET}.</p>`;}
const groupRoot=(...bs)=>fitRoot(bs.flatMap(b=>b.off.flat()));
const boxSpan=b=>{const R=boxRoot(b),fl=b.off.flat();
  return {R,lo:Math.min(...fl)+R,hi:Math.max(...fl)+R};};
// true when the register actually moved this shape off its standard position
const moved=b=>boxRoot(b)!==baseFret();
const boxesAt=r=>BOXES;            // every box exists at every register now
// what a register actually does to the neck: the span it puts the five boxes in,
// and how many of them it managed to move off their standard position
function regInfo(r){
  const keep=reg;reg=r;
  const spans=BOXES.map(boxSpan),shifted=BOXES.filter(moved).length;
  reg=keep;
  return {lo:Math.min(...spans.map(s=>s.lo)),hi:Math.max(...spans.map(s=>s.hi)),shifted};}
const validBoxes=()=>BOXES;
const rootFret=()=>fitRoot([0]);
const noteAt=(s,f)=>(OPEN[s]+f)%12;
const deg=pc=>(pc-key+12)%12;
const isScale=pc=>[0,3,5,7,10].includes(deg(pc));
const isB5=pc=>deg(pc)===6;
// ghost b5 dots inside a fret window, for any note list
function b5Notes(lo,hi,strings=[0,1,2,3,4,5]){const o=[];
  strings.forEach(st=>{for(let f=Math.max(0,lo);f<=hi;f++)if(isB5(noteAt(st,f)))o.push({s:st,f,kind:"ghost"});});
  return o;}
function withB5(notes){if(!showB5||!notes.length)return notes;
  const fs=notes.map(n=>n.f),lo=Math.min(...fs),hi=Math.max(...fs);
  const have=new Set(notes.map(n=>n.s+":"+n.f));
  const strings=[...new Set(notes.map(n=>n.s))];
  return notes.concat(b5Notes(lo,hi,strings).filter(n=>!have.has(n.s+":"+n.f)));}
const CHORDS={i:[0,3,7],iv:[5,8,0],v:[7,10,2]};
const isChordTone=pc=>chord?CHORDS[chord].includes(deg(pc)):false;
function boxNotes(b,R=boxRoot(b)){const o=[];b.off.forEach((p,s)=>p.forEach(x=>o.push({s,f:x+R})));return o;}
const kindOf=n=>noteAt(n.s,n.f)===key?"root":"tone";
function dotText(n){
  if(n.ord!==undefined)return n.ord;
  if(labelMode==="none")return "";
  const pc=noteAt(n.s,n.f);
  return labelMode==="interval"?(IV[deg(pc)]||""):NOTES[pc];
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
  for(let i=0;i<=cols;i++){const x=P+i*w;
    s+=`<line x1="${x}" y1="${pad}" x2="${x}" y2="${pad+5*h}" stroke="var(--ink)" stroke-width="${i===0&&start===0?4:1.2}" opacity="${i===0&&start===0?1:.42}"/>`;
    if(i>0)s+=`<text x="${x-w/2}" y="${pad+5*h+18}" font-size="10.5" fill="var(--ink)" opacity=".5" text-anchor="middle" font-family="DM Mono,monospace">${start+i}</text>`;}
  for(let r=0;r<6;r++){const y=pad+r*h;
    s+=`<line x1="${P}" y1="${y}" x2="${P+cols*w}" y2="${y}" stroke="var(--ink)" stroke-width="${.7+r*.28}" opacity=".55"/>`;
    s+=`<text x="${labelX}" y="${y+4}" font-size="11" fill="var(--ink)" opacity=".45" text-anchor="middle" font-family="DM Mono,monospace">${SL[r]}</text>`;}
  notes.forEach((n,i)=>{
    const x=xOf(n.f),y=pad+n.s*h,k=n.kind||kindOf(n),pc=noteAt(n.s,n.f);
    const fill=quiz?"var(--blue)":k==="root"?"var(--pink)":k==="pivot"?"var(--gold)":k==="ghost"?"var(--card)":"var(--blue)";
    s+=`<g class="${quiz?"qn":"pn"}" ${quiz?`data-pc="${pc}" data-i="${i}" tabindex="0" role="button" aria-label="fret ${n.f} on ${SL[n.s]} string"`:`data-s="${n.s}" data-f="${n.f}" role="button" tabindex="0" aria-label="play ${NOTES[pc]}, fret ${n.f} on the ${SL[n.s]} string"`}>`;
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
      if(!showB5||!isB5(pc))continue;
      const cx=f===0?pad-11:pad+(f-.5)*w,y=pad+r*h,on=hl.length===0||inBox(r,f,true);
      o+=`<circle cx="${cx}" cy="${y}" r="8" fill="var(--card)" stroke="var(--gold)" stroke-width="2" stroke-dasharray="3 2" opacity="${on?1:.12}"/>`;
      continue;}
    const cx=f===0?pad-11:pad+(f-.5)*w,y=pad+r*h,on=hl.length===0||inBox(r,f);
    if(isChordTone(pc)&&on)o+=`<circle cx="${cx}" cy="${y}" r="11" fill="none" stroke="var(--gold)" stroke-width="2"/>`;
    o+=`<circle cx="${cx}" cy="${y}" r="8.5" fill="${pc===key?'var(--pink)':'var(--blue)'}" opacity="${on?1:.12}"/>`;}
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
const rootOn=s=>{const f=(key-OPEN[s]+12)%12;return f===0?12:f;};
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
       +`<text x="${x}" y="${y+3.2}" font-size="8.5" fill="var(--ink)" text-anchor="middle" font-family="DM Mono,monospace" pointer-events="none">${labelMode==="none"?"":labelMode==="interval"?"♭5":NOTES[pc]}</text></g>`;
    }else{
      o+=`<g class="pn" data-s="${r}" data-f="${f}" role="button" tabindex="0" aria-label="play ${NOTES[pc]}, fret ${f} on the ${SL[r]} string" opacity="${op}">`
       +`<circle cx="${x}" cy="${y}" r="8.5" fill="${pc===key?'var(--pink)':'var(--blue)'}"/>`
       +`<text x="${x}" y="${y+3.2}" font-size="8.5" fill="var(--card)" text-anchor="middle" font-family="DM Mono,monospace" pointer-events="none">${labelMode==="none"?"":labelMode==="interval"?(IV[deg(pc)]||""):NOTES[pc]}</text></g>`;}}
  return o+"</svg>";
}

function renderBoxes(){
  const laid=[...validBoxes()].sort((x,y)=>boxSpan(x).lo-boxSpan(y).lo);
  document.getElementById("boxes").innerHTML=laid.map(b=>{
    const {R,lo,hi}=boxSpan(b);
    return `<div class="card" data-box="${b.n}" tabindex="0"><h2>Box ${b.n}<em>fret ${lo}–${hi}</em></h2>${
      fretboard(boxNotes(b,R))}<p class="tip">${b.tip}</p>${regNote(b)}</div>`;}).join("");
  const ord=document.getElementById("boxorder");
  if(ord)ord.innerHTML=reg&&laid.some((b,i)=>b.n!==i+1)
    ?`Laid out low to high on the neck: <b>${laid.map(b=>"Box "+b.n).join(" · ")}</b>. At this register the boxes no longer run in numeric order — Box 1 is a shape, not a place.`
    :"";
  const ml=document.getElementById("maplabel");
  const show=()=>{
    document.getElementById("fullmap").innerHTML=fullMap(boxLock);
    ml.textContent=boxLock.length
      ?`Full neck — ${boxLock.length===1?"Box":"Boxes"} ${boxLock.join(" + ")} selected`
      :"Full neck — all boxes";
    document.querySelectorAll("#boxselect button").forEach(b=>{
      b.setAttribute("aria-pressed",boxLock.includes(+b.dataset.box));});
    document.querySelectorAll("#boxes .card").forEach(c=>{
      const selected=boxLock.includes(+c.dataset.box);
      c.classList.toggle("now",selected);
      c.setAttribute("aria-pressed",selected);});
  };
  const toggle=n=>{
    boxLock=boxLock.includes(n)?boxLock.filter(x=>x!==n):[...boxLock,n].sort((a,b)=>a-b);
    show();
  };
  const choices=document.getElementById("boxselect");
  choices.innerHTML="";
  BOXES.forEach(b=>mk(choices,{box:b.n},`Box ${b.n}`,()=>toggle(b.n)));
  document.getElementById("boxreset").onclick=()=>{boxLock=[];show();};
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
const soloSel=()=>BOXES.filter(b=>soloBoxes.includes(b.n));
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
    kind:noteAt(n.s,n.f)===key?"root":n.boxes.length>1?"pivot":"tone",
    ring:n.boxes.length>1&&noteAt(n.s,n.f)===key}));}
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
  JSON.stringify({boxes:soloBoxes,run:soloRun}));}catch(e){}}
function loadSolo(){try{const v=JSON.parse(window.localStorage.getItem(SOLO_KEY)||"null");
  if(v&&Array.isArray(v.boxes)&&v.boxes.length){soloBoxes=v.boxes.filter(n=>n>=1&&n<=5);
    if(Array.isArray(v.run))soloRun=v.run.filter(n=>n&&typeof n.s==="number"&&typeof n.o==="number");}
  }catch(e){}}

// ---- playback, at whatever the tempo slider says ----
function stopSolo(){if(soloTimer){clearInterval(soloTimer);soloTimer=null;}
  soloStep=-1;markSoloStep(-1);
  const b=document.getElementById("soloplay");
  if(b){b.textContent="Play run";b.setAttribute("aria-pressed",false);}}
function markSoloStep(i){
  const host=document.getElementById("solorun");
  if(!host)return;
  host.querySelectorAll("g.pn").forEach(g=>g.classList.remove("playing"));
  if(i<0||i>=soloRun.length)return;
  const R=soloRoot(),n=soloRun[i];
  const g=host.querySelector(`g.pn[data-s="${n.s}"][data-f="${n.o+R}"]`);
  if(g)g.classList.add("playing");}
function playSolo(){
  if(soloTimer){stopSolo();return;}
  const note=document.getElementById("soloplaymsg");
  if(!soloRun.length){
    if(note)note.textContent="Nothing to play yet — tap notes on the zone map above, or use Fill with.";
    return;}
  if(!audio()){if(note)note.innerHTML=audioFault||"Audio is unavailable in this browser.";return;}
  if(note)note.textContent="";
  const R=soloRoot(),gap=30/bpm;          // eighth notes at the current tempo
  soloStep=0;
  const tick=when=>{
    if(soloStep>=soloRun.length){
      // The last note is already booked; stop once it has sounded, not before.
      const t=soloTimer;clearInterval(t);
      atBeat(when,()=>{if(soloTimer===t)stopSolo();});return;}
    const n=soloRun[soloStep],step=soloStep;
    pluck(midiAt(n.s,n.o+R),when,Math.max(.18,gap*1.7),.5);
    atBeat(when,()=>{if(soloTimer)markSoloStep(step);});
    soloStep++;};
  soloTimer=beatLoop(gap,tick);
  const b=document.getElementById("soloplay");
  b.textContent="Stop";b.setAttribute("aria-pressed",true);}

function renderSolo(){
  const R=soloRoot(),zone=soloZone(),sel=soloSel();
  const lo=zone.length?Math.min(...zone.map(n=>n.f)):R;
  const hi=zone.length?Math.max(...zone.map(n=>n.f)):R;

  // box toggles
  const bx=document.getElementById("soloboxes");
  bx.innerHTML='<span class="lbl">Boxes</span>';
  BOXES.forEach(b=>{const on=soloBoxes.includes(b.n),btn=document.createElement("button");
    btn.textContent="Box "+b.n;btn.setAttribute("aria-pressed",on);
    btn.onclick=()=>{stopSolo();
      soloBoxes=on?soloBoxes.filter(n=>n!==b.n):[...soloBoxes,b.n].sort((x,y)=>x-y);
      if(!soloBoxes.length)soloBoxes=[b.n];
      saveSolo();renderSolo();};
    bx.appendChild(btn);});
  [["All",()=>[1,2,3,4,5]],["Just Box 1",()=>[1]],["1 + 2",()=>[1,2]],["1 + 4",()=>[1,4]]]
    .forEach(([t,f])=>{const btn=document.createElement("button");
      btn.textContent=t;btn.style.opacity=".75";
      btn.onclick=()=>{stopSolo();soloBoxes=f();saveSolo();renderSolo();};
      bx.appendChild(btn);});

  // pattern fills
  const pt=document.getElementById("solopatterns");
  pt.innerHTML='<span class="lbl">Fill with</span>';
  SOLOPATTERNS.forEach(p=>{const btn=document.createElement("button");
    btn.textContent=p.t;btn.title=p.tip;
    btn.onclick=()=>{stopSolo();soloRun=buildRun(p.id);saveSolo();renderSolo();};
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
      soloRun=[...soloRun,{s:+g.dataset.s,o:+g.dataset.f-R}];saveSolo();renderSolo();};
    g.addEventListener("click",add);
    g.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();add();}});});

  // ---- the run ----
  const c=[];
  if(!soloRun.length){
    c.push(`<div class="card wide"><h2>Your run<em>nothing yet</em></h2>
      <p class="tip">Tap notes on the zone map above to build a run one note at a time, or use
      <b>Fill with</b> to drop in a practice pattern and edit from there. Everything you build is kept on
      this device, so it is still here next time.</p></div>`);
  }else{
    const map=new Map();
    soloRun.forEach((n,i)=>{const k=n.s+":"+n.o;
      if(map.has(k))map.get(k).ord+="·"+(i+1);
      else map.set(k,{s:n.s,f:n.o+R,ord:String(i+1),
        kind:noteAt(n.s,n.o+R)===key?"root":"tone"});});
    const frets=soloRun.map(n=>n.o+R);
    const outside=soloRun.filter(n=>!inZone(n.s,n.o+R)).length;
    const strings=new Set(soloRun.map(n=>n.s)).size;
    const roots=soloRun.filter(n=>noteAt(n.s,n.o+R)===key).length;
    const last=soloRun[soloRun.length-1];
    const endsOnRoot=noteAt(last.s,last.o+R)===key;
    c.push(`<div class="card wide"><h2>Your run<em>${soloRun.length} notes · fret ${Math.min(...frets)}–${Math.max(...frets)}</em></h2>
      <div id="solorun">${fretboard([...map.values()],{w:44,plain:true})}</div>
      <pre>${tab(soloRun.map(n=>[n.s,n.o]),R)}</pre>
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
        <li><label>${soloRun.length} notes across ${strings} string${strings>1?"s":""}</label></li>
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
  bind("solorev",()=>{stopSolo();soloRun=[...soloRun].reverse();saveSolo();renderSolo();});
  bind("soloundo",()=>{stopSolo();soloRun=soloRun.slice(0,-1);saveSolo();renderSolo();});
  bind("soloclear",()=>{stopSolo();soloRun=[];saveSolo();renderSolo();});
}

function renderConnect(){
  document.getElementById("connect").innerHTML=[0,1,2,3].map(i=>{
    const a=BOXES[i],b=BOXES[i+1],R=groupRoot(a,b),map=new Map();
    const add=(s,f)=>{const k=s+":"+f;
      if(map.has(k))map.get(k).kind="pivot";
      else map.set(k,{s,f,kind:noteAt(s,f)===key?"root":"tone"});};
    a.off.forEach((p,s)=>p.forEach(o=>add(s,o+R)));
    b.off.forEach((p,s)=>p.forEach(o=>add(s,o+R)));
    const notes=[...map.values()].map(n=>({...n,ring:n.kind==="pivot"&&noteAt(n.s,n.f)===key}));
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
  const c=[],k=NOTES[key];
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
    rows+=`<tr${i===key?' class="me"':''}><td>${NOTES[i]}5</td><td>${e6}${e6===0?" (open)":""}</td>`
        +`<td>${a5}${a5===0?" (open)":""}</td><td>${d4}${d4===0?" (open)":""}</td></tr>`;}
  c.push(`<div class="card"><h2>Every power chord<em>root fret on each string</em></h2>
    <table><tr><th>Chord</th><th>Low E root</th><th>A root</th><th>D root</th></tr>${rows}</table>
    <p class="tip">Add 12 to any fret for the same chord an octave up. The fifth is always two frets up on
    the next string — <b>except</b> on the G string, where it is three.</p></div>`);

  PCPROG.forEach(pg=>{
    const ch=pg.d.map(d=>{const pcs=(key+d)%12,f=(pcs-OPEN[5]+12)%12;
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
  if(sk)sk.onclick=()=>{key=SONGKEY;stopDrone();blueLock=null;
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
    document.getElementById("bluesmap").innerHTML=bluesMap(blueLock);
    if(!blueLock){ml.textContent="Whole neck — all five boxes with the ♭5 dropped in";
      bt.innerHTML="Every pentatonic note on the neck, plus every <b>♭5</b> as a dashed dot. The blues boxes below are slices of this. Isolate one to see where it repeats — each shape comes back twelve frets away, so a lick learned once is available twice. <b>Tap any dot to hear it.</b>";}
    else{const z=ZONES[blueLock];
      if(z){ml.textContent=`Whole neck — ${z.t} isolated`;bt.innerHTML=z.tip;}
      else{const n=+blueLock.slice(3),b=BOXES[n-1],fl=b.off.flat();
        ml.textContent=`Whole neck — Box ${n} isolated`;
        bt.innerHTML=`<b>Box ${n}, fret ${Math.min(...fl)+R}–${Math.max(...fl)+R}</b> and again an octave either side. ${b.tip} The dashed ♭5s inside it are the blues notes available without leaving the shape.`;}}
    document.querySelectorAll("#bluesfocus button").forEach(b=>
      b.setAttribute("aria-pressed",(b.dataset.z||null)===blueLock));};
  const focus=document.getElementById("bluesfocus");
  focus.innerHTML='<span class="lbl">Isolate</span>';
  const addBtn=(z,t)=>{const b=document.createElement("button");
    if(z)b.dataset.z=z;b.textContent=t;
    b.onclick=()=>{blueLock=(blueLock===z)?null:z;drawMap();};focus.appendChild(b);};
  addBtn(null,"All");
  [1,2,3,4,5].forEach(n=>addBtn("box"+n,"Box "+n));
  addBtn("blues","Blues box");addBtn("bb","B.B.");addBtn("ak","Albert King");
  drawMap();

  // --- close-up cards for the boxes that fit at this register ---
  {const R=boxRoot(BOXES[0]),b5=(key+6)%12;
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
  const R=groupRoot(BOXES[0],BOXES[1]),k=NOTES[key];
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
      GUIDEKEYS.map(i=>`<button class="guidekey" data-k="${i}"${i===key?' aria-pressed="true"':''}>${NOTES[i]}m</button>`).join("")}</div></div>`;
  document.getElementById("licks").innerHTML=rootCard+LICKS.map(l=>{
    const LR=fitRoot(l.n.map(e=>e[1])),map=new Map();
    l.n.forEach(([s,o],i)=>{const k=s+":"+o;
      if(map.has(k))map.get(k).ord+="·"+(i+1);
      else map.set(k,{s,f:o+LR,ord:String(i+1),kind:noteAt(s,o+LR)===key?"root":"tone"});});
    return `<div class="card${l.g?" fromguide":""}"><h2>${l.t}<em>${l.e}</em></h2>${
      l.g?`<p class="badge">Practice guide</p>`:""}${fretboard([...map.values()],{w:44})}<pre>${tab(l.n,LR)}</pre>
      <p class="tip">${l.tip.replace(/\$\{K\}/g,k)}</p></div>`;}).join("");
  document.querySelectorAll(".guidekey").forEach(b=>b.onclick=()=>{
    key=+b.dataset.k;stopDrone();blueLock=null;
    render();});
}


// ---------- learning path ----------
const PATH=[
 {n:1,t:"Time, before notes",d:"about a week",go:[],
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
 {n:4,t:"The sound: bends and vibrato",d:"start now, never stops",go:[["blues","Open the drills"]],
  goal:"Play the target note, hold it in your head, then bend to it and check. Vibrato from the wrist, even in speed and width, on a held note.",
  why:"Bad bends and shaky vibrato make good note choices sound amateur. Good ones make three notes sound professional. This is the highest-return technical work in blues playing.",
  test:"A recorded bend that lands in tune, held with vibrato that doesn't wobble in speed. Listen back — recording is the only honest judge here."},
 {n:5,t:"Vocabulary — three licks, not thirty",d:"2–4 weeks",go:[["licks","Open the drills"]],
  goal:"Take three licks. Learn each in three keys. Then break each into fragments and rearrange them — first half of one, second half of another.",
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
function renderPath(){
  document.getElementById("path").innerHTML=
    PATH.map(p=>`<div class="card"><h2>${p.n} · ${p.t}<em>${p.d}</em></h2>
      <p class="tip"><b>Do this.</b> ${p.goal}</p>
      <p class="tip"><b>Why here.</b> ${p.why}</p>
      <p class="tip"><b>Move on when.</b> ${p.test}</p>
      ${p.go.length?`<div class="row" style="margin-top:10px">${
        p.go.map(([v,t])=>`<button data-goto="${v}">${t}</button>`).join("")}</div>`:""}
      </div>`).join("")
   +HOWTO.map(h=>`<div class="card"><h2>${h.t}</h2><ol>${h.items.map(i=>`<li>${i}</li>`).join("")}</ol></div>`).join("");
  document.querySelectorAll("#path button[data-goto]").forEach(b=>
    b.onclick=()=>{view=b.dataset.goto;render();window.scrollTo({top:0,behavior:"smooth"});});
}

// ---------- over a song ----------
function renderSong(){
  const rel=NOTES[(key+3)%12], k=NOTES[key];
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
    else m.set(k,{s:st,f:o+R,ord:String(i+1),kind:noteAt(st,o+R)===key?"root":"tone",...(to!==undefined?{to:to+R}:{})});});
  return [...m.values()];}
function runTab(run,R){return tab(run.map(([st,o,to])=>to!==undefined?[st,o,"/"]:[st,o]),R);}
const PHRASE=[[1,3],[0,0],[0,3,"~"],[1,10],[1,8],[2,9,"~"]];
function renderLand(){
  // Box 1 and Box 4 are taught as a pair and the slide runs travel between them,
  // so the whole view sits at the lowest position that holds both shapes.
  const R=groupRoot(BOXES[0],BOXES[3]),k=NOTES[key],host=document.getElementById("land");
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
      ${fretboard(PHRASE.map(([s,o],i)=>({s,f:o+R,ord:String(i+1),kind:noteAt(s,o+R)===key?"root":"tone"})),{w:38})}
      <pre>${tab(PHRASE,R)}</pre>
      <p class="tip">First three notes ask the question down in Box 1, ending on a held note with vibrato.
      <b>Leave a full bar of silence.</b> Then answer up in Box 4 and land on the root on the G string.
      Same idea, two landmarks — this is what using both shapes actually sounds like, and it's four
      seconds of music, not an exercise.</p></div>`);
  }
  if(reg&&R===baseFret())c.unshift(`<p class="tip stayed" style="grid-column:1/-1">Standard position — Box 1 and Box 4 are taught as a pair and the slide runs travel between them, so they share one position, and in ${k} minor the pair has no room to move ${reg<0?"an octave lower":"an octave higher"}. Each box on its own does move: see <b>5 boxes</b>.</p>`);
  // all-keys reference
  let rows="";
  for(let i=0;i<12;i++){
    const base=((i-OPEN[5]+12)%12)||12, low=base-12;
    rows+=`<tr${i===key?' class="me"':''}><td>${NOTES[i]}m</td><td>${base}\u2013${base+3}</td>`
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
    const open=i===chartOpen;
    return `<div class="card strip${i===key?" now":""}${open?" open":""}" data-key="${i}" tabindex="0" role="button" aria-expanded="${open}">
       <h2>${n} minor<em>${open?"tap to close":"tap to enlarge"}</em></h2>
       ${open?keyStrip(i,{w:46,h:26,pad:26,big:true}):keyStrip(i)}
       ${open?`<p class="tip">Dots are labelled with scale degrees. <b style="color:var(--blue)">Blue = Box 1</b>,
         <b style="color:#A87A00">gold = Box 4</b>, pink is the slide run between them, and the
         <b style="color:#5D5F65">grey rings are the rest of the scale</b> — hollow rather than filled, but
         every one of them is a note you can play. This key is now loaded into every other view.</p>`:""}</div>`;}).join("");
  document.querySelectorAll("#chart .strip").forEach(c=>{
    const go=()=>{const i=+c.dataset.key;chartOpen=(chartOpen===i)?null:i;
      if(chartOpen!==null){key=i;stopDrone();
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
  const doors=boxNotes(db,dbs.R).map(n=>({...n,kind:"pivot",ring:noteAt(n.s,n.f)===key}));
  c.push({t:"4 · Every note is a door",e:`Box ${db.n}, fret ${dbs.lo}–${dbs.hi}`,
    body:fretboard(doors,{w:46}),
    tip:"Each string in a box holds two notes: the lower one is shared with the box below, the upper one with the box above. So <b>every note you play is already a doorway</b>. Drill: drone on, wander in the box above, and shift position the moment you hit the ♭7 — land on a root or chord tone straight after, and the move sounds deliberate instead of lost. Shift in the gaps between phrases, never mid-run."});
  document.getElementById("cross").innerHTML=c.map(x=>
    `<div class="card"><h2>${x.t}<em>${x.e}</em></h2>${x.body}<p class="tip">${x.tip}</p></div>`).join("");
}

// ---------- practice ----------
let quiz=null;
function newQuiz(){
  const vs=validBoxes(),b=vs[Math.floor(Math.random()*vs.length)],t=[0,3,5,7,10][Math.floor(Math.random()*5)];
  const notes=boxNotes(b);
  quiz={box:b,target:t,total:notes.filter(n=>deg(noteAt(n.s,n.f))===t).length,found:0,wrong:0,notes};
  document.getElementById("quizboard").innerHTML=fretboard(notes,{w:46,quiz:true});
  document.getElementById("quizstatus").innerHTML=
    `Box ${b.n}, key ${NOTES[key]} minor — tap every <b>${IV[t]}</b> (${NOTES[(key+t)%12]}). 0 of ${quiz.total}.`;
  document.querySelectorAll("#quizboard .qn").forEach(g=>{
    const hit=()=>answer(g);
    g.addEventListener("click",hit);
    g.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();hit();}});});
}
function answer(g){
  if(g.dataset.done||quiz.found===quiz.total)return;
  const pc=+g.dataset.pc,c=g.querySelector("circle"),t=g.querySelector("text"),st=document.getElementById("quizstatus");
  if(deg(pc)===quiz.target){
    g.dataset.done=1;quiz.found++;c.setAttribute("fill","var(--pink)");t.textContent=IV[quiz.target];
    st.innerHTML=quiz.found===quiz.total
      ? `All ${quiz.total} found${quiz.wrong?` with ${quiz.wrong} miss${quiz.wrong>1?"es":""}`:" clean"}. Now play them, lowest to highest, saying <b>${IV[quiz.target]}</b> out loud.`
      : `Tap every <b>${IV[quiz.target]}</b> (${NOTES[(key+quiz.target)%12]}). ${quiz.found} of ${quiz.total}.`;
  }else{
    quiz.wrong++;c.setAttribute("fill","var(--gold)");
    setTimeout(()=>c.setAttribute("fill","var(--blue)"),320);
    st.innerHTML=`That one's the <b>${IV[deg(pc)]}</b>. Still looking for the ${IV[quiz.target]} — ${quiz.found} of ${quiz.total}.`;
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
    [`Warm up: root drone on, ${NOTES[key]} minor, wander for 3 min`,...p.map(x=>x+" — 5 min"),
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
function readChecks(){try{return JSON.parse(window.localStorage.getItem(CHECK_KEY)||"[]");}catch(e){return [];}}
function writeChecks(v){try{window.localStorage.setItem(CHECK_KEY,JSON.stringify(v));}catch(e){}}

function renderGuide(){
  const k=NOTES[key],done=readChecks();
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
      GUIDEKEYS.map(i=>`<button class="guidekey" data-k="${i}"${i===key?' aria-pressed="true"':''}>${NOTES[i]}m</button>`).join("")}</div>
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
    key=+b.dataset.k;stopDrone();blueLock=null;
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
let timerSeconds=300,timerInitial=300,timerHandle=null,ladderStart=90,ladderRound=1;
function timerText(n){return String(Math.floor(n/60)).padStart(2,"0")+":"+String(n%60).padStart(2,"0");}
function paintTimer(){document.getElementById("timerface").textContent=timerText(timerSeconds);}
function setTimer(minutes){stopTimer();timerInitial=timerSeconds=minutes*60;paintTimer();
  document.getElementById("timerstatus").textContent=`Ready for ${minutes} focused minute${minutes===1?"":"s"}.`;
  document.querySelectorAll(".timerpreset").forEach(b=>b.setAttribute("aria-pressed",+b.dataset.min===minutes));}
function stopTimer(){if(timerHandle){clearInterval(timerHandle);timerHandle=null;}
  const b=document.getElementById("toggletimer");if(b){b.textContent="Start";b.setAttribute("aria-pressed",false);}}
function timerCue(){const a=audio();if(!a)return;a.blip(880,{dur:.35,vol:.18});}
function toggleTimer(){if(timerHandle){stopTimer();document.getElementById("timerstatus").textContent="Paused — your time is preserved.";return;}
  if(timerSeconds===0)timerSeconds=timerInitial;
  const b=document.getElementById("toggletimer");b.textContent="Pause";b.setAttribute("aria-pressed",true);
  document.getElementById("timerstatus").textContent="Focus on one thing until the cue.";
  timerHandle=setInterval(()=>{timerSeconds=Math.max(0,timerSeconds-1);paintTimer();if(timerSeconds===0){stopTimer();timerCue();
    document.getElementById("timerstatus").innerHTML="Time. <b>Stop, breathe, and name what improved.</b>";}},1000);}
function resetTimer(){stopTimer();timerSeconds=timerInitial;paintTimer();document.getElementById("timerstatus").textContent="Reset and ready.";}
function ladder(delta){bpm=Math.max(40,Math.min(220,bpm+delta));ladderRound++;
  document.getElementById("bpm").value=bpm;document.getElementById("bpmv").textContent=bpm+" bpm";
  document.getElementById("ladderbpm").textContent=bpm;restartClick();
  document.getElementById("ladderstatus").innerHTML=`Round ${ladderRound} · ${delta>0?"clean — keep the motion relaxed":"miss — rebuild cleanly"}`;}
function resetLadder(){bpm=ladderStart;ladderRound=1;document.getElementById("bpm").value=bpm;
  document.getElementById("bpmv").textContent=bpm+" bpm";document.getElementById("ladderbpm").textContent=bpm;
  document.getElementById("ladderstatus").textContent="Round 1 · starting tempo";restartClick();}
const LOG_KEY="minor-pentatonic-practice-log-v1";
function readLog(){try{return JSON.parse(window.localStorage.getItem(LOG_KEY)||"[]");}catch(e){return [];}}
function writeLog(log){try{window.localStorage.setItem(LOG_KEY,JSON.stringify(log));}catch(e){}}
function renderLog(){const log=readLog(),host=document.getElementById("loglist");
  document.getElementById("logsummary").innerHTML=log.length?`<b>${log.length}</b> completed session${log.length===1?"":"s"} logged.`:"No completed sessions yet.";
  host.innerHTML=log.slice(0,8).map(x=>`<li><span>${escapeHTML(x.date)}</span><span>${escapeHTML(x.key)} minor · ${Number(x.bpm)||0} bpm</span></li>`).join("");}
// Log entries come back from localStorage, which anything on this origin can write.
function escapeHTML(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);}
function completeSession(){const log=readLog(),date=new Date().toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"});
  log.unshift({date,key:NOTES[key],bpm});writeLog(log.slice(0,30));renderLog();
  document.getElementById("logsummary").innerHTML=`Logged today’s <b>${NOTES[key]} minor</b> session at ${bpm} bpm.`;}
function clearLog(){writeLog([]);renderLog();}

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
let trainerTimer=null,trainerBar=-1,trainerBeat=0,trainerCount=4;
function currentForm(){return BLUES_FORMS[document.getElementById("bluesform").value]||BLUES_FORMS.classic;}
function chordInfo(symbol){const roman=symbol.match(/^[b#]?[IV]+/)[0],kind=symbol.slice(roman.length),
  roots={I:0,bII:1,II:2,bIII:3,III:4,IV:5,"#IV":6,V:7,bVI:8,VI:9,bVII:10,VII:11};
  return {symbol,root:roots[roman],kind,intervals:CHORD_KIND[kind]};}
function chordName(symbol){const c=chordInfo(symbol);return NOTES[(key+c.root)%12]+c.kind;}
// bar and beat default to the live position; the beat clock passes the ones being
// drawn, because it books beats slightly before they sound.
function renderTrainer(bar=trainerBar,beat=trainerBeat){const form=currentForm();
  document.getElementById("bluesbars").innerHTML=form.chords.map((entry,i)=>{
    const syms=barSymbols(entry);
    return `<div class="bluesbar${i===bar?" now":""}${syms.length>1?" split":""}"><span>${i+1}</span>${
      syms.map(sym=>`<b>${chordName(sym)}</b>`).join("")}<span>${syms.join(" ")}</span></div>`;}).join("");
  const entry=bar<0?form.chords[0]:form.chords[bar];
  const symbol=symbolAt(entry,bar<0?0:beat),c=chordInfo(symbol),roles=["root","3rd","5th","7th"];
  const targets=c.intervals.map((x,i)=>`${roles[i]} (${NOTES[(key+c.root+x)%12]})`).join(" · ");
  document.getElementById("trainertarget").innerHTML=`Target tones for <b>${chordName(symbol)}</b>: ${targets}`;
  document.getElementById("formtip").textContent=form.tip;
  document.getElementById("formheard").textContent=form.heard;
  document.getElementById("trainerreadout").textContent=bar<0?"ready":`bar ${bar+1} · beat ${beat+1}`;}
function trainerSound(symbol,beat,when=0){
  const a=audio();if(!a)return;
  const c=chordInfo(symbol),pc=(key+c.root)%12,groove=document.getElementById("groove").value;
  const hzs=c.intervals.map((iv,i)=>freq((pc+iv)%12)*(i?1:.5));
  const hold=groove==="slow"?.38:.1;
  a.chord(hzs,{when,dur:hold,vol:beat===0?.06:.032});
  if(groove==="shuffle")a.chord(hzs,{when:when+(60/bpm)*2/3,dur:hold,vol:.018});}
function trainerTick(when=0){const form=currentForm();
  if(trainerCount>0){const text=`count in · ${5-trainerCount}`;
    trainerSound(symbolAt(form.chords[0],0),4-trainerCount,when);trainerCount--;
    atBeat(when,()=>{if(trainerTimer)document.getElementById("trainerreadout").textContent=text;});return;}
  if(trainerBar<0)trainerBar=0;
  const bar=trainerBar,beat=trainerBeat;
  trainerSound(symbolAt(form.chords[bar],beat),beat,when);
  atBeat(when,()=>{if(trainerTimer)renderTrainer(bar,beat);});
  trainerBeat++;if(trainerBeat===4){trainerBeat=0;trainerBar=(trainerBar+1)%12;}}
function stopTrainer(){if(trainerTimer){clearInterval(trainerTimer);trainerTimer=null;}const b=document.getElementById("toggletrainer");
  if(b){b.textContent="Start with count-in";b.setAttribute("aria-pressed",false);}}
function toggleTrainer(){if(trainerTimer){stopTrainer();return;}trainerCount=4;trainerBar=-1;trainerBeat=0;
  const b=document.getElementById("toggletrainer");b.textContent="Stop";b.setAttribute("aria-pressed",true);
  trainerTimer=beatLoop(60/bpm,trainerTick);}
function resetTrainer(){stopTrainer();trainerBar=-1;trainerBeat=0;trainerCount=4;renderTrainer();}

// ---------- rhythm and phrasing generator ----------
let rhythm=[1,0,0,0,1,0,1,0,1,0,0,0,1,0,1,0],rhythmTimer=null,rhythmStep=0;
function generateRhythm(){stopRhythm();const density=document.getElementById("density").value,prob={sparse:.24,medium:.4,busy:.62}[density];
  rhythm=Array.from({length:16},(_,i)=>i===0?1:(Math.random()<prob?1:0));rhythmStep=0;renderRhythm();return rhythm;}
function renderRhythm(now=rhythmStep){const syllables=["1","e","&","a","2","e","&","a","3","e","&","a","4","e","&","a"];
  document.getElementById("beatgrid").innerHTML=rhythm.map((hit,i)=>`<div class="beat${hit?" hit":""}${rhythmTimer&&i===now?" now":""}">${hit?syllables[i]:"·"}</div>`).join("");
  const hits=rhythm.reduce((a,b)=>a+b,0);document.getElementById("rhythmcount").innerHTML=`${hits} attacks · ${16-hits} rests · <b>count the rests too</b>`;
  document.getElementById("rhythmroot").textContent=NOTES[key];document.getElementById("rhythmtip").innerHTML=
    `At ${bpm} bpm, one loop lasts ${(240/bpm).toFixed(1)} seconds. Accent beats 2 and 4 without changing the written rhythm.`;}
function rhythmSound(accent,when=0){const a=audio();if(!a)return;a.blip(accent?1100:720,{when,dur:.045,vol:.16});}
function rhythmTick(when=0){const step=rhythmStep;
  if(rhythm[step])rhythmSound(step===4||step===12,when);
  atBeat(when,()=>{if(rhythmTimer)renderRhythm(step);});
  rhythmStep=(rhythmStep+1)%16;}
function stopRhythm(){if(rhythmTimer){clearInterval(rhythmTimer);rhythmTimer=null;}const b=document.getElementById("togglerhythm");
  if(b){b.textContent="Play loop";b.setAttribute("aria-pressed",false);}}
function toggleRhythm(){if(rhythmTimer){stopRhythm();renderRhythm();return;}rhythmStep=0;const b=document.getElementById("togglerhythm");
  b.textContent="Stop";b.setAttribute("aria-pressed",true);rhythmTimer=beatLoop(60/bpm/4,rhythmTick);}

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

const freq = pc => 110 * Math.pow(2, (pc - 9) / 12);
const STRING_MIDI = [64, 59, 55, 50, 45, 40];   // high e first, standard tuning
const midiAt = (s, f) => STRING_MIDI[s] + f;
const midiFreq = m => 440 * Math.pow(2, (m - 69) / 12);

// ---- backend 1: Web Audio ----
function webAudioEngine(ac) {
  const at = when => ac.currentTime + when;
  // one plucked string: two detuned saws plus an octave, through a falling low-pass
  const voice = (f, t, dur, vol) => {
    const g = ac.createGain(), lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(Math.min(9000, f * 9), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(220, f * 2.2), t + dur);
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(.2 * vol, t + .012);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    lp.connect(g); g.connect(ac.destination);
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
    o.connect(g); g.connect(ac.destination);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(.001, t + dur);
    o.start(t); o.stop(t + dur + .02);
  };
  return {
    name: "Web Audio",
    now: () => ac.currentTime,
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
      g.gain.value = .0001; g.connect(ac.destination);
      g.gain.exponentialRampToValueAtTime(.09, ac.currentTime + .6);
      const nodes = hzs.map((f, i) => {
        const o = ac.createOscillator();
        o.type = i === 1 ? "triangle" : "sine"; o.frequency.value = f;
        const og = ac.createGain(); og.gain.value = i === 0 ? 1 : .28;
        o.connect(og); og.connect(g); o.start(); return o;
      });
      return { stop() { nodes.forEach(n => { try { n.stop(); } catch (e) { /* already stopped */ } }); } };
    },
    stopAll() { /* voices stop themselves; nothing is held open */ },
  };
}

// ---- backend 2: rendered WAV through <audio> ----
function wavEngine() {
  const SR = 22050, cache = new Map(), playing = new Set();

  const toBase64 = bytes => {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const toWav = samples => {
    const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const tag = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
    tag(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); tag(8, "WAVE");
    tag(12, "fmt "); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true);          // PCM, mono
    v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);         // 16-bit
    tag(36, "data"); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const x = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7FFF, true);
    }
    return "data:audio/wav;base64," + toBase64(new Uint8Array(buf));
  };

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
    if (!u) { u = toWav(build()); cache.set(key, u); }
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
      return { stop() { clearInterval(fade); release(el); } };
    },
    stopAll() { [...playing].forEach(release); },
  };
}

// ---- choosing one ----
let engine = null, audioFault = null, clickTimer = null, droneHandle = null, bpm = 90;

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
  if (engine) return engine;
  if (audioFault) return null;
  const Ctor = audioContextCtor();
  if (Ctor) {
    try { engine = webAudioEngine(new Ctor()); } catch (e) { engine = null; }
  }
  if (!engine && typeof Audio === "function") {
    try { engine = wavEngine(); } catch (e) { engine = null; }
  }
  if (!engine) { audioFault = noAudioReason(); check(); return null; }
  engine.resume().then(check).catch(check);
  check();
  return engine;
}

// One place decides what the status line says and whether the controls are usable.
function check() {
  const m = document.getElementById("audiomsg");
  if (!m) return;
  if (audioFault) { m.innerHTML = audioFault; audioOff(true); return; }
  audioOff(false);
  if (engine && engine.name === "Compatibility") m.innerHTML = compatibilityReason();
  else if (engine && engine.state() === "suspended")
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
    b.title = dead ? (audioFault || "Audio unavailable").replace(/<[^>]+>/g, "") : "";
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
function beatLoop(stepSec, onBeat) {
  const a = audio();
  if (!a || !a.now) { onBeat(0); return setInterval(() => onBeat(0), stepSec * 1000); }
  let next = a.now();
  const pump = () => {
    const now = a.now();
    const ahead = typeof document !== "undefined" && document.hidden ? 1.5 : .12;
    // After a long stall, carry on from now rather than firing every missed beat at once.
    if (next < now - stepSec) next = now;
    while (next < now + ahead) { onBeat(Math.max(0, next - now)); next += stepSec; }
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
  if (droneHandle) { droneHandle.stop(); droneHandle = null; btn.setAttribute("aria-pressed", false); return; }
  const a = audio(); if (!a) return;
  droneHandle = a.startDrone([freq(key), freq(key) * 2, freq(key) * 3]);
  btn.setAttribute("aria-pressed", true);
}
function stopDrone() {
  if (!droneHandle) return;
  droneHandle.stop(); droneHandle = null;
  const b = document.getElementById("drone");
  if (b) b.setAttribute("aria-pressed", false);
}
function toggleClick(btn) {
  if (clickTimer) { clearInterval(clickTimer); clickTimer = null; btn.setAttribute("aria-pressed", false); return; }
  let beat = 0;
  const tick = when => {
    const a = audio(); if (!a) return;
    a.blip(beat % 4 === 0 ? 1400 : 900, { when, dur: .05, vol: .22 });
    beat++;
  };
  clickTimer = beatLoop(60 / bpm, tick);
  btn.setAttribute("aria-pressed", true);
}
function restartClick() {
  const b = document.getElementById("click");
  if (clickTimer) { clearInterval(clickTimer); clickTimer = null; toggleClick(b); }
  if (trainerTimer) { stopTrainer(); toggleTrainer(); }
  if (rhythmTimer) { stopRhythm(); toggleRhythm(); }
}
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
const majRoot=()=>(((MAJKEYS[majorKey].s-9)%12)+12)%12;

function majorBoard(){
  const K=MAJKEYS[majorKey],R=majRoot(),start=Math.max(0,R-1),rows=13;
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
    if(majorArrows&&p.length===3){
      const y2=TOP+((R+p[1])-start)*BH+BH/2,y3=TOP+((R+p[2])-start)*BH+BH/2;
      o+=`<line x1="${X[st]}" y1="${y2+18}" x2="${X[st]}" y2="${y3-19}" stroke="var(--gold)" stroke-width="1.8" marker-end="url(#majarrow)"/>`;}
    for(let i=0;i<p.length;i++){
      const fr=R+p[i],y=TOP+(fr-start)*BH+BH/2;
      const iv=(((MAJ_OPEN[st]+fr-K.s)%12)+12)%12,rt=iv===0;
      o+=`<circle cx="${X[st]+1.5}" cy="${y+1.5}" r="15" fill="${rt?"var(--blue)":"var(--pink)"}" opacity=".2"/>`;
      o+=`<circle class="majdot" fill="${rt?"var(--pink)":"var(--blue)"}" cx="${X[st]}" cy="${y}" r="15"/>`;
      o+=`<text x="${X[st]}" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="11" font-weight="500" fill="var(--card)" font-family="DM Mono,monospace">${majorDegrees?MAJ_DEG[iv]:majName(MAJ_OPEN[st]+fr,K.f)}</text>`;}}
  return o+"</svg>";
}

function majorTab(){const R=majRoot(),rows=[];
  for(let st=5;st>=0;st--)rows.push(MAJ_SL[st]+" |"+MAJ_PAT[st].map(v=>" "+(R+v)).join(""));
  return rows.join("\n");}

function renderMajor(){
  const K=MAJKEYS[majorKey],R=majRoot();
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
const currentMode=()=>modeById(modeId);

// A mode note carries its own label, because a mode spells its degrees its own way:
// the raised fourth is #4 in lydian, not the ♭5 the pentatonic table would call it.
function modeLabel(mode,i,pc){
  if(labelMode==="none")return "";
  return labelMode==="interval"?mode.degs[i]:NOTES[pc];
}
// Every note of the mode inside one fret window, across all six strings. The windows
// are the five pentatonic box neighbourhoods, so the shapes land where the hand
// already knows to go — the extra scale tones fill in around the box.
function modeNotes(mode,lo,hi){
  const out=[];
  for(let s=0;s<6;s++)for(let f=Math.max(0,lo);f<=hi;f++){
    const d=(noteAt(s,f)-key+12)%12,i=mode.offs.indexOf(d);
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
  let o=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${NOTES[key]} ${mode.name} across the neck">`;
  for(let i=0;i<=cols;i++){const x=pad+i*w;
    o+=`<line x1="${x}" y1="${pad}" x2="${x}" y2="${pad+5*h}" stroke="var(--ink)" stroke-width="${i===0?4:1.1}" opacity="${i===0?1:.32}"/>`;
    if(i>0)o+=`<text x="${x-w/2}" y="${pad+5*h+17}" font-size="10" fill="var(--ink)" opacity=".45" text-anchor="middle" font-family="DM Mono,monospace">${i}</text>`;}
  for(let r=0;r<6;r++)o+=`<line x1="${pad}" y1="${pad+r*h}" x2="${pad+cols*w}" y2="${pad+r*h}" stroke="var(--ink)" stroke-width="${.7+r*.25}" opacity=".5"/>`;
  for(let r=0;r<6;r++)for(let f=0;f<=cols;f++){
    const d=(noteAt(r,f)-key+12)%12;
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
let lastMode=null;
function renderModes(){
  const mode=currentMode(),root=NOTES[key];
  const moved=lastMode!==null&&lastMode!==mode.id;   // a redraw is not a change
  lastMode=mode.id;
  const origins=modeOrigins(mode);
  document.querySelectorAll("#modes button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.m===modeId));
  const spelled=mode.offs.map((d,i)=>`${mode.degs[i]} <b>${NOTES[(key+d)%12]}</b>`).join(" · ");
  const colours=mode.colour.map(d=>`${mode.degs[mode.offs.indexOf(d)]} (${NOTES[(key+d)%12]})`).join(" and ");
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
    const has=d=>notes.some(n=>(noteAt(n.s,n.f)-key+12)%12===d);
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
let noteHL=null, noteString=null;

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
    const pc=noteAt(r,f),nat=NATURALS.includes(pc),lit=noteHL===pc,dim=noteString!==null&&noteString!==r;
    if(!nat&&!lit&&noteHL!==null)continue;
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
  document.querySelectorAll("#notepick button").forEach(b=>b.setAttribute("aria-pressed",+b.dataset.pc===noteHL));
  document.querySelectorAll("#stringpick button").forEach(b=>b.setAttribute("aria-pressed",+b.dataset.st===noteString));
  document.getElementById("necklabel").innerHTML=
    noteHL===null
      ? `Naturals are circled; the sharps between them are faint. <b>Pick a note above</b> to light up every place it lives.`
      : `Every <b>${NOTES[noteHL]}</b> on the neck — ${
          [0,1,2,3,4,5].reduce((n,r)=>n+[...Array(MAXFRET+1).keys()].filter(f=>noteAt(r,f)===noteHL).length,0)
        } of them in 24 frets. The same note, over and over: that is all the neck is.`;
  document.getElementById("octaves").innerHTML=OCTAVES.map(octaveCard).join("");
}

// ---------- triads ----------
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
let triadKind="maj", triadSet="123";
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
function triadShapes(kind,set,rootPc=key){
  const out=[];
  for(const v of allTriadVoicings(rootPc,kind,set)){
    if(out.some(o=>o.inv===v.inv))continue;
    out.push(v);
    if(out.length===3)break;}
  return out.sort((a,b)=>a.inv-b.inv);
}
const INVERSION=["Root position","1st inversion","2nd inversion"];
function renderTriads(){
  const kind=triadKindById(triadKind),set=triadSetById(triadSet),root=NOTES[key];
  document.querySelectorAll("#triadkinds button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.tk===triadKind));
  document.querySelectorAll("#triadsets button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.ts===triadSet));
  const spelled=kind.iv.map((iv,i)=>`${kind.degs[i]} <b>${NOTES[(key+iv)%12]}</b>`).join(" · ");
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
      const d=(noteAt(n.s,n.f)-key+12)%12,i=kind.iv.indexOf(d);
      return {...n,kind:d===0?"root":"tone",ord:labelMode==="none"?"":labelMode==="interval"?kind.degs[i]:NOTES[noteAt(n.s,n.f)]};});
    const bass=notes[notes.length-1],lo=Math.min(...sh.notes.map(n=>n.f)),hi=Math.max(...sh.notes.map(n=>n.f));
    return `<div class="card"><h2>${INVERSION[sh.inv]}<em>fret ${lo}${hi>lo?"–"+hi:""}</em></h2>
      ${fretboard(notes,{plain:true,w:46})}
      <p class="tip" style="margin-top:12px"><b>Fingering</b>:</p>
      ${fingerBoard(sh.notes,{w:46})}
      ${fingerTable(sh.notes)}
      <p class="tip">${fingerHint(sh.notes)}</p>
      <p class="tip"><b>${kind.degs[sh.inv]} on the bottom</b> (${NOTES[noteAt(bass.s,bass.f)]} on the ${SL[bass.s]} string).
        Reading up: ${notes.map(n=>NOTES[noteAt(n.s,n.f)]).reverse().join(" – ")}.</p>
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
let invSet="123", invProg="145";
const progById=id=>PROGRESSIONS.find(p=>p.id===id)||PROGRESSIONS[0];

// C, C/E, C/G — the slash name says which note is in the bass, which is exactly what
// an inversion is. Naming them this way is how they appear on real chord charts.
function chordLabel(rootPc,kind,inv){
  const name=NOTES[rootPc]+kind.sym;
  if(inv===0)return name;
  return `${name}/${NOTES[(rootPc+kind.iv[inv])%12]}`;
}
// Walk a progression, each chord taking the voicing whose hand position is nearest
// to the chord before it. Root position everywhere is the same walk with the choice
// removed.
function voiceLead(prog,set,rootOnly){
  const out=[];let prev=null;
  for(const [deg,kindId] of prog.steps){
    const kind=triadKindById(kindId),rootPc=(key+deg)%12;
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
let invStep=0, invMoved=false, invRunTimer=null, invRunLeft=0;
function stopInvRun(){if(invRunTimer){clearInterval(invRunTimer);invRunTimer=null;}invRunLeft=0;}
// Three moves on a timer, so the whole cycle can be watched rather than clicked
// through. It is the repetition an instructor gives you without being asked.
function runInvCycle(){
  stopInvRun();
  invStep=0;invMoved=false;invRunLeft=3;renderInversions();
  invRunTimer=setInterval(()=>{
    if(invRunLeft<=0){stopInvRun();renderInversions();return;}
    invRunLeft--;invStep=(invStep+1)%3;invMoved=true;renderInversions();
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
      n.finger===0?"—":n.finger+" "+FINGER[n.finger]}${n.barre?" (barre)":""}</td><td>${NOTES[noteAt(n.s,n.f)]}</td></tr>`).join("")}</table>`;
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
  const names=kind.iv.map(iv=>NOTES[(key+iv)%12]);
  const order=[0,1,2].map(i=>(invStep+i)%3).reverse();   // top of the stack first
  const flier=(invStep+2)%3;                             // whichever note just came up
  const chips=order.map((ci,row)=>{
    const bottom=row===2;
    const anim=!invMoved?"":ci===flier?" fly":" settle";
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
    const here=v.inv===invStep,pc=noteAt(n.s,n.f);
    notes.push({s:n.s,f:n.f,
      kind:here?(pc===key?"root":"tone"):"ghost",
      ord:here?NOTES[pc]:String(v.inv+1)});}));
  return fretboard(notes,{plain:true,w:40,span});
}
function moveCaption(kind){
  const names=kind.iv.map(iv=>NOTES[(key+iv)%12]),flier=(invStep+2)%3;
  if(!invMoved&&invStep===0)
    return `<b>${names[0]}</b> is at the bottom, so this is root position. Press the button and watch what happens to it.`;
  return `<b>${names[flier]}</b> left the bottom and went over the top. Same three notes, nothing added —
    but <b>${names[invStep]}</b> is underneath now, so this is ${["root position","first inversion","second inversion"][invStep]}${
    invStep===0?", back where you started. Three moves and it comes full circle.":"."}`;
}
function rotationStrip(kind){
  const names=kind.iv.map(iv=>NOTES[(key+iv)%12]);
  const cols=[0,1,2].map(inv=>{
    // reading order for a stack is top first; the chord sounds bottom to top
    const order=[0,1,2].map(i=>(inv+i)%3).reverse();
    const chips=order.map((ci,row)=>{
      const bottom=row===order.length-1;
      return `<div class="chip ${CHIP[ci]}${bottom?" moved":""}">${names[ci]}<i>${kind.degs[ci]}${bottom?" · bottom":""}</i></div>`;
    }).join("");
    return `<div><div class="rotname">${["Root position","1st inversion","2nd inversion"][inv]}</div>
      <div class="stack">${chips}</div>
      <div class="rotfoot">${chordLabel(key,kind,inv)}</div></div>`;});
  return `<div class="rot">${cols.join("")}</div>`;
}
function renderInversions(){
  const set=triadSetById(invSet),prog=progById(invProg),kind=triadKindById("maj");
  document.querySelectorAll("#invsets button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.ts===invSet));
  document.querySelectorAll("#invprogs button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.pg===invProg));

  // ---- the move, in letters ----
  const root=NOTES[key],nm=kind.iv.map(iv=>NOTES[(key+iv)%12]);
  const shapeNow=triadShapes(kind,set).find(v=>v.inv===invStep);
  document.getElementById("invdemo").innerHTML=
    `<div class="card wide"><h2>Watch the move<em>${["root position","first inversion","second inversion"][invStep]} · ${chordLabel(key,kind,invStep)}</em></h2>
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
        Step ${invStep+1} of 3 &middot; ${["root position","first inversion","second inversion"][invStep]}
        &middot; lowest note <b>${shapeNow?NOTES[noteAt(shapeNow.notes[2].s,shapeNow.notes[2].f)]:""}</b>
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
  invMoved=false;

  // rebound on every render, because the card they live on is redrawn each time
  document.getElementById("invdo").onclick=()=>{stopInvRun();invStep=(invStep+1)%3;invMoved=true;renderInversions();};
  document.getElementById("invback").onclick=()=>{stopInvRun();invStep=0;invMoved=false;renderInversions();};
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
      <p class="notthis"><b>It is not a different chord.</b> ${chordLabel(key,kind,1)} is still ${root} major.
        Same three notes, same name, same job in the song. If a chart says ${chordLabel(key,kind,1)} and you
        play a plain ${root}, you are not wrong — just less specific.</p>
      <p class="notthis"><b>It is not about the top note.</b> People reach for the highest note because it is
        the loudest. The <b>lowest</b> note names the inversion. ${nm[1]} on the bottom makes it first
        inversion no matter what is on top.</p>
      <p class="notthis"><b>A slash chord is not decoration.</b> ${chordLabel(key,kind,1)} means
        &ldquo;${root} chord, ${nm[1]} in the bass&rdquo;. The letter after the slash is just the bottom note.
        That is the whole notation.</p>
    </div>`;

  // ---- what an inversion is: one chord, three orders ----
  const shapes=triadShapes(kind,set);
  document.getElementById("invwhat").innerHTML=shapes.map(sh=>{
    const notes=sh.notes.map(n=>{
      const d=(noteAt(n.s,n.f)-key+12)%12,i=kind.iv.indexOf(d);
      return {...n,kind:d===0?"root":"tone",ord:labelMode==="interval"?kind.degs[i]:NOTES[noteAt(n.s,n.f)]};});
    const stack=sh.notes.slice().reverse().map(n=>NOTES[noteAt(n.s,n.f)]);
    const degs=sh.notes.slice().reverse().map(n=>kind.degs[kind.iv.indexOf((noteAt(n.s,n.f)-key+12)%12)]);
    return `<div class="card"><h2>${INVERSION[sh.inv]}<em>${chordLabel(key,kind,sh.inv)}</em></h2>
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
        :"Written "+chordLabel(key,kind,sh.inv)+" — the letter after the slash is the note in the bass. That is all a slash chord is."}</p>
    </div>`;}).join("");

  // ---- the same chord, all the way up the neck ----
  const all=allTriadVoicings(key,kind,set);
  const upNeck=new Map();
  all.forEach(v=>v.notes.forEach(n=>upNeck.set(n.s+":"+n.f,
    {s:n.s,f:n.f,kind:noteAt(n.s,n.f)===key?"root":"tone",ord:String(v.inv+1)})));
  document.getElementById("invneck").innerHTML=fretboard([...upNeck.values()],{plain:true,w:38,span:[0,MAXFRET]});
  document.getElementById("invnecklabel").innerHTML=
    `<b>${root} major on ${set.sub}</b>, every position. The numbers are which inversion:
     1 root, 2 first, 3 second. They run 1–2–3–1–2–3 up the neck and then repeat.
     <b>${all.length} playable positions</b>, but only three shapes.`;

  // ---- the smallest useful version: two chords ----
  // A whole progression is too much to hold on a first read. Two chords is the drill
  // that makes the point in ten seconds of playing.
  const four=(key+5)%12,rootC=triadShapes(kind,set,key)[0];
  const farF=triadShapes(kind,set,four).find(v=>v.inv===0);
  const nearF=allTriadVoicings(four,kind,set)
    .reduce((a,b)=>Math.abs(b.centre-rootC.centre)<Math.abs(a.centre-rootC.centre)?b:a);
  const twoSpan=[Math.max(0,Math.min(...[rootC,farF,nearF].flatMap(v=>v.notes.map(n=>n.f)))-1),
                 Math.max(...[rootC,farF,nearF].flatMap(v=>v.notes.map(n=>n.f)))+1];
  const one=(v,label,note)=>`<div class="card"><h2>${label}<em>${chordLabel(v===rootC?key:four,kind,v.inv)}</em></h2>
    ${fretboard(v.notes.map(n=>({...n,kind:noteAt(n.s,n.f)===(v===rootC?key:four)?"root":"tone",
      ord:NOTES[noteAt(n.s,n.f)]})),{plain:true,w:44,span:twoSpan})}
    <p class="tip">${note}</p></div>`;
  document.getElementById("invtwo").innerHTML=
    one(rootC,"1. Start here",`<b>${root}${kind.sym}</b> in root position. Leave your hand exactly where it is.`)
    +one(farF,`2. The obvious ${NOTES[four]}`,
      `<b>${NOTES[four]}${kind.sym}</b> in root position — the shape you already know. Look how far your hand had to go: <b>${Math.abs(farF.centre-rootC.centre).toFixed(1)} frets</b>.`)
    +one(nearF,"3. The near one",
      `The same <b>${NOTES[four]}${kind.sym}</b>, ${INVERSION[nearF.inv].toLowerCase()}. <b>${Math.abs(nearF.centre-rootC.centre).toFixed(1)} frets</b> away. Play 1 and 3 back to back: your fingers barely move, and it still sounds like ${NOTES[four]}.`);

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
  renderGuide();newQuiz();newSession();paintTimer();renderLog();
  document.getElementById("ladderbpm").textContent=bpm;
}

// Copyright © 2026 Bruce Hoppe.
// ---------- pentatonic to Phrygian dominant ----------
const PD_OFFSETS=[0,1,4,5,7,8,10], PD_DEGREES=["1","♭2","3","4","5","♭6","♭7"];
// Spell by letter and scale degree, so A's flat second is B-flat, not A-sharp.
function pdName(offset,degree){
  const letters="CDEFGAB",natural=[0,2,4,5,7,9,11];
  const idx=(letters.indexOf(NOTES[key][0])+degree-1)%7;
  let delta=((key+offset-natural[idx])%12+12)%12;
  if(delta>6)delta-=12;
  return letters[idx]+(delta>0?"♯".repeat(delta):"♭".repeat(-delta));
}
function pdBox(b){
  const span=boxSpan(b),lo=Math.max(0,span.lo),hi=Math.min(MAXFRET,span.hi+1),notes=[];
  for(let st=0;st<6;st++)for(let f=lo;f<=hi;f++){
    const d=(noteAt(st,f)-key+12)%12,i=PD_OFFSETS.indexOf(d);
    if(i<0)continue;
    notes.push({s:st,f,kind:d===0?"root":[1,4,8].includes(d)?"pivot":"tone",
      ord:labelMode==="none"?"":labelMode==="interval"?PD_DEGREES[i]:pdName(d,i+1)});
  }
  return {lo,hi,notes};
}
function renderHijaz(){
  const n=(d,degree)=>pdName(d,degree),root=n(0,1),minorThird=n(3,3),third=n(4,3),flatTwo=n(1,2),flatSix=n(8,6);
  const scale=PD_OFFSETS.map((d,i)=>`${PD_DEGREES[i]} <b>${n(d,i+1)}</b>`).join(" · ");
  document.getElementById("hijazexample").onclick=()=>{stopDrone();key=4;reg=0;render();};
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
let openTuning="open-d";
function renderOpen(){
  const t=OPEN_TUNINGS.find(x=>x.id===openTuning)||OPEN_TUNINGS[0];
  const pick=document.getElementById("opentuningpick");
  pick.innerHTML='<span class="lbl">Tuning</span>';
  OPEN_TUNINGS.forEach(x=>mk(pick,{t:x.id},x.name,()=>{openTuning=x.id;renderOpen();}));
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

  ["trainer", "12-bar trainer",   renderTrainer,    {band:"Practice",tools:"keys"}],
  ["theory",  "Practice theory",  renderTheory,     {band:"Practice"}],
  // The find-the-note board is deliberately blank — naming the dots would give the
  // answer away — so Dots is the one control Practice ignores.
  ["practice","Practice",         renderPractice,   {band:"Practice",tools:"keys regs"}],
];
const viewCfg=v=>(VIEWS.find(([id])=>id===v)||[])[3]||{};

// The toolbar rows that only some views answer to. A control that does nothing
// where you are standing is worse than no control at all — it invites you to change
// a setting, watch nothing happen, and conclude the app is broken. So each row is
// greyed and disabled where the current view ignores it, rather than removed: the
// bar keeps its shape, and the greying itself teaches which view uses what.
const TOOLROWS=["keys","labels","chords","regs","extras"];
function applyTools(){
  const live=new Set((viewCfg(view).tools||"").split(" ").filter(Boolean));
  TOOLROWS.forEach(id=>{
    const row=document.getElementById(id),on=live.has(id);
    row.classList.toggle("off",!on);
    row.setAttribute("aria-disabled",!on);
    row.title=on?"":"This view does not use these";
    document.querySelectorAll("#"+id+" button").forEach(b=>{b.disabled=!on;});});
}

// The key buttons say Am until a view means something else by the same selector.
// Triads, Inversions and Modes all take the key as a bare root — a major triad
// built on A is not A minor, and calling it Am on screen is simply a lie.
function applyKeyNames(){
  const asRoot=viewCfg(view).key==="root";
  document.getElementById("keylbl").textContent=asRoot?"Root":"Key";
  document.querySelectorAll("#keys button").forEach(b=>{
    const n=NOTES[+b.dataset.k];
    b.textContent=asRoot?n:n+"m";
    b.setAttribute("aria-label",asRoot?n:n+" minor");});
}

function render(){
  // Hide everything first, then draw: a view's own renderer may measure or reach
  // into the page, and should not see a half-switched shell.
  VIEWS.forEach(([v])=>document.getElementById("v-"+v).hidden=(v!==view));
  VIEWS.forEach(([v,,draw])=>{if(v===view)draw();});
  document.querySelectorAll("#keys button").forEach(b=>b.setAttribute("aria-pressed",+b.dataset.k===key));
  document.querySelectorAll("#views button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===view));
  document.querySelectorAll("#majorkeys button").forEach(b=>b.setAttribute("aria-pressed",+b.dataset.mk===majorKey));
  document.querySelectorAll("#labels button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.l===labelMode));
  document.querySelectorAll("#chords button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.c===(chord||"off")));
  document.querySelectorAll("#regs button").forEach(b=>{
    const r=+b.dataset.r,i=regInfo(r);
    b.setAttribute("aria-pressed",r===reg);
    b.disabled=false;b.style.opacity=1;
    b.textContent=r===0?`Standard · frets ${i.lo}–${i.hi}`
      :`${REGLBL[r]} · frets ${i.lo}–${i.hi}${i.shifted<5?` (${i.shifted} of 5 move)`:""}`;
    b.title=r===0?"Every box at its home position."
      :`All five boxes, each as ${r<0?"low":"high"} as it goes. ${
        i.shifted===5?"All five move an octave.":`${i.shifted} of the five have room to move; the rest stay at their standard position.`}`;});
  document.querySelectorAll("#extras button").forEach(b=>{
    b.setAttribute("aria-pressed",showB5);
    b.textContent=`♭5 blue note: ${showB5?"on":"off"}`;});
  // Last, because both of these overrule what the loops above just set.
  applyKeyNames();
  applyTools();
}
// host is an id or an element, because the nav builds its rows on the fly.
const mk=(host,data,txt,fn)=>{const b=document.createElement("button");
  Object.entries(data).forEach(([k,v])=>b.dataset[k]=v);b.textContent=txt;b.onclick=fn;
  (typeof host==="string"?document.getElementById(host):host).appendChild(b);};
NOTES.forEach((n,i)=>mk("keys",{k:i},n+"m",()=>{key=i;stopDrone();blueLock=null;
  render()}));
// Twenty-one buttons in one strip is a wall. The same twenty-one under five
// headings is a table of contents, and the headings say what each group is for.
BANDS.forEach(band=>{
  const row=document.createElement("div");
  row.className="row";
  const lbl=document.createElement("span");
  lbl.className="lbl";lbl.textContent=band;
  row.appendChild(lbl);
  document.getElementById("views").appendChild(row);
  VIEWS.filter(([,,,c])=>c.band===band).forEach(([v,label])=>
    mk(row,{v},label,()=>{view=v;render();}));});
[["name","Note names"],["interval","Intervals"],["none","Blank"]]
  .forEach(([l,t])=>mk("labels",{l},t,()=>{labelMode=l;render()}));
[["off","Off"],["i","i"],["iv","iv"],["v","v"]]
  .forEach(([c,t])=>mk("chords",{c},t,()=>{chord=c==="off"?null:c;render()}));
REGS.forEach(([r,t])=>mk("regs",{r},t,()=>{reg=r;blueLock=null;render()}));
mk("extras",{},"♭5 blue note: off",function(){showB5=!showB5;render();});
MAJKEYS.forEach((k,i)=>mk("majorkeys",{mk:i},k.n,()=>{majorKey=i;render();}));
MODES.forEach(m=>mk("modes",{m:m.id},m.name,()=>{modeId=m.id;render();}));
NOTES.forEach((n,pc)=>mk("notepick",{pc},n,()=>{noteHL=noteHL===pc?null:pc;render();}));
SL.forEach((n,st)=>mk("stringpick",{st},n,()=>{noteString=noteString===st?null:st;render();}));
TRIAD_KINDS.forEach(k=>mk("triadkinds",{tk:k.id},k.name,()=>{triadKind=k.id;render();}));
TRIAD_SETS.forEach(t=>mk("triadsets",{ts:t.id},t.name,()=>{triadSet=t.id;render();}));
TRIAD_SETS.forEach(t=>mk("invsets",{ts:t.id},t.name,()=>{invSet=t.id;render();}));
PROGRESSIONS.forEach(p=>mk("invprogs",{pg:p.id},p.name,()=>{invProg=p.id;render();}));
document.getElementById("majormode").onclick=function(){majorDegrees=!majorDegrees;
  this.textContent=majorDegrees?"Scale degrees":"Note names";
  this.setAttribute("aria-pressed",majorDegrees);render();};
document.getElementById("majorarrows").onclick=function(){majorArrows=!majorArrows;
  this.setAttribute("aria-pressed",majorArrows);render();};
// Quitting has to mean the app is gone, not merely quiet. The server stops itself
// the moment /quit is answered, so everything ticking in the page is now driving a
// desk that no longer exists: stop it all, ask the browser to close the tab, and
// when it refuses — a tab the user opened is not one a script is allowed to close —
// replace the desk with a plain notice rather than leave a page that still looks
// live and answers no requests.
function silenceEverything(){
  stopDrone();stopSolo();stopRhythm();stopTrainer();stopTimer();stopInvRun();
  if(clickTimer){clearInterval(clickTimer);clickTimer=null;}
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
// when the page is actually being served by the app, not opened as a local file.
if(typeof location!=="undefined"&&typeof fetch==="function"&&/^https?:$/.test(location.protocol)){
  document.getElementById("approw").hidden=false;
  fetch("/version").then(r=>r.ok?r.text():"").then(v=>{
    if(v){document.getElementById("appver").textContent="version "+v.trim();
      document.getElementById("credver").textContent="Version "+v.trim();}}).catch(()=>{});
  document.getElementById("quitapp").onclick=()=>{
    document.getElementById("quitmsg").textContent="Stopping\u2026";
    document.getElementById("quitapp").disabled=true;
    // Either way the server is on its way down, so the page has to follow: a
    // failed fetch here usually means it shut down before answering.
    fetch("/quit",{method:"POST",headers:{"X-Quit":"1"}}).then(shutDownPage,shutDownPage);};
}
document.getElementById("drone").onclick=e=>toggleDrone(e.currentTarget);
document.getElementById("click").onclick=e=>toggleClick(e.currentTarget);
document.getElementById("bpm").oninput=e=>{bpm=+e.target.value;
  document.getElementById("bpmv").textContent=bpm+" bpm";restartClick();};
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
document.getElementById("toggletrainer").onclick=toggleTrainer;
document.getElementById("resettrainer").onclick=resetTrainer;
document.getElementById("groove").onchange=renderTrainer;
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
loadSolo();
render();
