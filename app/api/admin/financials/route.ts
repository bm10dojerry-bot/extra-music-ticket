import {NextRequest,NextResponse} from "next/server";
import {requireRole,staffDb} from "../../../../lib/staff-auth";
export const dynamic="force-dynamic";
const fields=["artist_fee","venue_fee","sound_lighting","labor","advertising","band","tax","sale_commission","logistics","security","miscellaneous"] as const;
export async function GET(){
 if(!await requireRole(["admin","accountant"]))return NextResponse.json({error:"Không có quyền xem tài chính"},{status:403});
 try{return NextResponse.json({costs:await staffDb("show_financial_costs?select=*&limit=1000")},{headers:{"Cache-Control":"no-store"}})}catch{return NextResponse.json({error:"Không tải được chi phí show"},{status:503})}
}
export async function POST(req:NextRequest){
 if(!await requireRole(["admin","accountant"]))return NextResponse.json({error:"Không có quyền cập nhật chi phí"},{status:403});
 const body=await req.json().catch(()=>null) as Record<string,unknown>|null;
 if(!body)return NextResponse.json({error:"Dữ liệu không hợp lệ"},{status:400});
 const show_id=String(body.show_id||"");
 if(!/^[a-z0-9-]{3,100}$/.test(show_id))return NextResponse.json({error:"Mã show không hợp lệ"},{status:400});
 const record:Record<string,string|number>={show_id,updated_at:new Date().toISOString()};
 for(const field of fields){const v=body[field];if(typeof v!=="number"||!Number.isSafeInteger(v)||v<0||v>100000000000)return NextResponse.json({error:"Chi phí "+field+" không hợp lệ"},{status:400});record[field]=v}
 const notes=String(body.notes||"");if(notes.length>2000)return NextResponse.json({error:"Ghi chú quá dài"},{status:400});record.notes=notes;
 try{await staffDb("show_financial_costs?on_conflict=show_id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(record)});return NextResponse.json({ok:true})}catch{return NextResponse.json({error:"Không lưu được chi phí. Kiểm tra show đã tồn tại."},{status:503})}
}
