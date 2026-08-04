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
const repos = new Map();

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
      } else if (method === 'GET' && base === '/user') {
        json(res, 200, { login: 'test-user', id: 1 });
      } else if (method === 'POST' && base === '/user/repos') {
        const data = JSON.parse(body || '{}');
        if (repos.has(data.name)) { json(res, 422, { message: 'name already exists on this account' }); return; }
        repos.set(data.name, new Map());
        json(res, 201, { name: data.name, private: true, full_name: 'test-user/' + data.name });
      } else if (/^\/repos\/[\w-]+\/[\w-]+\/contents\/[\w.-]+$/.test(base)) {
        const parts = base.split('/');
        const owner = parts[2], repo = parts[3], file = parts[5];
        if (owner !== 'test-user') { json(res, 404, { message: 'Not Found' }); return; }
        const repoFiles = repos.get(repo);
        if (method === 'GET') {
          if (!repoFiles || !repoFiles.has(file)) { json(res, 404, { message: 'Not Found' }); return; }
          const rec = repoFiles.get(file);
          json(res, 200, { name: file, path: file, sha: rec.sha, size: rec.bytes, encoding: 'base64', content: rec.content });
        } else if (method === 'PUT') {
          const data = JSON.parse(body || '{}');
          if (!repoFiles) { json(res, 404, { message: 'Not Found' }); return; }
          const existing = repoFiles.get(file);
          if (existing && data.sha !== existing.sha) {
            json(res, 409, { message: 'sha does not match current file' });
            return;
          }
          const bytes = Buffer.byteLength(Buffer.from(data.content || '', 'base64'), 'utf8');
          const sha = 'sha_' + Math.random().toString(36).slice(2, 10);
          repoFiles.set(file, { content: data.content, sha, bytes });
          json(res, existing ? 200 : 201, { content: { name: file, path: file, sha, size: bytes } });
        } else {
          json(res, 404, { message: 'Not Found' });
        }
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
  if (target.startsWith('/gists') || target.startsWith('/user') || target.startsWith('/repos')) {
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
