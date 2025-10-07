(() => {
  const LINE_RE = /^((?:\[\d+:\d+(?:\.\d+)?\])+)(.*)$/;
  const TIME_RE = /\[(\d+):(\d+(?:\.\d+)?)\]/g;
  const META_RE = /^\[(al|ar|ti|by):(.+)\]$/i;

  function timeTagsToSeconds(tags){
    // Use the first tag as start
    const m = /\[(\d+):(\d+(?:\.\d+)?)\]/.exec(tags);
    if(!m) return 0;
    return parseInt(m[1],10)*60 + parseFloat(m[2]);
  }

  function hasCJK(s){return /[\u3400-\u9FFF\uF900-\uFAFF]/.test(s)}

  async function fetchText(url){ const r = await fetch(url); if(!r.ok) throw new Error('Fetch failed '+url); return await r.text(); }

  async function loadLrc(url){
    const text = await fetchText(url);
    const rows = text.replace(/\r/g,'').split('\n');
    const meta = {al:'',ar:'',ti:'',by:''};
    const items = [];
    for(let i=0;i<rows.length;i++){
      const raw = rows[i].trim(); if(!raw) continue;
      const mm = raw.match(META_RE); if(mm){ meta[mm[1].toLowerCase()] = mm[2].trim(); continue; }
      const m = raw.match(LINE_RE); if(!m) continue;
      const tags = m[1];
      const start = timeTagsToSeconds(tags);
      let body = m[2].trim();
      let en = body, cn = '';
      if(body.includes('|')){ const parts = body.split('|'); en = parts[0].trim(); cn = (parts[1]||'').trim(); }
      else {
        // stacked mode: next line may be CN with same timestamp
        if(i+1<rows.length){
          const m2 = rows[i+1].trim().match(LINE_RE);
          if(m2 && m2[1]===tags){
            const text2 = m2[2].trim();
            if(hasCJK(text2)){ cn = text2; i++; }
          }
        }
      }
      items.push({start,en,cn});
    }
    // compute end time
    for(let i=0;i<items.length;i++){
      items[i].end = i+1<items.length ? items[i+1].start : 0;
    }
    return {meta, items};
  }

  function qs(sel){ return document.querySelector(sel); }

  document.addEventListener('DOMContentLoaded',()=>{
    const hash = decodeURIComponent(location.hash.slice(1));
    if(!hash){ location.href = 'book.html'; return; }
    const [book, ...rest] = hash.split('/');
    const base = rest.join('/'); // filename
    const inModern = /\/modern\//.test(location.pathname);
    const prefix = inModern ? '../' : '';
    const mp3 = `${prefix}${book}/${base}.mp3`;
    const lrc = `${prefix}${book}/${base}.lrc`;

    const titleEl = qs('#lessonTitle');
    const subEl = qs('#lessonSub');
    const listEl = qs('#sentences');
    const audio = qs('#player');

    let items = [];
    let idx = -1;
    let segmentEnd = 0; // current sentence end time
    let segmentTimer = 0; // timeout id for auto-advance

    audio.src = mp3;

    function render(){
      listEl.innerHTML = items.map((it, i)=>`
        <div class="sentence" data-idx="${i}">
          <div class="en">${it.en}</div>
          ${it.cn?`<div class="cn">${it.cn}</div>`:''}
        </div>
      `).join('');
    }

    function computeEnd(it){
      if(!it.end || it.end <= it.start) return 0;
      // ensure a minimal segment duration to avoid too-short loops
      const minDur = 0.6; // seconds
      return Math.max(it.end, it.start + minDur);
    }

    function clearAdvance(){ if(segmentTimer){ clearTimeout(segmentTimer); segmentTimer = 0; } }

    function scheduleAdvance(){
      clearAdvance();
      if(segmentEnd && idx>=0){
        const ms = Math.max(0, (segmentEnd - audio.currentTime) * 1000);
        segmentTimer = setTimeout(()=>{
          if(idx+1 < items.length){
            playSegment(idx+1);
          } else {
            audio.pause();
          }
        }, ms);
      }
    }

    function playSegment(i){
      if(i<0 || i>=items.length) return;
      idx = i;
      const it = items[i];
      audio.currentTime = Math.max(0, it.start);
      segmentEnd = computeEnd(it);
      audio.play();
      highlight(i);
      scheduleAdvance();
    }

    function highlight(i){
      const prev = listEl.querySelector('.sentence.active');
      if(prev) prev.classList.remove('active');
      const cur = listEl.querySelector(`.sentence[data-idx="${i}"]`);
      if(cur){ cur.classList.add('active'); cur.scrollIntoView({behavior:'smooth', block:'center'}); }
    }

    listEl.addEventListener('click', e=>{
      const s = e.target.closest('.sentence'); if(!s) return;
      playSegment(parseInt(s.dataset.idx,10));
    });

    audio.addEventListener('timeupdate', ()=>{
      const t = audio.currentTime;
      // Only maintain highlight and reschedule if user scrubbed into another sentence
      // Update current index/highlight
      for(let i=0;i<items.length;i++){
        const it = items[i];
        const segEnd = computeEnd(it);
        const within = t >= it.start && (segEnd ? t < segEnd : true);
        if(within){
          if(idx!==i){ idx=i; segmentEnd = segEnd; highlight(i); scheduleAdvance(); }
          break;
        }
      }
    });

    // User control: when paused, stop auto-advance; when resumed, re-schedule
    audio.addEventListener('pause', () => {
      clearAdvance();
    });
    audio.addEventListener('play', () => {
      scheduleAdvance();
    });

    NCE_APP.initSegmented(document);

    loadLrc(lrc).then(({meta,items:arr})=>{
      items = arr;
      titleEl.textContent = meta.ti || base;
      subEl.textContent = `${meta.al || book} · ${meta.ar||''}`.trim();
      render();
    }).catch(err=>{
      titleEl.textContent = '无法加载课文';
      subEl.textContent = String(err);
    });
  });
})();
