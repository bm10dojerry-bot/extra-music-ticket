-- Confirmation locks the status permanently, except cancelled leads can be reopened.
alter table public.sale_requests add column if not exists status_confirmed boolean not null default false;
create or replace function public.extra_confirm_sale_request(p_id uuid,p_actor uuid,p_status text,p_is_admin boolean default false)
returns boolean language plpgsql security definer set search_path=public as $$
declare changed integer;
begin
 if p_status not in ('new','contacted','awaiting_payment','cancelled') then raise exception 'Invalid status';end if;
 update public.sale_requests
 set status=p_status,status_confirmed=true,updated_at=now()
 where id=p_id and (p_is_admin or created_by=p_actor)
 and (status_confirmed=false or status='cancelled');
 get diagnostics changed=row_count;
 return changed=1;
end $$;
revoke all on function public.extra_confirm_sale_request(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.extra_confirm_sale_request(uuid,uuid,text,boolean) to service_role;
