/* 线上站点验证：首页渲染、无 JS 错误、SW 注册、KaTeX 加载 */
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
      if (pending.has(id)) { pending.delete(id); reject(new Error('timeout: ' + expr.slice(0, 50))); }
    }, 25000);
  });
}

async function main() {
  const targets = await getJson('http://localhost:9222/json');
  const page = targets.find((t) => t.type === 'page' && t.url.includes('github.io'));
  if (!page) throw new Error('no page target');
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

  await sleep(3000);
  const out = await evalJs(ws, `(async () => {
    const r = {};
    r.url = location.href;
    r.hero = document.querySelector('.home-hero h2') ? document.querySelector('.home-hero h2').textContent : 'none';
    r.cards = document.querySelectorAll('.subject-card').length;
    r.tabs = document.querySelectorAll('.tab').length;
    r.appLoaded = typeof App !== 'undefined' && typeof DB !== 'undefined' && typeof API !== 'undefined' && typeof Sync !== 'undefined';
    r.swRegistered = 'serviceWorker' in navigator ? !!(navigator.serviceWorker.controller) : false;
    try { const regs = await navigator.serviceWorker.getRegistrations(); r.swRegs = regs.length; } catch (e) { r.swRegs = 'err'; }
    r.katexLoaded = typeof window.renderMathInElement !== 'undefined';
    r.pdfjsLoaded = typeof window.pdfjsLib !== 'undefined';
    r.title = document.title;
    return r;
  })()`);

  /* 切到设置页验证路由 */
  await evalJs(ws, `location.hash = '#/settings'; 'ok'`);
  await sleep(800);
  out.settingsRendered = await evalJs(ws, `!!document.getElementById('set-deepseek')`);

  console.log('RESULT:', JSON.stringify(out, null, 2));
  console.log('EXCEPTIONS:', JSON.stringify(exceptions, null, 2));
  const ok =
    exceptions.length === 0 &&
    out.cards === 3 &&
    out.tabs === 5 &&
    out.appLoaded === true &&
    out.swRegs >= 1 &&
    out.katexLoaded === true &&
    out.pdfjsLoaded === true &&
    out.settingsRendered === true;
  console.log(ok ? '=== 线上部署验证通过 ===' : '=== 线上部署验证失败 ===');
  ws.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
