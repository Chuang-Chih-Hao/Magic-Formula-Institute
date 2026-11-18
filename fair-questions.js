"use strict";

const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = (xs) => xs[rand(0, xs.length - 1)];
const gcd = (a, b) => b ? gcd(b, a % b) : a;
const names = ["小兔的莓果攤", "狐狸的月光茶坊", "貓咪的花園屋", "森林嘉年華", "星光遊行", "小熊甜點節", "園遊會補給站", "彩虹魔法舖", "雲朵冰沙坊", "櫻花小市集"];
const things = [["草莓汁", "蜂蜜"], ["星光水", "花露"], ["魔法粉", "月光水"], ["糖漿", "牛奶"], ["藍莓", "蜜桃"], ["紅茶", "果汁"], ["彩色珠", "透明珠"], ["鮮奶", "可可"]];
const flavors = ["花香", "果甜", "清涼", "星光", "蜂蜜", "奶香"];
const makeOptions = (correct, distractors) => {
  const answer = String(correct);
  const arr = [answer];
  for(const d of distractors) if (String(d) !== answer && !arr.includes(String(d))) arr.push(String(d));
  let v = 1;
  while(arr.length < 4) {
    const fallback = /^\d+(\.\d+)?$/.test(answer) ? String(Number(answer) + 2*v+1) : "選項 " + (4+v);
    if(!arr.includes(fallback)) arr.push(fallback);
    v++;
  }
  const values=arr.slice(0,4);
  for(let i=values.length-1;i>0;i--){const j=rand(0,i);[values[i],values[j]]=[values[j],values[i]];}
  return { choices:values, correctIndex:values.indexOf(answer) };
};
const fmt = n=>String(Number(n.toFixed(3)));
const quest = (type) => {
  const place=pick(names), [a,b]=pick(things), taste=pick(flavors);
  const n=rand(2,6), m=rand(2,7), k=rand(2,7), c=rand(2,7);
  let prompt, skill, correct, wrong, explanation;
  switch(type){
    case 0: {
      const d=gcd(n,m), r=[n/d,m/d]; const scale=rand(2,8);
      skill="化簡比";
      prompt=place+"把 "+a+"與"+b+"調成 "+(n*scale)+"："+(m*scale)+"，最簡整數比是多少？";
      correct=r.join("：");wrong=[r[1]+"："+r[0],n+"："+m,(n*scale)+"："+m];
      explanation="兩項同除最大公因數 "+(d*scale)+"，得到 "+correct+"。";break;
    }
    case 1:{
      const x=rand(1,9), y=pick([10,20,50,100]); 
      skill="比值";
      prompt=place+"的配方寫著 "+a+"："+b+"＝"+x+"："+y+"。這個比的比值是？";
      correct=fmt(x/y);wrong=[fmt(y/x),fmt(x/(y/10)),fmt((x+2)/y)];
      explanation="前項÷後項＝"+x+"÷"+y+"＝"+correct+"。";break;
    }
    case 2:{
      const u=rand(1,6),v=rand(1,6), q=rand(2,6);
      skill="等比擴大";
      prompt=place+"的"+taste+"調飲用"+a+" "+u+"匙、"+b+" "+v+"匙。若"+a+"改成"+u*q+"匙，"+b+"需幾匙？";
      correct=v*q;wrong=[v+q,u*q,u*v*q];
      explanation="每一項同乘"+q+"，所以"+b+"為"+v+"×"+q+"＝"+correct+"匙。";break;
    }
    case 3:{
      const u=rand(1,5),v=rand(1,5), q=rand(3,8);
      skill="比例式";
      prompt=place+"想調整配方，已知 "+u+"："+v+"＝□："+(v*q)+"，□應填多少？";
      correct=u*q;wrong=[u+q,v*q,u*v+q];
      explanation="後項乘"+q+"，前項也乘"+q+"，□＝"+correct+"。";break;
    }
    case 4:{
      const u=rand(1,4),v=rand(1,5), t=rand(2,7);
      skill="按比例分配";
      prompt=place+"有"+(u+v)*t+"顆"+taste+"糖，打算照 "+u+"："+v+" 分給兩個調飲鍋，第一鍋分幾顆？";
      correct=u*t;wrong=[v*t,(u+v)*t,Math.abs(u-v)*t+u];
      explanation="總份數是"+(u+v)+"，每份"+t+"顆；第一鍋占"+u+"份，共"+correct+"顆。";break;
    }
    case 5:{
      const u=rand(2,8), unit=rand(8,25), target=u+rand(2,6);
      skill="等比定價";
      prompt=place+"賣"+u+"杯"+taste+"飲品，共收到"+u*unit+"金幣。同價賣"+target+"杯應收到多少金幣？";
      correct=target*unit;wrong=[(target-1)*unit,target*unit+u,u*unit+target];
      explanation="每杯"+unit+"金幣，"+target+"杯共"+target+"×"+unit+"＝"+correct+"。";break;
    }
    case 6:{
      const u=rand(1,5),v=rand(2,6),w=rand(1,5),q=rand(2,5);
      skill="三項比例";
      prompt=place+"的三種原料比例是"+u+"："+v+"："+w+"。若第一種增加到"+u*q+"匙，第二和第三種合計要幾匙？";
      correct=(v+w)*q;wrong=[v+w,(u+v)*q,(v+w)*q+u];
      explanation="三項都應乘"+q+"倍，所以其餘兩項共("+v+"＋"+w+")×"+q+"＝"+correct+"匙。";break;
    }
    case 7:{
      const u=rand(1,6),v=u+rand(1,6), q=rand(2,6);
      skill="比的比較";
      prompt=place+"發現A杯"+a+"："+b+"＝"+u+"："+v+"，B杯則是"+u*q+"："+v*q+"。哪個說法正確？";
      correct="兩杯比值相同";wrong=["A杯的比值較大","B杯的比值較大","兩杯都無法求比值"];
      explanation="B杯兩項同乘"+q+"，比值不變，兩杯配方等比。";break;
    }
    case 8:{
      const u=rand(1,4),v=rand(2,5),q=rand(2,6);
      skill="依總量求份數";
      prompt=place+"有"+(u+v)*q+"毫升的飲品，"+a+"與"+b+"的比是"+u+"："+v+"。其中"+b+"有幾毫升？";
      correct=v*q;wrong=[u*q,(u+v)*q,v*(q+1)];
      explanation="共"+(u+v)+"份，每份"+q+"毫升；"+b+"有"+v+"份，所以"+correct+"毫升。";break;
    }
    case 9:{
      const u=rand(2,5),v=rand(2,5),q=rand(2,6);
      skill="依倍數推算";
      prompt=place+"推出大杯版"+taste+"魔法水。小杯用了"+a+" "+u+"匙，"+b+" "+v+"匙；若兩種原料都乘"+q+"倍，大杯總共幾匙？";
      correct=(u+v)*q;wrong=[(u+v)+q,u*v*q,(u+v)*(q-1)];
      explanation="總量也會變成原本的"+q+"倍：("+u+"＋"+v+")×"+q+"＝"+correct+"匙。";break;
    }
    case 10:{
      const u=rand(1,5),v=rand(2,7),q=rand(2,6);
      skill="未知後項";
      prompt=place+"的配方要求 "+u+"："+v+"＝"+u*q+"：□，請求出□。";
      correct=v*q;wrong=[u*q,(u+v)*q,v+q];
      explanation="前項乘"+q+"倍，後項必須同乘"+q+"倍："+v+"×"+q+"＝"+correct+"。";break;
    }
    case 11:{
      const u=rand(1,5),v=rand(1,5),q=rand(2,6);
      skill="比值辨識";
      prompt=place+"記錄"+a+"："+b+"＝"+u*q+"："+v*q+"。下列哪一個算式代表它的比值？";
      correct=u*q+" ÷ "+v*q;wrong=[v*q+" ÷ "+u*q,u*q+" ＋ "+v*q,u*q+" × "+v*q];
      explanation="比值是前項除以後項，算式為"+correct+"。";break;
    }
    case 12:{
      const u=rand(1,4),v=rand(2,6),q=rand(2,6);
      skill="園遊會優惠";
      prompt=place+"的買"+u+"杯送"+v+"張集點卡活動，每買"+u*q+"杯會拿到幾張卡？（依相同倍數）";
      correct=v*q;wrong=[u*q,u*v*q,v+q];
      explanation="購買杯數變為"+q+"倍，集點卡也變為"+q+"倍，共"+correct+"張。";break;
    }
    default:{
      const u=rand(2,7),v=rand(2,7),q=rand(2,6);
      skill="比例推理";
      prompt=place+"中有兩位店長。甲使用"+u+"："+v+"的材料比；乙將兩項同乘"+q+"倍。乙的材料比是？";
      correct=u*q+"："+v*q;wrong=[u*q+"："+v,u+"："+v*q,v*q+"："+u*q];
      explanation="兩項必須同乘"+q+"，得到"+correct+"，而且比值沒有改變。";break;
    }
  }
  return {skill,prompt,explanation,...makeOptions(correct,wrong),answer:String(correct)};
};

