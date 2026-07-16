/**
 * EchoFlow · utils.js · Shared pure-function utilities
 * UMD: browser exposes window.NCEUtils, Node.js uses module.exports
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NCEUtils = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── lesson.js helpers ──

  function timeTagsToSeconds(tags) {
    var m = /\[(\d+):(\d+(?:\.\d+)?)\]/.exec(tags);
    if (!m) return 0;
    return parseInt(m[1], 10) * 60 + parseFloat(m[2]);
  }

  function hasCJK(s) {
    return /[\u3400-\u9FFF\uF900-\uFAFF]/.test(s);
  }

  var KEY_DISPLAY_NAMES = {
    ' ': 'Space',
    'Spacebar': 'Space',
    'ArrowUp': '↑',
    'ArrowDown': '↓',
    'ArrowLeft': '←',
    'ArrowRight': '→',
    'Enter': '↵',
    'Escape': 'Esc',
    'Backspace': '⌫',
    'Tab': 'Tab',
    'Delete': 'Del'
  };

  function getKeyDisplayName(key) {
    if (!key) return '?';
    if (KEY_DISPLAY_NAMES[key]) return KEY_DISPLAY_NAMES[key];
    if (key.length === 1) return key.toUpperCase();
    return key;
  }

  function findConflict(shortcuts, action, newKey) {
    var normalizedNew = newKey.toLowerCase();
    for (var act in shortcuts) {
      if (shortcuts.hasOwnProperty(act) && act !== action && shortcuts[act].key.toLowerCase() === normalizedNew) {
        return act;
      }
    }
    return null;
  }

  function normalizeShadowRepeat(value) {
    var n = parseInt(value, 10);
    if (!Number.isFinite(n)) return 2;
    return Math.min(9, Math.max(1, n));
  }

  function normalizeAutoStopCount(value) {
    var n = parseInt(value, 10);
    if (!Number.isFinite(n)) return 3;
    return Math.min(50, Math.max(1, n));
  }

  function shouldSkipLine(item, index, opts) {
    opts = opts || {};
    var en = item.en.trim();
    var cn = item.cn ? item.cn.trim() : '';
    var skipQuestions = !!opts.skipQuestions;
    if (!en) return true;

    if (/^Lesson\s+\d+$/i.test(en) && /^第\d+课$/.test(cn)) {
      return true;
    }

    if (/Listen to the tape/i.test(en)) {
      return true;
    }

    if (cn && en.length < 80 && cn.length < 80) {
      if (item.start < 7) {
        return true;
      }
      if (item.start < 10 && !en.endsWith('?')) {
        return true;
      }
    }

    var isQuestion = en.endsWith('?') || cn.endsWith('？');
    if (skipQuestions && isQuestion && item.start < 20 && index < 6) {
      return true;
    }

    return false;
  }

  function findFirstContentIndex(items, opts) {
    opts = opts || {};
    if (!items || items.length === 0) return 0;

    var checkLimit = Math.min(10, items.length);
    var skipCount = 0;

    for (var i = 0; i < checkLimit; i++) {
      if (shouldSkipLine(items[i], i, opts)) {
        skipCount++;
      } else {
        if (skipCount > 0) {
          return i;
        } else {
          return 0;
        }
      }
    }

    return 0;
  }

  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    var mins = Math.floor(seconds / 60);
    var secs = Math.floor(seconds % 60);
    return mins + ':' + String(secs).padStart(2, '0');
  }

  function countWords(text) {
    if (!text) return 0;
    var parts = text.trim().split(/\s+/).filter(Boolean);
    return parts.length;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function seekLooksOk(target, actual, eps) {
    eps = eps || 0.25;
    if (!Number.isFinite(target) || target <= 0.5) return true;
    return Math.abs((actual || 0) - target) <= eps;
  }

  // ── favorites.js helpers ──

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function clampRate(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) return 1.0;
    return Math.max(0.5, Math.min(2.5, n));
  }

  function normalizeLoop(v) {
    return (v === 'off' || v === 'one' || v === 'all') ? v : 'off';
  }

  function rateLabel(r) {
    var s = (Math.round(r * 100) % 25 === 0) ? String(r) : r.toFixed(2);
    return s + 'x';
  }

  function loopLabel(mode) {
    if (mode === 'one') return '循环：单句';
    if (mode === 'all') return '循环：全清单';
    return '循环：关';
  }

  var NOVELTY_VOICE_RE = /\b(bad news|good news|bahh|bells|boing|bubbles|cellos|jester|junior|whisper|trinoids?)\b/i;

  function isNoveltyVoiceName(name) {
    var n = String(name || '').trim();
    if (!n) return false;
    return NOVELTY_VOICE_RE.test(n);
  }

  var PREFERRED_VOICE_NAMES = [
    'Siri', 'Samantha', 'Alex', 'Daniel', 'Karen',
    'Tessa', 'Moira', 'Oliver', 'Arthur', 'Aaron',
    'Allison', 'Ava'
  ];

  function preferredVoiceBonus(name) {
    var n = String(name || '');
    var idx = PREFERRED_VOICE_NAMES.findIndex(function (k) {
      return k && (n === k || n.startsWith(k + ' '));
    });
    return idx >= 0 ? (220 - idx * 10) : 0;
  }

  function voiceScore(v, opts) {
    opts = opts || {};
    var preferredLangPrefix = opts.preferredLangPrefix || 'en';
    if (!v) return -1e9;
    var name = String(v.name || '');
    var lang = String(v.lang || '').toLowerCase();
    var s = 0;
    if (lang.startsWith(preferredLangPrefix)) s += 120;
    else if (preferredLangPrefix === 'en' && lang.startsWith('en')) s += 120;
    if (v.localService) s += 30;
    if (v.default) s += 20;
    s += preferredVoiceBonus(name);
    if (isNoveltyVoiceName(name)) s -= 1000;
    return s;
  }

  // ── search.js helpers ──

  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function highlightText(text, query) {
    if (!query) return text;
    var regex = new RegExp('(' + escapeRegExp(query) + ')', 'gi');
    return text.replace(regex, '<span class="search-highlight">$1</span>');
  }

  // ── Public API ──

  return {
    timeTagsToSeconds: timeTagsToSeconds,
    hasCJK: hasCJK,
    KEY_DISPLAY_NAMES: KEY_DISPLAY_NAMES,
    getKeyDisplayName: getKeyDisplayName,
    findConflict: findConflict,
    normalizeShadowRepeat: normalizeShadowRepeat,
    normalizeAutoStopCount: normalizeAutoStopCount,
    shouldSkipLine: shouldSkipLine,
    findFirstContentIndex: findFirstContentIndex,
    formatTime: formatTime,
    countWords: countWords,
    clamp: clamp,
    seekLooksOk: seekLooksOk,
    escapeHTML: escapeHTML,
    clampRate: clampRate,
    normalizeLoop: normalizeLoop,
    rateLabel: rateLabel,
    loopLabel: loopLabel,
    NOVELTY_VOICE_RE: NOVELTY_VOICE_RE,
    PREFERRED_VOICE_NAMES: PREFERRED_VOICE_NAMES,
    isNoveltyVoiceName: isNoveltyVoiceName,
    preferredVoiceBonus: preferredVoiceBonus,
    voiceScore: voiceScore,
    escapeRegExp: escapeRegExp,
    highlightText: highlightText
  };
});
