-- Email OTP password reset, service_role-only access.
create table if not exists public.password_reset_email_codes (
 account_kind text not null check(account_kind in('owner','staff')),
 account_id text not null,
 email text not null,
 code_hash text not null check(code_hash ~ '^[a-f0-9]{64}$'),
 issued_at timestamptz not null default now(),
 expires_at timestamptz not null,
 consumed_at timestamptz,
 attempt_count integer not null default 0 check(attempt_count between 0 and 10),
 window_started_at timestamptz not null default now(),
 window_count integer not null default 1 check(window_count between 1 and 10),
 primary key(account_kind,account_id)
);
create index if not exists password_reset_email_codes_email_idx on public.password_reset_email_codes(email);
alter table public.password_reset_email_codes enable row level security;
revoke all on public.password_reset_email_codes from public,anon,authenticated;
grant select,insert,update,delete on public.password_reset_email_codes to service_role;
CREATE OR REPLACE FUNCTION public.issue_password_reset_email_code(p_kind text, p_account_id text, p_email text, p_hash text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare previous public.password_reset_email_codes%rowtype;
begin
  if p_kind not in ('owner','staff') or nullif(trim(p_account_id),'') is null
    or p_email is null or length(p_email)>254 or p_hash !~ '^[a-f0-9]{64}$'
    then return false;
  end if;
  perform pg_advisory_xact_lock(hashtext('extra-reset:'||p_kind||':'||p_account_id));
  select * into previous from public.password_reset_email_codes
    where account_kind=p_kind and account_id=p_account_id for update;
  if found then
    if previous.issued_at>now()-interval '60 seconds' then return false;end if;
    if previous.window_started_at>now()-interval '1 hour' and previous.window_count>=5 then return false;end if;
  end if;
  insert into public.password_reset_email_codes
    (account_kind,account_id,email,code_hash,issued_at,expires_at,consumed_at,attempt_count,window_started_at,window_count)
  values
    (p_kind,p_account_id,lower(trim(p_email)),p_hash,now(),now()+interval '10 minutes',null,0,
      case when previous.window_started_at>now()-interval '1 hour' then previous.window_started_at else now() end,
      case when previous.window_started_at>now()-interval '1 hour' then previous.window_count+1 else 1 end)
  on conflict (account_kind,account_id) do update set
    email=excluded.email,code_hash=excluded.code_hash,issued_at=excluded.issued_at,
    expires_at=excluded.expires_at,consumed_at=null,attempt_count=0,
    window_started_at=excluded.window_started_at,window_count=excluded.window_count;
  return true;
end;
$function$;

revoke all on function public.issue_password_reset_email_code(text,text,text,text) from public,anon,authenticated;
grant execute on function public.issue_password_reset_email_code(text,text,text,text) to service_role;
CREATE OR REPLACE FUNCTION public.claim_password_reset_email_code(p_email text, p_hash text)
 RETURNS TABLE(account_kind text, account_id text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare target public.password_reset_email_codes%rowtype;
begin
  if nullif(trim(p_email),'') is null or p_hash !~ '^[a-f0-9]{64}$' then return;end if;
  select * into target from public.password_reset_email_codes t
    where t.email=lower(trim(p_email)) and t.consumed_at is null
    order by t.issued_at desc limit 1 for update;
  if not found then return; end if;
  if target.expires_at<=now() or target.attempt_count>=5 then return; end if;
  update public.password_reset_email_codes t
    set attempt_count=t.attempt_count+1
    where t.account_kind=target.account_kind and t.account_id=target.account_id;
  if target.code_hash<>p_hash then return;end if;
  update public.password_reset_email_codes t
    set consumed_at=now()
    where t.account_kind=target.account_kind and t.account_id=target.account_id;
  return query select target.account_kind,target.account_id;
end;
$function$;

revoke all on function public.claim_password_reset_email_code(text,text) from public,anon,authenticated;
grant execute on function public.claim_password_reset_email_code(text,text) to service_role;
