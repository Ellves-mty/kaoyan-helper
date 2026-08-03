/* 阶段3测试：统计页聚合、柱状图颜色、薄弱点排序、科目筛选 */
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

      const mk = (subject, pts, answer) => DB.add({
        subject, question: '题', solution: '解', category: 'c', type: 't',
        knowledgePoints: pts, difficulty: 3, tips: '', answer, answerAt: Date.now()
      });

      /* math: 极限与连续 50%(1对1错), 矩阵 0%(1错), 行列式 100%(2对), 微分方程 未标记 */
      await mk('math', ['极限与连续'], 'correct');
      await mk('math', ['极限与连续'], 'wrong');
      await mk('math', ['矩阵'], 'wrong');
      await mk('math', ['行列式'], 'correct');
      await mk('math', ['行列式'], 'correct');
      await mk('math', ['微分方程'], null);
      /* english: 阅读理解 100%, 长难句语法 0% */
      await mk('english', ['阅读理解'], 'correct');
      await mk('english', ['长难句语法'], 'wrong');
      /* cs: 进程与线程 100% */
      await mk('cs', ['进程与线程'], 'correct');

      location.hash = '#/stats';
      await new Promise(r => setTimeout(r, 800));

      const mi = (i) => { const els = document.querySelectorAll('.stat-summary .meta-item .mi-value'); return els[i] ? els[i].textContent : null; };
      out.overview = [mi(0), mi(1), mi(2), mi(3), mi(4)].join('|');

      out.weakNames = Array.from(document.querySelectorAll('.weak-item .weak-name')).map(e => e.textContent);
      out.weakRates = Array.from(document.querySelectorAll('.weak-item .weak-rate')).map(e => e.textContent);

      /* 切到数学一，只看数学的柱状图 */
      document.querySelector('#stats-chips .chip[data-f="math"]').click();
      await new Promise(r => setTimeout(r, 500));
      out.mathBars = Array.from(document.querySelectorAll('.stat-bar-row')).map(r => {
        const fill = r.querySelector('.stat-bar-fill');
        return { label: r.querySelector('.stat-bar-label').textContent, color: fill.style.background, info: r.querySelector('.stat-bar-info').textContent };
      });

      /* 切到英语 */
      document.querySelector('#stats-chips .chip[data-f="english"]').click();
      await new Promise(r => setTimeout(r, 500));
      out.englishBars = Array.from(document.querySelectorAll('.stat-bar-row')).map(r => r.querySelector('.stat-bar-label').textContent);

      /* 切到 408 */
      document.querySelector('#stats-chips .chip[data-f="cs"]').click();
      await new Promise(r => setTimeout(r, 500));
      out.csBars = Array.from(document.querySelectorAll('.stat-bar-row')).map(r => r.querySelector('.stat-bar-label').textContent);
      out.csWeak = Array.from(document.querySelectorAll('.weak-item .weak-name')).map(e => e.textContent);

      /* 切回全部 */
      document.querySelector('#stats-chips .chip[data-f="all"]').click();
      await new Promise(r => setTimeout(r, 500));
      out.allCards = document.querySelectorAll('#stats-body .card .stat-bar-row').length;
      return out;
    })()`);

  console.log('RESULT:', JSON.stringify(result, null, 2));
  console.log('EXCEPTIONS:', JSON.stringify(exceptions, null, 2));

  const bars = result.mathBars || [];
  const bar = (name) => bars.find(b => b.label === name) || {};
  const ok =
    exceptions.length === 0 &&
    result.overview === '9|8|5|3|63%' &&
    result.weakNames[0] === '矩阵' && result.weakNames[1] === '长难句语法' && result.weakRates[0] === '0%' && result.weakRates[2] === '50%' &&
    bars.length === 4 &&
    bar('矩阵').color === 'rgb(239, 68, 68)' &&
    bar('行列式').color === 'rgb(22, 163, 74)' &&
    bar('微分方程').color === 'rgb(147, 197, 253)' &&
    bar('极限与连续').color === 'rgb(245, 158, 11)' &&
    result.englishBars.length === 2 &&
    result.csBars.length === 1 &&
    result.csWeak.length === 1 &&
    result.allCards === 7;

  console.log(ok ? '=== 统计页测试通过 ===' : '=== 统计页测试失败 ===');
  ws.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
