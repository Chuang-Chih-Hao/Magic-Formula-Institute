"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {once}=require("node:events");
const {io:client}=require("socket.io-client");
const {makeSpecialQuestion}=require("../fair-questions");
const {
  makeQuestion,qualityFor,costFor,buildProduct,rankOffers,decorateScore,
  newPlayer,createRoom,runServer,pickCustomer,settleNpc,beginMarket,completeRound,
  forceStartAfterDeadline,finalizeGame,FIRST_PREP_SECONDS,GAME_SECONDS,RECIPES,DECORATIONS,
  activeMarketBonus,evaluateOffer,triggerMarketEvent,useMarketAction,MARKET_ACTIONS,
  WILD_RECIPE_ID,WILD_ODDS,wildFlavor,rollWildQuality,validThreeMenu
}=require("../fair-server");

function cannedMenu() {
  return [
    {recipeId:"berry",mix:[2,1,1],price:24},
    {recipeId:"moon",mix:[1,2,3],price:28},
    {recipeId:"forest",mix:[1,1,3],price:30}
  ];
}

test("14 varied math families keep answer choices distinct and avoid recent repeats",()=>{
  const skills=new Set(),types=new Set(),history=[],prompts=new Set();
  for(let i=0;i<500;i++){
    const q=makeQuestion(history);
    assert.equal(q.choices.length,4);
    assert.equal(new Set(q.choices).size,4);
    assert.equal(q.choices[q.correctIndex],q.answer);
    assert.ok(q.prompt.length>=18);
    assert.ok(q.explanation.length>=10);
    assert.ok(!prompts.has(q.prompt),"question should not repeat within practice history");
    prompts.add(q.prompt);types.add(q.type);skills.add(q.skill);
    history.push({prompt:q.prompt,type:q.type});
  }
  assert.equal(types.size,14);
  assert.ok(skills.size>=10);
});

test("12 ordinary and 3 legendary recipes are locked initially; evolution improves quality",()=>{
  const p=newPlayer("第一次來的學生");
  assert.equal(RECIPES.length,15);
  assert.equal(RECIPES.filter(x=>x.rare).length,3);
  assert.equal(p.unlocked.length,0);
  assert.deepEqual(p.products,[null,null,null]);
  assert.equal(p.decor.length,0);
  for(const r of RECIPES){
    assert.equal(qualityFor(r.ratio,r.ratio),100);
    assert.equal(qualityFor(r.ratio.map(x=>x*2),r.ratio),100);
  }
  assert.ok(qualityFor([1,8,1],[2,1,1])<60);
  assert.equal(costFor([2,1,1]),14/3);
  const mix={recipeId:"berry",mix:[2,1,1],price:25};
  assert.equal(buildProduct(mix,{}).quality,100);
  assert.equal(buildProduct(mix,{berry:1}).quality,105);
  assert.equal(buildProduct(mix,{berry:2}).quality,110);
  assert.equal(buildProduct(mix,{berry:3}).quality,115);
  assert.equal(buildProduct(mix,{berry:99}).quality,115);
  assert.equal(buildProduct(null,{}),null);
  assert.equal(buildProduct({...mix,price:100}),null);
});

