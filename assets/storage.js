// NCE-Flow 共享存储层
// 集中管理用户数据键清单、导出/导入备份，并提供通用的 localStorage 读写封装。
// 暴露 window.NCE_STORAGE，供 lesson / favorites 等页面复用（探测到后端时可在此扩展为读写服务端）。
(() => {
  // --------------------------
  // 数据键清单（导出/导入的唯一来源）
  // --------------------------
  const DATA_FORMAT = 1;
  const USER_DATA_KEYS = [
    'nce_sentence_favs_v1', // 句子收藏
    'nce_favs',             // 课文收藏
    'nce_recents',          // 最近播放
    'nce_lastpos',          // 播放位置
    'nce_revealed_sentences' // 已揭示句子（听读模式）
  ];
  const SETTINGS_KEYS = [
    'readMode',             // 阅读模式
    'autoFollow',           // 自动跟随
    'afterPlay',            // 播完后动作
    'skipIntro',            // 跳过开头
    'shadowRepeatCount',    // 跟读循环次数
    'shadowGapMode',        // 跟读间隔
    'autoStopEnabled',      // 自动关闭开关
    'autoStopCount',        // 自动关闭课数
    'audioPlaybackRate',    // 播放速度
    'nce_volume',           // 音量
    'nce_shortcuts',        // 自定义快捷键
    'nce_lang_mode',        // 语言模式
    'nce_theme'             // 主题
  ];
  const TTS_KEYS = [
    'nce_tts_rate',         // TTS 语速
    'nce_tts_loop',         // TTS 循环
    'nce_tts_voice'         // TTS 音色
  ];
  const ALL_DATA_KEYS = [...USER_DATA_KEYS, ...SETTINGS_KEYS, ...TTS_KEYS];
  const JSON_KEYS = new Set([
    'nce_sentence_favs_v1', 'nce_favs', 'nce_recents',
    'nce_lastpos', 'nce_revealed_sentences', 'nce_shortcuts'
  ]);

  // --------------------------
  // 通用读写封装（地基：供新代码与后续接入后端时复用）
  // 沿用项目既有的静默失败风格（try/catch 后继续）。
  // --------------------------
  function get(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }
  function set(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (_) { return false; }
  }
  function remove(key) {
    try { localStorage.removeItem(key); } catch (_) { }
  }
  function getJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? (fallback ?? null) : JSON.parse(raw);
    } catch (_) { return fallback ?? null; }
  }
  function setJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; }
  }

  // --------------------------
  // 轻量提示（与各页面 showNotification 视觉一致；可被 bindDataControls 覆盖）
  // --------------------------
  let _notify = (message) => {
    const n = document.createElement('div');
    n.style.cssText = `
      position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
      background: var(--surface); color: var(--text); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 12px 20px; box-shadow: var(--shadow);
      z-index: 1000; backdrop-filter: saturate(120%) blur(10px); animation: slideDown 0.3s ease-out;
    `;
    n.textContent = message;
    document.body.appendChild(n);
    setTimeout(() => {
      n.style.animation = 'slideUp 0.3s ease-out';
      setTimeout(() => { if (n.parentNode) document.body.removeChild(n); }, 300);
    }, 2000);
  };
  function notify(message) { _notify(message); }

  // --------------------------
  // 数据导出 / 导入
  // --------------------------
  function buildPackage() {
    const pkg = {
      meta: { app: 'NCE-Flow', version: '1.8.0', exportedAt: new Date().toISOString(), format: DATA_FORMAT },
      userData: {},
      settings: {},
      ttsSettings: {}
    };
    const collect = (keys, target) => {
      keys.forEach(k => {
        const v = localStorage.getItem(k);
        if (v == null) return;
        try { target[k] = JSON_KEYS.has(k) ? JSON.parse(v) : v; } catch (_) { target[k] = v; }
      });
    };
    collect(USER_DATA_KEYS, pkg.userData);
    collect(SETTINGS_KEYS, pkg.settings);
    collect(TTS_KEYS, pkg.ttsSettings);
    return pkg;
  }

  function exportData() {
    const pkg = buildPackage();
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    a.href = url;
    a.download = `NCE-Flow-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    notify('备份文件已导出');
  }

  function validateImportData(pkg) {
    if (!pkg || typeof pkg !== 'object') return { ok: false, error: '无效的文件格式' };
    if (!pkg.meta || pkg.meta.app !== 'NCE-Flow') return { ok: false, error: '该文件不是 NCE-Flow 备份文件' };
    if (pkg.meta.format > DATA_FORMAT) return { ok: false, error: '该备份文件版本过高，请升级应用后重试' };

    const parts = [];
    const ud = pkg.userData || {};
    const st = pkg.settings || {};
    const ts = pkg.ttsSettings || {};
    // 统计用户数据
    if (ud['nce_sentence_favs_v1']) {
      const arr = Array.isArray(ud['nce_sentence_favs_v1']) ? ud['nce_sentence_favs_v1'] : [];
      if (arr.length) parts.push(`${arr.length} 条句子收藏`);
    }
    if (ud['nce_favs']) {
      const arr = Array.isArray(ud['nce_favs']) ? ud['nce_favs'] : [];
      if (arr.length) parts.push(`${arr.length} 课课文收藏`);
    }
    if (ud['nce_recents']) {
      const arr = Array.isArray(ud['nce_recents']) ? ud['nce_recents'] : [];
      if (arr.length) parts.push(`${arr.length} 条最近播放`);
    }
    if (ud['nce_lastpos'] && typeof ud['nce_lastpos'] === 'object') {
      const n = Object.keys(ud['nce_lastpos']).length;
      if (n) parts.push(`${n} 课播放进度`);
    }
    // 统计设置项
    const settingsCount = Object.keys(st).filter(k => SETTINGS_KEYS.includes(k)).length;
    if (settingsCount) parts.push(`${settingsCount} 项设置`);
    // 统计 TTS 设置
    const ttsCount = Object.keys(ts).filter(k => TTS_KEYS.includes(k)).length;
    if (ttsCount) parts.push(`${ttsCount} 项朗读配置`);

    return { ok: true, summary: parts.length ? parts.join('，') : '空备份（无数据）' };
  }

  function showImportConfirmation(pkg, summary) {
    // 移除已有弹窗
    const existing = document.getElementById('dataConfirmOverlay');
    if (existing) existing.remove();

    const exportedAt = pkg.meta.exportedAt ? new Date(pkg.meta.exportedAt).toLocaleString('zh-CN') : '未知时间';

    const overlay = document.createElement('div');
    overlay.id = 'dataConfirmOverlay';
    overlay.className = 'data-confirm-overlay';
    overlay.innerHTML = `
      <div class="data-confirm-card">
        <h3 class="data-confirm-title">确认导入</h3>
        <p class="data-confirm-body">导入将覆盖当前所有数据，此操作不可撤销。<br>备份时间：${exportedAt}</p>
        <div class="data-confirm-summary">${summary}</div>
        <div class="data-confirm-actions">
          <button class="text-btn" id="dataConfirmCancel">取消</button>
          <button class="primary-btn" id="dataConfirmOk">确认导入</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const cancel = overlay.querySelector('#dataConfirmCancel');
    const ok = overlay.querySelector('#dataConfirmOk');
    const close = () => overlay.remove();

    cancel.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    ok.addEventListener('click', () => { close(); applyImportData(pkg); });
  }

  function writePackage(pkg) {
    const write = (keys, section) => {
      if (!section || typeof section !== 'object') return;
      keys.forEach(k => {
        if (!(k in section)) return;
        const v = section[k];
        try {
          localStorage.setItem(k, JSON_KEYS.has(k) ? JSON.stringify(v) : String(v));
        } catch (_) { }
      });
    };
    write(USER_DATA_KEYS, pkg.userData);
    write(SETTINGS_KEYS, pkg.settings);
    write(TTS_KEYS, pkg.ttsSettings);
  }

  function applyImportData(pkg) {
    writePackage(pkg);
    notify('数据导入成功，即将刷新页面…');
    setTimeout(() => location.reload(), 1500);
  }

  function handleImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let pkg;
      try { pkg = JSON.parse(reader.result); } catch (_) {
        notify('文件解析失败，请选择有效的 JSON 文件');
        return;
      }
      const result = validateImportData(pkg);
      if (!result.ok) { notify(result.error); return; }
      showImportConfirmation(pkg, result.summary);
    };
    reader.onerror = () => notify('文件读取失败，请重试');
    reader.readAsText(file);
  }

  // --------------------------
  // 便捷接线：把页面上的导出/导入按钮与文件选择器接上，避免各页面重复绑定
  // --------------------------
  function bindDataControls(opts) {
    opts = opts || {};
    const { exportBtn, importBtn, importFile, notify: customNotify } = opts;
    if (typeof customNotify === 'function') _notify = customNotify;
    if (exportBtn) exportBtn.addEventListener('click', exportData);
    if (importBtn) importBtn.addEventListener('click', () => { if (importFile) importFile.click(); });
    if (importFile) importFile.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      handleImportFile(f);
      importFile.value = ''; // 允许重复选择同一文件
    });
  }

  // --------------------------
  // 服务端同步（仅当探测到后端时启用；纯静态部署 / 无后端时完全不介入）
  // 流程：探测特征头 x-nce-storage → 按 meta.exportedAt 时间戳拉取（较新则应用并刷新一次）
  //       → monkey-patch localStorage.setItem，数据变化时 debounce 整包上传。
  // --------------------------
  const SYNC = (() => {
    const API = '/api/userData';
    const TOKEN_KEY = 'nce_sync_token';     // 本地访问令牌，不参与同步
    const LAST_SYNC_KEY = 'nce_last_sync';  // 本地记录的服务端时间戳，不参与同步
    const FEATURE_HEADER = 'x-nce-storage';
    const DEBOUNCE_MS = 2000;
    const MAX_BYTES = 5 * 1024 * 1024;

    let backend = false;   // 是否探测到后端
    let applying = false;  // 应用服务端数据期间，抑制自身 setItem 触发上传
    let armed = false;     // 是否已安装上传钩子
    let pushTimer = null;

    function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; } }
    function authHeaders(extra) {
      const h = extra ? Object.assign({}, extra) : {};
      const t = getToken();
      if (t) h['X-NCE-Token'] = t;
      return h;
    }
    function getLastSync() { try { return parseInt(localStorage.getItem(LAST_SYNC_KEY) || '0', 10) || 0; } catch (_) { return 0; } }
    function setLastSync(ts) { try { localStorage.setItem(LAST_SYNC_KEY, String(ts)); } catch (_) { } }
    function localHasData() { try { return ALL_DATA_KEYS.some(k => localStorage.getItem(k) != null); } catch (_) { return false; } }
    function isServerEmpty(pkg) {
      if (!pkg || !pkg.meta) return true;
      const n = (o) => (o ? Object.keys(o).length : 0);
      return (n(pkg.userData) + n(pkg.settings) + n(pkg.ttsSettings)) === 0;
    }

    async function pull() {
      let res;
      try { res = await fetch(API, { headers: authHeaders(), cache: 'no-store' }); }
      catch (_) { return; }                          // 网络错误 → 当作无后端，不介入
      if (!res.headers.has(FEATURE_HEADER)) return;  // 无特征头（纯静态返回 index.html）→ 回退 localStorage
      backend = true;
      if (res.status === 401) { promptForToken(); return; }
      if (!res.ok) { armUploadHooks(); return; }
      let pkg = null;
      try { pkg = await res.json(); } catch (_) { pkg = null; }
      reconcile(pkg);
      armUploadHooks();
    }

    function reconcile(pkg) {
      if (isServerEmpty(pkg)) {
        if (localHasData()) pushNow();   // 首次：用本地播种服务端；绝不用空覆盖本地
        return;
      }
      const serverTs = (pkg.meta && Date.parse(pkg.meta.exportedAt)) || 0;
      if (serverTs > getLastSync()) {
        applying = true;
        writePackage(pkg);
        setLastSync(serverTs);
        applying = false;
        location.reload();               // 仅刷新一次；刷新后 serverTs==lastSync 不再触发
      }
    }

    async function pushNow() {
      if (!backend) return;
      const pkg = buildPackage();
      const ts = Date.parse(pkg.meta.exportedAt) || Date.now();
      let body;
      try { body = JSON.stringify(pkg); } catch (_) { return; }
      if (body.length > MAX_BYTES) return;
      try {
        const res = await fetch(API, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body });
        if (res.status === 401) { promptForToken(); return; }
        if (res.ok) setLastSync(ts);
      } catch (_) { }
    }

    function schedulePush() {
      if (!backend || applying) return;
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = setTimeout(() => { pushTimer = null; pushNow(); }, DEBOUNCE_MS);
    }

    function flush() {
      if (!backend || !pushTimer) return;   // 仅当有待发送的变更时才在卸载时补发
      clearTimeout(pushTimer);
      pushTimer = null;
      const pkg = buildPackage();
      let body;
      try { body = JSON.stringify(pkg); } catch (_) { return; }
      if (body.length > MAX_BYTES) return;
      try {
        fetch(API, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body, keepalive: true });
        setLastSync(Date.parse(pkg.meta.exportedAt) || Date.now());
      } catch (_) { }
    }

    function armUploadHooks() {
      if (armed) return;
      armed = true;
      const orig = localStorage.setItem.bind(localStorage);
      localStorage.setItem = function (k, v) {
        orig(k, v);
        if (applying) return;
        if (k === LAST_SYNC_KEY || k === TOKEN_KEY) return;
        if (ALL_DATA_KEYS.indexOf(k) === -1) return;  // 仅同步用户数据键；pwa/版权/主题探测等放行
        schedulePush();
      };
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
      window.addEventListener('pagehide', flush);
    }

    function promptForToken() {
      if (document.getElementById('nceSyncTokenOverlay')) return;
      const overlay = document.createElement('div');
      overlay.id = 'nceSyncTokenOverlay';
      overlay.className = 'data-confirm-overlay';
      overlay.innerHTML = `
        <div class="data-confirm-card">
          <h3 class="data-confirm-title">需要同步令牌</h3>
          <p class="data-confirm-body">此服务器启用了访问令牌，请输入以同步数据。</p>
          <input type="password" id="nceSyncTokenInput" placeholder="同步令牌"
            style="width:100%;box-sizing:border-box;margin:10px 0;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);">
          <div class="data-confirm-actions">
            <button class="text-btn" id="nceSyncTokenCancel">取消</button>
            <button class="primary-btn" id="nceSyncTokenOk">确定并同步</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      const input = overlay.querySelector('#nceSyncTokenInput');
      const close = () => overlay.remove();
      overlay.querySelector('#nceSyncTokenCancel').addEventListener('click', close);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      overlay.querySelector('#nceSyncTokenOk').addEventListener('click', () => {
        const t = ((input && input.value) || '').trim();
        if (t) { try { localStorage.setItem(TOKEN_KEY, t); } catch (_) { } }
        close();
        backend = false;  // 重新探测；保留 armed，避免重复包裹 setItem
        pull();
      });
      if (input) setTimeout(() => input.focus(), 0);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pull);
    else pull();

    return {
      pull, pushNow, flush, getToken,
      setToken: (t) => { try { localStorage.setItem(TOKEN_KEY, t || ''); } catch (_) { } }
    };
  })();

  window.NCE_STORAGE = {
    DATA_FORMAT,
    KEYS: { USER_DATA: USER_DATA_KEYS, SETTINGS: SETTINGS_KEYS, TTS: TTS_KEYS, ALL: ALL_DATA_KEYS, JSON_SET: JSON_KEYS },
    get, set, remove, getJSON, setJSON,
    buildPackage, writePackage,
    exportData, validateImportData, handleImportFile, bindDataControls,
    notify, SYNC
  };
})();
