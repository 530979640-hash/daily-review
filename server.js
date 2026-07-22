const http = require("http");
const https = require("https");
const url = require("url");
const path = require("path");
const fs2 = require("fs");
const dailyReview = require('./daily-review');

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

function fetchUtf8(host, p) {
  return new Promise((resolve, reject) => {
    const req = https.request({hostname:host,path:p,method:'GET',timeout:10000,
      headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
    }, res => {
      const chunks = [];
      res.on('data',c=>chunks.push(c));
      res.on('end',()=>{
        resolve({s:res.statusCode,body:Buffer.concat(chunks).toString('utf8')});
      });
    });
    req.on('error',reject);
    req.on('timeout',()=>{req.destroy();reject(new Error('timeout'));});
    req.end();
  });
}
function parseTencent(text) {
  const lines = text.split("\n").filter(l=>l.trim());
  const results = [];
  for (const line of lines) {
    const m = line.match(/^v_\w+="(.+)";\s*$/);
    if (!m) continue;
    results.push(m[1].split("~"));
  }
  return results;
}

const INDICES = ["sh000001","sz399001","sz399006","sh000300","sh000016","sh000905","sh000852","sh000688","sh000010","sz399330"];
function genAllCodes() {
  const codes = [];
  // SH Main Board 600000-609999
  for(let i=0;i<10000;i++) codes.push("sh"+(600000+i));
  // SH STAR Market 688000-689999
  for(let i=0;i<2000;i++) codes.push("sh"+(688000+i));
  // SZ Main Board 000001-001999
  for(let i=1;i<2000;i++) codes.push("sz"+(i+1000000).toString().slice(1));
  // SZ SME Board 002000-002999
  for(let i=0;i<1000;i++) codes.push("sz"+(2000+i+1000000).toString().slice(1));
  // SZ ChiNext 300000-302999
  for(let i=0;i<3000;i++) codes.push("sz"+(300000+i));
  // SZ New Board 003000-003999
  for(let i=0;i<1000;i++) codes.push("sz"+(3000+i+1000000).toString().slice(1));
  return codes;
}
const ALL_CODES = genAllCodes();
const POPULAR = ALL_CODES;

function toTc(code, m) {
  if (m) return (m==="1"?"sh":"sz")+code;
  return (code.startsWith("6")||code.startsWith("9")?"sh":"sz")+code;
}
// === ģ����ϵͳ ===
// === 板块热度 - 行业成分股映射 ===
const SECTOR_STOCKS = {
  "银行":  ["sh601398","sh601939","sh600036","sh601288","sh600000","sh601166","sh600016","sh601328"],
  "保险":  ["sh601318","sh601628","sh601601","sh601336"],
  "证券":  ["sh600030","sh601688","sz300059","sh601211","sh600837","sh601878","sh601236"],
  "房地产":["sz000002","sh600048","sz001979","sh600383","sh600325","sh600606"],
  "医药":  ["sh600276","sh603259","sh600196","sz300015","sh600085","sz300760","sz002007","sh600521"],
  "半导体":["sh688981","sh603501","sz002371","sh600703","sh688012","sz300661","sh603986"],
  "酿酒":  ["sh600519","sz000858","sz000568","sh600809","sh600702","sz000596"],
  "食品":  ["sh600887","sh603288","sz000895","sz002714","sh600882","sz300146"],
  "汽车":  ["sz002594","sh600104","sh601633","sz000625","sh600741","sz002920"],
  "新能源":["sz300750","sh601012","sh600438","sz002459","sh600089","sz300274"],
  "军工":  ["sh600760","sh600893","sz002179","sh600862","sh600118","sz000547"],
  "通信":  ["sz000063","sh600941","sz300308","sh600745","sh600703","sz002475"],
  "计算机":["sh603019","sz002230","sh600588","sz300496","sz300454","sz002410"],
  "传媒":  ["sz002027","sz300413","sz300251","sh600637","sh600977","sz002555"],
  "有色金属":["sh601899","sz002460","sh603993","sh600547","sh600362","sz000831"],
  "煤炭":  ["sh601088","sh601225","sh601898","sh600188","sh600985","sz000983"],
  "钢铁":  ["sh600019","sz000898","sz000932","sh600010","sh600808","sz000709"],
  "电力":  ["sh600900","sh600011","sh600795","sh600025","sh600886","sz000591"],
  "石油石化":["sh601857","sh600028","sh601808","sh600346","sz000059","sh600256"],
  "农业":  ["sz000998","sh600598","sz002385","sz300189","sh600737","sz002041"],
  "家电":  ["sz000333","sh600690","sz000651","sz002242","sh600060","sz002032"],
  "机械":  ["sh600031","sz000651","sh601100","sz300124","sz002008","sh600150"],
  "电子":  ["sz000725","sh600171","sz002236","sz002241","sz300136","sh603005"],
  "建筑":  ["sh601668","sh601390","sh601186","sh601800","sh600585","sh600170"],
  "化工":  ["sh600309","sh601225","sz002601","sz000830","sh600352","sh600426"],
  "消费电子":["sz002475","sz002241","sh603501","sz300433","sz002600","sz300115"],
  "电气设备":["sh601567","sh600406","sh601877","sz300001","sh603606","sh600517"]
};
// 将股票代码转为Tencent查询格式
function toTc(code) {
  return (code.startsWith("sh")||code.startsWith("sz")) ? code : 
    ((code.startsWith("6")||code.startsWith("9"))?"sh":"sz")+code;
}
// 从Tencent数据中提取股票信息
function parseStockFromTencent(fields) {
  return {
    code: fields[2] || "",
    name: fields[1] || "",
    price: parseFloat(fields[3]) || 0,
    change: parseFloat(fields[31]) || 0,
    changePct: parseFloat(fields[32]) || 0
  };
}

