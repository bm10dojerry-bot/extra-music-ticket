-- Native on-site customer support; service-role only, no public table access.
CREATE TABLE IF NOT EXISTS public.extra_support_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_hash text NOT NULL CHECK (length(access_hash)=64),
  show_id text,
  customer_name text NOT NULL DEFAULT 'Khách truy cập' CHECK (char_length(customer_name) BETWEEN 1 AND 100),
  customer_phone text CHECK (customer_phone IS NULL OR char_length(customer_phone)<=25),
  origin_ip_hash text CHECK (origin_ip_hash IS NULL OR length(origin_ip_hash)=64),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_customer_at timestamptz,
  last_staff_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.extra_support_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chat_id uuid NOT NULL REFERENCES public.extra_support_chats(id) ON DELETE CASCADE,
  sender text NOT NULL CHECK (sender IN ('customer','staff')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1200),
  staff_name text CHECK (staff_name IS NULL OR char_length(staff_name)<=100),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS extra_support_chats_updated_idx ON public.extra_support_chats(updated_at DESC);
CREATE INDEX IF NOT EXISTS extra_support_chats_origin_idx ON public.extra_support_chats(origin_ip_hash,created_at DESC);
CREATE INDEX IF NOT EXISTS extra_support_messages_chat_idx ON public.extra_support_messages(chat_id,id);
ALTER TABLE public.extra_support_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extra_support_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.extra_support_chats,public.extra_support_messages FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.extra_support_chats,public.extra_support_messages TO service_role;
REVOKE ALL ON SEQUENCE public.extra_support_messages_id_seq FROM PUBLIC,anon,authenticated;
GRANT USAGE,SELECT ON SEQUENCE public.extra_support_messages_id_seq TO service_role;
