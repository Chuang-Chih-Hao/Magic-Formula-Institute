"use strict";

// Browser end-to-end check for the new 2D bazaar. Runs against a local instance.
// Does not need or access Gemini keys.
const assert=require("node:assert/strict");
const {spawn}=require("node:child_process");
const {chromium}=require("playwright");
const fs=require("node:fs");
const port=Number(process.env.TEST_PORT||38761);
const origin="http://127.0.0.1:"+port;
const folder=process.env.SCREENSHOT_DIR||"/tmp/fair-screenshots";
fs.mkdirSync(folder,{recursive:true});
const delay=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));

async function waitForServer(){
  for(let attempt=0;attempt<80;attempt++){
    try{
      const res=await fetch(origin+"/health");
      if(res.ok){
        const body=await res.json();
        assert.equal(body.game,"magic-fair-v2");
        console.log("PASS /health: new fair server running");
        return;
      }
    }catch(_){}
    await delay(250);
  }
  throw Error("Local server never became healthy");
}
async function main(){
  const server=spawn(process.execPath,["fair-server.js"],{
    cwd:process.cwd(),env:{...process.env,PORT:String(port),AI_NPC_ENABLED:"false"},
    stdio:["ignore","pipe","pipe"]
  });
  server.stdout.on("data",buf=>process.stdout.write("[server] "+buf));
  server.stderr.on("data",buf=>process.stderr.write("[server] "+buf));
  let browser;
  try{
    await waitForServer();
    browser=await chromium.launch({headless:true,
      ...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{}),
      args:["--no-sandbox"]});
    const teacher=await browser.newPage({viewport:{width:1540,height:940}});
    const student=await browser.newPage({viewport:{width:1540,height:940}});
    const errors=[];
    for(const page of [teacher,student])page.on("pageerror",err=>errors.push(err.message));

    await teacher.goto(origin,{waitUntil:"domcontentloaded"});
    await teacher.locator('[data-action="create"]').click();
    const code=(await teacher.locator(".room-ticket strong").textContent()).trim();
    assert.match(code,/^\d{6}$/);
    console.log("PASS teacher created room "+code);

    await student.goto(origin,{waitUntil:"domcontentloaded"});
    await student.locator("#joinCode").fill(code);
    await student.locator("#joinName").fill("園遊會測試員");
    await student.locator('[data-action="join"]').click();
    await student.locator(".prep-grid").waitFor({timeout:10000});
    assert.equal(await student.locator(".menu-edit").count(),3);
    assert.equal(await student.locator(".decor-card").count(),5);
    console.log("PASS student can see three menu cards and five decoration options");
    assert.equal(await student.locator(".unlock-card.unlocked").count(),0,"no pre-unlocked drinks");

    await student.locator("#shopName").fill("月光森林魔法屋");
    await student.locator('[data-action="theme"][data-id="mint"]').click();
    await student.locator('[data-action="toggle-decor"][data-id="fountain"]').click();
    await student.locator('[data-action="toggle-decor"][data-id="flowers"]').click();
    assert.equal(await student.locator(".decor-card.chosen").count(),2);
    await student.locator('[data-action="save-design"]').click();
    await student.screenshot({path:folder+"/setup.png",fullPage:true});
    console.log("PASS changing architecture and decorations");

    // There are NO unlocked drinks at the start. Solve 3 separate math questions.
    assert.equal(await student.locator(".unlock-card.unlocked").count(),0);
    for(const recipe of ["berry","moon","forest"]){
      let passed=false;
      for(let attempt=0;attempt<80;attempt++){
        await student.locator('[data-action="get-quest"][data-id="'+recipe+'"]').click();
        await student.locator(".question .choices .choice").first().waitFor();
        const choices=student.locator(".question .choices .choice");
        await choices.nth(Math.floor(Math.random()*4)).click();
        await student.locator(".feedback").waitFor({timeout:10000});
        const card=student.locator('.unlock-card[data-id="'+recipe+'"]');
        if(await card.evaluate(el=>el.classList.contains("unlocked"))){
          passed=true;break;
        }
      }
      assert.equal(passed,true,"the student should unlock "+recipe+" by answering");
    }
    console.log("PASS student unlocked 3 recipes by solving actual math questions");

    await student.locator("#recipe-0").selectOption("berry");
    await student.locator("#recipe-1").selectOption("moon");
    await student.locator("#recipe-2").selectOption("forest");

    // Verify uniform stage scaling keeps positions and proportions.
    const first=await student.evaluate(()=>{
      const rect=document.querySelector(".menu-edit").getBoundingClientRect();
      return{x:rect.x,y:rect.y,width:rect.width,height:rect.height,scale:parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--fair-scale"))};
    });
    await student.setViewportSize({width:1280,height:800});
    const second=await student.evaluate(()=>{
      const rect=document.querySelector(".menu-edit").getBoundingClientRect();
      return{x:rect.x,y:rect.y,width:rect.width,height:rect.height,scale:parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--fair-scale"))};
    });
    assert.ok(Math.abs(first.width/first.scale-second.width/second.scale)<3,"proportional width must remain identical");
    assert.ok(Math.abs(first.height/first.scale-second.height/second.scale)<3,"proportional height must remain identical");
    await student.setViewportSize({width:1540,height:940});

    // Make a deliberate exact proportional recipe and a custom price.
    await student.locator("#mix-0-0").fill("4");
    await student.locator("#mix-0-1").fill("2");
    await student.locator("#mix-0-2").fill("2");
    await student.locator("#price-0").fill("29");
    assert.match((await student.locator("#quality-0").textContent()),/100/);
    // The lock button must save the user's current three products automatically.
    student.on("dialog",d=>d.accept());
    await student.locator('[data-action="lock"]').click();
    await student.getByText("你的攤位已鎖定").waitFor({timeout:12000});
    await teacher.locator('[data-action="start"]').waitFor({state:"visible"});
    assert.equal(await teacher.locator('[data-action="start"]').isDisabled(),false);
    console.log("PASS student locked menu; teacher sees ready status");

    await teacher.locator('[data-action="start"]').click();
    await teacher.locator("#fairCanvas").waitFor({timeout:12000});
    await student.locator("#fairCanvas").waitFor({timeout:12000});
    await teacher.waitForFunction(()=>{
      const n=document.getElementById("npcCount");
      return n&&Number(n.textContent)>0;
    },null,{timeout:16000});
    await teacher.screenshot({path:folder+"/market.png",fullPage:true});
    console.log("PASS teacher and student share one live animated market map");

    await teacher.waitForFunction(()=>{
      return !!document.querySelector('#eventFeed .event.sale, #eventFeed .event.leave');
    },null,{timeout:42000});
    assert.ok(await teacher.locator("#npcComparison").isVisible());
    assert.ok(await teacher.locator("#leaderboard .rank-entry").count()>=1);
    console.log("PASS global customer decision and cross-stall comparison panel are visible");
    await teacher.screenshot({path:folder+"/transactions.png",fullPage:true});
    assert.deepEqual(errors,[],"frontend should have no uncaught browser exceptions");
    console.log("BROWSER FAIR 2D SMOKE TEST PASSED.");
  }finally{
    if(browser)await browser.close();
    server.kill("SIGTERM");
    await delay(250);
  }
}
main().catch(error=>{console.error("BROWSER FAIR 2D SMOKE TEST FAILED:",error.stack||error.message);process.exitCode=1;});
