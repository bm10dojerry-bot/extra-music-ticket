'use strict';

const {randomUUID} = require('node:crypto');

const terminal = ['accepted', 'blocked', 'failed'];
const groups = ['queued', 'running', 'reported'];
const maxAttempts = 3;
const maxRevisions = 2;

async function initDirectorQueue(pool) {
  await pool.query(`
    create table if not exists os_director_runs (
      id uuid primary key,
      request_id uuid not null unique,
      platform text not null,
      input jsonb not null,
      deadline timestamptz not null,
      created_at timestamptz not null default now()
    );
    create table if not exists os_director_jobs (
      id uuid primary key,
      run_id uuid not null references os_director_runs(id),
      kind text not null,
      agent text not null,
      assigned_by text not null,
      objective text not null,
      needs text[] not null,
      observes text[] not null,
      permissions text[] not null,
      budget_vnd bigint not null check (budget_vnd >= 0),
      deadline timestamptz not null,
      status text not null check (status in ('queued','running','reported','accepted','blocked','failed')),
      available_at timestamptz not null default now(),
      lease_id uuid,
      lease_until timestamptz,
      attempts int not null default 0,
      revision int not null default 0,
      result jsonb,
      issues text[] not null default '{}',
      feedback text,
      updated_at timestamptz not null default now(),
      unique (run_id,kind)
    );
    create index if not exists os_director_queue
      on os_director_jobs (available_at, run_id, kind)
      where status = 'queued' or status = 'reported';
    create table if not exists os_director_events (
      id bigint generated always as identity primary key,
      job_id uuid not null references os_director_jobs(id),
      event text not null,
      detail jsonb not null,
      created_at timestamptz not null default now()
    );
    create index if not exists os_director_events_job on os_director_events(job_id,id desc);
    create table if not exists os_director_knowledge (
      run_id uuid not null references os_director_runs(id),
      version integer not null,
      task_id uuid not null references os_director_jobs(id),
      revision integer not null,
      bundle jsonb not null,
      validated_at timestamptz,
      active boolean not null default false,
      created_at timestamptz not null default now(),
      primary key(run_id,version),
      unique(task_id,revision)
    );
    create unique index if not exists os_director_one_knowledge
      on os_director_knowledge(run_id) where active;
  `);
}

async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function event(db, jobId, name, detail = {}) {
  return db.query('insert into os_director_events (job_id,event,detail) values ($1,$2,$3)', [jobId,name,detail]);
}

function queueDirector(pool, requestId, input, definitions) {
  return transaction(pool, async db => {
    const runId = randomUUID();
    const created = await db.query(`
      insert into os_director_runs (id,request_id,platform,input,deadline)
      values ($1,$2,'24h',$3,now()+interval '24 hours')
      on conflict(request_id) do nothing returning id,deadline
    `, [runId,requestId,input]);
    if (!created.rowCount) {
      const existing = await db.query('select id from os_director_runs where request_id=$1',[requestId]);
      return existing.rows[0].id;
    }
    const deadline = created.rows[0].deadline;
    for (const definition of definitions) {
      const id = randomUUID();
      const {kind,agent,objective,needs,observes,permissions,budgetVnd} = definition;
      await db.query(`
        insert into os_director_jobs
          (id,run_id,kind,agent,assigned_by,objective,needs,observes,permissions,budget_vnd,deadline,status)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'queued')
      `, [id,runId,kind,agent,kind === 'brief' ? 'Owner' : 'Director',objective,needs,observes,permissions,budgetVnd,deadline]);
      await event(db,id,'assigned',{needs,observes,permissions,budgetVnd});
    }
    return runId;
  });
}