test("one free-mix drink uses server-side odds and a fixed quality for every customer",()=>{
  assert.equal(WILD_RECIPE_ID,"wild");
  assert.deepEqual(WILD_ODDS.map(x=>x.chance),[0.7,0.25,0.05]);
  const draw=(chance,position=0.5)=>{
    const rolls=[chance,position];return rollWildQuality(()=>rolls.shift());
  };
  assert.equal(draw(0,0),20);
  assert.equal(draw(0.699,0.999),59);
  assert.equal(draw(0.7,0),60);
  assert.equal(draw(0.949,0.999),84);
  assert.equal(draw(0.95,0),85);
  assert.equal(draw(0.999,0.999),110);
  assert.equal(wildFlavor([5,1,2]),"甜美");
  assert.equal(wildFlavor([1,6,2]),"夢幻");
  assert.equal(wildFlavor([1,2,7]),"清爽");
  const wild={recipeId:"wild",mix:[2,3,4],price:26};
  const before=buildProduct(wild);
  assert.equal(before.quality,null,"not known until locking");
  assert.equal(before.flavor,"清爽");
  const after=buildProduct({...wild,wildQuality:101});
  assert.equal(after.quality,101);
  assert.equal(after.cost,before.cost,"quality does not change materials cost");
  assert.equal(buildProduct({...wild,price:99}),null);
  assert.equal(buildProduct({...wild,mix:[1,2,28]}),null);
  assert.equal(validThreeMenu([
    {recipeId:"berry",mix:[2,1,1],price:30},
    wild,
    {recipeId:"moon",mix:[1,2,3],price:30}
  ],["berry","moon"]),true,"free mix counts as one of three and needs two math unlocks");
  assert.equal(validThreeMenu([wild,wild,{recipeId:"berry",mix:[2,1,1],price:30}],["berry"]),false,
    "only one free mix can appear in the three-drink menu");
  assert.equal(validThreeMenu([wild,{recipeId:"berry",mix:[2,1,1],price:30},
    {recipeId:"forest",mix:[1,1,3],price:30}],["berry"]),false,
    "free mix does not bypass other locked recipes");
  const p=newPlayer("學生"),npc={flavor:"清爽"};
  p.unlocked=["berry","moon"];
  p.decor=["banner","samples"];
  p.products=[
    {recipeId:"berry",mix:[2,1,1],price:35},
    {...wild,wildQuality:101},
    {recipeId:"moon",mix:[1,2,3],price:35}
  ];
  const first=evaluateOffer(p,npc,70,0);
  const second=evaluateOffer(p,npc,70,0);
  assert.equal(first.score,second.score,"quality is never rolled for each visitor");
  assert.equal(p.products[1].wildQuality,101);
});

test("rare challenges always require multiple steps, never reveal answers, and fit the four choices",()=>{
  const types=new Set();
  const history=[];
  for(let i=0;i<160;i++){
    const q=makeSpecialQuestion(history);
    assert.match(q.prompt,/傳說級難題/);
    assert.equal(q.choices.length,4);
    assert.equal(new Set(q.choices).size,4);
    assert.equal(q.choices[q.correctIndex],q.answer);
    assert.ok(q.explanation.length>=30);
    assert.ok(!history.some(p=>p.prompt===q.prompt));
    history.push(q);
    types.add(q.type);
  }
  assert.equal(types.size,4);
  const rare=RECIPES.find(x=>x.rare);
  const perfect={recipeId:rare.id,mix:[...rare.ratio],price:36};
  assert.equal(buildProduct(perfect,{}).quality,108);
  assert.equal(buildProduct(perfect,{[rare.id]:3}).quality,123);
});

test("advertising attracts extra visitors, tasting raises conversion, and neither adds shop score",()=>{
  const room=createRoom(),player=newPlayer("策略師");
  player.shopName="星星商店";player.unlocked=["berry","moon","forest"];
  player.products=cannedMenu();player.decor=["banner","samples"];player.ready=true;
  room.players=[player];
  const emits=[],io={to:()=>({emit:(event,value)=>emits.push({event,value})})};
  const now=Date.now();beginMarket(io,room,now);
  const npc={flavor:"甜美"};
  const baseline=evaluateOffer(player,npc,65,0,now);
  assert.equal(baseline.eventBonus,0);
  assert.throws(()=>useMarketAction(io,room,player,"advertise",now),/淨利不足/);
  assert.equal(player.cost,0,"failed action must never charge anyone");
  player.revenue=120;player.cost=0;player.profit=120;
  const result=useMarketAction(io,room,player,"advertise",now);
  assert.equal(result.remainingProfit,102);
  assert.equal(player.cost,18);
  assert.equal(evaluateOffer(player,npc,65,0,now+1000).score,baseline.score,
    "advertising must never give shop-score points");
  assert.ok(room.promoSpawnAt<=now+1200,
    "advertising must immediately schedule additional incoming customers");
  const extra=pickCustomer(room,{leadShopId:player.id});
  assert.equal(extra.advertisedFor,player.id);
  assert.ok(extra.path.some(pt=>pt.x!==520),
    "an advertising lead must actually walk toward a shop");
  assert.throws(()=>useMarketAction(io,room,player,"advertise",now+1000),/冷卻/);
  useMarketAction(io,room,player,"tasting",now+23000);
  assert.equal(player.cost,30);
  assert.equal(evaluateOffer(player,npc,65,0,now+25000).score,baseline.score,
    "samples must not duplicate advertising or add shop-score points");
  useMarketAction(io,room,player,"shield",now+46000);
  assert.equal(player.cost,45);
  assert.ok(player.shieldUntil>now+46000);
  const shielded=triggerMarketEvent(io,room,now+47000,"fog");
  assert.equal(shielded.type,"shielded");
  assert.equal(player.fogUntil,0);
  assert.equal(player.shieldUntil,0);
  const fog=triggerMarketEvent(io,room,now+48000,"fog");
  assert.equal(fog.type,"fog");
  assert.equal(evaluateOffer(player,npc,65,0,now+48001).score,baseline.score-23);
  assert.ok(room.activeEvents.length>=2);
  const lucky=triggerMarketEvent(io,room,now+50000,"golden");
  assert.match(lucky.message,/幸運金券/);
  assert.ok(Number(lucky.amount)>=8);
  assert.equal(lucky.startedAt,now+50000,"event exposes animation start timestamp");
  assert.ok(player.profit>0);
  const rush=triggerMarketEvent(io,room,now+53000,"rush");
  assert.equal(rush.type,"rush");
  assert.ok(room.rushUntil>now+53000);
  const parade=triggerMarketEvent(io,room,now+55000,"parade");
  assert.equal(parade.type,"parade");
  assert.ok(["甜美","清爽","夢幻"].includes(parade.flavor));
  assert.ok(emits.some(x=>x.event==="fair:event"));
  room.paused=true;
  assert.throws(()=>useMarketAction(io,room,player,"tasting",now+80000),/目前不是可以營業的時間/);
});

