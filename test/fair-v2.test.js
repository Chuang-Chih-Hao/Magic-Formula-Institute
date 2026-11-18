"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {once}=require("node:events");
const {io:client}=require("socket.io-client");
const {
  makeQuestion,qualityFor,costFor,buildProduct,rankOffers,decorateScore,
  newPlayer,createRoom,runServer,pickCustomer,settleNpc,beginMarket,completeRound,
  forceStartAfterDeadline,RECIPES,DECORATIONS
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

test("all 12 recipes are locked initially; evolution improves actual product quality",()=>{
  const p=newPlayer("第一次來的學生");
  assert.equal(RECIPES.length,12);
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

test("first preparation is unlimited; every later 10-minute round reopens menu and auto-locks",()=>{
  const r=createRoom();
  assert.equal(r.round,1);
  assert.equal(r.prepEndsAt,0);
  assert.equal(r.duration,4*60);
  assert.equal(r.prepDuration,6*60);
  const p=newPlayer("店長");p.unlocked=["berry","moon","forest"];p.products=cannedMenu();p.decor=["banner","flowers"];p.ready=true;
  r.players.push(p);
  const io={to:()=>({emit:()=>{}})};
  const start=1_700_000_000_000;
  assert.equal(forceStartAfterDeadline(io,r,start+1_000_000),false,"first round never forces a start");
  beginMarket(io,r,start);
  assert.equal(r.phase,"market");
  assert.equal(r.round,1);
  completeRound(io,r,start+r.duration*1000,false);
  assert.equal(r.phase,"setup");
  assert.equal(r.round,2);
  assert.equal(r.remaining,6*60);
  assert.equal(p.ready,false);
  assert.deepEqual(p.unlocked,["berry","moon","forest"]);
  assert.deepEqual(p.products,cannedMenu(),"existing menu carried into preparation");
  assert.equal(forceStartAfterDeadline(io,r,r.prepEndsAt-1000),false);
  assert.equal(forceStartAfterDeadline(io,r,r.prepEndsAt+1),true);
  assert.equal(r.phase,"market");
  assert.equal(r.round,2);
  assert.equal(p.ready,true);
  assert.equal(r.remaining,4*60);
  completeRound(io,r,start+2_000_000,true);
  assert.equal(r.phase,"finished");
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
        assert.equal(q.action,undefined,"answer index must not leak to student");
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
      assert.equal((await rpc(socket,"product:set",{slot:0,recipeId:"berry",mix:[2,1,1],price:24})).ok,true);
      assert.equal((await rpc(socket,"product:set",{slot:1,recipeId:"moon",mix:[1,2,3],price:30})).ok,true);
      assert.equal((await rpc(socket,"product:set",{slot:2,recipeId:"forest",mix:[1,1,3],price:28})).ok,true);
      assert.equal((await rpc(socket,"player:lock")).ok,true);
      assert.equal((await rpc(socket,"product:set",{slot:0,recipeId:"berry",mix:[2,1,1],price:15})).ok,false);
    }
  }finally{Math.random=oldRandom;}
  assert.equal((await rpc(teacher,"host:duration",{minutes:4})).ok,true);
  assert.equal((await rpc(teacher,"host:start")).ok,true);
  assert.equal((await rpc(sockets[1],"decor:set",{decor:["stage","samples"]})).ok,false);
  assert.equal((await rpc(teacher,"host:pause")).ok,true);
  assert.equal((await rpc(teacher,"host:resume")).ok,true);
  assert.equal((await rpc(teacher,"host:finish")).ok,true);
  assert.equal((await rpc(teacher,"host:reset")).ok,true);
  assert.equal(states[0].unlocked.length,0,"new game resets unlocks");
  assert.deepEqual(states[0].products,[null,null,null]);
});