function makeQuestion(previous = []) {
  const recent = new Set(previous.map(x=>typeof x==="string"?x:x.prompt));
  const lastType = typeof previous.at(-1)==="object" ? previous.at(-1).type : null;
  for(let i=0;i<140;i++){
    const type=rand(0,13);
    if(i<20 && lastType===type)continue;
    const q=quest(type);
    if(!recent.has(q.prompt))return {...q,type,id:require("node:crypto").randomBytes(8).toString("hex")};
  }
  return {...quest(rand(0,13)),id:require("node:crypto").randomBytes(8).toString("hex")};
}
// Rare formula challenge: two or more linked ratio steps; never served through
// ordinary recipe unlock questions. The target name is intentionally not used
// to compute the answer, which allows the same challenge bank for all drops.
function makeSpecialQuestion(previous=[]) {
  const seen=new Set(previous.map(q=>typeof q==="string"?q:q.prompt));
  for(let attempt=0;attempt<80;attempt++){
    const type=rand(0,3),place=pick(names),[a,b]=pick(things);
    const x=rand(2,5),y=rand(2,5),z=rand(1,4),k=rand(3,6),extra=rand(2,7);
    let prompt,answer,wrong,explanation;
    if(type===0){
      const total=(x+y+z)*k;
      // First split a total into three ratio shares, then a second portion.
      const shared=x*k;
      const subdivide=rand(2,5);
      prompt=place+"得到"+total+"克的神秘原料，依 "+x+"："+y+"："+z+
        " 分成三鍋。第一鍋再均分成 "+subdivide+" 包，每包各多少克？";
      // To keep answers integral we multiply the whole first stage by subportion.
      const complete=x*k*subdivide;
      const sum=(x+y+z)*k*subdivide;
      prompt=place+"得到"+sum+"克神秘原料，依 "+x+"："+y+"："+z+
        " 分成三鍋。第一鍋再平均分成 "+subdivide+" 包，每包多少克？";
      answer=x*k;
      wrong=[y*k,z*k,x*k*subdivide,(x+y)*k];
      explanation="總份數 "+(x+y+z)+"，每份 "+k*subdivide+" 克；第一鍋有 "+
        complete+" 克，再除以 "+subdivide+"，每包 "+answer+" 克。";
    }else if(type===1){
      const first=x*k,second=y*k;
      const after=first+extra;
      const d=gcd(after,second);
      prompt=place+"原本把"+a+" "+first+"匙與"+b+" "+second+
        "匙混合，又額外加入"+a+" "+extra+"匙。新的最簡比（"+a+"："+b+"）為何？";
      answer=after/d+"："+second/d;
      wrong=[first+":"+second,second+":"+after,first+extra+":"+second,
        x+":"+y];
      explanation="先算新"+a+"="+first+"＋"+extra+"="+after+"匙；"+
        b+"仍為"+second+"匙。將"+after+"："+second+" 同除 "+d+
        "，得到最簡比 "+answer+"。";
    }else if(type===2){
      const total=(x+y+z)*k,keep=x*k,other=(y+z)*k;
      const price=rand(4,8);
      prompt=place+"用"+total+"毫升魔法水，依 "+x+"："+y+"："+z+
        " 分給三種精華。後兩種精華每毫升成本 "+price+
        " 金幣，後兩種合計成本多少金幣？";
      answer=other*price;
      wrong=[keep*price,(x+y)*k*price,other+price,total*price];
      explanation="後兩種共 "+(y+z)+" 份，占 "+other+" 毫升；每毫升 "+
        price+" 金幣，成本 "+other+"×"+price+"＝"+answer+"。";
    }else{
      const aCount=x*k,bCount=y*k,added=extra*k;
      const newTotal=aCount+bCount+added;
      const newA=aCount+added;
      prompt=place+"原有"+a+" "+aCount+"毫升、"+b+" "+bCount+
        "毫升，再加入"+a+" "+added+
        "毫升。新配方中"+a+"占總量的幾分之幾？（最簡分數）";
      const d=gcd(newA,newTotal);
      answer=(newA/d)+"/"+(newTotal/d);
      wrong=[(aCount/gcd(aCount,aCount+bCount))+"/"+((aCount+bCount)/gcd(aCount,aCount+bCount)),
        bCount+"/"+newTotal,newA+"/"+bCount,newA+"/"+newTotal];
      explanation="先算 "+a+" 有 "+aCount+"＋"+added+"＝"+newA+
        " 毫升，總量 "+newTotal+" 毫升。占比 "+newA+"/"+newTotal+
        " 約分（同除 "+d+"）後為 "+answer+"。";
    }
    const q={...makeOptions(answer,wrong),answer:String(answer),
      skill:["雙重比例分配","調整配方與約分","比例與成本連算","加料後的分數占比"][type],
      type:"rare-"+type,prompt:"🌠 傳說級難題｜"+prompt,explanation,
      rarity:"legendary",id:require("node:crypto").randomBytes(8).toString("hex")};
    if(!seen.has(q.prompt))return q;
  }
  throw Error("Unable to generate a unique special formula challenge");
}

module.exports={makeQuestion,makeSpecialQuestion};
