"use strict";

const express = require("express");
const http = require("node:http");
const crypto = require("node:crypto");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT || 3000);
const MAX_PLAYERS = 4;
const INGREDIENTS = ["花露", "星糖", "月光水"];
const THEMES = ["strawberry", "lavender", "mint", "peach"];
const UPGRADES = [
  { id: "flowers", name: "迎賓花圃", emoji: "🌷", cost: 40, boost: 0.03 },
  { id: "lanterns", name: "星光燈串", emoji: "✨", cost: 70, boost: 0.05 },
  { id: "seats", name: "甜點座位", emoji: "🪑", cost: 100, boost: 0.08 }
];

const RECIPES = [
  { id: "berry", name: "莓果初戀", emoji: "🍓", ratio: [2, 1, 1], flavor: "甜美", color: "berry", story: "酸酸甜甜的草莓雲朵，適合喜歡甜點的客人。" },
  { id: "moon", name: "月光蘇打", emoji: "🌙", ratio: [1, 2, 3], flavor: "清爽", color: "moon", story: "帶著月光氣泡的清爽飲品。" },
  { id: "forest", name: "森林薄荷", emoji: "🌿", ratio: [1, 1, 3], flavor: "清爽", color: "forest", story: "像走進雨後森林的沁涼香氣。" },
  { id: "peach", name: "蜜桃星星", emoji: "🍑", ratio: [3, 2, 1], flavor: "甜美", color: "peach", story: "香甜桃子與星星糖的閃亮組合。" },
  { id: "violet", name: "紫晶夢境", emoji: "🫐", ratio: [2, 3, 1], flavor: "夢幻", color: "violet", story: "色彩變幻的神祕紫色魔法。" },
  { id: "rainbow", name: "彩虹晨露", emoji: "🌈", ratio: [3, 1, 2], flavor: "夢幻", color: "rainbow", story: "層層繽紛、如彩虹般的祝福。" }
];

const CUSTOMERS = [
  { name: "兔兔米米", emoji: "🐰", favorite: "甜美", budget: 38, line: "我喜歡甜甜的味道！" },
  { name: "貓咪奶油", emoji: "🐱", favorite: "清爽", budget: 48, line: "想找一杯清爽的飲料～" },
  { name: "小熊布丁", emoji: "🐻", favorite: "甜美", budget: 55, line: "今天想犒賞自己！" },
  { name: "狐狸露露", emoji: "🦊", favorite: "夢幻", budget: 65, line: "有沒有漂亮的魔法特調？" },
  { name: "青蛙波波", emoji: "🐸", favorite: "清爽", budget: 31, line: "我只有一點點零用錢。" },
  { name: "小鹿花花", emoji: "🦌", favorite: "夢幻", budget: 72, line: "這間店聞起來好香呀。" },
  { name: "企鵝雪糕", emoji: "🐧", favorite: "甜美", budget: 43, line: "我從很遠的冰山來的！" },
  { name: "倉鼠麻糬", emoji: "🐹", favorite: "清爽", budget: 58, line: "快讓我看看今天的新品！" }
];

const rooms = new Map();
const clean = (v, max) => String(v == null ? "" : v).trim().replace(/[\u0000-\u001f<>]/g, "").slice(0, max);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const choose = (items) => items[rand(0, items.length - 1)];
const randomId = () => crypto.randomBytes(10).toString("hex");
const getRecipe = (id) => RECIPES.find((r) => r.id === id);
const batchCost = (mix) => 6 + mix.reduce((s, n) => s + n, 0) * 2;
const fmt = (n) => Number(n.toFixed(2)).toString();

function qualityFor(mix, ratio, mystery = false, noise = 0) {
  const total = mix.reduce((a, b) => a + b, 0);
  const targetTotal = ratio.reduce((a, b) => a + b, 0);
  const error = mix.reduce((sum, v, i) => sum + Math.abs(v / total - ratio[i] / targetTotal), 0);
  return clamp(Math.round(100 - 142 * error - (mystery ? 19 : 0) + noise), 8, mystery ? 81 : 100);
}

