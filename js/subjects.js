/* 三科目知识点分类树与系统提示词 */

const SUBJECTS = {
  math: {
    key: "math",
    name: "数学一",
    icon: "∑",
    color: "#2563eb",
    cssClass: "sc-math",
    desc: "高数 · 线代 · 概率统计",
    categories: [
      {
        name: "高等数学",
        points: ["极限与连续", "一元函数微分学", "一元函数积分学", "微分方程", "多元函数微分学", "重积分", "曲线曲面积分", "无穷级数", "空间解析几何"]
      },
      {
        name: "线性代数",
        points: ["行列式", "矩阵", "向量组与线性方程组", "特征值与特征向量", "二次型"]
      },
      {
        name: "概率论与数理统计",
        points: ["随机事件与概率", "随机变量及其分布", "多维随机变量", "数字特征", "大数定律与中心极限定理", "数理统计"]
      }
    ]
  },
  english: {
    key: "english",
    name: "英语一",
    icon: "A",
    color: "#db2777",
    cssClass: "sc-english",
    desc: "阅读 · 翻译 · 写作",
    categories: [
      {
        name: "题型",
        points: ["完形填空", "阅读理解", "新题型", "翻译", "小作文", "大作文"]
      },
      {
        name: "能力点",
        points: ["词汇", "长难句语法", "主旨把握", "细节定位", "逻辑关系", "写作结构"]
      }
    ]
  },
  cs: {
    key: "cs",
    name: "408",
    icon: "CPU",
    cssClass: "sc-cs",
    desc: "数据结构 · 组成原理 · 操作系统 · 网络",
    categories: [
      { name: "数据结构", points: ["线性表", "栈、队列与数组", "树与二叉树", "图", "查找", "排序"] },
      { name: "计算机组成原理", points: ["数据表示与运算", "存储系统", "指令系统", "中央处理器", "总线与输入输出"] },
      { name: "操作系统", points: ["进程与线程", "处理器调度与死锁", "内存管理", "文件管理", "设备管理"] },
      { name: "计算机网络", points: ["体系结构与物理层", "数据链路层", "网络层", "传输层", "应用层"] }
    ]
  }
};

function flatPoints(subject) {
  const out = [];
  SUBJECTS[subject].categories.forEach((c) => c.points.forEach((p) => out.push(p)));
  return out;
}

const JSON_OUTPUT_INSTRUCTION = `
你必须严格按照以下 JSON 格式输出（不要输出任何其他内容，json 键名固定）：
{
  "solution": "完整、详细的解题过程（支持 Markdown 与 LaTeX，LaTeX 行内用 $...$，独立公式用 $$...$$）",
  "category": "题目所属大类",
  "type": "题目类型",
  "knowledge_points": ["知识点1", "知识点2"],
  "difficulty": 3,
  "tips": "易错点与解题技巧总结"
}
其中：
- knowledge_points 只能从给定的【知识点清单】中选择，可多选，最多 3 个；
- difficulty 为 1-5 的整数（1 最简单，5 最难）；
- 若题目信息不完整导致无法判断，knowledge_points 返回 ["其他"]，并在 solution 中说明缺失信息。
`;

const ENGLISH_JSON_INSTRUCTION = `
你必须严格按照以下 JSON 格式输出（不要输出任何其他内容，json 键名固定）：
{
  "solution": "完整、详细的讲解内容（支持 Markdown）",
  "category": "题目所属大类",
  "type": "题目类型",
  "knowledge_points": ["知识点1", "知识点2"],
  "difficulty": 3,
  "tips": "易错点与阅读/做题技巧总结",
  "summary": "全文主旨与作者态度概括（中文为主；整篇解析模式必填，具体题目模式填空字符串）",
  "structure": "段落结构分析，Markdown 列表格式（整篇解析模式必填，具体题目模式填空字符串）",
  "difficult_sentences": [{"sentence": "原句", "grammar": "语法结构分析", "translation": "中文翻译"}],
  "vocab": [{"word": "单词", "phonetic": "音标", "meaning": "中文释义", "usage": "常见搭配或例句"}]
}
其中：
- knowledge_points 只能从【知识点清单】中选择，可多选，最多 3 个；
- difficulty 为 1-5 的整数（1 最简单，5 最难）；
- difficult_sentences 与 vocab 在整篇解析模式必填；具体题目模式填空数组 []；
- vocab 最多 15 个单词，优先挑选考研高频词与文中较难的词；
- 若题目信息不完整导致无法判断，knowledge_points 返回 ["其他"]，并在 solution 中说明缺失信息。
`;

