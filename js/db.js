/* IndexedDB 本地存储封装 */

const DB = (() => {
  const DB_NAME = "kaoyan-helper";
  const DB_VERSION = 2;
  const STORE = "records";
  const TOMBSTORE = "tombstones";
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error("浏览器不支持 IndexedDB")); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("updatedAt", "updatedAt");
          store.createIndex("subject", "subject");
        }
        if (!db.objectStoreNames.contains(TOMBSTORE)) {
          db.createObjectStore(TOMBSTORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function withStore(mode, fn, storeName) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName || STORE, mode);
      const store = tx.objectStore(storeName || STORE);
      let result;
      try {
        result = fn(store);
        tx.oncomplete = () => resolve(result && result.result !== undefined ? result.result : undefined);
      } catch (err) {
        reject(err);
      }
      tx.onerror = () => reject(tx.error);
    });
  }

  function newId() {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  return {
    async add(record) {
      const rec = Object.assign({ id: newId(), createdAt: Date.now(), updatedAt: Date.now() }, record);
      await withStore("readwrite", (s) => s.add(rec));
      return rec;
    },
    async put(record) {
      record.updatedAt = Date.now();
      await withStore("readwrite", (s) => s.put(record));
      return record;
    },
    /* 原样写入，不刷新 updatedAt（同步合并回写用） */
    async putRaw(record) {
      if (!record || !record.id) return null;
      await withStore("readwrite", (s) => s.put(record));
      return record;
    },
    async get(id) {
      return withStore("readonly", (s) => s.get(id));
    },
    async getAll() {
      const all = await withStore("readonly", (s) => s.getAll());
      return (all || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },
    async updateAnswer(id, answer) {
      const rec = await this.get(id);
      if (!rec) return null;
      rec.answer = answer;
      return this.put(rec);
    },
    async remove(id) {
      await withStore("readwrite", (s) => s.delete(id));
    },
    /* 软删除：删记录 + 记墓碑（同步时传播删除） */
    async softDelete(id) {
      const rec = await this.get(id);
      await withStore("readwrite", (s) => s.delete(id));
      await this.putTombstone({ id, deletedAt: Date.now() });
      return rec;
    },
    /* 清空全部记录（保留墓碑，让删除同步到其他设备） */
    async clearAllSoft() {
      const all = await this.getAll();
      await withStore("readwrite", (s) => s.clear());
      const now = Date.now();
      for (const r of all) {
        await this.putTombstone({ id: r.id, deletedAt: now });
      }
      return all.length;
    },
    async clear() {
      await withStore("readwrite", (s) => s.clear());
    },
    async getTombstones() {
      const all = await withStore("readonly", (s) => s.getAll(), TOMBSTORE);
      return (all || []).sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
    },
    async putTombstone(t) {
      if (!t || !t.id) return;
      await withStore("readwrite", (s) => s.put(t), TOMBSTORE);
    },
    async clearTombstones() {
      await withStore("readwrite", (s) => s.clear(), TOMBSTORE);
    },
    async exportJSON() {
      const all = await this.getAll();
      const tombs = await this.getTombstones();
      return JSON.stringify({
        app: "kaoyan-helper", version: 2, exportedAt: new Date().toISOString(),
        records: all, tombstones: tombs
      }, null, 2);
    },
    async importJSON(text) {
      const data = JSON.parse(text);
      const records = Array.isArray(data) ? data : data.records;
      if (!Array.isArray(records)) throw new Error("导入文件格式不正确");
      await withStore("readwrite", (s) => {
        records.forEach((r) => {
          if (r && r.id) s.put(r);
        });
      }, STORE);
      const tombs = Array.isArray(data && data.tombstones) ? data.tombstones : [];
      for (const t of tombs) {
        if (t && t.id) await this.putTombstone(t);
      }
      return records.length;
    }
  };
})();
