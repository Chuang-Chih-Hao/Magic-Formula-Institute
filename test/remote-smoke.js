"use strict";

// Live external smoke test. Never reads, prints, or receives the Gemini API Key.
// One isolated teacher/student room generates one fictional NPC dialogue.

const { io } = require("socket.io-client");
const BASE = process.env.MFI_URL || "https://magic-formula-institute.onrender.com";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (msg) => { throw new Error(msg); };

async function healthCheck() {
  let lastError = "";
  for (let attempt = 1; attempt <= 24; attempt++) {
    try {
      const r = await fetch(BASE + "/health", { signal: AbortSignal.timeout(10000) });
      if (r.ok) {
        const data = await r.json();
        if (data.ok && data.npcAiMode === "gemini") {
          console.log("PASS /health: server healthy, Gemini mode enabled; no secret values exposed.");
          return;
        }
        if (data.ok && data.npcAiMode === "local") {
          fail("The server is live but Gemini mode is LOCAL. Confirm GEMINI_API_KEY in Render Environment and redeploy.");
        }
        lastError = "Unexpected health response: " + JSON.stringify(data);
      } else {
        lastError = "HTTP " + r.status;
      }
    } catch (e) {
      lastError = String(e.message);
    }
    if (attempt !== 24) await sleep(5000);
  }
  fail("/health did not confirm Gemini mode: " + lastError);
}

async function runTestRoom() {
  let teacher, student;
  try {
    teacher = io(BASE, { transports: ["websocket"], timeout: 15000, reconnection: false, forceNew: true });
    student = io(BASE, { transports: ["websocket"], timeout: 15000, reconnection: false, forceNew: true });
    const waitForConnect = (socket) => new Promise((resolve, reject) => {
      if (socket.connected) return resolve();
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    await Promise.all([waitForConnect(teacher), waitForConnect(student)]);
    console.log("PASS Socket.IO: teacher and student connected through public website.");
    const send = (socket, event, body = {}) => new Promise((resolve, reject) => {
      socket.timeout(10000).emit(event, body, (err, reply) => {
        if (err || !reply?.ok) return reject(Error(event + ": " + (reply?.error || err?.message || "missing ack")));
        resolve(reply);
      });
    });
    const room = await send(teacher, "host:create");
    await send(student, "player:join", { code: room.code, name: "自動測試學生" });
    const dialogue = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("No Gemini NPC dialogue observed within 33 seconds")), 33000);
      student.on("npc:dialogue", (d) => {
        clearTimeout(timer);
        resolve(d);
      });
    });
    await send(teacher, "host:start");
    console.log("PASS room: teacher started a new isolated class with one student.");
    const d = await dialogue;
    if (!d || typeof d.text !== "string" || d.text.length < 2) fail("NPC dialogue event had no usable text");
    console.log("PASS Gemini NPC: received personalized Traditional Chinese message (" + d.text.length + " characters).");
    await send(teacher, "host:finish");
  } finally {
    teacher?.disconnect();
    student?.disconnect();
  }
}

async function main() {
  await healthCheck();
  await runTestRoom();
  console.log("LIVE GEMINI SMOKE TEST PASSED.");
}

main().catch((e) => {
  console.error("LIVE GEMINI SMOKE TEST FAILED: " + e.message);
  process.exitCode = 1;
});
