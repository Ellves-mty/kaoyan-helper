/* 主框架：路由 / 首页 / 统计 / 设置 / 启动 */

const App = (() => {
  let toastTimer = null;

  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }
  window.toast = toast;

  function setTopbar(title, showBack) {
    const tb = document.getElementById("topbar");
    tb.innerHTML = (showBack
      ? '<button class="topbar-back" onclick="location.hash=\'#/history\'">←</button>'
      : "") + '<span id="topbar-title">' + title + "</span>";
  }

  /* ---------- 路由 ---------- */
  function route() {
    const hash = location.hash || "#/home";
    const parts = hash.slice(2).split("/");
    const page = parts[0] || "home";
    document.querySelectorAll(".tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.route === "#/" + (parts.length > 1 ? "solve" : page));
    });
    switch (page) {
      case "solve":
        if (parts[1] === "record") {
          setTopbar("记录详情", false);
          SolveView.renderRecordDetail(parts[2]);
        } else {
          setTopbar("解题", false);
          SolveView.render();
        }
        break;
      case "history":
        setTopbar("历史记录", false);
        SolveView.renderHistory();
        break;
      case "stats":
        setTopbar("统计", false);
        renderStats();
        break;
      case "settings":
        setTopbar("设置", false);
        renderSettings();
        break;
      default:
        setTopbar("考研解题助手", false);
        renderHome();
    }
  }

  /* ---------- 首页 ---------- */
  async function renderHome() {
    const all = await DB.getAll();
    const count = (key) => all.filter((r) => r.subject === key).length;
    const cards = Object.values(SUBJECTS).map((s) => `
      <button class="subject-card ${s.cssClass}" data-subject="${s.key}">
        <span class="sc-icon">${s.icon}</span>
        <span class="sc-name">${s.name}</span>
        <span class="sc-desc">${s.desc}</span>
        <span class="sc-count">已做 ${count(s.key)} 题</span>
      </button>`).join("");

    const hour = new Date().getHours();
    const greet = hour < 6 ? "夜深了" : hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好";

    document.getElementById("view").innerHTML = `
      <div class="home-hero">
        <h2>${greet}，考研人 📚</h2>
        <div class="sub">今日距考研还有 ${Math.max(0, Math.round((new Date("2027-12-25") - Date.now()) / 86400000))} 天，加油！</div>
      </div>
      <div class="subject-cards">${cards}</div>
      <button class="btn btn-primary" id="btn-go-solve">✏️ 开始解题</button>
      <div class="card" style="margin-top:14px">
        <div class="card-title">💡 使用提示</div>
        <div class="muted">
          1. 粘贴文本、拍照或从相册选图都可以（图片自动识别）<br>
          2. AI 给出步骤化解答与知识点分类<br>
          3. 做完记得标记「对/错」，统计页会帮你找出薄弱点<br>
          4. 跨设备同步将在后续阶段开放
        </div>
      </div>`;

    document.querySelectorAll(".subject-card").forEach((c) => {
      c.addEventListener("click", () => {
        localStorage.setItem("kh_current_subject", c.dataset.subject);
        location.hash = "#/solve";
      });
    });
    document.getElementById("btn-go-solve").addEventListener("click", () => { location.hash = "#/solve"; });
  }

  /* ---------- 统计（知识点柱状图 + 正确率 + 薄弱点排行） ---------- */

  const ACC_COLORS = {
    good: "#16a34a",
    warn: "#f59e0b",
    weak: "#ef4444",
    none: "#93c5fd"
  };

  function accuracyColor(acc, marked) {
    if (!marked) return ACC_COLORS.none;
    if (acc >= 0.8) return ACC_COLORS.good;
    if (acc >= 0.5) return ACC_COLORS.warn;
    return ACC_COLORS.weak;
  }

  function computeStats(records) {
    const perSubject = {};
    for (const key of Object.keys(SUBJECTS)) {
      const agg = {};
      const recs = records.filter((r) => r.subject === key);
      let marked = 0, correct = 0, wrong = 0, unsure = 0;
      for (const r of recs) {
        const pts = Array.isArray(r.knowledgePoints) && r.knowledgePoints.length ? r.knowledgePoints : ["其他"];
        for (const p of pts) {
          if (!agg[p]) agg[p] = { total: 0, marked: 0, correct: 0 };
          agg[p].total++;
          if (r.answer) {
            agg[p].marked++;
            if (r.answer === "correct") agg[p].correct++;
          }
        }
        if (r.answer) {
          marked++;
          if (r.answer === "correct") correct++;
          else if (r.answer === "wrong") wrong++;
          else unsure++;
        }
      }
      perSubject[key] = { agg, total: recs.length, marked, correct, wrong, unsure };
    }
    return perSubject;
  }

  function statBarRows(stats) {
    let html = "";
    for (const cat of SUBJECTS[stats.subject].categories) {
      const rows = cat.points
        .map((p) => ({ name: p, ...(stats.agg[p] || { total: 0, marked: 0, correct: 0 }) }))
        .filter((r) => r.total > 0)
        .sort((a, b) => b.total - a.total);
      if (rows.length === 0) continue;
      const max = Math.max(...rows.map((r) => r.total));
      html += `<div class="stat-cat-title">${cat.name}</div>`;
      for (const row of rows) {
        const acc = row.marked ? row.correct / row.marked : 0;
        const color = accuracyColor(acc, row.marked);
        const pct = row.marked ? Math.round(acc * 100) + "%" : "未标记";
        html += `
          <div class="stat-bar-row" title="${row.name}：做题 ${row.total} 次，正确率 ${pct}">
            <span class="stat-bar-label">${row.name}</span>
            <span class="stat-bar-track"><span class="stat-bar-fill" style="width:${Math.max(3, row.total / max * 100)}%;background:${color}"></span></span>
            <span class="stat-bar-info">${row.total}次 · ${pct}</span>
          </div>`;
      }
    }
    const other = stats.agg["其他"];
    if (other && other.total > 0) {
      html += `<div class="stat-cat-title">未分类</div>`;
      html += `
        <div class="stat-bar-row" title="其他：做题 ${other.total} 次">
          <span class="stat-bar-label">其他</span>
          <span class="stat-bar-track"><span class="stat-bar-fill" style="width:100%;background:${ACC_COLORS.none}"></span></span>
          <span class="stat-bar-info">${other.total}次 · 未标记</span>
        </div>`;
    }
    return html;
  }

  function weakPoints(stats) {
    return Object.keys(stats.agg)
      .map((p) => ({ name: p, ...stats.agg[p], acc: stats.agg[p].marked ? stats.agg[p].correct / stats.agg[p].marked : null }))
      .filter((p) => p.marked > 0)
      .sort((a, b) => (a.acc === null ? 1 : 0) - (b.acc === null ? 1 : 0) || a.acc - b.acc || b.total - a.total);
  }

  async function renderStats() {
    const all = await DB.getAll();
    const statsAll = computeStats(all);
    const filter = localStorage.getItem("kh_stats_filter") || "all";
    if (!SUBJECTS[filter] && filter !== "all") localStorage.setItem("kh_stats_filter", "all");

    const subjects = filter === "all" ? Object.keys(SUBJECTS) : [filter];
    const overall = {
      total: 0, marked: 0, correct: 0, wrong: 0, unsure: 0
    };
    subjects.forEach((k) => {
      overall.total += statsAll[k].total;
      overall.marked += statsAll[k].marked;
      overall.correct += statsAll[k].correct;
      overall.wrong += statsAll[k].wrong;
      overall.unsure += statsAll[k].unsure;
    });
    const accAll = overall.marked ? Math.round(overall.correct / overall.marked * 100) : null;

    const chips = `<button class="chip ${filter === "all" ? "active" : ""}" data-f="all">全部</button>` +
      Object.values(SUBJECTS).map((s) =>
        `<button class="chip ${filter === s.key ? "active" : ""}" data-f="${s.key}">${s.icon} ${s.name}</button>`
      ).join("");

    document.getElementById("view").innerHTML = `
      <div class="chips" id="stats-chips">${chips}</div>

      <div class="card">
        <div class="card-title">📊 学习总览</div>
        <div class="stat-summary">
          <div class="meta-item"><div class="mi-label">总题数</div><div class="mi-value">${overall.total}</div></div>
          <div class="meta-item"><div class="mi-label">已标记</div><div class="mi-value">${overall.marked}</div></div>
          <div class="meta-item"><div class="mi-label">做对</div><div class="mi-value" style="color:var(--success)">${overall.correct}</div></div>
          <div class="meta-item"><div class="mi-label">做错/没把握</div><div class="mi-value" style="color:var(--danger)">${overall.wrong + overall.unsure}</div></div>
          <div class="meta-item"><div class="mi-label">综合正确率</div><div class="mi-value" style="color:${accAll === null ? "var(--muted)" : accuracyColor(accAll / 100, overall.marked)}">${accAll === null ? "—" : accAll + "%"}</div></div>
          <div class="meta-item"><div class="mi-label">累计做题</div><div class="mi-value">${overall.total} 题</div></div>
        </div>
        ${overall.total > 0 && overall.marked === 0 ? `<div class="hint" style="margin-top:8px">💡 有 ${overall.total} 道题未标记对错——在「历史」中标记后，正确率统计才会生效。</div>` : ""}
      </div>

      <div id="stats-body"></div>`;

    document.querySelectorAll("#stats-chips .chip").forEach((c) => {
      c.addEventListener("click", () => {
        localStorage.setItem("kh_stats_filter", c.dataset.f);
        renderStats();
      });
    });

    const body = document.getElementById("stats-body");
    if (overall.total === 0) {
      body.innerHTML = `<div class="empty"><span class="empty-icon">📈</span>还没有做题数据<br><span class="muted">去「解题」页做几道题，统计会自动生成</span></div>`;
      return;
    }

    let weakHtml = "";
    let weakList = [];
    subjects.forEach((k) => {
      const w = weakPoints(statsAll[k]);
      if (w.length) weakList.push(...w.map((x) => ({ ...x, subject: k })));
    });
    weakList.sort((a, b) => a.acc - b.acc);
    if (weakList.length) {
      weakHtml = `
        <div class="card">
          <div class="card-title">⚠️ 薄弱点排行 <span class="muted" style="font-weight:400">（按正确率从低到高）</span></div>
          ${weakList.slice(0, 6).map((w) => `
            <div class="weak-item">
              <span class="subject-dot" style="background:${SUBJECTS[w.subject].color}"></span>
              <span class="weak-name">${w.name}</span>
              <span class="weak-count">${w.total}次 · 对${w.correct}</span>
              <span class="weak-rate" style="color:${accuracyColor(w.acc, 1)}">${Math.round(w.acc * 100)}%</span>
            </div>`).join("")}
        </div>`;
    }

    let chartHtml = "";
    for (const k of subjects) {
      if (statsAll[k].total === 0) continue;
      chartHtml += `
        <div class="card">
          <div class="card-title">📈 ${SUBJECTS[k].name} · 知识点做题分布
            <span class="muted" style="font-weight:400">（${statsAll[k].total} 题）</span>
          </div>
          <div class="stat-legend">
            <span><i style="background:${ACC_COLORS.good}"></i>≥80%</span>
            <span><i style="background:${ACC_COLORS.warn}"></i>50~80%</span>
            <span><i style="background:${ACC_COLORS.weak}"></i>&lt;50% 薄弱</span>
            <span><i style="background:${ACC_COLORS.none}"></i>未标记</span>
          </div>
          ${statBarRows({ subject: k, agg: statsAll[k].agg })}
        </div>`;
    }

    body.innerHTML = weakHtml + chartHtml;
  }

  /* ---------- 设置 ---------- */
  function renderSyncStatus() {
    const el = document.getElementById("sync-status");
    if (!el) return;
    const st = Sync.getStatus();
    const s = API.getSettings();
    let html = "";
    if (!s.githubToken) {
      html = `<div class="muted">📴 未配置 Token，暂不同步。</div>`;
    } else if (st && st.error) {
      html = `<div class="danger-text">❌ 上次同步失败：${escapeHtml(st.error)}<br><span class="muted">${new Date(st.lastSyncAt).toLocaleString("zh-CN")}</span></div>`;
    } else if (st && st.lastSyncAt) {
      html = `<div class="muted">✅ 上次同步：${new Date(st.lastSyncAt).toLocaleString("zh-CN")} · 共 ${st.localCount} 条记录${st.remoteCount !== null ? "（云端 " + st.remoteCount + " 条）" : ""}</div>`;
    } else {
      html = `<div class="muted">⏳ 尚未同步过，点「立即同步」开始。</div>`;
    }
    el.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function renderSettings() {
    const s = API.getSettings();
    document.getElementById("view").innerHTML = `
      <div class="card">
        <div class="card-title">🔑 API 配置</div>
        <div class="field">
          <label>DeepSeek API Key（必填，用于解题）</label>
          <input type="password" id="set-deepseek" placeholder="sk-..." value="${s.deepseekKey}">
          <div class="hint">在 platform.deepseek.com 创建并充值，浏览器本地保存，不会上传到任何服务器。</div>
        </div>
        <button class="btn btn-ghost" id="btn-test-deepseek" style="width:100%">🔌 测试 DeepSeek 连接</button>
        <div class="divider"></div>
        <div class="field">
          <label>通义千问 API Key（图片识别用）</label>
          <input type="password" id="set-dashscope" placeholder="sk-..." value="${s.dashscopeKey}">
          <div class="hint">阿里云百炼平台申请（bailian.console.aliyun.com），新用户有免费额度。</div>
        </div>
        <button class="btn btn-ghost" id="btn-test-dashscope" style="width:100%">🔌 测试通义千问连接</button>
      </div>

      <div class="card">
        <div class="card-title">🧠 解题设置</div>
        <div class="setting-row">
          <div>
            <div class="sr-label">深度思考模式</div>
            <div class="sr-desc">开启后 AI 先推理再作答，数学/408 建议开启</div>
          </div>
          <label class="switch">
            <input type="checkbox" id="set-thinking" ${s.thinking ? "checked" : ""}>
            <span class="slider"></span>
          </label>
        </div>
        <div class="setting-row">
          <div>
            <div class="sr-label">思考强度</div>
            <div class="sr-desc">低=更快更省，高=更严谨</div>
          </div>
          <select id="set-effort">
            <option value="low" ${s.effort === "low" ? "selected" : ""}>低</option>
            <option value="high" ${s.effort === "high" ? "selected" : ""}>高（推荐）</option>
            <option value="max" ${s.effort === "max" ? "selected" : ""}>最高</option>
          </select>
        </div>
      </div>

      <div class="card">
        <div class="card-title">☁️ 跨设备同步（GitHub Gist）</div>
        <div class="field">
          <label>GitHub 个人访问令牌（Token）</label>
          <input type="password" id="set-github-token" placeholder="ghp_... 或 github_pat_..." value="${s.githubToken}">
          <div class="hint">
            生成方法：GitHub → Settings → Developer settings → Personal access tokens → 生成新 Token，
            勾选 <b>gist</b> 权限即可。数据保存在你自己的私有 Gist 中（免费），手机/电脑/平板共用一份记录。
          </div>
        </div>
        <div class="sync-status" id="sync-status"></div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn btn-ghost" id="btn-sync-now" style="flex:1">🔄 立即同步</button>
          <button class="btn btn-ghost" id="btn-sync-open" style="flex:1">🔗 打开 Token 生成页</button>
        </div>
        <div class="hint" style="margin-top:8px">
          首次同步会自动创建私有 Gist 并上传全部记录；之后每次打开 App 自动拉取合并。
          删除的记录会在其他设备重新出现（暂不支持删除同步）。
        </div>
      </div>

      <div class="card">
        <div class="card-title">💾 数据管理</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost" id="btn-export" style="flex:1">📤 导出备份</button>
          <button class="btn btn-ghost" id="btn-import" style="flex:1">📥 导入备份</button>
        </div>
        <input type="file" id="import-input" accept=".json,application/json" hidden>
        <button class="btn btn-danger" id="btn-clear" style="width:100%;margin-top:10px">🗑️ 清空全部记录</button>
      </div>

      <div class="card">
        <div class="card-title">ℹ️ 关于</div>
        <div class="muted">考研解题助手 v1.5（跨设备同步 + PDF）<br>
        科目：数学一 / 英语一 / 408<br>
        路线图：部署上线</div>
      </div>`;

    const onChange = () => {
      const s2 = API.getSettings();
      s2.deepseekKey = document.getElementById("set-deepseek").value.trim();
      s2.dashscopeKey = document.getElementById("set-dashscope").value.trim();
      s2.thinking = document.getElementById("set-thinking").checked;
      s2.effort = document.getElementById("set-effort").value;
      s2.githubToken = document.getElementById("set-github-token").value.trim();
      API.saveSettings(s2);
    };

    ["set-deepseek", "set-dashscope", "set-github-token"].forEach((id) => {
      document.getElementById(id).addEventListener("input", onChange);
    });
    document.getElementById("set-thinking").addEventListener("change", onChange);
    document.getElementById("set-effort").addEventListener("change", onChange);

    document.getElementById("btn-test-deepseek").addEventListener("click", async (e) => {
      const btn = e.target;
      const key = document.getElementById("set-deepseek").value.trim();
      if (!key) { toast("请先填写 API Key"); return; }
      btn.disabled = true;
      btn.textContent = "⏳ 测试中…";
      try {
        const models = await API.testDeepSeek(key);
        toast("连接成功 ✅ 可用模型：" + models.join(", "));
      } catch (err) {
        toast("连接失败：" + err.message);
      }
      btn.disabled = false;
      btn.textContent = "🔌 测试 DeepSeek 连接";
    });

    document.getElementById("btn-test-dashscope").addEventListener("click", async (e) => {
      const btn = e.target;
      const key = document.getElementById("set-dashscope").value.trim();
      if (!key) { toast("请先填写 API Key"); return; }
      btn.disabled = true;
      btn.textContent = "⏳ 测试中…";
      try {
        const models = await API.testDashScope(key);
        const hasVL = models.some((m) => /vl/i.test(m));
        toast("连接成功 ✅ " + (hasVL ? "已支持视觉模型" : "可用模型：" + models.slice(0, 3).join(", ")));
      } catch (err) {
        toast("连接失败：" + err.message);
      }
      btn.disabled = false;
      btn.textContent = "🔌 测试通义千问连接";
    });

    renderSyncStatus();
    document.getElementById("btn-sync-now").addEventListener("click", async (e) => {
      const btn = e.target;
      if (!document.getElementById("set-github-token").value.trim()) { toast("请先填写 GitHub Token"); return; }
      btn.disabled = true;
      btn.textContent = "⏳ 同步中…";
      try {
        const r = await Sync.syncNow();
        toast("同步完成 ✅ 本地 " + r.localCount + " 条" + (r.created ? "（已创建私有 Gist）" : ""));
      } catch (err) {
        toast("同步失败：" + err.message);
      }
      btn.disabled = false;
      btn.textContent = "🔄 立即同步";
      renderSyncStatus();
    });
    document.getElementById("btn-sync-open").addEventListener("click", () => {
      window.open("https://github.com/settings/tokens/new?scopes=gist&description=kaoyan-helper", "_blank");
    });

    document.getElementById("btn-export").addEventListener("click", async () => {
      const json = await DB.exportJSON();
      const blob = new Blob([json], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "kaoyan-helper-backup-" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast("备份已导出");
    });

    document.getElementById("btn-import").addEventListener("click", () => {
      document.getElementById("import-input").click();
    });
    document.getElementById("import-input").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const text = await f.text();
        const n = await DB.importJSON(text);
        toast("导入成功，共 " + n + " 条记录");
      } catch (err) {
        toast("导入失败：" + err.message);
      }
      e.target.value = "";
    });

    document.getElementById("btn-clear").addEventListener("click", async () => {
      if (confirm("确定清空全部记录？此操作不可恢复（建议先导出备份）")) {
        if (confirm("再次确认：真的要清空吗？")) {
          await DB.clear();
          toast("已清空");
          renderSettings();
        }
      }
    });
  }

  /* ---------- 启动 ---------- */
  function init() {
    document.querySelectorAll(".tab").forEach((t) => {
      t.addEventListener("click", () => { location.hash = t.dataset.route; });
    });
    window.addEventListener("hashchange", route);
    route();
    Sync.autoSync();
    if ("serviceWorker" in navigator && location.protocol === "https:") {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  return { init, toast };
})();

document.addEventListener("DOMContentLoaded", App.init);
