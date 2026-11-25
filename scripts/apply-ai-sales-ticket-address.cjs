"use strict";
const fs=require("node:fs"),a=require("node:assert/strict"),ts=require("typescript");
const wf="lib/ai-sales.ts",cf="lib/ai-sales-checkout.ts";
const parse=(f,s)=>{const x=ts.createSourceFile(f,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);a.equal(x.parseDiagnostics.length,0,f+" parse failed");return x;};
const fn=(ast,name)=>{const n=ast.statements.filter(x=>ts.isFunctionDeclaration(x)&&x.name?.text===name&&x.body);a.equal(n.length,1,name);return n[0];};
function edits(s,patches){for(const p of patches.sort((a,b)=>b.start-a.start)){s=s.slice(0,p.start)+p.text+s.slice(p.end);}return s;}
function checkout(s){
 const ast=parse(cf,s),n=fn(ast,"getAiPaidTicketDelivery"),c=[];a.equal(n.parameters.length,2);
 const end=n.parameters[1].getEnd();c.push({start:end,end,text:',address:"anh"|"chị"|"mình"="mình"'});
 const replacements=new Map([["Vé điện tử của bạn: ","Vé điện tử của "],["Bạn giữ kín liên kết vé","giữ kín liên kết vé"],["Bạn có thể mở vé","có thể mở vé"]]);
 const found=new Set();
 function visit(x){if(ts.isStringLiteral(x)){
   let v=x.text,pieces=[],cursor=0;
   const re=/Vé điện tử của bạn: |Bạn giữ kín liên kết vé|Bạn có thể mở vé/g;
   for(const match of v.matchAll(re)){
    const m=match[0],i=match.index;found.add(m);
    if(i>cursor)pieces.push(JSON.stringify(v.slice(cursor,i)));
    if(m==="Vé điện tử của bạn: ")pieces.push('"Vé điện tử của "+address+": "');
    else pieces.push('(address.charAt(0).toUpperCase()+address.slice(1))+" "+'+JSON.stringify(replacements.get(m)));
    cursor=i+m.length;
   }
   if(cursor>0){if(cursor<v.length)pieces.push(JSON.stringify(v.slice(cursor)));c.push({start:x.getStart(ast),end:x.getEnd(),text:"("+pieces.join("+")+")"});}
 }ts.forEachChild(x,visit);}visit(n.body);a.equal(found.size,3,"Expected fixed ticket copy");
 const result=edits(s,c);parse(cf,result);return result;
}
function worker(s){
 a(s.includes("function extraPaymentAddress(")&&s.includes("extraSendPaymentQr("));
 const ast=parse(wf,s),c=[];let calls=0;
 for(const name of ["handleInbound","handlePaid"]){
  const n=fn(ast,name);let count=0;
  function visit(x){if(ts.isCallExpression(x)&&ts.isIdentifier(x.expression)&&x.expression.text==="getAiPaidTicketDelivery"){
   a.equal(x.arguments.length,2);const end=x.arguments[1].getEnd();
   c.push({start:end,end,text:name==="handleInbound"?",extraPaymentAddress(history)":",extraPaymentAddress(await extraTicketAddressHistory(chat.id))"});count++;calls++;
  }ts.forEachChild(x,visit);}visit(n.body);a.equal(count,1,name+" delivery call");
 }
 a.equal(calls,2);
 const out=edits(s,c)+'\nasync function extraTicketAddressHistory(chatId:string):Promise<Message[]>{\n  try{return await staffDb("extra_support_messages?chat_id=eq."+encodeURIComponent(chatId)+"&select=id,sender,body,staff_name,created_at&order=id.desc&limit=24") as Message[];}catch{return [];}\n}\n';
 parse(wf,out);return out;
}
const c=fs.readFileSync(cf,"utf8"),w=fs.readFileSync(wf,"utf8");
const co=checkout(c),wo=worker(w);
// Exercise the actual compiled template, with fake data and no network.
const ast=parse(cf,co),n=fn(ast,"getAiPaidTicketDelivery"),body=n.body.getText(ast);
const decl=n.body.statements.find(x=>ts.isVariableStatement(x)&&x.declarationList.declarations.some(d=>d.name.getText(ast)==="message"));
a(decl,"Missing ticket message declaration");
const expr=decl.declarationList.declarations.find(d=>d.name.getText(ast)==="message").initializer.getText(ast);
const render=new Function("address","current","code","url","emailStatus","money","return "+expr);
const link="https://iextra.net/ve?token=fixture",data={amount_vnd:948100,seats:["C01","C02"]},money=v=>String(v);
for(const address of ["anh","chị","mình"]){
 for(const state of ["sent","queued"]){
  const out=render(address,data,"EXTEST",link,state,money);
  a(out.includes("Vé điện tử của "+address+": "+link));a(out.includes("C01, C02"));a(out.includes("948100"));a(!/của bạn|Bạn giữ kín|Bạn có thể/.test(out));a(out.includes(address.charAt(0).toUpperCase()+address.slice(1)+" giữ kín"));if(state==="sent")a(out.includes("email đã đăng ký"));
 }
}
a(wo.includes("extraPaymentAddress(history)"));a(wo.includes("extraPaymentAddress(await extraTicketAddressHistory(chat.id))"));a(body.includes('status!=="paid"'));a(body.includes("hasCompleteIssuedTickets"));
fs.writeFileSync(cf,co);fs.writeFileSync(wf,wo);
console.log("[EXTRA AI Sale] Six ticket address tests passed (anh/chi/minh, email sent/queued); existing paid-order ownership and issued-ticket guards retained; original ticket URL, page design and email unchanged.");