/* 英语整篇解析测试：主旨/结构/长难句/生词表渲染 + 记录保存 */
const http = require('http');

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

const pending = new Map();
const exceptions = [];
let evalId = 0;

function evalJs(ws, expr) {
  return new Promise((resolve, reject) => {
    const id = ++evalId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error('evaluate timeout: ' + expr.slice(0, 60))); }
    }, 20000);
  });
}

const PASSAGE = 'The rapid development of artificial intelligence has transformed many industries, particularly in the field of medical diagnosis. Despite these advancements, researchers remain concerned about the ethical implications of relying on algorithms to make life-and-death decisions.';

const MOCK_JSON = {
  solution: '本文为科普类议论文，介绍了 AI 在医疗诊断中的应用及其伦理争议。',
  category: '阅读理解',
  type: '文章解析',
  knowledge_points: ['主旨把握', '长难句语法', '词汇'],
  difficulty: 3,
  tips: '注意段首句往往是主旨句；生词可通过上下文推断。',
  summary: '文章主要讨论人工智能在医疗领域的应用前景与伦理隐忧：一方面 AI 大幅提升了诊断效率，另一方面算法做生死决策引发担忧。',
  structure: '- 第1段：引出话题，AI 改变医疗诊断\n- 第2段：转折，提出伦理问题\n- 整体：先扬后抑的议论文结构',
  difficult_sentences: [
    { sentence: 'Despite these advancements, researchers remain concerned about the ethical implications of relying on algorithms to make life-and-death decisions.', grammar: 'Despite 引导让步状语（介词短语），主干为 researchers remain concerned about...，动名词 relying on 作介词宾语，不定式 to make... 作目的状语。', translation: '尽管取得了这些进展，研究人员仍然担忧依赖算法做出生死攸关的决策所带来的伦理影响。' }
  ],
  vocab: [
    { word: 'transformed', phonetic: 'trænsˈfɔːmd', meaning: '改变、转变', usage: 'transform A into B 把A变成B' },
    { word: 'implications', phonetic: 'ˌɪmplɪˈkeɪʃnz', meaning: '影响、含意', usage: 'ethical implications 伦理影响' },
    { word: 'algorithms', phonetic: 'ˈælɡərɪðmz', meaning: '算法', usage: 'rely on algorithms 依赖算法' }
  ]
};

async function main() {
  const targets = await getJson('http://localhost:9222/json');
  const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:8123'));
  if (!page) throw new Error('no app page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else if (msg.result && msg.result.exceptionDetails) {
        const d = msg.result.exceptionDetails;
        reject(new Error('JS exception: ' + (d.exception && d.exception.description || d.text)));
      } else resolve(msg.result && msg.result.result ? msg.result.result.value : undefined);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      exceptions.push(msg.params.exceptionDetails.exception && msg.params.exceptionDetails.exception.description || 'exception');
    }
  };

  await new Promise((r) => setTimeout(r, 500));
  ws.send(JSON.stringify({ id: 0, method: 'Runtime.enable' }));
  await new Promise((r) => setTimeout(r, 300));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const result = await evalJs(ws, `
    (async () => {
      const out = {};
      await DB.clear();
      localStorage.setItem('kh_current_subject', 'math');

      location.hash = '#/solve';
      await new Promise(r => setTimeout(r, 600));

      API.solve = async (opts) => {
        window.__solveSubject = opts.subject;
        const json = JSON.stringify(${JSON.stringify(MOCK_JSON)});
        opts.onContent(json);
        return { content: json, reasoning: '这是一篇议论文' };
      };

      /* 粘贴整篇文章（自动识别为英语） */
      const ta = document.getElementById('solve-question');
      ta.value = ${JSON.stringify(PASSAGE)};
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
      out.detectedSubject = document.querySelector('#solve-chips .chip.active') && document.querySelector('#solve-chips .chip.active').dataset.subject;
      out.placeholder = ta.placeholder;

      document.getElementById('btn-solve').click();
      await new Promise(r => setTimeout(r, 1200));

      const titles = Array.from(document.querySelectorAll('#solve-result .card-title')).map(e => e.textContent);
      out.hasSummary = titles.some(t => t.includes('全文主旨'));
      out.hasStructure = titles.some(t => t.includes('段落结构'));
      out.hasSentences = titles.some(t => t.includes('长难句解析'));
      out.hasVocab = titles.some(t => t.includes('生词提取'));

      out.vocabItems = Array.from(document.querySelectorAll('.vocab-item')).map(v => ({
        word: v.querySelector('.vocab-word').textContent,
        phon: v.querySelector('.vocab-phon') ? v.querySelector('.vocab-phon').textContent : '',
        mean: v.querySelector('.vocab-mean').textContent,
        usage: v.querySelector('.vocab-usage') ? v.querySelector('.vocab-usage').textContent : ''
      }));
      out.summaryText = document.querySelector('#solve-result .card .md') ? document.querySelector('#solve-result .card .md').textContent.slice(0, 50) : '';
      out.sentenceGram = Array.from(document.querySelectorAll('#solve-result .md li')).map(li => li.textContent).find(t => t.includes('Despite')) || '';
      out.tags = Array.from(document.querySelectorAll('#solve-result .tag')).map(t => t.textContent);

      const recs = await DB.getAll();
      out.records = recs.length;
      out.savedSubject = recs[0] && recs[0].subject;
      out.savedVocabLen = recs[0] && recs[0].vocab.length;
      out.savedSentencesLen = recs[0] && recs[0].sentences.length;

      /* 详情页也能显示生词表 */
      location.hash = '#/solve/record/' + recs[0].id;
      await new Promise(r => setTimeout(r, 600));
      out.detailVocab = document.querySelectorAll('.vocab-item').length;

      return out;
    })()`);

  console.log('RESULT:', JSON.stringify(result, null, 2));
  console.log('EXCEPTIONS:', JSON.stringify(exceptions, null, 2));

  const ok =
    exceptions.length === 0 &&
    result.detectedSubject === 'english' &&
    result.placeholder.includes('整篇文章') &&
    result.hasSummary && result.hasStructure && result.hasSentences && result.hasVocab &&
    result.vocabItems.length === 3 &&
    result.vocabItems[0].word === 'transformed' &&
    result.vocabItems[0].phon.includes('træns') &&
    result.vocabItems[0].usage.includes('transform A into B') &&
    result.sentenceGram.includes('Despite') &&
    result.tags.join('|') === '主旨把握|长难句语法|词汇' &&
    result.records === 1 &&
    result.savedSubject === 'english' &&
    result.savedVocabLen === 3 &&
    result.savedSentencesLen === 1 &&
    result.detailVocab === 3;

  console.log(ok ? '=== 英语整篇解析测试通过 ===' : '=== 英语整篇解析测试失败 ===');
  ws.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
