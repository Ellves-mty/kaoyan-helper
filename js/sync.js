/* GitHub Gist 跨设备同步（浏览器直连，已实测支持 CORS） */

const Sync = (() => {
  const GIST_DESC = "考研解题助手同步数据";
  const GIST_FILE = "kaoyan-helper-data.json";
  const GIST_UA = "kaoyan-helper-pwa";

  function gistBase() {
    return window.KH_GIST_BASE || "https://api.github.com";
  }

  function getStatus() {
    return JSON.parse(localStorage.getItem("kh_sync_status") || "null");
  }

  function setStatus(st) {
    localStorage.setItem("kh_sync_status", JSON.stringify(st));
  }

  async function gh(path, options, token) {
    options = options || {};
    const res = await fetch(gistBase() + path, Object.assign({}, options, {
      headers: Object.assign({
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": GIST_UA
      }, options.headers || {})
    }));
    if (res.status === 404 && options.notFoundOk) return null;
    if (!res.ok) {
      let msg = "HTTP " + res.status;
      try {
        const j = await res.json();
        msg = j.message || msg;
      } catch (e) {}
      if (/bad credentials|must have the gist scope|scope/i.test(msg)) {
        msg = "Token 无效或缺少 gist 权限（请在 GitHub 重新生成，勾选 gist）";
      }
      throw new Error(msg);
    }
    return res.json();
  }

  /* 查找已绑定的 Gist；没有则创建。返回 { id, created } */
  async function findOrCreateGist(token, cachedId) {
    if (cachedId) {
      try {
        const g = await gh("/gists/" + cachedId, { notFoundOk: true }, token);
        if (g && g.files && g.files[GIST_FILE]) return { id: g.id, created: false };
      } catch (e) {}
    }
    const list = await gh("/gists?per_page=100", {}, token);
    if (Array.isArray(list)) {
      const found = list.find((g) => g.description === GIST_DESC && g.files && g.files[GIST_FILE]);
      if (found) return { id: found.id, created: false };
    }
    const created = await gh("/gists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: GIST_DESC,
        public: false,
        files: { [GIST_FILE]: { content: "{\"records\":[],\"version\":1}" } }
      })
    }, token);
    return { id: created.id, created: true };
  }

  /* 拉取远程记录 */
  async function pull(token, gistId) {
    const g = await gh("/gists/" + gistId, {}, token);
    const content = g.files && g.files[GIST_FILE] && g.files[GIST_FILE].content;
    if (!content) return [];
    try {
      const j = JSON.parse(content);
      return Array.isArray(j.records) ? j.records : [];
    } catch (e) {
      throw new Error("远程同步数据格式损坏，已停止同步（请勿手动改动该 Gist）");
    }
  }

  /* 推送合并后的记录 */
  async function push(token, gistId, records) {
    await gh("/gists/" + gistId, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: { [GIST_FILE]: { content: JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), records }) } }
      })
    }, token);
  }

  /* 按 id + updatedAt 合并（后改的覆盖先改的） */
  function mergeRecords(localRecords, remoteRecords) {
    const map = new Map();
    for (const r of remoteRecords) {
      if (r && r.id) map.set(r.id, r);
    }
    for (const r of localRecords) {
      if (!r || !r.id) continue;
      const ex = map.get(r.id);
      if (!ex || (r.updatedAt || 0) > (ex.updatedAt || 0)) map.set(r.id, r);
    }
    return Array.from(map.values());
  }

  function stableJson(records) {
    const sorted = records.slice().sort((a, b) => (a.id < b.id ? -1 : 1));
    return JSON.stringify(sorted);
  }

  /* 执行一次完整同步：拉取 → 合并 → 写回本地 → 推送
     返回 { localCount, remoteCount, mergedCount, created, changed } */
  async function syncNow() {
    const s = API.getSettings();
    if (!s.githubToken) throw new Error("请先填写 GitHub Token");
    const local = await DB.getAll();
    const { id, created } = await findOrCreateGist(s.githubToken, s.gistId);
    const remote = await pull(s.githubToken, id);

    const merged = mergeRecords(local, remote);
    const changed = stableJson(merged) !== stableJson(local);

    await DB.clear();
    for (const r of merged) {
      await DB.put(r);
    }

    if (changed || created) {
      await push(s.githubToken, id, merged);
    }

    const st = {
      lastSyncAt: Date.now(),
      localCount: merged.length,
      remoteCount: remote.length,
      error: null
    };
    setStatus(st);

    const s2 = API.getSettings();
    s2.gistId = id;
    API.saveSettings(s2);

    return {
      localCount: merged.length,
      remoteCount: remote.length,
      created,
      changed
    };
  }

  /* 启动时静默同步（失败不打扰，仅记录状态） */
  async function autoSync() {
    const s = API.getSettings();
    if (!s.githubToken) return null;
    try {
      return await syncNow();
    } catch (err) {
      setStatus({ lastSyncAt: Date.now(), error: err.message, localCount: null, remoteCount: null });
      return null;
    }
  }

  return { syncNow, autoSync, getStatus, mergeRecords };
})();
