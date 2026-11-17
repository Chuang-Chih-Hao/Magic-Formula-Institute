"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { io: connect } = require("socket.io-client");
const { runServer } = require("../server");

test("teacher plus four students can play simultaneously; a fifth student is declined", async (t) => {
  const service = runServer(0);
  await once(service.httpServer, "listening");
  const url = "http://127.0.0.1:" + service.httpServer.address().port;
  const sockets = Array.from({ length: 6 }, () => connect(url, {
    transports: ["websocket"], reconnection: false
  }));
  t.after(async () => {
    sockets.forEach((s) => s.disconnect());
    await new Promise((resolve) => service.io.close(resolve));
  });
  await Promise.all(sockets.map((s) => once(s, "connect")));
  const send = (s, name, data = {}) => new Promise((resolve, reject) => {
    s.timeout(5000).emit(name, data, (err, result) => err ? reject(err) : resolve(result));
  });
  const room = await send(sockets[0], "host:create");
  assert.equal(room.ok, true);
  const ids = [];
  for (let i = 1; i <= 4; i++) {
    const joined = await send(sockets[i], "player:join", { code: room.code, name: "店長" + i });
    assert.equal(joined.ok, true);
    ids.push(joined.playerId);
  }
  assert.equal(new Set(ids).size, 4);
  const fifth = await send(sockets[5], "player:join", { code: room.code, name: "第五位" });
  assert.equal(fifth.ok, false);
  assert.match(fifth.error, /已滿/);
  const started = await send(sockets[0], "host:start");
  assert.equal(started.ok, true);
  for (let i = 1; i <= 4; i++) {
    assert.equal((await send(sockets[i], "brew:create", { targetId: "mystery", mix: [2, 2, 2], price: 25 })).ok, true);
    assert.equal((await send(sockets[i], "quest:request", { targetId: "forest" })).ok, true);
  }
  assert.equal((await send(sockets[0], "host:finish")).ok, true);
});
