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

  const quest = await emit(pupil, "quest:request", { targetId: "berry" });
  assert.equal(quest.ok, true);
  const badBrew = await emit(pupil, "brew:create", { targetId: "berry", mix: [2, 1, 1], price: 30 });
  assert.equal(badBrew.ok, false);

  const paused = await emit(teacher, "host:pause");
  assert.equal(paused.ok, true);
  const pausedBrew = await emit(pupil, "brew:create", { targetId: "mystery", mix: [2, 2, 2], price: 30 });
  assert.equal(pausedBrew.ok, false);
  const resumed = await emit(teacher, "host:resume");
  assert.equal(resumed.ok, true);
  const finished = await emit(teacher, "host:finish");
  assert.equal(finished.ok, true);
  const restarted = await emit(teacher, "host:reset");
  assert.equal(restarted.ok, true);
});
