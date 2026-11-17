"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {once}=require("node:events");
const {io:client}=require("socket.io-client");
const {makeQuestion,qualityFor,costFor,buildProduct,rankOffers,decorateScore,
  newPlayer,createRoom,runServer,pickCustomer,settleNpc,RECIPES,DECORATIONS}=require("../fair-server");

test("14 different math-question families with non-repeating prompts and unique answer choices",()=>{
  const skills=new Set(),types=new Set(),history=[],prompts=new Set();
  for(let i=0;i<400;i++){
    const q=makeQuestion(history);
    assert.equal(q.choices.length,4);
    assert.equal(new Set(q.choices).size,4);
    assert.equal(q.choices[q.correctIndex],q.answer);
    assert.ok(q.prompt.length>=18);
    assert.ok(q.explanation.length>=10);
    assert.ok(!prompts.has(q.prompt),"question should avoid repetition during practice");
    prompts.add(q.prompt);types.add(q.type);skills.add(q.skill);
    history.push({prompt:q.prompt,type:q.type});
  }
  assert.equal(types.size,14);
  assert.ok(skills.size>=10);
});

test("three-ingredient recipe exact proportional mixtures keep 100 quality",()=>{
  assert.equal(RECIPES.length,6);
  assert.equal(DECORATIONS.length,5);
  for(const r of RECIPES){
    assert.equal(qualityFor(r.ratio,r.ratio),100);
    const doubled=r.ratio.map(x=>x*2);
    assert.equal(qualityFor(doubled,r.ratio),100);
  }
  assert.ok(qualityFor([1,8,1],[2,1,1])<60);
  assert.equal(costFor([2,1,1]),14/3);
  assert.equal(buildProduct({recipeId:"berry",mix:[2,1,1],price:25}).quality,100);
  assert.equal(buildProduct({recipeId:"berry",mix:[2,1,1],price:100}),null);
  assert.equal(buildProduct({recipeId:"berry",mix:[0,1,1],price:20}),null);
});

test("decorations grant explicit tangible shopping advantages",()=>{
  assert.equal(decorateScore(["banner","flowers"],"甜美").score,41);
  assert.equal(decorateScore(["banner","flowers"],"清爽").score,16);
  assert.equal(decorateScore(["fountain","samples"],"清爽").score,37);
  assert.equal(decorateScore(["fountain","samples"],"夢幻").score,12);
  const base=newPlayer("A");base.decor=["banner","samples"];
  const special=newPlayer("B");special.decor=["banner","flowers"];
  const npc={flavor:"甜美"};
  const best=rankOffers([base,special],npc,45);
  assert.equal(best[0].player.name,"B");
  assert.ok(best[0].offer.score>best[1].offer.score);
});

test("shared NPC checks all available shops and pays the winner, not four separate visitors",()=>{
  const r=createRoom();
  const a=newPlayer("一號店"),b=newPlayer("二號店");
  a.shopName="草莓甜點屋";a.decor=["banner","flowers"];
  b.shopName="魔法森林店";b.decor=["fountain","samples"];
  a.products[0]={recipeId:"berry",mix:[2,1,1],price:20};
  b.products[0]={recipeId:"moon",mix:[1,2,3],price:35};
  r.players.push(a,b);
  const n=pickCustomer(r);
  assert.ok(n.path.length>=5,"NPC should travel between multiple stalls");
  assert.ok(n.decideAt>n.enterAt);
  assert.ok(n.leaveAt>n.decideAt);
  assert.equal(n.visitorScores.length,2);
  // Guarantee deterministic sale in this test.
  const oldRandom=Math.random;
  Math.random=()=>0;
  try{
    const emit=[];
    const io={to:()=>({emit:(event,value)=>emit.push({event,value})})};
    settleNpc(io,r,n);
    assert.equal(n.bought,true);
    assert.equal(r.players.reduce((sum,p)=>sum+p.sales,0),1);
    const winner=r.players.find(p=>p.sales);
    assert.ok(winner.profit>0);
    assert.ok(winner.cost>0);
    assert.equal(r.events[0].kind,"sale");
    assert.ok(r.events[0].why.includes("品質"));
    assert.ok(r.events[0].why.includes("售價"));
    assert.equal(emit.some(e=>e.event==="fair:trade"),true);
  }finally{Math.random=oldRandom;}
});