const SIM_DATA_FILE = path.join(__dirname, 'sim_data.json');
function loadSim() {
  try{return JSON.parse(fs2.readFileSync(SIM_DATA_FILE,'utf8'));}catch(e){return {cash:100000,holdings:{},orders:[],nextId:1};}
}
function saveSim(d){fs2.writeFileSync(SIM_DATA_FILE,JSON.stringify(d,null,2),'utf8');}
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const p = parsed.pathname;
  const q = parsed.query;
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,OPTIONS");
  if (req.method==="OPTIONS") {res.writeHead(204);res.end();return;}

  try {
    if (p==="/api/indices") {
      const ck=gc("indices");
      if(ck){wj(res,ck);return;}
      const r=await fetch("qt.gtimg.cn","/q="+INDICES.join(","));
      if(r.s!==200){we(res,"API error");return;}
      const pList=parseTencent(r.body);
      const indices=pList.map((p2,i)=>({code:INDICES[i].replace(/^sh/,"1.").replace(/^sz/,"0."),
        name:p2[1],
        price:parseFloat(p2[3])||0,
        change:parseFloat(p2[31])||0,
        changePct:parseFloat(p2[32])||0
      }));
      sc("indices",indices);
      wj(res,indices);
      return;
    }
    if (p==="/api/kline") {
      const secid=q.secid||"1.000001";
      const days=parseInt(q.days)||30;
      const ck=gc("kline_"+secid);
      if(ck){wj(res,ck);return;}
      const ps=secid.split(".");
      const tc=(ps[0]==="1"?"sh":"sz")+ps[1];
      try{
        const r=await fetch("web.ifzq.gtimg.cn","/appstock/app/fqkline/get?param="+tc+",day,,,"+days+",qfq");
        if(r.s!==200){wj(res,[]);return;}
        const j=JSON.parse(r.body);
        const daysArr=j.data&&j.data[tc]&&j.data[tc].day;
        if(!daysArr){wj(res,[]);return;}
        const kline=daysArr.map(d=>({date:d[0],open:parseFloat(d[1]),close:parseFloat(d[2]),high:parseFloat(d[3]),low:parseFloat(d[4]),volume:parseFloat(d[5])}));
        sc("kline_"+secid,kline);
        wj(res,kline);
      }catch(e){wj(res,[]);}
      return;
    }
    if (p==="/api/intraday") {
      const secid=q.secid||"1.000001";
      const ck=gc("intra_"+secid);
      if(ck){wj(res,ck);return;}
      const ps=secid.split(".");
      const tc=(ps[0]==="1"?"sh":"sz")+ps[1];
      try{
        const r=await fetch("web.ifzq.gtimg.cn","/appstock/app/minute/query?code="+tc);
        if(r.s!==200){wj(res,{error:"API error"});return;}
        const j=JSON.parse(r.body);
        const src=j.data&&j.data[tc]&&j.data[tc].data&&j.data[tc].data.data;
        if(!src||!Array.isArray(src)){wj(res,{error:"No data"});return;}
        const qt=j.data[tc].qt[tc];
        const preClose=parseFloat(qt[4])||0;
        const current=parseFloat(qt[3])||0;
        const date=j.data[tc].data.date||"";
        const points=src.map(function(v){
          const parts=v.split(" ");
          const t=parts[0];
          const hh=t.substring(0,2);
          const mm=t.substring(2,4);
          return {time:hh+":"+mm,price:parseFloat(parts[1])||0,volume:parseFloat(parts[2])||0,amount:parseFloat(parts[3])||0};
        });
        const result={secid,code:tc,date,preClose,current,points};
        sc("intra_"+secid,result);
        wj(res,result);
      }catch(e){wj(res,{error:e.message});}
      return;
    }
    if (p==="/api/stocks") {
      const page=parseInt(q.page)||1;
      const size=parseInt(q.size)||30;
      const sort=q.sort||"f3";
      const order=q.order||"desc";
      const ck=gc("stocks_"+sort+"_"+order+"_"+page+"_"+size);
      if(ck){wj(res,ck);return;}
      const allStocks=[];
      for(let i=0;i<POPULAR.length;i+=300){
        const batch=POPULAR.slice(i,i+300).join(",");
        const r=await fetch("qt.gtimg.cn","/q="+batch);
        if(r.s===200){
          parseTencent(r.body).forEach(p2=>{
            allStocks.push({
                    code:p2[2],name:p2[1],price:parseFloat(p2[3])||0,
                    changePct:parseFloat(p2[32])||0,change:parseFloat(p2[31])||0,
                    volume:parseFloat(p2[6])||0,turnover:parseFloat(p2[37])||0,high:parseFloat(p2[33])||0,low:parseFloat(p2[34])||0,
                    open:parseFloat(p2[5])||0,preClose:parseFloat(p2[4])||0,
              amplitude:parseFloat(p2[38])||0,turnoverRate:parseFloat(p2[40])||0,
              pe:p2[39]||"--",mktCap:parseFloat(p2[45])||0,circCap:parseFloat(p2[44])||0
            });
          });
        }
      }
      const smap={f2:"price",f3:"changePct",f4:"change",f5:"volume",f6:"turnover",f7:"turnoverRate",f8:"amplitude",f12:"code",f14:"name",f20:"mktCap",f21:"circCap"};
      const sf=smap[sort]||"changePct";
      const sortDir=order==="desc"?1:-1;
      allStocks.sort((a,b)=>{
        const va=a[sf],vb=b[sf];
        const numa=parseFloat(va),numb=parseFloat(vb);
        const cmp=!isNaN(numa)&&!isNaN(numb)?numa-numb:String(va||"").localeCompare(String(vb||""));
        return sortDir*cmp||0;
      });
      const result={total:allStocks.length,page,size,stocks:allStocks.slice((page-1)*size,page*size)};
      sc("stocks_"+sort+"_"+order+"_"+page+"_"+size,result);
      wj(res,result);
      return;
    }
    if (p==="/api/search") {
      const qq=(q.q||"").trim().toUpperCase();
      if(!qq){wj(res,{stocks:[]});return;}
      const ck=gc("search_"+qq);
      if(ck){wj(res,ck);return;}
      const allStocks=[];
      const maxBatch = POPULAR.length;
      for(let i=0;i<maxBatch;i+=300){
        try{
          const batch=POPULAR.slice(i,i+300).join(",");
          const r=await fetch("qt.gtimg.cn","/q="+batch);
          if(r.s===200&&r.body){
            const parsed=parseTencent(r.body);
            if(parsed&&parsed.length>0){
              parsed.forEach(p2=>{
                if((p2[1]&&p2[1].indexOf(qq)>=0)||(p2[2]&&p2[2].indexOf(qq)>=0)){
                  allStocks.push({
                    code:p2[2],name:p2[1],price:parseFloat(p2[3])||0,
                    changePct:parseFloat(p2[32])||0,change:parseFloat(p2[31])||0,
                    volume:parseFloat(p2[6])||0,high:parseFloat(p2[33])||0,low:parseFloat(p2[34])||0,
                    open:parseFloat(p2[5])||0,preClose:parseFloat(p2[4])||0,
                    amplitude:parseFloat(p2[38])||0,turnoverRate:parseFloat(p2[40])||0
                  });
                }
              });
            }
          }
        }catch(e){}
      }
      sc("search_"+qq,{stocks:allStocks});
      wj(res,{stocks:allStocks});
      return;
    }
    if (p==="/api/market-data") {
      const ck=gc("md");
      if(ck){wj(res,ck);return;}
      const r=await fetch("qt.gtimg.cn","/q="+POPULAR.join(","));
      let up=0,down=0,flat=0;
      if(r.s===200){
        parseTencent(r.body).forEach(p2=>{const ch=(parseFloat(p2[32])||0);if(ch>0)up++;else if(ch<0)down++;else flat++;});
      }
      sc("md",{total:up+down+flat,upCount:up,downCount:down,flatCount:flat});
      wj(res,{total:up+down+flat,upCount:up,downCount:down,flatCount:flat});
      return;
    }
    if (p==="/api/north-flow") {
      const ck=gc("nf");
      if(ck){wj(res,ck);return;}
      const net=(Math.random()>0.45?1:-1)*Math.round(Math.random()*60+5);
      sc("nf",{netIn:net,shIn:Math.round(net*0.6),szIn:Math.round(net*0.4),totalIn:Math.round(Math.random()*800+300),totalOut:Math.round(Math.random()*700+200)});
      wj(res,{netIn:net,shIn:Math.round(net*0.6),szIn:Math.round(net*0.4),totalIn:Math.round(Math.random()*800+300),totalOut:Math.round(Math.random()*700+200)});
      return;
    }
    if (p==="/api/prediction") {
      const secid=q.secid||"1.000001";
      const ck=gc("pred_"+secid);
      if(ck){wj(res,ck);return;}
      const ps=secid.split(".");
      const tc=(ps[0]==="1"?"sh":"sz")+ps[1];
      try{
        const r=await fetch("web.ifzq.gtimg.cn","/appstock/app/fqkline/get?param="+tc+",day,,,60,qfq");
        if(r.s!==200){wj(res,{error:"API error"});return;}
        const j=JSON.parse(r.body);
        const days=j.data&&j.data[tc]&&j.data[tc].day;
        if(!days||days.length<20){wj(res,{error:"data short"});return;}
        const closes=days.map(d=>parseFloat(d[2]));
        const lastClose=closes[closes.length-1];
        let ema12,ema26,dif,dea=0;
        const macdArr=[];
        for(let i=0;i<closes.length;i++){
          ema12=i===0?closes[i]:closes[i]*2/13+ema12*11/13;
          ema26=i===0?closes[i]:closes[i]*2/27+ema26*25/27;
          dif=ema12-ema26;
          if(i===0)dea=dif;else dea=dif*0.2+dea*0.8;
          macdArr.push({dif,dea,macd:(dif-dea)*2});
        }
        const lastM=macdArr[macdArr.length-1];
        let gains=0,losses=0;
        for(let i=closes.length-14;i<closes.length;i++){const diff=closes[i]-closes[i-1];if(diff>0)gains+=diff;else losses-=diff;}
        const rsi=losses===0?100:100-100/(1+(gains/14)/(losses/14));
        const ma5=closes.slice(-5).reduce((a,b)=>a+b,0)/5;
        const ma10=closes.slice(-10).reduce((a,b)=>a+b,0)/10;
        const ma20=closes.slice(-20).reduce((a,b)=>a+b,0)/20;
        const std=Math.sqrt(closes.slice(-20).reduce((s,v)=>s+(v-ma20)*(v-ma20),0)/20);
        let score=0,signals=[];
        if(lastM.macd>0)score+=20;
        if(lastM.dif>lastM.dea)score+=15;
        if(rsi>70)score-=10;else if(rsi<30)score+=15;
        if(lastClose>closes[closes.length-5])score+=10;
        if(lastClose>closes[closes.length-10])score+=10;
        if(ma5>ma10&&ma10>ma20){score+=15;signals.push({name:"MA",val:"��ͷ����",dir:"buy"});}
        else if(ma5<ma10&&ma10<ma20){score-=10;signals.push({name:"MA",val:"��ͷ����",dir:"sell"});}
        else signals.push({name:"MA",val:"��������",dir:"hold"});
        signals.push({name:"RSI",val:rsi>70?"����":rsi<30?"����":"����("+rsi.toFixed(0)+")",dir:rsi>70?"sell":rsi<30?"buy":"hold"});
        signals.push({name:"MACD",val:lastM.macd>0?"���":"����",dir:lastM.macd>0?"buy":"sell"});
        signals.push({name:"����",val:lastClose>(ma20+2*std)?"�Ϲ���":"�й츽��",dir:lastClose>(ma20+2*std)?"sell":"hold"});
        const k=(lastClose-closes[closes.length-9])/closes[closes.length-9]*100;
        signals.push({name:"KDJ",val:k>80?"����":k<20?"����":"����",dir:k>80?"sell":k<20?"buy":"hold"});
        const direction=score>=25?"up":score<=-10?"down":"hold";
        const conf=Math.min(Math.abs(score)+50,95);
        const label=direction==="up"?"�����ǡ�":direction==="down"?"��������":"��������";
        const predictions=[];
        let pp=lastClose;
        for(let i=1;i<=5;i++){pp+=lastClose*(0.003*(direction==="up"?1:direction==="down"?-1:0))+(Math.random()-0.5)*lastClose*0.02;const d2=new Date();d2.setDate(d2.getDate()+i);predictions.push({date:d2.toISOString().split("T")[0],predicted:Math.round(pp*100)/100});}
        const result={direction,label,dirLabel:label,confidence:Math.round(conf),range:parseFloat((0.8+Math.random()*2.0).toFixed(1)),lastClose,signals,predictions,indicators:{ma5:Math.round(ma5*100)/100,ma10:Math.round(ma10*100)/100,ma20:Math.round(ma20*100)/100,macd:Math.round(lastM.macd*100)/100,rsi:Math.round(rsi*100)/100}};
        sc("pred_"+secid,result);
        wj(res,result);
      }catch(e){wj(res,{error:e.message});}
      return;
    }
    if (p==="/api/stock-info") {
      const code=q.code||"000001";
      const tc=toTc(code,q.market);
      const ck=gc("si_"+tc);
      if(ck){wj(res,ck);return;}
      try{
        const r=await fetch("qt.gtimg.cn","/q="+tc);
        if(r.s!==200){we(res,"API error");return;}
        const pList=parseTencent(r.body);
        if(pList.length===0){wj(res,{error:"not found"});return;}
        const p2=pList[0];
        const info={code:p2[2],name:p2[1],price:parseFloat(p2[3])||0,changePct:parseFloat(p2[32])||0,change:parseFloat(p2[31])||0,volume:parseFloat(p2[6])||0,turnover:parseFloat(p2[37])||0,high:parseFloat(p2[33])||0,low:parseFloat(p2[34])||0,open:parseFloat(p2[5])||0,preClose:parseFloat(p2[4])||0,amplitude:parseFloat(p2[38])||0,pe:p2[39]||"--",turnoverRate:parseFloat(p2[40])||0,mktCap:parseFloat(p2[45])||0,circCap:parseFloat(p2[44])||0,eps:p2[46]||"--"};
        sc("si_"+tc,info);
        wj(res,info);
      }catch(e){wj(res,{error:e.message});}
      return;
    }

    if (p==='/api/market-overview') {
      const ck=gc("market_overview");
      if(ck){wj(res,ck);return;}
      try{
        const r=await fetch("qt.gtimg.cn","/q="+ALL_CODES.slice(0,1000).join(","));
        if(r.s!==200){wj(res,{rise:0,fall:0,volume:0,turnover:0});return;}
        const pList=parseTencent(r.body);
        let rise=0,fall=0,volume=0,turnover=0;
        for(const p2 of pList){
          const chg=parseFloat(p2[32])||0;
          if(chg>0)rise++;else if(chg<0)fall++;
          volume+=parseFloat(p2[6])||0;
          turnover+=parseFloat(p2[37])||0;
        }
        const result={rise,fall,volume,turnover};
        sc("market_overview",result);
        wj(res,result);
      }catch(e){wj(res,{rise:0,fall:0,volume:0,turnover:0});}
      return;
    }
    if (p==='/api/signals') {
      const secid=q.secid||"1.000001";
      const ck=gc("sig_"+secid);
      if(ck){wj(res,ck);return;}
      try{
        const ps=secid.split(".");
        const tc=(ps[0]==="1"?"sh":"sz")+ps[1];
        const r=await fetch("web.ifzq.gtimg.cn","/appstock/app/fqkline/get?param="+tc+",day,,,60,qfq");
        if(r.s!==200){wj(res,{signals:[],prediction:{direction:"--",confidence:50}});return;}
        const j=JSON.parse(r.body);
        const daysArr=j.data&&j.data[tc]&&j.data[tc].day;
        if(!daysArr||daysArr.length<20){wj(res,{signals:[],prediction:{direction:"--",confidence:50}});return;}
        const closes=daysArr.map(d=>parseFloat(d[2]));
        const lastClose=closes[closes.length-1];
        // EMA/MACD
        let ema12=closes[0],ema26=closes[0],dif,dea=0;
        const macdArr=[];
        for(let i=0;i<closes.length;i++){
          ema12=i===0?closes[i]:closes[i]*2/13+ema12*11/13;
          ema26=i===0?closes[i]:closes[i]*2/27+ema26*25/27;
          dif=ema12-ema26;
          if(i===0)dea=dif;else dea=dif*0.2+dea*0.8;
          macdArr.push({dif,dea,macd:(dif-dea)*2});
        }
        const lastM=macdArr[macdArr.length-1];
        let gains=0,losses=0;
        for(let i=closes.length-14;i<closes.length;i++){const diff=closes[i]-closes[i-1];if(diff>0)gains+=diff;else losses-=diff;}
        const rsi=losses===0?100:100-100/(1+(gains/14)/(losses/14));
        const ma5=closes.slice(-5).reduce((a,b)=>a+b,0)/5;
        const ma10=closes.slice(-10).reduce((a,b)=>a+b,0)/10;
        const ma20=closes.slice(-20).reduce((a,b)=>a+b,0)/20;
        const std=Math.sqrt(closes.slice(-20).reduce((s,v)=>s+(v-ma20)*(v-ma20),0)/20);
        let score=0,signals=[];
        if(lastM.macd>0)score+=20;
        if(lastM.dif>lastM.dea)score+=15;
        if(rsi>70)score-=10;else if(rsi<30)score+=15;
        if(lastClose>closes[closes.length-5])score+=10;
        if(lastClose>closes[closes.length-10])score+=10;
        if(ma5>ma10&&ma10>ma20){score+=15;signals.push({name:"MA",val:"��ͷ����",dir:"buy"});}
        else if(ma5<ma10&&ma10<ma20){score-=10;signals.push({name:"MA",val:"��ͷ����",dir:"sell"});}
        else signals.push({name:"MA",val:"��������",dir:"hold"});
        signals.push({name:"RSI",val:rsi>70?"����":rsi<30?"����":"����("+rsi.toFixed(0)+")",dir:rsi>70?"sell":rsi<30?"buy":"hold"});
        signals.push({name:"MACD",val:lastM.macd>0?"���":"����",dir:lastM.macd>0?"buy":"sell"});
        signals.push({name:"����",val:lastClose>(ma20+2*std)?"�Ϲ���":"�й츽��",dir:lastClose>(ma20+2*std)?"sell":"hold"});
        const k=((lastClose-closes[closes.length-9])/closes[closes.length-9]*100);
        signals.push({name:"KDJ",val:k>80?"����":k<20?"����":"����",dir:k>80?"sell":k<20?"buy":"hold"});
        const direction=score>=25?"����":score<=-10?"����":"����";
        const conf=Math.min(Math.abs(score)+50,95);
        const result={signals,prediction:{direction:direction,confidence:conf,score:score}};
        sc("sig_"+secid,result);
        wj(res,result);
      }catch(e){wj(res,{signals:[],prediction:{direction:"--",confidence:50}});}
      return;
    }

    if (p==='/api/sim/account') {
      const sim=loadSim();
      const codes=Object.keys(sim.holdings);
      let totalMarket=0,totalCost=0,holdingsDetail=[];
      for(const ci of codes){
        const h=sim.holdings[ci];
        const tc=toTc(ci);
        try{
          const r=await fetch('qt.gtimg.cn','/q='+tc);
          if(r.s===200){
            const pl=parseTencent(r.body);
            if(pl.length>0){
              const cur=parseFloat(pl[0][3])||0;
              const mv=cur*h.shares;
              totalMarket+=mv;
              totalCost+=h.avgCost*h.shares;
              holdingsDetail.push({code:ci,name:h.name,shares:h.shares,avgCost:h.avgCost,current:cur,marketValue:mv,profit:(cur-h.avgCost)*h.shares,profitPct:cur>0?((cur-h.avgCost)/h.avgCost*100).toFixed(2):0});
            }
          }
        }catch(e){}
      }
      wj(res,{cash:sim.cash,totalAssets:parseFloat((sim.cash+totalMarket).toFixed(2)),totalMarket:parseFloat(totalMarket.toFixed(2)),holdings:holdingsDetail,orderCount:sim.orders.length});
      return;
    }
    if (p==='/api/sim/buy' && req.method==='POST') {
      let body='';req.on('data',c=>body+=c);req.on('end',()=>{
        try{
          const {code,name,price,shares}=JSON.parse(body);
          if(!code||!name||!price||!shares||shares<100||shares%100!==0){we(res,'������������������Ϊ100�ı���');return;}
          const amount=price*shares;
          const fee=Math.max(amount*0.00025,5);
          const total=amount+fee;
          const sim=loadSim();
          if(total>sim.cash){we(res,'�����ʽ���');return;}
          sim.cash=parseFloat((sim.cash-total).toFixed(2));
          if(!sim.holdings[code])sim.holdings[code]={code,name,shares:0,avgCost:0};
          const h=sim.holdings[code];
          const totalCost=h.avgCost*h.shares+amount;
          h.shares+=shares;
          h.avgCost=parseFloat((totalCost/h.shares).toFixed(3));
          sim.orders.push({id:sim.nextId++,code,name,type:'buy',price,shares,amount:parseFloat(amount.toFixed(2)),fee:parseFloat(fee.toFixed(2)),total:parseFloat(total.toFixed(2)),time:new Date().toISOString(),date:new Date().toISOString().split('T')[0]});
          saveSim(sim);
          wj(res,{success:true,cash:sim.cash,msg:'����'+name+shares+'�ɳɹ�'});
        }catch(e){we(res,e.message);}
      });
      return;
    }
    if (p==='/api/sim/sell' && req.method==='POST') {
      let body='';req.on('data',c=>body+=c);req.on('end',()=>{
        try{
          const {code,price,shares}=JSON.parse(body);
          if(!code||!price||!shares||shares<100||shares%100!==0){we(res,'������������������Ϊ100�ı���');return;}
          const sim=loadSim();
          const h=sim.holdings[code];
          if(!h||h.shares<shares){we(res,'�ֹ���������');return;}
          const amount=price*shares;
          const fee=Math.max(amount*0.00025,5);
          const stamp=amount*0.001;
          const net=parseFloat((amount-fee-stamp).toFixed(2));
          h.shares-=shares;
          if(h.shares===0)delete sim.holdings[code]; else h.avgCost=parseFloat(h.avgCost.toFixed(3));
          sim.cash=parseFloat((sim.cash+net).toFixed(2));
          sim.orders.push({id:sim.nextId++,code:h.code,name:h.name,type:'sell',price,shares,amount:parseFloat(amount.toFixed(2)),fee:parseFloat(fee.toFixed(2)),stamp:parseFloat(stamp.toFixed(2)),net,time:new Date().toISOString()});
          saveSim(sim);
          wj(res,{success:true,cash:sim.cash,msg:'����'+h.name+shares+'�ɳɹ�'});
        }catch(e){we(res,e.message);}
      });
      return;
    }
    if (p==='/api/sim/search') {
      const qq=(q.q||'').trim();
      if(!qq||qq.length<1){wj(res,{stocks:[]});return;}
      const ck=gc('simsearch_'+qq);
      if(ck){wj(res,ck);return;}
      try{
        const r=await fetchUtf8('searchadapter.eastmoney.com','/api/suggest/get?input='+encodeURIComponent(qq)+'&count=15&type=14');
        if(r.s===200 && r.body){
          try{
            const j=JSON.parse(r.body);
            const data=j&&j.QuotationCodeTable&&j.QuotationCodeTable.Data;
            if(data&&data.length>0){
              const stocks=data.filter(function(d){return d.SecurityTypeName==='A股'||(d.SecurityTypeName&&d.SecurityTypeName.indexOf('A')>=0);}).map(function(d){
                const code=d.Code;
                const mkt=code.startsWith('6')||code.startsWith('9')?'1':'0';
                return{code:code,name:d.Name||d.InnerName||'',market:mkt};
              });
              sc('simsearch_'+qq,{stocks:stocks});
              wj(res,{stocks:stocks});return;
            }
          }catch(e){}
        }
      }catch(e){}
      // Fallback: search through POPULAR list
      try{
        const r=await fetch('qt.gtimg.cn','/q='+POPULAR.slice(0,300).join(','));
        if(r.s===200&&r.body){
          const parsed=parseTencent(r.body);
          const upQQ=qq.toUpperCase();
          const stocks=parsed.filter(function(p2){return(p2[1]&&p2[1].indexOf(qq)>=0)||(p2[2]&&p2[2].indexOf(upQQ)>=0);}).map(function(p2){
            const code=p2[2];
            return{code:code,name:p2[1]||'',market:code.startsWith('6')||code.startsWith('9')?'1':'0'};
          });
          sc('simsearch_'+qq,{stocks:stocks});
          wj(res,{stocks:stocks});return;
        }
      }catch(e){}
      wj(res,{stocks:[]});
    }
    if (p==='/api/sim/orders') {
      const sim=loadSim();
      wj(res,sim.orders.slice().reverse());
      return;
    }
    if (p==='/api/sim/reset' && req.method==='POST') {
      saveSim({cash:100000,holdings:{},orders:[],nextId:1});
      wj(res,{success:true,msg:'ģ����������'});
      return;
    }
        if (p==='/api/sectors') {
      const ck=gc("sectors");
      if(ck){wj(res,ck);return;}
      try{
        const r=await fetch("push2.eastmoney.com","/api/qt/clist/get?cb=&pn=1&pz=80&po=1&np=1&fields=f12,f14,f2,f3,f4&fid=f3&fs=m:90+t:2&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2");
        if(r.s===200){
          const j=JSON.parse(r.body);
          const diff=j.data&&j.data.diff;
          if(diff&&diff.length>0){
            const sectors=diff.map(function(d){return{code:d.f12,name:d.f14,price:d.f2||0,changePct:d.f3||0,change:d.f4||0};});
            sc("sectors",sectors);
            wj(res,sectors);
            return;
          }
        }
      }catch(e){}
      await fallbackSectors();
      async function fallbackSectors(){
        try{
          const allCodes=[];
          const sectorMap={};
          Object.keys(SECTOR_STOCKS).forEach(function(sector){
            sectorMap[sector]={name:sector,sumChangePct:0,count:0,price:0};
            SECTOR_STOCKS[sector].forEach(function(code){allCodes.push(code);});
          });
          const r=await fetch("qt.gtimg.cn","/q="+allCodes.join(","));
          if(r.s===200&&r.body){
            const pList=parseTencent(r.body);
            pList.forEach(function(p2){
              const code=p2[2];
              const chg=parseFloat(p2[32])||0;
              const price=parseFloat(p2[3])||0;
              Object.keys(SECTOR_STOCKS).forEach(function(sector){
                SECTOR_STOCKS[sector].forEach(function(sc){
                  if(sc.endsWith(code)){
                    sectorMap[sector].sumChangePct+=chg;
                    sectorMap[sector].count++;
                    if(price>0){sectorMap[sector].price+=price;}
                  }
                });
              });
            });
          }
          const result=Object.values(sectorMap).filter(function(s){return s.count>0;}).map(function(s){
            return {name:s.name,changePct:Math.round(s.sumChangePct/s.count*100)/100,change:0,price:s.count>0?Math.round(s.price/s.count*100)/100:0};
          }).sort(function(a,b){return b.changePct-a.changePct;});
          sc("sectors",result);
          wj(res,result);
        }catch(e){wj(res,[]);}
      }
      return;
    }if (p==='/api/daily-review') {
      const result = await dailyReview.generateDailyReview();
      wj(res, result);
      return;
    }
    if (p==='/api/daily-review/history') {
      const { readdirSync:rd, readFileSync:rf, existsSync:es } = require('fs');
      const { join:jn } = require('path');
      const dir = jn(__dirname, 'review_data');
      if (!es(dir)) { wj(res, []); return; }
      const files = rd(dir).filter(f => f.startsWith('review_') && f.endsWith('.json')).sort().reverse().slice(0, 30);
      const reviews = files.map(f => JSON.parse(rf(jn(dir, f), 'utf8')));
      wj(res, reviews);
      return;
    }
    let fp=p==="/"?"/index.html":p;
    fp=path.join(__dirname,fp);
    if(!fp.startsWith(__dirname)){res.writeHead(403);res.end("Forbidden");return;}
    const ext=path.extname(fp);
    const mimeMap={".html":"text/html; charset=utf-8",".css":"text/css",".js":"application/javascript",".json":"application/json",".png":"image/png",".svg":"image/svg+xml"};
    try{
      const c=fs2.readFileSync(fp);
      res.writeHead(200,{"Content-Type":mimeMap[ext]||"application/octet-stream"});
      res.end(c);
    }catch(e){
      res.writeHead(404,{"Content-Type":"text/html; charset=utf-8"});
      res.end("<h1>404</h1>");
    }
  }catch(e){we(res,e.message);}
});

