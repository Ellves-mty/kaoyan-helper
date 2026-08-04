/* 阶段4测试：PDF 文本提取（DOM.setFileInputFiles 真实机制） */
const http = require('http');
const fs = require('fs');
const path = require('path');

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
    }, 30000);
  });
}

function cdpCall(ws, method, params) {
  return new Promise((resolve, reject) => {
    const id = ++evalId;
    pending.set(id, { resolve, reject, isCdp: true });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error('cdp timeout: ' + method)); }
    }, 10000);
  });
}

const PDF_TEXT = 'According to the passage, which of the following is true about the author?';

/* 在 node 端生成一个真实 PDF 文件（供 DOM.setFileInputFiles 使用） */
function buildPdf(text) {
  const esc = text.replace(/[()\\]/g, '\\$&');
  const header = '%PDF-1.4\n';
  const stream = 'BT /F1 12 Tf 72 720 Td (' + esc + ') Tj ET';
  const parts = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    '4 0 obj\n<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream\nendobj\n',
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'
  ];
  let pos = header.length;
  const offsets = [];
  for (const p of parts) {
    offsets.push(pos);
    pos += Buffer.byteLength(p, 'utf8');
  }
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (const off of offsets) xref += String(off).padStart(10, '0') + ' 00000 n \n';
  const trailer = 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + pos + '\n%%EOF';
  return header + parts.join('') + xref + trailer;
}

async function main() {
  const pdfPath = path.join(process.env.TEMP || '/tmp', 'kaoyan-test-passage.pdf');
  fs.writeFileSync(pdfPath, buildPdf(PDF_TEXT));

  const targets = await getJson('http://localhost:9222/json');
  const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:8123'));
  if (!page) throw new Error('no app page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject, isCdp } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else if (msg.result && msg.result.exceptionDetails) {
        const d = msg.result.exceptionDetails;
        reject(new Error('JS exception: ' + (d.exception && d.exception.description || d.text)));
      } else if (isCdp) resolve(msg.result);
      else if (msg.result && msg.result.result) resolve(msg.result.result.value);
      else resolve(undefined);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      exceptions.push(msg.params.exceptionDetails.exception && msg.params.exceptionDetails.exception.description || 'exception');
    }
  };

  await new Promise((r) => setTimeout(r, 500));
  await cdpCall(ws, 'Runtime.enable', {});
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const out = {};
  for (let i = 0; i < 25; i++) {
    out.pdfjsLoaded = await evalJs(ws, `typeof window.pdfjsLib !== 'undefined'`);
    if (out.pdfjsLoaded) break;
    await sleep(1000);
  }

  await evalJs(ws, `(async () => {
    await DB.clear();
    localStorage.setItem('kh_current_subject', 'math');
    window.__toasts = [];
    const ot = window.toast;
    window.toast = (m) => { window.__toasts.push(String(m)); ot(m); };
    location.hash = '#/solve';
    await new Promise(r => setTimeout(r, 600));
    document.querySelector('.input-tab[data-mode="file"]').click();
    await new Promise(r => setTimeout(r, 300));
    return document.querySelector('.input-tab.active').dataset.mode;
  })()`);

  /* 决定性实验1：.txt 文件（同一条 handler 路径） */
  const txtPath = path.join(process.env.TEMP || '/tmp', 'kaoyan-test-question.txt');
  fs.writeFileSync(txtPath, '设函数 f(x) 在 [0,1] 上连续，求极限 lim x->0 (e^x-1)/x。');
  const txtDoc = await cdpCall(ws, 'DOM.getDocument', {});
  const txtQr = await cdpCall(ws, 'DOM.querySelector', { nodeId: txtDoc.root.nodeId, selector: '#file-input' });
  await cdpCall(ws, 'DOM.setFileInputFiles', {
    nodeId: txtQr.nodeId,
    files: [txtPath.replace(/\\/g, '/')]
  });
  await sleep(3000);
  const txtFlow = await evalJs(ws, `(async () => {
    const ta = document.getElementById('solve-question');
    return { hasTextarea: !!ta, text: ta ? ta.value.slice(0, 30) : '', toasts: window.__toasts };
  })()`);

  /* 决定性实验2：.pdf 文件（先重新进入文件模式重建输入区） */
  await evalJs(ws, `(async () => {
    document.querySelector('.input-tab[data-mode="file"]').click();
    window.__timings = {};
    const og = pdfjsLib.getDocument.bind(pdfjsLib);
    pdfjsLib.getDocument = (args) => {
      window.__timings.getDocCalledAt = Date.now();
      return og(args);
    };
    return 'ok';
  })()`);
  await sleep(400);
  const pdfDoc = await cdpCall(ws, 'DOM.getDocument', {});
  const pdfQr = await cdpCall(ws, 'DOM.querySelector', { nodeId: pdfDoc.root.nodeId, selector: '#file-input' });
  const setFiles = await cdpCall(ws, 'DOM.setFileInputFiles', {
    nodeId: pdfQr.nodeId,
    files: [pdfPath.replace(/\\/g, '/')]
  });
  out.setFilesOk = !!setFiles;

  await sleep(30000);

  const flow = await evalJs(ws, `(async () => {
    const ta = document.getElementById('solve-question');
    const chip = document.querySelector('#solve-chips .chip.active');
    return {
      toasts: window.__toasts,
      timings: window.__timings || {},
      hasTextarea: !!ta,
      extractedText: ta ? ta.value : '',
      detectedSubject: chip ? chip.dataset.subject : 'none',
      areaHtml: document.getElementById('solve-input-area').innerHTML.slice(0, 150)
    };
  })()`);
  Object.assign(out, flow);
  out.txtFlow = txtFlow;

  console.log('RESULT:', JSON.stringify(out, null, 2));
  console.log('EXCEPTIONS:', JSON.stringify(exceptions, null, 2));

  const ok =
    exceptions.length === 0 &&
    out.pdfjsLoaded === true &&
    out.txtFlow.hasTextarea === true &&
    out.txtFlow.text.includes('极限') &&
    out.setFilesOk === true &&
    flow.hasTextarea === true &&
    flow.extractedText.includes('According to the passage') &&
    flow.detectedSubject === 'english' &&
    flow.toasts.length === 0;

  console.log(ok ? '=== PDF 提取测试通过 ===' : '=== PDF 提取测试失败 ===');
  ws.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