async function settleUnavailable(db) {
  const {rows} = await db.query(`
    with due as (
      select j.id,
        case
          when j.deadline <= now() then 'Hết hạn thực thi'
          when j.status = 'running' then 'Hết số lần thử lại sau khi mất lượt xử lý'
          else 'Đầu việc phụ thuộc đang chờ hoặc đã thất bại'
        end reason,
        case when j.status='queued' and j.deadline>now() then 'blocked' else 'failed' end next_status
      from os_director_jobs j
      where (j.status='queued' and (j.deadline<=now() or exists (
        select 1 from os_director_jobs d where d.run_id=j.run_id
          and d.kind=any(j.needs) and d.status in ('blocked','failed')
      ))) or (j.status='running' and j.lease_until<=now() and (j.attempts >= $1 or j.deadline<=now()))
      order by j.available_at, j.id
      limit 50
      for update of j skip locked
    )
    update os_director_jobs j set status=due.next_status,issues=array[due.reason],lease_id=null,lease_until=null,updated_at=now()
    from due where due.id=j.id returning j.id,j.status,j.issues
  `, [maxAttempts]);
  for (const job of rows) await event(db,job.id,job.status,{issues:job.issues});
}

function claim(pool) {
  return transaction(pool, async db => {
    await settleUnavailable(db);
    const {rows} = await db.query(`
      with candidate as (
        select j.id from os_director_jobs j join os_director_runs r on r.id=j.run_id
        where j.deadline>now() and (
          (j.status='running' and j.lease_until<=now() and j.attempts < $1)
          or (j.status='queued' and j.available_at<=now() and not exists (
            select 1 from os_director_jobs d where d.run_id=j.run_id and
              ((d.kind=any(j.needs) and d.status<>'accepted')
              or (d.kind=any(j.observes) and d.status<>all($2::text[])))
          ))
        )
        order by (r.input->>'mode'='sample') asc nulls first,
          (j.kind in ('brief','forecast','audit','report')) desc,j.available_at,j.kind,j.id
        limit 1 for update of j skip locked
      )
      update os_director_jobs j set status='running',attempts=j.attempts+1,
        lease_id=$3,lease_until=now()+interval '240 seconds',updated_at=now()
      from candidate c,os_director_runs r where j.id=c.id and r.id=j.run_id
      returning j.*,r.input,r.platform,r.created_at as run_created_at
    `, [maxAttempts,terminal,randomUUID()]);
    const job = rows[0];
    if (job) await event(db,job.id,'started',{attempt:job.attempts,revision:job.revision});
    return job;
  });
}

async function jobContext(pool, job) {
  const {rows} = await pool.query(`
    select kind,agent,status,result,issues,revision,attempts from os_director_jobs
    where run_id=$1 and (kind=any($2) or kind=any($3)) order by kind
  `, [job.run_id,job.needs,job.observes]);
  return Object.fromEntries(rows.map(row => [row.kind,row]));
}

function report(pool, job, outcome) {
  return transaction(pool, async db => {
    const {rows} = await db.query(`
      update os_director_jobs
      set status=$3,result=$4,issues=$5,lease_id=null,lease_until=null,updated_at=now(),
        available_at=now()+make_interval(secs=>$6)
      where id=$1 and lease_id=$2 and status='running' and lease_until>now()
      returning id
    `, [job.id,job.lease_id,outcome.status,outcome.result ?? null,outcome.issues ?? [],outcome.delay ?? 0]);
    if (rows.length) await event(db,job.id,outcome.status === 'queued' ? 'retry_scheduled' : outcome.status,{
      attempt:job.attempts,revision:job.revision,result:outcome.result ?? null,issues:outcome.issues ?? []
    });
    return rows.length > 0;
  });
}

async function saveKnowledge(db, job) {
  await db.query(`
    insert into os_director_knowledge (run_id,version,task_id,revision,bundle)
    select $1,coalesce(max(version),0)+1,$2,$3,$4 from os_director_knowledge where run_id=$1
  `, [job.run_id,job.id,job.revision,job.result]);
}

async function activateKnowledge(db, runId, version, validation) {
  const {rows} = await db.query(`
    select version from os_director_knowledge
    where run_id=$1 and version=$2 and ($3 or validated_at is not null)
  `, [runId,version,validation]);
  if (!rows.length) return false;
  await db.query('update os_director_knowledge set active=false where run_id=$1 and active',[runId]);
  await db.query(`
    update os_director_knowledge set active=true,validated_at=coalesce(validated_at,now())
    where run_id=$1 and version=$2
  `, [runId,version]);
  return true;
}

