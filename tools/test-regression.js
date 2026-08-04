/* 回归测试：验证 onReasoning 回调中的 TDZ 崩溃已修复 */
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

  /* 等待应用就绪（全新浏览器配置首次启动较慢） */
  for (let i = 0; i < 30; i++) {
    const ready = await evalJs(ws, `typeof App !== 'undefined' && typeof DB !== 'undefined' && typeof SolveView !== 'undefined'`);
    if (ready) break;
    await sleep(500);
  }

  await evalJs(ws, `location.hash = '#/solve'; 'ok'`);
  await sleep(800);
  await evalJs(ws, `DB.clear(); 'ok'`);

  const result = await evalJs(ws, `
    (async () => {
      API.solve = async (opts) => {
        for (let i = 0; i < 3; i++) opts.onReasoning('第' + (i + 1) + '步思考');
        for (let i = 0; i < 2; i++) opts.onContent('片段' + (i + 1));
        opts.onContent('{"solution":"1+1=2","knowledge_points":["极限与连续"],"difficulty":1,"tips":"注意进位","category":"高等数学","type":"解答题"}');
        return { content: '{"solution":"1+1=2","knowledge_points":["极限与连续"],"difficulty":1,"tips":"注意进位","category":"高等数学","type":"解答题"}', reasoning: '三步思考完毕' };
      };
      const ta = document.getElementById('solve-question');
      ta.value = '1+1=?';
      document.getElementById('btn-solve').click();
      await new Promise(r => setTimeout(r, 1200));
      const saved = await DB.getAll();
      const meta = document.querySelector('#solve-result .meta-item .mi-value');
      return {
        reasoningShown: document.getElementById('reasoning-text').textContent,
        solutionShown: document.getElementById('solution-text').textContent,
        meta: meta && meta.textContent,
        records: saved.length,
        btnReenabled: !document.getElementById('btn-solve').disabled
      };
    })()`);

  console.log('RESULT:', JSON.stringify(result, null, 2));
  console.log('EXCEPTIONS:', JSON.stringify(exceptions, null, 2));
  const ok = exceptions.length === 0 && result.records === 1 && result.btnReenabled && result.meta === '高等数学';
  console.log(ok ? '=== 回归测试通过 ===' : '=== 回归测试失败 ===');
  ws.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
