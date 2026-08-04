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

      /* 读取云端文件（自动解压 gzip） */
      const readCloud = async (gist) => {
        const content = gist.files['kaoyan-helper-data.json'].content;
        let j = JSON.parse(content);
        if (j.encoding === 'gzip' && j.payload) {
          const binary = atob(j.payload);
          const u8 = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) u8[i] = binary.charCodeAt(i);
          const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
          j = JSON.parse(await new Response(stream).text());
        }
        return j;
      };

      /* 场景1：设备 A 首次同步（2 条本地记录） */
      await DB.clear();
      await DB.clearTombstones();
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
      const dRec = await DB.add({ subject: 'cs', question: 'D题', solution: '解', category: '进程与线程', type: '选择题', knowledgePoints: ['进程与线程'], difficulty: 2, tips: '', answer: null, answerAt: 4 });
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

      /* 场景5：设备 A 删除记录 B → 删除传播到云端 */
      out.ids = { a: a.id, b: b.id };
      let sdErr = '';
      try { await DB.softDelete(b.id); } catch (e) { sdErr = e.message; }
      out.sdErr = sdErr;
      out.afterSoftDeleteLocal = !!(await DB.get(b.id));
      out.aTomb = !!(await DB.getTombstones()).find(t => t.id === a.id);
      out.bTomb = !!(await DB.getTombstones()).find(t => t.id === b.id);
      out.idsAfter = (await DB.getAll()).map(r => r.id);
      let r5 = null;
      try { r5 = await Sync.syncNow(); } catch (e) { out.syncErr5 = e.message; }
      const gist5 = await (await fetch('http://localhost:8123/gists/' + gistId, { headers: { 'Authorization': 'Bearer test-token' } })).json();
      const file5 = await readCloud(gist5);
      out.r5 = r5 ? { localCount: r5.localCount, changed: r5.changed } : null;
      out.deletedOnCloud = (file5.deleted || []).map(t => t.id);
      let r5b = null;
      try { r5b = await Sync.syncNow(); } catch (e) { out.syncErr5b = e.message; }
      out.r5Idempotent = r5b ? r5b.changed : null;

      /* 场景6：设备 C 持有旧数据（含 B），同步后 B 应被删除，不复活 */
      await DB.clear();
      await DB.clearTombstones();
      for (const r of [a, b, remoteC, dRec]) {
        await DB.putRaw(r);
      }
      out.staleIds = (await DB.getAll()).map(r => r.id);
      out.staleLocalCount = (await DB.getAll()).length;
      let r6 = null;
      try { r6 = await Sync.syncNow(); } catch (e) { out.syncErr6 = e.message; }
      const after6 = await DB.getAll();
      out.r6 = { localCount: after6.length, ids: after6.map(r => r.id), hasB: !!after6.find(x => x.id === b.id) };
      let r6b = null;
      try { r6b = await Sync.syncNow(); } catch (e) { out.syncErr6b = e.message; }
      out.r6Idempotent = r6b ? r6b.changed : null;

      /* 场景7：另一设备在删除之后又编辑了 B（updatedAt > deletedAt）→ 复活 */
      const tombOld = { id: b.id, deletedAt: Date.now() - 60000 };
      const revivedB = { ...b, answer: 'correct', updatedAt: Date.now() };
      const gist7 = await (await fetch('http://localhost:8123/gists/' + gistId, { headers: { 'Authorization': 'Bearer test-token' } })).json();
      const file7 = await readCloud(gist7);
      const otherRecords = (file7.records || []).filter(r => r.id !== b.id);
      await fetch('http://localhost:8123/gists/' + gistId, {
        method: 'PATCH',
        headers: { 'Authorization': 'Bearer test-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: { 'kaoyan-helper-data.json': { content: JSON.stringify({ version: 2, records: [revivedB, ...otherRecords], deleted: [tombOld] }) } } })
      });
      await DB.clear();
      await DB.clearTombstones();
      let r7 = null;
      try { r7 = await Sync.syncNow(); } catch (e) { out.syncErr7 = e.message; }
      const after7 = await DB.getAll();
      const b7 = after7.find(x => x.id === b.id);
      out.r7 = { localCount: after7.length, hasB: !!b7, bAnswer: b7 && b7.answer };

      /* 场景8：gzip 压缩往返 — 新增记录 E 触发推送，云端文件应为 gzip；清空本地后同步应完整恢复 */
      await DB.add({ subject: 'math', question: 'E题', solution: '解', category: '高数', type: '解答题', knowledgePoints: ['极限与连续'], difficulty: 2, tips: '', answer: null, answerAt: 8 });
      let r8 = null;
      try { r8 = await Sync.syncNow(); } catch (e) { out.syncErr8 = e.message; }
      const gist8 = await (await fetch('http://localhost:8123/gists/' + gistId, { headers: { 'Authorization': 'Bearer test-token' } })).json();
      const file8 = gist8.files['kaoyan-helper-data.json'].content;      out.gistIsGzip = file8.includes('"encoding":"gzip"') && !file8.includes('"records":');
      await DB.clear();
      await DB.clearTombstones();
      let r8b = null;
      try { r8b = await Sync.syncNow(); } catch (e) { out.syncErr8b = e.message; }
      const after8 = await DB.getAll();
      out.r8 = {
        localCount: after8.length,
        hasE: !!after8.find(x => x.question === 'E题'),
        hasB: !!after8.find(x => x.id === b.id),
        sizeKB: r8b ? r8b.sizeKB : null
      };

      /* 场景9：迁移到私有仓库（repoEnsure + 推送 + 切换） */
      const st9 = JSON.parse(localStorage.getItem('kh_settings') || '{}');
      st9.repoName = 'kaoyan-helper-data';
      localStorage.setItem('kh_settings', JSON.stringify(st9));
      let r9 = null;
      try { r9 = await Sync.migrateTo('repo'); } catch (e) { out.syncErr9 = e.message; }
      const repoFile = await (await fetch('http://localhost:8123/repos/test-user/kaoyan-helper-data/contents/kaoyan-helper-data.json', { headers: { 'Authorization': 'Bearer test-token' } })).json();
      out.repoStored = !!repoFile.content;
      out.repoIsGzip = repoFile.content && atob(repoFile.content).includes('"encoding":"gzip"');
      out.repoStoredType = API.getSettings().storageType;
      let r9b = null;
      try { r9b = await Sync.syncNow(); } catch (e) { out.syncErr9b = e.message; }
      const after9 = await DB.getAll();
      out.r9 = { migratedCount: r9 ? r9.count : null, localCount: after9.length, hasE: !!after9.find(x => x.question === 'E题') };

      /* 场景10：迁移回 Gist，再同步验证 */
      let r10 = null;
      try { r10 = await Sync.migrateTo('gist'); } catch (e) { out.syncErr10 = e.message; }
      out.migratedBack = API.getSettings().storageType;
      await DB.clear();
      await DB.clearTombstones();
      let r10b = null;
      try { r10b = await Sync.syncNow(); } catch (e) { out.syncErr10b = e.message; }
      out.r10 = { localCount: (await DB.getAll()).length };
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
    result.errMsg.includes('Token 无效') &&
    result.afterSoftDeleteLocal === false &&
    result.r5.localCount === 3 &&
    result.r5.changed === true &&
    result.deletedOnCloud.includes(result.ids.b) &&
    result.r5Idempotent === false &&
    result.r6.localCount === 3 &&
    result.r6.hasB === false &&
    result.r6Idempotent === false &&
    result.r7.localCount === 4 &&
    result.r7.hasB === true &&
    result.r7.bAnswer === 'correct' &&
    result.gistIsGzip === true &&
    result.r8.localCount === 5 &&
    result.r8.hasE === true &&
    result.r8.hasB === true &&
    result.repoStored === true &&
    result.repoIsGzip === true &&
    result.repoStoredType === 'repo' &&
    result.r9.migratedCount === 5 &&
    result.r9.localCount === 5 &&
    result.r9.hasE === true &&
    result.migratedBack === 'gist' &&
    result.r10.localCount === 5;

  console.log(ok ? '=== Gist 同步测试通过 ===' : '=== Gist 同步测试失败 ===');
  ws.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
