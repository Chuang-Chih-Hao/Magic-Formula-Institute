"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  npcAiMode, geminiNpcRequest, extractGeminiNpcText, maybeAiDialogue
} = require("../server");

const visit = {
  id: "fake-npc-visit-id",
  customer: "兔兔米米",
  favorite: "甜美",
  budget: 38,
  bought: true,
  itemName: "莓果初戀"
};

test("AI is optional, fails closed, and never needs a student identity", () => {
  assert.equal(npcAiMode({}), "local");
  assert.equal(npcAiMode({ GEMINI_API_KEY: "" }), "local");
  assert.equal(npcAiMode({ GEMINI_API_KEY: "fake-secret", AI_NPC_ENABLED: "false" }), "local");
  assert.equal(npcAiMode({ GEMINI_API_KEY: "fake-secret", AI_NPC_ENABLED: "true" }), "gemini");

  const { url, body } = geminiNpcRequest(visit);
  assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
  assert.equal(body.contents[0].role, "user");
  assert.ok(body.contents[0].parts[0].text.includes("兔兔米米"));
  assert.ok(body.contents[0].parts[0].text.includes("已購買"));
  assert.ok(!JSON.stringify(body).includes("API_KEY"));
  assert.ok(!JSON.stringify(body).includes("小明"));
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "minimal");
  assert.throws(() => geminiNpcRequest(visit, "../unauthorized"), /Invalid Gemini model/);
});

test("Gemini response parser accepts plain text, strips thoughts and limits dialogue", () => {
  assert.equal(
    extractGeminiNpcText({ candidates: [{ content: { parts: [{ text: "「好好喝，我還想再來！」" }] } }] }),
    "好好喝，我還想再來！"
  );
  assert.equal(
    extractGeminiNpcText({ candidates: [{ content: { parts: [{ text: "thinking", thought: true }, { text: "🐰 下次還會來！" }] } }] }),
    "🐰 下次還會來！"
  );
  assert.equal(extractGeminiNpcText({ candidates: [] }), "");
  assert.ok(extractGeminiNpcText({ candidates: [{ content: { parts: [{ text: "好".repeat(100) }] } }] }).length <= 48);
});

test("mocked Gemini NPC dialogue: authenticated server request, client event, throttling and quota fallback", async () => {
  const old = {
    key: process.env.GEMINI_API_KEY,
    enabled: process.env.AI_NPC_ENABLED,
    model: process.env.GEMINI_MODEL,
    fetch: global.fetch
  };
  let requests = 0;
  const emitted = [];
  const io = { to: (id) => ({ emit: (event, payload) => emitted.push({ id, event, payload }) }) };
  const player = { socketId: "student-socket-id" };
  const room = { lastAIAt: 0 };
  try {
    process.env.GEMINI_API_KEY = "test-key-only";
    process.env.AI_NPC_ENABLED = "true";
    process.env.GEMINI_MODEL = "gemini-3.5-flash-lite";
    global.fetch = async (url, options) => {
      requests++;
      assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\//);
      assert.equal(options.headers["x-goog-api-key"], "test-key-only");
      assert.equal(JSON.parse(options.body).contents[0].parts[0].text.includes(visit.customer), true);
      return {
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: "這杯魔法真甜，謝謝店長！" }] } }] })
      };
    };
    await maybeAiDialogue(io, room, player, visit);
    assert.equal(requests, 1);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].event, "npc:dialogue");
    assert.equal(emitted[0].payload.visitId, visit.id);
    assert.equal(emitted[0].payload.text, "這杯魔法真甜，謝謝店長！");
    await maybeAiDialogue(io, room, player, visit);
    assert.equal(requests, 1, "45-second request throttle should prevent a second call");

    // A Google quota failure must not stop the game or send a forged dialogue.
    global.fetch = async () => { requests++; return { ok: false, status: 429 }; };
    await maybeAiDialogue(io, { lastAIAt: 0 }, player, visit);
    assert.equal(requests, 2);
    assert.equal(emitted.length, 1);

    process.env.AI_NPC_ENABLED = "false";
    await maybeAiDialogue(io, { lastAIAt: 0 }, player, visit);
    assert.equal(requests, 2, "disabling Gemini must block all requests");
  } finally {
    for (const [key, original] of Object.entries({
      GEMINI_API_KEY: old.key,
      AI_NPC_ENABLED: old.enabled,
      GEMINI_MODEL: old.model
    })) {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
    global.fetch = old.fetch;
  }
});