function purchaseChance(item, customer, popularityBoost = 0) {
  const affinity = item.flavor === customer.favorite ? 0.13 : 0;
  const affordability = (48 - item.price) * 0.007;
  return clamp(0.19 + (item.quality - 35) * 0.010 + affordability + affinity + popularityBoost, 0.04, 0.96);
}

function shuffleChoices(correct, other) {
  const distinct = [...new Set([correct, ...other].map(String))];
  let pad = 1;
  while (distinct.length < 4) {
    const proposal = Number.isFinite(Number(correct)) ? String(Number(correct) + pad * 3) : (pad + 1) + " 匙、" + (pad + 3) + " 匙";
    if (!distinct.includes(proposal)) distinct.push(proposal);
    pad++;
  }
  const options = distinct.slice(0, 4);
  for (let i = options.length - 1; i > 0; i--) {
    const j = rand(0, i);
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { choices: options, correctIndex: options.indexOf(String(correct)) };
}

function makeQuestion() {
  const type = rand(0, 5);
  let skill, prompt, correct, wrong, explanation;
  if (type === 0) {
    const examples = [[2, 3], [3, 4], [1, 3], [3, 5], [2, 5], [4, 5]];
    const [a, b] = choose(examples), k = rand(2, 6);
    skill = "化簡比";
    prompt = "花露與星糖的數量比是 " + (a * k) + "：" + (b * k) + "，最簡整數比是多少？";
    correct = a + "：" + b;
    wrong = [b + "：" + a, (a * k) + "：" + b, a + "：" + (b + 1)];
    explanation = "把兩個數同時除以 " + k + "，得到 " + a + "：" + b + "。";
  } else if (type === 1) {
    const a = rand(1, 4), b = choose([5, 10]), value = a / b;
    skill = "比值";
    prompt = "調製魔法水時，花露：月光水 = " + a + "：" + b + "，這個比的比值是多少？";
    correct = fmt(value);
    wrong = [fmt(b / a), fmt(value + 0.2), fmt(value + 0.4)];
    explanation = "比值＝前項 ÷ 後項，所以 " + a + " ÷ " + b + " = " + fmt(value) + "。";
  } else if (type === 2) {
    const a = rand(1, 4), b = rand(2, 5), k = rand(2, 5);
    skill = "等比應用";
    prompt = "一款飲料的花露：星糖 = " + a + "：" + b + "。若花露用 " + (a * k) + " 匙，星糖需要幾匙？";
    correct = b * k;
    wrong = [a * k, b * (k + 1), b * k + a + 1];
    explanation = "花露從 " + a + " 變成 " + a * k + "，放大 " + k + " 倍；星糖也要乘以 " + k + "，得到 " + b * k + " 匙。";
  } else if (type === 3) {
    const cups = rand(2, 4), each = rand(9, 17), target = cups + rand(2, 4);
    skill = "生活比例";
    prompt = "賣出 " + cups + " 杯飲料共收 " + (cups * each) + " 元。若每杯同價，賣出 " + target + " 杯可收多少元？";
    correct = target * each;
    wrong = [(target - 1) * each, target * each + cups, cups * each + target];
    explanation = "先算一杯 " + (cups * each) + " ÷ " + cups + " = " + each + " 元，再乘 " + target + " 杯，得到 " + target * each + " 元。";
  } else if (type === 4) {
    const a = rand(1, 3), b = a + rand(1, 3), k = rand(2, 5);
    skill = "比例式";
    prompt = "已知 " + a + "：" + b + " = □：" + (b * k) + "，□ 裡應填多少？";
    correct = a * k;
    wrong = [a + k, b * k, a * k + b];
    explanation = "後項從 " + b + " 變 " + b * k + "，乘了 " + k + "；前項也乘 " + k + "，得到 " + a * k + "。";
  } else {
    const r = choose(RECIPES);
    const k = rand(2, 4);
    skill = "三項比例";
    prompt = "配方花露：星糖：月光水＝" + r.ratio.join("：") + "。若花露加入 " + (r.ratio[0] * k) + " 匙，星糖和月光水各要幾匙？";
    correct = (r.ratio[1] * k) + " 匙、" + (r.ratio[2] * k) + " 匙";
    wrong = [
      (r.ratio[2] * k) + " 匙、" + (r.ratio[1] * k) + " 匙",
      r.ratio[1] + " 匙、" + r.ratio[2] + " 匙",
      (r.ratio[1] * k + 1) + " 匙、" + (r.ratio[2] * k + 1) + " 匙"
    ];
    explanation = "花露增加為原本的 " + k + " 倍，其他兩種材料也要同時乘 " + k + "，即 " + correct + "。";
  }
  const options = shuffleChoices(correct, wrong);
  return { id: randomId(), skill, prompt, choices: options.choices, correctIndex: options.correctIndex, explanation };
}

function newPlayer(name, token) {
  const id = randomId();
  return {
    id, token: token || randomId(), socketId: null,
    name: clean(name, 12) || "小魔法師",
    shopName: "小小魔法屋", theme: THEMES[rand(0, THEMES.length - 1)],
    coins: 150, revenue: 0, expense: 0, sales: 0, stars: 0,
    attempts: 0, correct: 0, unlocked: [],
    stock: [], upgrades: [], quest: null, visits: [], lastResult: null
  };
}

function playerPublic(p) {
  return {
    id: p.id, name: p.name, shopName: p.shopName, theme: p.theme,
    online: !!p.socketId, coins: p.coins, revenue: p.revenue,
    expense: p.expense, profit: p.revenue - p.expense,
    sales: p.sales, stars: p.stars, correct: p.correct, upgrades: p.upgrades
  };
}
function selfPublic(p) {
  return {
    ...playerPublic(p),
    unlocked: p.unlocked, stock: p.stock,
    attempts: p.attempts, visits: p.visits.slice(0, 8),
    quest: p.quest ? { id: p.quest.id, skill: p.quest.skill, prompt: p.quest.prompt, choices: p.quest.choices, targetId: p.quest.targetId } : null,
    lastResult: p.lastResult
  };
}
function roomPublic(r) {
  return {
    code: r.code, phase: r.phase, paused: r.paused, remaining: r.remaining,
    aiNpcMode: npcAiMode(),
    duration: r.duration, playerCount: r.players.length,
    hostOnline: !!r.hostId, players: r.players.map(playerPublic),
    recipes: RECIPES.map(({ id, name, emoji, ratio, flavor, color, story }) => ({ id, name, emoji, ratio, flavor, color, story }))
  };
}
function reply(cb, data) {
  if (typeof cb === "function") cb(data);
}
function updateRoom(io, r) {
  io.to(r.code).emit("room:state", roomPublic(r));
  for (const p of r.players) {
    if (p.socketId) io.to(p.socketId).emit("player:state", selfPublic(p));
  }
}
function makeRoom() {
  let code;
  do { code = String(rand(100000, 999999)); } while (rooms.has(code));
  const r = {
    code, secret: randomId() + randomId(), hostId: null,
    phase: "lobby", paused: false, duration: 30 * 60, remaining: 30 * 60,
    endsAt: 0, nextCustomerAt: 0, lastAIAt: 0,
    players: [], createdAt: Date.now(), lastActive: Date.now()
  };
  rooms.set(code, r);
  return r;
}

function customerVisit(io, room, p) {
  const customer = choose(CUSTOMERS);
  const budget = customer.budget + rand(-6, 7);
  const visiting = { ...customer, budget };
  const stock = p.stock.filter((s) => s.servings > 0);
  const viable = stock.filter((s) => s.price <= budget);
  const popularity = p.upgrades.reduce((n, id) => n + (UPGRADES.find((u) => u.id === id) || { boost: 0 }).boost, 0);
  const sorted = viable.map((s) => ({ item: s, chance: purchaseChance(s, visiting, popularity) }))
    .sort((a, b) => b.chance - a.chance);
  const selected = sorted[0];
  const bought = !!selected && Math.random() < selected.chance;
  let saying, itemName = null, paid = 0;
  if (bought) {
    const item = selected.item;
    paid = item.price;
    itemName = item.name;
    p.coins += paid;
    p.revenue += paid;
    p.sales++;
    if (item.quality >= 85) p.stars++;
    item.servings--;
    if (item.servings === 0) p.stock = p.stock.filter((s) => s.id !== item.id);
    saying = choose(["哇，這杯好香！下次還要來～", "太棒了，我要帶回家分享！", "價格和味道都很合我的心意！", "喝一口就覺得好幸福～"]);
  } else if (!stock.length) {
    saying = "咦，架上沒有飲料了？我下次再來。";
  } else if (!viable.length) {
    saying = "好想喝，可是今天的零用錢不夠……";
  } else if (selected.item.quality < 65) {
    saying = "這個味道有點怪怪的，我再逛逛。";
  } else {
    saying = choose(["我先看看其他店好了～", "這次先不買，下回見！", "還差一點點心動，再試試新配方吧！"]);
  }
  const visit = {
    id: randomId(), customer: customer.name, emoji: customer.emoji,
    favorite: customer.favorite, budget, bought, itemName, paid,
    text: saying, at: Date.now()
  };
  p.visits.unshift(visit);
  p.visits = p.visits.slice(0, 8);
  if (p.socketId) io.to(p.socketId).emit("npc:visit", visit);
  maybeAiDialogue(io, room, p, visit);
}

function npcAiMode(env = process.env) {
  // No key or explicitly disabled: ordinary NPC dialogue remains fully playable.
  return env.AI_NPC_ENABLED !== "false" && env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim()
    ? "gemini" : "local";
}

function geminiNpcRequest(visit, model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite") {
  // The model ID must be a model name, never an arbitrary URL.
  if (!/^gemini-[a-z0-9.-]+$/.test(model)) throw Error("Invalid Gemini model name");
  const system = "你是國小六年級可愛魔法飲料店遊戲中的虛構動物顧客。只回覆一句自然、活潑、可愛的繁體中文台詞，最多30個中文字。"
    + "符合角色喜好與交易結果：如果已購買請表現開心，沒有購買則不要說已買到。"
    + "不要提到AI、系統、API，不要給出數學題答案，不要出現不適合小學生的內容。不要輸出引號或其他解釋。";
  const context = "動物角色：" + visit.customer + "；偏好口味：" + visit.favorite
    + "；可用預算：" + visit.budget + "金幣；購買結果：" + (visit.bought ? "已購買" : "未購買")
    + "；飲品：" + (visit.itemName || "沒有商品") + "。請說一句符合情境的顧客對話。";
  return {
    url: "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent",
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: context }] }],
      generationConfig: {
        temperature: 0.85,
        maxOutputTokens: 160,
        thinkingConfig: { thinkingLevel: "minimal" }
      }
    }
  };
}

