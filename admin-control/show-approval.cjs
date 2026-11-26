'use strict';

const {roleNames}=require('./live-director.cjs');
const {computeShowEconomics,adIncreaseBlockReason}=require('./show-economics.cjs');
const {uuid}=require('./director-program.cjs');
const {reportDay}=require('./daily-reports.cjs');
const {proposalPlatform}=require('./daily-director.cjs');

const periods=new Set(['day','week','month']);
const causes={
  invalid_model_report:'Kết quả mô hình chưa qua kiểm tra.',
  invalid_campaign_fields:'Chỉ tiêu, phân công hoặc thời hạn cần được sửa.',
  invalid_review:'Director chưa đối chiếu đủ báo cáo của từng Agent.',
  provider_quota_exhausted:'Mô hình đã hết hạn mức API.',
  provider_rate_limited:'Mô hình đang bị giới hạn tốc độ.',
  provider_http_429:'Nhà cung cấp đang giới hạn lượt gọi.',
  missing_model_key:'Chưa cấu hình mô hình cho Director.',
  model_disabled:'Mô hình đang tắt.',
  missing_call_limit:'Chưa cấu hình lượt gọi mô hình.',
  no_actionable_campaign:'Director chưa lập được chiến dịch đủ điều kiện.'
};
function initShowApprovals(pool){
  return pool.query(`create table if not exists os_music_show_approvals (
    run_id uuid not null references os_live_director_runs(id), response_id text not null,
    show_id text not null, campaign jsonb not null, approved_at timestamptz not null default now(),
    primary key (run_id,response_id,show_id))`);
}
function proposalState(run,show,now=new Date(),sources={}){
  if(!run)return {reason:'Chưa có phiên Director cho kỳ đã chọn.'};
  const results=run.results??{};
  const count=roleNames.filter(role=>results[role]?.responseId).length;
  const completed=count+'/11 Agent đã gửi báo cáo.';
  if(run.status==='blocked')return {reason:'Director đang bị chặn. '+(causes[run.reason]??'Phiên phân tích chưa đạt kiểm tra.')+' '+completed};
  if(run.status!=='ready'||count!==roleNames.length)return {reason:'Đang chờ Director tổng hợp và kiểm tra. '+completed};
  const final=results.DirectorFinal;
  if(!final?.responseId||final.analysisVersion!==1)return {reason:'Đang chờ Director phân tích lại sức bán và hiệu quả chi phí của show.'};
  const campaign=final.output?.campaigns?.find(c=>c.showId===show?.id);
  if(!campaign)return {reason:'Kỳ này chưa có đề xuất riêng cho show đã chọn.'};
  const revision=final.responseId;
  const scheduled=show.time&&/^\d{2}:\d{2}(?::\d{2})?$/.test(show.time)?show.date+'T'+show.time+'+07:00':null;
  if(!['announced','pending','sold_out','live'].includes(show.status)||show.date<reportDay(null,now)||scheduled&&Date.parse(scheduled)<=now.getTime())
    return {revision,reason:'Show đã tới giờ diễn hoặc đã ngừng nhận đề xuất.'};
  if(!(Date.parse(campaign.deadline)>now.getTime()))return {revision,reason:'Đã qua thời hạn của phương án này.'};
  if(campaign.proposedBudgetVnd>0||campaign.economicReview?.adAction==='increase'){
    const row=sources.finance?.data?.rows?.find(r=>r.showId===show.id);
    const economics=computeShowEconomics(show,reportDay(null,now),row,sources.signals,sources.checkedAt);
    const reason=adIncreaseBlockReason(economics);
    if(reason)return {revision,reason};
  }
  return {revision,campaign};
}
async function readShowApproval(pool,run,show,state){
  if(!state.revision)return null;
  const result=await pool.query('select approved_at from os_music_show_approvals where run_id=$1 and response_id=$2 and show_id=$3',[run.id,state.revision,show.id]);
  return result.rows[0]?.approved_at??null;
}
function approvalPanel({run,show,period,day,csrf,state,approvedAt,esc}){
  const title='Phê duyệt đề xuất';
  if(approvedAt)return '<p><strong>Đã phê duyệt đề xuất</strong> · '+esc(new Date(approvedAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}))+' (giờ Việt Nam).</p>';
  if(state.reason)return '<p><button type="button" disabled aria-describedby="approval-note">'+title+'</button></p><p id="approval-note">'+esc(state.reason)+'</p>';
  const values={csrf,run:run.id,revision:state.revision,show:show.id,period,day};
  const fields=Object.entries(values).map(([name,value])=>'<input type="hidden" name="'+name+'" value="'+esc(value)+'">').join('');
  return '<form method="post" action="/proposals/music/approve">'+fields+'<button>'+title+'</button><p>Ghi nhận duyệt phương án nội bộ cho '+esc(show.artist)+'. Việc đăng bài và chi ngân sách cần quyền thực thi riêng.</p></form>';
}
async function approveShow(pool,fields,show,sources={},now=new Date()){
  const period=fields.get('period'),day=fields.get('day'),runId=fields.get('run'),revision=fields.get('revision');
  if(!periods.has(period)||!day||day!==reportDay(day,now)||!uuid.test(runId??'')||!revision||revision.length>200||!show||fields.get('show')!==show.id)return false;
  const client=await pool.connect();
  try{
    await client.query('begin');
    const run=(await client.query(`select id,status,reason,results from os_live_director_runs
      where id=$1 and platform=$2 and day=$3::date for share`,[runId,proposalPlatform('music',period),day])).rows[0];
    const state=proposalState(run,show,now,sources);
    if(state.revision!==revision||!state.campaign){await client.query('rollback');return false;}
    await client.query(`insert into os_music_show_approvals(run_id,response_id,show_id,campaign)
      values($1,$2,$3,$4::jsonb) on conflict(run_id,response_id,show_id) do nothing`,[runId,revision,show.id,JSON.stringify(state.campaign)]);
    await client.query('commit');return true;
  }catch(error){await client.query('rollback');throw error;}finally{client.release();}
}
module.exports={initShowApprovals,proposalState,readShowApproval,approvalPanel,approveShow};
