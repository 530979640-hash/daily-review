'use strict';
const http = require('http');
const https = require('https');
const url = require('url');
const path = require('path');
const fs = require('fs');

// Load daily-review first to test if it works
let dailyReview;
try {
  dailyReview = require('./daily-review');
  console.log('daily-review loaded successfully');
} catch(e) {
  console.error('Failed to load daily-review:', e.message);
  console.error(e.stack);
  process.exit(1);
}

// Now test the rest of server.js
const PORT = process.env.PORT || 3456;
const CACHE_TTL = 15000;
const cache = new Map();
function gc(k){const v=cache.get(k);return v&&Date.now()-v.ts<CACHE_TTL?v.data:null;}
function sc(k,d){cache.set(k,{data:d,ts:Date.now()});}

function fetch(host, p) {
  return new Promise((resolve, reject) => {
    const req = https.request({hostname:host,path:p,method:"GET",timeout:10000,
      headers:{"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    }, res => {
      const chunks = [];
      res.on("data",c=>chunks.push(c));
      res.on("end",()=>{
        const raw = Buffer.concat(chunks);
        const {TextDecoder} = require("util");
        try {
          const body = new TextDecoder("gbk").decode(raw);
          resolve({s:res.statusCode,body});
        } catch(e) {
          resolve({s:res.statusCode,body:raw.toString("utf8")});
        }
      });
    });
    req.on("error",reject);
    req.on("timeout",()=>{req.destroy();reject(new Error("timeout"));});
    req.end();
  });
}

function wj(r,d){r.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*"});r.end(JSON.stringify(d));}
function we(r,m,c){r.writeHead(c||500,{"Content-Type":"application/json; charset=utf-8"});r.end(JSON.stringify({error:m}));}

console.log('Starting server on port ' + PORT);
const server = http.createServer(async (req, res) => {
  res.writeHead(200, {'Content-Type': 'application/json'});
  res.end(JSON.stringify({status: 'ok', message: 'Minimal test server running'}));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log('OK: Server running on http://localhost:' + PORT);
});