test("teacher + four students: design, distinct 3 products, lock, start, immutable sales, pause/reset",async t=>{
  const {server,io}=runServer(0);
  await once(server,"listening");
  const url="http://127.0.0.1:"+server.address().port;
  const sockets=Array.from({length:6},()=>client(url,{transports:["websocket"],reconnection:false}));
  t.after(async()=>{sockets.forEach(s=>s.disconnect());await new Promise(done=>io.close(done));});
  await Promise.all(sockets.map(s=>once(s,"connect")));
  const rpc=(s,event,data={})=>new Promise((resolve,reject)=>{
    s.timeout(5000).emit(event,data,(err,result)=>err?reject(err):resolve(result));
  });
  const teacher=sockets[0];
  const created=await rpc(teacher,"host:create");
  assert.equal(created.ok,true);assert.match(created.code,/^\d{6}$/);
  const states=Array.from({length:4},()=>null);
  for(let i=1;i<=4;i++){
    sockets[i].on("player:state",v=>{states[i-1]=v;});
    const joined=await rpc(sockets[i],"player:join",{code:created.code,name:"店長"+i});
    assert.equal(joined.ok,true);
  }
  assert.equal((await rpc(sockets[5],"player:join",{code:created.code,name:"額外的人"})).ok,false);
  assert.equal((await rpc(teacher,"host:start")).ok,false,"all students must prepare first");
  for(let i=1;i<=4;i++){
    const pupil=sockets[i];
    assert.equal((await rpc(pupil,"shop:update",{shopName:"魔法飲料"+i,theme:["strawberry","mint","lavender","peach"][i-1]})).ok,true);
    assert.equal((await rpc(pupil,"decor:set",{decor:["banner","flowers"]})).ok,true);
    assert.equal((await rpc(pupil,"product:set",{slot:0,recipeId:"berry",mix:[2,1,1],price:21+i})).ok,true);
    assert.equal((await rpc(pupil,"product:set",{slot:1,recipeId:"moon",mix:[1,2,3],price:33})).ok,true);
    assert.equal((await rpc(pupil,"product:set",{slot:2,recipeId:"forest",mix:[1,1,3],price:28})).ok,true);
    assert.equal((await rpc(pupil,"product:set",{slot:1,recipeId:"berry",mix:[2,1,1],price:40})).ok,false);
    const q=await rpc(pupil,"quest:get",{target:"peach"});assert.equal(q.ok,true);
    const liveQ=states[i-1]?.question;assert.ok(liveQ);
    const idx=makeQuestion?null:null;
    // Answering is permitted during preparation; the server prevents direct answer reuse.
    assert.equal((await rpc(pupil,"player:lock")).ok,true);
    assert.equal((await rpc(pupil,"shop:update",{shopName:"想偷改",theme:"peach"})).ok,false);
    assert.equal((await rpc(pupil,"product:set",{slot:0,recipeId:"berry",mix:[2,1,1],price:15})).ok,false);
  }
  assert.equal((await rpc(teacher,"host:duration",{minutes:10})).ok,true);
  assert.equal((await rpc(teacher,"host:start")).ok,true);
  assert.equal((await rpc(sockets[1],"decor:set",{decor:["stage","samples"]})).ok,false);
  assert.equal((await rpc(teacher,"host:pause")).ok,true);
  assert.equal((await rpc(teacher,"host:resume")).ok,true);
  assert.equal((await rpc(teacher,"host:finish")).ok,true);
  const newState=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error("Reset snapshot missing")),3000);
    const onState=v=>{
      if(v.ready)return;
      clearTimeout(timer);sockets[1].off("player:state",onState);resolve(v);
    };
    sockets[1].on("player:state",onState);
  });
  assert.equal((await rpc(teacher,"host:reset")).ok,true);
  const state=await newState;
  assert.equal(state.ready,false);
  assert.deepEqual(state.unlocked,["berry","moon","forest"]);
});
