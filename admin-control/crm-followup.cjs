'use strict';

const {staff,assigneeField} = require('./staff-work.cjs');

const threadKeyPattern=/^[a-f0-9]{64}$/;
const statusLabels={new:'Mới',working:'Đang xử lý',resolved:'Đã xử lý'};
const categories={sales:'Nhu cầu mua',support:'Yêu cầu hỗ trợ',general:'Thông tin chung'};
const views={active:'Đang xử lý',resolved:'Đã xử lý',opt_out:'Ngừng liên hệ'};
const pageSize=50;

function initCrmFollowup(pool) {
  return pool.query(`
    create index if not exists os_24h_inbound_thread_idx on os_24h_inbound_events(thread_key,occurred_at desc);
    create table if not exists os_24h_followups (
      thread_key text primary key,
      status text not null check(status in ('new','working','resolved')),
      assignee text,
      note text not null,
      observed_signals integer not null,
      revision integer not null check(revision>0),
      updated_at timestamptz not null default now()
    )
  `);
}

async function listFollowups(pool,{view='active',page=1,staffId=null}={}) {
  const {rows}=await pool.query(`
    with messages as (
      select thread_key,count(*)::int event_count,max(occurred_at) last_at,
        min(occurred_at) filter(where category='opt_out') opt_out_at,
        count(*) filter(where category in ('sales','support'))::int signals,
        (array_agg(category order by occurred_at desc,event_id desc) filter(where category in ('sales','support')))[1] intent
      from os_24h_inbound_events group by thread_key
    ), inbox as (
      select m.*,coalesce(m.intent,'general') category,f.assignee,f.note,coalesce(f.revision,0) revision,
        case when m.opt_out_at is not null then 'opt_out'
          when f.status='resolved' and m.signals>f.observed_signals then 'new'
          else coalesce(f.status,'new')
        end status
      from messages m left join os_24h_followups f using(thread_key)
    )
    select thread_key,event_count,last_at,opt_out_at,category,status,
      case when status='opt_out' then null else assignee end assignee,
      case when status='opt_out' then null else note end note,revision
    from inbox
    where ($2::text is null or (assignee=$2 and opt_out_at is null))
      and ( ($1='active' and status in ('new','working')) or status=$1 )
    order by case when category='support' then 0 when category='sales' then 1 else 2 end,last_at desc,thread_key
    limit $3 offset $4
  `,[view,staffId,pageSize+1,(page-1)*pageSize]);
  return {rows:rows.slice(0,pageSize),more:rows.length>pageSize};
}

function readFollowup(fields) {
  const threadKey=(fields.get('thread_key')??'').trim();
  const rawRev=(fields.get('revision')??'').trim();
  const status=(fields.get('status')??'').trim();
  const note=(fields.get('note')??'').trim();
  const assignee=(fields.get('assignee')??'').trim()||null;
  if (!threadKeyPattern.test(threadKey)||!/^\d{1,9}$/.test(rawRev)||!Object.hasOwn(statusLabels,status)||
      note.length>500||(assignee!==null&&!Object.hasOwn(staff,assignee))) return null;
  return {threadKey,revision:Number(rawRev),status,note,assignee};
}

async function saveFollowup(pool,change,staffId=null) {
  const {threadKey,status,assignee,note,revision}=change;
  const values=[threadKey,status,assignee,note,revision,staffId];
  const allowed=`
    select count(*) filter(where category in ('sales','support'))::int signals
    from os_24h_inbound_events where thread_key=$1
    having count(*)>0 and not bool_or(category='opt_out')
  `;
  const write=staffId===null ? `
    insert into os_24h_followups(thread_key,status,assignee,note,observed_signals,revision)
    select $1,$2,$3,$4,signals,1 from eligible
    where $5::int=0 or exists(select 1 from os_24h_followups where thread_key=$1)
    on conflict(thread_key) do update set status=excluded.status,assignee=excluded.assignee,note=excluded.note,
      observed_signals=excluded.observed_signals,revision=os_24h_followups.revision+1,updated_at=now()
    where os_24h_followups.revision=$5
    returning thread_key,status,assignee,revision` : `
    update os_24h_followups set status=$2,note=$4,observed_signals=eligible.signals,revision=revision+1,updated_at=now()
    from eligible where thread_key=$1 and assignee=$6 and revision=$5 and $3::text is null
    returning thread_key,status,assignee,revision`;
  const {rowCount}=await pool.query(`
    with eligible as (${allowed}), updated as (${write})
    insert into os_audit(event,details)
    select '24h.crm.followup',jsonb_build_object(
      'thread_key',thread_key,'status',status,'assignee',assignee,'revision',revision,'actor',coalesce($6::text,'owner')
    ) from updated returning id
  `,values);
  return rowCount===1;
}

function renderFollowups(inbox,{esc,csrfField,s,staffId=null,view='active',page=1}) {
  const staffView=staffId!==null, title=staffView?'Công việc CRM 24H được giao':'CRM 24H';
  const nav=staffView?'':'<nav aria-label="Lọc hội thoại">'+Object.entries(views).map(([key,label])=>
    '<a href="/crm?view='+key+'"'+(key===view?' aria-current="page"':'')+'>'+esc(label)+'</a>').join('')+'</nav>';
  const base=staffView?'/staff?crmPage=':'/crm?view='+view+'&amp;page=';
  const pager=(page>1?'<a href="'+base+(page-1)+'">Trang trước</a>':'')+
    (inbox.more?'<a href="'+base+(page+1)+'">Trang sau</a>':'');
  const rows=inbox.rows.map(row=>{
    const when=new Date(row.last_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'});
    const tag=row.status==='opt_out'?'Ngừng liên hệ':statusLabels[row.status];
    const controls=row.status==='opt_out'?'': '<form action="'+(staffView?'/staff/crm':'/crm')+'" method="post">'+csrfField(s)+
      '<input type="hidden" name="thread_key" value="'+esc(row.thread_key)+'"><input type="hidden" name="revision" value="'+row.revision+'">'+
      '<label>Trạng thái<select name="status">'+Object.entries(statusLabels).map(([key,label])=>
        '<option value="'+key+'"'+(row.status===key?' selected':'')+'>'+esc(label)+'</option>').join('')+'</select></label>'+
      (staffView?'':assigneeField(row.assignee,esc))+
      '<label>Ghi chú xử lý<input name="note" maxlength="500" value="'+esc(row.note??'')+'"></label><button>Lưu xử lý</button></form>';
    return '<details class="director-job"><summary>'+esc(categories[row.category])+' · '+esc(tag)+' · '+esc(row.thread_key.slice(0,10))+
      '</summary><p>'+esc(row.event_count)+' sự kiện · Cập nhật '+esc(when)+'</p>'+
      (row.assignee&&!staffView?'<p>Người phụ trách '+esc(staff[row.assignee]??'')+'</p>':'')+controls+'</details>';
  }).join('');
  return '<section id="crm-followups"><h2>'+title+'</h2>'+nav+
    (rows||'<p>Chưa có hội thoại trong mục này.</p>')+
    (pager?'<nav aria-label="Trang hộp thư">'+pager+'</nav>':'')+'</section>';
}

module.exports={initCrmFollowup,listFollowups,readFollowup,saveFollowup,renderFollowups};