function reviewNext(pool, evaluate) {
  return transaction(pool, async db => {
    // Serialize acceptance with owner feedback and knowledge rollback for the same run.
    const {rows:[run]} = await db.query(`
      select r.id,r.input->>'mode' as mode from os_director_runs r
      where exists (select 1 from os_director_jobs j where j.run_id=r.id and j.status='reported')
      order by r.created_at,r.id limit 1 for update of r skip locked
    `);
    if (!run) return false;
    const {rows:[job]} = await db.query(`
      select * from os_director_jobs where run_id=$1 and status='reported'
      order by updated_at,id limit 1 for update
    `, [run.id]);
    if (!job) return false;
    const feedback = evaluate(job);
    if (feedback) {
      const canRevise = job.revision < maxRevisions && job.deadline > new Date();
      await db.query(`
        update os_director_jobs set status=$2,feedback=$3,issues=array[$3],
          revision=revision+case when $2='queued' then 1 else 0 end,attempts=0,available_at=now(),updated_at=now()
        where id=$1
      `, [job.id,canRevise ? 'queued' : 'failed',feedback]);
      await event(db,job.id,canRevise ? 'revision_requested' : 'review_failed',{feedback,revision:job.revision});
      if (canRevise && job.kind === 'sale_rehearsal') {
        const trainingFeedback = 'Sale chưa qua kiểm tra. Cập nhật bài học trước khi diễn tập lại. ' + feedback;
        const {rows:[training]} = await db.query(`
          update os_director_jobs set status='queued',feedback=$2,revision=revision+1,attempts=0,available_at=now(),updated_at=now()
          where run_id=$1 and kind='training' and status='accepted' returning id,revision
        `, [run.id,trainingFeedback]);
        if (training) await event(db,training.id,'revision_requested',{feedback:trainingFeedback,revision:training.revision});
      }

      return true;
    }
    if (job.kind === 'training') await saveKnowledge(db,job);
    if (job.kind === 'sale_rehearsal' && !(await activateKnowledge(db,run.id,job.result.knowledgeVersion,true))) {
      throw Error('Knowledge version missing during acceptance');
    }
    await db.query(`
      update os_director_jobs set status='accepted',issues='{}',updated_at=now() where id=$1
    `, [job.id]);
    await event(db,job.id,'accepted',{revision:job.revision});
    return job.kind==='report' ? {runId:run.id,mode:run.mode,report:job.result} : true;
  });
}

async function knowledgeVersion(pool, runId) {
  const {rows:[row]} = await pool.query(`
    with candidate as (
      select k.version,k.bundle,k.validated_at from os_director_knowledge k
      join os_director_jobs j on j.id=k.task_id and j.revision=k.revision and j.status='accepted'
      where k.run_id=$1 order by version desc limit 1
    )
    select k.version,k.bundle from os_director_knowledge k join candidate c on (
      (c.validated_at is null and k.version=c.version) or
      (c.validated_at is not null and k.active)
    ) where k.run_id=$1
  `, [runId]);
  return row;
}