function extractGeminiNpcText(data) {
  const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content
    && data.candidates[0].content.parts;
  if (!Array.isArray(parts)) return "";
  const raw = parts.filter((p) => p && !p.thought && typeof p.text === "string")
    .map((p) => p.text).join(" ").trim();
  return clean(raw.replace(/[\r\n\t]+/g, " "), 48)
    .replace(/^["“”「」\s]+|["“”「」\s]+$/g, "").trim();
}

async function maybeAiDialogue(io, room, player, visit) {
  if (npcAiMode() !== "gemini" || !player.socketId) return;
  if (Date.now() - room.lastAIAt < 45000) return;
  room.lastAIAt = Date.now();
  try {
    const { url, body } = geminiNpcRequest(visit);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-goog-api-key": process.env.GEMINI_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) {
      console.warn("[NPC AI] Gemini HTTP " + response.status + "; using offline dialogue.");
      return;
    }
    const data = await response.json();
    const text = extractGeminiNpcText(data);
    if (text && player.socketId) io.to(player.socketId).emit("npc:dialogue", { visitId: visit.id, text });
  } catch (_) {
    // No API key, model access, quota, or network failure may interrupt gameplay.
    console.warn("[NPC AI] Gemini unavailable; using offline dialogue.");
  }
}

function runServer(port = PORT) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.static(require("node:path").join(__dirname, "public"), { maxAge: "1h" }));
  app.get("/health", (_req, res) => res.json({ ok: true, activeRooms: rooms.size, npcAiMode: npcAiMode() }));
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, { transports: ["websocket", "polling"], maxHttpBufferSize: 1e5 });

  io.on("connection", (socket) => {
    const handle = (event, handler) => socket.on(event, (data, cb) => {
      try {
        const result = handler(data || {});
        reply(cb, { ok: true, ...(result || {}) });
      } catch (err) {
        reply(cb, { ok: false, error: err.message || "操作失敗" });
      }
    });
    const roomOf = () => {
      const room = rooms.get(socket.data.code);
      if (!room) throw Error("房間已不存在，請重新加入。");
      return room;
    };
    const own = () => {
      const room = roomOf();
      const player = room.players.find((p) => p.id === socket.data.playerId && p.socketId === socket.id);
      if (!player) throw Error("學生身分已失效，請重新加入。");
      if (room.phase !== "playing" || room.paused) throw Error("遊戲尚未開始，或已暫停。");
      return { room, player };
    };
    const host = () => {
      const room = roomOf();
      if (socket.data.role !== "host" || room.hostId !== socket.id) throw Error("僅房主可以操作。");
      return room;
    };
    const enter = (r, role, playerId) => {
      if (socket.data.code) socket.leave(socket.data.code);
      socket.join(r.code);
      socket.data.code = r.code;
      socket.data.role = role;
      socket.data.playerId = playerId || null;
      r.lastActive = Date.now();
      updateRoom(io, r);
    };

    handle("host:create", () => {
      const r = makeRoom();
      r.hostId = socket.id;
      enter(r, "host");
      return { code: r.code, secret: r.secret };
    });
    handle("host:rejoin", ({ code, secret }) => {
      const r = rooms.get(clean(code, 6));
      if (!r || r.secret !== secret) throw Error("找不到教師房間，或管理憑證不正確。");
      if (r.hostId && r.hostId !== socket.id) io.to(r.hostId).emit("host:replaced");
      r.hostId = socket.id;
      enter(r, "host");
      return { code: r.code, secret: r.secret };
    });
    handle("player:join", ({ code, name, token }) => {
      const r = rooms.get(clean(code, 6));
      if (!r) throw Error("找不到這個房間，請確認 6 位數代碼。");
      const cleanedToken = clean(token, 48);
      let p = cleanedToken && r.players.find((person) => person.token === cleanedToken);
      if (!p) {
        if (r.phase !== "lobby") throw Error("遊戲已開始；請使用原本的裝置重新連線。");
        if (r.players.length >= MAX_PLAYERS) throw Error("這個房間已滿（最多四位學生）。");
        if (!clean(name, 12)) throw Error("請先輸入暱稱。");
        p = newPlayer(name);
        r.players.push(p);
      } else if (p.socketId && p.socketId !== socket.id) {
        io.to(p.socketId).emit("player:replaced");
      }
      p.socketId = socket.id;
      enter(r, "player", p.id);
      return { code: r.code, token: p.token, playerId: p.id };
    });
    handle("shop:update", ({ name, theme }) => {
      const room = roomOf();
      const player = room.players.find((p) => p.id === socket.data.playerId && p.socketId === socket.id);
      if (!player) throw Error("請先以學生身分加入教室。");
      if (room.phase === "finished") throw Error("結算後不能修改店鋪。");
      const nextName = clean(name, 14);
      if (!nextName) throw Error("店名不能是空白。");
      if (!THEMES.includes(theme)) throw Error("選擇的店鋪主題不存在。");
      player.shopName = nextName;
      player.theme = theme;
      updateRoom(io, room);
    });
    handle("quest:request", ({ targetId }) => {
      const { room, player } = own();
      if (targetId !== "bonus" && !getRecipe(targetId)) throw Error("沒有這張配方卡。");
      if (targetId !== "bonus" && player.unlocked.includes(targetId)) throw Error("你已經解鎖這張配方卡了。");
      const q = makeQuestion();
      player.quest = { ...q, targetId };
      player.lastResult = null;
      updateRoom(io, room);
    });
    handle("quest:answer", ({ choiceIndex }) => {
      const { room, player } = own();
      const q = player.quest;
      if (!q) throw Error("請先選擇一張配方挑戰卡。");
      if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex > 3) throw Error("答案格式不正確。");
      const correct = choiceIndex === q.correctIndex;
      player.attempts++;
      if (correct) {
        player.correct++;
        player.coins += q.targetId === "bonus" ? 18 : 24;
        if (q.targetId !== "bonus" && !player.unlocked.includes(q.targetId)) player.unlocked.push(q.targetId);
      }
      const target = getRecipe(q.targetId);
      player.lastResult = {
        correct, answer: q.choices[q.correctIndex], explanation: q.explanation,
        reward: correct ? (q.targetId === "bonus" ? 18 : 24) : 0,
        unlockedName: correct && target ? target.name : null,
        at: Date.now()
      };
      player.quest = null;
      updateRoom(io, room);
      return { correct };
    });
    handle("shop:upgrade", ({ upgradeId }) => {
      const { room, player } = own();
      const upgrade = UPGRADES.find((u) => u.id === upgradeId);
      if (!upgrade) throw Error("找不到這個店鋪裝飾。");
      if (player.upgrades.includes(upgrade.id)) throw Error("你已經買過這個裝飾了。");
      if (player.coins < upgrade.cost) throw Error("金幣不夠，先賣幾杯飲料吧！");
      player.coins -= upgrade.cost;
      player.expense += upgrade.cost;
      player.upgrades.push(upgrade.id);
      updateRoom(io, room);
      return { name: upgrade.name, cost: upgrade.cost };
    });
    handle("brew:create", ({ targetId, mix, price }) => {
      const { room, player } = own();
      if (!Array.isArray(mix) || mix.length !== 3 || !mix.every((n) => Number.isInteger(n) && n >= 1 && n <= 12)) {
        throw Error("每種材料請使用 1～12 匙的整數。");
      }
      if (mix.reduce((a, b) => a + b, 0) > 27) throw Error("一鍋最多只能加入 27 匙材料。");
      if (!Number.isInteger(price) || price < 10 || price > 80) throw Error("單杯價格請設為 10～80 金幣。");
      if (player.stock.length >= 8) throw Error("展示架已滿，請先賣掉一些飲料。");
      const mystery = targetId === "mystery";
      const recipe = mystery ? choose(RECIPES) : getRecipe(targetId);
      if (!recipe) throw Error("請先選擇配方。");
      if (!mystery && !player.unlocked.includes(targetId)) throw Error("你還沒有解鎖這張配方。");
      const cost = batchCost(mix);
      if (player.coins < cost) throw Error("金幣不夠！可以解答比例題獲得金幣。");
      const quality = qualityFor(mix, recipe.ratio, mystery, rand(-4, 3));
      player.coins -= cost;
      player.expense += cost;
      player.stock.push({
        id: randomId(), name: mystery ? "神秘魔法特調" : recipe.name,
        emoji: mystery ? "🧪" : recipe.emoji,
        color: mystery ? "mystery" : recipe.color,
        flavor: mystery ? choose(["甜美", "清爽", "夢幻"]) : recipe.flavor,
        quality, price, servings: 3, batchCost: cost, mix: [...mix], mystery,
        createdAt: Date.now()
      });
      player.lastResult = { brew: true, correct: true, quality, message: quality >= 85 ? "比例掌握得很棒！這鍋很受期待。" : quality >= 60 ? "魔法還不錯！試試更精準的比例。" : "這鍋味道有點混亂，請比較配方比值。", at: Date.now() };
      updateRoom(io, room);
      return { quality, cost };
    });
    handle("stock:price", ({ itemId, price }) => {
      const { room, player } = own();
      const item = player.stock.find((s) => s.id === itemId);
      if (!item) throw Error("架上找不到這杯飲料。");
      if (!Number.isInteger(price) || price < 10 || price > 80) throw Error("價格需介於 10～80 金幣。");
      item.price = price;
      updateRoom(io, room);
    });
    handle("host:duration", ({ minutes }) => {
      const r = host();
      if (r.phase !== "lobby" || ![20, 25, 30, 35, 40].includes(minutes)) throw Error("只能在準備階段修改時間。");
      r.duration = minutes * 60;
      r.remaining = r.duration;
      updateRoom(io, r);
    });
    handle("host:start", () => {
      const r = host();
      if (r.phase !== "lobby") throw Error("這場遊戲已經開始或結束。");
      if (!r.players.length) throw Error("至少需要一位學生加入。");
      r.phase = "playing";
      r.paused = false;
      r.endsAt = Date.now() + r.remaining * 1000;
      r.nextCustomerAt = Date.now() + 7000;
      updateRoom(io, r);
    });
    handle("host:pause", () => {
      const r = host();
      if (r.phase !== "playing" || r.paused) throw Error("目前不能暫停。");
      r.remaining = clamp(Math.ceil((r.endsAt - Date.now()) / 1000), 0, r.duration);
      r.paused = true;
      updateRoom(io, r);
    });
    handle("host:resume", () => {
      const r = host();
      if (r.phase !== "playing" || !r.paused) throw Error("目前沒有暫停。");
      r.paused = false;
      r.endsAt = Date.now() + r.remaining * 1000;
      r.nextCustomerAt = Date.now() + 5000;
      updateRoom(io, r);
    });
    handle("host:finish", () => {
      const r = host();
      if (r.phase !== "playing") throw Error("遊戲尚未開始。");
      r.phase = "finished";
      r.paused = false;
      r.remaining = 0;
      updateRoom(io, r);
    });
    handle("host:reset", () => {
      const r = host();
      r.phase = "lobby";
      r.paused = false;
      r.remaining = r.duration;
      r.players = r.players.map((old) => {
        const next = newPlayer(old.name, old.token);
        next.id = old.id;
        next.socketId = old.socketId;
        next.theme = old.theme;
        next.shopName = old.shopName;
        return next;
      });
      updateRoom(io, r);
    });
    socket.on("disconnect", () => {
      const r = rooms.get(socket.data.code);
      if (!r) return;
      if (r.hostId === socket.id) r.hostId = null;
      const p = r.players.find((person) => person.socketId === socket.id);
      if (p) p.socketId = null;
      updateRoom(io, r);
    });
  });

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [code, r] of rooms) {
      if (now - r.createdAt > 6 * 3600e3 || (r.phase === "finished" && now - r.endsAt > 2 * 3600e3)) {
        rooms.delete(code);
        continue;
      }
      if (r.phase === "playing" && !r.paused) {
        r.remaining = Math.max(0, Math.ceil((r.endsAt - now) / 1000));
        if (!r.remaining) {
          r.phase = "finished";
          updateRoom(io, r);
        } else if (now >= r.nextCustomerAt) {
          r.nextCustomerAt = now + 11000;
          for (const p of r.players) if (p.socketId) customerVisit(io, r, p);
          updateRoom(io, r);
        }
      }
      io.to(code).emit("room:clock", { remaining: r.remaining, phase: r.phase, paused: r.paused });
    }
  }, 1000);
  timer.unref();
  httpServer.listen(port, "0.0.0.0", () => console.log("Magic Formula Institute listening on " + port));
  return { app, httpServer, io, close: () => { clearInterval(timer); io.close(); httpServer.close(); } };
}

if (require.main === module) runServer();

module.exports = { runServer, makeQuestion, qualityFor, batchCost, purchaseChance, RECIPES, UPGRADES, newPlayer, npcAiMode, geminiNpcRequest, extractGeminiNpcText, maybeAiDialogue };
