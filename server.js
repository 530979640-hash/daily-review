'use strict';
const http = require('http');
const PORT = process.env.PORT || 3456;

let dailyReview = null;
let loadError = null;

try {
  dailyReview = require('./daily-review');
  console.log('daily-review loaded successfully');
} catch(e) {
  loadError = { message: e.message, stack: e.stack ? e.stack.split('\n').slice(0, 10).join('\n') : 'no stack' };
  console.error('Failed to load daily-review:', loadError.message);
}

const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'});
  res.end(JSON.stringify({
    status: loadError ? 'error' : 'ok',
    loadError: loadError,
    dailyReviewLoaded: dailyReview !== null,
    hasGenerateFunction: dailyReview && typeof dailyReview.generateDailyReview === 'function'
  }, null, 2));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log('Diagnostic server running on port ' + PORT);
});
