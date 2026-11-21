-- Track which employee reserved each SePay order. Run once in Supabase SQL Editor.
alter table public.extra_payment_orders
 add column if not exists sale_staff_id uuid references public.staff_accounts(id) on delete set null;
create index if not exists extra_payment_orders_sale_staff_idx on public.extra_payment_orders(sale_staff_id,created_at desc);
-- Staff attribution must only be set by the server service role, never by the public checkout.
