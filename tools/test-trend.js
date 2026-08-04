/* 学习趋势 + 薄弱点出题练习 测试 */
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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout: ' + expr.slice(0, 50))); } }, 25000);
  });
}

async function main() {
  const targets = await getJson('http://localhost:9222/json');
  const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:8123'));
  if (!page) throw new Error('no page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else if (msg.result && msg.result.exceptionDetails) p.reject(new Error('ex: ' + (msg.result.exceptionDetails.exception && msg.result.exceptionDetails.exception.description || msg.result.exceptionDetails.text)));
      else p.resolve(msg.result && msg.result.result ? msg.result.result.value : undefined);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      exceptions.push(msg.params.exceptionDetails.exception && msg.params.exceptionDetails.exception.description || 'exception');
    }
  };
  await new Promise((r) => setTimeout(r, 500));
  ws.send(JSON.stringify({ id: 0, method: 'Runtime.enable' }));
  await new Promise((r) => setTimeout(r, 300));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 30; i++) {
    const ready = await evalJs(ws, `typeof App !== 'undefined'`);
    if (ready) break;
    await sleep(500);
  }

  const out = await evalJs(ws, `(async () => {
    const r = {};
    await DB.clear();
    await DB.clearTombstones();
    const DAY = 86400000;
    let seedSeq = 0;
    const mk = (subject, pts, answer, daysAgo) => {
      const t = Date.now() - daysAgo * DAY;
      return DB.putRaw({ id: 'seed-' + (++seedSeq), subject, question: 'q', solution: 's', category: 'c', type: 't', knowledgePoints: pts, difficulty: 3, tips: '', answer, createdAt: t, updatedAt: t });
    };
    /* 今天: 极限 1对1错, 英语 1对; 昨天: 矩阵 1错; 3天前: 进程 2对; 10天前: 行列式 1错; 30天前: 高数 1对(超出14天窗口) */
    await mk('math', ['极限与连续'], 'correct', 0);
    await mk('math', ['极限与连续'], 'wrong', 0);
    await mk('english', ['阅读理解'], 'correct', 0);
    await mk('math', ['矩阵'], 'wrong', 1);
    await mk('cs', ['进程与线程'], 'correct', 3);
    await mk('cs', ['进程与线程'], 'correct', 3);
    await mk('math', ['行列式'], 'wrong', 10);
    await mk('math', ['极限与连续'], 'correct', 30);

    location.hash = '#/stats';
    await new Promise(res => setTimeout(res, 1000));

    r.trendTitle = (document.querySelector('.card-title') || { textContent: '' }).textContent;
    r.dayRects = document.querySelectorAll('.trend-tabs + svg rect, .trend-tab + svg rect, svg rect').length;
    r.hasPolyline = !!document.querySelector('svg polyline');
    r.hasTrend = document.body.textContent.includes('学习趋势');

    /* 切到按周 */
    const weekTab = Array.from(document.querySelectorAll('.trend-tab')).find(t => t.dataset.mode === 'week');
    weekTab.click();
    await new Promise(res => setTimeout(res, 800));
    r.weekTitle = document.body.textContent.includes('最近 12 周');
    r.weekRects = document.querySelectorAll('svg rect').length;

    /* 出题练习（mock） */
    window.__genCalls = 0;
    API.generateProblem = async (subject, point) => {
      window.__genCalls++;
      window.__genSubject = subject;
      window.__genPoint = point;
      return { question: '设函数 $f(x)$ 连续，求极限 $\\\\lim_{x\\\\to 0} \\\\frac{f(x)}{x}$。', type: '解答题', difficulty: 3, hint: '考虑等价无穷小替换' };
    };
    const firstBtn = document.querySelector('.weak-practice');
    r.weakBtnExists = !!firstBtn;
    firstBtn.click();
    await new Promise(res => setTimeout(res, 800));
    r.genCalled = window.__genCalls;
    r.genPoint = window.__genPoint;
    r.problemCard = document.body.textContent.includes('针对性练习');
    r.problemText = (document.querySelector('#problem-result') || {}).textContent ? document.querySelector('#problem-result').textContent.includes('lim') : false;

    /* 跳转解题页 */
    document.getElementById('btn-solve-problem').click();
    await new Promise(res => setTimeout(res, 800));
    const ta = document.getElementById('solve-question');
    r.solveQuestionLoaded = !!ta && ta.value.includes('lim');
    const chip = document.querySelector('#solve-chips .chip.active');
    r.chipSubject = chip ? chip.dataset.subject : 'none';
    return r;
  })()`);

  console.log('RESULT:', JSON.stringify(out, null, 2));
  console.log('EXCEPTIONS:', JSON.stringify(exceptions, null, 2));
  const ok =
    exceptions.length === 0 &&
    out.hasTrend === true &&
    out.dayRects === 14 &&
    out.hasPolyline === true &&
    out.weekTitle === true &&
    out.weekRects === 12 &&
    out.weakBtnExists === true &&
    out.genCalled === 1 &&
    out.genPoint === '矩阵' &&
    out.problemCard === true &&
    out.problemText === true &&
    out.solveQuestionLoaded === true &&
    out.chipSubject === 'math';
  console.log(ok ? '=== 趋势+出题测试通过 ===' : '=== 趋势+出题测试失败 ===');
  ws.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