test("tasting boosts real purchase probability by 22 percentage points",()=>{
  const original=Math.random;
  const room=createRoom(),p=newPlayer("試喝店長");
  p.shopName="試喝魔法店";p.unlocked=["berry","moon","forest"];
  p.products=cannedMenu();p.decor=["banner","samples"];room.players=[p];
  const events=[],io={to:()=>({emit:(name,evt)=>events.push({name,evt})})};
  const makeVisitor=()=>({id:"visitor"+Math.random(),name:"考驗顧客",emoji:"🐰",
    flavor:"甜美",budget:50,stage:"wandering",shopId:p.id,
    reasoning:{item:buildProduct(p.products[0]),score:35,
      flavorMatch:true,bonusText:""},advertisedFor:null});
  try{
    Math.random=()=>0.70;
    const first=makeVisitor();
    settleNpc(io,room,first);
    assert.equal(first.bought,false,"base probability 0.58 should refuse roll 0.70");
    assert.ok(Math.abs(first.purchaseChance-0.58)<1e-9);
    p.tastingUntil=Date.now()+60000;
    const second=makeVisitor();
    settleNpc(io,room,second);
    assert.equal(second.bought,true,"samples raise probability to 0.80");
    assert.equal(second.tastingBonus,0.22);
    assert.ok(Math.abs(second.purchaseChance-0.8)<1e-9);
    assert.equal(p.tastingConversions,1);
    assert.equal(p.sales,1);
    assert.ok(room.events[0].why.includes("試喝"));
  }finally{Math.random=original;}
});


test("decorations provide meaningful advantages when stores offer comparable products",()=>{
  assert.equal(DECORATIONS.length,5);
  assert.equal(decorateScore(["banner","flowers"],"甜美").score,41);
  assert.equal(decorateScore(["banner","flowers"],"清爽").score,16);
  assert.equal(decorateScore(["fountain","samples"],"清爽").score,37);
  assert.equal(decorateScore(["fountain","samples"],"夢幻").score,12);
  const a=newPlayer("A"),b=newPlayer("B");
  a.decor=["banner","samples"];b.decor=["banner","flowers"];
  a.products=cannedMenu();b.products=cannedMenu();
  const offered=rankOffers([a,b],{flavor:"甜美"},50);
  assert.equal(offered[0].player.name,"B");
  assert.ok(offered[0].offer.score>offered[1].offer.score);
});