function revise(pool, jobId, feedback) {
  return transaction(pool, async db => {
    const {rows:[run]} = await db.query(`
      select r.id from os_director_runs r join os_director_jobs j on j.run_id=r.id
      where j.id=$1 for update of r
    `, [jobId]);
    if (!run) return false;
    // Lock the jobs in this run before taking the dependency snapshot. Claimers skip locked rows.
    const {rows:jobs} = await db.query('select * from os_director_jobs where run_id=$1 order by id for update',[run.id]);
    const job = jobs.find(row => row.id === jobId);
    if (!terminal.includes(job.status)) return false;
    const affected = new Set([job.kind]);
    for (let size = 0; size !== affected.size;) {
      size = affected.size;
      for (const next of jobs) {
        if ([...next.needs,...next.observes].some(kind => affected.has(kind))) affected.add(next.kind);
      }
    }
    const reopening = jobs.filter(row => affected.has(row.kind));
    if (reopening.some(row => groups.includes(row.status) && row.status !== 'queued')) return false;
    await db.query(`
      update os_director_jobs set status='queued',attempts=0,revision=revision+1,feedback=null,
        result=null,issues='{}',available_at=now(),updated_at=now(),deadline=now()+interval '24 hours'
      where id=any($1::uuid[])
    `, [reopening.map(row=>row.id)]);
    await db.query('update os_director_jobs set feedback=$2 where id=$1',[jobId,feedback]);
    for (const reopened of reopening) {
      await event(db,reopened.id,'owner_revision',{source:job.kind,feedback,previousRevision:reopened.revision});
    }
    return true;
  });
}

function restoreKnowledge(pool, runId, version) {
  return transaction(pool, async db => {
    const {rowCount} = await db.query('select id from os_director_runs where id=$1 for update',[runId]);
    if (!rowCount || !(await activateKnowledge(db,runId,version,false))) return false;
    const {rows:[job]} = await db.query("select id from os_director_jobs where run_id=$1 and kind='training'",[runId]);
    await event(db,job.id,'knowledge_restored',{version});
    return true;
  });
}

async function listRuns(pool, runId) {
  const recent = await pool.query(`
    select r.*,(
      select jsonb_object_agg(status,total) from
        (select status,count(*)::int total from os_director_jobs where run_id=r.id group by status) counts
    ) counts from os_director_runs r order by created_at desc limit 20
  `);
  const selected = runId
    ? (await pool.query('select * from os_director_runs where id=$1',[runId])).rows[0]
    : recent.rows.find(run=>run.input.mode!=='sample') ?? recent.rows[0];
  const jobs = selected ? await pool.query(`
    select j.*, (
      select coalesce(jsonb_agg(to_jsonb(e) order by e.id desc),'[]')
      from (select event,created_at,id from os_director_events where job_id=j.id order by id desc limit 6) e
    ) events from os_director_jobs j where run_id=$1 order by updated_at desc,kind
  `, [selected.id]) : {rows:[]};
  const versions = selected ? await pool.query(`
    select version,created_at,validated_at,active from os_director_knowledge where run_id=$1 order by version desc limit 20
  `, [selected.id]) : {rows:[]};
  return {runs:recent.rows,selected,jobs:jobs.rows,versions:versions.rows};
}

function startDirectorWorker(pool, execute, evaluate, options = {}) {
  let stopped = false, timer, active;
  async function tick() {
    for (let n=0; n<12 && !stopped; n++) {
      const review=await reviewNext(pool,evaluate);
      if (review) {
        if (review?.report) options.onReport?.(review);
        continue;
      }
      const job = await claim(pool);
      if (!job) break;
      try {
        const result = await execute(job,await jobContext(pool,job));
        await report(pool,job,{status:'reported',result});
      } catch (error) {
        const missing = Array.isArray(error.permissions);
        await report(pool,job,missing
          ? {status:'blocked',issues:error.permissions,result:error.result}
          : {status:job.attempts < maxAttempts ? 'queued' : 'failed',
             delay:Math.min(60,5 * 2 ** (job.attempts-1)),issues:['Bộ thực thi tạm thời không phản hồi']});
        if (!missing) options.onError?.(job.kind,error);
      }
    }
  }
  function schedule(delay) {
    timer = setTimeout(() => {
      active = tick().catch(error => options.onError?.('worker',error)).finally(() => {
        if (!stopped) schedule(options.interval ?? 2000);
      });
    },delay);
    timer.unref();
  }
  schedule(0);
  return async function stop() {
    stopped = true;
    clearTimeout(timer);
    await active;
  };
}

module.exports = {
  initDirectorQueue,queueDirector,claim,jobContext,report,reviewNext,revise,
  knowledgeVersion,restoreKnowledge,listRuns,startDirectorWorker
};
