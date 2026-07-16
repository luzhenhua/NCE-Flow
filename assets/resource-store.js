/**
 * EchoFlow · resource-store.js
 * 用户导入的课程资源（音频 Blob + LRC 文本）本地持久化封装。
 * 存储介质：IndexedDB（音频文件较大，localStorage 无法容纳）。
 *
 * 记录结构（object store "lessons"，keyPath "id"）：
 *   {
 *     id: `${book}/${filename}`,   // book 为固定命名空间 "lib"（课程库平铺不分组）
 *     book: "lib",
 *     filename: "01 Morning Dialogue",
 *     title: "Morning Dialogue",   // 取自 lrc [ti:]，否则为文件名
 *     audioBlob: Blob,             // audio/mpeg
 *     lrcText: "string",           // 原始 .lrc 文本
 *     importedAt: <ms>
 *   }
 *
 * 暴露为全局 window.NCE_RESOURCES。
 */
(function () {
  'use strict';

  const DB_NAME = 'echoflow-resources';
  const DB_VERSION = 1;
  const STORE = 'lessons';

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'id' });
          os.createIndex('book', 'book', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(mode) {
    return openDB().then((db) => db.transaction(STORE, mode).objectStore(STORE));
  }

  function reqToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function makeId(book, filename) {
    return `${book}/${filename}`;
  }

  /** 写入 / 覆盖一课资源。record 需含 book、filename；可含 title、audioBlob、lrcText。 */
  async function putLesson(record) {
    if (!record || !record.book || !record.filename) {
      throw new Error('putLesson 需要 book 与 filename');
    }
    const store = await tx('readwrite');
    const full = Object.assign(
      { id: makeId(record.book, record.filename), importedAt: Date.now() },
      record
    );
    await reqToPromise(store.put(full));
    return full.id;
  }

  /** 读取一课（含 Blob 与 lrcText）。找不到返回 null。 */
  async function getLesson(book, filename) {
    const store = await tx('readonly');
    const rec = await reqToPromise(store.get(makeId(book, filename)));
    return rec || null;
  }

  /** 是否已导入某课。 */
  async function hasLesson(book, filename) {
    const store = await tx('readonly');
    const key = await reqToPromise(store.getKey(makeId(book, filename)));
    return key != null;
  }

  /**
   * 列出已导入课程的轻量元信息（不含 Blob，避免一次性载入大量音频）。
   * 返回 [{ id, book, filename, title, importedAt, hasAudio, hasLrc }]。
   * 可传 book 过滤。
   */
  async function listLessons(book) {
    const store = await tx('readonly');
    const all = await reqToPromise(store.getAll());
    return all
      .filter((r) => !book || r.book === book)
      .map((r) => ({
        id: r.id,
        book: r.book,
        filename: r.filename,
        title: r.title || '',
        importedAt: r.importedAt || 0,
        hasAudio: !!r.audioBlob,
        hasLrc: !!r.lrcText
      }));
  }

  /** 已导入课程总数。 */
  async function count() {
    const store = await tx('readonly');
    return await reqToPromise(store.count());
  }

  async function deleteLesson(book, filename) {
    const store = await tx('readwrite');
    await reqToPromise(store.delete(makeId(book, filename)));
  }

  async function clearAll() {
    const store = await tx('readwrite');
    await reqToPromise(store.clear());
  }

  window.NCE_RESOURCES = {
    putLesson,
    getLesson,
    hasLesson,
    listLessons,
    count,
    deleteLesson,
    clearAll,
    makeId
  };
})();
