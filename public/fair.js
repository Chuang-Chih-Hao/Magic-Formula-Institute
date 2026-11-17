"use strict";

(() => {
  const socket=io();
  const root=document.getElementById("app");
  const toastNode=document.getElementById("toast");
  const STORE="mfi-fair-v2";
  const THEMES={
    strawberry:{name:"草莓糖果屋",emoji:"🍓",tag:"甜甜的糖霜屋頂",accent:"#ed91a5"},
    lavender:{name:"紫晶星光塔",emoji:"🔮",tag:"尖塔與飄揚的旗幟",accent:"#ab9adc"},
    mint:{name:"森林玻璃屋",emoji:"🌿",tag:"透明溫室與藤蔓",accent:"#83c5a5"},
    peach:{name:"蜜桃茶亭",emoji:"🍑",tag:"溫暖的雙層木屋",accent:"#efb17e"}
  };
  let room=null,me=null,role=null,secret=null,myToken=null,selection=0,selectedNpcId=null;
  let draft=null,toastHandle=null,serverOffset=0;
  let npcLines={},renderMode="",lastRoomPhase="",lastPlayerId=null;
  let mapFocused=false,animationActive=true,previousFrame=0;

  const esc=(x)=>String(x==null?"":x).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const $=(id)=>document.getElementById(id);
  const setText=(id,x)=>{if($(id))$(id).textContent=x;};
  const fmtMoney=x=>Number(x||0).toLocaleString("zh-TW",{maximumFractionDigits:2});
  const clock=x=>String(Math.floor((x||0)/60)).padStart(2,"0")+":"+String((x||0)%60).padStart(2,"0");
  const themeStyle=t=>THEMES[t]||THEMES.strawberry;
  const currentPlayer=()=>room&&me?room.players.find(x=>x.id===me.id):null;
  const readyAll=()=>room&&room.players.length>0&&room.players.every(x=>x.ready);
  const isTeacher=()=>role==="host";
  const themeIcon=t=>themeStyle(t).emoji;
  const emoji=(str)=>str||"🍹";
  const phase=()=>!room?"":room.phase==="setup"?"準備攤位":room.phase==="market"?"園遊會營業中":"結算時間";
  const localTime=()=>Date.now()+serverOffset;
  const chooseById=(id)=>room?.recipes?.find(r=>r.id===id);
  const decorateById=(id)=>room?.decorations?.find(d=>d.id===id);

  function toast(s,bad=false){
    toastNode.textContent=s;toastNode.className="toast show"+(bad?" error":"");
    clearTimeout(toastHandle);toastHandle=setTimeout(()=>{toastNode.className="toast";},3600);
  }
  function send(event,data={},success){
    socket.timeout(9000).emit(event,data,(err,res)=>{
      if(err||!res||!res.ok){toast(err?"連線逾時，請檢查網路":res?.error||"操作失敗",true);return;}
      if(success)success(res);
    });
  }
  function saveSession(s){try{localStorage.setItem(STORE,JSON.stringify(s));}catch(_){}}
  function loadSession(){try{return JSON.parse(localStorage.getItem(STORE)||"null");}catch(_){return null;}}
  function forget(){try{localStorage.removeItem(STORE);}catch(_){}}
  function leave(){
    forget();role=null;room=null;me=null;secret=null;myToken=null;draft=null;
    renderMode="";socket.disconnect();socket.connect();drawLanding();
  }
  function syncDraft(force=false){
    if(!me||!room)return;
    if(!draft||force||lastPlayerId!==me.id){
      draft={shopName:me.shopName,theme:me.theme,decor:[...me.decor],
        products:me.products.map(p=>({recipeId:p.recipeId,mix:[...p.mix],price:p.price}))};
      lastPlayerId=me.id;
    }
  }
  const logo=()=>'<div class="brand"><span class="brand-icon">🍯</span><span><strong>魔法配方研究所</strong><small>MAGIC FAIR · 數學園遊會</small></span></div>';

  function drawLanding(){
    renderMode="landing";
    root.innerHTML='<main class="welcome">'
      +'<header class="landing-head">'+logo()+'<span class="chip">🌷 小學六年級 · 比與比例</span></header>'
      +'<div class="landing-cols"><section class="welcome-art">'
      +'<div class="super">THE MAGICAL MARKET IS OPEN</div><h1>我的魔法攤位<br><em>今天開市啦！</em></h1>'
      +'<p>先開一間獨一無二的店，研發三款飲料、挑選裝飾，再一起進入園遊會！看動物顧客怎麼逛、比較價格與品質，最後把金幣帶回家。</p>'
      +'<div class="illustration-market"><div class="sunny"></div>'
      +'<div class="mini-shop s1"><span>🍓</span><b>草莓糖果屋</b><i>🍹 🧋 🍸</i></div>'
      +'<div class="mini-shop s2"><span>🔮</span><b>紫晶星光塔</b><i>🍸 🥤 🧃</i></div>'
      +'<div class="scene-pets">🐰　🐱　🦊　🐻</div></div>'
      +'<div class="intro-cards"><span>🧪 解題選配方</span><span>🎪 三款飲品</span><span>🐾 全場 NPC</span><span>🏆 比拚淨利</span></div>'
      +'</section><section class="login-stack">'
      +'<div class="form-panel"><div class="block-title"><span class="num">🎓</span><span>老師開設園遊會</span></div>'
      +'<p>建立房間、觀察攤位準備情況、宣布開市與結算。</p>'
      +'<button class="btn primary full" data-action="create">🎉 建立園遊會教室</button>'
      +'<small>老師不佔名額，最多四位學生。</small></div>'
      +'<div class="form-panel"><div class="block-title"><span class="num">🧙</span><span>學生入場開店</span></div>'
      +'<label>六位數房間代碼<input id="joinCode" inputmode="numeric" maxlength="6" placeholder="例如 123456"></label>'
      +'<label>你的店長暱稱<input id="joinName" maxlength="12" placeholder="例如：草莓魔法師"></label>'
      +'<button class="btn green full" data-action="join">🌼 加入魔法園遊會</button></div>'
      +'</section></div><footer class="landing-foot">🌸 準備 → 鎖定 → NPC 逛攤 → 園遊會結算 🌸</footer></main>';
  }
  function topbar(){
    return '<div class="topbar">'+logo()+'<div class="top-actions">'
      +'<span class="chip">🏠 房間 <b class="copy" data-action="copy">'+esc(room.code)+'</b></span>'
      +'<span class="chip" id="phaseLabel">'+(room.paused?"⏸ 暫停中":"✦ "+phase())+'</span>'
      +'<span class="chip clock">⏳ <b id="timeText">'+clock(room.remaining)+'</b></span>'
      +'<button class="btn tiny outline" data-action="leave">離開</button>'
      +'</div></div>';
  }
  function boothSummary(p){
    return '<div class="ready-shop '+(p.ready?"is-ready":"")+'">'
      +'<span class="large-emoji">'+themeIcon(p.theme)+'</span><span class="ready-details">'
      +'<b>'+esc(p.shopName)+'</b><small>'+esc(p.name)+' · '+(p.ready?"🔒 已鎖定三款商品":"🛠️ 正在佈置")+'</small></span>'
      +'<span class="dot '+(p.ready?"go":"")+'"></span></div>';
  }
  function hostActions(){
    if(room.phase==="setup")return '<div class="teacher-controls">'
      +'<span>營業時長</span><select id="fairDuration" '+(room.phase!=="setup"?"disabled":"")+'>'+
      [10,15,20,25,30].map(n=>'<option value="'+n+'" '+(n===room.duration/60?"selected":"")+'>'+n+' 分鐘</option>').join("")+'</select>'
      +'<button class="btn primary" data-action="start" '+(!readyAll()?"disabled":"")+'>🎉 全員就緒，宣布開市</button></div>';
    if(room.phase==="market")return '<div class="teacher-controls">'
      +'<button class="btn outline" data-action="'+(room.paused?"resume":"pause")+'">'+(room.paused?"▶ 繼續園遊會":"⏸ 暫停園遊會")+'</button>'
      +'<button class="btn dark" data-action="finish">🏆 提前結算</button></div>';
    return '<div class="teacher-controls"><button class="btn primary" data-action="reset">🔄 再開一場園遊會</button></div>';
  }
  function hostSetup(){
    renderMode="hostsetup";
    root.innerHTML='<main class="shell">'+topbar()
      +'<div class="heading-row"><div><div class="eyebrow">TEACHER · PREPARATION</div><h1>🎪 魔法園遊會準備中</h1>'
      +'<p>學生需先完成裝潢、備妥三款飲料並鎖定；全部準備好就能開市。</p></div>'
      +'<div class="room-ticket"><small>投影或分享代碼</small><strong>'+esc(room.code)+'</strong><button class="btn tiny outline" data-action="copy">複製代碼</button></div></div>'
      +'<div class="teacher-grid"><div class="surface"><h2>🐻 四間攤位的準備狀態</h2>'
      +'<div id="readyList" class="ready-list">'+room.players.map(boothSummary).join("")+'</div>'
      +'<p class="hint">目前 '+room.players.filter(x=>x.ready).length+' / '+room.players.length+' 位已鎖定。即使只有兩位學生也可以開市，不必等滿四位。</p>'
      +hostActions()
      +'</div><div class="surface"><h2>🗺️ 園遊會地圖預覽</h2><p class="sub">每個學生的建築與裝飾會出現在固定攤位。</p>'
      +'<div class="map-viewport preview-map"><canvas id="fairCanvas" width="1040" height="680"></canvas></div></div></div>'
      +'</main>';
  }
  function decorCard(d){
    const selected=draft.decor.includes(d.id);
    return '<button type="button" class="decor-card '+(selected?"chosen":"")+'" data-action="toggle-decor" data-id="'+d.id+'">'
      +'<span class="dec-art dec-'+d.id+'">'+d.emoji+'</span><strong>'+d.name+'</strong><span class="benefit">'+d.desc+'</span>'
      +'<small>'+(selected?"✅ 這件已設置在攤位":"點一下裝進攤位")+'</small></button>';
  }
  function recipeCard(r){
    const unlocked=me.unlocked.includes(r.id);
    return '<button class="unlock-card '+(unlocked?"unlocked":"locked")+'" data-action="'+(unlocked?"noop":"get-quest")+'" data-id="'+r.id+'">'
      +'<span>'+r.emoji+'</span><b>'+r.name+'</b><small>'+(unlocked?"✅ 已解鎖":"🔐 答題解鎖")+'</small></button>';
  }
  function productCard(p,i){
    const opts=room.recipes.map(r=>'<option value="'+r.id+'" '+(!me.unlocked.includes(r.id)?"disabled":"")+' '+(p.recipeId===r.id?"selected":"")+'>'+r.emoji+' '+r.name+(!me.unlocked.includes(r.id)?"（尚未解鎖）":"")+'</option>').join("");
    const r=chooseById(p.recipeId),quality=calcQuality(p.mix,r?.ratio||[1,1,1]);
    return '<article class="menu-edit"><div class="menu-edit-header"><span class="drink-num">'+(i+1)+'</span>'
      +'<h3>第 '+["一","二","三"][i]+' 款招牌飲品</h3><span class="quality-pill" id="quality-'+i+'">品質 '+quality+' 分</span></div>'
      +'<select class="product-select" id="recipe-'+i+'" data-change="recipe" data-slot="'+i+'">'+opts+'</select>'
      +'<div class="ratio-legend"><span>🌸 花露</span><span>🍬 星糖</span><span>💧 月光水</span></div>'
      +'<div class="ratio-inputs">'+p.mix.map((v,k)=>'<input type="number" min="1" max="12" step="1" value="'+v+'" id="mix-'+i+'-'+k+'" aria-label="第'+(i+1)+'款第'+(k+1)+'種材料" data-change="mix" data-slot="'+i+'" data-index="'+k+'">').join("")+'</div>'
      +'<div class="product-foot"><label>售價 🪙 <input type="number" min="12" max="80" step="1" value="'+p.price+'" id="price-'+i+'" data-change="price" data-slot="'+i+'"></label>'
      +'<span class="ratio-text">目標比例 <b id="ratio-'+i+'">'+(r?.ratio.join("：")||"？")+'</b></span>'
      +'<button class="btn outline small" data-action="save-product" data-slot="'+i+'">儲存這杯</button></div>'
      +'<p class="cost-label" id="cost-'+i+'">每杯成本約 '+fmtMoney((6+p.mix.reduce((a,b)=>a+b,0)*2)/3)+' 金幣</p>'
      +'</article>';
  }
  function feedback(){
    if(!me.result)return "";
    return '<div class="feedback '+(me.result.correct?"right":"wrong")+'"><b>'
      +(me.result.correct?"🌟 解對了，研究星星 +2！":"📖 這次再複習一下：")+'</b><p>正確答案：'+esc(me.result.answer)+'</p><p>'+esc(me.result.explanation)+'</p></div>';
  }
  function questZone(){
    if(!me.question)return feedback();
    const q=me.question;
    return '<div class="question"><div class="skill">✦ '+esc(q.skill)+'</div><h3>'+esc(q.prompt)+'</h3>'
      +'<div class="choices">'+q.choices.map((v,i)=>'<button class="btn choice" data-action="answer" data-index="'+i+'">'+esc(v)+'</button>').join("")+'</div></div>';
  }
  function studentSetup(){
    syncDraft();
    if(me.ready)return readyWaiting();
    renderMode="studentsetup";
    root.innerHTML='<main class="shell">'+topbar()
      +'<div class="heading-row"><div><div class="eyebrow">MAGIC FAIR · DESIGN YOUR BOOTH</div>'
      +'<h1>🌼 開市前的魔法準備</h1><p>先佈置攤位，再配好三杯招牌飲品。確認之後鎖定，正式開市就不能改！</p></div>'
      +'<div class="research-score">📚 研究星星 <b>'+me.research+'</b><small>答對比與比例題獲得</small></div></div>'
      +'<div class="prep-grid">'
      +'<section class="surface prep-decor"><div class="step-head"><b>01</b><div><h2>打造與眾不同的攤位</h2><p>建築造型 + 兩個具有實際效果的大型裝飾</p></div></div>'
      +'<label class="field-label">我的店名<input id="shopName" maxlength="18" value="'+esc(draft.shopName)+'"></label>'
      +'<h3>選一種建築（每種造型不同）</h3><div class="theme-grid">'+Object.entries(THEMES).map(([id,t])=>
        '<button class="theme-tile '+(draft.theme===id?"selected":"")+'" data-action="theme" data-id="'+id+'">'
        +'<span class="theme-icon">'+t.emoji+'</span><strong>'+t.name+'</strong><small>'+t.tag+'</small></button>').join("")+'</div>'
      +'<h3>選兩件裝飾：會改變 NPC 的評分！</h3>'
      +'<p class="hint">已選 <b id="decCount">'+draft.decor.length+'</b>/2 件；裝飾不是單純換色，會出現在地圖上的攤位旁。</p>'
      +'<div class="decor-grid">'+room.decorations.map(decorCard).join("")+'</div>'
      +'<button class="btn green full" data-action="save-design">🌿 儲存我的攤位設計</button></section>'
      +'<section class="surface prep-drinks"><div class="step-head"><b>02</b><div><h2>三款招牌飲品</h2><p>比例越精準，品質越高；價格越貴越可能失去顧客</p></div></div>'
      +'<div class="products">'+draft.products.map(productCard).join("")+'</div></section>'
      +'<section class="surface prep-questions"><div class="step-head"><b>03</b><div><h2>數學配方研究桌</h2><p>想賣更特別的飲品，就先破解比例題！</p></div></div>'
      +'<div class="unlock-grid">'+room.recipes.map(recipeCard).join("")+'</div>'
      +'<button class="btn outline full" data-action="practice" style="margin:12px 0">🧠 另外挑戰一題比例應用</button>'
      +'<div id="quizArea">'+questZone()+'</div>'
      +'<div class="lock-section"><div class="lock-emoji">🔒</div><h3>準備好迎接園遊會了嗎？</h3>'
      +'<p>鎖定後三款商品、售價、比例和裝飾都不能更改。可以等待老師宣布開市。</p>'
      +'<button class="btn primary full" data-action="lock">🔐 三款飲品確認，鎖定攤位</button></div></section></div>'
      +'</main>';
  }
  function readyWaiting(){
    renderMode="ready";
    root.innerHTML='<main class="shell">'+topbar()
      +'<div class="heading-row"><div><div class="eyebrow">BOOTH LOCKED</div><h1>🔒 你的攤位已鎖定</h1>'
      +'<p>裝飾、三款飲料、售價、比例都已封存。等待老師宣布開市！</p></div>'
      +'<span class="pill-big">✅ 準備完成</span></div>'
      +'<div class="wait-layout"><div class="surface"><h2>🍹 我的三款招牌飲品</h2>'
      +'<div class="waiting-products">'+me.products.map((p,i)=>'<div class="waiting-product"><span>'+p.emoji+'</span><b>'+esc(p.name)+'</b><small>品質 '+p.quality+' · 🪙 '+p.price+' · '+p.mix.join("：")+'</small></div>').join("")+'</div>'
      +'<h3>🎀 已選裝飾</h3><div class="benefit-list">'+me.decor.map(id=>{const d=decorateById(id);return d?'<div>'+d.emoji+' <b>'+d.name+'</b> · '+d.desc+'</div>':"";}).join("")+'</div>'
      +'<p class="hint">教師開市前，無法撤回鎖定。如需重來，請老師使用「再開一場」。</p></div>'
      +'<div class="surface"><h2>🗺️ 等待其他攤位就緒</h2>'
      +'<div class="map-viewport"><canvas id="fairCanvas" width="1040" height="680"></canvas></div>'
      +'<div class="ready-list">'+room.players.map(boothSummary).join("")+'</div></div></div></main>';
  }
  function rank(){
    if(!room)return [];
    return [...room.players].sort((a,b)=>b.profit-a.profit||b.sales-a.sales||b.correct-a.correct);
  }
  function scoreboard(){
    return '<div class="leaderboard">'+rank().map((p,i)=>'<div class="rank-entry '+(me?.id===p.id?"mine":"")+'" data-action="view-booth" data-booth="'+p.booth+'">'
      +'<span class="medal">'+["🥇","🥈","🥉","④"][i]+'</span><span class="rank-shop"><b>'+esc(p.shopName)+'</b><small>'+themeIcon(p.theme)+' '+esc(p.name)+' · '+p.sales+' 杯</small></span>'
      +'<strong>'+fmtMoney(p.profit)+'<small>金幣淨利</small></strong></div>').join("")+'</div>';
  }
  function eventFeed(){
    const events=room?.events||[];
    if(!events.length)return '<div class="empty-feed">🐾 動物顧客還沒進場，開市後會自動逛攤！</div>';
    return events.slice(0,9).map(e=>'<div class="event '+esc(e.kind)+'">'
      +'<span class="event-emoji">'+(e.emoji||"🎪")+'</span>'
      +'<div><strong>'+esc(e.message)+'</strong>'+(e.why?'<small>💭 '+esc(e.why)+'</small>':"")+(npcLines[e.npcId]?'<small class="ai-dialogue">💬 AI 顧客：'+esc(npcLines[e.npcId])+'</small>':"")+'</div></div>').join("");
  }
  function compareNpc() {
    const all=room?.npcs||[];
    const n=all.find(x=>x.id===selectedNpcId)||all.find(x=>x.stage==="wandering")||all[all.length-1];
    if(!n)return '<div class="empty-feed">🐰 還沒有顧客進場。NPC 一入場，就會在這裡顯示比較過的攤位評分。</div>';
    const scores=n.visitorScores||[];
    const top=scores[0];
    const decided=n.stage!=="wandering";
    return '<div class="npc-head"><span class="npc-big">'+esc(n.emoji)+'</span>'
      +'<div><b>'+esc(n.name)+'</b><small>偏好 '+esc(n.flavor)+' · 預算 🪙 '+n.budget+'</small></div>'
      +'<span class="npc-stage">'+(decided?(n.bought?"✅ 已購買":"🧺 沒購買"):"🚶 逛街比價中")+'</span></div>'
      +'<p class="npc-tip">比較方式：飲品品質＋價格合理度＋喜好口味＋攤位裝飾加分（越高越有吸引力）。</p>'
      +'<div class="npc-scores">'+scores.map((x,i)=>'<div class="npc-score '+(i===0?"top":"")+'" data-action="compare-booth" data-id="'+esc(x.shopId)+'">'
        +'<b>'+(i===0?"💛 ":"")+esc(x.shopName)+'</b>'
        +'<span>品質 '+x.quality+' · 🪙'+x.price+'</span>'
        +'<strong>'+x.score+' 分</strong></div>').join("")+'</div>'
      +(top?'<p class="npc-tip">'+(decided?"最後最有吸引力的是「":"目前比較喜歡「")+esc(top.shopName)+'」；'+(n.bought&&decided?"已經買下這杯！":decided?"但這次沒有成交。":"還在走路比較中。")+'</p>':
        '<p class="npc-tip">目前沒有任何店鋪的商品符合這位顧客的預算。</p>');
  }
  function selectedBoothCard(){
    const p=room?.players?.[selection];
    if(!p)return '<div class="empty-feed">點選地圖上的任一攤位，看看他們的商品與裝飾！</div>';
    return '<div class="selected-shop-title"><span class="select-icon">'+themeIcon(p.theme)+'</span><span><b>'+esc(p.shopName)+'</b><small>'+esc(p.name)+' · 攤位 '+(p.booth+1)+'</small></span>'
      +'<span class="shop-ready">'+(p.ready?"🔒 已鎖定":"準備中")+'</span></div>'
      +'<div class="info-decor">'+p.decor.map(id=>{const d=decorateById(id);return d?'<div><span>'+d.emoji+' '+d.name+'</span><small>'+d.desc+'</small></div>':"";}).join("")+'</div>'
      +'<div class="menu-board">'+p.products.map(pr=>'<div class="board-drink"><span>'+pr.emoji+'</span><span><b>'+esc(pr.name)+'</b><small>品質 '+pr.quality+' · '+pr.flavor+'</small></span><strong>🪙 '+pr.price+'</strong></div>').join("")+'</div>';
  }
  function marketPage(){
    renderMode="market";
    if(selection>=room.players.length)selection=0;
    root.innerHTML='<main class="shell">'+topbar()
      +(room.phase==="finished"?'<div class="winner-banner"><span>🏆</span><div><h1>魔法園遊會閉幕！</h1><p>本日營業王：<strong>'+esc(rank()[0]?.shopName||"尚無攤位")+'</strong>。排名依「收入 − 每杯材料成本」的淨利計算。</p></div></div>':
        '<div class="heading-row market-heading"><div><div class="eyebrow">LIVE MARKET · ANIMAL SHOPPING</div>'
        +'<h1>🎪 動物小鎮魔法園遊會</h1><p>所有攤位已鎖定！NPC 會走路、比價、試算品質，最後自行決定去哪一間買。</p></div>'
        +(isTeacher()?hostActions():'<span class="pill-big">🧙 一起看顧客挑哪家！</span>')+'</div>')
      +(room.paused?'<div class="pause-alert">⏸ 老師暫停園遊會，顧客和計時器也已暫停。</div>':"")
      +'<div class="market-layout">'
      +'<section class="market-main surface"><div class="section-title"><div><h2>🗺️ 全場共享地圖</h2><p>點選攤位可查看三款飲品與人氣裝飾</p></div><span class="pill">🐾 正在逛街：<b id="npcCount">0</b></span></div>'
      +'<div class="map-viewport"><canvas id="fairCanvas" width="1040" height="680" tabindex="0" aria-label="魔法園遊會地圖，四間攤位和走動的動物顧客"></canvas></div>'
      +'<div class="map-legend"><span>🐾 顧客走動</span><span>🍹 停攤比較</span><span>💛 決定購買</span><span>💰 賺取淨利</span></div>'
      +'<div class="surface-inset"><div class="section-title"><h2>🔍 目前查看的攤位</h2><small>點地圖切換</small></div><div id="boothDetails">'+selectedBoothCard()+'</div></div></section>'
      +'<aside class="market-side"><div class="surface"><div class="section-title"><h2>🔎 顧客正在比較什麼？</h2><span class="pill">點地圖上的動物切換</span></div><div id="npcComparison">'+compareNpc()+'</div></div>'
      +'<div class="surface"><div class="section-title"><h2>🏆 即時淨利排行</h2><span class="pill">全場同步</span></div><div id="leaderboard">'+scoreboard()+'</div>'
      +'<p class="hint">每賣出一杯會扣除那杯的材料成本。裝飾影響 NPC 比較分數，而不是直接增加金幣。</p></div>'
      +'<div class="surface"><div class="section-title"><h2>📣 顧客園遊會日記</h2><span class="pill">即時成交原因</span></div>'
      +'<div class="events" id="eventFeed">'+eventFeed()+'</div></div></aside></div>'
      +(room.phase==="finished"&&isTeacher()?'<div class="finish-action">'+hostActions()+'</div>':"")+'</main>';
  }
  function updateMarket(){
    if(renderMode!=="market"||!room)return;
    setText("leaderboard","");
    if($("leaderboard"))$("leaderboard").innerHTML=scoreboard();
    if($("eventFeed"))$("eventFeed").innerHTML=eventFeed();
    if($("boothDetails"))$("boothDetails").innerHTML=selectedBoothCard();
    if($("npcComparison"))$("npcComparison").innerHTML=compareNpc();
    setText("npcCount",room.npcs.filter(n=>n.stage==="wandering").length);
    setText("timeText",clock(room.remaining));
    setText("phaseLabel",room.paused?"⏸ 暫停中":"✦ "+phase());
  }
  function render(){
    if(!role||!room){drawLanding();return;}
    if(room.phase==="market"||room.phase==="finished"){
      if(renderMode!=="market"||lastRoomPhase!==room.phase)marketPage();
      else updateMarket();
    }else if(isTeacher())hostSetup();
    else if(!me){return;}
    else if(me.ready)readyWaiting();
    else {if(lastRoomPhase&&lastRoomPhase!=="setup")draft=null;studentSetup();}
    lastRoomPhase=room.phase;
  }

  function calcQuality(mix,ratio){
    const a=mix.map(Number),total=a.reduce((x,y)=>x+y,0),r=ratio.reduce((x,y)=>x+y,0);
    if(!a.every(n=>Number.isInteger(n)&&n>=1&&n<=12)||total>27)return 0;
    return Math.max(8,Math.min(100,Math.round(100-142*a.reduce((sum,n,i)=>sum+Math.abs(n/total-ratio[i]/r),0))));
  }
  function updateProductPreview(slot){
    const p=draft.products[slot],r=chooseById(p.recipeId);
    if(!r)return;
    setText("quality-"+slot,"品質 "+calcQuality(p.mix,r.ratio)+" 分");
    setText("ratio-"+slot,r.ratio.join("："));
    setText("cost-"+slot,"每杯成本約 "+fmtMoney((6+p.mix.reduce((a,b)=>a+(Number(b)||0),0)*2)/3)+" 金幣");
  }

  document.addEventListener("click",e=>{
    const b=e.target.closest("[data-action]");
    if(!b)return;
    const action=b.dataset.action;
    if(action==="create")return send("host:create",{},r=>{
      role="host";secret=r.secret;me=null;draft=null;saveSession({role,code:r.code,secret:r.secret});render();toast("已建立園遊會教室！");
    });
    if(action==="join"){
      const code=$("joinCode")?.value.trim(),name=$("joinName")?.value.trim();
      if(!/^\d{6}$/.test(code))return toast("請輸入六位數代碼",true);
      if(!name)return toast("請先輸入魔法師暱稱",true);
      return send("player:join",{code,name},r=>{
        role="student";myToken=r.token;draft=null;saveSession({role,code,token:r.token,name});render();
        toast("歡迎來到園遊會！先裝潢並準備三款飲料。");
      });
    }
    if(action==="leave")return leave();
    if(action==="copy"){
      if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(room.code).then(()=>toast("房間代碼已複製")).catch(()=>toast("代碼："+room.code));
      else toast("代碼："+room.code);
      return;
    }
    if(action==="theme"){
      draft.shopName=$("shopName")?.value||draft.shopName;
      draft.theme=b.dataset.id;
      studentSetup();return;
    }
    if(action==="toggle-decor"){
      draft.shopName=$("shopName")?.value||draft.shopName;
      const id=b.dataset.id;
      if(draft.decor.includes(id))return toast("至少要保留兩件裝飾；點另一件即可替換。");
      draft.decor=[draft.decor[1],id];
      studentSetup();return;
    }
    if(action==="save-design"){
      draft.shopName=$("shopName")?.value.trim()||"";
      if(!draft.shopName)return toast("請先輸入店名",true);
      return send("shop:update",{shopName:draft.shopName,theme:draft.theme},()=>{
        send("decor:set",{decor:draft.decor},()=>toast("🎀 攤位造型和裝飾已儲存！"));
      });
    }
    if(action==="save-product"){
      const i=Number(b.dataset.slot),p=draft.products[i];
      if(!Number.isInteger(p.price)||p.price<12||p.price>80)return toast("單杯售價須為 12～80 整數",true);
      return send("product:set",{slot:i,...p},r=>toast("第 "+(i+1)+" 款飲品已存好，品質 "+r.quality+" 分！"));
    }
    if(action==="get-quest"){
      return send("quest:get",{target:b.dataset.id},()=>{toast("破解這題，就能解鎖新配方！");});
    }
    if(action==="practice")return send("quest:get",{target:"practice"});
    if(action==="answer")return send("quest:answer",{index:Number(b.dataset.index)},r=>toast(r.correct?"答對了！已獲得研究星星。":"看看解析，再挑戰新題吧。",!r.correct));
    if(action==="lock"){
      if(!$("shopName"))return;
      draft.shopName=$("shopName").value.trim();
      if(!draft.shopName)return toast("請先為你的攤位取名",true);
      if(new Set(draft.products.map(p=>p.recipeId)).size!==3)return toast("三款飲品必須是不同的配方",true);
      if(draft.products.some(p=>!p.mix.every(n=>Number.isInteger(n)&&n>=1&&n<=12)
        ||p.mix.reduce((a,b)=>a+b,0)>27||!Number.isInteger(p.price)||p.price<12||p.price>80))
        return toast("請檢查三款飲料的匙數及售價",true);
      const sure=confirm("會先自動儲存所有選擇，再鎖定攤位。鎖定後，配方、售價與裝飾均不能更改，直到下一場。確定嗎？");
      if(!sure)return;
      send("shop:update",{shopName:draft.shopName,theme:draft.theme},()=>{
        send("decor:set",{decor:draft.decor},()=>{
          const saveSlot=i=>{
            if(i>=3)return send("player:lock",{},()=>toast("🔒 三款飲料與裝飾已封存！"));
            send("product:set",{slot:i,...draft.products[i]},()=>saveSlot(i+1));
          };
          saveSlot(0);
        });
      });
      return;
    }
    if(action==="start")return send("host:start",{},()=>toast("🎉 魔法園遊會正式開市！"));
    if(action==="pause")return send("host:pause");
    if(action==="resume")return send("host:resume");
    if(action==="finish"){
      if(confirm("確定要提前結束園遊會並公布排行榜？"))send("host:finish");
      return;
    }
    if(action==="reset"){
      if(confirm("下一場將重新開放設計，所有攤位的營收與題目進度會歸零。"))send("host:reset",{},()=>{draft=null;toast("下一場準備開始！");});
      return;
    }
    if(action==="compare-booth"){
      const p=room?.players.find(x=>x.id===b.dataset.id);
      if(p){selection=p.booth;if($("boothDetails"))$("boothDetails").innerHTML=selectedBoothCard();}
      return;
    }
    if(action==="view-booth"){
      selection=Number(b.dataset.booth);
      if($("boothDetails"))$("boothDetails").innerHTML=selectedBoothCard();
      return;
    }
  });
  document.addEventListener("change",e=>{
    const el=e.target;
    if(el.id==="fairDuration")return send("host:duration",{minutes:Number(el.value)});
    if(!draft||!el.dataset.change)return;
    const i=Number(el.dataset.slot),p=draft.products[i];
    if(!p)return;
    if(el.dataset.change==="recipe"){
      const r=chooseById(el.value);
      if(!r)return;
      p.recipeId=r.id;p.mix=r.ratio.slice();
      for(let k=0;k<3;k++){const input=$("mix-"+i+"-"+k);if(input)input.value=p.mix[k];}
    }else if(el.dataset.change==="mix")p.mix[Number(el.dataset.index)]=Number(el.value);
    else if(el.dataset.change==="price")p.price=Number(el.value);
    updateProductPreview(i);
  });
  document.addEventListener("input",e=>{
    if(!draft||!e.target.dataset.change)return;
    const el=e.target,i=Number(el.dataset.slot),p=draft.products[i];
    if(!p)return;
    if(el.dataset.change==="mix")p.mix[Number(el.dataset.index)]=Number(el.value);
    if(el.dataset.change==="price")p.price=Number(el.value);
    updateProductPreview(i);
  });
  document.addEventListener("keydown",e=>{
    if(e.key==="Enter"&&["joinCode","joinName"].includes(e.target.id)){
      document.querySelector('[data-action="join"]')?.click();
    }
  });

  socket.on("room:state",data=>{
    if(data.serverNow)serverOffset=data.serverNow-Date.now();
    if(role&&data.code!==room?.code)return;
    const old=room?.phase;
    room=data;
    if(role)render();
    if(old&&old!=="market"&&room.phase==="market")toast("🎉 園遊會開市！請看動物顧客逛攤。");
  });
  socket.on("room:clock",data=>{
    if(!room)return;
    const old=room.phase;
    room.remaining=data.remaining;room.phase=data.phase;room.paused=data.paused;
    if(data.serverNow)serverOffset=data.serverNow-Date.now();
    setText("timeText",clock(room.remaining));
    if(old!==room.phase&&role)render();
  });
  socket.on("player:state",data=>{
    const wasReady=me?.ready;
    if(wasReady&&!data.ready)draft=null;
    me=data;
    syncDraft(!wasReady&&data.ready);
    if(role==="student")render();
  });
  socket.on("fair:trade",evt=>{
    if(evt.kind==="sale")toast("💰 "+evt.message);
  });
  socket.on("npc:dialogue",data=>{
    npcLines[data.visitId]=data.text;
    if($("eventFeed"))$("eventFeed").innerHTML=eventFeed();
  });
  socket.on("connect",()=>{
    const old=loadSession();
    if(!old)return;
    const action=old.role==="host"?"host:rejoin":"player:join";
    const payload=old.role==="host"?{code:old.code,secret:old.secret}:{code:old.code,token:old.token,name:old.name};
    socket.timeout(10000).emit(action,payload,(error,res)=>{
      if(error||!res?.ok){
        forget();role=null;me=null;room=null;draft=null;
        drawLanding();toast("舊房間已關閉，請重新加入。",true);return;
      }
      role=old.role;secret=old.secret;myToken=res.token;render();
    });
  });
  socket.on("disconnect",()=>{if(role)toast("連線中斷，系統會自動重新連線",true);});
  socket.on("player:replaced",()=>{toast("這位學生已在另一台裝置登入",true);leave();});
  socket.on("host:replaced",()=>{toast("教師已在另一台裝置登入",true);leave();});

  // ----- Original canvas-drawn village, shops, walking NPCs, and decorations -----
  const R=(c,x,y,w,h,r,fill,stroke,lw=1)=>{
    c.beginPath();c.roundRect(x,y,w,h,r);if(fill){c.fillStyle=fill;c.fill();}
    if(stroke){c.lineWidth=lw;c.strokeStyle=stroke;c.stroke();}
  };
  const circle=(c,x,y,r,fill,stroke,lw=1)=>{
    c.beginPath();c.arc(x,y,r,0,Math.PI*2);
    if(fill){c.fillStyle=fill;c.fill();}
    if(stroke){c.strokeStyle=stroke;c.lineWidth=lw;c.stroke();}
  };
  const poly=(c,pts,fill,stroke,lw=1)=>{
    c.beginPath();c.moveTo(pts[0][0],pts[0][1]);
    pts.slice(1).forEach(p=>c.lineTo(p[0],p[1]));c.closePath();
    if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=lw;c.stroke();}
  };
  const drawText=(c,s,x,y,font,color="#5c493e",align="center")=>{
    c.font=font;c.textAlign=align;c.textBaseline="middle";c.fillStyle=color;
    c.fillText(s,x,y);
  };
  const shortText=(t,n=11)=>{const str=String(t);return str.length>n?str.slice(0,n-1)+"…":str;};
  const shopPos=[{x:230,y:283},{x:808,y:283},{x:230,y:565},{x:808,y:565}];
  function confetti(c,x,y,seed,t){
    const dots=[[0,-12],[-17,3],[18,0],[5,12],[-10,-9]];
    dots.forEach((p,i)=>{
      const tw=Math.sin(t/650+seed+i)*.45+.55;
      circle(c,x+p[0]*1.2,y+p[1]*1.2,2.5*tw,["#fff6c1","#fa8da5","#a8e6d1","#b7b4e6"][i%4]);
    });
  }
  function background(c,t){
    const sky=c.createLinearGradient(0,0,0,680);
    sky.addColorStop(0,"#d9f2ef");sky.addColorStop(.52,"#edf4d8");sky.addColorStop(1,"#c9e6b9");
    c.fillStyle=sky;c.fillRect(0,0,1040,680);
    // Grass flecks: fixed seeds, no random flicker
    for(let i=0;i<310;i++){
      const x=(i*137+71)%1040,y=(i*199+83)%680;
      c.fillStyle=i%4?"#a7d0aa61":"#ffffff60";c.fillRect(x,y,4+(i%3),2);
    }
    R(c,451,0,139,680,0,"#e9d9bd");
    R(c,0,315,1040,88,0,"#ead9c3");
    R(c,451,0,139,680,0,"#d8c1a2");
    R(c,0,325,1040,69,0,"#d8c1a2");
    for(let y=9;y<680;y+=44){
      for(let x=466+(y%2)*22;x<580;x+=49){
        R(c,x,y,44,29,5,(x+y)%4?"#f4e9d7":"#f8ecdb");
      }
    }
    for(let y=339;y<391;y+=30)for(let x=8;x<1030;x+=59){
      R(c,x+((y%3)*11),y,53,22,4,(x+y)%5?"#f3e8d6":"#fff2e3");
    }
    // Tiny trees, benches, hedges
    [[35,44],[1000,54],[33,310],[1012,313],[40,595],[1005,596]].forEach(([x,y],j)=>{
      R(c,x-5,y+14,10,28,4,"#976e53");
      circle(c,x,y,32,j%2?"#95cda0":"#acd49a","#7fad82",4);
      circle(c,x-10,y-10,18,"#c2e1a5a0");
      circle(c,x+15,y+5,7,"#fff2c0");
    });
    for(let i=0;i<52;i++){
      const x=(i*223+47)%1040,y=(i*167+17)%680;
      if((x>90&&x<945&&((y>95&&y<290)||(y>380&&y<570)))||(x>425&&x<605))continue;
      drawText(c,i%3?"✿":"✾",x,y,"18px serif",i%2?"#ef9cab":"#fff5c8");
    }
    // Central fountain, lanterns and arrival gate
    circle(c,520,356,45,"#b9c6a3");
    circle(c,520,347,41,"#b5dfea","#7ca2b1",5);
    circle(c,520,346,27,"#d8f6f6","#9ed1db",3);
    circle(c,520,343,11,"#93bfb4");
    confetti(c,520,331,2,t);
    drawText(c,"魔法小鎮",520,401,"900 16px Nunito, 'Noto Sans TC', sans-serif","#806351");
    R(c,439,632,164,36,18,"#fff5dc","#b69c7b",4);
    drawText(c,"🎟  歡迎光臨",520,649,"900 18px 'Noto Sans TC', sans-serif","#956d65");
  }
  function roof(c,x,y,w,theme,t){
    const ink="#8c6b5a";
    if(theme==="strawberry"){
      R(c,x+18,y-10,w-36,70,26,"#f6b1bf",ink,5);
      for(let i=0;i<7;i++)circle(c,x+25+i*(w-50)/6,y+54,20,i%2?"#fff6ed":"#e9839b","#d28c86",2);
      drawText(c,"🍓",x+w/2,y-12,"45px sans-serif");
      R(c,x+21,y+21,w-42,16,8,"#fff5e7b3");
    }else if(theme==="lavender"){
      poly(c,[[x+7,y+58],[x+49,y-45],[x+w-48,y-45],[x+w-7,y+58]],"#b9ade8",ink,5);
      R(c,x+52,y-65,28,35,4,"#a391d9",ink,3);
      R(c,x+w-76,y-65,28,35,4,"#a391d9",ink,3);
      drawText(c,"✦",x+w/2,y-10,"35px sans-serif","#fff9c3");
      drawText(c,"⚑",x+65,y-64,"30px sans-serif","#fbb1bf");
    }else if(theme==="mint"){
      c.beginPath();c.moveTo(x+9,y+56);c.bezierCurveTo(x+19,y-65,x+w-19,y-65,x+w-9,y+56);
      c.closePath();c.fillStyle="#a4dac7";c.fill();c.strokeStyle=ink;c.lineWidth=5;c.stroke();
      for(let i=0;i<5;i++)R(c,x+36+i*40,y+3,7,52,4,"#f5fff58a");
      R(c,x+15,y+20,w-30,12,6,"#f0ffef8f");
      drawText(c,"🍀",x+w/2,y-39,"39px sans-serif");
    }else{
      poly(c,[[x+3,y+31],[x+44,y-27],[x+w-45,y-27],[x+w-3,y+31],[x+w-7,y+51],[x+6,y+51]],"#efaf7d",ink,5);
      poly(c,[[x+40,y-28],[x+76,y-65],[x+w-76,y-65],[x+w-41,y-28]],"#fbd29d",ink,4);
      drawText(c,"🍑",x+w/2,y-47,"32px sans-serif");
      for(let i=0;i<2;i++)drawText(c,"🏮",x+(i? w-38:38),y+21,"22px sans-serif");
    }
  }
  function boothDecor(c,x,y,decors,t){
    if(decors.includes("banner")){
      R(c,x-141,y-43,9,86,4,"#9c7859");
      circle(c,x-136,y-56,28,"#f7e5b6","#9e7352",3);
      c.save();c.translate(x-136,y-56);c.rotate(t/2100);
      for(let i=0;i<4;i++){
        c.rotate(Math.PI/2);
        poly(c,[[-7,2],[7,2],[24,-27],[-8,-18]],"#f59fae","#c6838d",2);
      }
      c.restore();circle(c,x-136,y-56,8,"#ffeaac","#956c52",2);
      drawText(c,"招牌",x-138,y+57,"900 13px 'Noto Sans TC'","#936955");
    }
    if(decors.includes("flowers")){
      R(c,x-142,y+17,93,25,9,"#bf8975","#94705b",3);
      for(let i=0;i<5;i++){
        const fx=x-133+i*17,fy=y+11+Math.sin(t/800+i)*2;
        drawText(c,i%2?"🌼":"🌷",fx,fy,"26px sans-serif");
      }
      drawText(c,"甜美 +25",x-98,y+55,"900 13px 'Noto Sans TC'","#a36b79");
    }
    if(decors.includes("fountain")){
      R(c,x+70,y+18,73,28,14,"#83c7db","#608fac",4);
      circle(c,x+107,y+14,19,"#b9e9f6","#6da7c8",3);
      drawText(c,"💦",x+107,y+1-Math.sin(t/450)*3,"31px sans-serif");
      drawText(c,"清爽 +25",x+103,y+56,"900 13px 'Noto Sans TC'","#4e98a8");
    }
    if(decors.includes("stage")){
      R(c,x+70,y+23,74,19,8,"#c5a7e3","#8c78b5",3);
      drawText(c,"🌟",x+104,y+1+Math.sin(t/500)*-4,"39px sans-serif");
      confetti(c,x+110,y-30,2,t);
      drawText(c,"夢幻 +25",x+109,y+56,"900 13px 'Noto Sans TC'","#8565a6");
    }
    if(decors.includes("samples")){
      R(c,x+75,y+13,69,21,6,"#f1c8a1","#9d7459",3);
      R(c,x+85,y+34,7,18,3,"#9c7459");
      R(c,x+128,y+34,7,18,3,"#9c7459");
      drawText(c,"🥤 🧋",x+110,y+8,"24px sans-serif");
      drawText(c,"免費試喝",x+106,y+56,"900 13px 'Noto Sans TC'","#b4776c");
    }
  }
  function shop(c,p,index,t){
    const pos=shopPos[index];
    c.save();c.translate(pos.x,pos.y);
    const x=-121,y=-164,w=242,theme=p?.theme||"strawberry";
    // Booth plot and shadows
    R(c,-154,-138,308,201,27,p?"#ffffff75":"#ffffff3d",p&&me?.id===p.id?"#e895a6":"#e9d2b7",p&&me?.id===p.id?5:2);
    R(c,x+9,y+46,w-18,120,14,"#fdf4dd","#8e715c",5);
    R(c,x+24,y+84,w-48,56,10,theme==="mint"?"#d8f6e5":theme==="lavender"?"#eee4fa":"#ffe9d7","#c7a186",3);
    roof(c,x,y,w,theme,t);
    R(c,x+6,y+100,w-12,37,12,theme==="strawberry"?"#f9b8c4":theme==="lavender"?"#c6b7e6":theme==="mint"?"#b1debd":"#efd0a4","#996f59",3);
    for(let i=0;i<7;i++)R(c,x+11+i*33,y+102,17,34,3,"#fff9edcf");
    R(c,x+25,y+143,w-50,18,4,"#ad8063","#795849",3);
    // Product bottles displayed physically on the stall counter
    if(p){
      p.products.forEach((item,i)=>{
        const px=-67+i*64,py=-48;
        R(c,px-7,py-9,14,9,2,"#ab7a5a");
        R(c,px-17,py,34,43,9,item.color||"#e8bdc7","#ffffff",3);
        R(c,px-12,py+9,8,18,4,"#ffffff8c");
        drawText(c,""+item.emoji,px,py+19,"20px sans-serif");
        R(c,px-23,py+46,46,18,7,"#fff5d9","#e3c9aa",2);
        drawText(c,"🪙"+item.price,px,py+55,"900 12px Nunito","#84644a");
      });
      boothDecor(c,0,0,p.decor,t);
    }else{
      drawText(c,"🏡",0,-50,"53px sans-serif");
    }
    // Headline and owner name
    R(c,-108,-104,216,38,14,"#fff9e9","#997961",3);
    drawText(c,shortText(p?.shopName||"等待新店長",12),0,-85,"900 19px 'Noto Sans TC'","#795447");
    R(c,-76,-165,152,25,11,p?.ready?"#dff3d7":"#fff0d7","#dbc9ae",2);
    drawText(c,p?(p.ready?"🔒 已鎖定":"🛠 佈置中"):"空攤位",0,-153,"900 13px 'Noto Sans TC'","#786e59");
    if(p&&room?.phase==="market"){
      R(c,-61,66,122,29,14,"#fff9e6","#d3b99d",2);
      drawText(c,"淨利 🪙 "+fmtMoney(p.profit),0,81,"900 14px 'Noto Sans TC'","#94674f");
    }
    c.restore();
  }
  function npcXY(n,now){
    const age=Math.max(0,now-n.enterAt);
    const points=n.path||[];
    if(!points.length)return{x:520,y:666};
    const finish=points[points.length-1];
    if(n.stage!=="wandering"&&now>=n.decideAt){
      const k=Math.min(1,Math.max(0,(now-n.decideAt)/4700));
      if(k<.46)return{x:finish.x+(520-finish.x)*(k/.46),y:finish.y+(343-finish.y)*(k/.46)};
      return{x:520,y:343+(666-343)*((k-.46)/.54)};
    }
    if(age>=finish.t)return{x:finish.x,y:finish.y};
    for(let i=1;i<points.length;i++){
      if(age<=points[i].t){
        const a=points[i-1],b=points[i],t=(age-a.t)/(b.t-a.t);
        const smooth=t*t*(3-2*t);
        return {x:a.x+(b.x-a.x)*smooth,y:a.y+(b.y-a.y)*smooth};
      }
    }
    return{x:finish.x,y:finish.y};
  }
  function npcSprite(c,n,x,y,t){
    const bounce=Math.sin(t/195+(n.id.charCodeAt(0)%7))*.8;
    c.save();c.translate(x,y+bounce);
    c.fillStyle="#65815d48";c.beginPath();c.ellipse(0,13,17,6,0,0,7);c.fill();
    const fill=n.color||"#f5dac8",outline="#786154";
    // Rounded body
    R(c,-11,-3,22,20,11,fill,outline,2);
    // Ears or horns
    if(n.kind==="rabbit"){
      R(c,-13,-35,10,25,8,fill,outline,2);R(c,3,-35,10,25,8,fill,outline,2);
      R(c,-9,-31,4,17,5,"#f3b3bc");R(c,7,-31,4,17,5,"#f3b3bc");
    }else if(n.kind==="fox"){
      poly(c,[[-16,-15],[-17,-36],[-2,-23]],fill,outline,2);
      poly(c,[[16,-15],[17,-36],[2,-23]],fill,outline,2);
    }else if(n.kind==="cat"){
      poly(c,[[-14,-11],[-17,-32],[-2,-24]],fill,outline,2);
      poly(c,[[14,-11],[17,-32],[2,-24]],fill,outline,2);
    }else if(n.kind==="deer"){
      R(c,-15,-34,3,20,3,"#b78965");R(c,10,-34,3,20,3,"#b78965");
      R(c,-22,-28,14,3,2,"#b78965");R(c,8,-28,14,3,2,"#b78965");
    }else{
      circle(c,-12,-22,9,fill,outline,2);circle(c,12,-22,9,fill,outline,2);
    }
    circle(c,0,-16,18,fill,outline,2);
    circle(c,-6,-18,2.3,"#4d433e");circle(c,6,-18,2.3,"#4d433e");
    circle(c,-11,-12,3.5,"#edaaa8");circle(c,11,-12,3.5,"#edaaa8");
    circle(c,0,-12,2,"#926a68");
    c.restore();
  }
  function drawNpcBubble(c,n,x,y,t){
    const arriving=n.stage==="wandering"&&localTime()<n.decideAt;
    const word=npcLines[n.id]||(arriving?"在逛攤比價…":n.bought?"買到喜歡的飲料！":"下次再來看看！");
    R(c,x-66,y-77,132,28,13,"#fffef3","#be9b82",2);
    drawText(c,shortText(word,11),x,y-63,"900 11px 'Noto Sans TC'","#835a53");
    poly(c,[[x-8,y-49],[x+7,y-49],[x,y-43]],"#fffef3");
  }
  function paint(){
    const canvas=$("fairCanvas");
    if(!canvas||!room)return;
    const c=canvas.getContext("2d");
    if(!c)return;
    const now=room.paused?room.serverNow||localTime():localTime();
    c.clearRect(0,0,1040,680);
    background(c,now);
    for(let i=0;i<4;i++)shop(c,room.players[i]||null,i,now);
    const npcs=room.npcs||[];
    const focus=npcs.find(x=>x.id===selectedNpcId);
    if(focus){
      const paths=focus.path||[];
      c.save();c.beginPath();c.strokeStyle="#ec8d9c";c.lineWidth=5;c.setLineDash([10,9]);
      paths.forEach((pt,i)=>{if(i===0)c.moveTo(pt.x,pt.y);else c.lineTo(pt.x,pt.y);});c.stroke();c.restore();
    }
    npcs.forEach((n,i)=>{
      const p=npcXY(n,now),dx=((n.id.charCodeAt(0)%7)-3)*3;
      npcSprite(c,n,p.x+dx,p.y,now);
      if(n.id===selectedNpcId){circle(c,p.x+dx,p.y-4,30,null,"#ff718d",4);}
      if(i>=Math.max(0,npcs.length-4)||n.stage!=="wandering")drawNpcBubble(c,n,p.x+dx,p.y,now);
    });
    if(room.phase==="finished"){
      R(c,280,280,485,120,26,"#fffaf0e9","#cda880",5);
      drawText(c,"🏆 魔法園遊會圓滿落幕！",522,324,"900 31px 'Noto Sans TC'","#95634f");
      drawText(c,"點選攤位，查看今天的明星商品",522,374,"800 19px 'Noto Sans TC'","#96765f");
    }
    if(room.phase==="setup"&&isTeacher()){
      R(c,345,285,353,65,18,"#fff9e9d9","#d9b997",3);
      drawText(c,"🌷 等待店長鎖定攤位",520,317,"900 24px 'Noto Sans TC'","#956d58");
    }
  }
  function loop(t){
    if(animationActive&&t-previousFrame>=33){
      previousFrame=t;paint();
    }
    requestAnimationFrame(loop);
  }
  document.addEventListener("click",e=>{
    if(e.target.id!=="fairCanvas")return;
    if(!room)return;
    const rect=e.target.getBoundingClientRect();
    const x=(e.clientX-rect.left)*1040/rect.width;
    const y=(e.clientY-rect.top)*680/rect.height;
    const hitNpc=(room.npcs||[]).find(n=>{
      const p=npcXY(n,room.paused?(room.serverNow||localTime()):localTime());
      return Math.hypot(p.x-x,p.y-y)<34;
    });
    if(hitNpc){
      selectedNpcId=hitNpc.id;
      if($("npcComparison"))$("npcComparison").innerHTML=compareNpc();
      toast("正在查看 "+hitNpc.name+" 的比較評分");
      return;
    }
    const index=shopPos.findIndex(p=>Math.abs(p.x-x)<166&&Math.abs((p.y-70)-y)<165);
    if(index>=0&&room.players[index]){
      selection=index;
      if($("boothDetails"))$("boothDetails").innerHTML=selectedBoothCard();
      toast("正在查看 "+room.players[index].shopName);
    }
  });
  document.addEventListener("visibilitychange",()=>{animationActive=!document.hidden;});
  requestAnimationFrame(loop);
  drawLanding();
})();