const PROMPTS = {
  math: `你是资深考研数学一辅导老师，负责为考生详细讲解每一道题。
要求：
1. 给出完整、严谨的解题步骤，逐步编号；关键公式用 LaTeX 书写（行内 $...$，独立公式 $$...$$）。
2. 指出本题考查的核心知识点与常见解法（如一题多解可简要补充）。
3. 分析考生常见的易错点（如符号、定义域、收敛性、矩阵运算顺序等）。

【知识点清单】
高等数学：极限与连续；一元函数微分学；一元函数积分学；微分方程；多元函数微分学；重积分；曲线曲面积分；无穷级数；空间解析几何
线性代数：行列式；矩阵；向量组与线性方程组；特征值与特征向量；二次型
概率论与数理统计：随机事件与概率；随机变量及其分布；多维随机变量；数字特征；大数定律与中心极限定理；数理统计

category 填：高等数学 / 线性代数 / 概率论与数理统计 之一。
type 填：选择题 / 填空题 / 解答题 / 证明题 之一。
` + JSON_OUTPUT_INSTRUCTION,

  english: `你是资深考研英语一辅导老师，负责为考生详细讲解英语题目，或对整篇文章进行深度解析。
你收到的输入可能是两种类型，请先自动判断并选择对应模式：

【模式一：具体题目】完形填空、阅读理解小题、新题型、翻译题、写作题。
- 阅读/完形题：先概括原文主旨，再逐项分析每个选项为什么对/为什么错（定位原文关键句并注明出处），给出正确答案。
- 翻译题：先断句并分析句子结构（主干、从句、修饰成分），再给出准确通顺的参考译文，标注易错词汇与短语。
- 写作题：给出写作思路与框架结构，提供亮点句型和参考表达。
- 此模式下 summary / structure / difficult_sentences / vocab 按说明填空。

【模式二：整篇文章/段落】用户粘贴的是完整文章（通常 200 词以上，没有具体问题），执行整篇深度解析：
- summary：全文主旨、作者观点与写作目的（中文概括，可附一句英文原文概括）。
- structure：段落结构分析（每段的作用、段间衔接逻辑、行文脉络，Markdown 列表逐段说明）。
- difficult_sentences：挑出 3-8 句长难句，逐句给出语法结构分析（主干、从句、修饰）与中文翻译。
- vocab：提取文中考研高频词和较难的生词，最多 15 个，每项包含音标、中文释义、常见搭配或例句。
- solution：写一段对整篇文章的阅读评价与理解提示（如文章类型、话题背景、应试策略）。
- knowledge_points 从能力点中选择（如 主旨把握、长难句语法、词汇、逻辑关系）。

【知识点清单】
题型：完形填空；阅读理解；新题型；翻译；小作文；大作文
能力点：词汇；长难句语法；主旨把握；细节定位；逻辑关系；写作结构

category 填题型（整篇解析填 阅读理解）。
type 填：单项选择 / 多项选择 / 翻译题 / 写作题 / 文章解析 / 其他。
` + ENGLISH_JSON_INSTRUCTION,

  cs: `你是资深计算机考研 408 辅导老师（数据结构、计算机组成原理、操作系统、计算机网络），负责为考生详细讲解每一道题。
要求：
1. 选择题：逐项分析每个选项对/错的原因，给出正确答案。
2. 大题：给出完整规范的答题思路、关键步骤与结论，注意书写规范（如时间复杂度、页表计算、报文格式等）。
3. 标注该题考查的核心知识点与常见易错点。

【知识点清单】
数据结构：线性表；栈、队列与数组；树与二叉树；图；查找；排序
计算机组成原理：数据表示与运算；存储系统；指令系统；中央处理器；总线与输入输出
操作系统：进程与线程；处理器调度与死锁；内存管理；文件管理；设备管理
计算机网络：体系结构与物理层；数据链路层；网络层；传输层；应用层

category 填四门课名称之一。
type 填：选择题 / 填空题 / 解答题 / 综合应用题 之一。
` + JSON_OUTPUT_INSTRUCTION
};

