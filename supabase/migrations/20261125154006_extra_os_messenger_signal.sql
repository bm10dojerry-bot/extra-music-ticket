begin;

create function public.extra_os_messenger_show(p_page text,p_ad text,p_post text)
returns text[] language sql stable security invoker set search_path = '' as $$
  select coalesce(array_agg(distinct m.id),'{}'::text[])
  from public.extra_os_effects e
  join public.extra_os_shows s on s.id = e.show_id
  join public.managed_shows m on m.id = s.website_id
  where m.status = 'announced' and s.starts_at > now() and e.detail->>'pageId' = p_page
    and (
      (p_post <> '' and e.key = 'facebook-feed' and e.provider_id = p_page || '_' || p_post)
      or (p_ad <> '' and e.key in ('ads-initial-ad','ads-growth-ad') and e.provider_id = p_ad)
    );
$$;
revoke execute on function public.extra_os_messenger_show(text,text,text) from public,anon,authenticated;
grant execute on function public.extra_os_messenger_show(text,text,text) to service_role;

commit;
