const LICKS = [
  {
    n:"01", tag:"two fingers", title:"The pull-off pair",
    why:"The single most-played move in rock lead guitar. Fret both notes first, pick once, then <em>pull the finger off sideways</em> so it plucks the lower note on the way out.",
    notes:[[2,8,1],[2,5,2],[3,7,3],[3,5,4]],
    tab:["e|-------------|","B|--8p5--------|","G|-------7p5---|","D|-------------|"],
    note:["Slowly","Pull down toward the floor, not straight up. If note two is silent, you lifted instead of plucked."]
  },
  {
    n:"02", tag:"the workhorse", title:"Descending box run",
    why:"Four strings straight down the box. Not flashy, but it's the connective tissue between every other lick — and it teaches your hand where box 1 actually lives.",
    notes:[[1,8,1],[1,5,2],[2,8,3],[2,5,4],[3,7,5],[3,5,6],[4,7,7],[4,5,8]],
    tab:["e|--8--5-------------------|","B|--------8--5-------------|","G|--------------7--5-------|","D|--------------------7--5-|"],
    note:["Fingers","Pinky or ring on the high fret, index on the 5th. Same pair of fingers the whole way down."]
  },
  {
    n:"03", tag:"repeats", title:"The triplet roll",
    why:"Three notes, looped as triplets. Clapton, Page, Slash — everyone runs this when they need to build heat without moving anywhere.",
    notes:[[1,8,1],[1,5,2],[2,5,3]],
    tab:["e|--8p5-----8p5-----8p5-----|","B|-------5-------5-------5--|","G|--------------------------|"],
    note:["Count","Say tri-pl-et out loud as you loop it. The lick only works if the three notes are even."]
  },
  {
    n:"04", tag:"blues flavour", title:"The quarter-bend curl",
    why:"Push the 5th-fret note on the G string just <em>slightly</em> sharp — less than a semitone. This microtonal smear is the entire difference between sounding rock and sounding blues.",
    notes:[[3,5,1,'curl'],[3,7,2],[2,5,3]],
    tab:["e|-------------|","B|---------5---|","G|--5(¼)-7-----|","D|-------------|"],
    note:["Aim","You are not bending to another note. You're bending to the crack between two notes and staying there."]
  },
  {
    n:"05", tag:"bending", title:"Whole-step bend to the root",
    why:"Bend the 8th fret on the B string up a full tone and you land on the root note — the most resolved, satisfying place in the key. Hold it and shake it.",
    notes:[[2,8,1,'bend'],[2,5,2],[3,7,3]],
    tab:["e|----------------|","B|--8(full)--5----|","G|--------------7-|","D|----------------|"],
    note:["Support","Three fingers on the string, thumb over the top of the neck, and rotate from the wrist. Never bend with one finger."]
  },
  {
    n:"06", tag:"two strings", title:"The unison bend",
    why:"Bend the B string up until it matches the open-sounding high E note next to it. Two strings, one pitch, ringing slightly out of tune with each other. Enormous sound for very little work.",
    notes:[[2,8,1,'bend'],[1,5,1]],
    tab:["e|--5-----------|","B|--8(full)-----|","G|--------------|"],
    note:["Tune it","Play the high E note alone first so your ear knows the target. Bend until the beating between the strings stops."]
  },
  {
    n:"07", tag:"rhythm+lead", title:"Chuck Berry double stops",
    why:"Two strings fretted together, rocking between the 5th and 7th fret. This is the bridge between playing chords and playing lead — it does both jobs at once.",
    notes:[[3,5,1],[2,5,1],[3,7,2],[2,7,2]],
    tab:["e|--------------|","B|--5--7--5--7--|","G|--5--7--5--7--|","D|--------------|"],
    note:["One finger","Flatten your index across both strings for the 5th, ring finger flat for the 7th. Barre, don't stack."]
  }
];

const FRET_LO=5, FRET_HI=9, W=480, PAD_L=34, PAD_R=26, PAD_T=16, PAD_B=26;
const ROWS=6, CELL=(W-PAD_L-PAD_R)/(FRET_HI-FRET_LO+1), ROW=26;
const H=PAD_T+PAD_B+ROW*(ROWS-1);
const STR_NAMES=["e","B","G","D","A","E"];

