-- Run in Supabase SQL editor to enable verified per-show inventory.
alter table public.ticket_sales add column if not exists show_id text;
create index if not exists ticket_sales_show_paid_idx on public.ticket_sales(show_id) where payment_verified = true;
-- Each sold seat is counted once, even if mistakenly repeated across sales.
-- Only verified sales with an explicit show_id count towards sold-out status.
