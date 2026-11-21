-- 014: Grant the checkin role only the gate-scanning capability.
-- Existing staff_accounts.role check constraint from SQL 005 is replaced without changing accounts.
do $$
declare c record;
begin
 for c in
  select con.conname from pg_constraint con
  join pg_class rel on rel.oid=con.conrelid
  join pg_namespace ns on ns.oid=rel.relnamespace
  where ns.nspname='public' and rel.relname='staff_accounts' and con.contype='c'
    and pg_get_constraintdef(con.oid) ilike '%role%'
 loop
  execute format('alter table public.staff_accounts drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.staff_accounts add constraint staff_accounts_role_check
 check (role in ('admin','sale','show_manager','accountant','checkin'));
