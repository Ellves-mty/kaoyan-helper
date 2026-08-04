/* 考研倒计时测试 */
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
let evalId = 0;
function evalJs(ws, expr) {
  return new Promise((resolve, reject) => {
    const id = ++evalId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout')); } }, 15000);
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
  };
  await new Promise((r) => setTimeout(r, 500));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  for (let i = 0; i < 30; i++) {
    const ready = await evalJs(ws, `typeof App !== 'undefined'`);
    if (ready) break;
    await sleep(500);
  }

  const out = await evalJs(ws, `(async () => {
    const r = {};
    window.__rejs = [];
    window.addEventListener('unhandledrejection', (e) => {
      window.__rejs.push(String(e.reason && e.reason.message || e.reason));
    });
    r.readyState = document.readyState;
    try { App.init(); r.manualInit = 'ok'; } catch (e) { r.manualInit = 'ERR: ' + e.message; }
    await new Promise(res => setTimeout(res, 1500));
    r.rejections = window.__rejs;
    r.viewAfter = document.getElementById('view').innerHTML.slice(0, 100);
    const st = JSON.parse(localStorage.getItem('kh_settings') || '{}');
    delete st.examDate;
    localStorage.setItem('kh_settings', JSON.stringify(st));
    location.hash = '#/home';
    await new Promise(res => setTimeout(res, 1500));
    r.view = document.getElementById('view').innerHTML.slice(0, 120);
    r.defaultText = (document.querySelector('.home-hero .sub') || { textContent: 'NULL' }).textContent;
    r.daysFn = API.daysUntilExam();
    r.examStr = API.getExamDate().toISOString().slice(0, 10);
    /* 自定义日期 */
    const st2 = JSON.parse(localStorage.getItem('kh_settings') || '{}');
    st2.examDate = '2026-12-26';
    localStorage.setItem('kh_settings', JSON.stringify(st2));
    r.customDays = API.daysUntilExam();
    r.customStr = API.getExamDate().toISOString().slice(0, 10);
    /* 设置页有日期输入框 */
    location.hash = '#/settings';
    await new Promise(res => setTimeout(res, 600));
    r.hasDateInput = !!document.getElementById('set-exam-date');
    return r;
  })()`);

  console.log('RESULT:', JSON.stringify(out, null, 2));
  const ok = out.defaultText.includes('2026年12月19日') && out.defaultText.includes('136 天') && out.customDays === 143 && out.hasDateInput;
  console.log(ok ? '=== 倒计时测试通过 ===' : '=== 倒计时测试失败 ===');
  ws.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
