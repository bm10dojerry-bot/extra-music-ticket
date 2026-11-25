"use strict";const fs=require("node:fs"),assert=require("node:assert/strict"),ts=require("typescript"),os=require("node:os"),path=require("node:path");const f="lib/ai-sales.ts",helper="lib/ai-sales-quick-reply.ts";
async function tests(){
 const compiled=ts.transpileModule(fs.readFileSync(helper,"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});assert.equal(compiled.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error).length||0,0);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"extra-quick-"));try{
  const file=path.join(dir,"quick.cjs");fs.writeFileSync(file,compiled.outputText);const {quickSalesReply:q}=require(file);
  const now=Date.parse("2026-11-24T00:00:00+07:00"),show={id:"dinh",artist:"Đình Dũng",title:"Chuyện tình giữa Sa Pa",date:"2026-11-28",time:"19:30",venueName:"CCC Sa Pa",venueAddress:"002 Phan Xi Păng, Sa Pa",prices:{A:599000,B:499000,C:399000,D:299000}},other={...show,id:"minh",artist:"Minh Vương + Duy Khoa",date:"2026-12-05"};
  const m=(...texts)=>texts.map((body,i)=>({id:i+1,sender:"customer",body}));let loads=0;const load=async()=>{loads++;return [show,other];};
  assert.match(await q(m("em ơi cho anh xin giá vé"),false,load,now),/anh muốn xem giá vé/);assert.equal(loads,0);
  const r=await q(m("em ơi cho anh xin giá vé","đình dũng em ơi"),false,load,now);assert.match(r,/599\.000đ/);assert.match(r,/Anh dự định đi mấy người/);assert(!r.includes("Minh Vương"));assert.equal(loads,1);
  assert.match(await q(m("Giá vé Đình Dũng bao nhiêu?"),false,load,now),/299\.000đ/);
  assert.match(await q(m("Giá vé Duy Khoa"),false,load,now),/Minh Vương \+ Duy Khoa/);
  const known=await q(m("anh đi 2 người","Giá vé Đình Dũng"),false,load,now);assert(!known.includes("mấy người"));
  assert.match(await q(m("Đình Dũng diễn lúc mấy giờ?"),false,load,now),/19h30/);
  assert.match(await q(m("Đình Dũng diễn ở đâu?"),false,load,now),/002 Phan Xi Păng/);
  assert.equal(await q(m("Cho anh đặt vé Đình Dũng"),false,load,now),null);
  assert.equal(await q(m("Đã thanh toán vé Đình Dũng"),false,load,now),null);
  assert.equal(await q(m("Giá vé Đình Dũng và Minh Vương"),false,load,now),null);
  assert.equal(await q(m("Giá vé nghệ sĩ không rõ"),false,load,now),null);
  assert.equal(await q(m("Giá vé"),true,load,now),null);
  assert.equal(await q(m("Giá vé Đình Dũng"),false,async()=>[{...show,date:"2026-11-20"}],now),null);
  assert.equal(await q(m("Giá vé Đình Dũng"),false,async()=>[{...show,prices:{A:0,B:-1}}],now),null);
  console.log("[EXTRA AI Sale] 14 quick-reply acceptance checks passed (price, party size, context, date, venue, unknown/ambiguous and order guards).");
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
function patch(s){
 assert(s.includes("Bổ sung quy tắc hỏi số người")&&s.includes("Quy tắc bắt buộc cho tư vấn và chốt vé EXTRA"));assert(!s.includes("const quickReply="));
 const ast=ts.createSourceFile(f,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="handleInbound");assert(fn?.body);
 const statement=fn.body.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>ts.isIdentifier(d.name)&&d.name.text==="result"&&d.initializer?.getText(ast).startsWith("await agent.generate(")));assert(statement);
 const original=statement.getText(ast);assert(original.startsWith("const result=await agent.generate(")&&original.endsWith(";"));
 const begin=statement.getStart(ast),end=statement.getEnd(),generated=original.slice("const result=".length,-1);
 const replacement='const quickStarted=Date.now();\n  const quickReply=(!action&&!currentOrder&&!latestQuote&&!confirmationProblem&&!needsSupport&&latest?.id===job.source_message_id&&(!state||state.status==="in_progress")&&!state?.current_order_code)?await quickSalesReply(messages,Boolean(commentContext),listAiSalesShows).catch(()=>null):null;\n  if(quickReply)console.info("[ai-sales] Quick information reply prepared in "+(Date.now()-quickStarted)+"ms");\n  const result=quickReply?{text:quickReply}:'+generated+';';
 let edited=s.slice(0,begin)+replacement+s.slice(end);
 const greeting='if(!commentContext&&!history.some(m=>m.sender==="staff"&&m.staff_name==="EXTRA AI"))';
 assert.equal(edited.split(greeting).length,2);edited=edited.replace(greeting,greeting.replace("if(","if(!quickReply&&"));
 assert.equal(edited.split('import "server-only";').length,2);edited=edited.replace('import "server-only";','import "server-only";\nimport {quickSalesReply} from "./ai-sales-quick-reply";');
 assert.equal(ts.createSourceFile(f,edited,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS).parseDiagnostics.length,0);
 assert(edited.includes("await guard(job);")&&edited.includes("await sendAiSalesMessage(job,chat,action);"));
 return edited;
}
(async()=>{await tests();fs.writeFileSync(f,patch(fs.readFileSync(f,"utf8")));console.log("[EXTRA AI Sale] Direct read-only replies integrated before model call; existing send and payment guards retained.");})().catch(e=>{console.error(e);process.exitCode=1;});
