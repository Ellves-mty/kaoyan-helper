/* IndexedDB 本地存储封装 */

const DB = (() => {
  const DB_NAME = "kaoyan-helper";
  const DB_VERSION = 1;
  const STORE = "records";
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
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function withStore(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let result;
      try {
        result = fn(store);
        tx.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
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
    async clear() {
      await withStore("readwrite", (s) => s.clear());
    },
    async exportJSON() {
      const all = await this.getAll();
      return JSON.stringify({ app: "kaoyan-helper", version: 1, exportedAt: new Date().toISOString(), records: all }, null, 2);
    },
    async importJSON(text) {
      const data = JSON.parse(text);
      const records = Array.isArray(data) ? data : data.records;
      if (!Array.isArray(records)) throw new Error("导入文件格式不正确");
      await withStore("readwrite", (s) => {
        records.forEach((r) => {
          if (r && r.id) s.put(r);
        });
      });
      return records.length;
    }
  };
})();
