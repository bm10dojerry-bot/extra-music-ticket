begin;

insert into public.extra_os_jobs (show_id, kind, agent, dependencies, priority)
select t.show_id, 'tiktok_materials', 'Social', array['tiktok','content','video'], t.priority
from public.extra_os_jobs t
join public.extra_os_shows s on s.id = t.show_id
where t.kind = 'tiktok' and s.starts_at > now()
on conflict (show_id, kind) do nothing;

commit;
