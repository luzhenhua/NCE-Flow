/**
 * EchoFlow Search Module
 * Implements global search with lazy loading index and client-side filtering.
 */
(() => {
    const { escapeHTML, highlightText } = NCEUtils;

    // 搜索范围：用户已导入的课程（IndexedDB），在其 lrc 文本上做客户端检索。
    // 本工具不内置任何教材内容。
    let searchIndex = null;
    let isLoading = false;
    let loadFailed = false;
    let debounceTimer = null;

    // DOM Elements
    const modal = document.getElementById('searchModal');
    const trigger = document.getElementById('searchBtn');
    const closeBtn = document.getElementById('searchClose');
    const input = document.getElementById('searchInput');
    const resultsContainer = document.getElementById('searchResults');
    const clearBtn = document.getElementById('searchClear');
    const emptyState = document.getElementById('searchEmpty');
    const loadingState = document.getElementById('searchLoading');

    if (!modal || !trigger) return;

    // --------------------------
    // Core Logic
    // --------------------------

    // 从一段 lrc 文本提取可搜索的句子 [[lineIdx, en, cn], ...]
    const LINE_RE = /^((?:\[\d+:\d+(?:\.\d+)?\])+)(.*)$/;
    const META_RE = /^\[(al|ar|ti|by):(.+)\]$/i;
    function hasCJK(s) { return /[一-鿿]/.test(s); }
    function lrcToSentences(text) {
        const rows = String(text).replace(/\r/g, '').split('\n');
        const out = [];
        let ti = '';
        let lineIdx = 0;
        for (let i = 0; i < rows.length; i++) {
            const raw = rows[i].trim();
            if (!raw) continue;
            const mm = raw.match(META_RE);
            if (mm) { if (mm[1].toLowerCase() === 'ti') ti = mm[2].trim(); continue; }
            const m = raw.match(LINE_RE);
            if (!m) continue;
            const tags = m[1];
            let body = m[2].trim();
            let en = body, cn = '';
            if (body.includes('|')) { const p = body.split('|'); en = p[0].trim(); cn = (p[1] || '').trim(); }
            else if (i + 1 < rows.length) {
                const m2 = rows[i + 1].trim().match(LINE_RE);
                if (m2 && m2[1] === tags && hasCJK(m2[2].trim())) { cn = m2[2].trim(); i++; }
            }
            out.push([lineIdx, en, cn]);
            lineIdx++;
        }
        return { ti, sentences: out };
    }

    async function loadIndex() {
        if (searchIndex) return;
        if (isLoading) return;
        isLoading = true;
        loadFailed = false;
        try {
            const store = window.NCE_RESOURCES;
            if (!store) throw new Error('资源存储未就绪');
            const metas = await store.listLessons();
            const idx = [];
            for (const meta of metas) {
                if (!meta.hasLrc) continue;
                const rec = await store.getLesson(meta.book, meta.filename);
                if (!rec || !rec.lrcText) continue;
                const parsed = lrcToSentences(rec.lrcText);
                idx.push({
                    b: meta.book,
                    l: meta.filename,
                    t: meta.title || parsed.ti || meta.filename,
                    c: parsed.sentences
                });
            }
            searchIndex = idx;
        } catch (e) {
            console.error('Search index build failed:', e);
            loadFailed = true;
            loadingState.hidden = true;
            emptyState.hidden = true;
            resultsContainer.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted)">搜索暂时不可用</div>';
        } finally {
            isLoading = false;
        }
    }

    function toggleModal(show) {
        if (show) {
            modal.hidden = false;
            document.body.style.overflow = 'hidden';
            // Force repaint
            modal.offsetHeight;
            modal.classList.add('open');
            input.focus();
            setTimeout(() => input.focus(), 100);
            searchIndex = null; // 每次打开重建，纳入最新导入的课程
            loadIndex();
        } else {
            modal.classList.remove('open');
            document.body.style.overflow = '';
            // Wait for transition to finish
            setTimeout(() => {
                if (!modal.classList.contains('open')) {
                    modal.hidden = true;
                }
            }, 300);
        }
    }

    function handleSearch(query) {
        query = query.trim().toLowerCase();

        if (!query) {
            resultsContainer.innerHTML = '';
            emptyState.hidden = true;
            loadingState.hidden = true;
            return;
        }

        if (loadFailed) {
            loadingState.hidden = true;
            emptyState.hidden = true;
            resultsContainer.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted)">搜索服务暂时不可用</div>';
            return;
        }

        if (!searchIndex) {
            loadingState.hidden = false;
            // Index loading is async, retry shortly
            setTimeout(() => handleSearch(query), 100);
            return;
        }

        loadingState.hidden = true;
        const results = performSearch(query);
        renderResults(results, query);
    }

    function performSearch(query) {
        const matches = [];
        const maxResults = 50; // Limit rendering for performance

        // Search Strategy:
        // 1. Title match (higher priority)
        // 2. Content match (English or Chinese)

        for (const lesson of searchIndex) {
            if (matches.length >= maxResults) break;

            // Title Match
            if (lesson.t.toLowerCase().includes(query)) {
                matches.push({
                    type: 'title',
                    book: lesson.b,
                    lessonId: lesson.l,
                    title: lesson.t,
                    matchText: lesson.t
                });
                continue; // Don't duplicate if content also matches (optional decision)
            }

            // Content Match
            for (const [lineIdx, en, cn] of lesson.c) {
                if (matches.length >= maxResults) break;

                const enMatch = en.toLowerCase().includes(query);
                const cnMatch = cn.includes(query);

                if (enMatch || cnMatch) {
                    matches.push({
                        type: 'sentence',
                        book: lesson.b,
                        lessonId: lesson.l,
                        title: lesson.t,
                        lineIdx: lineIdx,
                        en: en,
                        cn: cn,
                        matchEn: enMatch, // boolean
                        matchCn: cnMatch  // boolean
                    });
                }
            }
        }
        return matches;
    }

    function renderResults(results, query) {
        if (results.length === 0) {
            resultsContainer.innerHTML = '';
            emptyState.hidden = false;
            return;
        }

        emptyState.hidden = true;

        function safeHighlight(text, q) {
            return highlightText(escapeHTML(String(text || '')), q);
        }

        const html = results.map(item => {
            const link = `lesson.html#${item.book}/${item.lessonId}${item.type === 'sentence' ? '?line=' + item.lineIdx : ''}`;

            let contentHtml = '';
            if (item.type === 'sentence') {
                const enHtml = item.matchEn ? safeHighlight(item.en, query) : escapeHTML(String(item.en || ''));
                const cnHtml = item.matchCn ? safeHighlight(item.cn, query) : escapeHTML(String(item.cn || ''));
                contentHtml = `
          <div class="search-item-content">
            <div style="margin-bottom:2px;color:var(--text)">${enHtml}</div>
            <div style="font-size:13px">${cnHtml}</div>
          </div>
        `;
            } else {
                contentHtml = `<div class="search-item-content">包含匹配的标题</div>`;
            }

            const titleHtml = item.type === 'title'
                ? safeHighlight(item.title, query)
                : escapeHTML(String(item.title || ''));

            return `
        <a href="${link}" class="search-item" onclick="document.getElementById('searchModal').click()"> <!-- Hack to close modal implicitly? No better add explicit handler -->
          <div class="search-item-header">
            <div class="search-item-tag">${escapeHTML(String(item.lessonId || ''))}</div>
          </div>
          <div class="search-item-title" style="margin-bottom:6px">${titleHtml}</div>
          ${contentHtml}
        </a>
      `;
        }).join('');

        resultsContainer.innerHTML = html;
    }

    // --------------------------
    // Event Listeners
    // --------------------------

    trigger.addEventListener('click', () => toggleModal(true));

    closeBtn.addEventListener('click', () => toggleModal(false));

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.classList.contains('search-container')) {
            toggleModal(false);
        }
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.hidden) {
            toggleModal(false);
        }
        // Shortcut: Cmd+K or Ctrl+K to open
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            toggleModal(true);
        }
    });

    input.addEventListener('input', (e) => {
        const val = e.target.value;
        clearBtn.hidden = !val;

        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => handleSearch(val), 150);
    });

    clearBtn.addEventListener('click', () => {
        input.value = '';
        input.focus();
        clearBtn.hidden = true;
        handleSearch('');
    });

    // Handle link clicks inside modal to close it (though navigation happens anyway)
    // Not strictly necessary if page reloads/navigates, but good for single page feel
})();
