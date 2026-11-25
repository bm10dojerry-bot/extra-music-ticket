create function public.extra_set_show_canopy(p_show text,p_date date,p_venue text,p_confirmed boolean)
returns boolean language plpgsql set search_path=pg_catalog,public as $$
begin
 perform 1 from managed_shows where id=p_show and show_date=p_date and venue_id=p_venue for share;
 if not found or p_confirmed is null then return false; end if;
 insert into extra_show_reminder_settings(show_id,canopy_confirmed) values(p_show,p_confirmed)
 on conflict(show_id) do update set canopy_confirmed=excluded.canopy_confirmed;
 return true;
end; $$;
create function public.extra_clear_changed_show_canopy() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 update extra_show_reminder_settings set canopy_confirmed=false where show_id=new.id and canopy_confirmed;
 return new;
end; $$;
create trigger extra_show_canopy_changed after update of venue_id,show_date on public.managed_shows
for each row when(old.venue_id is distinct from new.venue_id or old.show_date is distinct from new.show_date)
execute function public.extra_clear_changed_show_canopy();
revoke all on function public.extra_set_show_canopy(text,date,text,boolean),public.extra_clear_changed_show_canopy() from public,anon,authenticated;
grant execute on function public.extra_set_show_canopy(text,date,text,boolean),public.extra_clear_changed_show_canopy() to service_role;
