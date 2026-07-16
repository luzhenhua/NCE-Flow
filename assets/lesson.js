/**
 * EchoFlow · lesson.js · iOS-Optimized Edition
 */

(() => {
  // --------------------------
  // 工具 & 解析
  // --------------------------
  const {
    timeTagsToSeconds, hasCJK, KEY_DISPLAY_NAMES, getKeyDisplayName,
    findConflict, normalizeShadowRepeat, normalizeAutoStopCount,
    shouldSkipLine, findFirstContentIndex, formatTime,
    countWords, clamp, seekLooksOk
  } = NCEUtils;

  const LINE_RE = /^((?:\[\d+:\d+(?:\.\d+)?\])+)(.*)$/;
  const TIME_RE = /\[(\d+):(\d+(?:\.\d+)?)\]/g;
  const META_RE = /^\[(al|ar|ti|by):(.+)\]$/i;


  async function fetchText(url) { const r = await fetch(url); if (!r.ok) throw new Error('Fetch failed ' + url); return await r.text(); }

  // 解析 LRC 文本（数据来源无关）。返回 { meta, items }。
  function parseLrcText(text) {
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
      else if (i + 1 < rows.length) {
        const m2 = rows[i + 1].trim().match(LINE_RE);
        if (m2 && m2[1] === tags) {
          const text2 = m2[2].trim();
          if (hasCJK(text2)) { cn = text2; i++; }
        }
      }
      items.push({ start, en, cn });
    }
    for (let i = 0; i < items.length; i++) items[i].end = i + 1 < items.length ? items[i + 1].start : 0;
    return { meta, items };
  }

  // 从 IndexedDB（用户导入的资源）取 lrc 文本并解析。
  async function loadLrcFromStore(book, filename) {
    const store = window.NCE_RESOURCES;
    if (!store) throw new Error('资源存储未就绪');
    const rec = await store.getLesson(book, filename);
    if (!rec || !rec.lrcText) throw new Error('NO_LRC');
    return parseLrcText(rec.lrcText);
  }

  function qs(sel) { return document.querySelector(sel); }
  function once(target, type, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
      let to = 0;
      const on = (e) => { cleanup(); resolve(e); };
      const cleanup = () => { target.removeEventListener(type, on); if (to) clearTimeout(to); };
      target.addEventListener(type, on, { once: true });
      if (timeoutMs > 0) to = setTimeout(() => { cleanup(); reject(new Error(type + ' timeout')); }, timeoutMs);
    });
  }
  const raf = (cb) => requestAnimationFrame(cb);
  const raf2 = (cb) => requestAnimationFrame(() => requestAnimationFrame(cb));

  // iOS / iPadOS / 触屏 Mac Safari
  const ua = navigator.userAgent || '';
  const isIOSLike = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document);

  // --------------------------
  // 自定义快捷键系统
  // --------------------------
  const SHORTCUTS_KEY = 'nce_shortcuts';

  // 默认快捷键配置
  const DEFAULT_SHORTCUTS = {
    playPause: { key: ' ', label: '播放 / 暂停', group: '播放控制' },
    replay: { key: 'r', label: '重播当前句', group: '播放控制' },
    nextSentence: { key: 'ArrowRight', label: '下一句', group: '句子导航' },
    prevSentence: { key: 'ArrowLeft', label: '上一句', group: '句子导航' },
    volumeUp: { key: 'ArrowUp', label: '增加音量', group: '音量控制' },
    volumeDown: { key: 'ArrowDown', label: '减少音量', group: '音量控制' },
    toggleReveal: { key: 'v', label: '显示/隐藏当前句', group: '听读模式' },
  };


  // 加载用户自定义快捷键
  function loadCustomShortcuts() {
    try {
      const saved = localStorage.getItem(SHORTCUTS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // 合并到默认配置
        const result = JSON.parse(JSON.stringify(DEFAULT_SHORTCUTS));
        for (const action of Object.keys(result)) {
          if (parsed[action]) {
            result[action].key = parsed[action];
          }
        }
        return result;
      }
    } catch (_) { }
    return JSON.parse(JSON.stringify(DEFAULT_SHORTCUTS));
  }

  // 保存自定义快捷键
  function saveCustomShortcuts(shortcuts) {
    try {
      const toSave = {};
      for (const action of Object.keys(shortcuts)) {
        // 只保存与默认不同的键位
        if (shortcuts[action].key !== DEFAULT_SHORTCUTS[action].key) {
          toSave[action] = shortcuts[action].key;
        }
      }
      if (Object.keys(toSave).length > 0) {
        localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(toSave));
      } else {
        localStorage.removeItem(SHORTCUTS_KEY);
      }
    } catch (_) { }
  }

  // 重置快捷键为默认
  function resetShortcuts() {
    try {
      localStorage.removeItem(SHORTCUTS_KEY);
    } catch (_) { }
    return JSON.parse(JSON.stringify(DEFAULT_SHORTCUTS));
  }

  // 当前快捷键配置
  let currentShortcuts = loadCustomShortcuts();



  // --------------------------
  // 主流程
  // --------------------------
  document.addEventListener('DOMContentLoaded', () => {
    try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (_) { }
    window.scrollTo(0, 0);

    let hash = decodeURIComponent(location.hash.slice(1));
    if (!hash) { location.href = 'book.html'; return; }

    // 支持 hash 中的 query 参数 (e.g., #NCE1/1?line=10)
    let queryParams = {};
    if (hash.includes('?')) {
      const parts = hash.split('?');
      hash = parts[0]; // 重置 hash 为纯路径
      const search = parts[1];
      if (search) {
        search.split('&').forEach(pair => {
          const [k, v] = pair.split('=');
          if (k) queryParams[decodeURIComponent(k)] = decodeURIComponent(v || '');
        });
      }
    }

    const [book, ...rest] = hash.split('/');
    const base = rest.join('/');
    const inModern = /\/modern\//.test(location.pathname);
    const prefix = inModern ? '../' : '';
    // 音频与 lrc 不再来自服务器路径，改为从用户导入的 IndexedDB 资源读取（见 loadLrcFromStore / getAudioBlobUrl）。

    const titleEl = qs('#lessonTitle');
    const subEl = qs('#lessonSub');
    const listEl = qs('#sentences');
    const audio = qs('#player');
    const backLink = qs('#backLink');
    const settingsBtn = qs('#settingsBtn');
    const settingsOverlay = qs('#settingsOverlay');
    const settingsPanel = qs('#settingsPanel');
    const settingsClose = qs('#settingsClose');
    const settingsDone = qs('#settingsDone');
    const autoStopOverlay = qs('#autoStopOverlay');
    const autoStopPanel = qs('#autoStopPanel');
    const autoStopClose = qs('#autoStopClose');
    const autoStopCancel = qs('#autoStopCancel');
    const autoStopSave = qs('#autoStopSave');
    const autoStopOn = qs('#autoStopOn');
    const autoStopOff = qs('#autoStopOff');
    const autoStopCountInput = qs('#autoStopCount');
    const prevLessonLink = qs('#prevLesson');
    const nextLessonLink = qs('#nextLesson');
    const speedButton = qs('#speed');
    const backToTopBtn = qs('#backToTop');
    const dataExportBtn = qs('#dataExportBtn');
    const dataImportBtn = qs('#dataImportBtn');
    const dataImportFile = qs('#dataImportFile');

    // --------------------------
    // 移动端浏览器：自动隐藏上下栏（非 PWA）
    // --------------------------
    (function initAutoHideBars() {
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

        const show = () => {
          if (hidden) { body.classList.remove(HIDE_CLASS); hidden = false; }
          resetIdle();
        };
        const hide = () => {
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
        ['touchstart', 'pointerdown'].forEach(t => document.addEventListener(t, show, { passive: true }));
        document.addEventListener('focusin', show, { passive: true });
        resetIdle();
      } catch (_) { }
    })();

    // 本地存储键
    const RECENT_KEY = 'nce_recents';
    const LASTPOS_KEY = 'nce_lastpos';
    const SENTENCE_FAV_KEY = 'nce_sentence_favs_v1';
    const MODE_KEY = 'readMode';
    const FOLLOW_KEY = 'autoFollow';
    const AFTER_PLAY_KEY = 'afterPlay';
    const REVEALED_SENTENCES_KEY = 'nce_revealed_sentences';
    const SKIP_INTRO_KEY = 'skipIntro';
    const SHADOW_REPEAT_KEY = 'shadowRepeatCount';
    const SHADOW_GAP_KEY = 'shadowGapMode';
    const AUTO_STOP_ENABLED_KEY = 'autoStopEnabled';
    const AUTO_STOP_COUNT_KEY = 'autoStopCount';
    const AUTO_NEXT_PLAYED_KEY = 'nce_auto_next_played_lessons';

    function loadSentenceFavs() {
      try {
        const raw = localStorage.getItem(SENTENCE_FAV_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(arr)) return [];
        return arr.filter(x => x && typeof x.id === 'string' && typeof x.en === 'string');
      } catch (_) { return []; }
    }
    function saveSentenceFavs(arr) {
      try { localStorage.setItem(SENTENCE_FAV_KEY, JSON.stringify(arr || [])); } catch (_) { }
    }
    function sentenceFavId(i) { return `${book}/${base}::${i}`; }

    // 状态
    let items = [];
    let idx = -1;
    let segmentEnd = 0;
    let segmentTimer = 0;
    let segmentRaf = 0;
    let isScheduling = false;
    let scheduleTime = 0;
    let internalPause = false;
    let segmentStartWallclock = 0;
    let prevLessonHref = '';
    let nextLessonHref = '';
    let _lastSavedAt = 0;
    let loopReplayPending = false;  // 标记是否正在等待循环重播
    let playSeq = 0;               // 防止异步 seek 回调串线

    // iOS 特有状态
    let iosUnlocked = false;         // 是否已“解锁音频”
    let iosUnlockPauseTimer = 0;     // 解锁用的延迟 pause（可取消）
    let metadataReady = false;       // 是否已 loadedmetadata
    let _userVolume = Math.max(0, Math.min(1, audio.volume || 1));

    // 音频 seek 兼容：当服务器不支持 Range 时，回退为 Blob URL（可在本地 http.server 正常点读）
    let audioBlobUrl = '';
    let audioBlobPromise = null;
    let usingBlobSrc = false;
    let warnedNoRange = false;

    // 句子清单（收藏）
    let sentenceFavs = loadSentenceFavs();
    let sentenceFavSet = new Set(sentenceFavs.map(x => x.id));

    // 速率
    const MIN_RATE = 0.5;
    const MAX_RATE = 2.5;
    const DEFAULT_RATE = 1.0;
    function parseRateValue(value) {
      if (value === null || value === undefined) return NaN;
      const text = String(value).trim().replace(/，/g, '.').replace(/,/g, '.');
      if (!text) return NaN;
      const n = Number(text);
      return Number.isFinite(n) ? n : NaN;
    }
    function normalizePlaybackRate(value, fallback = DEFAULT_RATE) {
      const parsed = parseRateValue(value);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.round(clamp(parsed, MIN_RATE, MAX_RATE) * 100) / 100;
    }
    function formatRateValue(value) {
      const n = Math.round(Number(value) * 100) / 100;
      if (!Number.isFinite(n)) return DEFAULT_RATE.toFixed(1);
      const oneDecimal = Math.round(n * 10) / 10;
      return Math.abs(n - oneDecimal) < 0.001 ? oneDecimal.toFixed(1) : n.toFixed(2);
    }
    let savedRate = normalizePlaybackRate(localStorage.getItem('audioPlaybackRate'), DEFAULT_RATE);

    // 读取模式/跟随/播完后
    let readMode = localStorage.getItem(MODE_KEY) || 'continuous'; // 'continuous' | 'single' | 'listen' | 'shadow'
    const storedAutoFollow = localStorage.getItem(FOLLOW_KEY);
    let autoFollow = storedAutoFollow === null ? true : storedAutoFollow === 'true'; // 默认开启自动跟随
    let afterPlay = localStorage.getItem(AFTER_PLAY_KEY) || 'none'; // 'none' | 'single' | 'all' | 'next'
    let revealedSentences = new Set(); // 听读模式下已显示的句子索引
    let skipIntro = localStorage.getItem(SKIP_INTRO_KEY) === 'true'; // 是否跳过开头
    let firstContentIndex = 0; // 第一句正文的索引
    let shadowStartIndex = 0; // 跟读模式的正文起点

    const SHADOW_GAP_RATIOS = { short: 0.8, medium: 1.0, long: 1.3 };
    function getAutoNextPlayedLessons() {
      try {
        const raw = sessionStorage.getItem(AUTO_NEXT_PLAYED_KEY);
        const n = parseInt(raw, 10);
        return Number.isFinite(n) && n >= 0 ? n : 0;
      } catch (_) { return 0; }
    }
    function setAutoNextPlayedLessons(n) {
      try { sessionStorage.setItem(AUTO_NEXT_PLAYED_KEY, String(Math.max(0, n | 0))); } catch (_) { }
    }
    function resetAutoNextPlayedLessons() {
      try { sessionStorage.removeItem(AUTO_NEXT_PLAYED_KEY); } catch (_) { }
    }
    let shadowRepeatTotal = normalizeShadowRepeat(localStorage.getItem(SHADOW_REPEAT_KEY));
    let shadowRepeatRemaining = shadowRepeatTotal;
    let shadowGapMode = localStorage.getItem(SHADOW_GAP_KEY) || 'medium';
    if (!Object.prototype.hasOwnProperty.call(SHADOW_GAP_RATIOS, shadowGapMode)) shadowGapMode = 'medium';
    let shadowGapTimer = 0;
    let shadowAutoPause = false;
    let autoStopEnabled = localStorage.getItem(AUTO_STOP_ENABLED_KEY) === 'true';
    let autoStopCount = normalizeAutoStopCount(localStorage.getItem(AUTO_STOP_COUNT_KEY));
    let autoStopDraftEnabled = autoStopEnabled;
    let autoStopDraftCount = autoStopCount;

    function loadAutoStopSettings() {
      autoStopEnabled = localStorage.getItem(AUTO_STOP_ENABLED_KEY) === 'true';
      autoStopCount = normalizeAutoStopCount(localStorage.getItem(AUTO_STOP_COUNT_KEY));
      autoStopDraftEnabled = autoStopEnabled;
      autoStopDraftCount = autoStopCount;
    }
    function saveAutoStopSettings({ enabled, count }) {
      autoStopEnabled = !!enabled;
      autoStopCount = normalizeAutoStopCount(count);
      autoStopDraftEnabled = autoStopEnabled;
      autoStopDraftCount = autoStopCount;
      try { localStorage.setItem(AUTO_STOP_ENABLED_KEY, autoStopEnabled.toString()); } catch (_) { }
      try { localStorage.setItem(AUTO_STOP_COUNT_KEY, String(autoStopCount)); } catch (_) { }
      resetAutoNextPlayedLessons();
    }

    // 兼容旧版本：从旧的 loopMode 和 autoContinue 迁移
    if (!localStorage.getItem(AFTER_PLAY_KEY)) {
      const oldLoopMode = localStorage.getItem('loopMode');
      const oldAutoContinue = localStorage.getItem('autoContinue');

      if (oldAutoContinue === 'auto') {
        afterPlay = 'next';
      } else if (oldLoopMode === 'single') {
        afterPlay = 'single';
      } else if (oldLoopMode === 'all') {
        afterPlay = 'all';
      } else {
        afterPlay = 'none';
      }

      try { localStorage.setItem(AFTER_PLAY_KEY, afterPlay); } catch (_) { }
    }

    // 自动续集时强制开启自动跟随（避免续播后定位生硬）
    if (afterPlay === 'next' && !autoFollow) {
      autoFollow = true;
      try { localStorage.setItem(FOLLOW_KEY, 'true'); } catch (_) { }
    }

    // --------------------------
    // Back to top button
    // --------------------------
    (function initBackToTop() {
      if (!backToTopBtn) return;

      const update = () => {
        const y = window.scrollY || document.documentElement.scrollTop || 0;
        const threshold = Math.min(320, window.innerHeight * 0.6);
        const show = y > threshold;
        backToTopBtn.classList.toggle('show', show);
        backToTopBtn.setAttribute('aria-hidden', show ? 'false' : 'true');
        backToTopBtn.tabIndex = show ? 0 : -1;
      };

      let ticking = false;
      const onScroll = () => {
        if (ticking) return;
        ticking = true;
        raf(() => { ticking = false; update(); });
      };

      backToTopBtn.addEventListener('click', () => {
        try { window.scrollTo({ top: 0, behavior: 'smooth' }); }
        catch (_) { window.scrollTo(0, 0); }
        // 重置播放位置，使空格键从第一句开始
        idx = -1;
        // 移除所有句子的高亮状态
        listEl.querySelectorAll('.sentence.active').forEach(el => el.classList.remove('active'));
      });

      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll, { passive: true });
      update();
    })();

    // --------------------------
    // iOS 解锁：首次任意交互即解锁
    // --------------------------
    function unlockAudioSync() {
      if (iosUnlocked) return;
      try {
        audio.muted = true;            // 保证解锁过程无声
        const p = audio.play();        // 在同一用户手势栈内发起
        iosUnlocked = true;
        // 立即排队暂停与还原 mute（避免可闻 blip）
        if (iosUnlockPauseTimer) clearTimeout(iosUnlockPauseTimer);
        iosUnlockPauseTimer = setTimeout(() => {
          iosUnlockPauseTimer = 0;
          try { audio.pause(); } catch (_) { }
          audio.muted = false;
        }, 0);
      } catch (_) { iosUnlocked = false; }
    }
    function cancelIOSUnlockPause() {
      if (!iosUnlockPauseTimer) return;
      clearTimeout(iosUnlockPauseTimer);
      iosUnlockPauseTimer = 0;
      try { audio.muted = false; } catch (_) { }
    }
    if (isIOSLike) {
      const evs = ['pointerdown', 'touchstart', 'click'];
      const onceUnlock = (e) => { unlockAudioSync(); evs.forEach(t => document.removeEventListener(t, onceUnlock, true)); };
      evs.forEach(t => document.addEventListener(t, onceUnlock, { capture: true, passive: true, once: true }));
    }

    // 确保 metadata 已就绪（iOS 上 seek 前最好等）
    async function ensureMetadata() {
      if (metadataReady) return;
      try { await once(audio, 'loadedmetadata', 5000); metadataReady = true; }
      catch (_) { /* 忽略，后续 seek 仍会尽力 */ }
    }

    // --------------------------
    // UI 反映/设置
    // --------------------------
    function reflectReadMode() {
      const isContinuous = readMode === 'continuous';
      const isListen = readMode === 'listen';
      const isSingle = readMode === 'single';
      const isShadow = readMode === 'shadow';
      const continuousRadio = document.getElementById('readModeContinuous');
      const singleRadio = document.getElementById('readModeSingle');
      const listenRadio = document.getElementById('readModeListen');
      const shadowRadio = document.getElementById('readModeShadow');
      if (continuousRadio && singleRadio && listenRadio && shadowRadio) {
        continuousRadio.checked = isContinuous;
        singleRadio.checked = isSingle;
        listenRadio.checked = isListen;
        shadowRadio.checked = isShadow;
      }

      // 控制播完后选项的启用/禁用状态
      const afterPlaySingleRadio = document.getElementById('afterPlaySingle');
      const afterPlaySingleLabel = document.querySelector('label[for="afterPlaySingle"]');
      const afterPlayAllRadio = document.getElementById('afterPlayAll');
      const afterPlayAllLabel = document.querySelector('label[for="afterPlayAll"]');
      const afterPlayNextRadio = document.getElementById('afterPlayNext');
      const afterPlayNextLabel = document.querySelector('label[for="afterPlayNext"]');

      if (isContinuous) {
        // 连读模式：禁用"单句循环"（因为连读是自动播放下一句，和单句循环冲突）
        if (afterPlaySingleRadio) afterPlaySingleRadio.disabled = true;
        if (afterPlaySingleLabel) {
          afterPlaySingleLabel.style.opacity = '0.5';
          afterPlaySingleLabel.style.cursor = 'not-allowed';
        }
        // 启用"整篇循环"和"自动下一课"
        if (afterPlayAllRadio) afterPlayAllRadio.disabled = false;
        if (afterPlayAllLabel) {
          afterPlayAllLabel.style.opacity = '';
          afterPlayAllLabel.style.cursor = '';
        }
        if (afterPlayNextRadio) afterPlayNextRadio.disabled = false;
        if (afterPlayNextLabel) {
          afterPlayNextLabel.style.opacity = '';
          afterPlayNextLabel.style.cursor = '';
        }
        // 如果当前是单句循环，自动切换到本课结束
        if (afterPlay === 'single') {
          setAfterPlay('none');
        }
      } else if (isSingle) {
        // 点读模式：启用"单句循环"，禁用"整篇循环"和"自动下一课"
        // （因为点读模式播完就停，不会自动播完整篇）
        if (afterPlaySingleRadio) afterPlaySingleRadio.disabled = false;
        if (afterPlaySingleLabel) {
          afterPlaySingleLabel.style.opacity = '';
          afterPlaySingleLabel.style.cursor = '';
        }
        if (afterPlayAllRadio) afterPlayAllRadio.disabled = true;
        if (afterPlayAllLabel) {
          afterPlayAllLabel.style.opacity = '0.5';
          afterPlayAllLabel.style.cursor = 'not-allowed';
        }
        if (afterPlayNextRadio) afterPlayNextRadio.disabled = true;
        if (afterPlayNextLabel) {
          afterPlayNextLabel.style.opacity = '0.5';
          afterPlayNextLabel.style.cursor = 'not-allowed';
        }
        // 如果当前是整篇循环或自动下一课，自动切换到本课结束
        if (afterPlay === 'all' || afterPlay === 'next') {
          setAfterPlay('none');
        }
      } else if (isListen) {
        // 听读模式：所有"播完后"选项都可用
        // - 单句循环：用于反复听某一句做听力训练
        // - 整篇循环/自动下一课：自动播放模式
        if (afterPlaySingleRadio) afterPlaySingleRadio.disabled = false;
        if (afterPlaySingleLabel) {
          afterPlaySingleLabel.style.opacity = '';
          afterPlaySingleLabel.style.cursor = '';
        }
        if (afterPlayAllRadio) afterPlayAllRadio.disabled = false;
        if (afterPlayAllLabel) {
          afterPlayAllLabel.style.opacity = '';
          afterPlayAllLabel.style.cursor = '';
        }
        if (afterPlayNextRadio) afterPlayNextRadio.disabled = false;
        if (afterPlayNextLabel) {
          afterPlayNextLabel.style.opacity = '';
          afterPlayNextLabel.style.cursor = '';
        }
      } else if (isShadow) {
        // 跟读模式：禁用"单句循环"（跟读已内置循环）
        if (afterPlaySingleRadio) afterPlaySingleRadio.disabled = true;
        if (afterPlaySingleLabel) {
          afterPlaySingleLabel.style.opacity = '0.5';
          afterPlaySingleLabel.style.cursor = 'not-allowed';
        }
        // 启用"整篇循环"和"自动下一课"
        if (afterPlayAllRadio) afterPlayAllRadio.disabled = false;
        if (afterPlayAllLabel) {
          afterPlayAllLabel.style.opacity = '';
          afterPlayAllLabel.style.cursor = '';
        }
        if (afterPlayNextRadio) afterPlayNextRadio.disabled = false;
        if (afterPlayNextLabel) {
          afterPlayNextLabel.style.opacity = '';
          afterPlayNextLabel.style.cursor = '';
        }
        if (afterPlay === 'single') {
          setAfterPlay('none');
        }
      }

      // 更新听读模式的 UI
      updateListenModeUI();

      const shadowSettingsGroup = document.getElementById('shadowSettingsGroup');
      const shadowRepeatInput = document.getElementById('shadowRepeat');
      const shadowEnabled = isShadow;

      if (shadowSettingsGroup) {
        shadowSettingsGroup.style.display = shadowEnabled ? 'flex' : 'none';
        // Remove animation conflict if needed, or simply toggle visibility
      }

      // Update inputs state (though visibility handles most of it)
      const inputs = [
        document.getElementById('shadowRepeat'),
        document.getElementById('shadowGapShort'),
        document.getElementById('shadowGapMedium'),
        document.getElementById('shadowGapLong'),
        document.getElementById('shadowInc'),
        document.getElementById('shadowDec')
      ];
      inputs.forEach(el => {
        if (el) el.disabled = !shadowEnabled;
      });
    }
    function reflectFollowMode() {
      const followOnRadio = document.getElementById('followOn');
      const followOffRadio = document.getElementById('followOff');
      if (followOnRadio && followOffRadio) {
        followOnRadio.checked = autoFollow;
        followOffRadio.checked = !autoFollow;
      }
    }
    function reflectAfterPlay() {
      const afterPlayNoneRadio = document.getElementById('afterPlayNone');
      const afterPlaySingleRadio = document.getElementById('afterPlaySingle');
      const afterPlayAllRadio = document.getElementById('afterPlayAll');
      const afterPlayNextRadio = document.getElementById('afterPlayNext');
      if (afterPlayNoneRadio && afterPlaySingleRadio && afterPlayAllRadio && afterPlayNextRadio) {
        afterPlayNoneRadio.checked = afterPlay === 'none';
        afterPlaySingleRadio.checked = afterPlay === 'single';
        afterPlayAllRadio.checked = afterPlay === 'all';
        afterPlayNextRadio.checked = afterPlay === 'next';
      }
    }
    function reflectAutoStopSettings() {
      if (autoStopOn && autoStopOff) {
        autoStopOn.checked = !!autoStopDraftEnabled;
        autoStopOff.checked = !autoStopDraftEnabled;
      }
      if (autoStopCountInput) {
        autoStopCountInput.value = String(autoStopDraftCount);
        autoStopCountInput.disabled = !autoStopDraftEnabled;
        autoStopCountInput.style.opacity = autoStopDraftEnabled ? '' : '0.6';
      }
    }
    function reflectSkipIntro() {
      const skipIntroOnRadio = document.getElementById('skipIntroOn');
      const skipIntroOffRadio = document.getElementById('skipIntroOff');
      if (skipIntroOnRadio && skipIntroOffRadio) {
        skipIntroOnRadio.checked = skipIntro;
        skipIntroOffRadio.checked = !skipIntro;
      }
    }
    function reflectShadowSettings() {
      const repeatInput = document.getElementById('shadowRepeat');
      const gapShort = document.getElementById('shadowGapShort');
      const gapMedium = document.getElementById('shadowGapMedium');
      const gapLong = document.getElementById('shadowGapLong');
      if (repeatInput) repeatInput.value = String(shadowRepeatTotal);
      if (gapShort) gapShort.checked = shadowGapMode === 'short';
      if (gapMedium) gapMedium.checked = shadowGapMode === 'medium';
      if (gapLong) gapLong.checked = shadowGapMode === 'long';
    }
    reflectReadMode(); reflectFollowMode(); reflectAfterPlay(); reflectSkipIntro();
    reflectShadowSettings();
    reflectAutoStopSettings();

    function setReadMode(mode) {
      if (!['continuous', 'single', 'listen', 'shadow'].includes(mode)) mode = 'continuous';
      readMode = mode;
      try { localStorage.setItem(MODE_KEY, readMode); } catch (_) { }
      reflectReadMode();
      clearShadowGapTimer();
      shadowAutoPause = false;
      if (readMode === 'shadow') shadowRepeatRemaining = shadowRepeatTotal;
      // 模式切换：清调度→按新模式刷新当前段末→重建调度
      clearAdvance(); isScheduling = false; scheduleTime = 0;
      if (idx >= 0 && idx < items.length) segmentEnd = endFor(items[idx]);
      scheduleAdvance();
    }
    function setFollowMode(follow) {
      autoFollow = !!follow;
      try { localStorage.setItem(FOLLOW_KEY, autoFollow.toString()); } catch (_) { }
      reflectFollowMode();
    }
    function setAfterPlay(mode) {
      if (!['none', 'single', 'all', 'next'].includes(mode)) mode = 'none';
      afterPlay = mode;
      try { localStorage.setItem(AFTER_PLAY_KEY, afterPlay); } catch (_) { }
      reflectAfterPlay();
      resetAutoNextPlayedLessons();

      // 自动续集：默认开启自动跟随（用户可再手动关闭，但本次选择会帮你打开）
      if (afterPlay === 'next' && !autoFollow) {
        setFollowMode(true);
      }
    }
    function setSkipIntro(skip) {
      skipIntro = !!skip;
      try { localStorage.setItem(SKIP_INTRO_KEY, skipIntro.toString()); } catch (_) { }
      reflectSkipIntro();
      // 重新计算第一句正文的位置
      if (items && items.length > 0) {
        firstContentIndex = skipIntro ? findFirstContentIndex(items) : 0;
        shadowStartIndex = findFirstContentIndex(items, { skipQuestions: true });
      }
    }
    function setShadowRepeatCount(value) {
      shadowRepeatTotal = normalizeShadowRepeat(value);
      shadowRepeatRemaining = shadowRepeatTotal;
      try { localStorage.setItem(SHADOW_REPEAT_KEY, String(shadowRepeatTotal)); } catch (_) { }
      reflectShadowSettings();
    }
    function setShadowGapMode(mode) {
      if (!Object.prototype.hasOwnProperty.call(SHADOW_GAP_RATIOS, mode)) mode = 'medium';
      shadowGapMode = mode;
      try { localStorage.setItem(SHADOW_GAP_KEY, shadowGapMode); } catch (_) { }
      reflectShadowSettings();
    }
    function updateListenModeUI() {
      const isListenMode = readMode === 'listen';
      const sentences = listEl.querySelectorAll('.sentence');
      sentences.forEach((el, i) => {
        if (isListenMode) {
          el.classList.add('listen-mode');
          if (revealedSentences.has(i)) {
            el.classList.add('revealed');
          } else {
            el.classList.remove('revealed');
          }
        } else {
          el.classList.remove('listen-mode', 'revealed');
        }
      });
    }
    function toggleSentenceReveal(i) {
      if (readMode !== 'listen') return;
      if (revealedSentences.has(i)) {
        revealedSentences.delete(i);
      } else {
        revealedSentences.add(i);
      }
      // 保存到 localStorage（针对当前课程）
      saveRevealedSentences();
      updateListenModeUI();
    }
    function saveRevealedSentences() {
      try {
        const id = lessonId();
        const allRevealed = JSON.parse(localStorage.getItem(REVEALED_SENTENCES_KEY) || '{}');
        allRevealed[id] = Array.from(revealedSentences);
        localStorage.setItem(REVEALED_SENTENCES_KEY, JSON.stringify(allRevealed));
      } catch (_) { }
    }
    function loadRevealedSentences() {
      try {
        const id = lessonId();
        const allRevealed = JSON.parse(localStorage.getItem(REVEALED_SENTENCES_KEY) || '{}');
        const revealed = allRevealed[id] || [];
        revealedSentences = new Set(revealed);
      } catch (_) {
        revealedSentences = new Set();
      }
    }

    // 阅读模式单选按钮事件
    const readModeContinuous = document.getElementById('readModeContinuous');
    const readModeSingle = document.getElementById('readModeSingle');
    const readModeListen = document.getElementById('readModeListen');
    const readModeShadow = document.getElementById('readModeShadow');
    if (readModeContinuous) readModeContinuous.addEventListener('change', () => { if (readModeContinuous.checked) setReadMode('continuous'); });
    if (readModeSingle) readModeSingle.addEventListener('change', () => { if (readModeSingle.checked) setReadMode('single'); });
    if (readModeListen) readModeListen.addEventListener('change', () => { if (readModeListen.checked) setReadMode('listen'); });
    if (readModeShadow) readModeShadow.addEventListener('change', () => { if (readModeShadow.checked) setReadMode('shadow'); });

    // 自动跟随单选按钮事件
    const followOn = document.getElementById('followOn');
    const followOff = document.getElementById('followOff');
    if (followOn) followOn.addEventListener('change', () => { if (followOn.checked) setFollowMode(true); });
    if (followOff) followOff.addEventListener('change', () => { if (followOff.checked) setFollowMode(false); });

    // 播完后单选按钮事件
    const afterPlayNoneRadio = document.getElementById('afterPlayNone');
    const afterPlaySingleRadio = document.getElementById('afterPlaySingle');
    const afterPlayAllRadio = document.getElementById('afterPlayAll');
    const afterPlayNextRadio = document.getElementById('afterPlayNext');

    if (afterPlayNoneRadio) afterPlayNoneRadio.addEventListener('change', () => { if (afterPlayNoneRadio.checked) setAfterPlay('none'); });

    if (afterPlaySingleRadio) {
      afterPlaySingleRadio.addEventListener('change', () => { if (afterPlaySingleRadio.checked) setAfterPlay('single'); });
      // 当禁用时点击，显示提示
      const afterPlaySingleLabel = document.querySelector('label[for="afterPlaySingle"]');
      if (afterPlaySingleLabel) {
        afterPlaySingleLabel.addEventListener('click', (e) => {
          if (afterPlaySingleRadio.disabled) {
            e.preventDefault();
            showNotification('单句循环在连读/跟读模式下不可用');
          }
        });
      }
    }

    if (afterPlayAllRadio) {
      afterPlayAllRadio.addEventListener('change', () => { if (afterPlayAllRadio.checked) setAfterPlay('all'); });
      // 当禁用时点击，显示提示
      const afterPlayAllLabel = document.querySelector('label[for="afterPlayAll"]');
      if (afterPlayAllLabel) {
        afterPlayAllLabel.addEventListener('click', (e) => {
          if (afterPlayAllRadio.disabled) {
            e.preventDefault();
            showNotification('整篇循环在点读模式下不可用');
          }
        });
      }
    }

    if (afterPlayNextRadio) {
      afterPlayNextRadio.addEventListener('change', () => {
        if (afterPlayNextRadio.checked) {
          setAfterPlay('next');
          openAutoStop();
        }
      });
      // 当禁用时点击，显示提示
      const afterPlayNextLabel = document.querySelector('label[for="afterPlayNext"]');
      if (afterPlayNextLabel) {
        afterPlayNextLabel.addEventListener('click', (e) => {
          if (afterPlayNextRadio.disabled) {
            e.preventDefault();
            showNotification('自动下一课在点读模式下不可用');
          }
        });
      }
    }

    // 跟读设置
    const shadowRepeatInput = document.getElementById('shadowRepeat');
    // Stepper buttons for shadow repeat
    const shadowInc = document.getElementById('shadowInc');
    const shadowDec = document.getElementById('shadowDec');
    if (shadowInc) {
      shadowInc.addEventListener('click', () => {
        const current = parseInt(shadowRepeatInput.value) || 2;
        const val = Math.min(9, current + 1);
        shadowRepeatInput.value = val;
        setShadowRepeatCount(val);
      });
    }
    if (shadowDec) {
      shadowDec.addEventListener('click', () => {
        const current = parseInt(shadowRepeatInput.value) || 2;
        const val = Math.max(1, current - 1);
        shadowRepeatInput.value = val;
        setShadowRepeatCount(val);
      });
    }

    // 自动跟随 Checkbox Sync
    const followToggleCheckbox = document.getElementById('followToggleCheckbox');
    if (followToggleCheckbox) {
      followToggleCheckbox.addEventListener('change', () => {
        setFollowMode(followToggleCheckbox.checked);
      });
    }

    // 播完后 Select Logic
    const afterPlaySelect = document.getElementById('afterPlaySelect');
    if (afterPlaySelect) {
      afterPlaySelect.addEventListener('change', () => {
        setAfterPlay(afterPlaySelect.value);
      });

      // Improve interaction: prevent impossible choices
      afterPlaySelect.addEventListener('mousedown', () => {
        const singleOption = afterPlaySelect.querySelector('option[value="single"]');
        const allOption = afterPlaySelect.querySelector('option[value="all"]');

        if (readMode === 'continuous' || readMode === 'shadow') {
          if (singleOption) singleOption.disabled = true;
          if (singleOption && singleOption.selected) afterPlaySelect.value = 'none'; // Fallback
        } else {
          if (singleOption) singleOption.disabled = false;
        }

        if (readMode === 'single') {
          if (allOption) allOption.disabled = true;
        } else {
          if (allOption) allOption.disabled = false;
        }
      });
    }

    // 跳过开头 Checkbox Sync
    const skipIntroCheckbox = document.getElementById('skipIntroCheckbox');
    const skipIntroOn = document.getElementById('skipIntroOn');
    const skipIntroOff = document.getElementById('skipIntroOff');

    if (skipIntroCheckbox) {
      skipIntroCheckbox.addEventListener('change', () => {
        setSkipIntro(skipIntroCheckbox.checked);
        // Sync hidden radios for consistency
        if (skipIntroCheckbox.checked && skipIntroOn) skipIntroOn.checked = true;
        if (!skipIntroCheckbox.checked && skipIntroOff) skipIntroOff.checked = true;
      });
    }
    // Backward compatibility listeners for radios if they still exist or are manipulated by other code
    if (skipIntroOn) skipIntroOn.addEventListener('change', () => { if (skipIntroOn.checked) { setSkipIntro(true); if (skipIntroCheckbox) skipIntroCheckbox.checked = true; } });
    if (skipIntroOff) skipIntroOff.addEventListener('change', () => { if (skipIntroOff.checked) { setSkipIntro(false); if (skipIntroCheckbox) skipIntroCheckbox.checked = false; } });


    // Initialize UI state based on loaded preferences
    // MOVING THIS FUNCTION DOWN HERE TO ENSURE ALL VARIABLES ARE DEFINED
    function reflectModernSettingsUI() {
      if (followToggleCheckbox) followToggleCheckbox.checked = autoFollow;

      if (afterPlaySelect) afterPlaySelect.value = afterPlay;

      if (skipIntroCheckbox) skipIntroCheckbox.checked = skipIntro;

      // Sync radios too if they exist
      const followRadio = document.getElementById(autoFollow ? 'followOn' : 'followOff');
      if (followRadio) followRadio.checked = true;
    }

    // Inject into reflect... functions or call initially
    reflectModernSettingsUI();

    // Override reflectFollowMode to ALSO update checkbox
    const originalReflectFollowMode = typeof reflectFollowMode !== 'undefined' ? reflectFollowMode : () => { };
    reflectFollowMode = function () {
      originalReflectFollowMode(); // Call original updating logic
      if (followToggleCheckbox) followToggleCheckbox.checked = autoFollow;
    };

    // Override reflectAfterPlay to ALSO update select
    const originalReflectAfterPlay = typeof reflectAfterPlay !== 'undefined' ? reflectAfterPlay : () => { };
    reflectAfterPlay = function () {
      originalReflectAfterPlay();
      if (afterPlaySelect) afterPlaySelect.value = afterPlay;
    };


    // --------------------------
    // Auto Stop (Sleep Timer) Sync & Logic
    // --------------------------
    const autoStopToggleSync = document.getElementById('autoStopToggleSync');
    if (autoStopToggleSync) {
      autoStopToggleSync.addEventListener('change', () => {
        // Sync draft state directly if panel is open, or global if not
        autoStopDraftEnabled = autoStopToggleSync.checked;
        // Sync legacy radios
        if (autoStopOn) autoStopOn.checked = autoStopDraftEnabled;
        if (autoStopOff) autoStopOff.checked = !autoStopDraftEnabled;
        reflectAutoStopSettings();
      });
    }

    const autoStopIncSync = document.getElementById('autoStopIncSync');
    const autoStopDecSync = document.getElementById('autoStopDecSync');
    if (autoStopIncSync && autoStopCountInput) {
      autoStopIncSync.addEventListener('click', () => {
        const val = parseInt(autoStopCountInput.value) || 3;
        autoStopDraftCount = Math.min(50, val + 1);
        reflectAutoStopSettings();
      });
    }
    if (autoStopDecSync && autoStopCountInput) {
      autoStopDecSync.addEventListener('click', () => {
        const val = parseInt(autoStopCountInput.value) || 3;
        autoStopDraftCount = Math.max(1, val - 1);
        reflectAutoStopSettings();
      });
    }

    // Override reflectAutoStopSettings
    const originalReflectAutoStop = typeof reflectAutoStopSettings !== 'undefined' ? reflectAutoStopSettings : () => { };
    reflectAutoStopSettings = function () {
      originalReflectAutoStop();
      if (autoStopToggleSync) autoStopToggleSync.checked = !!autoStopDraftEnabled;
      // Also update stepper button states
      if (autoStopIncSync) autoStopIncSync.disabled = !autoStopDraftEnabled;
      if (autoStopDecSync) autoStopDecSync.disabled = !autoStopDraftEnabled;
    };


    // --------------------------
    // 播放速度 (Segmented Control)
    // --------------------------
    const speedSegments = document.querySelectorAll('.speed-segments .seg-btn');
    const speedDisplay = document.getElementById('speedDisplay');
    const speedCustomInput = document.getElementById('speedCustomInput');

    function updateSpeedUI(rate) {
      const normalized = normalizePlaybackRate(rate, DEFAULT_RATE);
      const text = `${formatRateValue(normalized)}x`;
      if (speedDisplay) speedDisplay.textContent = text;
      speedSegments.forEach(btn => {
        const btnRate = parseFloat(btn.dataset.rate);
        if (Math.abs(btnRate - normalized) < 0.001) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
      if (speedCustomInput) speedCustomInput.value = formatRateValue(normalized);
      // Sync legacy button if needed
      if (speedButton) speedButton.textContent = text;
    }

    function applyPlaybackRate(rate) {
      const normalized = normalizePlaybackRate(rate, savedRate);
      if (Math.abs((audio.playbackRate || DEFAULT_RATE) - normalized) < 0.001) {
        updateSpeedUI(normalized);
        return;
      }
      audio.playbackRate = normalized;
    }

    function applyCustomRate({ notifyInvalid = false, notifyClamped = false } = {}) {
      if (!speedCustomInput) return;
      const parsed = parseRateValue(speedCustomInput.value);
      if (!Number.isFinite(parsed)) {
        speedCustomInput.value = formatRateValue(audio.playbackRate || savedRate || DEFAULT_RATE);
        if (notifyInvalid) showNotification(`请输入 ${MIN_RATE.toFixed(1)} 到 ${MAX_RATE.toFixed(1)} 之间的数字`);
        return;
      }
      const normalized = normalizePlaybackRate(parsed, DEFAULT_RATE);
      if (notifyClamped && Math.abs(parsed - normalized) > 0.001) {
        showNotification(`倍速已限制为 ${MIN_RATE.toFixed(1)}x - ${MAX_RATE.toFixed(1)}x`);
      }
      applyPlaybackRate(normalized);
    }

    // Init speed UI
    updateSpeedUI(savedRate);
    audio.playbackRate = savedRate;

    // Listeners for speed segments
    speedSegments.forEach(btn => {
      btn.addEventListener('click', () => {
        applyPlaybackRate(btn.dataset.rate);
      });
    });

    if (speedCustomInput) {
      speedCustomInput.addEventListener('change', () => applyCustomRate({ notifyInvalid: true, notifyClamped: true }));
      speedCustomInput.addEventListener('blur', () => applyCustomRate());
      speedCustomInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        applyCustomRate({ notifyInvalid: true, notifyClamped: true });
        speedCustomInput.blur();
      });
    }

    audio.addEventListener('ratechange', () => {
      const normalized = normalizePlaybackRate(audio.playbackRate, DEFAULT_RATE);
      if (Math.abs(audio.playbackRate - normalized) > 0.001) {
        audio.playbackRate = normalized;
        return;
      }
      savedRate = normalized;
      try { localStorage.setItem('audioPlaybackRate', String(savedRate)); } catch (_) { }
      updateSpeedUI(savedRate);
      scheduleAdvance();
    });

    function pauseForNavigation() {
      try { saveLastPos(); } catch (_) { }
      clearShadowGapTimer();
      shadowAutoPause = false;
      if (!audio.paused) {
        try { internalPause = true; audio.pause(); } catch (_) { }
      }
    }

    // 返回
    if (backLink) {
      const fallback = `index.html#${book}`;
      backLink.setAttribute('href', fallback);
      backLink.addEventListener('click', (e) => {
        e.preventDefault();
        pauseForNavigation();
        location.href = fallback;
      });
    }

    // --------------------------
    // 自定义播放器控制
    // --------------------------
    const playPauseBtn = qs('#playPauseBtn');
    const playIcon = playPauseBtn ? playPauseBtn.querySelector('.play-icon') : null;
    const pauseIcon = playPauseBtn ? playPauseBtn.querySelector('.pause-icon') : null;
    const currentTimeEl = qs('#currentTime');
    const durationEl = qs('#duration');
    const progressBar = qs('#progressBar');
    const progressFilled = qs('#progressFilled');


    // 更新播放/暂停图标
    function updatePlayPauseIcon() {
      if (!playIcon || !pauseIcon) return;
      if (audio.paused) {
        playIcon.style.display = '';
        pauseIcon.style.display = 'none';
      } else {
        playIcon.style.display = 'none';
        pauseIcon.style.display = '';
      }
    }

    // 播放/暂停按钮点击
    if (playPauseBtn) {
      playPauseBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (audio.paused) {
          if (readMode === 'shadow') {
            const tolerance = 0.1;
            if (idx < 0 && items.length > 0) {
              playSegment(shadowStartIndex, { manual: true });
              return;
            }
            if (idx >= 0 && segmentEnd > 0) {
              const currentTime = audio.currentTime;
              if (Math.abs(currentTime - segmentEnd) < tolerance) {
                playSegment(idx, { manual: true });
                return;
              }
            }
            const p = audio.play();
            if (p && p.catch) p.catch(() => { });
            return;
          }
          // 和空格键一样的逻辑：点读模式智能跳转
          if (readMode === 'single' && idx >= 0 && segmentEnd > 0) {
            const currentTime = audio.currentTime;
            const tolerance = 0.1;
            if (Math.abs(currentTime - segmentEnd) < tolerance) {
              const nextIdx = Math.min(idx + 1, items.length - 1);
              if (nextIdx < items.length && nextIdx !== idx) {
                playSegment(nextIdx, { manual: true });
                return;
              }
              playSegment(idx, { manual: true });
              return;
            }
          }
          if (idx < 0 && items.length > 0) {
            playSegment(firstContentIndex, { manual: true });
          } else {
            const p = audio.play();
            if (p && p.catch) p.catch(() => { });
          }
        } else {
          audio.pause();
        }
      });
    }

    // 更新进度条和时间显示
    function updateProgress() {
      const current = audio.currentTime || 0;
      const duration = audio.duration || 0;

      if (currentTimeEl) currentTimeEl.textContent = formatTime(current);
      if (durationEl) durationEl.textContent = formatTime(duration);

      if (progressFilled && duration > 0) {
        const percentage = (current / duration) * 100;
        progressFilled.style.width = `${Math.min(100, Math.max(0, percentage))}%`;
      }
    }

    // 进度条点击跳转
    if (progressBar) {
      progressBar.addEventListener('click', (e) => {
        const rect = progressBar.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const percentage = clickX / rect.width;
        const duration = audio.duration || 0;
        if (duration > 0) {
          audio.currentTime = percentage * duration;
        }
      });
    }


    // 监听audio事件更新UI
    audio.addEventListener('play', updatePlayPauseIcon);
    audio.addEventListener('pause', updatePlayPauseIcon);
    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('loadedmetadata', () => {
      updateProgress();
      updatePlayPauseIcon();
    });

    // 初始化播放器UI
    updateProgress();
    updatePlayPauseIcon();

    // 设置面板（沿用你的结构）
    let _prevFocus = null; let _trapHandler = null;
    function getFocusable(root) {
      return root ? Array.from(root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null) : [];
    }
    function enableTrap() {
      if (!_trapRoot) return;
      const fs = getFocusable(_trapRoot); if (fs.length) fs[0].focus();
      _trapHandler = (e) => {
        if (e.key !== 'Tab') return;
        const list = getFocusable(_trapRoot); if (!list.length) return;
        const first = list[0], last = list[list.length - 1];
        if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
        else { if (document.activeElement === last) { e.preventDefault(); first.focus(); } }
      };
      document.addEventListener('keydown', _trapHandler);
    }
    function disableTrap() { if (_trapHandler) { document.removeEventListener('keydown', _trapHandler); _trapHandler = null; } }
    let _trapRoot = null;
    function openSettings() {
      if (settingsOverlay) { settingsOverlay.hidden = false; requestAnimationFrame(() => settingsOverlay.classList.add('show')); }
      if (settingsPanel) { settingsPanel.hidden = false; requestAnimationFrame(() => settingsPanel.classList.add('show')); }
      try { _prevFocus = document.activeElement; } catch (_) { }
      try { document.body.style.overflow = 'hidden'; } catch (_) { }
      _trapRoot = settingsPanel;
      enableTrap();
    }
    function closeSettings() {
      disableTrap();
      _trapRoot = null;
      if (settingsOverlay) { settingsOverlay.classList.remove('show'); setTimeout(() => settingsOverlay.hidden = true, 200); }
      if (settingsPanel) { settingsPanel.classList.remove('show'); setTimeout(() => settingsPanel.hidden = true, 200); }
      try { document.body.style.overflow = ''; } catch (_) { }
      try { if (_prevFocus && _prevFocus.focus) _prevFocus.focus(); } catch (_) { }
    }
    if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
    if (settingsOverlay) settingsOverlay.addEventListener('click', closeSettings);
    if (settingsClose) settingsClose.addEventListener('click', closeSettings);
    if (settingsDone) settingsDone.addEventListener('click', closeSettings);

    // 快捷键帮助面板
    const shortcutsBtn = qs('#shortcutsToggle');
    const shortcutsOverlay = qs('#shortcutsOverlay');
    const shortcutsPanel = qs('#shortcutsPanel');
    const shortcutsClose = qs('#shortcutsClose');
    const shortcutsDone = qs('#shortcutsDone');
    const shortcutsReset = qs('#shortcutsReset');
    const shortcutsContainer = qs('#shortcutsContainer');

    // 当前正在编辑的动作
    let editingAction = null;
    let editingKbd = null;

    // 渲染快捷键面板
    function renderShortcutsPanel() {
      if (!shortcutsContainer) return;

      // 按分组组织快捷键
      const groups = {};
      for (const [action, config] of Object.entries(currentShortcuts)) {
        if (!groups[config.group]) groups[config.group] = [];
        groups[config.group].push({ action, ...config });
      }

      let html = '';
      for (const [groupName, items] of Object.entries(groups)) {
        html += `<div class="shortcuts-group"><h3>${groupName}</h3>`;
        for (const item of items) {
          const isCustom = item.key !== DEFAULT_SHORTCUTS[item.action].key;
          const displayKey = getKeyDisplayName(item.key);
          html += `
            <div class="shortcut-item" data-action="${item.action}">
              <kbd class="editable ${isCustom ? 'custom' : ''}" data-action="${item.action}" title="点击自定义">${displayKey}</kbd>
              <span>${item.label}</span>
            </div>
          `;
        }
        html += '</div>';
      }

      shortcutsContainer.innerHTML = html;

      // 绑定点击事件
      shortcutsContainer.querySelectorAll('kbd.editable').forEach(kbd => {
        kbd.addEventListener('click', (e) => {
          e.stopPropagation();
          startEditingShortcut(kbd.dataset.action, kbd);
        });
      });
    }

    // 开始编辑快捷键
    function startEditingShortcut(action, kbdEl) {
      // 如果已经在编辑其他快捷键,先取消
      cancelEditing();

      editingAction = action;
      editingKbd = kbdEl;
      kbdEl.classList.add('editing');
      kbdEl.textContent = '按键...';

      // 添加全局键盘监听
      document.addEventListener('keydown', handleShortcutCapture, true);
    }

    // 处理快捷键捕获
    function handleShortcutCapture(e) {
      e.preventDefault();
      e.stopPropagation();

      // Escape 取消编辑
      if (e.key === 'Escape') {
        cancelEditing();
        return;
      }

      const newKey = e.key;

      // 检查冲突
      const conflict = findConflict(currentShortcuts, editingAction, newKey);
      if (conflict) {
        // 显示冲突动画
        if (editingKbd) {
          editingKbd.classList.add('conflict');
          editingKbd.textContent = '冲突!';
          setTimeout(() => {
            if (editingKbd) {
              editingKbd.classList.remove('conflict');
              editingKbd.textContent = '按键...';
            }
          }, 600);
        }
        showNotification(`与「${currentShortcuts[conflict].label}」冲突`);
        return;
      }

      // 更新快捷键
      currentShortcuts[editingAction].key = newKey;
      saveCustomShortcuts(currentShortcuts);

      // 更新显示
      finishEditing(newKey);
      showNotification('快捷键已更新');
    }

    // 完成编辑
    function finishEditing(newKey) {
      document.removeEventListener('keydown', handleShortcutCapture, true);

      if (editingKbd) {
        editingKbd.classList.remove('editing');
        editingKbd.textContent = getKeyDisplayName(newKey);

        // 检查是否为自定义键位
        const isCustom = currentShortcuts[editingAction].key !== DEFAULT_SHORTCUTS[editingAction].key;
        editingKbd.classList.toggle('custom', isCustom);
      }

      editingAction = null;
      editingKbd = null;
    }

    // 取消编辑
    function cancelEditing() {
      document.removeEventListener('keydown', handleShortcutCapture, true);

      if (editingKbd && editingAction) {
        editingKbd.classList.remove('editing');
        editingKbd.textContent = getKeyDisplayName(currentShortcuts[editingAction].key);
      }

      editingAction = null;
      editingKbd = null;
    }

    function openShortcuts() {
      // 取消可能的编辑状态
      cancelEditing();

      // 先立即关闭设置面板,避免两个面板叠加显示
      if (settingsPanel && !settingsPanel.hidden) {
        disableTrap();
        if (settingsOverlay) { settingsOverlay.classList.remove('show'); settingsOverlay.hidden = true; }
        if (settingsPanel) { settingsPanel.classList.remove('show'); settingsPanel.hidden = true; }
        try { document.body.style.overflow = ''; } catch (_) { }
      }

      // 渲染面板
      renderShortcutsPanel();

      if (shortcutsOverlay) { shortcutsOverlay.hidden = false; requestAnimationFrame(() => shortcutsOverlay.classList.add('show')); }
      if (shortcutsPanel) { shortcutsPanel.hidden = false; requestAnimationFrame(() => shortcutsPanel.classList.add('show')); }
      try { _prevFocus = document.activeElement; } catch (_) { }
      try { document.body.style.overflow = 'hidden'; } catch (_) { }
    }

    function closeShortcuts() {
      cancelEditing();
      if (shortcutsOverlay) { shortcutsOverlay.classList.remove('show'); setTimeout(() => shortcutsOverlay.hidden = true, 200); }
      if (shortcutsPanel) { shortcutsPanel.classList.remove('show'); setTimeout(() => shortcutsPanel.hidden = true, 200); }
      try { document.body.style.overflow = ''; } catch (_) { }
      try { if (_prevFocus && _prevFocus.focus) _prevFocus.focus(); } catch (_) { }
    }

    if (shortcutsBtn) shortcutsBtn.addEventListener('click', openShortcuts);
    if (shortcutsOverlay) shortcutsOverlay.addEventListener('click', closeShortcuts);
    if (shortcutsClose) shortcutsClose.addEventListener('click', closeShortcuts);
    if (shortcutsDone) shortcutsDone.addEventListener('click', closeShortcuts);

    // 恢复默认快捷键
    if (shortcutsReset) {
      shortcutsReset.addEventListener('click', () => {
        currentShortcuts = resetShortcuts();
        renderShortcutsPanel();
        showNotification('已恢复默认快捷键');
      });
    }

    // 快捷键面板"返回设置"按钮
    const shortcutsBack = qs('#shortcutsBack');
    if (shortcutsBack) {
      shortcutsBack.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        cancelEditing();
        // 立即关闭快捷键面板
        if (shortcutsOverlay) { shortcutsOverlay.classList.remove('show'); shortcutsOverlay.hidden = true; }
        if (shortcutsPanel) { shortcutsPanel.classList.remove('show'); shortcutsPanel.hidden = true; }
        try { document.body.style.overflow = ''; } catch (_) { }
        // 立即打开设置面板
        openSettings();
      });
    }


    // 自动关闭（睡眠定时）
    let _autoStopReturnToSettings = false;
    function openAutoStop() {
      loadAutoStopSettings();
      reflectAutoStopSettings();

      // 从设置面板进入时，先立即关闭设置面板，避免叠加
      _autoStopReturnToSettings = !!(settingsPanel && !settingsPanel.hidden);
      if (_autoStopReturnToSettings) {
        disableTrap();
        _trapRoot = null;
        if (settingsOverlay) { settingsOverlay.classList.remove('show'); settingsOverlay.hidden = true; }
        if (settingsPanel) { settingsPanel.classList.remove('show'); settingsPanel.hidden = true; }
        try { document.body.style.overflow = ''; } catch (_) { }
      }

      if (autoStopOverlay) { autoStopOverlay.hidden = false; requestAnimationFrame(() => autoStopOverlay.classList.add('show')); }
      if (autoStopPanel) { autoStopPanel.hidden = false; requestAnimationFrame(() => autoStopPanel.classList.add('show')); }
      try { _prevFocus = document.activeElement; } catch (_) { }
      try { document.body.style.overflow = 'hidden'; } catch (_) { }
      _trapRoot = autoStopPanel;
      enableTrap();
    }
    function closeAutoStop({ reopenSettings = true } = {}) {
      disableTrap();
      _trapRoot = null;
      if (autoStopOverlay) { autoStopOverlay.classList.remove('show'); setTimeout(() => autoStopOverlay.hidden = true, 200); }
      if (autoStopPanel) { autoStopPanel.classList.remove('show'); setTimeout(() => autoStopPanel.hidden = true, 200); }
      try { document.body.style.overflow = ''; } catch (_) { }

      if (reopenSettings && _autoStopReturnToSettings) {
        _autoStopReturnToSettings = false;
        setTimeout(() => openSettings(), 210);
        return;
      }
      try { if (_prevFocus && _prevFocus.focus) _prevFocus.focus(); } catch (_) { }
    }
    if (autoStopOverlay) autoStopOverlay.addEventListener('click', () => closeAutoStop());
    if (autoStopClose) autoStopClose.addEventListener('click', () => closeAutoStop());
    if (autoStopCancel) autoStopCancel.addEventListener('click', () => closeAutoStop());
    if (autoStopOn) autoStopOn.addEventListener('change', () => { if (autoStopOn.checked) { autoStopDraftEnabled = true; reflectAutoStopSettings(); } });
    if (autoStopOff) autoStopOff.addEventListener('change', () => { if (autoStopOff.checked) { autoStopDraftEnabled = false; reflectAutoStopSettings(); } });
    if (autoStopCountInput) {
      autoStopCountInput.addEventListener('change', () => {
        autoStopDraftCount = normalizeAutoStopCount(autoStopCountInput.value);
        reflectAutoStopSettings();
      });
      autoStopCountInput.addEventListener('blur', () => {
        if (!autoStopCountInput.value) {
          autoStopCountInput.value = String(autoStopDraftCount);
        }
      });
    }
    if (autoStopSave) {
      autoStopSave.addEventListener('click', () => {
        saveAutoStopSettings({ enabled: autoStopDraftEnabled, count: autoStopCountInput ? autoStopCountInput.value : autoStopDraftCount });
        reflectAutoStopSettings();
        showNotification('已保存自动关闭设置');
        closeAutoStop();
      });
    }

    // Escape 键处理：优先关闭快捷键面板，然后关闭设置面板
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const dataConfirm = document.getElementById('dataConfirmOverlay');
        if (dataConfirm) {
          dataConfirm.remove();
          return;
        }
        if (autoStopPanel && !autoStopPanel.hidden) {
          closeAutoStop({ reopenSettings: true });
        } else if (shortcutsPanel && !shortcutsPanel.hidden) {
          closeShortcuts();
        } else {
          closeSettings();
        }
      }
    });

    // --------------------------
    // 全局快捷键
    // --------------------------
    // 音量提示UI
    let volumeToastTimer = 0;
    function showVolumeToast(volume) {
      const percentage = Math.round(volume * 100);
      let toast = document.getElementById('volumeToast');

      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'volumeToast';
        toast.style.cssText = `
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: var(--surface);
          color: var(--text);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 20px 30px;
          box-shadow: var(--shadow);
          z-index: 2000;
          backdrop-filter: saturate(120%) blur(10px);
          font-size: 18px;
          font-weight: 500;
          min-width: 120px;
          text-align: center;
          opacity: 0;
          transition: opacity 0.2s ease;
        `;
        document.body.appendChild(toast);
      }

      toast.textContent = `音量 ${percentage}%`;
      toast.style.opacity = '1';

      if (volumeToastTimer) clearTimeout(volumeToastTimer);
      volumeToastTimer = setTimeout(() => {
        toast.style.opacity = '0';
      }, 1000);
    }

    // 检查按键是否匹配快捷键
    function matchesShortcut(eventKey, action) {
      const shortcutKey = currentShortcuts[action]?.key;
      if (!shortcutKey) return false;
      // 不区分大小写比较
      return eventKey.toLowerCase() === shortcutKey.toLowerCase();
    }

    document.addEventListener('keydown', (e) => {
      // 避免在输入框中触发快捷键
      const target = e.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      // ? 键 - 打开/关闭快捷键帮助（固定键位，不可自定义）
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        if (shortcutsPanel && !shortcutsPanel.hidden) {
          closeShortcuts();
        } else {
          openShortcuts();
        }
        return;
      }

      // 音量增加
      if (matchesShortcut(e.key, 'volumeUp')) {
        e.preventDefault();
        const newVolume = Math.min(1, audio.volume + 0.1);
        audio.volume = newVolume;
        try { localStorage.setItem('nce_volume', newVolume); } catch (_) { }
        showVolumeToast(newVolume);
        return;
      }

      // 音量减少
      if (matchesShortcut(e.key, 'volumeDown')) {
        e.preventDefault();
        const newVolume = Math.max(0, audio.volume - 0.1);
        audio.volume = newVolume;
        try { localStorage.setItem('nce_volume', newVolume); } catch (_) { }
        showVolumeToast(newVolume);
        return;
      }

      // 播放/暂停
      if (matchesShortcut(e.key, 'playPause')) {
        e.preventDefault();
        if (audio.paused) {
          if (readMode === 'shadow') {
            const tolerance = 0.1;
            if (idx < 0 && items.length > 0) {
              playSegment(shadowStartIndex, { manual: true });
              return;
            }
            if (idx >= 0 && segmentEnd > 0) {
              const currentTime = audio.currentTime;
              if (Math.abs(currentTime - segmentEnd) < tolerance) {
                playSegment(idx, { manual: true });
                return;
              }
            }
            const p = audio.play();
            if (p && p.catch) p.catch(() => { });
            return;
          }
          // 点读模式下的智能跳转：如果当前在句末（说明是自动暂停的），跳到下一句
          if (readMode === 'single' && idx >= 0 && segmentEnd > 0) {
            const currentTime = audio.currentTime;
            const tolerance = 0.1; // 容错范围 100ms
            // 判断是否在当前句末尾（自动暂停的位置）
            if (Math.abs(currentTime - segmentEnd) < tolerance) {
              // 在句末，跳到下一句
              const nextIdx = Math.min(idx + 1, items.length - 1);
              if (nextIdx < items.length && nextIdx !== idx) {
                playSegment(nextIdx, { manual: true });
                return;
              }
              // 如果已经是最后一句，则重播当前句
              playSegment(idx, { manual: true });
              return;
            }
          }

          // 其他情况：正常播放
          if (idx < 0 && items.length > 0) {
            // 如果没有选中任何句子，从第一句正文开始
            const startIdx = readMode === 'shadow' ? shadowStartIndex : firstContentIndex;
            playSegment(startIdx, { manual: true });
          } else {
            const p = audio.play();
            if (p && p.catch) p.catch(() => { });
          }
        } else {
          audio.pause();
        }
        return;
      }

      // 下一句
      if (matchesShortcut(e.key, 'nextSentence')) {
        e.preventDefault();
        const startIdx = readMode === 'shadow' ? shadowStartIndex : firstContentIndex;
        const nextIdx = idx < 0 ? startIdx : Math.min(idx + 1, items.length - 1);
        if (nextIdx < items.length) {
          playSegment(nextIdx, { manual: true });
        }
        return;
      }

      // 上一句
      if (matchesShortcut(e.key, 'prevSentence')) {
        e.preventDefault();
        const startIdx = readMode === 'shadow' ? shadowStartIndex : firstContentIndex;
        const prevIdx = idx < 0 ? startIdx : Math.max(idx - 1, 0);
        if (prevIdx >= 0) {
          playSegment(prevIdx, { manual: true });
        }
        return;
      }

      // 重播当前句
      if (matchesShortcut(e.key, 'replay')) {
        e.preventDefault();
        if (idx >= 0 && idx < items.length) {
          playSegment(idx, { manual: true });
        } else if (items.length > 0) {
          // 如果没有当前句，播放第一句正文
          const startIdx = readMode === 'shadow' ? shadowStartIndex : firstContentIndex;
          playSegment(startIdx, { manual: true });
        }
        return;
      }

      // 切换当前句显示/隐藏（听读模式）
      if (matchesShortcut(e.key, 'toggleReveal')) {
        e.preventDefault();
        if (readMode === 'listen' && idx >= 0 && idx < items.length) {
          toggleSentenceReveal(idx);
        }
        return;
      }
    });

    const settingsReset = qs('#settingsReset');
    if (settingsReset) {
      settingsReset.addEventListener('click', () => {
        try { localStorage.setItem('audioPlaybackRate', DEFAULT_RATE); } catch (_) { }
        audio.playbackRate = DEFAULT_RATE;
        setReadMode('continuous'); setFollowMode(true); setAfterPlay('none'); setSkipIntro(false);
        setShadowRepeatCount(2); setShadowGapMode('medium');
        saveAutoStopSettings({ enabled: false, count: 3 });
        reflectAutoStopSettings();
        reflectReadMode(); reflectFollowMode(); reflectAfterPlay(); reflectSkipIntro(); reflectShadowSettings();
        if (window.NCE_APP) { NCE_APP.setLang('bi'); const segs = document.querySelectorAll('#langTabs [data-mode]'); segs.forEach(b => b.classList.toggle('active', b.dataset.mode === 'bi')); }
        showNotification('已恢复默认设置');
      });
    }

    // --------------------------
    // 数据导出 / 导入（逻辑已抽取至 assets/storage.js，与收藏页复用同一份实现）
    // --------------------------
    if (window.NCE_STORAGE) {
      NCE_STORAGE.bindDataControls({
        exportBtn: dataExportBtn,
        importBtn: dataImportBtn,
        importFile: dataImportFile,
        notify: showNotification
      });
    }

    // --------------------------
    // 渲染 & 端点计算
    // --------------------------
    function render() {
      const html = items.map((it, i) => `
        <div class="sentence" data-idx="${i}">
          <button class="sentence-fav-btn ${sentenceFavSet.has(sentenceFavId(i)) ? 'active' : ''}" data-idx="${i}" aria-label="${sentenceFavSet.has(sentenceFavId(i)) ? '从清单移除' : '加入清单'}" aria-pressed="${sentenceFavSet.has(sentenceFavId(i))}">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M8 12.027 3.297 14.5l.9-5.243L.1 5.997l5.258-.764L8 0l2.642 5.233 5.258.764-4.097 3.26.9 5.243L8 12.027Z"></path>
            </svg>
          </button>
          <button class="reveal-btn" data-idx="${i}" aria-label="显示/隐藏文本">
            <span class="reveal-icon">👁</span>
            <span class="reveal-text">显示</span>
          </button>
          <div class="en">${it.en}</div>
          ${it.cn ? `<div class="cn">${it.cn}</div>` : ''}
        </div>
      `).join('');
      qs('#sentences').innerHTML = html;
      // 渲染后立即更新听力模式 UI
      updateListenModeUI();
    }

    function toggleSentenceFav(i) {
      if (!items || i < 0 || i >= items.length) return;
      const id = sentenceFavId(i);
      const existingIdx = sentenceFavs.findIndex(x => x && x.id === id);
      let added = false;
      if (existingIdx >= 0) {
        sentenceFavs.splice(existingIdx, 1);
        sentenceFavSet.delete(id);
      } else {
        const it = items[i] || {};
        sentenceFavs.push({
          id,
          lessonId: `${book}/${base}`,
          book,
          base,
          title: titleEl.textContent || base,
          sub: subEl.textContent || '',
          idx: i,
          start: Number.isFinite(it.start) ? it.start : 0,
          en: it.en || '',
          cn: it.cn || '',
          ts: Date.now()
        });
        sentenceFavSet.add(id);
        added = true;
      }
      saveSentenceFavs(sentenceFavs);

      const btn = listEl.querySelector(`.sentence[data-idx="${i}"] .sentence-fav-btn`);
      if (btn) {
        const isFav = sentenceFavSet.has(id);
        btn.classList.toggle('active', isFav);
        btn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
        btn.setAttribute('aria-label', isFav ? '从清单移除' : '加入清单');
      }

      showNotification(added ? '已加入清单' : '已从清单移除');
    }

    function computeEnd(it) {
      const fallback = 0.2; // 连读最小时长
      if (it.end && it.end > it.start) return it.end;
      return Math.max(0, (it.start || 0) + fallback);
    }
    // 单句模式提前量，参考老版本：提前 0.5s 结束，避免读到下一句的前缀
    const SINGLE_CUTOFF = 0.5;
    const MIN_SEG_DUR = 0.2;
    function endFor(it) {
      if (readMode === 'single' || readMode === 'shadow') {
        // 取下一句开始时间作为结束基准，并减去提前量
        let baseEnd = 0;
        if (it.end && it.end > it.start) baseEnd = it.end;
        else {
          const i = items ? items.indexOf(it) : -1;
          if (i >= 0 && i + 1 < items.length) baseEnd = items[i + 1].start || 0;
        }
        // 计算单句的目标结束时间：基准-提前量，且不小于最小时长
        if (baseEnd > 0) {
          const e = Math.max(it.start + MIN_SEG_DUR, baseEnd - SINGLE_CUTOFF);
          return e;
        }
        // 无可用基准：给一个保守默认值
        return it.start + 0.5;
      }
      return computeEnd(it);
    }

    // --------------------------
    // 调度：远端定时 + 近端 rAF
    // --------------------------
    function clearAdvance() {
      if (segmentTimer) { clearTimeout(segmentTimer); segmentTimer = 0; }
      if (segmentRaf) { cancelAnimationFrame(segmentRaf); segmentRaf = 0; }
    }
    function clearShadowGapTimer() {
      if (shadowGapTimer) { clearTimeout(shadowGapTimer); shadowGapTimer = 0; }
    }
    function guardAheadSec() {
      const r = Math.max(0.5, Math.min(3, audio.playbackRate || 1));
      // iOS 略保守：基础 80ms，倍速升高再加裕度，上限约 120ms
      const base = isIOSLike ? 0.08 : 0.06;
      const slope = isIOSLike ? 0.03 : 0.02;
      return base + (r - 1) * slope;
    }
    const NEAR_WINDOW_MS = isIOSLike ? 160 : 120;
    const MAX_CHUNK_MS = 10000;

    function estimateShadowGapSeconds(item, endSnap) {
      if (!item) return 1.5;
      const baseEnd = (Number.isFinite(endSnap) && endSnap > item.start) ? endSnap : computeEnd(item);
      const dur = Math.max(0.4, baseEnd - (item.start || 0));
      const words = countWords(item.en);
      const base = Math.max(1.2, Math.min(4.8, dur * 0.6 + Math.min(12, words) * 0.08));
      const ratio = SHADOW_GAP_RATIOS[shadowGapMode] || 1.0;
      return Math.max(0.8, Math.min(6, base * ratio));
    }

    function scheduleAdvance() {
      clearAdvance(); isScheduling = false; scheduleTime = 0;
      if (audio.paused) return;
      // 连读模式或听读模式（非单句循环）下不做逐句调度，避免 iOS 在边界 seek 造成的卡顿
      if (readMode === 'continuous' || (readMode === 'listen' && afterPlay !== 'single')) return;
      if (!(segmentEnd && idx >= 0)) return;

      const rate = Math.max(0.0001, audio.playbackRate || 1);
      const remainingMs = Math.max(0, (segmentEnd - audio.currentTime) * 1000 / rate);
      scheduleTime = segmentEnd;
      const modeSnap = readMode;

      // 近端窗口：rAF 精确判断
      if (remainingMs <= NEAR_WINDOW_MS) {
        isScheduling = true;
        const endSnap = segmentEnd;
        const guard = guardAheadSec();
        const step = () => {
          if (readMode !== modeSnap || audio.paused || !(segmentEnd && idx >= 0)) { isScheduling = false; return; }
          const now = audio.currentTime;
          if (now >= endSnap - guard) {
            isScheduling = false; scheduleTime = 0;

            // 点读：暂停在段末
            if (readMode === 'shadow') {
              handleShadowSegmentEnd(endSnap);
              return;
            }
            audio.pause();
            audio.currentTime = endSnap;

            // 单句循环：标记循环等待，稍后重播
            if (afterPlay === 'single' && idx >= 0 && idx < items.length && !loopReplayPending) {
              loopReplayPending = true;
              setTimeout(() => {
                if (loopReplayPending && afterPlay === 'single') {
                  loopReplayPending = false;
                  playSegment(idx, { manual: false });
                }
              }, 300);
            } else {
            }
          } else {
            segmentRaf = raf(step);
          }
        };
        segmentRaf = raf(step);
        return;
      }

      // 远端窗口：coarse timer
      const delay = Math.max(10, Math.min(remainingMs, MAX_CHUNK_MS));
      isScheduling = true;
      segmentTimer = setTimeout(function tick() {
        if (readMode !== modeSnap || audio.paused || !(segmentEnd && idx >= 0)) { isScheduling = false; return; }
        const now = audio.currentTime;
        const end = segmentEnd;
        const remainRealMs = Math.max(0, (end - now) * 1000 / Math.max(0.0001, audio.playbackRate || 1));

        if (remainRealMs <= NEAR_WINDOW_MS) {
          isScheduling = false; scheduleAdvance(); return;
        }
        const rate2 = Math.max(0.0001, audio.playbackRate || 1);
        const nextDelay = Math.max(10, Math.min(Math.max(0, (end - audio.currentTime) * 1000 / rate2), MAX_CHUNK_MS));
        segmentTimer = setTimeout(tick, nextDelay);
      }, delay);
    }

    function handleShadowSegmentEnd(endSnap) {
      if (readMode !== 'shadow' || shadowGapTimer) return;
      if (!(idx >= 0 && idx < items.length)) return;
      const currentIdx = idx;
      const item = items[currentIdx];
      shadowRepeatRemaining = Math.max(0, shadowRepeatRemaining - 1);
      const gapMs = Math.round(estimateShadowGapSeconds(item, endSnap) * 1000);

      shadowAutoPause = true;
      audio.pause();
      audio.currentTime = endSnap;
      clearShadowGapTimer();

      shadowGapTimer = setTimeout(() => {
        shadowGapTimer = 0;
        if (readMode !== 'shadow') return;
        if (idx !== currentIdx && shadowRepeatRemaining > 0) return;

        if (shadowRepeatRemaining > 0) {
          playSegment(currentIdx, { manual: false, shadowRepeat: true });
          return;
        }

        const nextIdx = currentIdx + 1;
        if (nextIdx < items.length) {
          playSegment(nextIdx, { manual: false });
          return;
        }

        if (afterPlay === 'all') {
          playSegment(shadowStartIndex, { manual: false });
        } else if (afterPlay === 'next') {
          autoNextLesson();
        }
      }, gapMs);
    }

    // --------------------------
    // 无缝切句 / 播放控制
    // --------------------------
    function fastSeekTo(t) {
      if (typeof audio.fastSeek === 'function') {
        try { audio.fastSeek(t); } catch (_) { audio.currentTime = t; }
      } else {
        audio.currentTime = t;
      }
    }

    const SEEK_OK_EPS = 0.25;
    const SEEK_TIMEOUT_MS = isIOSLike ? 2500 : 1200;

    async function getAudioBlobUrl() {
      if (audioBlobUrl) return audioBlobUrl;
      if (audioBlobPromise) return await audioBlobPromise;
      audioBlobPromise = (async () => {
        const store = window.NCE_RESOURCES;
        if (!store) throw new Error('资源存储未就绪');
        const rec = await store.getLesson(book, base);
        if (!rec || !rec.audioBlob) throw new Error('NO_AUDIO');
        audioBlobUrl = URL.createObjectURL(rec.audioBlob);
        return audioBlobUrl;
      })();
      try { return await audioBlobPromise; }
      finally { if (!audioBlobUrl) audioBlobPromise = null; }
    }

    async function switchToBlobSource() {
      if (usingBlobSrc) return true;
      try {
        const url = await getAudioBlobUrl();
        const keepRate = audio.playbackRate || 1;
        const keepVol = audio.volume;
        const keepMuted = audio.muted;

        metadataReady = false;
        audio.src = url;
        try { audio.load(); } catch (_) { }
        await ensureMetadata();

        try { audio.playbackRate = keepRate; } catch (_) { }
        try { audio.volume = keepVol; } catch (_) { }
        try { audio.muted = keepMuted; } catch (_) { }

        usingBlobSrc = true;
        return true;
      } catch (e) {
        console.error('[音频] 切换为 Blob 失败', e);
        return false;
      }
    }

    async function playSegment(i, opts) {
      const manual = !!(opts && opts.manual);
      const shadowRepeat = !!(opts && opts.shadowRepeat);
      const prevIdx = idx;

      if (i < 0 || i >= items.length) return;
      const mySeq = ++playSeq;

      // 手动操作时清除循环等待标志
      if (manual && loopReplayPending) {
        loopReplayPending = false;
      }

      // 自动流程：同句且已在播不重复
      if (!manual && idx === i && !audio.paused) {
        return;
      }

      // iOS：点击句子也要能“第一次就播”
      if (isIOSLike && !iosUnlocked) unlockAudioSync();

      // 在 iOS 上，seek 前优先确保 metadata
      await ensureMetadata();

      clearShadowGapTimer();
      shadowAutoPause = false;
      if (readMode === 'shadow' && (manual || i !== prevIdx || !shadowRepeat)) {
        shadowRepeatRemaining = shadowRepeatTotal;
      }
      clearAdvance(); isScheduling = false; scheduleTime = 0;
      idx = i;
      const it = items[i];
      let start = Math.max(0, it.start || 0);
      segmentEnd = endFor(it);
      segmentStartWallclock = performance.now();
      highlight(i, manual);

      const cur = Math.max(0, audio.currentTime || 0);
      // 自动前进且"新起点过近"时，给极小前移，避免抖动
      // 但循环重播(同句)时不应用此逻辑，必须回到真实起点
      const isLoopReplay = (!manual && idx === i);
      if (!manual && !isLoopReplay && start <= cur + 0.005) {
        const dur = Number(audio.duration);
        const eps = 0.005;
        start = Math.min(Number.isFinite(dur) ? Math.max(0, dur - 0.05) : start + eps, cur + eps);
      }

      if (!manual && (readMode === 'continuous' || (readMode === 'listen' && afterPlay !== 'single')) && !audio.paused) {
        // 连读或听读（非单句循环）：保持播放，静音→seek→(seeked/canplay)→两帧后解除静音→调度
        audio.muted = true;
        let done = false;
        const finish = () => {
          if (done) return; done = true;
          audio.removeEventListener('seeked', finish);
          audio.removeEventListener('canplay', finish);
          raf2(() => { audio.muted = false; scheduleAdvance(); });
        };
        audio.addEventListener('seeked', finish, { once: true });
        audio.addEventListener('canplay', finish, { once: true });
        fastSeekTo(start);
      } else {
        // 点读或听读（单句循环）/初次播放：暂停→seek→seeked 后 play（不使用固定延时）
        try { internalPause = true; audio.pause(); } catch (_) { }
        const target = start;
        let retries = 0;
        let blobTried = false;

        const attemptSeek = async () => {
          if (mySeq !== playSeq) return;
          let settled = false;
          const onDone = async () => {
            if (settled) return;
            settled = true;
            audio.removeEventListener('seeked', onDone);
            if (mySeq !== playSeq) return;

            const actual = Math.max(0, audio.currentTime || 0);
            if (!seekLooksOk(target, actual)) {
              retries++;
              if (retries <= 2) { attemptSeek(); return; }
              if (!blobTried && !usingBlobSrc) {
                blobTried = true;
                if (!warnedNoRange) {
                  warnedNoRange = true;
                  showNotification('当前服务器不支持音频跳转，已切换为完整音频加载以启用点读');
                }
                const ok = await switchToBlobSource();
                if (ok && mySeq === playSeq) { retries = 0; attemptSeek(); return; }
              }
            }

            const p = audio.play(); if (p && p.catch) p.catch(() => { });
            raf2(() => scheduleAdvance());
          };
          audio.addEventListener('seeked', onDone, { once: true });
          fastSeekTo(target);
          setTimeout(onDone, SEEK_TIMEOUT_MS);
        };

        attemptSeek();
      }
    }

    // --------------------------
    // 高亮 & 跟随
    // --------------------------
    let scrollTimer = 0;
    let followAnimRaf = 0;
    function cancelFollowAnim() {
      if (followAnimRaf) { cancelAnimationFrame(followAnimRaf); followAnimRaf = 0; }
    }
    function prefersReducedMotion() {
      try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
    }
    function getScrollY() { return window.scrollY || document.documentElement.scrollTop || 0; }
    function maxScrollY() {
      const doc = document.documentElement;
      const body = document.body;
      const h = Math.max(doc?.scrollHeight || 0, body?.scrollHeight || 0);
      return Math.max(0, h - window.innerHeight);
    }
    function targetScrollYFor(el) {
      const rect = el.getBoundingClientRect();
      const y = getScrollY();
      const centerOffset = (window.innerHeight / 2) - (rect.height / 2);
      return clamp(y + rect.top - centerOffset, 0, maxScrollY());
    }
    function smoothScrollToY(targetY, { durationMs = 260 } = {}) {
      cancelFollowAnim();
      const startY = getScrollY();
      const delta = targetY - startY;
      if (Math.abs(delta) < 4) return;
      const start = performance.now();
      const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
      const step = (now) => {
        const t = clamp((now - start) / durationMs, 0, 1);
        const nextY = startY + delta * easeOutCubic(t);
        window.scrollTo(0, nextY);
        if (t < 1) followAnimRaf = requestAnimationFrame(step);
        else followAnimRaf = 0;
      };
      followAnimRaf = requestAnimationFrame(step);
    }
    function scheduleScrollTo(el, manual) {
      if (!el) return;
      if (scrollTimer) { clearTimeout(scrollTimer); scrollTimer = 0; }
      if (!autoFollow) return;
      cancelFollowAnim();
      if (manual) { try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) { } return; }
      if (prefersReducedMotion()) { try { el.scrollIntoView({ behavior: 'auto', block: 'center' }); } catch (_) { } return; }
      scrollTimer = setTimeout(() => {
        try {
          const y = targetScrollYFor(el);
          // scrollTo({behavior:'smooth'}) 在部分浏览器/场景会被降级，手写动画更一致
          smoothScrollToY(y, { durationMs: 280 });
        } catch (_) { }
      }, 240);
    }
    function highlight(i, manual = false) {
      const prev = listEl.querySelector('.sentence.active'); if (prev) prev.classList.remove('active');
      const cur = listEl.querySelector(`.sentence[data-idx="${i}"]`);
      if (cur) { cur.classList.add('active'); scheduleScrollTo(cur, manual); }
    }

    // --------------------------
    // iOS 自动播放限制：恢复播放提示
    // --------------------------
    let resumePlayPrompt = null;
    function hideResumePlayPrompt() {
      if (!resumePlayPrompt) return;
      try { resumePlayPrompt.remove(); } catch (_) { }
      resumePlayPrompt = null;
    }
    function showResumePlayPrompt() {
      if (resumePlayPrompt) return;
      const wrap = document.createElement('div');
      wrap.className = 'resume-play-overlay';

      const card = document.createElement('div');
      card.className = 'resume-play-card';

      const icon = document.createElement('div');
      icon.innerHTML = '<svg class="resume-play-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';

      const text = document.createElement('div');
      text.className = 'resume-play-text';
      text.textContent = '点一下继续播放';

      const sub = document.createElement('div');
      sub.className = 'resume-play-subtext';
      sub.textContent = '浏览器自动播放已暂停';

      card.appendChild(icon);
      card.appendChild(text);
      card.appendChild(sub);
      wrap.appendChild(card);

      document.body.appendChild(wrap);
      resumePlayPrompt = wrap;

      const onClick = () => {
        // 可能存在“解锁音频”设置的 0ms pause，点击继续播放时需要取消，避免把本次播放也暂停掉
        if (isIOSLike) cancelIOSUnlockPause();

        // 开启“跳过开头”时，新页面恢复的 currentTime 在部分 iOS 设备上会被忽略（仍为 0）
        // 这里采用：同一点击栈内先发起 play（满足用户手势要求），再在播放后进行 seek 到目标时间
        let targetIdx = (Number.isInteger(idx) && idx >= 0) ? idx : firstContentIndex;
        if (readMode === 'shadow' && targetIdx < shadowStartIndex) targetIdx = shadowStartIndex;
        if (skipIntro && targetIdx < firstContentIndex) targetIdx = firstContentIndex;
        const desired = (items && items[targetIdx] && Number.isFinite(items[targetIdx].start)) ? items[targetIdx].start : Math.max(0, audio.currentTime || 0);

        // 同步对齐状态（避免 scheduleAdvance 使用旧 idx）
        if (items && items.length && targetIdx >= 0 && targetIdx < items.length) {
          idx = targetIdx;
          segmentEnd = endFor(items[targetIdx]);
          highlight(targetIdx, false);
        }

        const onPlaying = () => { hideResumePlayPrompt(); };
        audio.addEventListener('playing', onPlaying, { once: true });

        try {
          if (desired > 0.05) audio.muted = true; // 避免从 0 到目标时间的可闻跳动
          const p = audio.play();
          if (p && p.catch) {
            p.catch(() => {
              audio.removeEventListener('playing', onPlaying);
              try { audio.muted = false; } catch (_) { }
              // 仍被拦截则保留提示
            });
          }
        } catch (_) {
          audio.removeEventListener('playing', onPlaying);
          try { audio.muted = false; } catch (_) { }
        }

        (async () => {
          try {
            if (!Number.isFinite(desired) || desired <= 0.01) { raf2(() => { audio.muted = false; scheduleAdvance(); }); return; }
            await ensureMetadata();
            const cur = Math.max(0, audio.currentTime || 0);
            if (Math.abs(cur - desired) < 0.15) { raf2(() => { audio.muted = false; scheduleAdvance(); }); return; }

            let done = false;
            const finish = () => {
              if (done) return;
              done = true;
              try { audio.removeEventListener('seeked', finish); } catch (_) { }
              try { audio.removeEventListener('canplay', finish); } catch (_) { }
              raf2(() => { audio.muted = false; scheduleAdvance(); });
            };
            audio.addEventListener('seeked', finish, { once: true });
            audio.addEventListener('canplay', finish, { once: true });
            fastSeekTo(desired);
            setTimeout(finish, 900);
          } catch (_) {
            try { audio.muted = false; } catch (_) { }
            try { scheduleAdvance(); } catch (_) { }
          }
        })();
      };
      wrap.addEventListener('click', onClick);
    }
    function attemptAutoplayAndSchedule() {
      let scheduled = false;
      const onPlaying = () => {
        if (scheduled) return;
        scheduled = true;
        hideResumePlayPrompt();
        scheduleAdvance();
      };
      audio.addEventListener('playing', onPlaying, { once: true });
      try {
        const p = audio.play();
        if (p && p.catch) {
          p.catch(() => {
            audio.removeEventListener('playing', onPlaying);
            showResumePlayPrompt();
          });
        }
      } catch (_) {
        audio.removeEventListener('playing', onPlaying);
        showResumePlayPrompt();
      }
      // 兜底：部分 iOS 会静默失败（无 reject 但保持 paused）
      setTimeout(() => {
        if (!scheduled && audio.paused) {
          try { audio.removeEventListener('playing', onPlaying); } catch (_) { }
          showResumePlayPrompt();
        }
      }, 600);
    }
    listEl.addEventListener('click', e => {
      // 检查是否点击了收藏按钮
      const favBtn = e.target.closest('.sentence-fav-btn');
      if (favBtn) {
        e.preventDefault();
        e.stopPropagation();
        const clickedIdx = parseInt(favBtn.dataset.idx, 10);
        toggleSentenceFav(clickedIdx);
        return;
      }

      // 检查是否点击了显示/隐藏按钮
      const revealBtn = e.target.closest('.reveal-btn');
      if (revealBtn) {
        e.preventDefault();
        e.stopPropagation();
        const clickedIdx = parseInt(revealBtn.dataset.idx, 10);
        if (readMode === 'listen') {
          toggleSentenceReveal(clickedIdx);
        }
        return;
      }

      const s = e.target.closest('.sentence'); if (!s) return;
      const clickedIdx = parseInt(s.dataset.idx, 10);

      // 触发播放（听读模式和普通模式都支持）
      // 确保"首次点句"也能触发 iOS 解锁
      if (isIOSLike && !iosUnlocked) unlockAudioSync();
      playSegment(clickedIdx, { manual: true });
    });

    // 双击事件：听读模式下显示文本
    listEl.addEventListener('dblclick', e => {
      const s = e.target.closest('.sentence'); if (!s) return;
      const clickedIdx = parseInt(s.dataset.idx, 10);

      if (readMode === 'listen' && !revealedSentences.has(clickedIdx)) {
        toggleSentenceReveal(clickedIdx);
      }
    });

    // --------------------------
    // 轻量 timeupdate：优先做点读安全停止，其次做高亮/存档
    // --------------------------
    let lastUpdateTime = 0;
    audio.addEventListener('timeupdate', () => {
      const t = audio.currentTime;
      // 点读模式或听读模式（单句循环）安全网：如果 scheduleAdvance 失效，这里兜底暂停
      if (readMode === 'shadow' && segmentEnd && t >= segmentEnd && !audio.paused) {
        handleShadowSegmentEnd(segmentEnd);
        return;
      }
      if ((readMode === 'single' || (readMode === 'listen' && afterPlay === 'single')) && segmentEnd && t >= segmentEnd && !audio.paused) {
        audio.pause();
        audio.currentTime = segmentEnd;
        // 直接返回，避免本次循环内再做额外计算
        return;
      }

      const now = performance.now();
      if (now - lastUpdateTime < 200) return;
      lastUpdateTime = now;

      // 段首 350ms 内避免重活，降低抖动（不影响上面的点读安全停止）
      if (segmentStartWallclock && now - segmentStartWallclock < 350) return;

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const segEnd = endFor(it);
        const within = t >= it.start && (segEnd ? t < segEnd : true);
        if (within) {
          if (idx !== i) { idx = i; segmentEnd = segEnd; highlight(i); }
          break;
        }
      }

      if (now - _lastSavedAt > 2000) { _lastSavedAt = now; saveLastPos(); }
    });

    // 播放/暂停
    audio.addEventListener('pause', () => {
      const keepShadowGap = shadowAutoPause;
      clearAdvance(); isScheduling = false; scheduleTime = 0;
      if (!keepShadowGap) clearShadowGapTimer();
      if (!internalPause) saveLastPos(true);
      internalPause = false;
      shadowAutoPause = false;
      if (scrollTimer) { clearTimeout(scrollTimer); scrollTimer = 0; }
    });
    audio.addEventListener('play', () => {
      setTimeout(() => scheduleAdvance(), 50);
      touchRecent();
      internalPause = false;
    });

    // 进度变更：重建调度
    audio.addEventListener('seeked', () => {
      clearAdvance(); isScheduling = false; scheduleTime = 0; scheduleAdvance();
    });

    // 整体结束
    audio.addEventListener('ended', () => {
      // 整篇循环：从第一句正文重新开始（连读/听读模式）
      if ((readMode === 'continuous' || readMode === 'listen' || readMode === 'shadow') && afterPlay === 'all' && items.length > 0) {
        setTimeout(() => {
          const restartIdx = readMode === 'shadow' ? shadowStartIndex : firstContentIndex;
          playSegment(restartIdx, { manual: true });
        }, 100);
        return;
      }

      // 自动下一课（仅在未开启整篇循环时，连读/听读模式）
      if ((readMode === 'continuous' || readMode === 'listen' || readMode === 'shadow') && afterPlay === 'next') {
        if (autoStopEnabled) {
          const played = getAutoNextPlayedLessons() + 1;
          setAutoNextPlayedLessons(played);
          if (played >= autoStopCount) {
            showNotification(`已自动停止（连续播放 ${autoStopCount} 课）`);
            resetAutoNextPlayedLessons();
            return;
          }
        }
        autoNextLesson();
      }
    });

    // --------------------------
    // 邻接课程与跳转（基于已导入课程库，按文件名自然排序）
    // --------------------------
    let _libraryPromise = null;
    function getLibrary() {
      if (_libraryPromise) return _libraryPromise;
      _libraryPromise = (async () => {
        if (!window.NCE_RESOURCES) return [];
        const list = await NCE_RESOURCES.listLessons(book);
        return list.sort((a, b) => a.filename.localeCompare(b.filename, 'zh-Hans-CN', { numeric: true }));
      })().catch(() => []);
      return _libraryPromise;
    }
    async function getNextLesson(currentBook, currentFilename) {
      try {
        const lessons = await getLibrary();
        const currentIndex = lessons.findIndex(lesson => lesson.filename === currentFilename);
        if (currentIndex >= 0 && currentIndex < lessons.length - 1) return lessons[currentIndex + 1];
        return null;
      } catch (e) { console.error(e); return null; }
    }
    let _resourceMissingShown = false;
    function showResourceMissing(kind) {
      if (_resourceMissingShown) return;
      _resourceMissingShown = true;
      const label = kind === 'audio' ? '音频' : '课文';
      if (titleEl) titleEl.textContent = '本课资源未导入';
      if (subEl) subEl.textContent = `缺少${label}文件`;
      if (listEl) {
        listEl.innerHTML =
          '<div class="resource-missing" style="padding:32px 16px;text-align:center;color:var(--muted,#888);line-height:1.9">' +
          '本课的音频 / 课文尚未导入。<br>本工具不提供任何教材内容，请导入你合法拥有的 mp3 + lrc 资源。<br><br>' +
          '<a href="index.html" style="display:inline-block;background:var(--accent,#6366f1);color:#fff;text-decoration:none;padding:10px 20px;border-radius:10px;font-weight:600">去导入资源</a>' +
          '</div>';
      }
    }

    function showNotification(message) {
      const n = document.createElement('div');
      n.style.cssText = `
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
        background: var(--surface); color: var(--text); border: 1px solid var(--border);
        border-radius: var(--radius); padding: 12px 20px; box-shadow: var(--shadow);
        z-index: 1000; backdrop-filter: saturate(120%) blur(10px); animation: slideDown 0.3s ease-out;
      `;
      n.textContent = message; document.body.appendChild(n);
      setTimeout(() => { n.style.animation = 'slideUp 0.3s ease-out'; setTimeout(() => { document.body.removeChild(n); }, 300); }, 2000);
    }
    async function autoNextLesson() {
      const nextLesson = await getNextLesson(book, base);
      if (nextLesson) {
        showNotification(`即将跳转到下一课：${nextLesson.title}`);
        setTimeout(() => {
          try {
            const nextId = `${book}/${nextLesson.filename}`;
            sessionStorage.setItem('nce_resume', nextId);
            sessionStorage.setItem('nce_resume_play', '1');
            const map = JSON.parse(localStorage.getItem(LASTPOS_KEY) || '{}');
            map[nextId] = { t: 0, idx: 0, ts: Date.now() };
            localStorage.setItem(LASTPOS_KEY, JSON.stringify(map));
          } catch (_) { }
          window.location.href = `lesson.html#${book}/${nextLesson.filename}`;
        }, 2000);
      } else {
        showNotification('🎉 恭喜，课程库里的课都学完了！');
      }
    }
    async function resolveLessonNeighbors() {
      try {
        const lessons = await getLibrary();
        const i = lessons.findIndex(x => x.filename === base);
        if (i > 0) {
          const prev = lessons[i - 1].filename;
          prevLessonHref = `lesson.html#${book}/${prev}`;
          if (prevLessonLink) { prevLessonLink.href = prevLessonHref; prevLessonLink.style.display = ''; }
        } else { if (prevLessonLink) prevLessonLink.style.display = 'none'; }
        if (i >= 0 && i + 1 < lessons.length) {
          const next = lessons[i + 1].filename;
          nextLessonHref = `lesson.html#${book}/${next}`;
          if (nextLessonLink) { nextLessonLink.href = nextLessonHref; nextLessonLink.style.display = ''; }
        } else { if (nextLessonLink) nextLessonLink.style.display = 'none'; }
      } catch (_) {
        if (prevLessonLink) prevLessonLink.style.display = 'none';
        if (nextLessonLink) nextLessonLink.style.display = 'none';
      }
    }

    // --------------------------
    // 启动：装载音频/LRC + 断点恢复
    // --------------------------
    // 恢复保存的音量
    try {
      const savedVolume = parseFloat(localStorage.getItem('nce_volume'));
      if (!isNaN(savedVolume) && savedVolume >= 0 && savedVolume <= 1) {
        audio.volume = savedVolume;
      }
    } catch (_) { }

    // 重要：iOS 上尽早设定 preload，有助于更快拿到 metadata
    try { audio.preload = 'auto'; } catch (_) { }
    // 音频来自用户导入的本地资源（IndexedDB），以 Blob URL 装载；缺失则提示导入。
    switchToBlobSource().then((ok) => {
      if (!ok) showResourceMissing('audio');
    });

    if (window.NCE_APP && typeof NCE_APP.initSegmented === 'function') {
      try { NCE_APP.initSegmented(document); } catch (_) { }
    }

    resolveLessonNeighbors();

    let _lastEndAdjusted = false;
    function adjustLastEndIfPossible() {
      if (_lastEndAdjusted) return;
      if (!items || !items.length) return;
      const dur = Number(audio.duration);
      if (!Number.isFinite(dur) || dur <= 0) return;
      const last = items[items.length - 1];
      if (!last.end || last.end <= last.start || last.end > dur) {
        last.end = dur;
        if (idx === items.length - 1) segmentEnd = computeEnd(last);
      }
      _lastEndAdjusted = true;
    }
    audio.addEventListener('loadedmetadata', () => {
      metadataReady = true;
      adjustLastEndIfPossible();
      // 重新应用保存的播放速度（某些浏览器在 load() 后会重置 playbackRate）
      if (savedRate && audio.playbackRate !== savedRate) {
        audio.playbackRate = savedRate;
      }
    });

    function lessonId() { return `${book}/${base}`; }
    function touchRecent() {
      try {
        const id = lessonId(); const now = Date.now();
        const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
        const rest = raw.filter(x => x && x.id !== id);
        const next = [{ id, ts: now }, ...rest].slice(0, 60);
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch (_) { }
    }
    function saveLastPos() {
      try {
        const id = lessonId(); const now = Date.now();
        const map = JSON.parse(localStorage.getItem(LASTPOS_KEY) || '{}');
        map[id] = { t: Math.max(0, audio.currentTime || 0), idx: Math.max(0, idx | 0), ts: now };
        localStorage.setItem(LASTPOS_KEY, JSON.stringify(map));
      } catch (_) { }
    }

    loadLrcFromStore(book, base).then(({ meta, items: arr }) => {
      if (_resourceMissingShown) return; // 音频缺失提示已展示，保持导入引导，不渲染课文
      items = arr;
      const lessonTitle = meta.ti || base;
      titleEl.textContent = lessonTitle;
      subEl.textContent = `${meta.al || ''} ${meta.ar || ''}`.trim();

      // 更新浏览器标签页标题
      document.title = `${lessonTitle} - EchoFlow`;

      // 智能识别第一句正文的位置
      firstContentIndex = skipIntro ? findFirstContentIndex(items) : 0;
      shadowStartIndex = findFirstContentIndex(items, { skipQuestions: true });

      render();
      touchRecent();
      adjustLastEndIfPossible();

      // 加载已显示的句子记录（听力模式）
      loadRevealedSentences();
      updateListenModeUI();

      // 优先处理 Deep Link (搜索跳转)
      const deepLinkLine = parseInt(queryParams.line, 10);
      let deepLinkHandled = false;
      if (!isNaN(deepLinkLine) && deepLinkLine >= 0 && deepLinkLine < items.length) {
        idx = deepLinkLine;
        segmentEnd = endFor(items[idx]);
        deepLinkHandled = true;
        setTimeout(() => {
          highlight(idx, false);
          if (isIOSLike) {
            showNotification('点击任意处开始播放');
          } else {
            playSegment(idx, { manual: true });
          }
        }, 150);
      }

      // 从上一课或首页跳转来的自动恢复 (如果 Deep Link 未触发)
      try {
        const resumeId = sessionStorage.getItem('nce_resume');
        if (!deepLinkHandled && resumeId && resumeId === lessonId()) {
          const map = JSON.parse(localStorage.getItem(LASTPOS_KEY) || '{}');
          const pos = map[resumeId];
          if (pos) {
            let targetIdx = (Number.isInteger(pos.idx) && pos.idx >= 0 && pos.idx < items.length) ? pos.idx : 0;

            // 如果启用了跳过开头，且保存的位置在跳过区域内，则从第一句正文开始
            let targetTime = Math.max(0, pos.t || 0);
            if (skipIntro && targetIdx < firstContentIndex) {
              targetIdx = firstContentIndex;
              targetTime = items[firstContentIndex].start || 0;
            }
            if (readMode === 'shadow' && targetIdx < shadowStartIndex) {
              targetIdx = shadowStartIndex;
              targetTime = items[shadowStartIndex].start || 0;
            }

            audio.currentTime = targetTime;
            idx = targetIdx; segmentEnd = endFor(items[targetIdx]);
            if (readMode === 'shadow') shadowRepeatRemaining = shadowRepeatTotal;
            highlight(targetIdx, false);
            if (sessionStorage.getItem('nce_resume_play') === '1') {
              attemptAutoplayAndSchedule();
            }
          }
        }
      } catch (_) { }
      sessionStorage.removeItem('nce_resume');
      sessionStorage.removeItem('nce_resume_play');
    }).catch(err => {
      if (err && err.message === 'NO_LRC') {
        showResourceMissing('lrc');
      } else {
        titleEl.textContent = '无法加载课文';
        subEl.textContent = String(err);
      }
    });

    window.addEventListener('pagehide', () => { pauseForNavigation(); });
    window.addEventListener('beforeunload', () => { saveLastPos(); try { if (audioBlobUrl) URL.revokeObjectURL(audioBlobUrl); } catch (_) { } });
    window.addEventListener('hashchange', () => { window.scrollTo(0, 0); location.reload(); });
  });
})();
