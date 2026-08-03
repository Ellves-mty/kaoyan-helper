/* 通过 CDP 对页面做真实浏览器冒烟测试 */
const http = require('http');

const PAGE = process.argv[2] || 'http://localhost:8123/index.html';
const ERRORS = [];

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function evalJs(ws, expr, awaitPromise = true) {
  return new Promise((resolve, reject) => {
    const id = ++evalJs.id;
    evalJs.pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression: expr, awaitPromise, returnByValue: true }
    }));
    setTimeout(() => {
      if (evalJs.pending.has(id)) {
        evalJs.pending.delete(id);
        reject(new Error('evaluate timeout: ' + expr));
      }
    }, 15000);
  });
}
evalJs.id = 0;
evalJs.pending = new Map();

async function main() {
  const targets = await getJson('http://localhost:9222/json');
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && evalJs.pending.has(msg.id)) {
      const { resolve, reject } = evalJs.pending.get(msg.id);
      evalJs.pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else if (msg.result && msg.result.exceptionDetails) reject(new Error('JS exception: ' + JSON.stringify(msg.result.exceptionDetails.exception && msg.result.exceptionDetails.exception.description || msg.result.exceptionDetails.text)));
      else resolve(msg.result && msg.result.result ? msg.result.result.value : undefined);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      ERRORS.push('EXCEPTION: ' + JSON.stringify(msg.params.exceptionDetails.exception && msg.params.exceptionDetails.exception.description || ''));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      ERRORS.push('CONSOLE.ERROR: ' + msg.params.args.map((a) => a.value || a.description || '').join(' '));
    }
  };
  await new Promise((r) => setTimeout(r, 500));
  ws.send(JSON.stringify({ id: 999, method: 'Runtime.enable' }));
  await new Promise((r) => setTimeout(r, 300));

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(1500);

  const results = {};
  results.home = await evalJs(ws, `({ title: document.getElementById('view').innerHTML.slice(0, 80), hasCards: !!document.querySelector('.subject-card'), hero: document.querySelector('.home-hero h2') && document.querySelector('.home-hero h2').textContent })`);

  await evalJs(ws, `location.hash = '#/solve'; 'ok'`);
  await sleep(800);
  results.solve = await evalJs(ws, `({ hasTextarea: !!document.getElementById('solve-question'), chips: document.querySelectorAll('#solve-chips .chip').length, btn: !!document.getElementById('btn-solve') })`);

  await evalJs(ws, `location.hash = '#/history'; 'ok'`);
  await sleep(800);
  results.history = await evalJs(ws, `({ chips: document.querySelectorAll('#history-chips .chip').length, list: document.getElementById('history-list').innerHTML.slice(0, 100) })`);

  await evalJs(ws, `location.hash = '#/stats'; 'ok'`);
  await sleep(800);
  results.stats = await evalJs(ws, `({ total: document.querySelector('.mi-value') && document.querySelector('.mi-value').textContent })`);

  await evalJs(ws, `location.hash = '#/settings'; 'ok'`);
  await sleep(800);
  results.settings = await evalJs(ws, `({ hasKeyInput: !!document.getElementById('set-deepseek'), switches: document.querySelectorAll('.switch').length, exportBtn: !!document.getElementById('btn-export') })`);

  /* 模拟解题：填题、点开始，验证流式渲染容器出现（不依赖真实 API key，会走失败分支） */
  await evalJs(ws, `location.hash = '#/solve'; 'ok'`);
  await sleep(800);
  results.input = await evalJs(ws, `
    (async () => {
      const ta = document.getElementById('solve-question');
      ta.value = '求极限 lim_{x->0} sin(x)/x';
      document.getElementById('btn-solve').click();
      await new Promise(r => setTimeout(r, 800));
      return { hasResultBox: !!document.getElementById('solve-result'), resultHtml: document.getElementById('solve-result').innerHTML.slice(0, 120), btnDisabled: document.getElementById('btn-solve').disabled };
    })()`);

  await evalJs(ws, `window.__setSubject = undefined; 'ok'`);
  await sleep(2000);

  console.log(JSON.stringify({ results, errors: ERRORS }, null, 2));
  ws.close();
  process.exit(0);
}

main().catch((e) => { console.error('TEST FAIL:', e.message); process.exit(1); });
