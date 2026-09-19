/* Review-only presentation layer. The shipped application is unchanged. */
(()=>{
  const q=s=>document.querySelector(s);
  const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;};
  const wrap=q('.wrap');
  const notice=el('div','prototype-note');
  notice.append(el('span','','Design study · quieter practice desk'));
  const compare=el('a','','Compare current layout');compare.href='./';compare.target='_blank';notice.append(compare);wrap.before(notice);
  const mast=el('header','masthead'),brand=el('div','brand');brand.append(q('h1'),q('.sub'));mast.append(brand,q('.hero'));wrap.prepend(mast);
  const layout=el('div','desk-layout'),side=el('aside','lesson-index'),main=el('main','lesson-main');
  const browse=el('details','browse');browse.open=true;browse.append(el('summary','','Browse lessons'));
  const nav=q('#views');browse.append(nav);side.append(browse);
  [...nav.children].forEach(row=>{const d=el('details','nav-group');d.append(el('summary','',row.querySelector('.lbl').textContent));row.querySelector('.lbl').remove();d.append(...row.children);row.replaceWith(d);});
  const title=el('h2','lesson-title'),context=el('div','lesson-context');
  const key=el('label','key-select','Key '),select=el('select');select.setAttribute('aria-label','Key');
  NOTES.forEach((n,i)=>{const o=el('option','',n+' minor');o.value=i;select.append(o);});key.append(select);context.append(title,key);main.append(context);
  select.onchange=()=>{q(`#keys button[data-k="${select.value}"]`).click();};
  const bar=q('.bar'),settings=el('details','diagram-settings');settings.append(el('summary','','Diagram settings'));
  ['labels','chords','regs','extras'].forEach(id=>settings.append(q('#'+id)));main.append(settings);
  const legend=q('.legend');main.append(legend);
  [...wrap.querySelectorAll(':scope > section')].forEach(s=>main.append(s));
  const audio=el('div','audio-dock');audio.append(q('#play'));
  const recording=el('details','record-settings');recording.append(el('summary','','Recording & input'));if(q('#recrow'))recording.append(q('#recrow'));audio.append(recording);
  side.append(q('#approw'));bar.remove();q('#keys').hidden=true;
  layout.append(side,main);mast.after(layout);wrap.append(audio,q('.credit'));
  // Keep the essential trainer controls visible; disclose arrangement options.
  const trainerOptions=el('details','trainer-options');
  trainerOptions.append(el('summary','','Band, mix & practice options'));
  q('#mixrow').after(trainerOptions);
  ['bandrow','practicerow','mixrow'].forEach(id=>trainerOptions.append(q('#'+id)));
  const originalRender=render;
  function tidyPath(){
    const path=q('#path');if(!path||path.querySelector('.course-outline'))return;
    const rest=[...path.children].filter(c=>!c.classList.contains('pathnow')&&!c.classList.contains('now'));
    const outline=el('details','course-outline');outline.append(el('summary','','Full learning path & practice advice'));
    const grid=el('div','grid wide');grid.append(...rest);outline.append(grid);path.append(outline);
    const intro=el('details','course-intro');intro.append(el('summary','','How to use this course'));
    [...q('#v-path').children].filter(c=>c.matches('p.tip')).forEach(c=>intro.append(c));
    if(intro.children.length>1)path.after(intro);
  }
  function sync(){
    const cfg=viewCfg(state.view),view=VIEWS.find(v=>v[0]===state.view);title.textContent=view[1]==='Start here'?'Your practice today':view[1];
    key.hidden=!(cfg.tools||'').includes('keys');select.value=state.key;
    [...select.options].forEach((o,i)=>o.textContent=cfg.key==='root'?ROOT_NAMES[i]:NOTES[i]+' minor');
    key.firstChild.textContent=cfg.key==='root'?'Root ':'Key ';
    settings.hidden=!['labels','chords','regs','extras'].some(id=>(cfg.tools||'').split(' ').includes(id));
    legend.hidden=!(cfg.tools||'').includes('labels');
    legend.classList.toggle('has-colour', ['modes','hijaz','blues'].includes(state.view));
    document.querySelectorAll('.nav-group').forEach(d=>{if(d.querySelector(`[data-v="${state.view}"]`))d.open=true;});
    tidyPath();
  }
  render=function(){originalRender();sync();};
  nav.addEventListener('click',e=>{if(e.target.matches('button')){
    nav.querySelectorAll('.nav-group').forEach(d=>d.open=!!d.querySelector(`[data-v="${state.view}"]`));
    if(matchMedia('(max-width: 740px)').matches)browse.open=false;
  }});
  const pathObserver=new MutationObserver(()=>{tidyPath();});pathObserver.observe(q('#path'),{childList:true});
  if(matchMedia('(max-width: 740px)').matches)browse.open=false;
  state.view='boxes';render();
})();
