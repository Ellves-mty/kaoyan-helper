/* DeepSeek API 调用（浏览器直连，流式输出） */

const API = (() => {
  const BASE = "https://api.deepseek.com";
  const DASHSCOPE_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1";
  const VL_MODEL = "qwen-vl-plus";

  const VL_SYSTEM_PROMPT = `你是考研辅导助手，负责把图片中的题目内容准确转录为文本。
要求：
1. 只输出题目内容本身，不要解答、不要任何解释或评论。
2. 数学题：所有公式必须用 LaTeX 书写，行内用 $...$，独立公式用 $$...$$；符号务必准确（极限、积分、上下标、希腊字母、矩阵、向量等）。
3. 英语题：原文逐字转录，保留段落与换行结构。
4. 408 题：数据结构图/树/图结构用文本准确描述（如树可写成 前序:... 中序:... 或缩进文本形式）。
5. 图片中包含多道题时，按顺序全部转录，题与题之间用空行分隔。
6. 图片过小、模糊或无法识别时，只输出：无法识别`;

  function getSettings() {
    const s = JSON.parse(localStorage.getItem("kh_settings") || "{}");
    return Object.assign({
      deepseekKey: "",
      dashscopeKey: "",
      thinking: true,
      effort: "high",
      githubToken: "",
      gistId: "",
      storageType: "gist",
      repoName: "",
      repoOwner: "",
      examDate: ""
    }, s);
  }

  /* 考研日期：优先用设置值；未设置时用今年 12 月 19 日（历年惯例 12 月第三个周末），已过则顺延明年 */
  function getExamDate() {
    const s = getSettings();
    if (s.examDate && !isNaN(new Date(s.examDate + "T00:00:00").getTime())) {
      return new Date(s.examDate + "T00:00:00");
    }
    const now = new Date();
    const d = new Date(now.getFullYear(), 11, 19);
    if (d.getTime() < now.getTime()) d.setFullYear(now.getFullYear() + 1);
    return d;
  }

  function daysUntilExam() {
    const exam = getExamDate();
    return Math.max(0, Math.round((exam - new Date()) / 86400000));
  }

  function saveSettings(s) {
    localStorage.setItem("kh_settings", JSON.stringify(s));
  }

  async function testDeepSeek(key) {
    const res = await fetch(BASE + "/models", {
      headers: { Authorization: "Bearer " + (key || getSettings().deepseekKey) }
    });
    if (!res.ok) {
      let msg = "HTTP " + res.status;
      try { const j = await res.json(); msg = j.error && j.error.message || msg; } catch (e) {}
      throw new Error(msg);
    }
    const j = await res.json();
    return (j.data || []).map((m) => m.id);
  }

  async function testDashScope(key) {
    const res = await fetch(DASHSCOPE_BASE + "/models", {
      headers: { Authorization: "Bearer " + (key || getSettings().dashscopeKey) }
    });
    if (!res.ok) {
      let msg = "HTTP " + res.status;
      try {
        const j = await res.json();
        msg = (j.error && (j.error.message || j.error.code)) || msg;
      } catch (e) {}
      throw new Error(msg);
    }
    const j = await res.json();
    return (j.data || []).map((m) => m.id);
  }

  /* 通义千问 VL 提取图片中的题目文本
     opts: { images: [dataUrl...], signal }
     返回提取出的文本 */
  async function extractFromImages(opts) {
    const s = getSettings();
    if (!s.dashscopeKey) throw new Error("请先在「设置」中填写通义千问 API Key（图片识别用）");
    if (!opts.images || opts.images.length === 0) throw new Error("没有图片");

    const userContent = [
      { type: "text", text: "请将图片中的题目完整转录为文本。若有无法识别的内容，尽量按上下文推断，无法推断的部分用 [无法识别] 标注。" }
    ];
    for (const img of opts.images) {
      userContent.push({ type: "image_url", image_url: { url: img } });
    }

    const body = {
      model: VL_MODEL,
      messages: [
        { role: "system", content: VL_SYSTEM_PROMPT },
        { role: "user", content: userContent }
      ]
    };

    const res = await fetch(DASHSCOPE_BASE + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + s.dashscopeKey
      },
      body: JSON.stringify(body),
      signal: opts.signal
    });

    if (!res.ok) {
      let msg = "HTTP " + res.status;
      try {
        const j = await res.json();
        msg = (j.error && (j.error.message || j.error.code)) || msg;
      } catch (e) {}
      throw new Error(msg);
    }

    const j = await res.json();
    const text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    return String(text || "").trim();
  }

  /* 针对薄弱知识点出题（考研真题风格，非流式） */
  async function generateProblem(subject, point) {
    const s = getSettings();
    if (!s.deepseekKey) throw new Error("请先在「设置」中填写 DeepSeek API Key");
    const subj = SUBJECTS[subject] || SUBJECTS.math;
    const system = `你是考研${subj.name}命题老师。请围绕指定知识点，出一道考研真题风格的练习题。
要求：
1. 难度贴合考研真题水平（区分选择/填空/解答的考查深度）。
2. 数学一：公式用 LaTeX（行内 $...$）；408：如需可包含简短代码或结构描述；英语一：针对词汇/长难句出小练习。
3. 只出题，不要给出答案或解析过程。
4. 必须严格按 JSON 输出，不要输出其他内容：
{"question": "题目内容", "type": "选择题|填空题|解答题|证明题|翻译题", "difficulty": 2, "hint": "不含答案的答题提示，可为空字符串"}`;

    const body = {
      model: "deepseek-v4-flash",
      messages: [
        { role: "system", content: system },
        { role: "user", content: "知识点：" + point }
      ],
      stream: false,
      max_tokens: 2000,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" }
    };

    const res = await fetch(BASE + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + s.deepseekKey
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      let msg = "HTTP " + res.status;
      try { const j = await res.json(); msg = (j.error && (j.error.message || j.error.code)) || msg; } catch (e) {}
      throw new Error(msg);
    }
    const j = await res.json();
    let text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
    text = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    let obj = null;
    try { obj = JSON.parse(text); } catch (e) {}
    if (!obj) {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start !== -1 && end > start) {
        try { obj = JSON.parse(text.slice(start, end + 1)); } catch (e2) {}
      }
    }
    if (!obj || !obj.question) throw new Error("出题失败，请重试");
    return {
      question: String(obj.question).trim(),
      type: String(obj.type || "解答题").trim(),
      difficulty: Math.min(5, Math.max(1, parseInt(obj.difficulty, 10) || 2)),
      hint: String(obj.hint || "").trim()
    };
  }

  /* 浏览器端图片压缩：最大边 1600px，JPEG 0.85 */
  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let w = img.width, h = img.height;
          const MAX = 1600;
          if (Math.max(w, h) > MAX) {
            const scale = MAX / Math.max(w, h);
            w = Math.round(w * scale);
            h = Math.round(h * scale);
          }
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.85));
        };
        img.onerror = () => reject(new Error("图片解析失败"));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error("文件读取失败"));
      reader.readAsDataURL(file);
    });
  }

  /* 流式解题：
     opts: { subject, question, onReasoning(chunk), onContent(chunk), signal }
     返回 { content, reasoning } */
  async function solve(opts) {
    const s = getSettings();
    if (!s.deepseekKey) throw new Error("请先在「设置」中填写 DeepSeek API Key");
    const system = PROMPTS[opts.subject] || PROMPTS.math;
    const messages = [
      { role: "system", content: system },
      { role: "user", content: "请解答以下题目：\n\n" + opts.question }
    ];
    const body = {
      model: "deepseek-v4-flash",
      messages,
      stream: true,
      max_tokens: 8000,
      response_format: { type: "json_object" }
    };
    if (s.thinking) {
      body.thinking = { type: "enabled" };
      body.reasoning_effort = s.effort;
    } else {
      body.thinking = { type: "disabled" };
    }

    const res = await fetch(BASE + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + s.deepseekKey
      },
      body: JSON.stringify(body),
      signal: opts.signal
    });

    if (!res.ok) {
      let msg = "HTTP " + res.status;
      try { const j = await res.json(); msg = (j.error && (j.error.message || j.error.code)) || msg; } catch (e) {}
      throw new Error(msg);
    }

    if (!res.body) {
      const j = await res.json();
      return { content: j.choices[0].message.content || "", reasoning: j.choices[0].message.reasoning_content || "" };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let content = "";
    let reasoning = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop();
      for (const chunk of chunks) {
        const line = chunk.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let j;
        try { j = JSON.parse(data); } catch (e) { continue; }
        const delta = j.choices && j.choices[0] && j.choices[0].delta;
        if (!delta) continue;
        if (delta.reasoning_content) {
          reasoning += delta.reasoning_content;
          if (opts.onReasoning) opts.onReasoning(delta.reasoning_content);
        }
        if (delta.content) {
          content += delta.content;
          if (opts.onContent) opts.onContent(delta.content);
        }
      }
    }
    return { content, reasoning };
  }

  /* 解析解题 JSON（容错：剥代码围栏、找第一个 { ... } 或整体解析） */
  function parseSolution(raw, subject) {
    if (!raw) return null;
    let text = raw.trim();
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    let obj = null;
    try { obj = JSON.parse(text); } catch (e) {}
    if (!obj) {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start !== -1 && end > start) {
        try { obj = JSON.parse(text.slice(start, end + 1)); } catch (e2) {}
      }
    }
    if (!obj || typeof obj !== "object") return null;
    const cleanStr = (v) => String(v || "").trim();
    return {
      solution: cleanStr(obj.solution),
      category: cleanStr(obj.category),
      type: cleanStr(obj.type),
      knowledge_points: canonicalizePoints(subject || "math", obj.knowledge_points),
      difficulty: Math.min(5, Math.max(1, parseInt(obj.difficulty, 10) || 3)),
      tips: cleanStr(obj.tips),
      summary: cleanStr(obj.summary),
      structure: cleanStr(obj.structure),
      sentences: Array.isArray(obj.difficult_sentences)
        ? obj.difficult_sentences.filter((s) => s && (s.sentence || s.grammar)).map((s) => ({
            sentence: cleanStr(s.sentence),
            grammar: cleanStr(s.grammar),
            translation: cleanStr(s.translation)
          }))
        : [],
      vocab: Array.isArray(obj.vocab)
        ? obj.vocab.filter((v) => v && v.word).map((v) => ({
            word: cleanStr(v.word),
            phonetic: cleanStr(v.phonetic),
            meaning: cleanStr(v.meaning),
            usage: cleanStr(v.usage)
          })).slice(0, 15)
        : []
    };
  }

  return { solve, parseSolution, getSettings, saveSettings, testDeepSeek, testDashScope, extractFromImages, compressImage, getExamDate, daysUntilExam, generateProblem };
})();