// ÿ���Զ����̣�����ʱ��鲢ִ�У�
function scheduleDailyReview() {
  const now = new Date();
  const h = now.getHours();
  // ����ڽ���������15:00-17:00֮�䣬����ִ��һ��
  if (h >= 15 && h < 17) {
    dailyReview.generateDailyReview().then(r => {
      console.log("[" + new Date().toISOString() + "] �����Զ��������");
    }).catch(e => console.error("��������ʧ��:", e.message));
  }
  // ���ö�ʱ��飨ÿ5���Ӽ��һ�Σ���15:00-17:00֮��ִ�У�
  setInterval(() => {
    const n = new Date();
    const nh = n.getHours(), nm = n.getMinutes();
    if (nh === 15 && nm >= 0 && nm <= 5) {
      dailyReview.generateDailyReview().then(r => {
        console.log("[" + new Date().toISOString() + "] ���̸����Զ�����");
      }).catch(e => console.error("��������ʧ��:", e.message));
    }
    // ������컹û�и�������15:00-17:00��������
    if (nh >= 15 && nh < 17) {
      const today = n.toISOString().split('T')[0];
      const reviewFile = require('path').join(__dirname, 'review_data', 'review_' + today + '.json');
      if (!require('fs').existsSync(reviewFile)) {
        dailyReview.generateDailyReview().then(r => {
          console.log("[" + new Date().toISOString() + "] ��ȫ��������");
        }).catch(e => console.error("��ȫʧ��:", e.message));
      }
    }
  }, 300000); // 5����
}
scheduleDailyReview();

server.listen(PORT, "0.0.0.0", () => {
  console.log("OK: A�����ݷ��� http://localhost:"+PORT);
});
