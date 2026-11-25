'use strict';

const {randomBytes,createHash} = require('node:crypto');

const staff = Object.freeze({dieu:'Diệu',trang:'Trang',yen:'Yến',hai:'Hải',binh:'Bình'});
const taskStatuses = ['pending','in_progress','submitted','accepted','blocked'];
const tokenPattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const cookieName = '__Host-extra_os_staff';
const secret = () => randomBytes(32).toString('hex');
const digest = value => createHash('sha256').update(value).digest('hex');
const validRevision = value => Number.isInteger(value) && value>=0 && value<2147483647;
const member = id => typeof id==='string' && Object.hasOwn(staff,id);

async function initStaffWork(pool) {
  await pool.query(`
    alter table os_tasks add column if not exists assignee text, add column if not exists revision integer not null default 0;
    create index if not exists os_tasks_by_assignee on os_tasks(assignee) where assignee is not null;
    create table if not exists os_staff_access (
      staff_id text primary key,
      code_hash text not null unique,
      expires_at timestamptz not null
    );
    create table if not exists os_staff_sessions (
      token_hash text primary key,
      staff_id text not null,
      csrf text not null,
      expires_at timestamptz not null
    );
    create index if not exists os_staff_session_expiry on os_staff_sessions(expires_at);
  `);
}

async function issueCode(pool,staffId) {
  if (!member(staffId)) return null;
  const code=secret();
  await pool.query('delete from os_staff_sessions where expires_at<=now()');
  await pool.query(`
    insert into os_staff_access (staff_id,code_hash,expires_at)
    values ($1,$2,now()+interval '1 hour')
    on conflict(staff_id) do update set code_hash=excluded.code_hash,expires_at=excluded.expires_at
  `,[staffId,digest(code)]);
  return code;
}

async function signIn(pool,code) {
  if (!tokenPattern.test(code ?? '')) return null;
  const token=secret();
  const {rows:[session]}=await pool.query(`
    with claimed as (
      delete from os_staff_access where code_hash=$1 and expires_at>now()
      returning staff_id
    )
    insert into os_staff_sessions (token_hash,staff_id,csrf,expires_at)
    select $2,staff_id,$3,now()+interval '8 hours' from claimed returning staff_id
  `,[digest(code),digest(token),secret()]);
  return session ? {token,staffId:session.staff_id} : null;
}

