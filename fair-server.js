"use strict";

/**
 * Magic Fair 2.0: preparation -> lock -> shared, animated 2D bazaar.
 * All scoring, menus, locks and NPC purchases are authoritative on the server.
 */
const express=require("express");
const http=require("node:http");
const path=require("node:path");
const crypto=require("node:crypto");
const {Server}=require("socket.io");
const {makeQuestion}=require("./fair-questions");
const {npcAiMode,maybeAiDialogue}=require("./server");

const PORT=Number(process.env.PORT||3000);
const MAX_PLAYERS=4;
const MAP={
  entry:{x:520,y:666}, hub:{x:520,y:343},
  booths:[
    {x:230,y:283}, {x:808,y:283},
    {x:230,y:565}, {x:808,y:565}
  ]
};
const THEMES=["strawberry","lavender","mint","peach"];
const DECORATIONS=[
  {id:"banner",name:"巨型風車招牌",emoji:"🎡",skill:"吸睛招牌",desc:"所有顧客比較時 +16 分",bonus:16,flavor:null},
  {id:"flowers",name:"蜜糖花圃",emoji:"🌷",skill:"甜蜜吸引",desc:"甜美系顧客評分 +25 分",bonus:25,flavor:"甜美"},
  {id:"fountain",name:"薄荷水泉",emoji:"⛲",skill:"清爽吸引",desc:"清爽系顧客評分 +25 分",bonus:25,flavor:"清爽"},
  {id:"stage",name:"星光小舞台",emoji:"⭐",skill:"夢幻吸引",desc:"夢幻系顧客評分 +25 分",bonus:25,flavor:"夢幻"},
  {id:"samples",name:"試飲小桌",emoji:"🥤",skill:"品質加成",desc:"所有顧客比較時 +12 分",bonus:12,flavor:null}
];
const RECIPES=[
  {id:"berry",name:"莓果初戀",emoji:"🍓",ratio:[2,1,1],flavor:"甜美",color:"#fa8198"},
  {id:"moon",name:"月光蘇打",emoji:"🌙",ratio:[1,2,3],flavor:"清爽",color:"#88c9f5"},
  {id:"forest",name:"森林薄荷",emoji:"🌿",ratio:[1,1,3],flavor:"清爽",color:"#78cead"},
  {id:"peach",name:"蜜桃星星",emoji:"🍑",ratio:[3,2,1],flavor:"甜美",color:"#ffbc88"},
  {id:"violet",name:"紫晶夢境",emoji:"🫐",ratio:[2,3,1],flavor:"夢幻",color:"#b49be4"},
  {id:"rainbow",name:"彩虹晨露",emoji:"🌈",ratio:[3,1,2],flavor:"夢幻",color:"#f3c86b"}
];
const NPCS=[
 {name:"小兔米米",emoji:"🐰",kind:"rabbit",color:"#fff0e9",flavor:"甜美"},
 {name:"奶油貓",emoji:"🐱",kind:"cat",color:"#dfc9a7",flavor:"清爽"},
 {name:"布丁熊",emoji:"🐻",kind:"bear",color:"#c79777",flavor:"甜美"},
 {name:"星光狐狸",emoji:"🦊",kind:"fox",color:"#e9a46a",flavor:"夢幻"},
 {name:"花花小鹿",emoji:"🦌",kind:"deer",color:"#e6bc9e",flavor:"夢幻"},
 {name:"薄荷貓",emoji:"🐱",kind:"cat",color:"#b1d5bd",flavor:"清爽"},
 {name:"糖糖小兔",emoji:"🐰",kind:"rabbit",color:"#ffe4d8",flavor:"甜美"},
 {name:"月見熊",emoji:"🐻",kind:"bear",color:"#ad9cbb",flavor:"夢幻"},
 {name:"泡泡狐狸",emoji:"🦊",kind:"fox",color:"#edbf89",flavor:"清爽"}
];
const rooms=new Map();
const uid=()=>crypto.randomBytes(10).toString("hex");
const rand=(a,b)=>Math.floor(Math.random()*(b-a+1))+a;
const choose=a=>a[rand(0,a.length-1)];
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
const clean=(str,max=32)=>String(str??"").replace(/[\u0000-\u001f<>]/g,"").trim().slice(0,max);
const validMix=m=>Array.isArray(m)&&m.length===3&&m.every(n=>Number.isInteger(n)&&n>=1&&n<=12)&&m.reduce((a,b)=>a+b,0)<=27;
const recipeById=id=>RECIPES.find(r=>r.id===id);
const decorById=id=>DECORATIONS.find(d=>d.id===id);
const costFor=mix=>(6+mix.reduce((a,b)=>a+b,0)*2)/3;
const qualityFor=(mix,ratio)=>{
  const total=mix.reduce((a,b)=>a+b,0),expected=ratio.reduce((a,b)=>a+b,0);
  const error=mix.reduce((sum,n,i)=>sum+Math.abs(n/total-ratio[i]/expected),0);
  return clamp(Math.round(100-142*error),8,100);
};
const cents=n=>Math.round(n*100)/100;
const defaultProducts=()=>RECIPES.slice(0,3).map((r,i)=>({
  recipeId:r.id,mix:r.ratio.slice(),price:[25,31,28][i]
}));
function decorateScore(decor,customerFlavor) {
  const breakdown=[];
  let score=0;
  for(const id of decor){
    const d=decorById(id);
    if(d && (!d.flavor || d.flavor===customerFlavor)){
      score+=d.bonus;breakdown.push(d.name+" +"+d.bonus);
    }
  }
  return {score,breakdown};
}
function buildProduct(menu){
  const recipe=recipeById(menu.recipeId);
  if(!recipe||!validMix(menu.mix)||!Number.isInteger(menu.price)||menu.price<12||menu.price>80) return null;
  return {
    recipeId:recipe.id,name:recipe.name,emoji:recipe.emoji,
    flavor:recipe.flavor,color:recipe.color,ratio:recipe.ratio,
    mix:menu.mix.slice(),price:menu.price,quality:qualityFor(menu.mix,recipe.ratio),
    cost:cents(costFor(menu.mix))
  };
}
function evaluateOffer(player,npc,flavorBudget,randomJitter=0){
  let best=null;
  for(const item of player.products.map(buildProduct)){
    if(!item||item.price>flavorBudget)continue;
    const quality=Math.round(item.quality*0.58);
    const affordable=Math.round(clamp((flavorBudget-item.price)/flavorBudget,0,1)*29);
    const taste=item.flavor===npc.flavor?22:0;
    const deco=decorateScore(player.decor,npc.flavor);
    const score=quality+affordable+taste+deco.score+randomJitter;
    if(!best||score>best.score){
      best={item,score,quality,affordable,taste,decor:deco.score,
        bonusText:deco.breakdown.join("、"),flavorMatch:!!taste};
    }
  }
  return best;
}
function rankOffers(players,npc,budget){
  const results=players.map((p,i)=>({player:p,booth:i,offer:evaluateOffer(p,npc,budget,rand(-7,7))}))
    .filter(x=>x.offer).sort((a,b)=>b.offer.score-a.offer.score);
  return results;
}
function createRoom(){
  let code;
  do {code=String(rand(100000,999999));}while(rooms.has(code));
  const room={code,hostSecret:uid()+uid(),hostId:null,phase:"setup",duration:20*60,remaining:20*60,
    endsAt:0,paused:false,players:[],npcs:[],events:[],spawnAt:0,lastAIAt:0,entrySeq:0,
    createdAt:Date.now()};
  rooms.set(code,room);return room;
}
function newPlayer(name){
  return {id:uid(),token:uid()+uid(),socketId:null,name:clean(name,12)||"魔法店長",
    shopName:"我的魔法飲料屋",theme:choose(THEMES),decor:["banner","samples"],products:defaultProducts(),
    unlocked:["berry","moon","forest"],ready:false,research:0,attempts:0,correct:0,
    question:null,questionHistory:[],result:null,
    sales:0,revenue:0,cost:0,profit:0,stars:0,visits:[]};
}
function productPublic(menu){return buildProduct(menu);}
function playerPublic(p,i) {
  return {id:p.id,booth:i,online:!!p.socketId,name:p.name,shopName:p.shopName,theme:p.theme,
    decor:p.decor,products:p.products.map(productPublic),ready:p.ready,
    revenue:cents(p.revenue),cost:cents(p.cost),profit:cents(p.profit),
    sales:p.sales,stars:p.stars,correct:p.correct};
}
function roomPublic(r){
  return {code:r.code,phase:r.phase,paused:r.paused,duration:r.duration,
    remaining:r.remaining,serverNow:Date.now(),hostOnline:!!r.hostId,
    players:r.players.map(playerPublic),
    npcAiMode:npcAiMode(),npcs:r.npcs.map(n=>({...n})),
    events:r.events.slice(0,18),recipes:RECIPES,decorations:DECORATIONS};
}
function selfPublic(p){
  return {id:p.id,name:p.name,ready:p.ready,unlocked:p.unlocked,theme:p.theme,
    shopName:p.shopName,products:p.products.map(productPublic),decor:p.decor,
    research:p.research,correct:p.correct,attempts:p.attempts,
    question:p.question ? {id:p.question.id,prompt:p.question.prompt,choices:p.question.choices,skill:p.question.skill,target:p.question.target}:null,
    result:p.result};
}
function addEvent(r,event){
  r.events.unshift({id:uid(),at:Date.now(),...event});
  r.events=r.events.slice(0,28);
}
function sendState(io,r){
  io.to(r.code).emit("room:state",roomPublic(r));
  r.players.forEach(p=>{if(p.socketId)io.to(p.socketId).emit("player:state",selfPublic(p));});
}
function pickCustomer(r){
  const spec=choose(NPCS),budget=rand(28,78);
  const profile={...spec,budget};
  const offers=rankOffers(r.players,profile,budget);
  // Every customer browses at least one other booth before deciding.
  const shops=r.players.map((_p,i)=>i);
  const winner=offers[0]||null;
  const alternatives=shops.filter(x=>!winner||x!==winner.booth).sort(()=>Math.random()-.5);
  const browse=alternatives.slice(0,Math.min(2,alternatives.length));
  const lastShop=winner?winner.booth:choose(shops);
  const path=[{...MAP.entry,t:0},{...MAP.hub,t:2500}];
  let ms=2500;
  const walkTo=(booth,hold)=>{
    ms+=2350;path.push({...MAP.booths[booth],t:ms});
    ms+=hold;path.push({...MAP.booths[booth],t:ms});
    ms+=1500;path.push({...MAP.hub,t:ms});
  };
  for(const b of browse)walkTo(b,1100);
  ms+=2350;path.push({...MAP.booths[lastShop],t:ms});
  const decideAfter=ms+1200;
  const enterAt=Date.now();
  return {
    id:uid(),name:profile.name,emoji:profile.emoji,kind:profile.kind,
    color:profile.color,flavor:profile.flavor,budget,
    enterAt,decideAt:enterAt+decideAfter,leaveAt:enterAt+decideAfter+4700,
    path,shopId:winner?.player.id||null,shopIndex:lastShop,
    chosenProduct:winner?.offer?.item?.recipeId||null,
    stage:"wandering",speech:"想找一杯"+profile.flavor+"的飲料！",
    bought:false,visitorScores:offers.map(o=>({
      shopName:o.player.shopName,shopId:o.player.id,score:o.offer.score,
      product:o.offer.item.name,price:o.offer.item.price,quality:o.offer.item.quality
    })),
    reasoning:winner?winner.offer:null
  };
}
function settleNpc(io,r,n) {
  if(n.stage!=="wandering")return;
  const p=r.players.find(x=>x.id===n.shopId);
  const offer=n.reasoning;
  const likely=offer?clamp(0.44+offer.score*0.004,0.46,0.97):0;
  const bought=!!p&&!!offer&&Math.random()<likely;
  n.bought=bought;
  n.stage=bought?"bought":"left";
  if(bought){
    const item=offer.item;
    p.sales++;
    p.revenue=cents(p.revenue+item.price);
    p.cost=cents(p.cost+item.cost);
    p.profit=cents(p.revenue-p.cost);
    if(item.quality>=88)p.stars++;
    n.speech="買了"+item.name+"！好期待！";
  } else n.speech=offer?"差一點點心動，這回先不買。":"今天沒有適合預算的飲料。";
  const explanation=bought
    ? "品質"+offer.item.quality+"、售價"+offer.item.price+
      "；"+(offer.flavorMatch?"口味符合偏好；":"偏好口味不同；")+
      (offer.bonusText||"沒有裝飾加成")
    : offer ? "綜合評分"+offer.score+"，但這次沒有成交" : "各店商品超出預算或無販售選項";
  const message=bought ? n.name+" 在「"+p.shopName+"」買了 "+offer.item.name+"（"+offer.item.price+"金幣）"
    : n.name+" 逛完小鎮後沒有購買";
  const event={npcId:n.id,kind:bought?"sale":"leave",emoji:n.emoji,
    shopId:p?.id||null,shopName:p?.shopName||null,
    product:bought?offer.item.name:null,price:bought?offer.item.price:0,
    message,why:explanation,budget:n.budget,flavor:n.flavor};
  addEvent(r,event);
  io.to(r.code).emit("fair:trade",event);
  if(p){
    p.visits.unshift(event);
    p.visits=p.visits.slice(0,16);
  }
  // AI dialogue is broadcast to the whole classroom; purchases remain deterministic and final.
  if(npcAiMode()==="gemini"){
    const fakePlayer={socketId:r.code};
    maybeAiDialogue(io,r,fakePlayer,{
      id:n.id,customer:n.name,emoji:n.emoji,favorite:n.flavor,budget:n.budget,
      bought,itemName:bought?offer.item.name:null,paid:bought?offer.item.price:0,text:n.speech
    });
  }
}
function runServer(port=PORT){
  const app=express();
  app.disable("x-powered-by");
  app.use(express.static(path.join(__dirname,"public"),{maxAge:"5m"}));
  app.get("/health",(_req,res)=>res.json({ok:true,game:"magic-fair-v2",activeRooms:rooms.size,npcAiMode:npcAiMode()}));
  const server=http.createServer(app);
  const io=new Server(server,{transports:["websocket","polling"],maxHttpBufferSize:100000});

  io.on("connection",socket=>{
    const handle=(name,fn)=>socket.on(name,(data,ack)=>{
      const reply=(body)=>{if(typeof ack==="function")ack(body);};
      try{reply({ok:true,...(fn(data||{})||{})});}
      catch(error){reply({ok:false,error:error.message||"操作失敗"});}
    });
    const getRoom=()=>{
      const r=rooms.get(socket.data.room);
      if(!r)throw Error("房間不存在，請重新加入");
      return r;
    };
    const player=()=>{
      const r=getRoom();
      const p=r.players.find(x=>x.id===socket.data.playerId&&x.socketId===socket.id);
      if(!p)throw Error("學生身分失效");
      return {r,p};
    };
    const host=()=>{
      const r=getRoom();
      if(socket.data.role!=="host"||r.hostId!==socket.id)throw Error("此功能僅限老師");
      return r;
    };
    const setup=()=>{
      const {r,p}=player();
      if(r.phase!=="setup")throw Error("園遊會已開始，不能更改攤位");
      if(p.ready)throw Error("你已鎖定攤位，不能再次編輯");
      return {r,p};
    };
    const enter=(r,role,p)=>{
      if(socket.data.room)socket.leave(socket.data.room);
      socket.join(r.code);
      socket.data.room=r.code;socket.data.role=role;socket.data.playerId=p?.id||null;
      sendState(io,r);
    };
    handle("host:create",()=>{
      const r=createRoom();r.hostId=socket.id;enter(r,"host");
      return {code:r.code,secret:r.hostSecret};
    });
    handle("host:rejoin",({code,secret})=>{
      const r=rooms.get(clean(code,6));
      if(!r||r.hostSecret!==secret)throw Error("教師憑證不正確");
      if(r.hostId&&r.hostId!==socket.id)io.to(r.hostId).emit("host:replaced");
      r.hostId=socket.id;enter(r,"host");return {code:r.code,secret};
    });
    handle("player:join",({code,name,token})=>{
      const r=rooms.get(clean(code,6));if(!r)throw Error("找不到此房間");
      let p=r.players.find(x=>token&&x.token===token);
      if(!p){
        if(r.phase!=="setup")throw Error("已開市，不能新增玩家");
        if(r.players.length>=MAX_PLAYERS)throw Error("教室最多四位學生");
        if(!clean(name,12))throw Error("請先輸入暱稱");
        p=newPlayer(name);r.players.push(p);
      }
      if(p.socketId&&p.socketId!==socket.id)io.to(p.socketId).emit("player:replaced");
      p.socketId=socket.id;enter(r,"student",p);
      return {code:r.code,playerId:p.id,token:p.token};
    });
    handle("shop:update",({shopName,theme})=>{
      const {r,p}=setup();
      if(!clean(shopName,18)||!THEMES.includes(theme))throw Error("請選擇店名和建築風格");
      p.shopName=clean(shopName,18);p.theme=theme;
      sendState(io,r);
    });
    handle("decor:set",({decor})=>{
      const {r,p}=setup();
      if(!Array.isArray(decor)||decor.length!==2||new Set(decor).size!==2||decor.some(x=>!decorById(x)))
        throw Error("請選兩項不同的裝飾");
      p.decor=[...decor];
      sendState(io,r);
    });
    handle("product:set",({slot,recipeId,mix,price})=>{
      const {r,p}=setup();
      if(!Number.isInteger(slot)||slot<0||slot>2)throw Error("選擇第一至第三款商品");
      if(!p.unlocked.includes(recipeId)||!recipeById(recipeId))throw Error("此配方尚未解鎖");
      if(p.products.some((x,i)=>i!==slot&&x.recipeId===recipeId))throw Error("三款商品必須不同");
      if(!validMix(mix))throw Error("三項材料需各為1～12匙，總量不得超過27匙");
      if(!Number.isInteger(price)||price<12||price>80)throw Error("售價須為12～80金幣的整數");
      p.products[slot]={recipeId,mix:[...mix],price};
      p.result=null;
      sendState(io,r);
      return {quality:qualityFor(mix,recipeById(recipeId).ratio),cost:cents(costFor(mix))};
    });
    handle("quest:get",({target})=>{
      const {r,p}=setup();
      if(target!=="practice"&&(!recipeById(target)||p.unlocked.includes(target)))
        throw Error("這張配方無需解鎖");
      const q=makeQuestion(p.questionHistory);
      p.question={...q,target};
      p.result=null;
      sendState(io,r);
    });
    handle("quest:answer",({index})=>{
      const {r,p}=setup(),q=p.question;
      if(!q)throw Error("請先選擇題目");
      if(!Number.isInteger(index)||index<0||index>=q.choices.length)throw Error("答案選項無效");
      const correct=index===q.correctIndex;
      p.attempts++;
      if(correct){
        p.correct++;p.research+=2;
        if(q.target!=="practice"&&!p.unlocked.includes(q.target))p.unlocked.push(q.target);
      }
      p.questionHistory.push({prompt:q.prompt,type:q.type});
      p.questionHistory=p.questionHistory.slice(-80);
      p.result={correct,answer:q.answer,explanation:q.explanation,
        reward:correct?2:0,unlocked:correct&&q.target!=="practice"?q.target:null};
      p.question=null;
      sendState(io,r);
      return {correct};
    });
    handle("player:lock",()=>{
      const {r,p}=setup();
      if(!p.shopName||!THEMES.includes(p.theme))throw Error("攤位尚未完成");
      if(!Array.isArray(p.decor)||p.decor.length!==2||new Set(p.decor).size!==2)throw Error("請先選好兩件裝飾");
      if(p.products.length!==3||new Set(p.products.map(x=>x.recipeId)).size!==3
        ||p.products.some(x=>!buildProduct(x)))throw Error("必須準備三款不同的有效飲品");
      p.ready=true;
      addEvent(r,{kind:"ready",message:p.shopName+" 已鎖定攤位，等待園遊會開市！"});
      sendState(io,r);
    });
    handle("host:duration",({minutes})=>{
      const r=host();
      if(r.phase!=="setup"||![10,15,20,25,30].includes(minutes))throw Error("準備期可選10至30分鐘");
      r.duration=minutes*60;r.remaining=r.duration;sendState(io,r);
    });
    handle("host:start",()=>{
      const r=host();
      if(r.phase!=="setup"||r.players.length===0)throw Error("請先讓學生進入教室");
      if(!r.players.every(p=>p.ready))throw Error("仍有學生尚未鎖定攤位");
      r.phase="market";r.endsAt=Date.now()+r.remaining*1000;r.paused=false;
      r.spawnAt=Date.now()+2600;r.lastAIAt=0;
      addEvent(r,{kind:"start",message:"🎉 魔法園遊會正式開市！動物顧客正準備入場。"});
      sendState(io,r);
    });
    handle("host:pause",()=>{
      const r=host();
      if(r.phase!=="market"||r.paused)throw Error("目前無法暫停");
      r.remaining=clamp(Math.ceil((r.endsAt-Date.now())/1000),0,r.duration);r.paused=true;
      // NPCs need relative timestamps shifted on resume.
      r.pausedAt=Date.now();sendState(io,r);
    });
    handle("host:resume",()=>{
      const r=host();
      if(r.phase!=="market"||!r.paused)throw Error("目前無法繼續");
      const delay=Date.now()-r.pausedAt;
      r.npcs.forEach(n=>{n.enterAt+=delay;n.decideAt+=delay;n.leaveAt+=delay;});
      r.spawnAt+=delay;
      r.endsAt=Date.now()+r.remaining*1000;r.paused=false;
      sendState(io,r);
    });
    handle("host:finish",()=>{
      const r=host();if(r.phase!=="market")throw Error("尚未開市");
      r.phase="finished";r.paused=false;r.remaining=0;r.npcs=[];
      addEvent(r,{kind:"finish",message:"🏆 園遊會結束，開始公布店鋪成績！"});
      sendState(io,r);
    });
    handle("host:reset",()=>{
      const r=host();
      r.phase="setup";r.paused=false;r.remaining=r.duration;r.npcs=[];r.events=[];
      for(const p of r.players){
        Object.assign(p,{ready:false,sales:0,revenue:0,cost:0,profit:0,stars:0,
          products:defaultProducts(),decor:["banner","samples"],unlocked:["berry","moon","forest"],
          research:0,correct:0,attempts:0,question:null,questionHistory:[],result:null,visits:[]});
      }
      sendState(io,r);
    });
    socket.on("disconnect",()=>{
      const r=rooms.get(socket.data.room);
      if(!r)return;
      if(r.hostId===socket.id)r.hostId=null;
      const p=r.players.find(x=>x.socketId===socket.id);
      if(p)p.socketId=null;
      sendState(io,r);
    });
  });

  const interval=setInterval(()=>{
    const now=Date.now();
    for(const [id,r] of rooms){
      if(now-r.createdAt>6*3600000){rooms.delete(id);continue;}
      if(r.phase==="market"&&!r.paused){
        r.remaining=Math.max(0,Math.ceil((r.endsAt-now)/1000));
        if(r.remaining===0){
          r.phase="finished";r.npcs=[];
          addEvent(r,{kind:"finish",message:"🏆 時間到！魔法園遊會閉幕。"});
          sendState(io,r);
        }else{
          let changed=false;
          if(now>=r.spawnAt&&r.players.length>0){
            r.npcs.push(pickCustomer(r));r.npcs=r.npcs.slice(-10);
            r.spawnAt=now+rand(3200,4700);changed=true;
          }
          for(const n of r.npcs){
            if(now>=n.decideAt&&n.stage==="wandering"){settleNpc(io,r,n);changed=true;}
          }
          const before=r.npcs.length;
          r.npcs=r.npcs.filter(n=>now<n.leaveAt);
          if(r.npcs.length!==before)changed=true;
          if(changed)sendState(io,r);
        }
      }
      io.to(id).emit("room:clock",{remaining:r.remaining,phase:r.phase,paused:r.paused,serverNow:now});
    }
  },1000);
  interval.unref();
  server.listen(port,"0.0.0.0",()=>console.log("Magic Fair 2.0 listening on "+server.address().port));
  return {server,io,app,close:()=>{clearInterval(interval);io.close();server.close();}};
}
if(require.main===module)runServer();
module.exports={runServer,createRoom,newPlayer,makeQuestion,qualityFor,costFor,buildProduct,evaluateOffer,
  rankOffers,decorateScore,pickCustomer,settleNpc,RECIPES,DECORATIONS,MAP};
