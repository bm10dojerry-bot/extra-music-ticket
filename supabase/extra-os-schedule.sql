-- Run in the EXTRA OS database after setup. Store the URL and key in Vault first.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets
    where name = 'extra_os_scheduler_origin' and decrypted_secret ~ '^https://[a-zA-Z0-9.-]+$')
    or not exists (select 1 from vault.decrypted_secrets
    where name = 'extra_os_scheduler_secret' and length(decrypted_secret) >= 24) then
    raise exception 'Set extra_os_scheduler_origin and extra_os_scheduler_secret in Vault';
  end if;
end;
$$;

select cron.schedule(
  'extra-os-worker',
  '*/2 * * * *',
  $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'extra_os_scheduler_origin') || '/api/cron/extra-os',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'extra_os_scheduler_secret')
    ),
    timeout_milliseconds := 115000
  );
  $job$
);
