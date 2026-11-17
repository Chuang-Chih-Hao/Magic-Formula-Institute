"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { io: client } = require("socket.io-client");
const {
  runServer, makeQuestion, qualityFor, batchCost,
  purchaseChance, RECIPES
} = require("../server");

test("question bank: 500 questions always have four distinct options and a valid answer", () => {
  const skills = new Set();
  for (let i = 0; i < 500; i++) {
    const q = makeQuestion();
    skills.add(q.skill);
    assert.equal(q.choices.length, 4);
    assert.equal(new Set(q.choices).size, 4);
    assert.ok(q.correctIndex >= 0 && q.correctIndex < 4);
    assert.ok(q.prompt.length > 12);
    assert.ok(q.explanation.length > 10);
  }
  assert.equal(skills.size, 6);
});

test("ratios, three-cup costs, and NPC purchase preferences", () => {
  assert.equal(RECIPES.length, 6);
  assert.equal(batchCost([2, 1, 1]), 14);
  assert.equal(qualityFor([4, 2, 2], [2, 1, 1]), 100);
  assert.ok(qualityFor([1, 10, 1], [2, 1, 1]) < 60);
  assert.ok(qualityFor([2, 1, 1], [2, 1, 1], true) <= 81);
  const customer = { favorite: "甜美" };
  const appealing = purchaseChance({ quality: 98, price: 25, flavor: "甜美" }, customer);
  const unappealing = purchaseChance({ quality: 22, price: 75, flavor: "清爽" }, customer);
  assert.ok(appealing > unappealing);
  assert.ok(appealing > .75);
  assert.ok(unappealing < .15);
});

test("one student can join, decorate before opening, brew, reprice, and finish", async (t) => {
  const service = runServer(0);
  await once(service.httpServer, "listening");
  const url = "http://127.0.0.1:" + service.httpServer.address().port;
  const teacher = client(url, { transports: ["websocket"], reconnection: false });
  const pupil = client(url, { transports: ["websocket"], reconnection: false });
  let latestPlayer = null;
  pupil.on("player:state", (value) => { latestPlayer = value; });
  t.after(async () => {
    teacher.disconnect();
    pupil.disconnect();
    await new Promise((resolve) => service.io.close(resolve));
  });
  await Promise.all([once(teacher, "connect"), once(pupil, "connect")]);
  const emit = (conn, name, payload = {}) => new Promise((resolve, reject) => {
    conn.timeout(5000).emit(name, payload, (err, response) => err ? reject(err) : resolve(response));
  });

  const created = await emit(teacher, "host:create");
  assert.equal(created.ok, true);
  assert.match(created.code, /^\d{6}$/);
  const joined = await emit(pupil, "player:join", { code: created.code, name: "星星店長" });
  assert.equal(joined.ok, true);
  assert.ok(joined.token);

  const decorated = await emit(pupil, "shop:update", { name: "森林棉花糖", theme: "mint" });
  assert.equal(decorated.ok, true);
  const duration = await emit(teacher, "host:duration", { minutes: 20 });
  assert.equal(duration.ok, true);
  const started = await emit(teacher, "host:start");
  assert.equal(started.ok, true);

  const brewed = await emit(pupil, "brew:create", { targetId: "mystery", mix: [2, 2, 2], price: 30 });
  assert.equal(brewed.ok, true);
  assert.equal(brewed.cost, 18);
  assert.ok(brewed.quality <= 81);
  assert.equal(latestPlayer.stock.length, 1);
  const repriced = await emit(pupil, "stock:price", { itemId: latestPlayer.stock[0].id, price: 35 });
  assert.equal(repriced.ok, true);
  assert.equal(latestPlayer.stock[0].price, 35);

  const quest = await emit(pupil, "quest:request", { targetId: "berry" });
  assert.equal(quest.ok, true);
  const q = latestPlayer.quest;
  assert.ok(q);
  const nums = [...q.prompt.matchAll(/\d+/g)].map((m) => Number(m[0]));
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  let expected;
  if (q.skill === "化簡比") expected = (nums[0] / gcd(nums[0], nums[1])) + "：" + (nums[1] / gcd(nums[0], nums[1]));
  if (q.skill === "比值") expected = String(Number((nums[0] / nums[1]).toFixed(2)));
  if (q.skill === "等比應用") expected = String(nums[1] * nums[2] / nums[0]);
  if (q.skill === "生活比例") expected = String(nums[1] / nums[0] * nums[2]);
  if (q.skill === "比例式") expected = String(nums[0] * nums[2] / nums[1]);
  if (q.skill === "三項比例") expected = (nums[1] * nums[3] / nums[0]) + " 匙、" + (nums[2] * nums[3] / nums[0]) + " 匙";
  const choiceIndex = q.choices.indexOf(expected);
  assert.ok(choiceIndex >= 0, "quiz should have the mathematically correct answer");
  const answered = await emit(pupil, "quest:answer", { choiceIndex });
  assert.equal(answered.ok, true);
  assert.equal(answered.correct, true);
  assert.deepEqual(latestPlayer.unlocked, ["berry"]);
  const knownBrew = await emit(pupil, "brew:create", { targetId: "berry", mix: [2, 1, 1], price: 30 });
  assert.equal(knownBrew.ok, true);
  assert.ok(knownBrew.quality >= 96);
  const upgrade = await emit(pupil, "shop:upgrade", { upgradeId: "flowers" });
  assert.equal(upgrade.ok, true);
  assert.ok(latestPlayer.upgrades.includes("flowers"));
  assert.equal((await emit(pupil, "shop:upgrade", { upgradeId: "flowers" })).ok, false);
  const badBrew = await emit(pupil, "brew:create", { targetId: "berry", mix: [2, 1, 1], price: 30 });
  assert.equal(badBrew.ok, true);

  const paused = await emit(teacher, "host:pause");
  assert.equal(paused.ok, true);
  const pausedBrew = await emit(pupil, "brew:create", { targetId: "mystery", mix: [2, 2, 2], price: 30 });
  assert.equal(pausedBrew.ok, false);
  const resumed = await emit(teacher, "host:resume");
  assert.equal(resumed.ok, true);
  const finished = await emit(teacher, "host:finish");
  assert.equal(finished.ok, true);
  const resetState = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pupil.off("player:state", onState); reject(Error("Reset state not received")); }, 3000);
    function onState(state) {
      if (state.stock.length !== 0 || state.unlocked.length !== 0 || state.upgrades.length !== 0) return;
      clearTimeout(timeout);
      pupil.off("player:state", onState);
      resolve();
    }
    pupil.on("player:state", onState);
  });
  const restarted = await emit(teacher, "host:reset");
  assert.equal(restarted.ok, true);
  await resetState;
  assert.equal(latestPlayer.stock.length, 0);
  assert.equal(latestPlayer.unlocked.length, 0);
  assert.equal(latestPlayer.upgrades.length, 0);
});
