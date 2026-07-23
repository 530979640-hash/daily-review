const http = require('http');
const https = require('https');
const url = require('url');
const path = require('path');
const fs2 = require('fs');

const PORT = process.env.PORT || 3456;
const CACHE_TTL = 15000;
const cache = new Map();
function gc(k){const v=cache.get(k);return v&&Date.now()-v.ts<CACHE_TTL?v.data:null;}
function sc(k,d){cache.set(k,{data:d,ts:Date.now()});}

function fetch(host, p) {
  return new Promise((resolve, reject) => {
    const mod = host.includes('localhost') ? http : https;
    const req = mod.request({hostname:host,path:p,method:'GET',timeout:10000,
      headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
    }, res => {
      const chunks = [];
      res.on('data',c=>chunks.push(c));
      res.on('end',()=>{
        const raw = Buffer.concat(chunks);
        const {TextDecoder}=require('util');
        try{resolve({s:res.statusCode,body:new TextDecoder('gbk').decode(raw)});}
        catch(e){resolve({s:res.statusCode,body:raw.toString('utf8')});}
      });
    });
    req.on('error',reject);
    req.on('timeout',()=>{req.destroy();reject(new Error('timeout'));});
    req.end();
  });
}

function wj(r,d){r.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'});r.end(JSON.stringify(d));}
function we(r,m,c){r.writeHead(c||500,{'Content-Type':'application/json; charset=utf-8'});r.end(JSON.stringify({error:m}));}

function fetchUtf8(host, p) {
  return new Promise((resolve, reject) => {
    const mod = host.includes('localhost') ? http : https;
    const req = mod.request({hostname:host,path:p,method:'GET',timeout:10000,
      headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
    }, res => {
      const chunks = [];
      res.on('data',c=>chunks.push(c));
      res.on('end',()=>{resolve({s:res.statusCode,body:Buffer.concat(chunks).toString('utf8')});});
    });
    req.on('error',reject);
    req.on('timeout',()=>{req.destroy();reject(new Error('timeout'));});
    req.end();
  });
}

function parseTencent(text) {
  const lines = text.split('\n').filter(l=>l.trim());
  const results = [];
  for (const line of lines) {
    const m = line.match(/^v_\w+="(.+)";\s*$/);
    if (!m) continue;
    results.push(m[1].split('~'));
  }
  return results;
}


// Auto-fix daily-review.js on startup (strip BOM, remove stray lines)
try {
  const drPath = path.join(__dirname, "daily-review.js");
  if (fs2.existsSync(drPath)) {
    let drContent = fs2.readFileSync(drPath, "utf8");
    let fixed = drContent.replace(String.fromCharCode(65279), "");
    fixed = fixed.replace(new RegExp("^" + String.fromCharCode(92) + "n[\\r]*$", "m"), "");
    if (fixed !== drContent) {
      fs2.writeFileSync(drPath, fixed, "utf8");
      console.log("Auto-fixed daily-review.js");
    }
  }
} catch(e) {
  console.log("daily-review.js auto-fix skipped:", e.message);
}

// Lazy load daily-review - catch any module errors
let dailyReview = null;
let drLoadError = null;
try {
  dailyReview = require('./daily-review');
} catch(e) {
  drLoadError = e.message;
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const p = parsed.pathname;
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if (req.method==='OPTIONS') {res.writeHead(204);res.end();return;}
  
  try {
    if (p==='/api/daily-review' && dailyReview) {
      const result = await dailyReview.generateDailyReview();
      wj(res, result);
      return;
    }
    if (p==='/api/daily-review') {
      wj(res, {error:'daily-review module not loaded',loadError:drLoadError});
      return;
    }
    if (p==='/api/status') {
      wj(res, {status:'ok',dailyReviewLoaded:!!dailyReview,loadError:drLoadError,port:PORT});
      return;
    }
    // Serve static files
    let fp=p==='/'?'/index.html':p;
    fp=path.join(__dirname,fp);
    if(!fp.startsWith(__dirname)){res.writeHead(403);res.end('Forbidden');return;}
    const ext=path.extname(fp);
    const mimeMap={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
    try{
      const c=fs2.readFileSync(fp);
      res.writeHead(200,{'Content-Type':mimeMap[ext]||'application/octet-stream'});
      res.end(c);
    }catch(e){
      res.writeHead(404,{'Content-Type':'text/html; charset=utf-8'});
      res.end('<h1>404</h1>');
    }
  }catch(e){we(res,e.message);}
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('OK: Server running on http://localhost:'+PORT + ', daily-review loaded: ' + !!dailyReview);
});
