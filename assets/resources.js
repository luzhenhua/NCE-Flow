/**
 * EchoFlow · resources.js
 * 用户自带资源导入：把本地的 mp3 + lrc 文件配对后存入 IndexedDB（NCE_RESOURCES）。
 *
 * 三种导入方式：
 *   1. 文件夹批量导入   <input type="file" webkitdirectory>
 *   2. 多选文件导入     <input type="file" multiple accept=".mp3,.lrc">
 *   3. zip 包导入       <input type="file" accept=".zip">（原生 DecompressionStream 解压，无第三方库）
 *
 * 模型：课程库平铺不分组。存储命名空间固定为 LIB（store 的 book 字段），
 *       key = `LIB/${basename}`；课名优先取 lrc 的 [ti:] 标签，否则用文件名。
 *
 * 暴露为全局 window.NCE_IMPORT。
 */
(function () {
  'use strict';

  // 课程库命名空间（对用户不可见，仅作存储 key 与路由前缀）
  var LIB = 'lib';

  // ---------- 原生 ZIP 读取（仅读取，支持 store(0) 与 deflate(8)） ----------
  async function unzip(arrayBuffer) {
    const dv = new DataView(arrayBuffer);
    const u8 = new Uint8Array(arrayBuffer);
    const eocd = findEOCD(dv);
    if (eocd < 0) throw new Error('不是有效的 zip 文件');
    const cdOffset = dv.getUint32(eocd + 16, true);
    const cdCount = dv.getUint16(eocd + 10, true);

    const entries = [];
    let p = cdOffset;
    for (let i = 0; i < cdCount; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localOffset = dv.getUint32(p + 42, true);
      const name = utf8Decode(u8.subarray(p + 46, p + 46 + nameLen));
      entries.push({ name, method, compSize, localOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }

    const out = [];
    for (const e of entries) {
      if (e.name.endsWith('/')) continue;
      const lh = e.localOffset;
      if (dv.getUint32(lh, true) !== 0x04034b50) continue;
      const lNameLen = dv.getUint16(lh + 26, true);
      const lExtraLen = dv.getUint16(lh + 28, true);
      const dataStart = lh + 30 + lNameLen + lExtraLen;
      const comp = u8.subarray(dataStart, dataStart + e.compSize);
      let data;
      if (e.method === 0) {
        data = comp;
      } else if (e.method === 8) {
        data = await inflateRaw(comp);
      } else {
        continue;
      }
      out.push({ name: e.name, data });
    }
    return out;
  }

  function findEOCD(dv) {
    const len = dv.byteLength;
    const min = Math.max(0, len - 22 - 65535);
    for (let i = len - 22; i >= min; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) return i;
    }
    return -1;
  }

  async function inflateRaw(u8) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('当前浏览器不支持解压 zip，请改用文件夹或选择文件导入');
    }
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  function utf8Decode(u8) {
    return new TextDecoder('utf-8').decode(u8);
  }

  // ---------- 文件名 / 配对 ----------
  function baseName(path) {
    const slash = path.lastIndexOf('/');
    const name = slash >= 0 ? path.slice(slash + 1) : path;
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
  }
  function extOf(path) {
    const dot = path.lastIndexOf('.');
    return dot >= 0 ? path.slice(dot + 1).toLowerCase() : '';
  }
  function kindOf(path) {
    const ext = extOf(path);
    if (ext === 'mp3' || ext === 'm4a' || ext === 'ogg' || ext === 'wav') return 'audio';
    if (ext === 'lrc') return 'lrc';
    return '';
  }

  /** 把一组 {path, kind, getBlob, getText} 按 basename 配对为课。 */
  function pairByBasename(files) {
    const map = new Map();
    for (const f of files) {
      const key = baseName(f.path);
      if (!map.has(key)) map.set(key, { basename: key });
      const entry = map.get(key);
      if (f.kind === 'audio') entry.audio = f;
      else if (f.kind === 'lrc') entry.lrc = f;
    }
    return Array.from(map.values());
  }

  // 从 lrc 文本提取 [ti:] 课名（找不到返回空串）
  function titleFromLrc(text) {
    const m = String(text).match(/^\[ti:(.+?)\]\s*$/im);
    return m ? m[1].trim() : '';
  }

  // ---------- 入库 ----------
  /**
   * pairs: [{ basename, audio:{getBlob}, lrc:{getText} }]
   * onProgress(done, total, label)
   * 返回 { imported, skipped, errors:[] }
   */
  async function importPairs(pairs, onProgress) {
    const store = window.NCE_RESOURCES;
    if (!store) throw new Error('资源存储未就绪');
    let imported = 0;
    let skipped = 0;
    const errors = [];
    let done = 0;
    for (const p of pairs) {
      done++;
      try {
        if (!p.audio && !p.lrc) { skipped++; continue; }
        const rec = { book: LIB, filename: p.basename, title: '' };
        if (p.lrc) {
          rec.lrcText = await p.lrc.getText();
          rec.title = titleFromLrc(rec.lrcText);
        }
        if (p.audio) rec.audioBlob = await p.audio.getBlob();
        if (!rec.title) rec.title = p.basename;
        // 若此前已导入过同名课（如先导 lrc 后补音频），合并而不是覆盖丢字段
        const prev = await store.getLesson(LIB, p.basename);
        if (prev) {
          if (!rec.audioBlob && prev.audioBlob) rec.audioBlob = prev.audioBlob;
          if (!rec.lrcText && prev.lrcText) { rec.lrcText = prev.lrcText; rec.title = prev.title || rec.title; }
        }
        await store.putLesson(rec);
        imported++;
        if (onProgress) onProgress(done, pairs.length, rec.title);
      } catch (e) {
        skipped++;
        errors.push(`${p.basename}：${e.message || e}`);
      }
    }
    return { imported, skipped, errors };
  }

  // ---------- 三种入口 ----------
  function fileEntry(file) {
    const kind = kindOf(file.name);
    if (!kind) return null;
    const path = file.webkitRelativePath || file.name;
    return {
      path,
      kind,
      getBlob: async () => file,
      getText: async () => await file.text()
    };
  }

  function pairsFromFileList(fileList) {
    const files = [];
    for (const f of fileList) {
      const e = fileEntry(f);
      if (e) files.push(e);
    }
    return pairByBasename(files);
  }

  async function pairsFromZip(arrayBuffer) {
    const entries = await unzip(arrayBuffer);
    const files = [];
    for (const en of entries) {
      const kind = kindOf(en.name);
      if (!kind) continue;
      const data = en.data;
      files.push({
        path: en.name,
        kind,
        getBlob: async () => new Blob([data], { type: 'audio/mpeg' }),
        getText: async () => utf8Decode(data)
      });
    }
    return pairByBasename(files);
  }

  window.NCE_IMPORT = {
    LIB,
    pairsFromFileList,
    pairsFromZip,
    importPairs,
    async importFileList(fileList, onProgress) {
      return importPairs(pairsFromFileList(fileList), onProgress);
    },
    async importZipFile(file, onProgress) {
      const buf = await file.arrayBuffer();
      const pairs = await pairsFromZip(buf);
      return importPairs(pairs, onProgress);
    }
  };
})();
