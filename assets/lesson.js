(() => {
  const LINE_RE = /^((?:\[\d+:\d+(?:\.\d+)?\])+)(.*)$/;
  const TIME_RE = /\[(\d+):(\d+(?:\.\d+)?)\]/g;
  const META_RE = /^\[(al|ar|ti|by):(.+)\]$/i;

  function timeTagsToSeconds(tags) {
    // Use the first tag as start
    const m = /\[(\d+):(\d+(?:\.\d+)?)\]/.exec(tags);
    if (!m) return 0;
    return parseInt(m[1], 10) * 60 + parseFloat(m[2]);
  }

  function hasCJK(s) { return /[\u3400-\u9FFF\uF900-\uFAFF]/.test(s) }

  async function fetchText(url) { const r = await fetch(url); if (!r.ok) throw new Error('Fetch failed ' + url); return await r.text(); }

  async function loadLrc(url) {
    const text = await fetchText(url);
    const rows = text.replace(/\r/g, '').split('\n');
    const meta = { al: '', ar: '', ti: '', by: '' };
    const items = [];
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i].trim(); if (!raw) continue;
      const mm = raw.match(META_RE); if (mm) { meta[mm[1].toLowerCase()] = mm[2].trim(); continue; }
      const m = raw.match(LINE_RE); if (!m) continue;
      const tags = m[1];
      const start = timeTagsToSeconds(tags);
      let body = m[2].trim();
      let en = body, cn = '';
      if (body.includes('|')) { const parts = body.split('|'); en = parts[0].trim(); cn = (parts[1] || '').trim(); }
      else {
        // stacked mode: next line may be CN with same timestamp
        if (i + 1 < rows.length) {
          const m2 = rows[i + 1].trim().match(LINE_RE);
          if (m2 && m2[1] === tags) {
            const text2 = m2[2].trim();
            if (hasCJK(text2)) { cn = text2; i++; }
          }
        }
      }
      items.push({ start, en, cn });
    }
    // compute end time
    for (let i = 0; i < items.length; i++) {
      items[i].end = i + 1 < items.length ? items[i + 1].start : 0;
    }
    return { meta, items };
  }

  function qs(sel) { return document.querySelector(sel); }

  document.addEventListener('DOMContentLoaded', () => {
    // Ensure new lesson loads at top (avoid scroll restoration)
    try { if ('scrollRestoration' in history) { history.scrollRestoration = 'manual'; } } catch (_) { }
    window.scrollTo(0, 0);
    const hash = decodeURIComponent(location.hash.slice(1));
    if (!hash) { location.href = 'book.html'; return; }
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
    const backLink = qs('#backLink');
    const prevLessonLink = qs('#prevLesson');
    const nextLessonLink = qs('#nextLesson');
    // 新加控制音频播放速度
    const speedButton = qs('#speed')
    const rates = [1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 0.75, 1.0];
    const DEFAULT_RATE = 1.0;
    
    let savedRate = parseFloat(localStorage.getItem('audioPlaybackRate'));
    if (isNaN(savedRate) || !rates.includes(savedRate)) {
        savedRate = DEFAULT_RATE;
    }
    let currentRateIndex = rates.indexOf(savedRate);
    if (currentRateIndex === -1) {
        currentRateIndex = rates.indexOf(DEFAULT_RATE);
    }
    audio.playbackRate = savedRate;
    if (speedButton) {
        speedButton.textContent = `${savedRate.toFixed(2)}x`;
    }
    if (speedButton) {
        speedButton.addEventListener('click', () => {
            currentRateIndex = (currentRateIndex + 1) % rates.length;
            const newRate = rates[currentRateIndex];
            audio.playbackRate = newRate; 
        });
    }
    audio.addEventListener('ratechange', () => {
        const actualRate = audio.playbackRate;
        try {
            localStorage.setItem('audioPlaybackRate', actualRate);
        } catch (e) {
            console.error('无法保存实际播放速度到 localStorage:', e);
        }
        if (speedButton) {
            speedButton.textContent = `${actualRate.toFixed(2)}x`;
        }
        const newIndex = rates.indexOf(actualRate);
        if (newIndex !== -1) {
            currentRateIndex = newIndex;
        } else {
            console.warn(`当前速度 ${actualRate.toFixed(2)}x 不在预设列表中，内部索引未更新。`);
        }
    });

    let items = [];
    let idx = -1;
    let segmentEnd = 0; // current sentence end time
    let segmentTimer = 0; // timeout id for auto-advance
    let prevLessonHref = '';
    let nextLessonHref = '';

    audio.src = mp3;
    // Back navigation: prefer history, fallback to index with current book
    if (backLink) {
      const fallback = `index.html#${book}`;
      backLink.setAttribute('href', fallback);
      backLink.addEventListener('click', (e) => {
        e.preventDefault();
        try {
          const ref = document.referrer;
          if (ref && new URL(ref).origin === location.origin) { history.back(); return; }
        } catch (_) { }
        location.href = fallback;
      });
    }

    function render() {
      listEl.innerHTML = items.map((it, i) => `
        <div class="sentence" data-idx="${i}">
          <div class="en">${it.en}</div>
          ${it.cn ? `<div class="cn">${it.cn}</div>` : ''}
        </div>
      `).join('');
    }

    function computeEnd(it) {
      if (!it.end || it.end <= it.start) return 0;
      // ensure a minimal segment duration to avoid too-short loops
      const minDur = 0.6; // seconds
      return Math.max(it.end, it.start + minDur);
    }

    function clearAdvance() { if (segmentTimer) { clearTimeout(segmentTimer); segmentTimer = 0; } }

    function scheduleAdvance() {
      clearAdvance();
      if (segmentEnd && idx >= 0) {
        const ms = Math.max(0, (segmentEnd - audio.currentTime) * 1000);
        segmentTimer = setTimeout(() => {
          if (idx + 1 < items.length) {
            playSegment(idx + 1);
          } else {
            // last sentence of lesson: stop here
            audio.pause();
          }
        }, ms);
      }
    }

    function playSegment(i) {
      if (i < 0 || i >= items.length) return;
      idx = i;
      const it = items[i];
      audio.currentTime = Math.max(0, it.start);
      segmentEnd = computeEnd(it);
      const p = audio.play();
      if (p && p.catch) { p.catch(() => { }); }
      highlight(i);
      scheduleAdvance();
    }

    function highlight(i) {
      const prev = listEl.querySelector('.sentence.active');
      if (prev) prev.classList.remove('active');
      const cur = listEl.querySelector(`.sentence[data-idx="${i}"]`);
      if (cur) { cur.classList.add('active'); cur.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }

    listEl.addEventListener('click', e => {
      const s = e.target.closest('.sentence'); if (!s) return;
      playSegment(parseInt(s.dataset.idx, 10));
    });

    audio.addEventListener('timeupdate', () => {
      const t = audio.currentTime;
      // Only maintain highlight and reschedule if user scrubbed into another sentence
      // Update current index/highlight
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const segEnd = computeEnd(it);
        const within = t >= it.start && (segEnd ? t < segEnd : true);
        if (within) {
          if (idx !== i) { idx = i; segmentEnd = segEnd; highlight(i); scheduleAdvance(); }
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

    // Handle lesson change via hash navigation (prev/next buttons)
    window.addEventListener('hashchange', () => {
      // Scroll to top then reload to re-init content
      window.scrollTo(0, 0);
      location.reload();
    });

    // Resolve neighbors and wire bottom nav
    async function resolveLessonNeighbors() {
      try {
        const num = parseInt(book.replace('NCE', '')) || 1;
        const res = await fetch(prefix + 'static/data.json');
        const data = await res.json();
        const lessons = data[num] || [];
        const i = lessons.findIndex(x => x.filename === base);
        if (i > 0) {
          const prev = lessons[i - 1].filename;
          prevLessonHref = `lesson.html#${book}/${prev}`;
          if (prevLessonLink) { prevLessonLink.href = prevLessonHref; prevLessonLink.style.display = ''; }
        } else {
          if (prevLessonLink) { prevLessonLink.style.display = 'none'; }
        }
        if (i >= 0 && i + 1 < lessons.length) {
          const next = lessons[i + 1].filename;
          nextLessonHref = `lesson.html#${book}/${next}`;
          if (nextLessonLink) { nextLessonLink.href = nextLessonHref; nextLessonLink.style.display = ''; }
        } else {
          if (nextLessonLink) { nextLessonLink.style.display = 'none'; }
        }
      } catch (_) {
        if (prevLessonLink) prevLessonLink.style.display = 'none';
        if (nextLessonLink) nextLessonLink.style.display = 'none';
      }
    }

    NCE_APP.initSegmented(document);

    resolveLessonNeighbors();

    loadLrc(lrc).then(({ meta, items: arr }) => {
      items = arr;
      titleEl.textContent = meta.ti || base;
      subEl.textContent = `${meta.al || book} · ${meta.ar || ''}`.trim();
      render();
      // Autoplay parameter is ignored by default; user taps to play
    }).catch(err => {
      titleEl.textContent = '无法加载课文';
      subEl.textContent = String(err);
    });
  });
})();