test("one shared NPC compares across all booths and only one shop sells",()=>{
  const room=createRoom(),a=newPlayer("一號店"),b=newPlayer("二號店");
  a.unlocked=["berry","moon","forest"];b.unlocked=[...a.unlocked];
  a.products=cannedMenu();b.products=cannedMenu();
  a.shopName="草莓甜點屋";a.decor=["banner","flowers"];
  b.shopName="魔法森林店";b.decor=["fountain","samples"];
  room.players.push(a,b);
  const npc=pickCustomer(room);
  assert.ok(npc.path.length>=5);
  assert.equal(npc.visitorScores.length,2);
  assert.ok(npc.thoughts.length>=6,"NPC has varied browsing dialogue");
  const original=Math.random;
  Math.random=()=>0;
  try{
    const events=[],io={to:()=>({emit:(name,data)=>events.push({name,data})})};
    settleNpc(io,room,npc);
    assert.equal(npc.bought,true);
    assert.equal(room.players.reduce((sum,p)=>sum+p.sales,0),1);
    assert.ok(room.players.find(p=>p.sales).profit>0);
    assert.equal(room.events[0].kind,"sale");
    assert.ok(room.events[0].why.includes("品質"));
    assert.ok(room.events[0].why.includes("售價"));
    assert.ok(room.events[0].reason);
    assert.ok(events.some(e=>e.name==="fair:trade"));
  }finally{Math.random=original;}
});

test("first preparation is six minutes, followed by ten-minute cycles and a hard thirty-minute deadline",()=>{
  const r=createRoom();
  assert.equal(r.round,1);
  assert.equal(r.prepEndsAt,0,"timer starts only when the first student joins");
  assert.equal(r.remaining,FIRST_PREP_SECONDS);
  assert.equal(FIRST_PREP_SECONDS,360);
  assert.equal(GAME_SECONDS,1800);
  assert.equal(r.duration,4*60);
  assert.equal(r.prepDuration,6*60);
  const p=newPlayer("店長");
  r.players.push(p);
  const io={to:()=>({emit:()=>{}})};
  const start=1_700_000_000_000;
  r.sessionStartedAt=start;
  r.prepEndsAt=start+FIRST_PREP_SECONDS*1000;
  r.gameEndsAt=start+GAME_SECONDS*1000;
  assert.equal(forceStartAfterDeadline(io,r,r.prepEndsAt-1),false,"no early forced opening");
  assert.equal(forceStartAfterDeadline(io,r,r.prepEndsAt),true,"round 1 must have a real deadline");
  assert.equal(r.phase,"market");
  assert.equal(r.round,1);
  assert.equal(p.unlocked.length,3,"unfinished students receive emergency recipes only when time expires");
  assert.equal(p.products.length,3);
  assert.ok(p.products.every(Boolean));
  assert.equal(p.correct,0,"emergency recipes do not count as answered questions");
  assert.equal(p.ready,true);
  assert.equal(r.events[0].kind,"start");

  completeRound(io,r,start+(FIRST_PREP_SECONDS+r.duration)*1000,false);
  assert.equal(r.phase,"setup");
  assert.equal(r.round,2);
  assert.equal(r.remaining,6*60);
  assert.equal(p.ready,false);
  assert.deepEqual(p.products.map(x=>x.recipeId),["berry","moon","forest"]);
  assert.equal(forceStartAfterDeadline(io,r,r.prepEndsAt-1000),false);
  assert.equal(forceStartAfterDeadline(io,r,r.prepEndsAt+1),true);
  assert.equal(r.phase,"market");
  assert.equal(r.round,2);
  assert.equal(p.ready,true);
  assert.equal(r.remaining,4*60);

  assert.equal(finalizeGame(io,r,r.gameEndsAt,"time"),true);
  assert.equal(r.phase,"finished","absolute cutoff ends the session regardless of round");
  assert.equal(r.remaining,0);
  assert.equal(r.events[0].message.includes("30 分鐘"),true);
  assert.equal(finalizeGame(io,r,r.gameEndsAt+1000,"time"),false,"closing is idempotent");
});

test("30-minute hard deadline also closes a paused market or unfinished preparation",()=>{
  const r=createRoom(),io={to:()=>({emit:()=>{}})};
  r.players.push(newPlayer("未解鎖的學生"));
  r.sessionStartedAt=Date.now()-GAME_SECONDS*1000;
  r.gameEndsAt=Date.now()-1000;
  r.prepEndsAt=Date.now()-1000;
  assert.equal(finalizeGame(io,r,r.gameEndsAt,"time"),true);
  assert.equal(r.phase,"finished");
  assert.deepEqual(r.players[0].products,[null,null,null],
    "an unfinished preparation is closed without falsely inventing student results");

  const next=createRoom();
  const student=newPlayer("已鎖定的學生");
  student.unlocked=["berry","moon","forest"];
  student.products=cannedMenu();
  student.decor=["banner","samples"];
  student.ready=true;
  next.players.push(student);
  beginMarket(io,next,Date.now()-120000);
  next.paused=true;
  assert.equal(finalizeGame(io,next,Date.now(),"time"),true,
    "teacher pause cannot bypass global cutoff");
  assert.equal(next.phase,"finished");
  assert.equal(next.paused,false);
});

