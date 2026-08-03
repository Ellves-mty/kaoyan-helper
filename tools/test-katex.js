/* KaTeX 公式渲染测试：真实 CDN 加载 + 用户示例渲染 + 无 KaTeX 时回退 */
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

const EXAMPLE = `已知 $AB = O$，其中 $A, B$ 均为非零矩阵。设 $A$ 为 $m \\times n$ 矩阵，$B$ 为 $n \\times s$ 矩阵，则 $AB = O$ 是 $m \\times s$ 零矩阵。

第一步：由 $AB = O$，$B$ 的每一列都是齐次线性方程组 $A x = 0$ 的解。因此 $r(A) < n$，即 $A$ 的列向量组线性相关。

第二步：对 $AB = O$ 取转置，得 $B^T A^T = O$。因此 $r(B^T) < n$，即 $B$ 的行向量组线性相关。

结论：正确的是 (A)。`;

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

  /* 等 KaTeX CDN 加载 */
  let ready = false;
  for (let i = 0; i < 20; i++) {
    ready = await evalJs(ws, `typeof window.renderMathInElement !== 'undefined'`);
    if (ready) break;
    await sleep(1000);
  }

  const result = await evalJs(ws, `
    (async () => {
      const out = { katexLoaded: typeof window.renderMathInElement !== 'undefined' };

      /* 1. 直接渲染用户示例 */
      const d1 = document.createElement('div');
      d1.innerHTML = MD.render(${JSON.stringify(EXAMPLE)});
      MD.afterRender(d1);
      out.katexCount = d1.querySelectorAll('.katex').length;
      out.hasDisplayMath = !!d1.querySelector('.katex-display');
      out.rawRemaining = (d1.textContent.match(/[$]/g) || []).length;

      /* 2. 完整解题流程中的渲染（mock solve 输出含公式） */
      API.solve = async (opts) => {
        opts.onContent('{"solution":' + JSON.stringify(${JSON.stringify(EXAMPLE)}) + ',"knowledge_points":["行列式","矩阵"],"difficulty":2,"tips":"$r(A)<n$ 即列向量线性相关。","category":"线性代数","type":"选择题"}');
        return { content: '{"solution":' + JSON.stringify(${JSON.stringify(EXAMPLE)}) + ',"knowledge_points":["行列式","矩阵"],"difficulty":2,"tips":"$r(A)<n$ 即列向量线性相关。","category":"线性代数","type":"选择题"}', reasoning: '' };
      };
      location.hash = '#/solve';
      await new Promise(r => setTimeout(r, 600));
      const ta = document.getElementById('solve-question');
      ta.value = 'AB=O 矩阵秩的问题';
      document.getElementById('btn-solve').click();
      await new Promise(r => setTimeout(r, 1200));
      out.solutionKatex = document.querySelectorAll('#solution-text .katex').length;
      out.tipsKatex = document.querySelectorAll('#solve-result .card .md .katex').length;

      /* 2.5 块级公式 $$...$$ */
      const dd = document.createElement('div');
      dd.innerHTML = MD.render('求积分：$$f(x) = \\\\int_0^x e^{t^2}\\\\, dt$$');
      MD.afterRender(dd);
      out.displayKatex = dd.querySelectorAll('.katex-display').length;

      /* 3. 回退：KaTeX 不可用时原样显示 */
      const savedRE = window.renderMathInElement;
      window.renderMathInElement = undefined;
      const d2 = document.createElement('div');
      d2.innerHTML = MD.render('$AB = O$');
      MD.afterRender(d2);
      out.fallbackRaw = d2.textContent.includes('$AB = O$');
      window.renderMathInElement = savedRE;
      return out;
    })()`);

  console.log('RESULT:', JSON.stringify(result, null, 2));
  console.log('EXCEPTIONS:', JSON.stringify(exceptions, null, 2));

  const ok =
    exceptions.length === 0 &&
    result.katexLoaded === true &&
    result.katexCount >= 6 &&
    result.rawRemaining === 0 &&
    result.displayKatex === 1 &&
    result.solutionKatex >= 5 &&
    result.tipsKatex >= 1 &&
    result.fallbackRaw === true;

  console.log(ok ? '=== KaTeX 测试通过 ===' : '=== KaTeX 测试失败 ===');
  ws.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
