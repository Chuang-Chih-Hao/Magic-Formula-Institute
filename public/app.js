"use strict";

(function () {
  const socket = io();
  const root = document.getElementById("app");
  const toastEl = document.getElementById("toast");
  const STORAGE = "mfi-session-v1";
  const THEMES = {
    strawberry: { name: "草莓奶油屋", emoji: "🍓" },
    lavender: { name: "紫藤花茶屋", emoji: "💜" },
    mint: { name: "森林甜點屋", emoji: "🍀" },
    peach: { name: "蜜桃小木屋", emoji: "🍑" }
  };
  const UPGRADES = [
    { id: "flowers", emoji: "🌷", name: "迎賓花圃", cost: 40, perk: "心動率 +3%" },
    { id: "lanterns", emoji: "✨", name: "星光燈串", cost: 70, perk: "心動率 +5%" },
    { id: "seats", emoji: "🪑", name: "甜點座位", cost: 100, perk: "心動率 +8%" }
  ];
  let role = null;
  let room = null;
  let me = null;
  let selected = "mystery";
  let pendingQuestTarget = null;
  let activeVisit = null;
  let builtScreen = "";
  let toastTimeout = null;
  let connectionLost = false;

  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const byId = (id) => document.getElementById(id);
  const setHtml = (id, html) => { const e = byId(id); if (e) e.innerHTML = html; };
  const setText = (id, text) => { const e = byId(id); if (e) e.textContent = text; };
  const money = (n) => "🪙 " + (Number(n) || 0);
  const clockText = (s) => String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  const available = () => room && room.phase === "playing" && !room.paused;
  const getRecipe = (id) => room && room.recipes.find((r) => r.id === id);
  const topbarLogo = () => '<div class="logo"><span class="logo-mark">🧪</span><div><div class="logo-title">魔法配方研究所</div><div class="logo-sub">MAGIC FORMULA INSTITUTE</div></div></div>';

  function toast(message, error) {
    toastEl.textContent = message;
    toastEl.className = "toast show" + (error ? " error" : "");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toastEl.className = "toast", 3300);
  }

  function send(event, data, done) {
    socket.timeout(8000).emit(event, data || {}, (err, result) => {
      if (err || !result || !result.ok) {
        toast(err ? "連線逾時，請確認網路後重試。" : (result && result.error) || "操作失敗", true);
        return;
      }
      if (done) done(result);
    });
  }

  function sceneMarkup(preview) {
    const theme = preview ? "strawberry" : (me && me.theme) || "strawberry";
    const name = preview ? "草莓夢幻屋" : (me && me.shopName) || "小小魔法屋";
    const face = preview ? "🐰" : (activeVisit && activeVisit.emoji) || "🐰";
    const customer = preview ? "兔兔米米" : (activeVisit && activeVisit.customer) || "歡迎光臨";
    const words = preview ? "好想喝一杯魔法飲料！" : (activeVisit && activeVisit.text) || "今天也來調配幸福吧！";
    return '<div class="market-scene">'
      + '<div class="scene-sun"></div><div class="scene-cloud"></div><div class="scene-cloud cloud-two"></div>'
      + '<div class="scene-sparkles"><span>✦</span><span>✧</span><span>✦</span></div>'
      + '<div class="scene-path"></div>'
      + '<div class="shop-building ' + esc(theme) + '" id="' + (preview ? "previewShop" : "sceneShop") + '">'
      + '<div class="shop-roof"></div><div class="shop-sign" id="' + (preview ? "previewSign" : "sceneSign") + '">' + esc(name) + '</div>'
      + '<div class="shop-wall"></div><div class="shop-awning"></div><div class="shop-window"></div>'
      + '<div class="shop-shelf" id="' + (preview ? "previewShelf" : "sceneShelf") + '"><span class="potion berry"></span><span class="potion forest"></span><span class="potion moon"></span></div>'
      + '<div class="shop-counter"></div></div>'
      + '<div class="scene-decor" id="' + (preview ? "previewDecor" : "sceneDecor") + '"></div>'
      + '<div class="npc-speech" id="' + (preview ? "previewSpeech" : "sceneSpeech") + '">' + esc(words) + '</div>'
      + '<div class="npc-character"><span class="npc-emoji" id="' + (preview ? "previewNpc" : "sceneNpc") + '">' + esc(face) + '</span><span class="npc-name" id="' + (preview ? "previewNpcName" : "sceneNpcName") + '">' + esc(customer) + '</span></div>'
      + '<span class="scene-flower one">🌼</span><span class="scene-flower two">🌸</span><span class="scene-flower three">✿</span>'
      + '</div>';
  }

  function showLanding() {
    builtScreen = "landing";
    root.innerHTML = '<main class="welcome">'
      + '<header class="welcome-head">' + topbarLogo() + '<span class="pill">🌼 小六數學 × 魔法開店</span></header>'
      + '<div class="welcome-grid"><section class="welcome-showcase">'
      + '<div class="eyebrow">WELCOME TO MAGIC VILLAGE</div>'
      + '<h1 class="welcome-title">用一點比例魔法，<br><span>開出最受歡迎的店！</span></h1>'
      + '<p class="welcome-copy">破解比與比值的祕密，收集魔法配方、研發新飲料、自己訂價。小動物們會來逛街——誰能成為魔法小鎮最會經營的店長？</p>'
      + '<div class="tags"><span class="tag">🍓 夢幻飲料店</span><span class="tag">🐰 動物顧客</span><span class="tag">🏆 4 人經營賽</span></div>'
      + '<div class="welcome-art">' + sceneMarkup(true) + '</div></section>'
      + '<section class="welcome-form">'
      + '<div class="card"><div class="section-head"><div class="panel-title"><span class="icon-badge">🎓</span> 老師開設教室</div></div>'
      + '<p class="muted">建立一間專屬魔法教室，分享六位數房間代碼給學生。</p>'
      + '<div class="form-stack"><button class="btn btn-primary" data-action="create-room">✨ 建立新的魔法教室</button></div>'
      + '<p class="note">教師不佔玩家名額，最多四位學生加入；可控制開始、暫停與結束。</p></div>'
      + '<div class="card"><div class="section-head"><div class="panel-title"><span class="icon-badge">🧙</span> 學生加入小鎮</div></div>'
      + '<div class="form-stack">'
      + '<div><label for="joinCode">魔法教室代碼</label><input id="joinCode" placeholder="輸入 6 位數代碼" maxlength="6" inputmode="numeric" autocomplete="off"></div>'
      + '<div><label for="joinName">你的魔法師暱稱</label><input id="joinName" placeholder="例如：草莓魔法師" maxlength="12" autocomplete="off"></div>'
      + '<button class="btn btn-green" data-action="join-room">🌷 加入並開設我的店鋪</button></div>'
      + '<p class="note">一位學生使用一台裝置。重新整理後可回到自己的店鋪，前提是伺服器仍在運作。</p></div>'
      + '</section></div>'
      + '<section class="rules-strip">'
      + '<div class="rule"><span class="rule-emoji">📖</span>解答數學題<small>取得魔法配方</small></div>'
      + '<div class="rule"><span class="rule-emoji">🧪</span>調製飲料<small>比例越準越好喝</small></div>'
      + '<div class="rule"><span class="rule-emoji">🐻</span>迎接 NPC<small>品質與價格都重要</small></div>'
      + '<div class="rule"><span class="rule-emoji">🏆</span>比拚淨利<small>營收 − 成本</small></div>'
      + '</section></main>';
  }

  function session(save) {
    try { localStorage.setItem(STORAGE, JSON.stringify(save)); } catch (_) { /* private mode */ }
  }
  function readSession() {
    try { return JSON.parse(localStorage.getItem(STORAGE) || "null"); } catch (_) { return null; }
  }
  function clearSession() {
    try { localStorage.removeItem(STORAGE); } catch (_) { /* private mode */ }
  }
  function becomeHost(data) {
    role = "host";
    session({ role, code: data.code, secret: data.secret });
    render();
    toast("魔法教室已建立！分享房間代碼給學生。");
  }
  function becomePlayer(data, name) {
    role = "player";
    session({ role, code: data.code, token: data.token, name: name || "小魔法師" });
    render();
    toast("歡迎來到魔法小鎮！");
  }
  function leave() {
    clearSession();
    role = null; room = null; me = null; activeVisit = null;
    selected = "mystery"; pendingQuestTarget = null; builtScreen = "";
    socket.disconnect();
    socket.connect();
    showLanding();
  }

  function sharedTopbar() {
    return '<div class="topbar">' + topbarLogo()
      + '<div class="top-stats">'
      + '<div class="top-stat">🏠 <span><span class="top-caption">教室代碼</span><b class="code-button" data-action="copy-code">' + esc(room.code) + '</b></span></div>'
      + '<div class="top-stat">⏳ <span><span class="top-caption">剩餘時間</span><b id="countdown">' + clockText(room.remaining) + '</b></span></div>'
      + '<div class="top-stat"><span id="phaseTag">' + phaseLabel() + '</span></div>'
      + '<button class="btn btn-secondary btn-mini" data-action="leave">離開</button>'
      + '</div></div>';
  }
  function phaseLabel() {
    if (!room) return "";
    if (room.phase === "lobby") return "🌷 等待開店";
    if (room.phase === "finished") return "🏆 今日結算";
    return room.paused ? "⏸️ 暫停營業" : "✨ 營業中";
  }

  function village() {
    const people = room.players;
    const rendered = people.map((p) => {
      const theme = THEMES[p.theme] || THEMES.strawberry;
      return '<div class="shop-chip ' + ((me && p.id === me.id) ? 'mine' : '') + '">'
        + '<span class="chip-emoji">' + theme.emoji + '</span><div class="chip-info">'
        + '<div class="chip-name">' + esc(p.shopName) + '<span class="online-dot ' + (p.online ? '' : 'offline') + '"></span></div>'
        + '<div class="chip-money">' + esc(p.name) + ' · 淨利 ' + money(p.profit) + '</div>'
        + '</div></div>';
    });
    for (let i = people.length; i < 4; i++) rendered.push('<div class="village-slot">🏡 等待新店長加入</div>');
    return rendered.join("");
  }

  function ranking() {
    const people = room.players.slice().sort((a, b) => b.profit - a.profit || b.revenue - a.revenue);
    if (!people.length) return '<div class="empty-state"><span class="empty-emoji">🐣</span>學生加入後就會出現在這裡。</div>';
    const medals = ["🥇", "🥈", "🥉", "4"];
    return '<table class="ranking"><thead><tr><th>排名</th><th>魔法店鋪</th><th>營收</th><th>成本</th><th>淨利</th></tr></thead><tbody>'
      + people.map((p, i) => '<tr class="' + (me && me.id === p.id ? 'highlight' : '') + '"><td class="rank">' + medals[i] + '</td><td><strong>' + esc(p.shopName) + '</strong><br><small>' + esc(p.name) + '</small></td><td>' + p.revenue + '</td><td>' + p.expense + '</td><td><strong>' + p.profit + '</strong></td></tr>').join("")
      + '</tbody></table>';
  }

  function finishBanner() {
    if (room.phase !== "finished") return "";
    const sorted = room.players.slice().sort((a, b) => b.profit - a.profit || b.revenue - a.revenue);
    const top = sorted[0];
    return '<div class="finish-banner"><div class="trophy">🏆</div><h2>今日魔法小鎮結算完成！</h2>'
      + '<p>本日最會經營的店鋪：<strong>' + (top ? esc(top.shopName) : "尚無學生") + '</strong></p>'
      + '<p class="muted">算算看：淨利 = 營收 − 製作成本。下一次換種配方與價格會不會更好？</p></div>';
  }

  function renderHost() {
    builtScreen = "host";
    const playing = room.phase === "playing";
    root.innerHTML = '<main class="shell">' + sharedTopbar()
      + '<div id="hostFinish">' + finishBanner() + '</div>'
      + '<section class="host-grid"><div class="panel host-panel">'
      + '<div class="section-head"><h2>🎓 教師控制中心</h2><span class="pill pill-green">教室已建立</span></div>'
      + '<span class="host-hero">🏡</span>'
      + '<p style="text-align:center;color:#8a7260;font-weight:800">讓學生輸入下方代碼，開始今天的魔法開店競賽。</p>'
      + '<div style="text-align:center;margin:10px 0"><span class="big-room-code">' + esc(room.code) + '</span></div>'
      + '<button class="btn btn-secondary" style="width:100%" data-action="copy-code">📋 複製房間代碼</button>'
      + '<div class="host-select"><label class="field-label" for="durationChoice">遊戲時間</label>'
      + '<select id="durationChoice" ' + (room.phase !== "lobby" ? "disabled" : "") + '>'
      + [20, 25, 30, 35, 40].map((n) => '<option value="' + n + '" ' + (n === room.duration / 60 ? 'selected' : '') + '>' + n + ' 分鐘</option>').join("")
      + '</select></div>'
      + '<div class="host-tools">'
      + (room.phase === "lobby" ? '<button class="btn btn-primary" data-action="start" ' + (!room.players.length ? "disabled" : "") + '>▶ 開始魔法營業</button>'
        : playing ? '<button class="btn btn-secondary" data-action="' + (room.paused ? "resume" : "pause") + '">' + (room.paused ? "▶ 繼續" : "⏸ 暫停") + '</button><button class="btn btn-dark" data-action="finish">🏁 提前結算</button>'
        : '<button class="btn btn-green" data-action="reset">🔄 再玩一場</button>')
      + '</div><p class="note">只要有一位學生加入就能開始，不必等滿四位。教室與成績暫存在伺服器記憶體中，服務重啟後會清除。</p>'
      + '</div><div class="panel host-panel"><div class="section-head"><h2>🐰 今日店長名單</h2><span class="pill">' + room.players.length + ' / 4 位學生</span></div>'
      + '<div class="kids-summary">' + room.players.map((p) => '<div class="kid-row"><span class="emoji">' + (THEMES[p.theme] || THEMES.strawberry).emoji + '</span><div><strong>' + esc(p.name) + ' · ' + esc(p.shopName) + '</strong><small>' + (p.online ? "🟢 已連線" : "⚪ 暫時離線") + ' · 解答 ' + p.correct + ' 題 · 售出 ' + p.sales + ' 杯</small></div></div>').join("")
      + (room.players.length === 0 ? '<div class="empty-state"><span class="empty-emoji">🌷</span>目前還沒有學生加入，請分享教室代碼。</div>' : "")
      + '</div><h2 style="margin-top:24px">🏆 即時獲利排行榜</h2><div>' + ranking() + '</div>'
      + '<p class="guide-note">營收 − 成本 = 淨利。負數表示目前投入的成本尚未回收。</p>'
      + '</div></section></main>';
  }

  function studentSkeleton() {
    builtScreen = "student";
    root.innerHTML = '<main class="shell' + (room.phase === "finished" ? " finished-game" : "") + '">'
      + sharedTopbar()
      + '<div id="finishZone">' + finishBanner() + '</div>'
      + '<section class="village-row" id="village"></section>'
      + '<section class="main-layout">'
      + '<aside class="panel book"><div class="panel-title"><span class="bubble">📖</span> 魔法配方圖鑑</div>'
      + '<div class="guide-note">答對比、比值與比例題，解鎖專屬配方！可重複練習，答對還能獲得金幣。</div>'
      + '<div id="bookProgress" class="progress-pills"></div><div id="quizZone"></div>'
      + '<div class="recipe-list" id="recipeList"></div>'
      + '<div class="recipe-focus" id="selectedInfo"></div>'
      + '<button class="btn btn-secondary" style="width:100%" data-action="bonus" id="bonusBtn">✨ 加碼比例挑戰（答對 +18）</button>'
      + '</aside>'
      + '<section class="panel stage-panel">'
      + '<div class="stage-header"><div><h2>🏠 我的魔法店鋪</h2><p class="scene-caption">讓可愛的動物顧客愛上你的魔法飲料</p></div><span class="pill pill-pink" id="playerName"></span></div>'
      + '<div class="field-grid" style="margin-bottom:12px"><div><label class="field-label" for="shopName">幫店鋪取名字</label><input id="shopName" maxlength="14" placeholder="我的魔法屋"></div>'
      + '<div><label class="field-label" for="shopTheme">裝飾風格</label><select id="shopTheme">'
      + Object.keys(THEMES).map((key) => '<option value="' + key + '">' + THEMES[key].emoji + ' ' + THEMES[key].name + '</option>').join("")
      + '</select></div></div>'
      + '<button class="btn btn-secondary btn-mini" data-action="save-shop" style="margin-bottom:12px">🎀 儲存我的店鋪裝潢</button>'
      + sceneMarkup(false)
      + '<div class="upgrade-section"><h3>🎀 讓店鋪更受歡迎</h3><p class="scene-caption">用金幣裝飾小店，增加 NPC 顧客購買的機率</p><div id="upgradesZone" class="upgrade-list"></div></div>'
      + '<div class="scene-bottom"><div class="score-tile"><strong id="myCoins">150</strong><small>🪙 手上金幣</small></div>'
      + '<div class="score-tile"><strong id="myProfit">0</strong><small>📈 目前淨利</small></div>'
      + '<div class="score-tile"><strong id="mySales">0</strong><small>🧋 已賣杯數</small></div></div>'
      + '<div class="section-head" style="margin-top:18px"><h3>🐾 最近來訪的客人</h3><span class="pill">自動選購</span></div>'
      + '<div class="visit-feed" id="visitFeed"></div>'
      + '</section>'
      + '<aside class="panel workbench"><div class="panel-title"><span class="bubble">🧪</span> 調飲魔法工作檯</div>'
      + '<div class="workbench-inner"><div><div class="guide-note">先選擇左側配方，再依照材料的「比」加入正確匙數。每鍋製作 3 杯。</div>'
      + '<div id="mixTarget" class="pill pill-pink">🧪 神秘實驗</div>'
      + '<div class="ingredients">'
      + '<div class="ingredient"><span class="jar">🌸</span><label for="mixFlower">花露</label><input type="number" min="1" max="12" step="1" value="2" id="mixFlower"></div>'
      + '<div class="ingredient"><span class="jar">🍬</span><label for="mixSugar">星糖</label><input type="number" min="1" max="12" step="1" value="2" id="mixSugar"></div>'
      + '<div class="ingredient"><span class="jar">💧</span><label for="mixWater">月光水</label><input type="number" min="1" max="12" step="1" value="2" id="mixWater"></div>'
      + '</div><div><label class="field-label" for="sellPrice">每杯要賣多少金幣？（10～80）</label><input type="number" id="sellPrice" min="10" max="80" step="1" value="30"></div>'
      + '<button class="btn btn-primary brew-cta" data-action="brew" id="brewBtn">🫧 調製 3 杯魔法飲料！</button>'
      + '<div class="cost-preview" id="costPreview">本鍋製作成本 18 金幣</div></div>'
      + '<div><div class="section-head"><h3>🧋 我的商品展示架</h3><span class="pill" id="stockCount">0 / 8 鍋</span></div>'
      + '<div id="stockList" class="stock-list"></div>'
      + '<div class="tips-list"><p>💡 <strong>比例：</strong>同一張配方的三種材料必須一起等倍放大或縮小，品質才會好。</p>'
      + '<p>💰 <strong>訂價：</strong>貴一點單杯賺更多，但可能超過客人的預算。</p>'
      + '<p>🐰 <strong>NPC：</strong>大約每 11 秒就會來一位客人，自行決定是否購買。</p></div></div></div>'
      + '</aside></section></main>';
    const shopInput = byId("shopName"), themeInput = byId("shopTheme");
    if (me) { shopInput.value = me.shopName; themeInput.value = me.theme; }
    updateCosts();
  }

  function recipeList() {
    if (!room || !me) return "";
    const locked = (id) => !me.unlocked.includes(id);
    return room.recipes.map((r) => {
      const isLocked = locked(r.id);
      const active = selected === r.id;
      return '<button class="recipe-card ' + (isLocked ? "locked" : "") + (active ? " selected" : "") + '" data-action="' + (isLocked ? "question" : "select-recipe") + '" data-id="' + r.id + '" ' + (!available() ? "disabled" : "") + '>'
        + '<span class="recipe-icon">' + (isLocked ? "🔒" : r.emoji) + '</span>'
        + '<span class="recipe-body"><strong>' + esc(r.name) + '</strong>'
        + '<span class="recipe-desc">' + (isLocked ? "完成比例題才能取得" : esc(r.flavor + "系 · " + r.ratio.join("："))) + '</span></span>'
        + '<span class="recipe-lock">' + (isLocked ? "解題 +" : active ? "使用中" : "調製") + '</span></button>';
    }).join("")
      + '<button class="recipe-card mystery-recipe ' + (selected === "mystery" ? "selected" : "") + '" data-action="select-recipe" data-id="mystery" ' + (!available() ? "disabled" : "") + '>'
      + '<span class="recipe-icon">🎲</span><span class="recipe-body"><strong>神秘自由調配</strong><span class="recipe-desc">不用解鎖，但品質容易失控！</span></span><span class="recipe-lock">實驗</span></button>';
  }

  function upgradesHtml() {
    if (!me) return "";
    return UPGRADES.map((u) => {
      const owned = (me.upgrades || []).includes(u.id);
      return '<button class="upgrade-item ' + (owned ? "owned" : "") + '" data-action="upgrade" data-id="' + u.id + '" ' + (owned || !available() || me.coins < u.cost ? "disabled" : "") + '>'
        + '<span class="upgrade-emoji">' + u.emoji + '</span><span class="upgrade-name">' + esc(u.name) + '<small>' + u.perk + '</small></span>'
        + '<span class="upgrade-cost">' + (owned ? "✓ 已購買" : "🪙" + u.cost) + '</span></button>';
    }).join("");
  }

  function selectedInfo() {
    if (selected === "mystery") return '<h3>🧪 神秘自由調配</h3><p class="muted">沒有固定的配方提示，可以自己試出新比例。但魔法不穩定，顧客可能不喜歡。</p>';
    const r = getRecipe(selected);
    return r ? '<h3>' + r.emoji + ' ' + esc(r.name) + '</h3><div class="big-ratio">' + r.ratio.join("：") + '</div>'
      + '<p class="muted">花露：星糖：月光水</p><p>' + esc(r.story) + '</p><small>例：' + r.ratio.join("、") + ' 匙，或一起乘 2。</small>' : "";
  }

  function quizHtml() {
    if (!me) return "";
    const q = me.quest;
    const result = me.lastResult;
    let out = "";
    if (result && !result.brew) {
      out += '<div class="result-feedback ' + (result.correct ? "" : "wrong") + '">'
        + '<strong>' + (result.correct ? "🌟 答對了！" : "📚 再練習一次！") + '</strong> '
        + (result.correct ? ("獲得 " + result.reward + " 金幣！" + (result.unlockedName ? " 已解鎖「" + esc(result.unlockedName) + "」！" : "")) : "正確答案是「" + esc(result.answer) + "」。")
        + '<br>' + esc(result.explanation) + '</div>';
    }
    if (q) out += '<div class="quiz-box"><div class="quiz-skill">✏️ ' + esc(q.skill) + ' 挑戰</div><div class="quiz-prompt">' + esc(q.prompt) + '</div>'
      + '<div class="quiz-options">' + q.choices.map((c, i) => '<button class="quiz-answer" data-action="answer" data-index="' + i + '">' + esc(c) + '</button>').join("") + '</div>'
      + '<p class="note">答題沒有倒扣，想想每個量要乘或除以同一個數。</p></div>';
    if (result && result.brew) out += '<div class="result-feedback ' + (result.quality < 60 ? "wrong" : "") + '"><strong>🫧 本次品質 ' + result.quality + ' / 100</strong><br>' + esc(result.message) + '</div>';
    return out;
  }

  function stockHtml() {
    if (!me || !me.stock.length) return '<div class="empty-state"><span class="empty-emoji">🫙</span>展示架目前空空的。<br>快來調製第一鍋吧！</div>';
    return me.stock.slice().reverse().map((s) => '<div class="stock-row"><span class="stock-emoji">' + esc(s.emoji) + '</span><div class="stock-info"><strong>' + esc(s.name) + '</strong><small>品質 ' + s.quality + ' 分 · 剩 ' + s.servings + ' 杯</small></div>'
      + '<div class="price-tool"><button class="btn btn-mini btn-secondary" data-action="price" data-id="' + s.id + '" data-change="-5" ' + (!available() ? "disabled" : "") + '>−</button>'
      + '<span>' + s.price + '</span><button class="btn btn-mini btn-secondary" data-action="price" data-id="' + s.id + '" data-change="5" ' + (!available() ? "disabled" : "") + '>+</button></div></div>').join("");
  }

  function visitsHtml() {
    const all = me && me.visits;
    if (!all || !all.length) return '<div class="empty-state" style="padding:13px"><span class="empty-emoji">🐾</span>開店後，第一位客人就會來敲門！</div>';
    return all.slice(0, 4).map((v) => '<div class="visit-item ' + (v.bought ? "sold" : "") + '"><span class="face">' + esc(v.emoji) + '</span><div><strong>' + esc(v.customer) + (v.bought ? " · 買了 " + esc(v.itemName) + " (+" + v.paid + ")" : " · 沒有購買") + '</strong><span>' + esc(v.text) + '</span></div></div>').join("");
  }

  function updateStudent() {
    if (!room || !me) return;
    if (selected !== "mystery" && !me.unlocked.includes(selected)) selected = "mystery";
    setHtml("village", village());
    setHtml("recipeList", recipeList());
    setHtml("selectedInfo", selectedInfo());
    setHtml("quizZone", quizHtml());
    setHtml("stockList", stockHtml());
    setHtml("upgradesZone", upgradesHtml());
    setHtml("sceneDecor", (me.upgrades || []).map((id) => {
      const upgrade = UPGRADES.find((u) => u.id === id);
      return upgrade ? '<span class="decor decor-' + id + '">' + upgrade.emoji + "</span>" : "";
    }).join(""));
    setHtml("visitFeed", visitsHtml());
    setHtml("bookProgress", '<span class="pill pill-green">🔓 已解鎖 ' + me.unlocked.length + ' / ' + room.recipes.length + ' 張</span><span class="pill">✅ 答對 ' + me.correct + ' 題</span>');
    setText("myCoins", me.coins);
    setText("myProfit", me.profit);
    setText("mySales", me.sales);
    setText("playerName", "✨ " + me.name);
    setText("stockCount", me.stock.length + " / 8 鍋");
    setText("sceneSign", me.shopName);
    const shop = byId("sceneShop");
    if (shop) shop.className = "shop-building " + me.theme;
    const potions = me.stock.slice(0, 4);
    setHtml("sceneShelf", potions.length ? potions.map((s) => '<span class="potion ' + esc(s.color) + '"></span>').join("") : '<span class="potion berry"></span><span class="potion forest"></span><span class="potion moon"></span>');
    if (activeVisit || me.visits.length) {
      const v = activeVisit || me.visits[0];
      setText("sceneNpc", v.emoji);
      setText("sceneNpcName", v.customer);
      setText("sceneSpeech", v.text);
    }
    setText("mixTarget", selected === "mystery" ? "🎲 神秘自由調配" : (getRecipe(selected).emoji + " " + getRecipe(selected).name));
    const unlockedPlaying = available();
    const bonus = byId("bonusBtn"), brewBtn = byId("brewBtn");
    if (bonus) bonus.disabled = !unlockedPlaying;
    if (brewBtn) brewBtn.disabled = !unlockedPlaying;
    if (room.phase === "lobby") {
      setHtml("finishZone", '<div class="overlay-note">🌷 店鋪已經準備好了！先取好店名，等待老師按下「開始魔法營業」。</div>');
    } else if (room.phase === "finished") {
      setHtml("finishZone", finishBanner() + '<div class="panel" style="margin:12px 0"><h2>🏆 今日獲利名次</h2>' + ranking() + '</div>');
    } else if (room.paused) {
      setHtml("finishZone", '<div class="overlay-note">⏸ 老師已暫停營業，題目與交易會在繼續後開放。</div>');
    } else {
      setHtml("finishZone", "");
    }
    setText("countdown", clockText(room.remaining));
    setText("phaseTag", phaseLabel());
    updateCosts();
  }

  function render() {
    if (!room || !role) { if (builtScreen !== "landing") showLanding(); return; }
    if (role === "host") {
      renderHost();
    } else {
      if (builtScreen !== "student") studentSkeleton();
      updateStudent();
    }
  }

  function applyRecipe(id) {
    selected = id;
    if (id !== "mystery") {
      const r = getRecipe(id);
      if (r) {
        ["mixFlower", "mixSugar", "mixWater"].forEach((field, i) => { if (byId(field)) byId(field).value = r.ratio[i]; });
      }
    } else ["mixFlower", "mixSugar", "mixWater"].forEach((field) => { if (byId(field)) byId(field).value = 2; });
    updateCosts();
    updateStudent();
    toast(id === "mystery" ? "自由實驗開始！猜猜顧客喜歡什麼？" : "已帶入配方基本比例，也可以一起等倍放大。");
  }
  function mixValues() { return ["mixFlower", "mixSugar", "mixWater"].map((id) => Number(byId(id) && byId(id).value)); }
  function updateCosts() {
    if (!byId("costPreview")) return;
    const values = mixValues(), valid = values.every((n) => Number.isInteger(n) && n >= 1 && n <= 12);
    const total = values.reduce((a, b) => a + b, 0);
    setText("costPreview", valid && total <= 27 ? "本鍋成本 " + (6 + total * 2) + " 金幣 · 產出 3 杯 · 每杯成本約 " + ((6 + total * 2) / 3).toFixed(1) : "每種材料 1～12 匙；總和不超過 27 匙。");
  }

  document.addEventListener("click", (e) => {
    const target = e.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "create-room") return send("host:create", {}, becomeHost);
    if (action === "join-room") {
      const code = (byId("joinCode") && byId("joinCode").value || "").trim();
      const name = (byId("joinName") && byId("joinName").value || "").trim();
      if (!/^\d{6}$/.test(code)) return toast("請輸入 6 位數的教室代碼。", true);
      if (!name) return toast("請先替自己取個魔法師暱稱。", true);
      return send("player:join", { code, name }, (r) => becomePlayer(r, name));
    }
    if (action === "leave") return leave();
    if (action === "copy-code") {
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(room.code).then(() => toast("已複製教室代碼！")).catch(() => toast("教室代碼：" + room.code));
      else toast("教室代碼：" + room.code);
      return;
    }
    if (action === "start") return send("host:start", {}, () => toast("魔法小鎮正式開張！"));
    if (action === "pause") return send("host:pause", {});
    if (action === "resume") return send("host:resume", {});
    if (action === "finish") {
      if (confirm("確定要提前結束並結算所有店鋪成績嗎？")) send("host:finish", {});
      return;
    }
    if (action === "reset") {
      if (confirm("確定重新開局？所有玩家的成績與配方將歸零。")) send("host:reset", {}, () => toast("已恢復準備階段！"));
      return;
    }
    if (action === "save-shop") {
      const name = (byId("shopName") && byId("shopName").value || "").trim();
      const theme = byId("shopTheme").value;
      return send("shop:update", { name, theme }, () => toast("🎀 店鋪裝潢已儲存！"));
    }
    if (action === "question" || action === "bonus") {
      const targetId = action === "bonus" ? "bonus" : target.dataset.id;
      pendingQuestTarget = targetId;
      return send("quest:request", { targetId }, () => {
        const q = byId("quizZone"); if (q) q.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
    if (action === "answer") {
      const choiceIndex = Number(target.dataset.index);
      return send("quest:answer", { choiceIndex }, (r) => {
        if (r.correct && pendingQuestTarget && pendingQuestTarget !== "bonus") {
          const unlockedId = pendingQuestTarget;
          setTimeout(() => { if (me && me.unlocked.includes(unlockedId)) applyRecipe(unlockedId); }, 100);
        }
        pendingQuestTarget = null;
      });
    }
    if (action === "select-recipe") return applyRecipe(target.dataset.id);
    if (action === "upgrade") {
      return send("shop:upgrade", { upgradeId: target.dataset.id }, (r) => toast("🎀 已裝飾「" + r.name + "」！花費 " + r.cost + " 金幣。"));
    }
    if (action === "brew") {
      const mix = mixValues(), price = Number(byId("sellPrice").value);
      if (!mix.every((n) => Number.isInteger(n) && n >= 1 && n <= 12) || mix.reduce((a, b) => a + b, 0) > 27) return toast("材料必須為 1～12 匙的整數，而且總和不能超過 27 匙。", true);
      if (!Number.isInteger(price) || price < 10 || price > 80) return toast("請輸入 10～80 的整數售價。", true);
      return send("brew:create", { targetId: selected, mix, price }, (r) => toast("🫧 成功製作 3 杯！品質 " + r.quality + " 分，成本 " + r.cost + " 元。"));
    }
    if (action === "price") {
      const item = me && me.stock.find((s) => s.id === target.dataset.id);
      if (!item) return;
      return send("stock:price", { itemId: item.id, price: Math.min(80, Math.max(10, item.price + Number(target.dataset.change))) });
    }
  });

  document.addEventListener("change", (e) => {
    if (e.target.id === "durationChoice") send("host:duration", { minutes: Number(e.target.value) });
  });
  document.addEventListener("input", (e) => {
    if (["mixFlower", "mixSugar", "mixWater"].includes(e.target.id)) updateCosts();
    if (["joinCode", "joinName"].includes(e.target.id)) { /* Native form values retained. */ }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && ["joinCode", "joinName"].includes(e.target.id)) {
      const join = document.querySelector('[data-action="join-room"]');
      if (join) join.click();
    }
  });

  socket.on("room:state", (nextRoom) => {
    room = nextRoom;
    render();
  });
  socket.on("room:clock", (data) => {
    if (!room) return;
    room.remaining = data.remaining;
    room.phase = data.phase;
    room.paused = data.paused;
    setText("countdown", clockText(data.remaining));
    setText("phaseTag", phaseLabel());
    if (data.phase === "finished" && role) render();
  });
  socket.on("player:state", (nextMe) => {
    me = nextMe;
    if (!activeVisit && me.visits.length) activeVisit = me.visits[0];
    if (role === "player") render();
  });
  socket.on("npc:visit", (visit) => {
    activeVisit = visit;
    if (role === "player") {
      setText("sceneNpc", visit.emoji);
      setText("sceneNpcName", visit.customer);
      setText("sceneSpeech", visit.text);
      toast(visit.bought ? visit.emoji + " " + visit.customer + " 買了一杯！+" + visit.paid + " 金幣" : visit.emoji + " " + visit.customer + "：" + visit.text);
    }
  });
  socket.on("npc:dialogue", (data) => {
    if (activeVisit && activeVisit.id === data.visitId) {
      activeVisit.text = data.text;
      setText("sceneSpeech", data.text);
      if (me && me.visits.length && me.visits[0].id === data.visitId) me.visits[0].text = data.text;
      setHtml("visitFeed", visitsHtml());
    }
  });
  socket.on("host:replaced", () => { toast("教師帳號已在其他裝置登入。", true); leave(); });
  socket.on("player:replaced", () => { toast("學生已在其他裝置恢復連線。", true); leave(); });
  socket.on("disconnect", () => {
    connectionLost = true;
    if (role) toast("網路暫時中斷，正在嘗試重新連線……", true);
  });
  socket.on("connect", () => {
    if (connectionLost) { toast("網路已恢復，正在返回魔法教室。"); connectionLost = false; }
    const old = readSession();
    if (!old || !old.code) return;
    const event = old.role === "host" ? "host:rejoin" : "player:join";
    const payload = old.role === "host" ? { code: old.code, secret: old.secret } : { code: old.code, token: old.token, name: old.name };
    socket.timeout(8500).emit(event, payload, (err, data) => {
      if (err || !data || !data.ok) {
        clearSession();
        role = null; room = null; me = null; builtScreen = "";
        showLanding();
        toast("先前的房間已失效，請重新建立或加入。", true);
        return;
      }
      role = old.role;
      if (role === "host") session({ role, code: data.code, secret: data.secret });
      else session({ role, code: data.code, token: data.token, name: old.name });
      render();
    });
  });

  showLanding();
})();
