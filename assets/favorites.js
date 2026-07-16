(() => {
  const {
    escapeHTML, clampRate, normalizeLoop, rateLabel, loopLabel,
    isNoveltyVoiceName, voiceScore, NOVELTY_VOICE_RE, PREFERRED_VOICE_NAMES
  } = NCEUtils;

  const SENTENCE_FAV_KEY = 'nce_sentence_favs_v1';
  const TTS_RATE_KEY = 'nce_tts_rate';
  const TTS_LOOP_KEY = 'nce_tts_loop'; // 'off' | 'one' | 'all'
  const TTS_VOICE_KEY = 'nce_tts_voice';

  function qs(sel) { return document.querySelector(sel); }
  function supportsTTS() {
    return typeof window !== 'undefined'
      && 'speechSynthesis' in window
      && typeof window.SpeechSynthesisUtterance === 'function';
  }

  function loadFavs() {
    try {
      const raw = localStorage.getItem(SENTENCE_FAV_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      return arr.filter(x => x && typeof x.id === 'string' && typeof x.en === 'string');
    } catch (_) { return []; }
  }
  function saveFavs(arr) {
    try { localStorage.setItem(SENTENCE_FAV_KEY, JSON.stringify(arr || [])); } catch (_) {}
  }

  document.addEventListener('DOMContentLoaded', () => {
    const backBtn = qs('#backBtn');
    const favSub = qs('#favSub');
    const listEl = qs('#favSentences');

    const ttsSettingsBtn = qs('#ttsSettingsBtn');
    const ttsPrev = qs('#ttsPrev');
    const ttsPlayPause = qs('#ttsPlayPause');
    const ttsNext = qs('#ttsNext');
    const ttsOverlay = qs('#ttsOverlay');
    const ttsPanel = qs('#ttsPanel');
    const ttsClose = qs('#ttsClose');
    const ttsVoiceSelect = qs('#ttsVoice');
    const ttsLoopSelect = qs('#ttsLoopSelect');
    const ttsRateSelect = qs('#ttsRateSelect');
    const clearListBtn = qs('#clearListBtn');
    const favDataExportBtn = qs('#favDataExportBtn');
    const favDataImportBtn = qs('#favDataImportBtn');
    const favDataImportFile = qs('#favDataImportFile');

    // --------------------------
    // 移动端浏览器：自动隐藏上下栏（非 PWA）
    // --------------------------
    (function initAutoHideBars(){
      try {
        const isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || (window.navigator && window.navigator.standalone === true);
        const isCoarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        if (isStandalone || !isCoarse) return;
        const body = document.body;
        if (!body) return;

        let hidden = false;
        let lastY = window.scrollY || 0;
        let idleTimer = 0;
        const HIDE_CLASS = 'ui-bars-hidden';

        const isPanelOpen = () => {
          const ttsOpen = ttsPanel && !ttsPanel.hasAttribute('hidden');
          return ttsOpen;
        };

        const show = () => {
          if (hidden) { body.classList.remove(HIDE_CLASS); hidden = false; }
          resetIdle();
        };
        const hide = () => {
          if (isPanelOpen()) return;
          const y = window.scrollY || 0;
          if (y < 40) return;
          if (!hidden) { body.classList.add(HIDE_CLASS); hidden = true; }
        };
        const resetIdle = () => {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => hide(), 2200);
        };
        const onScroll = () => {
          const y = window.scrollY || 0;
          const dy = y - lastY;
          if (Math.abs(dy) < 8) { resetIdle(); lastY = y; return; }
          if (dy > 0) hide(); else show();
          lastY = y;
        };

        window.addEventListener('scroll', onScroll, { passive: true });
        ['touchstart','pointerdown'].forEach(t => document.addEventListener(t, show, { passive: true }));
        document.addEventListener('focusin', show, { passive: true });
        resetIdle();
      } catch (_) {}
    })();

    let favs = loadFavs();
    let currentIndex = favs.length ? 0 : -1;

    // TTS state
    const synth = supportsTTS() ? window.speechSynthesis : null;
    const RATE_OPTIONS = [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.25, 1.4, 1.5, 1.75, 2.0];
    let ttsState = 'stopped'; // 'stopped' | 'playing' | 'paused'
    let ttsSeq = 0;
    let ttsVoices = [];
    let ttsVoiceName = '';
    let ttsVoice = null;
    let ttsRate = 1.0;
    let ttsLoop = 'off';

    function showNotification(message) {
      const n = document.createElement('div');
      n.style.cssText = `
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
        background: var(--surface); color: var(--text); border: 1px solid var(--border);
        border-radius: var(--radius); padding: 12px 20px; box-shadow: var(--shadow);
        z-index: 1000; backdrop-filter: saturate(120%) blur(10px); animation: slideDown 0.3s ease-out;
      `;
      n.textContent = message; document.body.appendChild(n);
      setTimeout(()=>{ n.style.animation='slideUp 0.3s ease-out'; setTimeout(()=>{ document.body.removeChild(n); },300); },2000);
    }

    function setPlayIcon(isPlaying) {
      const playIcon = ttsPlayPause?.querySelector('.play-icon');
      const pauseIcon = ttsPlayPause?.querySelector('.pause-icon');
      if (playIcon) playIcon.style.display = isPlaying ? 'none' : '';
      if (pauseIcon) pauseIcon.style.display = isPlaying ? '' : 'none';
      if (ttsPlayPause) ttsPlayPause.setAttribute('aria-label', isPlaying ? '暂停' : '播放');
    }
    function setTtsState(state) {
      ttsState = state;
      setPlayIcon(ttsState === 'playing');
    }

    function pickDefaultVoice(voices, { preferredLangPrefix = 'en' } = {}) {
      if (!voices?.length) return null;
      if (ttsVoiceName) {
        const found = voices.find(v => v && v.name === ttsVoiceName);
        if (found) return found;
      }
      let best = null;
      let bestScore = -1e9;
      for (const v of voices) {
        const s = voiceScore(v, { preferredLangPrefix });
        if (s > bestScore) { bestScore = s; best = v; }
      }
      return best || voices[0] || null;
    }

    function refreshVoiceSelect() {
      if (!ttsVoiceSelect) return;
      if (!supportsTTS()) {
        ttsVoiceSelect.innerHTML = `<option value="">当前浏览器不支持朗读</option>`;
        ttsVoiceSelect.disabled = true;
        return;
      }
      ttsVoices = synth.getVoices() || [];
      if (!ttsVoices.length) {
        ttsVoiceSelect.innerHTML = `<option value="">正在加载音色…</option>`;
        ttsVoiceSelect.disabled = true;
        return;
      }
      ttsVoiceSelect.disabled = false;

      // 如果之前保存的是“搞怪音色”，自动回退为推荐音色
      if (ttsVoiceName && isNoveltyVoiceName(ttsVoiceName)) {
        ttsVoiceName = '';
        try { localStorage.removeItem(TTS_VOICE_KEY); } catch (_) {}
      }

      const preferredLangPrefix = 'en';
      const sorted = ttsVoices.slice().sort((a, b) => {
        const sa = voiceScore(a, { preferredLangPrefix });
        const sb = voiceScore(b, { preferredLangPrefix });
        if (sb !== sa) return sb - sa;
        return String(a?.name || '').localeCompare(String(b?.name || ''));
      });

      const selected = pickDefaultVoice(sorted, { preferredLangPrefix });
      if (selected) {
        ttsVoice = selected;
        // 默认音色不自动写入 localStorage，避免在不同设备上“锁定”怪异默认值
        if (!ttsVoiceName) ttsVoiceName = selected.name;
      }

      ttsVoiceSelect.innerHTML = sorted.map(v => {
        const name = escapeHTML(v.name || '');
        const lang = escapeHTML(v.lang || '');
        return `<option value="${name}">${name}${lang ? ` (${lang})` : ''}</option>`;
      }).join('');
      if (ttsVoiceName) ttsVoiceSelect.value = ttsVoiceName;
      if (!ttsVoiceSelect.value && sorted[0]) {
        ttsVoiceName = sorted[0].name;
        ttsVoiceSelect.value = ttsVoiceName;
        ttsVoice = sorted[0];
      } else {
        ttsVoice = sorted.find(v => v.name === ttsVoiceSelect.value) || ttsVoice;
      }
    }

    function stopTts() {
      if (!synth) return;
      ttsSeq++;
      try { synth.cancel(); } catch (_) {}
      setTtsState('stopped');
    }

    function speakIndex(i, { scroll = true } = {}) {
      if (!supportsTTS()) { showNotification('当前浏览器不支持语音朗读'); return; }
      if (!favs.length) return;
      const next = Math.max(0, Math.min(favs.length - 1, i | 0));
      setCurrent(next, { scroll });
      const it = favs[next];
      const text = String((it?.en || it?.cn || '')).trim();
      if (!text) { showNotification('当前句子为空'); return; }

      ttsSeq++;
      const seq = ttsSeq;
      try { synth.cancel(); } catch (_) {}
      setTtsState('playing');

      const u = new SpeechSynthesisUtterance(text);
      u.rate = ttsRate;
      if (ttsVoice) u.voice = ttsVoice;
      u.onend = () => {
        if (seq !== ttsSeq) return;
        if (ttsLoop === 'one') { speakIndex(next, { scroll }); return; }
        if (ttsLoop === 'all') {
          if (favs.length <= 0) { setTtsState('stopped'); return; }
          const isLast = next >= favs.length - 1;
          speakIndex(isLast ? 0 : (next + 1), { scroll });
          return;
        }
        setTtsState('stopped'); // 循环：关 → 只读当前一句
      };
      u.onerror = () => { if (seq === ttsSeq) setTtsState('stopped'); };

      // iOS/Safari 上 cancel 后立即 speak 偶发失效，延迟一帧更稳
      setTimeout(() => {
        if (seq !== ttsSeq) return;
        try { synth.speak(u); } catch (_) { if (seq === ttsSeq) setTtsState('stopped'); }
      }, 0);
    }

    function setSubtitle() {
      favSub.textContent = favs.length ? `共收藏 ${favs.length} 句` : '';
    }

    function updateTtsPos() {
      const ttsPos = qs('#ttsPos');
      if (!ttsPos) return;
      const pos = (currentIndex >= 0 && currentIndex < favs.length) ? `${currentIndex + 1}/${favs.length}` : `0/${favs.length || 0}`;
      ttsPos.textContent = pos;
    }

    function renderList() {
      if (!listEl) return;
      if (!favs.length) {
        listEl.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
              </svg>
            </div>
            <h3>还没有收藏句子</h3>
            <p>在学习课文时，点击句子旁的 <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:text-bottom"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg> 即可加入清单。<br>收藏后可在此进行循环播放、复读等强化训练。</p>
            <a href="index.html" class="empty-action-btn">去学习</a>
          </div>
        `;
        return;
      }

      listEl.innerHTML = favs.map((it, i) => {
        const meta = it.title || it.lessonId || '';
        return `
          <div class="sentence fav-item ${i === currentIndex ? 'active' : ''}" data-i="${i}" data-id="${escapeHTML(it.id)}">
            <button class="sentence-fav-btn active" type="button" data-action="remove" data-id="${escapeHTML(it.id)}" aria-label="从清单移除" aria-pressed="true">
              <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path d="M8 12.027 3.297 14.5l.9-5.243L.1 5.997l5.258-.764L8 0l2.642 5.233 5.258.764-4.097 3.26.9 5.243L8 12.027Z"></path>
              </svg>
            </button>
            <div class="en">${escapeHTML(it.en)}</div>
            ${it.cn ? `<div class="cn">${escapeHTML(it.cn)}</div>` : ''}
            <div class="fav-actions" aria-label="操作">
              <button class="sentence-jump-btn" type="button" data-action="jump" data-i="${i}" aria-label="回到原文" title="回到原文">
                <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                  <path d="M11 3h6v6h-2V6.41l-7.29 7.3-1.42-1.42 7.3-7.29H11V3Z" fill="currentColor"></path>
                  <path d="M5 5h4V3H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4h-2v4H5V5Z" fill="currentColor"></path>
                </svg>
                原文
              </button>
            </div>
            ${meta ? `<div class="fav-meta">${escapeHTML(meta)}</div>` : ''}
          </div>
        `;
      }).join('');
    }

    function setCurrent(i, { scroll = true } = {}) {
      if (!favs.length) { currentIndex = -1; updateTtsPos(); return; }
      const next = Math.max(0, Math.min(favs.length - 1, i | 0));
      const changed = next !== currentIndex;
      currentIndex = next;

      if (listEl) {
        if (changed) {
          const prevActive = listEl.querySelector('.fav-item.active');
          if (prevActive) prevActive.classList.remove('active');
        }
        const cur = listEl.querySelector(`.fav-item[data-i="${currentIndex}"]`);
        if (cur) {
          cur.classList.add('active');
          if (scroll) { try { cur.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {} }
        }
      }

      updateTtsPos();
    }

    function removeById(id) {
      if (!id) return;
      const idx = favs.findIndex(x => x && x.id === id);
      if (idx < 0) return;
      favs.splice(idx, 1);
      saveFavs(favs);
      if (ttsState !== 'stopped') stopTts();
      if (!favs.length) currentIndex = -1;
      else if (currentIndex >= favs.length) currentIndex = favs.length - 1;
      setSubtitle();
      renderList();
      updateTtsPos();
    }

    function jumpToSource(i) {
      const it = favs[i];
      if (!it) return;
      const lessonId = it.lessonId || (it.book && it.base ? `${it.book}/${it.base}` : '');
      if (!lessonId) return;

      try {
        const map = JSON.parse(localStorage.getItem('nce_lastpos') || '{}');
        map[lessonId] = {
          t: Math.max(0, Number(it.start) || 0),
          idx: Math.max(0, Number(it.idx) || 0),
          ts: Date.now()
        };
        localStorage.setItem('nce_lastpos', JSON.stringify(map));
        sessionStorage.setItem('nce_resume', lessonId);
        sessionStorage.removeItem('nce_resume_play');
      } catch (_) {}

      location.href = `lesson.html#${lessonId}`;
    }

    function openPanel(overlay, panel) {
      if (!overlay || !panel) return;
      overlay.hidden = false;
      panel.hidden = false;
      requestAnimationFrame(() => {
        overlay.classList.add('show');
        panel.classList.add('show');
      });
    }
    function closePanel(overlay, panel) {
      if (!overlay || !panel) return;
      overlay.classList.remove('show');
      panel.classList.remove('show');
      setTimeout(() => {
        overlay.hidden = true;
        panel.hidden = true;
      }, 220);
    }

    // Init
    try { ttsRate = clampRate(localStorage.getItem(TTS_RATE_KEY)); } catch (_) { ttsRate = 1.0; }
    try { ttsLoop = normalizeLoop(localStorage.getItem(TTS_LOOP_KEY)); } catch (_) { ttsLoop = 'off'; }
    try { ttsVoiceName = String(localStorage.getItem(TTS_VOICE_KEY) || ''); } catch (_) { ttsVoiceName = ''; }
    setPlayIcon(false);
    if (ttsRateSelect) {
      const opts = RATE_OPTIONS.map(r => `<option value="${r}">${rateLabel(r)}</option>`).join('');
      ttsRateSelect.innerHTML = opts;
      const current = String(ttsRate);
      if (Array.from(ttsRateSelect.options).some(o => o.value === current)) {
        ttsRateSelect.value = current;
      } else {
        const extra = document.createElement('option');
        extra.value = current;
        extra.textContent = rateLabel(ttsRate);
        ttsRateSelect.appendChild(extra);
        ttsRateSelect.value = current;
      }
    }
    if (ttsLoopSelect) {
      ttsLoopSelect.value = ttsLoop;
    }

    setSubtitle();
    renderList();
    updateTtsPos();
    if (window.NCE_APP && typeof NCE_APP.initSegmented === 'function') {
      try { NCE_APP.initSegmented(document); } catch (_) {}
    }
    if (supportsTTS()) {
      refreshVoiceSelect();
      try {
        if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', refreshVoiceSelect);
        else synth.onvoiceschanged = refreshVoiceSelect;
      } catch (_) {}
    }

    // Events
    if (backBtn) {
      backBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (history.length > 1) history.back();
        else location.href = backBtn.getAttribute('href') || 'index.html';
      });
    }
    if (clearListBtn) {
      clearListBtn.addEventListener('click', () => {
        if (!favs.length) return;
        const ok = confirm('确定清空清单吗？此操作不可撤销。');
        if (!ok) return;
        favs = [];
        currentIndex = -1;
        saveFavs(favs);
        if (ttsState !== 'stopped') stopTts();
        setSubtitle();
        renderList();
        updateTtsPos();
        closePanel(ttsOverlay, ttsPanel);
      });
    }

    if (ttsSettingsBtn) ttsSettingsBtn.addEventListener('click', () => openPanel(ttsOverlay, ttsPanel));
    if (ttsOverlay) ttsOverlay.addEventListener('click', () => closePanel(ttsOverlay, ttsPanel));
    if (ttsClose) ttsClose.addEventListener('click', () => closePanel(ttsOverlay, ttsPanel));

    // 数据导出 / 导入（复用 assets/storage.js 的共享实现）
    if (window.NCE_STORAGE) {
      NCE_STORAGE.bindDataControls({
        exportBtn: favDataExportBtn,
        importBtn: favDataImportBtn,
        importFile: favDataImportFile,
        notify: showNotification
      });
    }

    document.addEventListener('click', (e) => {
      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        const action = actionBtn.dataset.action;
        if (action === 'remove') {
          e.preventDefault();
          e.stopPropagation();
          removeById(actionBtn.dataset.id);
          return;
        }
        if (action === 'jump') {
          e.preventDefault();
          e.stopPropagation();
          const i = parseInt(actionBtn.dataset.i, 10);
          if (Number.isFinite(i)) jumpToSource(i);
          return;
        }
      }

      const item = e.target.closest('.fav-item');
      if (item && listEl && listEl.contains(item)) {
        const i = parseInt(item.dataset.i, 10);
        if (Number.isFinite(i)) {
          if (supportsTTS()) speakIndex(i, { scroll: true });
          else setCurrent(i, { scroll: false });
        }
      }
    }, { passive: false });

    if (ttsPrev) ttsPrev.addEventListener('click', () => {
      if (!favs.length) return;
      const next = Math.max(0, (currentIndex >= 0 ? currentIndex - 1 : 0));
      if (supportsTTS()) speakIndex(next, { scroll: true });
      else setCurrent(next, { scroll: true });
    });
    if (ttsNext) ttsNext.addEventListener('click', () => {
      if (!favs.length) return;
      const next = Math.min(favs.length - 1, (currentIndex >= 0 ? currentIndex + 1 : 0));
      if (supportsTTS()) speakIndex(next, { scroll: true });
      else setCurrent(next, { scroll: true });
    });
    if (ttsPlayPause) ttsPlayPause.addEventListener('click', () => {
      if (!supportsTTS()) { showNotification('当前浏览器不支持语音朗读'); return; }
      if (!favs.length) return;
      if (ttsState === 'playing') {
        try { synth.pause(); } catch (_) {}
        setTtsState('paused');
        return;
      }
      if (ttsState === 'paused') {
        try { synth.resume(); } catch (_) { speakIndex(currentIndex, { scroll: true }); return; }
        setTtsState('playing');
        return;
      }
      const start = (currentIndex >= 0) ? currentIndex : 0;
      speakIndex(start, { scroll: true });
    });
    if (ttsLoopSelect) ttsLoopSelect.addEventListener('change', () => {
      ttsLoop = normalizeLoop(ttsLoopSelect.value);
      try { localStorage.setItem(TTS_LOOP_KEY, ttsLoop); } catch (_) {}
      showNotification(loopLabel(ttsLoop));
      if (ttsState === 'playing' || ttsState === 'paused') speakIndex(currentIndex, { scroll: true });
    });
    if (ttsRateSelect) ttsRateSelect.addEventListener('change', () => {
      ttsRate = clampRate(ttsRateSelect.value);
      try { localStorage.setItem(TTS_RATE_KEY, String(ttsRate)); } catch (_) {}
      if (ttsState === 'playing' || ttsState === 'paused') speakIndex(currentIndex, { scroll: true });
      showNotification(`倍速：${rateLabel(ttsRate)}`);
    });
    if (ttsVoiceSelect) ttsVoiceSelect.addEventListener('change', () => {
      if (!supportsTTS()) return;
      ttsVoiceName = ttsVoiceSelect.value || '';
      try { localStorage.setItem(TTS_VOICE_KEY, ttsVoiceName); } catch (_) {}
      ttsVoice = (ttsVoices || []).find(v => v && v.name === ttsVoiceName) || null;
      if (ttsState === 'playing' || ttsState === 'paused') speakIndex(currentIndex, { scroll: true });
      showNotification('已切换音色');
    });

    window.addEventListener('pagehide', () => { if (ttsState !== 'stopped') stopTts(); });
  });
})();
