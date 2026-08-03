/* 阶段2测试：图片输入 → VL 提取 → 确认修正 → 解题 全流程 */
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

  const VL_TEXT = '设函数 $f(x)$ 连续，求极限 $\\\\lim_{x\\\\to 0} \\\\frac{e^x - 1}{x}$。';

  const result = await evalJs(ws, `
    (async () => {
      const out = {};
      const step = async (name, fn) => { try { out[name] = await fn(); } catch (e) { out[name] = 'STEP-ERR: ' + e.message; } };

      await step('nav', async () => {
        location.hash = '#/solve';
        await new Promise(r => setTimeout(r, 600));
        await DB.clear();
        document.querySelector('.input-tab[data-mode="image"]').click();
        await new Promise(r => setTimeout(r, 300));
        return 'ok';
      });

      API.compressImage = async () => 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAAAAAAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
      window.__vlCalls = 0;
      API.extractFromImages = async (opts) => {
        window.__vlCalls = opts.images.length;
        return ${JSON.stringify(VL_TEXT)};
      };
      API.solve = async (opts) => {
        window.__solveQuestion = opts.question;
        opts.onContent('{"solution":"答案：1","knowledge_points":["极限与连续"],"difficulty":2,"tips":"等价无穷小","category":"高等数学","type":"解答题"}');
        return { content: '{"solution":"答案：1","knowledge_points":["极限与连续"],"difficulty":2,"tips":"等价无穷小","category":"高等数学","type":"解答题"}', reasoning: '用等价无穷小替换' };
      };

      /* 配置假通义千问 Key（真实用户会在设置页配置） */
      const st = JSON.parse(localStorage.getItem('kh_settings') || '{}');
      st.dashscopeKey = 'sk-test-fake';
      localStorage.setItem('kh_settings', JSON.stringify(st));

      await step('pick', async () => {
        const dt = new DataTransfer();
        dt.items.add(new File(['x'], 't.jpg', { type: 'image/jpeg' }));
        const input = document.getElementById('img-input');
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 600));
        return {
          thumbnails: document.querySelectorAll('.img-thumb').length,
          btnLabel: document.getElementById('btn-solve').textContent
        };
      });

      await step('extract', async () => {
        document.getElementById('btn-solve').click();
        await new Promise(r => setTimeout(r, 900));
        return {
          confirmCard: !!document.getElementById('extracted-text'),
          extractedText: document.getElementById('extracted-text') ? document.getElementById('extracted-text').value : '',
          resultHtml: document.getElementById('solve-result').innerHTML.slice(0, 300)
        };
      });

      await step('confirm', async () => {
        const ta = document.getElementById('extracted-text');
        ta.value = ta.value + '（已修正）';
        document.getElementById('btn-confirm-extract').click();
        await new Promise(r => setTimeout(r, 1000));
        const records = await DB.getAll();
        return {
          solveQuestion: window.__solveQuestion,
          solutionShown: document.getElementById('solution-text').textContent,
          meta: document.querySelector('#solve-result .meta-item .mi-value') && document.querySelector('#solve-result .meta-item .mi-value').textContent,
          records: records.length,
          recordSubject: records[0] && records[0].subject,
          recordQuestion: records[0] && records[0].question
        };
      });

      return out;
    })()`);

  console.log('RESULT:', JSON.stringify(result, null, 2));
  console.log('EXCEPTIONS:', JSON.stringify(exceptions, null, 2));

  const ok =
    exceptions.length === 0 &&
    result.pick && result.pick.thumbnails === 1 &&
    result.pick.btnLabel.includes('提取题目文字') &&
    result.extract && result.extract.confirmCard === true &&
    result.extract.extractedText.includes('e^x - 1') &&
    result.confirm && result.confirm.solveQuestion.includes('已修正') &&
    result.confirm.solutionShown.includes('答案：1') &&
    result.confirm.meta === '高等数学' &&
    result.confirm.records === 1 &&
    result.confirm.recordSubject === 'math' &&
    result.confirm.recordQuestion.includes('已修正');

  console.log(ok ? '=== 图片流程测试通过 ===' : '=== 图片流程测试失败 ===');
  ws.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