test("teacher and 4 pupils must unlock 3 different drinks, lock, then start the first market",async t=>{
  const {server,io}=runServer(0);
  await once(server,"listening");
  const url="http://127.0.0.1:"+server.address().port;
  const sockets=Array.from({length:6},()=>client(url,{transports:["websocket"],reconnection:false}));
  t.after(async()=>{sockets.forEach(s=>s.disconnect());await new Promise(done=>io.close(done));});
  await Promise.all(sockets.map(s=>once(s,"connect")));
  const rpc=(socket,name,body={})=>new Promise((resolve,reject)=>{
    socket.timeout(5000).emit(name,body,(err,result)=>err?reject(err):resolve(result));
  });
  const teacher=sockets[0];
  const created=await rpc(teacher,"host:create");
  assert.equal(created.ok,true);
  assert.match(created.code,/^\d{6}$/);
  const states=Array(4).fill(null);
  for(let i=1;i<=4;i++){
    sockets[i].on("player:state",v=>{states[i-1]=v;});
    assert.equal((await rpc(sockets[i],"player:join",{code:created.code,name:"店長"+i})).ok,true);
    assert.deepEqual(states[i-1].unlocked,[]);
    assert.deepEqual(states[i-1].products,[null,null,null]);
  }
  assert.equal((await rpc(sockets[5],"player:join",{code:created.code,name:"多餘玩家"})).ok,false);
  assert.equal((await rpc(teacher,"host:start")).ok,false);
  assert.equal((await rpc(sockets[1],"player:lock")).ok,false);

  // Seed only quiz generation so we can verify the correct mathematical answer
  // from a visible ratio prompt instead of exposing the server answer index.
  const oldRandom=Math.random;
  try{
    Math.random=()=>0.01;
    for(let i=1;i<=4;i++){
      const socket=sockets[i];
      assert.equal((await rpc(socket,"shop:update",{shopName:"魔法飲料"+i,
        theme:["strawberry","mint","lavender","peach"][i-1]})).ok,true);
      assert.equal((await rpc(socket,"decor:set",{decor:["banner","flowers"]})).ok,true);
      for(const id of ["berry","moon","forest"]){
        assert.equal((await rpc(socket,"quest:get",{target:id})).ok,true);
        const q=states[i-1].question;
        assert.equal(q.action,"unlock","student should see if this is an unlock or evolution");
        assert.equal(q.correctIndex,undefined,"answer index must not leak to student");
        const m=q.prompt.match(/(\d+)：(\d+)/);
        assert.ok(m,"visible simplification ratio");
        const gcd=(a,b)=>b?gcd(b,a%b):a;
        const x=Number(m[1]),y=Number(m[2]),g=gcd(x,y);
        const answer=x/g+"："+y/g;
        const choiceIndex=q.choices.indexOf(answer);
        assert.ok(choiceIndex>=0,"visible question has a correct choice");
        const res=await rpc(socket,"quest:answer",{index:choiceIndex});
        assert.equal(res.ok,true);assert.equal(res.correct,true);
      }
      assert.equal(states[i-1].unlocked.length,3);
      if(i===1){
        const found=states[i-1].specialOffer;
        assert.ok(RECIPES.some(r=>r.id===found&&r.rare),
          "solving a normal question can randomly reveal a legendary scroll");
        assert.equal((await rpc(socket,"quest:get",{target:found})).ok,false,
          "locked legendary recipe must not be unlocked via an ordinary quest");
        assert.equal((await rpc(socket,"quest:get",{target:"__special__"})).ok,true);
        const special=states[i-1].question;
        assert.equal(special.action,"special");
        assert.equal(special.correctIndex,undefined,
          "special question must never reveal the correct index");
        assert.equal((await rpc(socket,"quest:get",{target:"__special__"})).ok,false,
          "one legendary scroll may not be rerolled");
        const matched=special.prompt.match(/得到(\d+)克.+依 (\d+)：(\d+)：(\d+).+分成 (\d+) 包/);
        assert.ok(matched,"forced type-zero legendary challenge is a two-step ratio division");
        const [,total,a,b,c,groups]=matched.map(Number);
        const answer=String(total*a/((a+b+c)*groups));
        const chosen=special.choices.indexOf(answer);
        assert.ok(chosen>=0,"the special challenge has a correct visible choice");
        const won=await rpc(socket,"quest:answer",{index:chosen});
        assert.equal(won.ok,true);
        assert.equal(won.correct,true);
        assert.ok(states[i-1].unlocked.includes(found));
        assert.equal(states[i-1].specialOffer,null);
      }
      assert.equal((await rpc(socket,"product:set",{slot:0,recipeId:"berry",mix:[2,1,1],price:24})).ok,true);
      assert.equal((await rpc(socket,"product:set",{slot:1,recipeId:"moon",mix:[1,2,3],price:30})).ok,true);
      assert.equal((await rpc(socket,"product:set",{slot:2,recipeId:"forest",mix:[1,1,3],price:28})).ok,true);
      assert.equal((await rpc(socket,"menu:save",{products:[
        {recipeId:"moon",mix:[1,2,3],price:30},
        {recipeId:"berry",mix:[2,1,1],price:24},
        {recipeId:"forest",mix:[1,1,3],price:28}
      ]})).ok,true,"swapping first and second drinks must save atomically");
      assert.equal((await rpc(socket,"menu:save",{products:[
        {recipeId:"moon",mix:[1,2,3],price:30},
        {recipeId:"moon",mix:[1,2,3],price:30},
        {recipeId:"forest",mix:[1,1,3],price:28}
      ]})).ok,false,"duplicate menu must be rejected");
      if(i===1){
        const wild={recipeId:"wild",mix:[2,5,3],price:31};
        assert.equal((await rpc(socket,"menu:save",{products:[
          {recipeId:"moon",mix:[1,2,3],price:30},
          {recipeId:"berry",mix:[2,1,1],price:24},wild
        ]})).ok,true);
        assert.equal(states[i-1].products[2].quality,null,
          "quality must remain unknown before lock");
        assert.equal((await rpc(socket,"product:set",{slot:2,...wild,wildQuality:110})).ok,true,
          "a malicious quality payload must never be trusted");
        assert.equal(states[i-1].products[2].quality,null);
      }
      assert.equal((await rpc(socket,"player:lock")).ok,true);
      if(i===1){
        assert.equal(states[i-1].products[2].quality,20,
          "one forced low roll is applied at the moment of locking");
        assert.equal((await rpc(socket,"menu:save",{products:[
          {recipeId:"moon",mix:[1,2,3],price:30},
          {recipeId:"berry",mix:[2,1,1],price:24},
          {recipeId:"wild",mix:[2,5,3],price:31,wildQuality:110}
        ]})).ok,false,"no re-rolling after the booth is locked");
      }
      assert.equal((await rpc(socket,"product:set",{slot:0,recipeId:"berry",mix:[2,1,1],price:15})).ok,false);
    }
  }finally{Math.random=oldRandom;}
  assert.equal((await rpc(teacher,"host:duration",{minutes:4})).ok,true);
  assert.equal((await rpc(teacher,"host:start")).ok,true);
  assert.equal((await rpc(sockets[1],"decor:set",{decor:["stage","samples"]})).ok,false);
  assert.equal((await rpc(teacher,"host:pause")).ok,true);
  assert.equal((await rpc(teacher,"host:resume")).ok,true);
  assert.equal((await rpc(teacher,"host:finish")).ok,true);
  const resetState=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error("reset state not received")),3000);
    const onState=v=>{
      if(v.unlocked.length!==0||v.ready)return;
      clearTimeout(timer);sockets[1].off("player:state",onState);resolve(v);
    };
    sockets[1].on("player:state",onState);
  });
  assert.equal((await rpc(teacher,"host:reset")).ok,true);
  const reset=await resetState;
  assert.equal(reset.unlocked.length,0,"new game resets unlocks");
  assert.deepEqual(reset.products,[null,null,null]);
});
