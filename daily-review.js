const https = require("https");
const http = require("http");
const fs = require("fs");
const path =const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "review_data");
try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch(e) { console.error("Cannot create dir:", e.message); }

function fetchData(host, p) {
  return new Promise((resolve, reject) => {
    const mod = host.includes("localhost") ? http : https;
    const req = mod.request({ hostname: host, path: p, method: "GET", timeout: 15000,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks);
        const { TextDecoder } = require("util");
        try { resolve({ s: res.statusCode, body: new TextDecoder("gbk").decode(raw) }); }
        catch (e) { resolve({ s: res.statusCode, body: raw.toString("utf8") }); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

function parseTencent(text) {
  return text.split("\n").filter(l => l.trim()).map(l => {
    const m = l.match(/^v_\w+="(.+)";\s*$/);
    return m ? m[1].split("~") : null;
  }).filter(Boolean);
}

// === 获取历��K线数据 ===
async function fetchKline(code, days) {
  try {
    const r = await fetchData("web.ifzq.gtimg.cn", "/appstock/app/fqkline/get?param=" + code + ",day,,," + days + ",qfq");
    if (r.s !== 200) return [];
    const j = JSON.parse(r.body);
    const daysArr = j.data && j.data[code] && j.data[code].day;
    if (!daysArr) return [];
    return daysArr.map(d => ({
      date: d[0], open: parseFloat(d[1]) || 0, close: parseFloat(d[2]) || 0,
      high: parseFloat(d[3]) || 0, low: parseFloat(d[4]) || 0, volume: parseFloat(d[5]) || 0
    }));
  } catch (e) { return []; }
}

// === 技术指标计算 ===
function calcSMA(data, period) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    result.push(sum / period);
  }
  return result;
}

function calcEMA(data, period) {
  const result = [];
  const k = 2 / (period + 1);
  let ema = data[0];
  result.push(ema);
  for (let i = 1; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

function calcMACD(closes) {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const dif = ema12.map((v, i) => v - ema26[i]);
  const dea = calcEMA(dif, 9);
  const histogram = dif.map((v, i) => 2 * (v - (dea[i] || 0)));
  return { dif, dea, histogram };
}

function calcRSI(closes, period) {
  const result = [];
  for (let i = 0; i < period; i++) { result.push(null); }
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gain += diff; else loss -= diff;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

function calcKDJ(highs, lows, closes, period) {
  const n = Math.min(period, highs.length);
  let k = 50, d = 50;
  const ks = [], ds = [], js = [];
  for (let i = 0; i < highs.length; i++) {
    const start = Math.max(0, i - n + 1);
    const hh = Math.max(...highs.slice(start, i + 1));
    const ll = Math.min(...lows.slice(start, i + 1));
    const rsv = (hh === ll) ? 50 : (closes[i] - ll) / (hh - ll) * 100;
    k = 2 / 3 * k + 1 / 3 * rsv;
    d = 2 / 3 * d + 1 / 3 * k;
    const j = 3 * k - 2 * d;
    ks.push(k); ds.push(d); js.push(j);
  }
  return { k: ks, d: ds, j: js };
}

function calcBOLL(closes, period) {
  const ma = calcSMA(closes, period);
  const upper = [], lower = [];
  for (let i = 0; i < closes.length; i++) {
    if (ma[i] === null) { upper.push(null); lower.push(null); continue; }
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) sumSq += Math.pow(closes[j] - ma[i], 2);
    const std = Math.sqrt(sumSq / period);
    upper.push(ma[i] + 2 * std);
    lower.push(ma[i] - 2 * std);
  }
  return { middle: ma, upper, lower };
}


// === 获取财经新闻（消息面）===
async function fetchNews() {
  try {
    // 新浪财经滚动新闻
    const r = await fetchData("feed.mix.sina.com.cn", "/api/roll/get?pageid=153&lid=2516&num=15&page=1");
    if (r.s !== 200) return [];
    const j = JSON.parse(r.body);
    const items = j.result?.data || [];
    return items.map(item => ({
      title: item.title || "",
      intro: item.intro || "",
      ctime: item.ctime || "",
      url: item.url || ""
    })).filter(item => item.title);
  } catch (e) {
    // 备用：尝试东方财富快讯
    try {
      const r2 = await fetchData("push2.eastmoney.com", "/api/qt/ulist.np/get?fltt=2&fields=f12,f14,f2,f3,f4&secids=1.000001&cb=");
      return [{ title: "数据获取中", intro: "备用通道", ctime: "", url: "" }];
    } catch (e2) { return []; }
  }
}

// === 简易中文消息面情绪分析 ===
function analyzeNewsSentiment(headlines) {
  const positive = ["利好","上涨","突破","新高","放量","反弹","降准","降息","增持","回购","盈利","增长","超预期","回暖","提振","扩张","宽松","支持","推动","加速","开放","合作","创新","改革","加仓","做多","看涨","牛市","反转"];
  const negative = ["利空","下跌","破位","新低","缩量","回调","减持","亏损","违约","风险","警告","下调","疲软","放缓","收缩","紧张","制裁","暂停","终止","退出","做空","看跌","熊市","崩盘","踩踏","恐慌","退市","st"];
  let posCount = 0, negCount = 0, totalWords = 0;
  const matched = { positive: [], negative: [] };
  const seen = new Set();

  headlines.forEach(h => {
    const text = (h.title + " " + (h.intro || "")).toLowerCase();
    positive.forEach(w => {
      if (text.includes(w) && !seen.has(w)) { posCount++; seen.add(w); matched.positive.push(w); }
    });
    negative.forEach(w => {
      if (text.includes(w) && !seen.has(w)) { negCount++; seen.add(w); matched.negative.push(w); }
    });
    totalWords += text.length;
  });

  const score = posCount - negCount;
  let sentiment, impact;
  if (score > 3) { sentiment = "偏暖（利好居多）"; impact = "积极"; }
  else if (score > 0) { sentiment = "略偏暖"; impact = "偏积极"; }
  else if (score === 0) { sentiment = "中性"; impact = "中性"; }
  else if (score > -3) { sentiment = "略偏冷"; impact = "偏消极"; }
  else { sentiment = "偏冷（利空居多）"; impact = "消极"; }

  // 提炼关键词
  const keyPos = [...new Set(matched.positive)].slice(0, 5);
  const keyNeg = [...new Set(matched.negative)].slice(0, 5);

  return {
    sentiment, impact,
    score,
    totalHeadlines: headlines.length,
    posCount, negCount,
    keywords: {
      positive: keyPos.length ? keyPos.join("、") : "无明显利好词",
      negative: keyNeg.length ? keyNeg.join("、") : "无明显利空词"
    },
    topHeadlines: headlines.slice(0, 8).map(h => ({ title: h.title }))
  };
}
module.exports = { generateDailyReview, fetchData, parseTencent, fetchNews, analyzeNewsSentiment };
\n
// === 所有A股大盘指数配置 ===
const ALL_INDICES = {
  "sh000001": { key: "sh",     name: "上证指数",     shortName: "上证" },
  "sz399001": { key: "sz",     name: "深证成指",     shortName: "深证" },
  "sz399006": { key: "cy",     name: "创业板指",     shortName: "创业板" },
  "sh000300": { key: "hs300",  name: "沪深300",      shortName: "沪深300" },
  "sh000016": { key: "sz50",   name: "上证50",       shortName: "上证50" },
  "sh000905": { key: "zz500",  name: "中证500",      shortName: "中证500" },
  "sh000852": { key: "zz1000", name: "中证1000",     shortName: "中证1000" },
  "sh000688": { key: "kc50",   name: "科创50",       shortName: "科创50" },
  "sh000010": { key: "sz180",  name: "上证180",      shortName: "上证180" },
  "sz399330": { key: "sz100",  name: "深证100",      shortName: "深证100" }
};

const INDICES_LIST = Object.keys(ALL_INDICES);
const INDICES_QUERY = INDICES_LIST.join(",");
const INDICES_CODE_MAP = {};
INDICES_LIST.forEach(function(code) {
  const rawCode = code.replace(/^(sh|sz)/, "");
  INDICES_CODE_MAP[rawCode] = ALL_INDICES[code].key;
});

// === 对任意K线数据计算技术指标 ===
function computeTechnicalAnalysis(klines) {
  if (!klines || klines.length < 5) return null;
  const closes = klines.map(function(k) { return k.close; });
  const highs = klines.map(function(k) { return k.high; });
  const lows = klines.map(function(k) { return k.low; });
  const volumes = klines.map(function(k) { return k.volume; });
  const last = klines.length - 1;

  const ma5 = calcSMA(closes, 5);
  const ma10 = calcSMA(closes, 10);
  const ma20 = calcSMA(closes, 20);
  const macd = calcMACD(closes);
  const rsi6 = calcRSI(closes, 6);
  const rsi14 = calcRSI(closes, 14);
  const kdj = calcKDJ(highs, lows, closes, 9);
  const volMa5 = calcSMA(volumes, 5);

  var result = {};

  result.ma = {
    ma5: ma5[last] !== null ? ma5[last].toFixed(2) : "--",
    ma10: ma10[last] !== null ? ma10[last].toFixed(2) : "--",
    ma20: ma20[last] !== null ? ma20[last].toFixed(2) : "--"
  };
  result.macd = {
    dif: macd.dif[last] !== undefined ? macd.dif[last].toFixed(2) : "--",
    dea: macd.dea[last] !== undefined ? macd.dea[last].toFixed(2) : "--",
    histogram: macd.histogram[last] !== undefined ? macd.histogram[last].toFixed(2) : "--"
  };
  result.rsi = {
    rsi6: rsi6[last] !== null ? rsi6[last].toFixed(1) : "--",
    rsi14: rsi14[last] !== null ? rsi14[last].toFixed(1) : "--"
  };
  result.kdj = {
    k: kdj.k[last] !== undefined ? kdj.k[last].toFixed(1) : "--",
    d: kdj.d[last] !== undefined ? kdj.d[last].toFixed(1) : "--",
    j: kdj.j[last] !== undefined ? kdj.j[last].toFixed(1) : "--"
  };

  if (closes.length >= 20) {
    const boll = calcBOLL(closes, 20);
    result.boll = {
      upper: boll.upper[last] !== null ? boll.upper[last].toFixed(2) : "--",
      middle: boll.middle[last] !== null ? boll.middle[last].toFixed(2) : "--",
      lower: boll.lower[last] !== null ? boll.lower[last].toFixed(2) : "--"
    };
  } else {
    result.boll = { upper: "--", middle: "--", lower: "--" };
  }

  result.volumeMa5 = volMa5[last] !== null ? (volMa5[last] / 1e8).toFixed(0) + "亿" : "--";

  // Trend analysis
  const trend5 = klines.slice(-5);
  const trend10 = klines.slice(-10);

  result.trend = {};
  result.trend.last5 = trend5.map(function(k) {
    return { date: k.date, close: k.close.toFixed(2), changePct: "0" };
  });
  for (var ti = 1; ti < result.trend.last5.length; ti++) {
    var idx5 = klines.indexOf(trend5[ti - 1]) - 1;
    var prevClose = idx5 >= 0 ? klines[idx5].close : parseFloat(result.trend.last5[ti - 1].close);
    result.trend.last5[ti].changePct = ((parseFloat(result.trend.last5[ti].close) - prevClose) / prevClose * 100).toFixed(2);
  }

  result.trend.last10 = trend10.map(function(k) {
    return { date: k.date, close: k.close.toFixed(2), changePct: "0" };
  });
  for (var ti2 = 1; ti2 < result.trend.last10.length; ti2++) {
    var idx10 = klines.indexOf(trend10[ti2 - 1]) - 1;
    var prevClose10 = idx10 >= 0 ? klines[idx10].close : parseFloat(result.trend.last10[ti2 - 1].close);
    result.trend.last10[ti2].changePct = ((parseFloat(result.trend.last10[ti2].close) - prevClose10) / prevClose10 * 100).toFixed(2);
  }

  if (trend5.length >= 2) {
    var c5_ = (trend5[trend5.length - 1].close - trend5[0].close) / trend5[0].close * 100;
    result.trend.cumulative5 = (c5_ >= 0 ? "+" : "") + c5_.toFixed(2) + "%";
  } else { result.trend.cumulative5 = "--"; }
  if (trend10.length >= 2) {
    var c10_ = (trend10[trend10.length - 1].close - trend10[0].close) / trend10[0].close * 100;
    result.trend.cumulative10 = (c10_ >= 0 ? "+" : "") + c10_.toFixed(2) + "%";
  } else { result.trend.cumulative10 = "--"; }

  // Direction
  if (trend5.length >= 2) {
    var c5dir = (trend5[trend5.length - 1].close - trend5[0].close) / trend5[0].close * 100;
    var upDays = 0, downDays = 0, consUp = 0, consDown = 0, maxConsUp = 0, maxConsDown = 0;
    for (var td = 1; td < trend5.length; td++) {
      var chgT = (trend5[td].close - trend5[td - 1].close) / trend5[td - 1].close * 100;
      if (chgT > 0) { upDays++; consUp++; consDown = 0; maxConsUp = Math.max(maxConsUp, consUp); }
      else { downDays++; consDown++; consUp = 0; maxConsDown = Math.max(maxConsDown, consDown); }
    }
    result.trend.consecutiveDays = Math.max(maxConsUp, maxConsDown);
    if (c5dir > 1.5 && maxConsUp >= 3) result.trend.direction = "\u2191 \u4e0a\u5347\u8d8b\u52bf";
    else if (c5dir < -1.5 && maxConsDown >= 3) result.trend.direction = "\u2193 \u4e0b\u964d\u8d8b\u52bf";
    else if (c5dir > 0.5) result.trend.direction = "\u2197 \u9707\u8361\u504f\u591a";
    else if (c5dir < -0.5) result.trend.direction = "\u2198 \u9707\u8361\u504f\u7a7a";
    else result.trend.direction = "\u2194 \u9707\u8361\u6574\u7406";
  }

  // Key levels
  var closeVal = closes[last];
  var high20 = Math.max.apply(null, closes.slice(Math.max(0, last - 19), last + 1));
  var low20 = Math.min.apply(null, closes.slice(Math.max(0, last - 19), last + 1));
  result.keyLevels = {};
  result.keyLevels.resist = (closeVal + (high20 - low20) * 0.382).toFixed(2) + " ~ " + (closeVal + (high20 - low20) * 0.5).toFixed(2);
  result.keyLevels.support = (closeVal - (high20 - low20) * 0.382).toFixed(2) + " ~ " + (closeVal - (high20 - low20) * 0.5).toFixed(2);
  result.keyLevels.current = closeVal.toFixed(2);

  return result;
}

// === 为任意指数生成次日预测 ===
function generateIndexPrediction(indexName, indexData, tech, trend) {
  if (!indexData || !tech || !trend) return "--";

  var close = indexData.price;
  var open = indexData.open || close;
  var preClose = indexData.preClose || close;
  var chg = indexData.changePct || 0;
  var gapPct = preClose > 0 ? ((open - preClose) / preClose * 100).toFixed(2) : "0";

  var ol = "【" + indexName + "预测】";

  // Part 1
  var trendDir = trend.direction || "震荡整理";
  var c5 = trend.cumulative5 || "--";
  var c10 = trend.cumulative10 || "--";
  var consDays = trend.consecutiveDays || 0;
  ol += "【趋势背景】" + trendDir + "（近5日" + c5 + "，近10日" + c10 + "）";
  if (consDays >= 2) ol += "，已连涨/跌" + consDays + "日。";
  else ol += "。";

  // Part 2
  var dif = parseFloat(tech.macd.dif);
  var dea = parseFloat(tech.macd.dea);
  var hist = parseFloat(tech.macd.histogram);
  var rsi14v = parseFloat(tech.rsi.rsi14);
  var kv = parseFloat(tech.kdj.k);
  var dv = parseFloat(tech.kdj.d);
  var jv = parseFloat(tech.kdj.j);
  var bollM = parseFloat(tech.boll.middle);
  var bollU = parseFloat(tech.boll.upper);
  var bollL = parseFloat(tech.boll.lower);

  ol += "【技术研判】";
  if (dif > dea) ol += "MACD金叉状态（DIF在DEA上方），" + (hist > 0 ? "红柱放大中，动能偏多。" : "红柱收窄中，动能有衰减。");
  else ol += "MACD死叉状态（DIF在DEA下方），" + (hist < 0 ? "绿柱放大中，动能偏空。" : "绿柱收窄中，动能有改善。");
  if (!isNaN(rsi14v)) {
    if (rsi14v > 65) ol += "RSI14=" + rsi14v.toFixed(1) + "（偏强区间），超买需警惕回调。";
    else if (rsi14v < 35) ol += "RSI14=" + rsi14v.toFixed(1) + "（偏弱区间），超卖有反弹预期。";
    else ol += "RSI14=" + rsi14v.toFixed(1) + "（中性区间），方向待选择。";
  }
  if (!isNaN(kv) && !isNaN(dv)) {
    if (kv > dv) ol += "KDJ金叉中，多头占优。";
    else ol += "KDJ死叉中，空头占优。";
  }
  if (!isNaN(jv)) {
    if (jv > 100) ol += "J值" + jv.toFixed(1) + "超买区，警惕回调。";
    else if (jv < 0) ol += "J值" + jv.toFixed(1) + "超卖区，有反弹需求。";
  }

  if (!isNaN(bollU) && !isNaN(bollL) && !isNaN(bollM)) {
    ol += "布林带：当前价" + close.toFixed(2);
    if (close >= bollU) {
      ol += "贴紧上轨运行，短期超买，注意回调至中轨" + bollM.toFixed(2) + "附近。";
    } else if (close <= bollL) {
      ol += "贴紧下轨运行，短期超卖，有反弹至中轨" + bollM.toFixed(2) + "预期。";
    } else if (close > bollM) {
      var pct_u = ((close - bollM) / (bollU - bollM) * 100).toFixed(0);
      ol += "位于中轨上方（中轨" + bollM.toFixed(2) + "），处在上轨" + bollU.toFixed(2) + "和中轨之间" + pct_u + "%位置，偏强震荡。";
    } else {
      var pct_d = ((bollM - close) / (bollM - bollL) * 100).toFixed(0);
      ol += "位于中轨下方（中轨" + bollM.toFixed(2) + "），处在下轨" + bollL.toFixed(2) + "和中轨之间" + pct_d + "%位置，偏弱震荡。";
    }
  }

  // Part 3
  var levels = tech.keyLevels || {};
  ol += "【关键点位】支撑" + (levels.support || "--") + "，压力" + (levels.resist || "--") + "。";

  if (!isNaN(bollM) && close > bollM) {
    ol += "当前在支撑上方，回踩支撑不破可博弈反弹；跌破则观望。";
  } else {
    ol += "当前在压力下方，突破压力并站稳可看高一线；遇阻则减仓。";
  }

  // Part 4
  ol += "【盘内推演】";
  ol += "若高开" + (parseFloat(gapPct) > 0.3 ? "（延续今日方向）" : "（观察能否守住涨幅）") + "，";

  if (!isNaN(rsi14v) && !isNaN(jv)) {
    if (rsi14v > 65 && jv > 100) {
      ol += "注意高开低走风险，不宜追涨，等待回踩支撑布局。";
    } else if (rsi14v < 35 && jv < 0) {
      ol += "若低开探底可轻仓试多，关注支撑位企稳信号。";
    } else if (trendDir.indexOf("上升") >= 0) {
      ol += "顺势而为，回踩支撑位可低吸，突破压力位加仓。止损设在支撑下方。";
    } else if (trendDir.indexOf("下降") >= 0) {
      ol += "反弹至压力位不过则减仓，不逆势抄底，等企稳信号明确。";
    } else {
      ol += "高抛低吸，支撑位低吸，压力位高抛，等待方向突破。";
    }
  } else {
    ol += "震荡格局未改，控制仓位，等待方向明确。";
  }

  ol += "重点关注开盘后30分钟方向选择和下午2:30前后资金动向。";

  // Yang Ning signal
  ol += " 杨宁信号：";
  if (chg > 1.5) ol += "肯砸就肯吸，不追高。";
  else if (chg > 0) ol += "耐心等待，方向确认再出手。";
  else if (chg > -1) ol += "别冲动，守住支撑再考虑。";
  else ol += "至暗时刻是买点，恐慌中寻找机会。";

  return ol;
}

function computeSignalStrength(chg) {
  if (chg > 2.5) return "\ud83d\udd34 卖出区间";
  else if (chg > 1.5) return "\ud83d\udfe1 减仓区间";
  else if (chg > 0) return "\ud83d\udfe2 持有区间";
  else if (chg > -1.5) return "\ud83d\udfe2 观望区间";
  else if (chg > -3) return "\ud83d\udfe2 买入区间（超跌反弹）";
  else return "\ud83d\udfe2 强烈买入区间";
}

// === 主函数：生成每日复盘 ===
async function generateDailyReview() {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const h = now.getHours(), m = now.getMinutes();
  const marketPhase = h < 9 ? "未开盘" : h < 11.5 || (h === 11 && m < 30) ? "早盘" : h < 13 ? "午休" : h < 15 ? "下午盘" : "已收盘";

  var initialIdx = {};
  INDICES_LIST.forEach(function(code) {
    initialIdx[ALL_INDICES[code].key] = null;
  });

  const report = {
    date: today, generatedAt: now.toISOString(), marketPhase,
    indices: JSON.parse(JSON.stringify(initialIdx)),
    marketBreadth: { upCount: 0, downCount: 0, flatCount: 0, total: 0 },
    sectors: [], northFlow: { netIn: 0 }, volume: 0,
    analysis: {
      phase: "--", goldHour: "--", sentiment: "--",
      keyLevels: { support: "--", resist: "--", current: "--" },
      summary: "--", tomorrowOutlook: "--", signalStrength: "--"
    },
    technical: {
      ma: { ma5: "--", ma10: "--", ma20: "--" },
      macd: { dif: "--", dea: "--", histogram: "--" },
      rsi: { rsi6: "--", rsi14: "--" },
      kdj: { k: "--", d: "--", j: "--" },
      boll: { upper: "--", middle: "--", lower: "--" },
      volumeMa5: "--"
    },
    newsAnalysis: {
      sentiment: "--", impact: "--", score: 0,
      totalHeadlines: 0, posCount: 0, negCount: 0,
      keywords: { positive: "--", negative: "--" },
      topHeadlines: []
    },
    trend: {
      last5: [], last10: [],
      direction: "--", consecutiveDays: 0, cumulative5: "--", cumulative10: "--"
    }
  };

  try {
    // Fetch all index quotes
    const idxRes = await fetchData("qt.gtimg.cn", "/q=" + INDICES_QUERY);
    if (idxRes.s === 200) {
      const parsed = parseTencent(idxRes.body);
      parsed.forEach(function(p) {
        var code = p[2] || "";
        var key = INDICES_CODE_MAP[code];
        if (key) {
          report.indices[key] = {
            price: parseFloat(p[3]) || 0, change: parseFloat(p[31]) || 0,
            changePct: parseFloat(p[32]) || 0, open: parseFloat(p[5]) || 0,
            high: parseFloat(p[33]) || 0, low: parseFloat(p[34]) || 0,
            preClose: parseFloat(p[4]) || 0, turnover: parseFloat(p[37]) || 0
          };
        }
      });
    }

    // Sector data
    try {
      const secRes = await fetchData("push2.eastmoney.com", "/api/qt/clist/get?cb=&pn=1&pz=80&po=1&np=1&fields=f12,f14,f2,f3,f4&fid=f3&fs=m:90+t:2&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2");
      if (secRes && secRes.s === 200) {
        try {
          var json = JSON.parse(secRes.body.replace(/^\(|\)$/g, ""));
          var list = (json.data && json.data.diff) || json.diff || [];
          if (list.length) {
            report.sectors = list.filter(function(d) { return d.f14; }).map(function(d) {
              return { name: d.f14, price: d.f2 || 0, changePct: d.f3 || 0, change: d.f4 || 0 };
            }).sort(function(a, b) { return b.changePct - a.changePct; });
          }
        } catch (e) {}
      }
    } catch (e) {}

    // News
    const newsResult = await fetchNews();
    if (newsResult && newsResult.length) {
      report.newsAnalysis = analyzeNewsSentiment(newsResult);
    }

    // Total volume
    if (report.indices.sh) {
      report.volume = (report.indices.sh.turnover || 0) + (report.indices.sz && report.indices.sz.turnover || 0);
    }

    // Fetch K-lines and compute indicators for ALL indices
    var allKlines = {};
    var allTechs = {};
    for (var ki = 0; ki < INDICES_LIST.length; ki++) {
      var idxCode = INDICES_LIST[ki];
      var idxKey = ALL_INDICES[idxCode].key;
      var klines = await fetchKline(idxCode, 30);
      allKlines[idxKey] = klines;
      allTechs[idxKey] = computeTechnicalAnalysis(klines);
    }

    // Use SH data for backward-compatible main analysis
    var klines = allKlines["sh"];
    var techSH = allTechs["sh"];
    if (klines && klines.length >= 5 && techSH) {
      report.technical = techSH;
      report.trend = techSH.trend;
      report.analysis.keyLevels = techSH.keyLevels || { support: "--", resist: "--", current: "--" };
      if (report.indices.sh) {
        report.analysis.keyLevels.current = report.indices.sh.price.toFixed(2);
      }

      var shData = report.indices.sh;
      var closeSH = shData ? shData.price : parseFloat(techSH.ma.ma5) || 0;
      var chgSH = shData ? shData.changePct || 0 : 0;
      var ampPct = shData ? ((shData.high - shData.low) / (shData.preClose || 1) * 100) : 0;

      report.analysis.phase = "\u2795 " + (ampPct < 0.8 ? "窄幅震荡" : ampPct < 1.5 ? "中等震荡" : "幅度较大") + "（" + (chgSH >= 0 ? "+" : "") + chgSH.toFixed(2) + "%，振幅" + ampPct.toFixed(1) + "%）";

      var goldHourParts = [];
      if (shData) {
        var gapStr = shData.open > 0 && shData.preClose > 0 ? ((shData.open - shData.preClose) / shData.preClose * 100).toFixed(2) + "%" : "--";
        goldHourParts.push("【开盘】" + gapStr);
        goldHourParts.push("【振幅】" + ampPct.toFixed(1) + "%");
        goldHourParts.push("【收盘位置】" + (closeSH > (shData.high + shData.low) / 2 ? "偏高位收盘（偏强）" : "偏低位收盘（偏弱）"));
        var bodySize = Math.abs(shData.price - shData.open) / (shData.high - shData.low || 1);
        goldHourParts.push("【K线形态】" + (bodySize > 0.7 ? "实体较大���意义明确）" : "实体适中（正常波动）"));
        if (shData.low < (shData.preClose || 0)) goldHourParts.push("⚠️ 盘中回补跳空缺口");
        goldHourParts.push(chgSH >= 0 ? "✅ 收高（红盘）" : "❌ 收低（绿盘）");
        goldHourParts.push("→ " + (chgSH >= 0 ? "日内震荡上行格局" : "日内震荡下行格局"));
      }
      report.analysis.goldHour = goldHourParts.join(" | ");

      if (chgSH > 0.3) report.analysis.sentiment = "😊 偏暖";
      else if (chgSH > -0.3) report.analysis.sentiment = "😐 中性";
      else report.analysis.sentiment = "😨 偏冷";

      report.analysis.summary = "【当日概况】上证" + closeSH.toFixed(2) + "点（" + (chgSH >= 0 ? "+" : "") + chgSH.toFixed(2) + "%）";
      if (report.volume) report.analysis.summary += " 成交额" + (report.volume / 1e8).toFixed(0) + "亿";
      var macdHist = parseFloat(techSH.macd.histogram);
      var rsi14vSH = parseFloat(techSH.rsi.rsi14);
      report.analysis.summary += " | MACD柱" + macdHist.toFixed(2) + " RSI14=" + (rsi14vSH ? rsi14vSH.toFixed(1) : "--");

      // Generate predictions for ALL indices
      report.predictions = {};
      INDICES_LIST.forEach(function(code) {
        var key2 = ALL_INDICES[code].key;
        var name2 = ALL_INDICES[code].name;
        var idxData2 = report.indices[key2];
        var tech2 = allTechs[key2];
        if (idxData2 && tech2) {
          var pred = {};
          pred.technical = tech2;
          pred.trend = tech2.trend;
          pred.tomorrowOutlook = generateIndexPrediction(name2, idxData2, tech2, tech2.trend);
          pred.signalStrength = computeSignalStrength(idxData2.changePct || 0);
          report.predictions[key2] = pred;
        }
      });

      // Set main analysis from SH prediction
      var shPred = report.predictions["sh"];
      if (shPred) {
        report.analysis.tomorrowOutlook = shPred.tomorrowOutlook;
        report.analysis.signalStrength = shPred.signalStrength;
      }
    }
  } catch (e) { report.error = e.message; }

  const fp = path.join(DATA_DIR, "review_" + today + ".json");
  fs.writeFileSync(fp, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(path.join(DATA_DIR, "latest.json"), JSON.stringify(report, null, 2), "utf8");
  return report;
}
﻿const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "review_data");
try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch(e) { console.error("Cannot create dir:", e.message); }

function fetchData(host, p) {
  return new Promise((resolve, reject) => {
    const mod = host.includes("localhost") ? http : https;
    const req = mod.request({ hostname: host, path: p, method: "GET", timeout: 15000,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks);
        const { TextDecoder } = require("util");
        try { resolve({ s: res.statusCode, body: new TextDecoder("gbk").decode(raw) }); }
        catch (e) { resolve({ s: res.statusCode, body: raw.toString("utf8") }); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

function parseTencent(text) {
  return text.split("\n").filter(l => l.trim()).map(l => {
    const m = l.match(/^v_\w+="(.+)";\s*$/);
    return m ? m[1].split("~") : null;
  }).filter(Boolean);
}

// === 获取历史K线数据 ===
async function fetchKline(code, days) {
  try {
    const r = await fetchData("web.ifzq.gtimg.cn", "/appstock/app/fqkline/get?param=" + code + ",day,,," + days + ",qfq");
    if (r.s !== 200) return [];
    const j = JSON.parse(r.body);
    const daysArr = j.data && j.data[code] && j.data[code].day;
    if (!daysArr) return [];
    return daysArr.map(d => ({
      date: d[0], open: parseFloat(d[1]) || 0, close: parseFloat(d[2]) || 0,
      high: parseFloat(d[3]) || 0, low: parseFloat(d[4]) || 0, volume: parseFloat(d[5]) || 0
    }));
  } catch (e) { return []; }
}

// === 技术指标计算 ===
function calcSMA(data, period) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    result.push(sum / period);
  }
  return result;
}

function calcEMA(data, period) {
  const result = [];
  const k = 2 / (period + 1);
  let ema = data[0];
  result.push(ema);
  for (let i = 1; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

function calcMACD(closes) {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const dif = ema12.map((v, i) => v - ema26[i]);
  const dea = calcEMA(dif, 9);
  const histogram = dif.map((v, i) => 2 * (v - (dea[i] || 0)));
  return { dif, dea, histogram };
}

function calcRSI(closes, period) {
  const result = [];
  for (let i = 0; i < period; i++) { result.push(null); }
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gain += diff; else loss -= diff;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

function calcKDJ(highs, lows, closes, period) {
  const n = Math.min(period, highs.length);
  let k = 50, d = 50;
  const ks = [], ds = [], js = [];
  for (let i = 0; i < highs.length; i++) {
    const start = Math.max(0, i - n + 1);
    const hh = Math.max(...highs.slice(start, i + 1));
    const ll = Math.min(...lows.slice(start, i + 1));
    const rsv = (hh === ll) ? 50 : (closes[i] - ll) / (hh - ll) * 100;
    k = 2 / 3 * k + 1 / 3 * rsv;
    d = 2 / 3 * d + 1 / 3 * k;
    const j = 3 * k - 2 * d;
    ks.push(k); ds.push(d); js.push(j);
  }
  return { k: ks, d: ds, j: js };
}

function calcBOLL(closes, period) {
  const ma = calcSMA(closes, period);
  const upper = [], lower = [];
  for (let i = 0; i < closes.length; i++) {
    if (ma[i] === null) { upper.push(null); lower.push(null); continue; }
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) sumSq += Math.pow(closes[j] - ma[i], 2);
    const std = Math.sqrt(sumSq / period);
    upper.push(ma[i] + 2 * std);
    lower.push(ma[i] - 2 * std);
  }
  return { middle: ma, upper, lower };
}


// === 获取财经新闻（消息面）===
async function fetchNews() {
  try {
    // 新浪财经滚动新闻
    const r = await fetchData("feed.mix.sina.com.cn", "/api/roll/get?pageid=153&lid=2516&num=15&page=1");
    if (r.s !== 200) return [];
    const j = JSON.parse(r.body);
    const items = j.result?.data || [];
    return items.map(item => ({
      title: item.title || "",
      intro: item.intro || "",
      ctime: item.ctime || "",
      url: item.url || ""
    })).filter(item => item.title);
  } catch (e) {
    // 备用：尝试东方财富快讯
    try {
      const r2 = await fetchData("push2.eastmoney.com", "/api/qt/ulist.np/get?fltt=2&fields=f12,f14,f2,f3,f4&secids=1.000001&cb=");
      return [{ title: "数据获取中", intro: "备用通道", ctime: "", url: "" }];
    } catch (e2) { return []; }
  }
}

// === 简易中文消息面情绪分析 ===
function analyzeNewsSentiment(headlines) {
  const positive = ["利好","上涨","突破","新高","放量","反弹","降准","降息","增持","回购","盈利","增长","超预期","回暖","提振","扩张","宽松","支持","推动","加速","开放","合作","创新","改革","加仓","做多","看涨","牛市","反转"];
  const negative = ["利空","下跌","破位","新低","缩量","回调","减持","亏损","违约","风险","警告","下调","疲软","放缓","收缩","紧张","制裁","暂停","终止","退出","做空","看跌","熊市","崩盘","踩踏","恐慌","退市","st"];
  let posCount = 0, negCount = 0, totalWords = 0;
  const matched = { positive: [], negative: [] };
  const seen = new Set();

  headlines.forEach(h => {
    const text = (h.title + " " + (h.intro || "")).toLowerCase();
    positive.forEach(w => {
      if (text.includes(w) && !seen.has(w)) { posCount++; seen.add(w); matched.positive.push(w); }
    });
    negative.forEach(w => {
      if (text.includes(w) && !seen.has(w)) { negCount++; seen.add(w); matched.negative.push(w); }
    });
    totalWords += text.length;
  });

  const score = posCount - negCount;
  let sentiment, impact;
  if (score > 3) { sentiment = "偏暖（利好居多）"; impact = "积极"; }
  else if (score > 0) { sentiment = "略偏暖"; impact = "偏积极"; }
  else if (score === 0) { sentiment = "中性"; impact = "中性"; }
  else if (score > -3) { sentiment = "略偏冷"; impact = "偏消极"; }
  else { sentiment = "偏冷（利空居多）"; impact = "消极"; }

  // 提炼关键词
  const keyPos = [...new Set(matched.positive)].slice(0, 5);
  const keyNeg = [...new Set(matched.negative)].slice(0, 5);

  return {
    sentiment, impact,
    score,
    totalHeadlines: headlines.length,
    posCount, negCount,
    keywords: {
      positive: keyPos.length ? keyPos.join("、") : "无明显利好词",
      negative: keyNeg.length ? keyNeg.join("、") : "无明显利空词"
    },
    topHeadlines: headlines.slice(0, 8).map(h => ({ title: h.title }))
  };
}
module.exports = { generateDailyReview, fetchData, parseTencent, fetchNews, analyzeNewsSentiment };
\n
// === 所有A股大盘指数配置 ===
const ALL_INDICES = {
  "sh000001": { key: "sh",     name: "上证指数",     shortName: "上证" },
  "sz399001": { key: "sz",     name: "深证成指",     shortName: "深证" },
  "sz399006": { key: "cy",     name: "创业板指",     shortName: "创业板" },
  "sh000300": { key: "hs300",  name: "沪深300",      shortName: "沪深300" },
  "sh000016": { key: "sz50",   name: "上证50",       shortName: "上证50" },
  "sh000905": { key: "zz500",  name: "中证500",      shortName: "中证500" },
  "sh000852": { key: "zz1000", name: "中证1000",     shortName: "中证1000" },
  "sh000688": { key: "kc50",   name: "科创50",       shortName: "科创50" },
  "sh000010": { key: "sz180",  name: "上证180",      shortName: "上证180" },
  "sz399330": { key: "sz100",  name: "深证100",      shortName: "深证100" }
};

const INDICES_LIST = Object.keys(ALL_INDICES);
const INDICES_QUERY = INDICES_LIST.join(",");
const INDICES_CODE_MAP = {};
INDICES_LIST.forEach(function(code) {
  const rawCode = code.replace(/^(sh|sz)/, "");
  INDICES_CODE_MAP[rawCode] = ALL_INDICES[code].key;
});

// === 对任意K线数据计算技术指标 ===
function computeTechnicalAnalysis(klines) {
  if (!klines || klines.length < 5) return null;
  const closes = klines.map(function(k) { return k.close; });
  const highs = klines.map(function(k) { return k.high; });
  const lows = klines.map(function(k) { return k.low; });
  const volumes = klines.map(function(k) { return k.volume; });
  const last = klines.length - 1;

  const ma5 = calcSMA(closes, 5);
  const ma10 = calcSMA(closes, 10);
  const ma20 = calcSMA(closes, 20);
  const macd = calcMACD(closes);
  const rsi6 = calcRSI(closes, 6);
  const rsi14 = calcRSI(closes, 14);
  const kdj = calcKDJ(highs, lows, closes, 9);
  const volMa5 = calcSMA(volumes, 5);

  var result = {};

  result.ma = {
    ma5: ma5[last] !== null ? ma5[last].toFixed(2) : "--",
    ma10: ma10[last] !== null ? ma10[last].toFixed(2) : "--",
    ma20: ma20[last] !== null ? ma20[last].toFixed(2) : "--"
  };
  result.macd = {
    dif: macd.dif[last] !== undefined ? macd.dif[last].toFixed(2) : "--",
    dea: macd.dea[last] !== undefined ? macd.dea[last].toFixed(2) : "--",
    histogram: macd.histogram[last] !== undefined ? macd.histogram[last].toFixed(2) : "--"
  };
  result.rsi = {
    rsi6: rsi6[last] !== null ? rsi6[last].toFixed(1) : "--",
    rsi14: rsi14[last] !== null ? rsi14[last].toFixed(1) : "--"
  };
  result.kdj = {
    k: kdj.k[last] !== undefined ? kdj.k[last].toFixed(1) : "--",
    d: kdj.d[last] !== undefined ? kdj.d[last].toFixed(1) : "--",
    j: kdj.j[last] !== undefined ? kdj.j[last].toFixed(1) : "--"
  };

  if (closes.length >= 20) {
    const boll = calcBOLL(closes, 20);
    result.boll = {
      upper: boll.upper[last] !== null ? boll.upper[last].toFixed(2) : "--",
      middle: boll.middle[last] !== null ? boll.middle[last].toFixed(2) : "--",
      lower: boll.lower[last] !== null ? boll.lower[last].toFixed(2) : "--"
    };
  } else {
    result.boll = { upper: "--", middle: "--", lower: "--" };
  }

  result.volumeMa5 = volMa5[last] !== null ? (volMa5[last] / 1e8).toFixed(0) + "亿" : "--";

  // Trend analysis
  const trend5 = klines.slice(-5);
  const trend10 = klines.slice(-10);

  result.trend = {};
  result.trend.last5 = trend5.map(function(k) {
    return { date: k.date, close: k.close.toFixed(2), changePct: "0" };
  });
  for (var ti = 1; ti < result.trend.last5.length; ti++) {
    var idx5 = klines.indexOf(trend5[ti - 1]) - 1;
    var prevClose = idx5 >= 0 ? klines[idx5].close : parseFloat(result.trend.last5[ti - 1].close);
    result.trend.last5[ti].changePct = ((parseFloat(result.trend.last5[ti].close) - prevClose) / prevClose * 100).toFixed(2);
  }

  result.trend.last10 = trend10.map(function(k) {
    return { date: k.date, close: k.close.toFixed(2), changePct: "0" };
  });
  for (var ti2 = 1; ti2 < result.trend.last10.length; ti2++) {
    var idx10 = klines.indexOf(trend10[ti2 - 1]) - 1;
    var prevClose10 = idx10 >= 0 ? klines[idx10].close : parseFloat(result.trend.last10[ti2 - 1].close);
    result.trend.last10[ti2].changePct = ((parseFloat(result.trend.last10[ti2].close) - prevClose10) / prevClose10 * 100).toFixed(2);
  }

  if (trend5.length >= 2) {
    var c5_ = (trend5[trend5.length - 1].close - trend5[0].close) / trend5[0].close * 100;
    result.trend.cumulative5 = (c5_ >= 0 ? "+" : "") + c5_.toFixed(2) + "%";
  } else { result.trend.cumulative5 = "--"; }
  if (trend10.length >= 2) {
    var c10_ = (trend10[trend10.length - 1].close - trend10[0].close) / trend10[0].close * 100;
    result.trend.cumulative10 = (c10_ >= 0 ? "+" : "") + c10_.toFixed(2) + "%";
  } else { result.trend.cumulative10 = "--"; }

  // Direction
  if (trend5.length >= 2) {
    var c5dir = (trend5[trend5.length - 1].close - trend5[0].close) / trend5[0].close * 100;
    var upDays = 0, downDays = 0, consUp = 0, consDown = 0, maxConsUp = 0, maxConsDown = 0;
    for (var td = 1; td < trend5.length; td++) {
      var chgT = (trend5[td].close - trend5[td - 1].close) / trend5[td - 1].close * 100;
      if (chgT > 0) { upDays++; consUp++; consDown = 0; maxConsUp = Math.max(maxConsUp, consUp); }
      else { downDays++; consDown++; consUp = 0; maxConsDown = Math.max(maxConsDown, consDown); }
    }
    result.trend.consecutiveDays = Math.max(maxConsUp, maxConsDown);
    if (c5dir > 1.5 && maxConsUp >= 3) result.trend.direction = "\u2191 \u4e0a\u5347\u8d8b\u52bf";
    else if (c5dir < -1.5 && maxConsDown >= 3) result.trend.direction = "\u2193 \u4e0b\u964d\u8d8b\u52bf";
    else if (c5dir > 0.5) result.trend.direction = "\u2197 \u9707\u8361\u504f\u591a";
    else if (c5dir < -0.5) result.trend.direction = "\u2198 \u9707\u8361\u504f\u7a7a";
    else result.trend.direction = "\u2194 \u9707\u8361\u6574\u7406";
  }

  // Key levels
  var closeVal = closes[last];
  var high20 = Math.max.apply(null, closes.slice(Math.max(0, last - 19), last + 1));
  var low20 = Math.min.apply(null, closes.slice(Math.max(0, last - 19), last + 1));
  result.keyLevels = {};
  result.keyLevels.resist = (closeVal + (high20 - low20) * 0.382).toFixed(2) + " ~ " + (closeVal + (high20 - low20) * 0.5).toFixed(2);
  result.keyLevels.support = (closeVal - (high20 - low20) * 0.382).toFixed(2) + " ~ " + (closeVal - (high20 - low20) * 0.5).toFixed(2);
  result.keyLevels.current = closeVal.toFixed(2);

  return result;
}

// === 为任意指数生成次日预测 ===
function generateIndexPrediction(indexName, indexData, tech, trend) {
  if (!indexData || !tech || !trend) return "--";

  var close = indexData.price;
  var open = indexData.open || close;
  var preClose = indexData.preClose || close;
  var chg = indexData.changePct || 0;
  var gapPct = preClose > 0 ? ((open - preClose) / preClose * 100).toFixed(2) : "0";

  var ol = "【" + indexName + "预测】";

  // Part 1
  var trendDir = trend.direction || "震荡整理";
  var c5 = trend.cumulative5 || "--";
  var c10 = trend.cumulative10 || "--";
  var consDays = trend.consecutiveDays || 0;
  ol += "【趋势背景】" + trendDir + "（近5日" + c5 + "，近10日" + c10 + "）";
  if (consDays >= 2) ol += "，已连涨/跌" + consDays + "日。";
  else ol += "。";

  // Part 2
  var dif = parseFloat(tech.macd.dif);
  var dea = parseFloat(tech.macd.dea);
  var hist = parseFloat(tech.macd.histogram);
  var rsi14v = parseFloat(tech.rsi.rsi14);
  var kv = parseFloat(tech.kdj.k);
  var dv = parseFloat(tech.kdj.d);
  var jv = parseFloat(tech.kdj.j);
  var bollM = parseFloat(tech.boll.middle);
  var bollU = parseFloat(tech.boll.upper);
  var bollL = parseFloat(tech.boll.lower);

  ol += "【技术研判】";
  if (dif > dea) ol += "MACD金叉状态（DIF在DEA上方），" + (hist > 0 ? "红柱放大中，动能偏多。" : "红柱收窄中，动能有衰减。");
  else ol += "MACD死叉状态（DIF在DEA下方），" + (hist < 0 ? "绿柱放大中，动能偏空。" : "绿柱收窄中，动能有改善。");
  if (!isNaN(rsi14v)) {
    if (rsi14v > 65) ol += "RSI14=" + rsi14v.toFixed(1) + "（偏强区间），超买需警惕回调。";
    else if (rsi14v < 35) ol += "RSI14=" + rsi14v.toFixed(1) + "（偏弱区间），超卖有反弹预期。";
    else ol += "RSI14=" + rsi14v.toFixed(1) + "（中性区间），方向待选择。";
  }
  if (!isNaN(kv) && !isNaN(dv)) {
    if (kv > dv) ol += "KDJ金叉中，多头占优。";
    else ol += "KDJ死叉中，空头占优。";
  }
  if (!isNaN(jv)) {
    if (jv > 100) ol += "J值" + jv.toFixed(1) + "超买区，警惕回调。";
    else if (jv < 0) ol += "J值" + jv.toFixed(1) + "超卖区，有反弹需求。";
  }

  if (!isNaN(bollU) && !isNaN(bollL) && !isNaN(bollM)) {
    ol += "布林带：当前价" + close.toFixed(2);
    if (close >= bollU) {
      ol += "贴紧上轨运行，短期超买，注意回调至中轨" + bollM.toFixed(2) + "附近。";
    } else if (close <= bollL) {
      ol += "贴紧下轨运行，短期超卖，有反弹至中轨" + bollM.toFixed(2) + "预期。";
    } else if (close > bollM) {
      var pct_u = ((close - bollM) / (bollU - bollM) * 100).toFixed(0);
      ol += "位于中轨上方（中轨" + bollM.toFixed(2) + "），处在上轨" + bollU.toFixed(2) + "和中轨之间" + pct_u + "%位置，偏强震荡。";
    } else {
      var pct_d = ((bollM - close) / (bollM - bollL) * 100).toFixed(0);
      ol += "位于中轨下方（中轨" + bollM.toFixed(2) + "），处在下轨" + bollL.toFixed(2) + "和中轨之间" + pct_d + "%位置，偏弱震荡。";
    }
  }

  // Part 3
  var levels = tech.keyLevels || {};
  ol += "【关键点位】支撑" + (levels.support || "--") + "，压力" + (levels.resist || "--") + "。";

  if (!isNaN(bollM) && close > bollM) {
    ol += "当前在支撑上方，回踩支撑不破可博弈反弹；跌破则观望。";
  } else {
    ol += "当前在压力下方，突破压力并站稳可看高一线；遇阻则减仓。";
  }

  // Part 4
  ol += "【盘内推演】";
  ol += "若高开" + (parseFloat(gapPct) > 0.3 ? "（延续今日方向）" : "（观察能否守住涨幅）") + "，";

  if (!isNaN(rsi14v) && !isNaN(jv)) {
    if (rsi14v > 65 && jv > 100) {
      ol += "注意高开低走风险，不宜追涨，等待回踩支撑布局。";
    } else if (rsi14v < 35 && jv < 0) {
      ol += "若低开探底可轻仓试多，关注支撑位企稳信号。";
    } else if (trendDir.indexOf("上升") >= 0) {
      ol += "顺势而为，回踩支撑位可低吸，突破压力位加仓。止损设在支撑下方。";
    } else if (trendDir.indexOf("下降") >= 0) {
      ol += "反弹至压力位不过则减仓，不逆势抄底，等企稳信号明确。";
    } else {
      ol += "高抛低吸，支撑位低吸，压力位高抛，等待方向突破。";
    }
  } else {
    ol += "震荡格局未改，控制仓位，等待方向明确。";
  }

  ol += "重点关注开盘后30分钟方向选择和下午2:30前后资金动向。";

  // Yang Ning signal
  ol += " 杨宁信号：";
  if (chg > 1.5) ol += "肯砸就肯吸，不追高。";
  else if (chg > 0) ol += "耐心等待，方向确认再出手。";
  else if (chg > -1) ol += "别冲动，守住支撑再考虑。";
  else ol += "至暗时刻是买点，恐慌中寻找机会。";

  return ol;
}

function computeSignalStrength(chg) {
  if (chg > 2.5) return "\ud83d\udd34 卖出区间";
  else if (chg > 1.5) return "\ud83d\udfe1 减仓区间";
  else if (chg > 0) return "\ud83d\udfe2 持有区间";
  else if (chg > -1.5) return "\ud83d\udfe2 观望区间";
  else if (chg > -3) return "\ud83d\udfe2 买入区间（超跌反弹）";
  else return "\ud83d\udfe2 强烈买入区间";
}

// === 主函数：生成每日复盘 ===
async function generateDailyReview() {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const h = now.getHours(), m = now.getMinutes();
  const marketPhase = h < 9 ? "未开盘" : h < 11.5 || (h === 11 && m < 30) ? "早盘" : h < 13 ? "午休" : h < 15 ? "下午盘" : "已收盘";

  var initialIdx = {};
  INDICES_LIST.forEach(function(code) {
    initialIdx[ALL_INDICES[code].key] = null;
  });

  const report = {
    date: today, generatedAt: now.toISOString(), marketPhase,
    indices: JSON.parse(JSON.stringify(initialIdx)),
    marketBreadth: { upCount: 0, downCount: 0, flatCount: 0, total: 0 },
    sectors: [], northFlow: { netIn: 0 }, volume: 0,
    analysis: {
      phase: "--", goldHour: "--", sentiment: "--",
      keyLevels: { support: "--", resist: "--", current: "--" },
      summary: "--", tomorrowOutlook: "--", signalStrength: "--"
    },
    technical: {
      ma: { ma5: "--", ma10: "--", ma20: "--" },
      macd: { dif: "--", dea: "--", histogram: "--" },
      rsi: { rsi6: "--", rsi14: "--" },
      kdj: { k: "--", d: "--", j: "--" },
      boll: { upper: "--", middle: "--", lower: "--" },
      volumeMa5: "--"
    },
    newsAnalysis: {
      sentiment: "--", impact: "--", score: 0,
      totalHeadlines: 0, posCount: 0, negCount: 0,
      keywords: { positive: "--", negative: "--" },
      topHeadlines: []
    },
    trend: {
      last5: [], last10: [],
      direction: "--", consecutiveDays: 0, cumulative5: "--", cumulative10: "--"
    }
  };

  try {
    // Fetch all index quotes
    const idxRes = await fetchData("qt.gtimg.cn", "/q=" + INDICES_QUERY);
    if (idxRes.s === 200) {
      const parsed = parseTencent(idxRes.body);
      parsed.forEach(function(p) {
        var code = p[2] || "";
        var key = INDICES_CODE_MAP[code];
        if (key) {
          report.indices[key] = {
            price: parseFloat(p[3]) || 0, change: parseFloat(p[31]) || 0,
            changePct: parseFloat(p[32]) || 0, open: parseFloat(p[5]) || 0,
            high: parseFloat(p[33]) || 0, low: parseFloat(p[34]) || 0,
            preClose: parseFloat(p[4]) || 0, turnover: parseFloat(p[37]) || 0
          };
        }
      });
    }

    // Sector data
    try {
      const secRes = await fetchData("push2.eastmoney.com", "/api/qt/clist/get?cb=&pn=1&pz=80&po=1&np=1&fields=f12,f14,f2,f3,f4&fid=f3&fs=m:90+t:2&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2");
      if (secRes && secRes.s === 200) {
        try {
          var json = JSON.parse(secRes.body.replace(/^\(|\)$/g, ""));
          var list = (json.data && json.data.diff) || json.diff || [];
          if (list.length) {
            report.sectors = list.filter(function(d) { return d.f14; }).map(function(d) {
              return { name: d.f14, price: d.f2 || 0, changePct: d.f3 || 0, change: d.f4 || 0 };
            }).sort(function(a, b) { return b.changePct - a.changePct; });
          }
        } catch (e) {}
      }
    } catch (e) {}

    // News
    const newsResult = await fetchNews();
    if (newsResult && newsResult.length) {
      report.newsAnalysis = analyzeNewsSentiment(newsResult);
    }

    // Total volume
    if (report.indices.sh) {
      report.volume = (report.indices.sh.turnover || 0) + (report.indices.sz && report.indices.sz.turnover || 0);
    }

    // Fetch K-lines and compute indicators for ALL indices
    var allKlines = {};
    var allTechs = {};
    for (var ki = 0; ki < INDICES_LIST.length; ki++) {
      var idxCode = INDICES_LIST[ki];
      var idxKey = ALL_INDICES[idxCode].key;
      var klines = await fetchKline(idxCode, 30);
      allKlines[idxKey] = klines;
      allTechs[idxKey] = computeTechnicalAnalysis(klines);
    }

    // Use SH data for backward-compatible main analysis
    var klines = allKlines["sh"];
    var techSH = allTechs["sh"];
    if (klines && klines.length >= 5 && techSH) {
      report.technical = techSH;
      report.trend = techSH.trend;
      report.analysis.keyLevels = techSH.keyLevels || { support: "--", resist: "--", current: "--" };
      if (report.indices.sh) {
        report.analysis.keyLevels.current = report.indices.sh.price.toFixed(2);
      }

      var shData = report.indices.sh;
      var closeSH = shData ? shData.price : parseFloat(techSH.ma.ma5) || 0;
      var chgSH = shData ? shData.changePct || 0 : 0;
      var ampPct = shData ? ((shData.high - shData.low) / (shData.preClose || 1) * 100) : 0;

      report.analysis.phase = "\u2795 " + (ampPct < 0.8 ? "窄幅震荡" : ampPct < 1.5 ? "中等震荡" : "幅度较大") + "（" + (chgSH >= 0 ? "+" : "") + chgSH.toFixed(2) + "%，振幅" + ampPct.toFixed(1) + "%）";

      var goldHourParts = [];
      if (shData) {
        var gapStr = shData.open > 0 && shData.preClose > 0 ? ((shData.open - shData.preClose) / shData.preClose * 100).toFixed(2) + "%" : "--";
        goldHourParts.push("【开盘】" + gapStr);
        goldHourParts.push("【振幅】" + ampPct.toFixed(1) + "%");
        goldHourParts.push("【收盘位置】" + (closeSH > (shData.high + shData.low) / 2 ? "偏高位收盘（偏强）" : "偏低位收盘（偏弱）"));
        var bodySize = Math.abs(shData.price - shData.open) / (shData.high - shData.low || 1);
        goldHourParts.push("【K线形态】" + (bodySize > 0.7 ? "实体较大（意义明确）" : "实体适中（正常波动）"));
        if (shData.low < (shData.preClose || 0)) goldHourParts.push("⚠️ 盘中回补跳空缺口");
        goldHourParts.push(chgSH >= 0 ? "✅ 收高（红盘）" : "❌ 收低（绿盘）");
        goldHourParts.push("→ " + (chgSH >= 0 ? "日内震荡上行格局" : "日内震荡下行格局"));
      }
      report.analysis.goldHour = goldHourParts.join(" | ");

      if (chgSH > 0.3) report.analysis.sentiment = "😊 偏暖";
      else if (chgSH > -0.3) report.analysis.sentiment = "😐 中性";
      else report.analysis.sentiment = "😨 偏冷";

      report.analysis.summary = "【当日概况】上证" + closeSH.toFixed(2) + "点（" + (chgSH >= 0 ? "+" : "") + chgSH.toFixed(2) + "%）";
      if (report.volume) report.analysis.summary += " 成交额" + (report.volume / 1e8).toFixed(0) + "亿";
      var macdHist = parseFloat(techSH.macd.histogram);
      var rsi14vSH = parseFloat(techSH.rsi.rsi14);
      report.analysis.summary += " | MACD柱" + macdHist.toFixed(2) + " RSI14=" + (rsi14vSH ? rsi14vSH.toFixed(1) : "--");

      // Generate predictions for ALL indices
      report.predictions = {};
      INDICES_LIST.forEach(function(code) {
        var key2 = ALL_INDICES[code].key;
        var name2 = ALL_INDICES[code].name;
        var idxData2 = report.indices[key2];
        var tech2 = allTechs[key2];
        if (idxData2 && tech2) {
          var pred = {};
          pred.technical = tech2;
          pred.trend = tech2.trend;
          pred.tomorrowOutlook = generateIndexPrediction(name2, idxData2, tech2, tech2.trend);
          pred.signalStrength = computeSignalStrength(idxData2.changePct || 0);
          report.predictions[key2] = pred;
        }
      });

      // Set main analysis from SH prediction
      var shPred = report.predictions["sh"];
      if (shPred) {
        report.analysis.tomorrowOutlook = shPred.tomorrowOutlook;
        report.analysis.signalStrength = shPred.signalStrength;
      }
    }
  } catch (e) { report.error = e.message; }

  const fp = path.join(DATA_DIR, "review_" + today + ".json");
  fs.writeFileSync(fp, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(path.join(DATA_DIR, "latest.json"), JSON.stringify(report, null, 2), "utf8");
  return report;
}