async function currentSession(pool,request) {
  const cookie=String(request.headers.cookie ?? '').split(';').map(part=>part.trim())
    .find(part=>part.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  if (!tokenPattern.test(cookie ?? '')) return null;
  const {rows:[session]}=await pool.query(`
    select token_hash,staff_id,csrf from os_staff_sessions where token_hash=$1 and expires_at>now()
  `,[digest(cookie)]);
  return member(session?.staff_id) ? session : null;
}

async function listStaffTasks(pool,staffId) {
  const {rows}=await pool.query(`
    select t.show_id,t.key,t.status,t.definition,t.note,t.revision,s.intake->>'artist' as artist
    from os_tasks t join os_shows s on s.id=t.show_id where t.assignee=$1
    order by case t.status when 'in_progress' then 0 when 'pending' then 1 when 'blocked' then 2
      when 'submitted' then 3 else 4 end,t.definition->>'due_at' asc,t.show_id,t.key limit 150
  `,[staffId]);
  return rows;
}

async function reportStaffTask(pool,staffId,{id,key,action,note,revision}) {
  if (!member(staffId) || !uuidPattern.test(id ?? '') || !key || key.length>120 ||
      !['start','submit'].includes(action) || !validRevision(revision) || note.length>2000 || (action==='submit' && !note)) return false;
  const status=action==='start'?'in_progress':'submitted';
  const allowed=action==='start'?['pending','blocked']:['pending','in_progress','blocked'];
  const {rowCount}=await pool.query(`
    with updated as (
      update os_tasks set status=$4,note=case when $4='submitted' then $5 else note end,revision=revision+1
      where show_id=$1 and key=$2 and assignee=$3 and status=any($6::text[]) and revision=$7 returning show_id,key,status
    )
    insert into os_audit (event,details)
    select 'staff.task.'||status,jsonb_build_object('show_id',show_id,'key',key,'staff_id',$3::text)
    from updated returning id
  `,[id,key,staffId,status,note,allowed,revision]);
  return rowCount===1;
}

async function updateShowTask(pool,{id,key,status,note,assignee,revision}) {
  if (!uuidPattern.test(id ?? '') || !key || key.length>120 || !taskStatuses.includes(status) ||
      note.length>2000 || (revision!==null && !validRevision(revision)) || (assignee!==null && assignee!=='' && !member(assignee))) return false;
  const {rowCount}=await pool.query(`
    with updated as (
      update os_tasks set status=$3,note=$4,
        assignee=case when $5::text is null then assignee else nullif($5,'') end,revision=revision+1
      where show_id=$1 and key=$2 and ($6::int is null or revision=$6) returning show_id,key,status,assignee
    )
    insert into os_audit (event,details)
    select 'task.updated',jsonb_build_object('show_id',show_id,'key',key,'status',status,'assignee',assignee)
    from updated returning id
  `,[id,key,status,note,assignee,revision]);
  return rowCount===1;
}

const getCookie=(token,age)=>cookieName+'='+token+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+age;
const options = (selected,esc) => Object.entries(staff).map(([id,name])=>
  '<option value="'+id+'"'+(selected===id?' selected':'')+'>'+esc(name)+'</option>').join('');

function assigneeField(selected,esc) {
  return '<label>Người phụ trách<select name="assignee"><option value="">Chưa phân công</option>'+
    options(selected,esc)+'</select></label>';
}

function staffAccessPage({csrfField,esc},session,issued) {
  const result=issued ? '<section><h2>Mã vào cổng cho '+esc(staff[issued.staffId])+'</h2>'+
      '<label>Mã truy cập<input readonly value="'+esc(issued.code)+'"></label><p>Mã có hiệu lực một giờ và dùng một lần.</p></section>' : '';
  return '<main><a href="/#shows">‹ Công việc theo show</a><h1>Truy cập nhân sự</h1>'+
    '<p>Nhân sự dùng mã được cấp tại <a href="/staff">Cổng nhân sự staging</a>.</p>'+result+
    '<form action="/staff/access" method="post">'+csrfField(session)+'<label for="staff-id">Nhân sự</label><select id="staff-id" required name="staff_id">'+
    options(null,esc)+'</select><button>Tạo mã truy cập</button></form></main>';
}

function makeStaffPortal(pool,{form,eq,esc,html,redirect,statusLabels,csrfField}) {
  const signInPage=(message='')=>'<main class="login"><section><h1>Cổng nhân sự</h1><p>EXTRA OS staging</p>'+
    (message?'<p role="alert">'+esc(message)+'</p>':'')+
    '<form action="/staff/login" method="post"><label>Mã truy cập<input type="password" name="code" required maxlength="64" autocomplete="one-time-code"></label>'+
    '<button>Vào cổng nhân sự</button></form></section></main>';

  function displayTasks(session,tasks){
    const articles=tasks.map(task=>{
      const {definition}=task;
      const start=['pending','blocked'].includes(task.status);
      const submit=['pending','in_progress','blocked'].includes(task.status);
      const metadata=csrfField(session)+'<input type="hidden" name="id" value="'+esc(task.show_id)+
        '"><input type="hidden" name="key" value="'+esc(task.key)+'"><input type="hidden" name="revision" value="'+task.revision+'">';
      return '<section><small>'+esc(task.artist)+'</small><h2>'+esc(definition.title)+'</h2>'+
        '<p>'+esc(definition.requirements)+'</p>'+
        '<p><strong>'+esc(statusLabels[task.status])+'</strong>'+
        (definition.due_at?' · Hạn '+esc(new Date(definition.due_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})):'')+
        '</p>'+(task.note?'<p>'+esc(task.note)+'</p>':'')+
        (submit ? '<form action="/staff/task" method="post">'+metadata+
          '<label>Báo cáo công việc<textarea name="note" maxlength="2000"></textarea></label>'+
          (start ? '<button name="action" value="start" formnovalidate>Bắt đầu</button> ' : '')+
          '<button name="action" value="submit">Gửi báo cáo</button></form>' : '')+'</section>';
    }).join('');
    return '<main><h1>Công việc của '+esc(staff[session.staff_id])+'</h1><p>EXTRA OS staging</p>'+
      '<form action="/staff/logout" method="post">'+csrfField(session)+'<button>Đăng xuất</button></form>'+
      (articles||'<p>Chưa có công việc được giao.</p>')+'</main>';
  }

  return async (req,res,path)=>{
    if(req.method==='POST'&&path==='/staff/login'){
      if(req.headers['sec-fetch-site']==='cross-site')return html(res,signInPage(),403);
      const fields=await form(req);
      const session=await signIn(pool,(fields.get('code') ?? '').trim().toLowerCase());
      if(!session)return html(res,signInPage('Mã truy cập sai, đã dùng hoặc hết hạn.'),401);
      return redirect(res,'/staff',getCookie(session.token,28800));
    }
    const session=await currentSession(pool,req);
    if(req.method==='GET'&&path==='/staff'){
      if(!session)return html(res,signInPage());
      return html(res,displayTasks(session,await listStaffTasks(pool,session.staff_id)));
    }
    if(!session)return html(res,signInPage(),401);
    if(req.method!=='POST')return html(res,'<main>Không tìm thấy.</main>',404);
    const fields=await form(req);
    if(!eq(fields.get('csrf')||'',session.csrf))return html(res,'<main>Yêu cầu không hợp lệ.</main>',403);
    if(path==='/staff/logout'){
      await pool.query('delete from os_staff_sessions where token_hash=$1',[session.token_hash]);
      return redirect(res,'/staff',getCookie('',0));
    }
    if(path==='/staff/task'){
      const updated=await reportStaffTask(pool,session.staff_id,{
        id:fields.get('id'),key:fields.get('key'),action:fields.get('action'),note:(fields.get('note') ?? '').trim(),
        revision:/^\d+$/.test(fields.get('revision') ?? '') ? Number(fields.get('revision')) : NaN
      });
      if(updated)return redirect(res,'/staff');
      return html(res,'<main><p>Công việc đã thay đổi hoặc thiếu nội dung báo cáo.</p><a href="/staff">Quay lại công việc</a></main>',409);
    }
    return html(res,'<main>Không tìm thấy.</main>',404);
  };
}

module.exports = {initStaffWork,issueCode,signIn,listStaffTasks,reportStaffTask,updateShowTask,assigneeField,staffAccessPage,makeStaffPortal};