function y(strNum){ return PAD_T+(strNum-1)*ROW; }             // 1 = high e on top
function x(fret){ return PAD_L+(fret-FRET_LO)*CELL+CELL/2; }   // centre of fret cell
function line(f){ return PAD_L+(f-FRET_LO)*CELL; }             // fretwire before fret f

function fretboard(notes){
  let s=`<svg class="fb" viewBox="0 0 ${W} ${H}" role="img" aria-label="fretboard diagram">`;
  // 7th fret inlay
  s+=`<circle cx="${x(7)}" cy="${PAD_T+ROW*2.5}" r="9" fill="#F5C518" opacity=".5"/>`;
  // fretwires
  for(let f=FRET_LO;f<=FRET_HI+1;f++){
    s+=`<line x1="${line(f)}" y1="${y(1)}" x2="${line(f)}" y2="${y(6)}" stroke="#1F1C18" stroke-width="${f===FRET_LO?4:1.5}" opacity="${f===FRET_LO?1:.45}"/>`;
  }
  // strings
  for(let i=1;i<=6;i++){
    s+=`<line x1="${PAD_L}" y1="${y(i)}" x2="${line(FRET_HI+1)}" y2="${y(i)}" stroke="#1F1C18" stroke-width="${0.9+i*0.28}" opacity=".7"/>`;
    s+=`<text x="${PAD_L-12}" y="${y(i)+4}" font-family="Space Mono, monospace" font-size="11" fill="#1F1C18" opacity=".6" text-anchor="middle">${STR_NAMES[i-1]}</text>`;
  }
  // fret numbers
  for(let f=FRET_LO;f<=FRET_HI;f++){
    s+=`<text x="${x(f)}" y="${H-8}" font-family="Space Mono, monospace" font-size="11" fill="#0F6FB8" text-anchor="middle">${f}</text>`;
  }
  // dots — blue misregistered plate underneath, pink plate on top
  notes.forEach(([str,fret,order,mod])=>{
    const cx=x(fret), cy=y(str);
    s+=`<circle cx="${cx+2.5}" cy="${cy+2.5}" r="11" fill="#0F6FB8" opacity=".85" style="mix-blend-mode:multiply"/>`;
    s+=`<circle cx="${cx}" cy="${cy}" r="11" fill="#FF4FA3" style="mix-blend-mode:multiply"/>`;
    s+=`<text x="${cx}" y="${cy+4.5}" font-family="Space Mono, monospace" font-weight="700" font-size="12" fill="#E9E5DA" text-anchor="middle">${order}</text>`;
    if(mod==='bend'){
      s+=`<path d="M ${cx+13} ${cy} q 14 0 14 -13" stroke="#1F1C18" stroke-width="2" fill="none"/>`;
      s+=`<path d="M ${cx+23} ${cy-11} l 4 -6 l 4 6 z" fill="#1F1C18"/>`;
      s+=`<text x="${cx+41} " y="${cy-12}" font-family="Space Mono, monospace" font-size="10" fill="#1F1C18">full</text>`;
    }
    if(mod==='curl'){
      s+=`<path d="M ${cx+13} ${cy} q 10 0 10 -8" stroke="#1F1C18" stroke-width="2" fill="none"/>`;
      s+=`<text x="${cx+27}" y="${cy-5}" font-family="Space Mono, monospace" font-size="11" fill="#1F1C18">¼</text>`;
    }
  });
  return s+`</svg>`;
}

document.getElementById('licks').innerHTML = LICKS.map(l=>`
  <article class="lick">
    <div class="plate"><span>Lick ${l.n}</span><span class="tag">${l.tag}</span></div>
    <h2>${l.title}</h2>
    <p class="why">${l.why}</p>
    ${fretboard(l.notes)}
    <pre class="tab">${l.tab.join("\n")}</pre>
    <p class="note"><b>${l.note[0]}</b><span>${l.note[1]}</span></p>
  </article>`).join('');
function reportHeight(){
  if(parent!==window)parent.postMessage({type:'seven-licks-height',height:document.documentElement.scrollHeight},location.origin);
}
requestAnimationFrame(reportHeight);
window.addEventListener('resize',reportHeight);
