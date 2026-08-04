/* GitHub 跨设备同步（Gist / 私有仓库，gzip 压缩，浏览器直连） */

const Sync = (() => {
  const GIST_DESC = "考研解题助手同步数据";
  const GIST_FILE = "kaoyan-helper-data.json";
  const REPO_FILE = "kaoyan-helper-data.json";
  const GIST_UA = "kaoyan-helper-pwa";
  const GIST_SIZE_LIMIT = 1024 * 1024; /* Gist API 单文件返回上限 1MB */

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
      if (/bad credentials|must have the gist scope|scope|insufficient scopes/i.test(msg)) {
        msg = "Token 无效或权限不足（Gist 存储需 gist 权限；仓库存储需 repo 权限）";
      }
      throw new Error(msg);
    }
    return res.json();
  }

  /* ---------------- 数据编解码（v3 = gzip+base64；兼容 v1/v2 明文） ---------------- */

  function toBase64(uint8) {
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < uint8.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, uint8.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  function fromBase64(b64) {
    const binary = atob(b64);
    const uint8 = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) uint8[i] = binary.charCodeAt(i);
    return uint8;
  }

  function bytesOf(str) {
    return new TextEncoder().encode(str).length;
  }

  /* 编码：返回 { content, plainBytes, compBytes } */
  async function encodePayload(records, tombstones) {
    const plain = JSON.stringify({
      version: 3,
      encoding: "plain",
      updatedAt: new Date().toISOString(),
      records,
      deleted: tombstones || []
    });
    const plainBytes = bytesOf(plain);
    if (typeof CompressionStream === "undefined") {
      return { content: plain, plainBytes, compBytes: plainBytes };
    }
    const stream = new Blob([plain]).stream().pipeThrough(new CompressionStream("gzip"));
    const buf = await new Response(stream).arrayBuffer();
    const uint8 = new Uint8Array(buf);
    return {
      content: JSON.stringify({ version: 3, encoding: "gzip", payload: toBase64(uint8) }),
      plainBytes,
      compBytes: uint8.length
    };
  }

  /* 解码：输入文件内容字符串 → { records, tombstones } */
  async function decodePayload(content) {
    if (!content) return { records: [], tombstones: [] };
    let j;
    try {
      j = JSON.parse(content);
    } catch (e) {
      throw new Error("远程同步数据格式损坏，已停止同步（请勿手动改动该文件）");
    }
    if (j && j.encoding === "gzip" && j.payload) {
      if (typeof DecompressionStream === "undefined") {
        throw new Error("当前浏览器不支持解压同步数据，请升级浏览器后重试");
      }
      try {
        const stream = new Blob([fromBase64(j.payload)]).stream().pipeThrough(new DecompressionStream("gzip"));
        j = JSON.parse(await new Response(stream).text());
      } catch (e) {
        throw new Error("同步数据解压失败，请检查网络后重试");
      }
    }
    const records = Array.isArray(j.records) ? j.records : (Array.isArray(j) ? j : []);
    const tombstones = Array.isArray(j.deleted) ? j.deleted : [];
    return { records, tombstones };
  }

  /* ---------------- Gist 后端 ---------------- */

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

  async function gistPull(token, gistId) {
    const g = await gh("/gists/" + gistId, {}, token);
    const content = g.files && g.files[GIST_FILE] && g.files[GIST_FILE].content;
    return decodePayload(content);
  }

  async function gistPush(token, gistId, records, tombstones) {
    const enc = await encodePayload(records, tombstones);
    await gh("/gists/" + gistId, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: { [GIST_FILE]: { content: enc.content } }
      })
    }, token);
    return enc;
  }

  /* ---------------- 私有仓库后端（Contents API，单文件上限 100MB） ---------------- */

  async function repoOwner(token) {
    const u = await gh("/user", {}, token);
    if (!u || !u.login) throw new Error("无法获取 GitHub 账号信息");
    return u.login;
  }

  /* 读取仓库文件。返回 { records, tombstones, sha, exists }；文件不存在返回 { exists: false } */
  async function repoPull(token, repoName) {
    const owner = await repoOwner(token);
    const res = await fetch(gistBase() + "/repos/" + owner + "/" + encodeURIComponent(repoName) + "/contents/" + REPO_FILE, {
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": GIST_UA
      }
    });
    if (res.status === 404) return { exists: false, records: [], tombstones: [], sha: null };
    if (!res.ok) {
      let msg = "HTTP " + res.status;
      try { const j = await res.json(); msg = j.message || msg; } catch (e) {}
      if (/bad credentials|insufficient scopes|scope/i.test(msg)) {
        msg = "Token 无效或缺少 repo 权限（请在 GitHub 重新生成，勾选 repo）";
      }
      throw new Error(msg);
    }
    const j = await res.json();
    const text = j.encoding === "base64"
      ? new TextDecoder().decode(fromBase64(j.content))
      : String(j.content || "");
    const data = await decodePayload(text);
    return { exists: true, records: data.records, tombstones: data.tombstones, sha: j.sha || null };
  }

  async function repoPush(token, repoName, records, tombstones) {
    const owner = await repoOwner(token);
    const enc = await encodePayload(records, tombstones);
    const existing = await repoPull(token, repoName);
    const res = await fetch(gistBase() + "/repos/" + owner + "/" + encodeURIComponent(repoName) + "/contents/" + REPO_FILE, {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": GIST_UA,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: "kaoyan-helper sync",
        content: toBase64(new TextEncoder().encode(enc.content)),
        sha: existing.sha || undefined
      })
    });
    if (!res.ok) {
      let msg = "HTTP " + res.status;
      try { const j = await res.json(); msg = j.message || msg; } catch (e) {}
      if (/bad credentials|insufficient scopes|scope/i.test(msg)) {
        msg = "Token 无效或缺少 repo 权限（请在 GitHub 重新生成，勾选 repo）";
      }
      throw new Error(msg);
    }
    return enc;
  }

  /* 自动创建私有仓库（已存在则忽略） */
  async function repoEnsure(token, repoName) {
    const owner = await repoOwner(token);
    const res = await fetch(gistBase() + "/user/repos", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": GIST_UA,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ name: repoName, private: true, auto_init: false })
    });
    if (res.ok || res.status === 422) return owner;
    let msg = "HTTP " + res.status;
    try { const j = await res.json(); msg = j.message || msg; } catch (e) {}
    throw new Error(msg);
  }

  /* ---------------- 合并 ---------------- */

  function mergeData(localRecords, remoteRecords, localTombs, remoteTombs) {
    const tombMap = new Map();
    for (const t of (localTombs || [])) {
      if (t && t.id) {
        const ex = tombMap.get(t.id);
        if (!ex || (t.deletedAt || 0) > (ex.deletedAt || 0)) tombMap.set(t.id, t);
      }
    }
    for (const t of (remoteTombs || [])) {
      if (t && t.id) {
        const ex = tombMap.get(t.id);
        if (!ex || (t.deletedAt || 0) > (ex.deletedAt || 0)) tombMap.set(t.id, t);
      }
    }

    const recMap = new Map();
    for (const r of remoteRecords) {
      if (r && r.id) recMap.set(r.id, r);
    }
    for (const r of localRecords) {
      if (!r || !r.id) continue;
      const ex = recMap.get(r.id);
      if (!ex || (r.updatedAt || 0) > (ex.updatedAt || 0)) recMap.set(r.id, r);
    }

    const records = [];
    for (const r of recMap.values()) {
      const t = tombMap.get(r.id);
      if (t && (r.updatedAt || 0) <= (t.deletedAt || 0)) continue;
      records.push(r);
    }

    const tombstones = Array.from(tombMap.values())
      .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0))
      .slice(0, 500);

    return { records, tombstones };
  }

  function mergeRecords(localRecords, remoteRecords) {
    return mergeData(localRecords, remoteRecords, [], []).records;
  }

  function stableJson(records) {
    const sorted = records.slice().sort((a, b) => (a.id < b.id ? -1 : 1));
    return JSON.stringify(sorted);
  }

  /* ---------------- 同步主流程 ---------------- */

  /* 根据设置选择后端，返回 { type, pull, push, created } */
  function backend(s) {
    if (s.storageType === "repo") {
      return {
        type: "repo",
        repoName: (s.repoName || "").trim(),
        pull: (token) => repoPull(token, s.repoName),
        push: (token, records, tombstones) => repoPush(token, s.repoName, records, tombstones),
        created: false
      };
    }
    return {
      type: "gist",
      pull: async (token) => {
        const { id } = await findOrCreateGist(token, s.gistId);
        return gistPull(token, id);
      },
      push: async (token, records, tombstones) => {
        const { id } = await findOrCreateGist(token, s.gistId);
        const enc = await gistPush(token, id, records, tombstones);
        const s2 = API.getSettings();
        s2.gistId = id;
        API.saveSettings(s2);
        return enc;
      }
    };
  }

  async function syncNow() {
    const s = API.getSettings();
    if (!s.githubToken) throw new Error("请先填写 GitHub Token");
    if (s.storageType === "repo" && !(s.repoName || "").trim()) {
      throw new Error("请先填写同步仓库名称（设置页可一键创建）");
    }

    const bk = backend(s);
    const local = await DB.getAll();
    const localTombs = await DB.getTombstones();

    let remote;
    if (bk.type === "repo") {
      const r = await repoPull(s.githubToken, bk.repoName);
      remote = { records: r.records, tombstones: r.tombstones, exists: r.exists };
    } else {
      const { id, created } = await findOrCreateGist(s.githubToken, s.gistId);
      const g = await gistPull(s.githubToken, id);
      remote = { records: g.records, tombstones: g.tombstones, exists: created ? false : true };
      const s2 = API.getSettings();
      s2.gistId = id;
      API.saveSettings(s2);
    }

    const merged = mergeData(local, remote.records, localTombs, remote.tombstones);
    const changed =
      stableJson(merged.records) !== stableJson(remote.records) ||
      stableJson(merged.tombstones) !== stableJson(remote.tombstones);

    await DB.clear();
    await DB.clearTombstones();
    for (const r of merged.records) {
      await DB.putRaw(r);
    }
    for (const t of merged.tombstones) {
      await DB.putTombstone(t);
    }

    let warning = null;
    let compBytes = null;
    if (changed || !remote.exists) {
      const enc = await bk.push(s.githubToken, merged.records, merged.tombstones);
      compBytes = enc.compBytes;
      if (bk.type === "gist" && compBytes > GIST_SIZE_LIMIT * 0.9) {
        warning = "同步数据已接近云端上限（" + Math.round(compBytes / 1024) + " KB），建议迁移到私有仓库存储";
      } else if (bk.type === "gist" && compBytes > GIST_SIZE_LIMIT * 0.7) {
        warning = "同步数据量较大（" + Math.round(compBytes / 1024) + " KB），长期使用建议迁移到私有仓库";
      }
    }

    const st = {
      lastSyncAt: Date.now(),
      localCount: merged.records.length,
      remoteCount: remote.records.length,
      storageType: bk.type,
      sizeKB: compBytes ? Math.round(compBytes / 1024) : null,
      warning,
      error: null
    };
    setStatus(st);

    return {
      localCount: merged.records.length,
      remoteCount: remote.records.length,
      created: !remote.exists,
      changed,
      warning,
      sizeKB: st.sizeKB
    };
  }

  /* 迁移：把本地当前数据写入目标后端并切换设置 */
  async function migrateTo(type) {
    const s = API.getSettings();
    if (!s.githubToken) throw new Error("请先填写 GitHub Token");
    if (type === "repo" && !(s.repoName || "").trim()) {
      throw new Error("请先填写同步仓库名称");
    }
    const local = await DB.getAll();
    const tombs = await DB.getTombstones();
    if (type === "repo") {
      const owner = await repoEnsure(s.githubToken, s.repoName);
      await repoPush(s.githubToken, s.repoName, local, tombs);
      const s2 = API.getSettings();
      s2.storageType = "repo";
      s2.repoOwner = owner;
      API.saveSettings(s2);
    } else {
      const { id } = await findOrCreateGist(s.githubToken, s.gistId);
      await gistPush(s.githubToken, id, local, tombs);
      const s2 = API.getSettings();
      s2.storageType = "gist";
      s2.gistId = id;
      API.saveSettings(s2);
    }
    return { type, count: local.length };
  }

  /* 启动时静默同步（失败不打扰，仅记录状态） */
  async function autoSync() {
    const s = API.getSettings();
    if (!s.githubToken) return null;
    try {
      return await syncNow();
    } catch (err) {
      setStatus({ lastSyncAt: Date.now(), error: err.message, localCount: null, remoteCount: null, storageType: s.storageType });
      return null;
    }
  }

  return { syncNow, autoSync, getStatus, mergeRecords, mergeData, migrateTo, repoEnsure, decodePayload };
})();
