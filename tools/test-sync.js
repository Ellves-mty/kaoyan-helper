/* 阶段4测试：Gist 同步（创建→合并→冲突→幂等→错误） */
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
    }, 25000);
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
      window.KH_GIST_BASE = 'http://localhost:8123';

      const setToken = (t) => {
        const s = JSON.parse(localStorage.getItem('kh_settings') || '{}');
        s.githubToken = t;
        localStorage.setItem('kh_settings', JSON.stringify(s));
      };

      /* 场景1：设备 A 首次同步（2 条本地记录） */
      await DB.clear();
      const a = await DB.add({ subject: 'math', question: 'A题', solution: '解', category: '高数', type: '选择题', knowledgePoints: ['极限与连续'], difficulty: 2, tips: '', answer: 'wrong', answerAt: 1 });
      const b = await DB.add({ subject: 'english', question: 'B题', solution: '解', category: '阅读理解', type: '选择题', knowledgePoints: ['词汇'], difficulty: 3, tips: '', answer: 'correct', answerAt: 2 });
      setToken('test-token');
      /* 诊断：直接 fetch 同接口，捕获原始响应头 */
      const probe = await fetch('http://localhost:8123/gists?per_page=100', {
        headers: { 'Authorization': 'Bearer ' + 'test-token' }
      });
      out.probeStatus = probe.status;
      out.probeAuth = probe.headers.get('X-Debug-Auth') || '';
      /* 复现 Sync.gh() 的完整请求头 */
      const probe2 = await fetch('http://localhost:8123/gists?per_page=100', {
        headers: {
          'Authorization': 'Bearer test-token',
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'kaoyan-helper-pwa'
        }
      });
      out.probe2Status = probe2.status;
      out.probe2Auth = probe2.headers.get('X-Debug-Auth') || '';
      out.settingsToken = API.getSettings().githubToken;
      out.khBase = window.KH_GIST_BASE;
      /* 用同样逻辑构造 URL 直连 */
      const probe3 = await fetch((window.KH_GIST_BASE || 'https://api.github.com') + '/gists?per_page=100', {
        headers: { 'Authorization': 'Bearer ' + API.getSettings().githubToken }
      });
      out.probe3Status = probe3.status;
      out.probe3Auth = probe3.headers.get('X-Debug-Auth') || '';
      /* 检查页面加载的 sync.js 是否为最新版 */
      const src = await (await fetch('http://localhost:8123/js/sync.js?t=' + Date.now())).text();
      out.syncJsLazy = src.includes('gistBase()');
      let r1 = null;
      try { r1 = await Sync.syncNow(); } catch (e) { out.syncErr = e.message; }
      out.r1 = r1 ? { created: r1.created, localCount: r1.localCount, remoteCount: r1.remoteCount } : null;
      const gistId = API.getSettings().gistId;
      out.gistIdSaved = !!gistId;

      /* 场景2：设备 B 编辑了 A 题（updatedAt 更新）+ 新增远程记录 C */
      await new Promise(r => setTimeout(r, 20));
      const newerA = await DB.get(a.id);
      newerA.answer = 'correct';
      newerA.updatedAt = Date.now() + 5000;
      const remoteC = {
        id: 'remote-c', subject: 'cs', question: 'C题', solution: '解', category: '操作系统', type: '选择题',
        knowledgePoints: ['进程与线程'], difficulty: 2, tips: '', answer: 'unsure', answerAt: 3,
        createdAt: Date.now(), updatedAt: Date.now() + 3000
      };
      const remoteRecords = [newerA, b, remoteC];
      const gistRes = await fetch('http://localhost:8123/gists/' + gistId, {
        method: 'PATCH',
        headers: { 'Authorization': 'Bearer test-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: { 'kaoyan-helper-data.json': { content: JSON.stringify({ version: 1, records: remoteRecords }) } } })
      });
      out.patchOk = gistRes.ok;

      /* 设备 B 本地只有 1 条记录，同步后应合并为 3 条，A 采用新版本 */
      await DB.clear();
      await DB.add({ subject: 'cs', question: 'D题', solution: '解', category: '进程与线程', type: '选择题', knowledgePoints: ['进程与线程'], difficulty: 2, tips: '', answer: null, answerAt: 4 });
      let r2 = null;
      try { r2 = await Sync.syncNow(); } catch (e) { out.syncErr2 = e.message; }
      const merged = await DB.getAll();
      const a2 = merged.find(x => x.id === a.id);
      out.r2 = r2 ? { localCount: r2.localCount, mergedCount: merged.length, aAnswer: a2 && a2.answer, hasC: !!merged.find(x => x.id === 'remote-c'), hasB: !!merged.find(x => x.id === b.id) } : null;

      /* 场景3：无变化再同步 → 不推送（changed=false） */
      let r3 = null;
      try { r3 = await Sync.syncNow(); } catch (e) { out.syncErr3 = e.message; }
      out.r3 = r3 ? { changed: r3.changed, localCount: r3.localCount } : null;

      /* 场景4：错误 Token */
      setToken('wrong-token');
      let errMsg = '';
      try { await Sync.syncNow(); } catch (e) { errMsg = e.message; }
      out.errMsg = errMsg;
      setToken('test-token');
      return out;
    })()`);
  console.log('RESULT:', JSON.stringify(result, null, 2));
  console.log('EXCEPTIONS:', JSON.stringify(exceptions, null, 2));

  const ok =
    exceptions.length === 0 &&
    result.r1.created === true &&
    result.r1.localCount === 2 &&
    result.r1.remoteCount === 0 &&
    result.gistIdSaved === true &&
    result.patchOk === true &&
    result.r2.localCount === 4 &&
    result.r2.mergedCount === 4 &&
    result.r2.aAnswer === 'correct' &&
    result.r2.hasC === true &&
    result.r2.hasB === true &&
    result.r3.changed === false &&
    result.r3.localCount === 4 &&
    result.errMsg.includes('Token 无效');

  console.log(ok ? '=== Gist 同步测试通过 ===' : '=== Gist 同步测试失败 ===');
  ws.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
