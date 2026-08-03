/* 测试服务器：静态文件 + mock GitHub Gist API（含 CORS、鉴权、内存存储） */
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png'
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-GitHub-Api-Version, User-Agent',
  'Access-Control-Max-Age': '86400'
};
const VALID_TOKEN = 'test-token';

let gistSeq = 1;
const gists = new Map();

function json(res, status, body) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, CORS_HEADERS));
  res.end(JSON.stringify(body));
}

function handleApi(urlPath, req, res) {
  const method = req.method;
  if (method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }
  const auth = req.headers['authorization'] || '';
  if (auth !== 'Bearer ' + VALID_TOKEN) {
    res.writeHead(401, Object.assign({ 'X-Debug-Auth': auth }, CORS_HEADERS));
    res.end(JSON.stringify({ message: 'Bad credentials' }));
    return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try {
      const base = urlPath.split('?')[0];
      if (method === 'GET' && base === '/gists') {
        const list = Array.from(gists.values()).map((g) => ({
          id: g.id,
          description: g.description,
          files: g.files
        }));
        json(res, 200, list);
      } else if (method === 'POST' && base === '/gists') {
        const data = JSON.parse(body || '{}');
        const id = 'gist_' + (gistSeq++);
        const g = {
          id,
          description: data.description || '',
          public: !!data.public,
          files: data.files || {},
          owner: { login: 'test-user' },
          updated_at: new Date().toISOString()
        };
        gists.set(id, g);
        json(res, 201, g);
      } else if (method === 'GET' && /^\/gists\/[\w-]+$/.test(base)) {
        const id = base.split('/')[2];
        const g = gists.get(id);
        if (!g) { json(res, 404, { message: 'Not Found' }); return; }
        json(res, 200, g);
      } else if (method === 'PATCH' && /^\/gists\/[\w-]+$/.test(base)) {
        const id = base.split('/')[2];
        const g = gists.get(id);
        if (!g) { json(res, 404, { message: 'Not Found' }); return; }
        const data = JSON.parse(body || '{}');
        if (data.files) {
          for (const key of Object.keys(data.files)) {
            if (data.files[key] === null) delete g.files[key];
            else if (g.files[key]) g.files[key] = data.files[key];
            else g.files[key] = data.files[key];
          }
        }
        g.updated_at = new Date().toISOString();
        json(res, 200, g);
      } else {
        json(res, 404, { message: 'Not Found' });
      }
    } catch (e) {
      json(res, 400, { message: 'Bad Request: ' + e.message });
    }
  });
}

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const target = urlPath === '/' ? '/index.html' : urlPath;
  if (target.startsWith('/gists')) {
    handleApi(target, req, res);
    return;
  }
  const file = path.join(root, target);
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('404');
      return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(8123, () => console.log('mock server on 8123'));