/* 粘贴文本的科目自动识别 */
const DETECT_RULES = {
  math: [
    /\blim\s*\(/, /\bint\b/i, /\\frac/, /\\int/, /\\sum/, /f\s*\(\s*x\s*\)/,
    /^设(函数|数列|连续|f)/, /求极限/, /求导/, /(微分|求积分|不定积分|定积分)/, /(微分方程|导数|二阶导)/,
    /(行列式|矩阵|逆矩阵|特征值|特征向量|二次型|秩)/, /(随机变量|概率|分布函数|概率密度|期望|方差|协方差)/,
    /(收敛|发散|级数|幂级数|泰勒|洛必达|等价无穷小)/
  ],
  english: [
    /\breading\b/i, /\bpassage\b/i, /\bparagraph\b/i, /\baccording to\b/i,
    /which of the following/i, /\btranslate\b/i, /\bessay\b/i, /\bcomposition\b/i,
    /(完形填空|阅读理解|新题型|翻译|作文|考研英语)/, /\b(despite|although|however|therefore)\b/i
  ],
  cs: [
    /(时间复杂度|空间复杂度)/, /(二叉树|二叉搜索树|平衡树|哈夫曼|二叉排序树)/, /(栈|队列|链表|线性表|循环队列)/,
    /(哈希|散列|排序|冒泡|快排|归并|堆排序)/, /(进程|线程|死锁|信号量|PV操作|管程|调度算法)/,
    /(分页|分段|虚拟内存|缺页|页表|页面置换)/, /(文件系统|索引节点|目录)/, /\b(CPU|Cache|RAM|ROM)\b/i,
    /(指令|寻址|流水线|中断|DMA|总线)/, /\b(TCP|UDP|IP|HTTP|DNS|ARP|路由|数据链路层|传输层|三次握手)\b/i,
    /(存储系统|主存|磁盘)/, /(计算机网络|网络层|应用层)/
  ]
};

function detectSubject(text, fallback) {
  if (!text) return fallback;
  const scores = { math: 0, english: 0, cs: 0 };
  for (const key of Object.keys(DETECT_RULES)) {
    for (const re of DETECT_RULES[key]) {
      if (re.test(text)) scores[key]++;
    }
  }
  let best = fallback, bestScore = 0;
  for (const key of Object.keys(scores)) {
    if (scores[key] > bestScore) { best = key; bestScore = scores[key]; }
  }
  if (bestScore > 0) return best;
  const latin = (text.match(/[a-zA-Z]/g) || []).length;
  if (latin > 40 && latin / text.length > 0.5) return "english";
  return fallback;
}

function canonicalizePoints(subject, points) {
  const list = flatPoints(subject);
  const out = [];
  if (!Array.isArray(points)) return ["其他"];
  for (let p of points) {
    if (typeof p !== "string") continue;
    const norm = p.trim().replace(/\s+/g, "");
    let matched = null;
    for (const item of list) {
      const itemNorm = item.replace(/\s+/g, "");
      if (itemNorm === norm) { matched = item; break; }
    }
    if (!matched && norm.length >= 2) {
      for (const item of list) {
        const itemNorm = item.replace(/\s+/g, "");
        if (itemNorm.includes(norm) || norm.includes(itemNorm)) { matched = item; break; }
      }
    }
    if (matched && out.indexOf(matched) === -1) out.push(matched);
    else if (!matched) out.push("其他");
  }
  if (out.length === 0) return ["其他"];
  return out;
}
