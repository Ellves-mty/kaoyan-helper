/* 解题视图 / 历史记录 / 记录详情 */

const SolveView = (() => {
  let currentAbort = null;
  let currentRecordId = null;
  let currentSubject = "math";
  let inputMode = "text";
  let currentImages = [];
  let currentQuestion = "";
  let autoDetected = false;

  const S = () => API.getSettings();

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function placeholderFor(key) {
    return key === "english"
      ? "粘贴题目，或直接粘贴整篇文章……\n整篇文章可获得：全文主旨 + 段落结构 + 长难句解析 + 生词提取"
      : "粘贴或输入题目内容……（自动识别科目）";
  }

  function setSubject(key) {
    currentSubject = key;
    localStorage.setItem("kh_current_subject", key);
    document.querySelectorAll("#solve-chips .chip").forEach((c) => {
      c.classList.toggle("active", c.dataset.subject === key);
    });
    const ta = document.getElementById("solve-question");
    if (ta) ta.placeholder = placeholderFor(key);
  }

  function updateSolveBtn() {
    const btn = document.getElementById("btn-solve");
    if (!btn) return;
    btn.textContent = currentImages.length > 0 ? "🔍 提取题目文字" : "🚀 开始解题";
  }

  function render() {
    currentSubject = localStorage.getItem("kh_current_subject") || "math";
    if (!SUBJECTS[currentSubject]) currentSubject = "math";
    currentAbort = null;
    currentRecordId = null;
    inputMode = "text";
    currentImages = [];
    currentQuestion = "";
    autoDetected = false;

    const chips = Object.values(SUBJECTS).map((s) =>
      `<button class="chip ${s.key === currentSubject ? "active" : ""}" data-subject="${s.key}">${s.icon} ${s.name}</button>`
    ).join("");

    document.getElementById("view").innerHTML = `
      <div class="chips" id="solve-chips">${chips}</div>

      <div class="input-tabs">
        <button class="input-tab active" data-mode="text">📝 文本</button>
        <button class="input-tab" data-mode="image">🖼️ 图片</button>
        <button class="input-tab" data-mode="file">📄 文件</button>
      </div>

      <div id="solve-input-area">
        <div class="field" id="solve-text-field">
          <textarea id="solve-question" placeholder="粘贴或输入题目内容……（自动识别科目，也可在上方手动切换）"></textarea>
        </div>
      </div>

      <button class="btn btn-primary" id="btn-solve">🚀 开始解题</button>
      <div id="solve-result"></div>
    `;

    document.querySelectorAll("#solve-chips .chip").forEach((c) => {
      c.addEventListener("click", () => setSubject(c.dataset.subject));
    });

    document.querySelectorAll(".input-tab").forEach((t) => {
      t.addEventListener("click", () => switchInputMode(t.dataset.mode));
    });

    const ta = document.getElementById("solve-question");
    if (ta) {
      ta.placeholder = placeholderFor(currentSubject);
      ta.addEventListener("input", () => {
        if (!autoDetected && ta.value.trim().length > 30) {
          const d = detectSubject(ta.value, currentSubject);
          if (d !== currentSubject) { setSubject(d); }
          autoDetected = true;
        }
      });
    }

    document.getElementById("btn-solve").onclick = () => {
      if (currentImages.length > 0) startExtraction();
      else startSolve();
    };
    updateSolveBtn();

    /* 从统计页「出题练习」跳转带来的待解答题目 */
    const pendingQ = localStorage.getItem("kh_pending_question");
    if (pendingQ) {
      localStorage.removeItem("kh_pending_question");
      const ta = document.getElementById("solve-question");
      if (ta) {
        ta.value = pendingQ;
        ta.focus();
        toast("已载入针对性练习题，点击「开始解题」作答");
      }
    }
  }

  function switchInputMode(mode) {
    inputMode = mode;
    document.querySelectorAll(".input-tab").forEach((t) => t.classList.toggle("active", t.dataset.mode === mode));
    const area = document.getElementById("solve-input-area");

    if (mode === "text") {
      area.innerHTML = `
        <div class="field">
          <textarea id="solve-question" placeholder="粘贴或输入题目内容……（自动识别科目）"></textarea>
        </div>`;
    } else if (mode === "image") {
      area.innerHTML = `
        <div class="field">
          <div class="drop-zone" id="dz-image">
            <span class="dz-icon">📷</span>
            拍照或从相册选择题目图片（最多 4 张）
          </div>
          <div id="img-previews" class="img-grid"></div>
          <div class="hint">图片将通过通义千问 VL 识别为题目文本，识别后可在解题前核对修正。</div>
        </div>
        <input type="file" id="img-input" accept="image/*" multiple hidden>`;
      const input = document.getElementById("img-input");
      document.getElementById("dz-image").addEventListener("click", () => input.click());
      input.addEventListener("change", async (e) => {
        const files = Array.from(e.target.files || []);
        e.target.value = "";
        if (!files.length) return;
        if (currentImages.length + files.length > 4) { toast("最多同时识别 4 张图片"); return; }
        for (const f of files) {
          try {
            currentImages.push(await API.compressImage(f));
          } catch (err) {
            toast("图片读取失败：" + err.message);
          }
        }
        renderImagePreviews();
        updateSolveBtn();
      });
      renderImagePreviews();
    } else {
      area.innerHTML = `
        <div class="field">
          <div class="drop-zone" id="dz-file">
            <span class="dz-icon">📄</span>
            选择 .txt / .pdf 文件（扫描版 PDF 无文字层，请截图后走图片识别）
          </div>
        </div>
        <input type="file" id="file-input" accept=".txt,.pdf,text/plain,application/pdf" hidden>`;
      const input = document.getElementById("file-input");
      document.getElementById("dz-file").addEventListener("click", () => input.click());
      input.addEventListener("change", async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        if (f.size > 15 * 1024 * 1024) { toast("文件过大（>15MB）"); return; }
        let text = "";
        let note = "";
        try {
          if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") {
            text = await extractPdfText(f);
            note = "已提取 PDF 文字（最多前 20 页，可删减不需要的页）";
          } else {
            text = await f.text();
            note = "已载入 .txt 文件";
          }
        } catch (err) {
          toast("读取失败：" + err.message);
          return;
        }
        if (text.trim().length < 5) {
          area.innerHTML = `
            <div class="card">
              <div class="danger-text">❌ 未能从 ${f.name} 中提取到文字</div>
              <div class="muted" style="margin-top:6px">扫描版 PDF 没有文字层，请对题目部分截图后，用「图片」标签识别。</div>
            </div>`;
          return;
        }
        const d = detectSubject(text, currentSubject);
        setSubject(d);
        area.innerHTML = `
          <div class="field">
            <label>${note}：${f.name}（${text.length} 字符，自动识别为「${SUBJECTS[d].name}」）</label>
            <textarea id="solve-question" placeholder="">${text.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</textarea>
          </div>`;
      });
    }

    const ta = area.querySelector("#solve-question");
    if (ta) {
      ta.addEventListener("input", () => {
        if (!autoDetected && ta.value.trim().length > 30) {
          const d = detectSubject(ta.value, currentSubject);
          if (d !== currentSubject) setSubject(d);
          autoDetected = true;
        }
      });
    }
  }

  /* PDF 文字提取（pdf.js，最多前 20 页；worker 多 CDN 超时重试） */
  async function extractPdfText(file) {
    if (!window.pdfjsLib) throw new Error("PDF 解析库未加载（需联网），请稍后重试或改用文本输入");
    const data = await file.arrayBuffer();
    const workerSrcs = [
      "https://cdn.bootcdn.net/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js"
    ];
    let lastErr = null;
    for (const src of workerSrcs) {
      try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = src;
        const doc = await Promise.race([
          pdfjsLib.getDocument({ data }).promise,
          new Promise((_, rej) => setTimeout(() => rej(new Error("worker 加载超时")), 8000))
        ]);
        return await extractPdfPages(doc);
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error("PDF 解析失败：" + (lastErr ? lastErr.message : "未知错误"));
  }

  async function extractPdfPages(doc) {
    const pages = Math.min(doc.numPages, 20);
    const parts = [];
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map((it) => it.str).join(" ")
        .replace(/[ \t]+/g, " ").trim();
      parts.push("【第 " + i + " 页】\n" + text);
    }
    await doc.destroy();
    return parts.join("\n\n");
  }

  function renderImagePreviews() {
    const wrap = document.getElementById("img-previews");
    if (!wrap) return;
    if (currentImages.length === 0) { wrap.innerHTML = ""; return; }
    wrap.innerHTML = currentImages.map((src, i) => `
      <div class="img-thumb">
        <img src="${src}" alt="题目图片 ${i + 1}">
        <button class="img-remove" data-i="${i}" title="移除">×</button>
      </div>`).join("");
    wrap.querySelectorAll(".img-remove").forEach((b) => {
      b.addEventListener("click", () => {
        currentImages.splice(parseInt(b.dataset.i, 10), 1);
        renderImagePreviews();
        updateSolveBtn();
      });
    });
  }

  /* 图片 → 通义千问 VL 提取题目文本 → 确认修正 → 解题 */
  async function startExtraction() {
    if (currentImages.length === 0) { toast("请先选择题目图片"); return; }
    const s = API.getSettings();
    if (!s.dashscopeKey) { toast("请先在「设置」填写通义千问 API Key"); return; }

    if (currentAbort) currentAbort.abort();
    currentAbort = new AbortController();

    const btn = document.getElementById("btn-solve");
    btn.disabled = true;
    btn.textContent = "⏳ 正在识别图片…";
    const resultBox = document.getElementById("solve-result");
    resultBox.innerHTML = `
      <div class="card">
        <div class="solve-status">🔍 正在通过通义千问 VL 识别 ${currentImages.length} 张图片中的题目…</div>
      </div>`;

    try {
      const text = await API.extractFromImages({ images: currentImages, signal: currentAbort.signal });
      if (!text || /无法识别/.test(text)) {
        resultBox.innerHTML = `<div class="card"><div class="muted">⚠️ 未能识别出题目内容。请尝试：更清晰的图片、单题单图、或改用文本输入。</div></div>`;
        return;
      }
      const d = detectSubject(text, currentSubject);
      setSubject(d);
      resultBox.innerHTML = `
        <div class="card">
          <div class="card-title">📋 图片识别结果 <span class="muted" style="font-weight:400">（已识别为「${SUBJECTS[d].name}」，请核对）</span></div>
          <textarea id="extracted-text" style="min-height:120px">${escapeHtml(text)}</textarea>
          <div class="hint" style="margin:6px 0 10px">数学公式（LaTeX）可能识别不完美，发现错误可直接修改后开始解题。</div>
          <button class="btn btn-primary" id="btn-confirm-extract">🚀 确认无误，开始解题</button>
        </div>`;
      document.getElementById("btn-confirm-extract").onclick = () => {
        const t = document.getElementById("extracted-text").value.trim();
        if (t.length < 3) { toast("识别结果为空，请补充内容"); return; }
        currentImages = [];
        updateSolveBtn();
        startSolve(t);
      };
    } catch (err) {
      if (err.name === "AbortError") {
        resultBox.innerHTML = `<div class="card"><div class="muted">⏹️ 已停止识别。</div></div>`;
      } else {
        resultBox.innerHTML = `<div class="card"><div class="danger-text">❌ 识别失败：${escapeHtml(err.message)}</div><div class="muted" style="margin-top:6px">请检查 API Key 是否正确、网络是否畅通，或改用文本输入。</div></div>`;
      }
    } finally {
      btn.disabled = false;
      updateSolveBtn();
    }
  }

  function getQuestionText() {
    const ta = document.getElementById("solve-question");
    return ta ? ta.value.trim() : "";
  }

  async function startSolve(questionOverride) {
    const question = questionOverride !== undefined ? questionOverride : getQuestionText();
    if (question.length < 3) { toast("请输入题目内容"); return; }
    currentQuestion = question;

    if (currentAbort) currentAbort.abort();
    currentAbort = new AbortController();
    currentRecordId = null;

    const resultBox = document.getElementById("solve-result");
    resultBox.innerHTML = `
      <div class="thinking-box">
        <details>
          <summary>🧠 思考过程（AI 推理）</summary>
          <div id="reasoning-text" class="md"></div>
        </details>
      </div>
      <div class="solution-box">
        <div class="sb-label">📖 解答</div>
        <div id="solution-text" class="md cursor-blink"></div>
      </div>
      <div class="solve-status" id="solve-status">AI 正在思考与作答…</div>
    `;
    const btn = document.getElementById("btn-solve");
    btn.disabled = true;
    btn.textContent = "⏳ 解题中（点击停止）";
    btn.onclick = () => { if (currentAbort) currentAbort.abort(); };

    const reasoningEl = document.getElementById("reasoning-text");
    const solutionEl = document.getElementById("solution-text");
    const statusEl = document.getElementById("solve-status");
    let lastRender = 0;

    const throttledRender = () => {
      const now = Date.now();
      if (now - lastRender > 150) {
        lastRender = now;
        solutionEl.innerHTML = MD.render(rawContent);
        MD.afterRender(solutionEl);
        solutionEl.scrollIntoView({ block: "nearest" });
      }
    };
    let rawContent = "";
    let reasoningBuffer = "";

    try {
      const { content, reasoning } = await API.solve({
        subject: currentSubject,
        question,
        signal: currentAbort.signal,
        onReasoning: (chunk) => {
          reasoningBuffer += chunk;
          reasoningEl.innerHTML = MD.render(reasoningBuffer);
          MD.afterRender(reasoningEl);
        },
        onContent: (chunk) => {
          rawContent += chunk;
          throttledRender();
        }
      });

      reasoningEl.innerHTML = MD.render(reasoning);
      MD.afterRender(reasoningEl);
      statusEl.textContent = "✅ 完成，正在整理结果…";

      const parsed = API.parseSolution(content, currentSubject);
      let solutionText = content;
      let meta = null;

      if (parsed && parsed.solution) {
        solutionText = parsed.solution;
        meta = parsed;
      }

      solutionEl.classList.remove("cursor-blink");
      solutionEl.innerHTML = MD.render(solutionText);
      MD.afterRender(solutionEl);

      renderMeta(meta, parsed ? "" : content);
    } catch (err) {
      if (err.name === "AbortError") {
        statusEl.textContent = "⏹️ 已停止。";
      } else {
        statusEl.textContent = "❌ " + err.message;
        toast("解题失败：" + err.message);
      }
      solutionEl.classList.remove("cursor-blink");
    } finally {
      btn.disabled = false;
      btn.onclick = () => {
        if (currentImages.length > 0) startExtraction();
        else startSolve();
      };
      updateSolveBtn();
    }
  }

  /* 英语整篇解析区块（主旨 / 段落结构 / 长难句 / 生词表） */
  function renderEnglishSections(meta) {
    let html = "";
    if (meta.summary) {
      html += `<div class="card-title">🎯 全文主旨</div><div class="md">${MD.render(meta.summary)}</div>`;
    }
    if (meta.structure) {
      html += `<div class="card-title">🏗️ 段落结构分析</div><div class="md">${MD.render(meta.structure)}</div>`;
    }
    if (meta.sentences && meta.sentences.length) {
      const items = meta.sentences.map((s) => {
        const t = s.translation ? `\n\n- **翻译**：${s.translation}` : "";
        return `> ${s.sentence}\n\n- **语法结构**：${s.grammar}${t}`;
      }).join("\n\n");
      html += `<div class="card-title">🔬 长难句解析（${meta.sentences.length} 句）</div><div class="md">${MD.render(items)}</div>`;
    }
    if (meta.vocab && meta.vocab.length) {
      const rows = meta.vocab.map((v) => `
        <div class="vocab-item">
          <span class="vocab-word">${escapeHtml(v.word)}</span>${v.phonetic ? `<span class="vocab-phon">${escapeHtml(v.phonetic)}</span>` : ""}
          <div class="vocab-mean">${escapeHtml(v.meaning || "")}</div>
          ${v.usage ? `<div class="vocab-usage">📎 ${escapeHtml(v.usage)}</div>` : ""}
        </div>`).join("");
      html += `<div class="card-title">📚 生词提取（${meta.vocab.length} 个）</div><div class="vocab-list">${rows}</div>`;
    }
    return html;
  }

  function renderMeta(meta, rawContent) {
    const box = document.getElementById("solve-result");
    if (!meta) {
      box.insertAdjacentHTML("beforeend", `
        <div class="card">
          <div class="card-title">📌 结果解析</div>
          <div class="muted">未能按结构化格式解析，以上为 AI 原始输出。</div>
          <div class="answer-row">
            <button class="answer-btn" data-answer="correct">✅ 做对了</button>
            <button class="answer-btn" data-answer="wrong">❌ 做错了</button>
            <button class="answer-btn" data-answer="unsure">🤔 没把握</button>
          </div>
        </div>`);
      bindAnswerRow(box, null);
      saveRecord(null, rawContent);
      return;
    }

    const tags = meta.knowledge_points.map((p, i) =>
      `<span class="tag ${i % 2 === 1 ? "alt" : ""}">${p}</span>`).join("");
    const diff = "★".repeat(meta.difficulty) + "☆".repeat(5 - meta.difficulty);

    box.insertAdjacentHTML("beforeend", `
      <div class="card">
        <div class="card-title">📌 题目解析</div>
        <div class="meta-grid">
          <div class="meta-item"><div class="mi-label">所属大类</div><div class="mi-value">${meta.category || "—"}</div></div>
          <div class="meta-item"><div class="mi-label">题型</div><div class="mi-value">${meta.type || "—"}</div></div>
          <div class="meta-item"><div class="mi-label">难度</div><div class="mi-value stars">${diff}</div></div>
          <div class="meta-item"><div class="mi-label">知识点</div><div class="tags">${tags || "<span class='muted'>—</span>"}</div></div>
        </div>
        ${renderEnglishSections(meta)}
        ${meta.tips ? `<div class="card-title">⚠️ 易错点与技巧</div><div class="md">${MD.render(meta.tips)}</div>` : ""}
        <div class="answer-row" id="answer-row">
          <button class="answer-btn" data-answer="correct">✅ 做对了</button>
          <button class="answer-btn" data-answer="wrong">❌ 做错了</button>
          <button class="answer-btn" data-answer="unsure">🤔 没把握</button>
        </div>
        <div class="muted" style="margin-top:8px">💾 记录已自动保存到「历史」，可随时回来标记对错。</div>
      </div>`);
    MD.afterRender(box);
    bindAnswerRow(box, meta);

    saveRecord(meta, rawContent);
  }

  async function saveRecord(meta, rawContent) {
    const question = currentQuestion || getQuestionText();
    const rec = await DB.add({
      subject: currentSubject,
      question,
      image: null,
      solution: meta && meta.solution ? meta.solution : (rawContent || question),
      category: meta ? meta.category : "",
      type: meta ? meta.type : "",
      knowledgePoints: meta ? meta.knowledge_points : ["其他"],
      difficulty: meta ? meta.difficulty : 3,
      tips: meta ? meta.tips : "",
      summary: meta ? meta.summary : "",
      structure: meta ? meta.structure : "",
      sentences: meta ? meta.sentences : [],
      vocab: meta ? meta.vocab : [],
      answer: null,
      raw: rawContent || null
    });
    currentRecordId = rec.id;
  }

  function bindAnswerRow(box, meta) {
    const row = box.querySelector(".answer-row");
    if (!row) return;
    row.querySelectorAll(".answer-btn").forEach((b) => {
      b.addEventListener("click", async () => {
        const ans = b.dataset.answer;
        row.querySelectorAll(".answer-btn").forEach((x) => {
          x.className = "answer-btn " + (x === b ? `selected-${ans}` : "");
        });
        if (currentRecordId) {
          await DB.updateAnswer(currentRecordId, ans);
          toast("已标记：做" + { correct: "对了", wrong: "错了", unsure: "没把握" }[ans]);
        }
      });
    });
  }

  /* ---------------- 历史记录 ---------------- */

  function renderHistory() {
    const filter = localStorage.getItem("kh_history_filter") || "all";
    const chips = `<button class="chip ${filter === "all" ? "active" : ""}" data-f="all">全部</button>` +
      Object.values(SUBJECTS).map((s) =>
        `<button class="chip ${filter === s.key ? "active" : ""}" data-f="${s.key}">${s.icon} ${s.name}</button>`
      ).join("");

    document.getElementById("view").innerHTML = `
      <div class="chips" id="history-chips">${chips}</div>
      <div id="history-list"></div>`;

    document.querySelectorAll("#history-chips .chip").forEach((c) => {
      c.addEventListener("click", () => {
        localStorage.setItem("kh_history_filter", c.dataset.f);
        renderHistory();
      });
    });

    loadHistory(filter);
  }

  async function loadHistory(filter) {
    const listEl = document.getElementById("history-list");
    const all = await DB.getAll();
    const list = filter === "all" ? all : all.filter((r) => r.subject === filter);

    if (list.length === 0) {
      listEl.innerHTML = `<div class="empty"><span class="empty-icon">📭</span>还没有解题记录<br>去「解题」页开始第一题吧</div>`;
      return;
    }

    const badges = {
      correct: '<span class="answer-badge badge-correct">做对了</span>',
      wrong: '<span class="answer-badge badge-wrong">做错了</span>',
      unsure: '<span class="answer-badge badge-unsure">没把握</span>',
      null: '<span class="answer-badge badge-none">未标记</span>'
    };

    listEl.innerHTML = list.map((r) => {
      const s = SUBJECTS[r.subject] || SUBJECTS.math;
      const time = new Date(r.updatedAt || r.createdAt).toLocaleString("zh-CN", {
        month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"
      });
      const tags = (r.knowledgePoints || []).slice(0, 2).map((p) => `<span class="tag">${p}</span>`).join("");
      return `
        <div class="card history-item" data-id="${r.id}">
          <div class="history-top">
            <span class="subject-dot" style="background:${s.color}"></span>
            <b>${s.name}</b>
            <span class="muted">${r.category || ""}${r.type ? " · " + r.type : ""}</span>
            <span class="hist-time">${time}</span>
          </div>
          <div class="hist-q">${(r.question || "").replace(/</g, "&lt;").replace(/>/g, "&gt;") || "（图片题目）"}</div>
          <div class="history-top">${tags} ${badges[r.answer == null ? "null" : r.answer]}</div>
        </div>`;
    }).join("");

    listEl.querySelectorAll(".history-item").forEach((el) => {
      el.addEventListener("click", () => {
        location.hash = "#/solve/record/" + el.dataset.id;
      });
    });
  }

  /* ---------------- 记录详情 ---------------- */

  async function renderRecordDetail(id) {
    const rec = await DB.get(id);
    const view = document.getElementById("view");
    if (!rec) {
      view.innerHTML = `<div class="empty"><span class="empty-icon">😵</span>记录不存在</div>`;
      return;
    }
    const s = SUBJECTS[rec.subject] || SUBJECTS.math;
    currentRecordId = rec.id;

    const tags = (rec.knowledgePoints || []).map((p, i) =>
      `<span class="tag ${i % 2 === 1 ? "alt" : ""}">${p}</span>`).join("");
    const diff = "★".repeat(rec.difficulty || 3) + "☆".repeat(5 - (rec.difficulty || 3));
    const ansClass = { correct: "selected-correct", wrong: "selected-wrong", unsure: "selected-unsure" };

    view.innerHTML = `
      <button class="btn btn-ghost" id="btn-back" style="width:auto;padding:8px 14px;margin-bottom:12px">← 返回历史</button>
      <div class="card">
        <div class="card-title">
          <span><span class="subject-dot" style="background:${s.color};display:inline-block"></span> ${s.name} · ${new Date(rec.updatedAt || rec.createdAt).toLocaleString("zh-CN")}</span>
        </div>
        <div class="md">${MD.render(rec.question || "（图片题目）")}</div>
      </div>
      <div class="solution-box">
        <div class="sb-label">📖 解答</div>
        <div class="md">${MD.render(rec.solution || "")}</div>
      </div>
      <div class="card">
        <div class="card-title">📌 题目解析</div>
        <div class="meta-grid">
          <div class="meta-item"><div class="mi-label">所属大类</div><div class="mi-value">${rec.category || "—"}</div></div>
          <div class="meta-item"><div class="mi-label">题型</div><div class="mi-value">${rec.type || "—"}</div></div>
          <div class="meta-item"><div class="mi-label">难度</div><div class="mi-value stars">${diff}</div></div>
          <div class="meta-item"><div class="mi-label">知识点</div><div class="tags">${tags || "—"}</div></div>
        </div>
        ${renderEnglishSections(rec)}
        ${rec.tips ? `<div class="card-title">⚠️ 易错点与技巧</div><div class="md">${MD.render(rec.tips)}</div>` : ""}
        <div class="answer-row">
          <button class="answer-btn ${rec.answer === "correct" ? ansClass.correct : ""}" data-answer="correct">✅ 做对了</button>
          <button class="answer-btn ${rec.answer === "wrong" ? ansClass.wrong : ""}" data-answer="wrong">❌ 做错了</button>
          <button class="answer-btn ${rec.answer === "unsure" ? ansClass.unsure : ""}" data-answer="unsure">🤔 没把握</button>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn btn-ghost" id="btn-redo" style="flex:1">🔄 重新解答</button>
          <button class="btn btn-danger" id="btn-del" style="flex:1">🗑️ 删除</button>
        </div>
      </div>`;
    MD.afterRender(view);

    document.getElementById("btn-back").addEventListener("click", () => { location.hash = "#/history"; });
    document.getElementById("btn-del").addEventListener("click", async () => {
      if (confirm("确定删除这条记录吗？（同步后其他设备也会删除）")) {
        await DB.softDelete(rec.id);
        toast("已删除");
        location.hash = "#/history";
      }
    });
    document.getElementById("btn-redo").addEventListener("click", () => {
      localStorage.setItem("kh_current_subject", rec.subject);
      location.hash = "#/solve";
      setTimeout(() => {
        const ta = document.getElementById("solve-question");
        if (ta) { ta.value = rec.question || ""; setSubject(rec.subject); }
      }, 50);
    });

    view.querySelectorAll(".answer-btn").forEach((b) => {
      b.addEventListener("click", async () => {
        const ans = b.dataset.answer;
        view.querySelectorAll(".answer-btn").forEach((x) => {
          x.className = "answer-btn " + (x === b ? `selected-${ans}` : "");
        });
        await DB.updateAnswer(rec.id, ans);
        toast("已标记：做" + { correct: "对了", wrong: "错了", unsure: "没把握" }[ans]);
      });
    });
  }

  return { render, renderHistory, renderRecordDetail };
})();
