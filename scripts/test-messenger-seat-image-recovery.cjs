"use strict";
const fs=require("node:fs"),ts=require("typescript"),test=require("node:test"),assert=require("node:assert/strict");
const source=fs.readFileSync("lib/messenger-seat-image-recovery.ts","utf8");
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};
new Function("require","module","exports",code)(id=>({
 "server-only":{},"./facebook-messenger":{},"./staff-auth":{},"./ai-sales-policy":{},
 "./messenger-show-signals":{metaImageURL:v=>typeof v==="string"&&/^https:\/\/[a-z.]+\.fbcdn\.net\//.test(v)?new URL(v):null}
}[id]||require(id)),mod,mod.exports);
const {selectMissedImage}=mod.exports;
const now=Date.parse("2026-11-27T06:52:00Z"),page="12345678",psid="87654321";
const last={id:1,sender:"staff",staff_name:"EXTRA AI",body:"Mình có thể chấm, khoanh trực tiếp ghế trên ảnh",external_message_id:"m_map123",created_at:"2026-11-27T06:50:00Z"};
const prev={id:"m_map123",from:{id:page},to:{data:[{id:psid}]},created_time:last.created_at};
const img={id:"m_image123",from:{id:psid},to:{data:[{id:page}]},created_time:"2026-11-27T06:51:00Z",attachments:{data:[{image_data:{url:"https://scontent.fbcdn.net/map.png"}}]}};
test("recover newest verified image only",()=>assert.equal(selectMissedImage([img,prev],last,page,psid,now).mid,img.id));
for(const [name,m,p,l] of [
 ["wrong sender",{...img,from:{id:"11111111"}},prev,last],
 ["wrong page",{...img,to:{data:[{id:"11111111"}]}},prev,last],
 ["unmatched prior outbound",img,{...prev,id:"m_other"},last],
 ["text caption not recovered",{...img,message:"OK"},prev,last],
 ["old image",{...img,created_time:"2026-11-27T06:30:00Z"},prev,last],
 ["sticker",{...img,attachments:{data:[{image_data:{url:"https://scontent.fbcdn.net/map.png",render_as_sticker:true}}]}},prev,last],
 ["unsafe URL",{...img,attachments:{data:[{image_data:{url:"https://example.com/map.png"}}]}},prev,last],
 ["human prompt",img,prev,{...last,staff_name:"Sale"}],
 ["unrelated prompt",img,prev,{...last,body:"Xin chào"}],
 ["multiple images",{...img,attachments:{data:[img.attachments.data[0],img.attachments.data[0]]}},prev,last]
])test(name,()=>assert.equal(selectMissedImage([m,p],l,page,psid,now),null));
