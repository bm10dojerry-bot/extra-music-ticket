-- Synthetic test baseline. Schema-only projection of the verified local
-- 2.3/2.4 SQL contract. This file is for a fresh networkless test container.
\set ON_ERROR_STOP on
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create extension pgcrypto;

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

CREATE TABLE public.extra_messenger_ai_followup_control (
    singleton boolean DEFAULT true NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    enabled_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT extra_messenger_ai_followup_control_singleton_check CHECK (singleton)
);

CREATE TABLE public.extra_messenger_ai_followup_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    chat_id uuid NOT NULL,
    customer_message_id bigint NOT NULL,
    anchor_reply_id bigint NOT NULL,
    stage smallint NOT NULL,
    state text DEFAULT 'sending'::text NOT NULL,
    claim_token uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    sent_at timestamp with time zone,
    external_message_id text,
    CONSTRAINT extra_messenger_ai_followup_ledger_stage_check CHECK ((stage = ANY (ARRAY[3, 10, 30, 60]))),
    CONSTRAINT extra_messenger_ai_followup_ledger_state_check CHECK ((state = ANY (ARRAY['sending'::text, 'sent'::text, 'failed'::text, 'uncertain'::text, 'skipped'::text])))
);

CREATE TABLE public.extra_messenger_ai_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    chat_id uuid NOT NULL,
    kind text NOT NULL,
    dedupe_key text NOT NULL,
    source_message_id bigint,
    order_code text,
    state text DEFAULT 'queued'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 4 NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    lease_token uuid,
    lease_until timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT extra_messenger_ai_jobs_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT extra_messenger_ai_jobs_dedupe_key_check CHECK (((char_length(dedupe_key) >= 1) AND (char_length(dedupe_key) <= 220))),
    CONSTRAINT extra_messenger_ai_jobs_kind_check CHECK ((kind = ANY (ARRAY['inbound'::text, 'paid_ticket'::text]))),
    CONSTRAINT extra_messenger_ai_jobs_last_error_check CHECK ((char_length(last_error) <= 1200)),
    CONSTRAINT extra_messenger_ai_jobs_max_attempts_check CHECK (((max_attempts >= 1) AND (max_attempts <= 8))),
    CONSTRAINT extra_messenger_ai_jobs_state_check CHECK ((state = ANY (ARRAY['queued'::text, 'running'::text, 'done'::text, 'failed'::text, 'cancelled'::text])))
);

CREATE TABLE public.extra_messenger_ai_orders (
    order_code text NOT NULL,
    chat_id uuid NOT NULL,
    quote_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.extra_messenger_ai_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    chat_id uuid NOT NULL,
    dedupe_key text NOT NULL,
    purpose text NOT NULL,
    body text NOT NULL,
    quote_id uuid,
    order_code text,
    state text DEFAULT 'ready'::text NOT NULL,
    send_token uuid,
    attempts integer DEFAULT 0 NOT NULL,
    external_message_id text,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    send_started_at timestamp with time zone,
    sent_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT extra_messenger_ai_outbox_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT extra_messenger_ai_outbox_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 1200))),
    CONSTRAINT extra_messenger_ai_outbox_dedupe_key_check CHECK (((char_length(dedupe_key) >= 1) AND (char_length(dedupe_key) <= 220))),
    CONSTRAINT extra_messenger_ai_outbox_last_error_check CHECK ((char_length(last_error) <= 1200)),
    CONSTRAINT extra_messenger_ai_outbox_purpose_check CHECK ((purpose = ANY (ARRAY['reply'::text, 'quote'::text, 'payment'::text, 'ticket'::text]))),
    CONSTRAINT extra_messenger_ai_outbox_state_check CHECK ((state = ANY (ARRAY['ready'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'uncertain'::text])))
);

CREATE TABLE public.extra_messenger_ai_quotes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    chat_id uuid NOT NULL,
    job_id uuid NOT NULL,
    quote jsonb NOT NULL,
    fingerprint text NOT NULL,
    source_message_id bigint NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    confirmed_message_id bigint,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT extra_messenger_ai_quotes_fingerprint_check CHECK (((char_length(fingerprint) >= 1) AND (char_length(fingerprint) <= 200))),
    CONSTRAINT extra_messenger_ai_quotes_quote_check CHECK ((jsonb_typeof(quote) = 'object'::text))
);

CREATE TABLE public.extra_messenger_ai_settings (
    page_id text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    model text DEFAULT ''::text NOT NULL,
    provider_checked_at timestamp with time zone,
    provider_error text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    question_quotes_enabled boolean DEFAULT false NOT NULL,
    question_quotes_test_psid text,
    short_followups_enabled boolean DEFAULT false NOT NULL,
    CONSTRAINT extra_messenger_ai_settings_model_check CHECK ((char_length(model) <= 200)),
    CONSTRAINT extra_messenger_ai_settings_page_id_check CHECK ((page_id ~ '^[0-9]{5,40}$'::text)),
    CONSTRAINT extra_messenger_ai_settings_provider_error_check CHECK ((char_length(provider_error) <= 1200))
);

CREATE TABLE public.extra_messenger_ai_state (
    chat_id uuid NOT NULL,
    status text DEFAULT 'in_progress'::text NOT NULL,
    summary text,
    reason text,
    current_order_code text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT extra_messenger_ai_state_reason_check CHECK ((char_length(reason) <= 1200)),
    CONSTRAINT extra_messenger_ai_state_status_check CHECK ((status = ANY (ARRAY['in_progress'::text, 'awaiting_payment'::text, 'successful'::text, 'unsuccessful'::text, 'needs_attention'::text]))),
    CONSTRAINT extra_messenger_ai_state_summary_check CHECK ((char_length(summary) <= 2000))
);

CREATE TABLE public.extra_messenger_day_before (
    page_id text NOT NULL,
    recipient text NOT NULL,
    show_id text NOT NULL,
    chat_id uuid NOT NULL,
    kind text NOT NULL,
    state text DEFAULT 'sending'::text NOT NULL,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL,
    external_id text,
    CONSTRAINT extra_messenger_day_before_kind_check CHECK ((kind = ANY (ARRAY['paid'::text, 'pending'::text, 'interest'::text]))),
    CONSTRAINT extra_messenger_day_before_state_check CHECK ((state = ANY (ARRAY['sending'::text, 'sent'::text, 'uncertain'::text])))
);

CREATE TABLE public.extra_payment_events (
    transaction_id bigint NOT NULL,
    order_code text,
    amount_vnd bigint NOT NULL,
    payload jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    outcome text DEFAULT 'received'::text NOT NULL
);

CREATE TABLE public.extra_payment_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    access_token text NOT NULL,
    code text NOT NULL,
    show_id text NOT NULL,
    venue_id text NOT NULL,
    seats text[] NOT NULL,
    amount_vnd bigint NOT NULL,
    buyer_name text NOT NULL,
    buyer_phone text NOT NULL,
    buyer_email text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:15:00'::interval) NOT NULL,
    sepay_transaction_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    paid_at timestamp with time zone,
    email_status text DEFAULT 'queued'::text NOT NULL,
    email_sent_at timestamp with time zone,
    email_claimed_at timestamp with time zone,
    sale_staff_id uuid,
    is_vip_invitation boolean DEFAULT false NOT NULL,
    CONSTRAINT extra_payment_orders_amount_vnd_check CHECK ((((is_vip_invitation = true) AND (amount_vnd = 0)) OR ((is_vip_invitation = false) AND (amount_vnd > 0)))),
    CONSTRAINT extra_payment_orders_code_check CHECK ((code ~ '^EX[0-9A-F]{16}$'::text)),
    CONSTRAINT extra_payment_orders_email_status_check CHECK ((email_status = ANY (ARRAY['queued'::text, 'sending'::text, 'sent'::text]))),
    CONSTRAINT extra_payment_orders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'expired'::text, 'review'::text])))
);

CREATE TABLE public.extra_show_blocked_seats (
    show_id text NOT NULL,
    seat_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.extra_support_chats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    access_hash text NOT NULL,
    show_id text,
    customer_name text DEFAULT 'Khách truy cập'::text NOT NULL,
    customer_phone text,
    origin_ip_hash text,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_customer_at timestamp with time zone,
    last_staff_at timestamp with time zone,
    assigned_staff_id uuid,
    assigned_at timestamp with time zone,
    channel text DEFAULT 'website'::text NOT NULL,
    messenger_page_id text,
    messenger_psid text,
    ai_mode text DEFAULT 'auto'::text NOT NULL,
    ai_started_at timestamp with time zone,
    CONSTRAINT extra_support_chats_access_hash_check CHECK ((length(access_hash) = 64)),
    CONSTRAINT extra_support_chats_ai_mode_check CHECK ((ai_mode = ANY (ARRAY['auto'::text, 'manual'::text]))),
    CONSTRAINT extra_support_chats_channel_check CHECK ((channel = ANY (ARRAY['website'::text, 'messenger'::text]))),
    CONSTRAINT extra_support_chats_customer_name_check CHECK (((char_length(customer_name) >= 1) AND (char_length(customer_name) <= 100))),
    CONSTRAINT extra_support_chats_customer_phone_check CHECK (((customer_phone IS NULL) OR (char_length(customer_phone) <= 25))),
    CONSTRAINT extra_support_chats_origin_ip_hash_check CHECK (((origin_ip_hash IS NULL) OR (length(origin_ip_hash) = 64))),
    CONSTRAINT extra_support_chats_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])))
);

CREATE TABLE public.extra_support_messages (
    id bigint NOT NULL,
    chat_id uuid NOT NULL,
    sender text NOT NULL,
    body text NOT NULL,
    staff_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    external_message_id text,
    CONSTRAINT extra_support_messages_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 1200))),
    CONSTRAINT extra_support_messages_sender_check CHECK ((sender = ANY (ARRAY['customer'::text, 'staff'::text]))),
    CONSTRAINT extra_support_messages_staff_name_check CHECK (((staff_name IS NULL) OR (char_length(staff_name) <= 100)))
);

ALTER TABLE public.extra_support_messages ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.extra_support_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.managed_shows (
    id text NOT NULL,
    artist text NOT NULL,
    title text NOT NULL,
    show_date date NOT NULL,
    show_time text NOT NULL,
    venue_id text NOT NULL,
    status text DEFAULT 'announced'::text NOT NULL,
    poster_path text,
    prices jsonb DEFAULT '{"A": null, "B": null, "C": null, "D": null}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT managed_shows_id_check CHECK (((char_length(id) >= 3) AND (char_length(id) <= 100))),
    CONSTRAINT managed_shows_status_check CHECK ((status = ANY (ARRAY['announced'::text, 'pending'::text, 'hidden'::text, 'sold_out'::text, 'live'::text, 'ended'::text]))),
    CONSTRAINT managed_shows_venue_id_check CHECK ((venue_id = ANY (ARRAY['moana'::text, 'ccc'::text, 'laocai'::text])))
);

CREATE TABLE public.staff_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    username text NOT NULL,
    display_name text NOT NULL,
    role text NOT NULL,
    password_hash text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    email text,
    CONSTRAINT staff_accounts_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'sale'::text, 'show_manager'::text, 'accountant'::text]))),
    CONSTRAINT staff_accounts_username_check CHECK ((username ~ '^[a-z0-9._-]{3,40}$'::text))
);

CREATE TABLE public.ticket_sales (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_code text NOT NULL,
    event_name text NOT NULL,
    venue_name text NOT NULL,
    customer_name text NOT NULL,
    customer_email text,
    seats text[] DEFAULT '{}'::text[] NOT NULL,
    amount_vnd bigint NOT NULL,
    payment_method text NOT NULL,
    seller_name text,
    paid_at timestamp with time zone DEFAULT now() NOT NULL,
    payment_verified boolean DEFAULT false NOT NULL,
    show_id text,
    CONSTRAINT ticket_sales_amount_vnd_check CHECK ((amount_vnd >= 0))
);

ALTER TABLE ONLY public.extra_messenger_ai_followup_control
    ADD CONSTRAINT extra_messenger_ai_followup_control_pkey PRIMARY KEY (singleton);

ALTER TABLE ONLY public.extra_messenger_ai_followup_ledger
    ADD CONSTRAINT extra_messenger_ai_followup_l_chat_id_customer_message_id_s_key UNIQUE (chat_id, customer_message_id, stage);

ALTER TABLE ONLY public.extra_messenger_ai_followup_ledger
    ADD CONSTRAINT extra_messenger_ai_followup_ledger_external_message_id_key UNIQUE (external_message_id);

ALTER TABLE ONLY public.extra_messenger_ai_followup_ledger
    ADD CONSTRAINT extra_messenger_ai_followup_ledger_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.extra_messenger_ai_jobs
    ADD CONSTRAINT extra_messenger_ai_jobs_dedupe_key_key UNIQUE (dedupe_key);

ALTER TABLE ONLY public.extra_messenger_ai_jobs
    ADD CONSTRAINT extra_messenger_ai_jobs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.extra_messenger_ai_orders
    ADD CONSTRAINT extra_messenger_ai_orders_pkey PRIMARY KEY (order_code);

ALTER TABLE ONLY public.extra_messenger_ai_orders
    ADD CONSTRAINT extra_messenger_ai_orders_quote_id_key UNIQUE (quote_id);

ALTER TABLE ONLY public.extra_messenger_ai_outbox
    ADD CONSTRAINT extra_messenger_ai_outbox_dedupe_key_key UNIQUE (dedupe_key);

ALTER TABLE ONLY public.extra_messenger_ai_outbox
    ADD CONSTRAINT extra_messenger_ai_outbox_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.extra_messenger_ai_quotes
    ADD CONSTRAINT extra_messenger_ai_quotes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.extra_messenger_ai_settings
    ADD CONSTRAINT extra_messenger_ai_settings_pkey PRIMARY KEY (page_id);

ALTER TABLE ONLY public.extra_messenger_ai_state
    ADD CONSTRAINT extra_messenger_ai_state_pkey PRIMARY KEY (chat_id);

ALTER TABLE ONLY public.extra_messenger_day_before
    ADD CONSTRAINT extra_messenger_day_before_pkey PRIMARY KEY (page_id, recipient, show_id);

ALTER TABLE ONLY public.extra_payment_events
    ADD CONSTRAINT extra_payment_events_pkey PRIMARY KEY (transaction_id);

ALTER TABLE ONLY public.extra_payment_orders
    ADD CONSTRAINT extra_payment_orders_access_token_key UNIQUE (access_token);

ALTER TABLE ONLY public.extra_payment_orders
    ADD CONSTRAINT extra_payment_orders_code_key UNIQUE (code);

ALTER TABLE ONLY public.extra_payment_orders
    ADD CONSTRAINT extra_payment_orders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.extra_payment_orders
    ADD CONSTRAINT extra_payment_orders_sepay_transaction_id_key UNIQUE (sepay_transaction_id);

ALTER TABLE ONLY public.extra_show_blocked_seats
    ADD CONSTRAINT extra_show_blocked_seats_pkey PRIMARY KEY (show_id, seat_id);

ALTER TABLE ONLY public.extra_support_chats
    ADD CONSTRAINT extra_support_chats_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.extra_support_messages
    ADD CONSTRAINT extra_support_messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.managed_shows
    ADD CONSTRAINT managed_shows_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.staff_accounts
    ADD CONSTRAINT staff_accounts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.staff_accounts
    ADD CONSTRAINT staff_accounts_username_key UNIQUE (username);

ALTER TABLE ONLY public.ticket_sales
    ADD CONSTRAINT ticket_sales_order_code_key UNIQUE (order_code);

ALTER TABLE ONLY public.ticket_sales
    ADD CONSTRAINT ticket_sales_pkey PRIMARY KEY (id);

CREATE INDEX extra_messenger_ai_jobs_chat_idx ON public.extra_messenger_ai_jobs USING btree (chat_id, created_at);

CREATE INDEX extra_messenger_ai_jobs_due_idx ON public.extra_messenger_ai_jobs USING btree (available_at, created_at) WHERE (state = 'queued'::text);

CREATE INDEX extra_messenger_ai_jobs_order_idx ON public.extra_messenger_ai_jobs USING btree (order_code);

CREATE INDEX extra_messenger_ai_jobs_source_idx ON public.extra_messenger_ai_jobs USING btree (source_message_id);

CREATE UNIQUE INDEX extra_messenger_ai_one_running_idx ON public.extra_messenger_ai_jobs USING btree (chat_id) WHERE (state = 'running'::text);

CREATE INDEX extra_messenger_ai_orders_chat_idx ON public.extra_messenger_ai_orders USING btree (chat_id, created_at DESC);

CREATE INDEX extra_messenger_ai_outbox_chat_idx ON public.extra_messenger_ai_outbox USING btree (chat_id, created_at);

CREATE UNIQUE INDEX extra_messenger_ai_outbox_external_idx ON public.extra_messenger_ai_outbox USING btree (external_message_id) WHERE (external_message_id IS NOT NULL);

CREATE INDEX extra_messenger_ai_outbox_job_idx ON public.extra_messenger_ai_outbox USING btree (job_id);

CREATE INDEX extra_messenger_ai_outbox_order_idx ON public.extra_messenger_ai_outbox USING btree (order_code);

CREATE INDEX extra_messenger_ai_outbox_quote_idx ON public.extra_messenger_ai_outbox USING btree (quote_id);

CREATE UNIQUE INDEX extra_messenger_ai_outbox_quote_once_idx ON public.extra_messenger_ai_outbox USING btree (quote_id) WHERE ((purpose = 'quote'::text) AND (quote_id IS NOT NULL));

CREATE INDEX extra_messenger_ai_quotes_chat_idx ON public.extra_messenger_ai_quotes USING btree (chat_id, created_at DESC);

CREATE INDEX extra_messenger_ai_quotes_confirm_idx ON public.extra_messenger_ai_quotes USING btree (confirmed_message_id);

CREATE INDEX extra_messenger_ai_quotes_job_idx ON public.extra_messenger_ai_quotes USING btree (job_id);

CREATE INDEX extra_messenger_ai_quotes_source_idx ON public.extra_messenger_ai_quotes USING btree (source_message_id);

CREATE INDEX extra_messenger_ai_state_order_idx ON public.extra_messenger_ai_state USING btree (current_order_code);

CREATE INDEX extra_payment_orders_sale_staff_idx ON public.extra_payment_orders USING btree (sale_staff_id, created_at DESC);

CREATE UNIQUE INDEX extra_payment_orders_sepay_tx ON public.extra_payment_orders USING btree (sepay_transaction_id) WHERE (sepay_transaction_id IS NOT NULL);

CREATE INDEX extra_show_blocked_seats_show_idx ON public.extra_show_blocked_seats USING btree (show_id);

CREATE INDEX extra_support_active_assignment_idx ON public.extra_support_chats USING btree (assigned_staff_id, updated_at DESC) WHERE (status = 'open'::text);

CREATE INDEX extra_support_chats_origin_idx ON public.extra_support_chats USING btree (origin_ip_hash, created_at DESC);

CREATE INDEX extra_support_chats_updated_idx ON public.extra_support_chats USING btree (updated_at DESC);

CREATE UNIQUE INDEX extra_support_external_mid_idx ON public.extra_support_messages USING btree (external_message_id) WHERE (external_message_id IS NOT NULL);

CREATE INDEX extra_support_messages_chat_idx ON public.extra_support_messages USING btree (chat_id, id);

CREATE UNIQUE INDEX extra_support_messenger_identity_idx ON public.extra_support_chats USING btree (messenger_page_id, messenger_psid) WHERE ((messenger_page_id IS NOT NULL) AND (messenger_psid IS NOT NULL));

CREATE INDEX extra_support_unassigned_queue_idx ON public.extra_support_chats USING btree (created_at) WHERE ((status = 'open'::text) AND (assigned_staff_id IS NULL));

CREATE INDEX extra_vip_invitations_show_idx ON public.extra_payment_orders USING btree (show_id) WHERE (is_vip_invitation = true);

CREATE UNIQUE INDEX staff_accounts_email_unique ON public.staff_accounts USING btree (lower(email)) WHERE (email IS NOT NULL);

CREATE INDEX staff_accounts_role_idx ON public.staff_accounts USING btree (role);

CREATE INDEX ticket_sales_show_date_idx ON public.ticket_sales USING btree (show_id, paid_at) WHERE (payment_verified = true);

CREATE INDEX ticket_sales_show_paid_idx ON public.ticket_sales USING btree (show_id) WHERE (payment_verified = true);

ALTER TABLE ONLY public.extra_messenger_ai_followup_ledger
    ADD CONSTRAINT extra_messenger_ai_followup_ledger_anchor_reply_id_fkey FOREIGN KEY (anchor_reply_id) REFERENCES public.extra_support_messages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.extra_messenger_ai_followup_ledger
    ADD CONSTRAINT extra_messenger_ai_followup_ledger_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.extra_support_chats(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.extra_messenger_ai_followup_ledger
    ADD CONSTRAINT extra_messenger_ai_followup_ledger_customer_message_id_fkey FOREIGN KEY (customer_message_id) REFERENCES public.extra_support_messages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.extra_messenger_ai_jobs
    ADD CONSTRAINT extra_messenger_ai_jobs_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.extra_support_chats(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.extra_messenger_ai_jobs
    ADD CONSTRAINT extra_messenger_ai_jobs_order_code_fkey FOREIGN KEY (order_code) REFERENCES public.extra_payment_orders(code) ON DELETE SET NULL;

ALTER TABLE ONLY public.extra_messenger_ai_jobs
    ADD CONSTRAINT extra_messenger_ai_jobs_source_message_id_fkey FOREIGN KEY (source_message_id) REFERENCES public.extra_support_messages(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.extra_messenger_ai_orders
    ADD CONSTRAINT extra_messenger_ai_orders_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.extra_support_chats(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.extra_messenger_ai_orders
    ADD CONSTRAINT extra_messenger_ai_orders_order_code_fkey FOREIGN KEY (order_code) REFERENCES public.extra_payment_orders(code) ON DELETE CASCADE;

ALTER TABLE ONLY public.extra_messenger_ai_orders
    ADD CONSTRAINT extra_messenger_ai_orders_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES public.extra_messenger_ai_quotes(id);

ALTER TABLE ONLY public.extra_messenger_ai_outbox
    ADD CONSTRAINT extra_messenger_ai_outbox_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.extra_support_chats(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.extra_messenger_ai_outbox
    ADD CONSTRAINT extra_messenger_ai_outbox_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.extra_messenger_ai_jobs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.extra_messenger_ai_outbox
    ADD CONSTRAINT extra_messenger_ai_outbox_order_code_fkey FOREIGN KEY (order_code) REFERENCES public.extra_payment_orders(code) ON DELETE SET NULL;

ALTER TABLE ONLY public.extra_messenger_ai_outbox
    ADD CONSTRAINT extra_messenger_ai_outbox_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES public.extra_messenger_ai_quotes(id);

ALTER TABLE ONLY public.extra_messenger_ai_quotes
    ADD CONSTRAINT extra_messenger_ai_quotes_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.extra_support_chats(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.extra_messenger_ai_quotes
    ADD CONSTRAINT extra_messenger_ai_quotes_confirmed_message_id_fkey FOREIGN KEY (confirmed_message_id) REFERENCES public.extra_support_messages(id);

ALTER TABLE ONLY public.extra_messenger_ai_quotes
    ADD CONSTRAINT extra_messenger_ai_quotes_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.extra_messenger_ai_jobs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.extra_messenger_ai_quotes
    ADD CONSTRAINT extra_messenger_ai_quotes_source_message_id_fkey FOREIGN KEY (source_message_id) REFERENCES public.extra_support_messages(id);

ALTER TABLE ONLY public.extra_messenger_ai_state
    ADD CONSTRAINT extra_messenger_ai_state_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.extra_support_chats(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.extra_messenger_ai_state
    ADD CONSTRAINT extra_messenger_ai_state_current_order_code_fkey FOREIGN KEY (current_order_code) REFERENCES public.extra_payment_orders(code) ON DELETE SET NULL;

ALTER TABLE ONLY public.extra_messenger_day_before
    ADD CONSTRAINT extra_messenger_day_before_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.extra_support_chats(id);

ALTER TABLE ONLY public.extra_payment_orders
    ADD CONSTRAINT extra_payment_orders_sale_staff_id_fkey FOREIGN KEY (sale_staff_id) REFERENCES public.staff_accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.extra_show_blocked_seats
    ADD CONSTRAINT extra_show_blocked_seats_show_id_fkey FOREIGN KEY (show_id) REFERENCES public.managed_shows(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.extra_support_chats
    ADD CONSTRAINT extra_support_chats_assigned_staff_id_fkey FOREIGN KEY (assigned_staff_id) REFERENCES public.staff_accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.extra_support_messages
    ADD CONSTRAINT extra_support_messages_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.extra_support_chats(id) ON DELETE CASCADE;

ALTER TABLE public.extra_messenger_ai_followup_control ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.extra_messenger_ai_followup_ledger ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.extra_messenger_ai_jobs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.extra_messenger_ai_orders ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.extra_messenger_ai_outbox ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.extra_messenger_ai_quotes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.extra_messenger_ai_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.extra_messenger_ai_state ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.extra_messenger_day_before ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.extra_payment_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.extra_payment_orders ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.extra_show_blocked_seats ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.extra_support_chats ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.extra_support_messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.managed_shows ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.staff_accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ticket_sales ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.extra_messenger_ai_enqueue(p_chat_id uuid, p_kind text, p_dedupe_key text, p_source_message_id bigint DEFAULT NULL::bigint, p_order_code text DEFAULT NULL::text, p_available_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE c public.extra_support_chats%rowtype;v_job uuid;v_chat uuid;v_existing public.extra_messenger_ai_jobs%rowtype;
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN ('inbound','paid_ticket') OR p_dedupe_key IS NULL OR char_length(p_dedupe_key) NOT BETWEEN 1 AND 220 THEN RETURN jsonb_build_object('outcome','invalid'); END IF;
 SELECT * INTO c FROM public.extra_support_chats WHERE id=p_chat_id FOR UPDATE;
 IF NOT FOUND OR c.channel<>'messenger' THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
 IF c.ai_mode='manual' THEN RETURN jsonb_build_object('outcome','manual'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.extra_messenger_ai_settings WHERE page_id=c.messenger_page_id AND enabled) THEN RETURN jsonb_build_object('outcome','disabled'); END IF;
 IF p_kind='inbound' AND NOT EXISTS(SELECT 1 FROM public.extra_support_messages WHERE id=p_source_message_id AND chat_id=p_chat_id AND sender='customer') THEN RETURN jsonb_build_object('outcome','invalid_message'); END IF;
 IF p_kind='paid_ticket' AND NOT EXISTS(SELECT 1 FROM public.extra_messenger_ai_orders a JOIN public.extra_payment_orders o ON o.code=a.order_code WHERE a.chat_id=p_chat_id AND a.order_code=p_order_code AND o.status='paid') THEN RETURN jsonb_build_object('outcome','unpaid'); END IF;
 INSERT INTO public.extra_messenger_ai_jobs(chat_id,kind,dedupe_key,source_message_id,order_code,available_at)
 VALUES(p_chat_id,p_kind,p_dedupe_key,p_source_message_id,p_order_code,COALESCE(p_available_at,now()))
 ON CONFLICT(dedupe_key) DO NOTHING RETURNING id INTO v_job;
 IF v_job IS NULL THEN
  SELECT * INTO v_existing FROM public.extra_messenger_ai_jobs WHERE dedupe_key=p_dedupe_key FOR UPDATE;
  v_job:=v_existing.id;v_chat:=v_existing.chat_id;
  IF v_chat IS DISTINCT FROM p_chat_id OR v_existing.kind<>p_kind OR v_existing.source_message_id IS DISTINCT FROM p_source_message_id OR v_existing.order_code IS DISTINCT FROM p_order_code THEN RETURN jsonb_build_object('outcome','conflict'); END IF;
  IF v_existing.state='cancelled'
   AND NOT EXISTS(SELECT 1 FROM public.extra_messenger_ai_outbox WHERE job_id=v_job AND state IN ('sent','sending','uncertain'))
   AND (p_kind='paid_ticket' OR p_source_message_id=(SELECT max(id) FROM public.extra_support_messages WHERE chat_id=p_chat_id AND sender='customer')) THEN
   UPDATE public.extra_messenger_ai_jobs SET state='queued',attempts=0,available_at=COALESCE(p_available_at,now()),lease_token=NULL,lease_until=NULL,completed_at=NULL,updated_at=now() WHERE id=v_job;
   UPDATE public.extra_support_chats SET ai_started_at=COALESCE(ai_started_at,now()),assigned_staff_id=NULL,assigned_at=NULL WHERE id=p_chat_id;
   UPDATE public.extra_messenger_ai_state SET status=CASE WHEN status IN ('unsuccessful','needs_attention') THEN 'in_progress' ELSE status END,
    reason=CASE WHEN status IN ('unsuccessful','needs_attention') THEN NULL ELSE reason END,updated_at=now() WHERE chat_id=p_chat_id;
   RETURN jsonb_build_object('outcome','queued','job_id',v_job,'resumed',true);
  END IF;
  RETURN jsonb_build_object('outcome','duplicate','job_id',v_job);
 END IF;
 UPDATE public.extra_support_chats SET ai_started_at=COALESCE(ai_started_at,now()),assigned_staff_id=NULL,assigned_at=NULL WHERE id=p_chat_id;
 INSERT INTO public.extra_messenger_ai_state(chat_id,status) VALUES(p_chat_id,'in_progress')
 ON CONFLICT(chat_id) DO UPDATE SET
 status=CASE WHEN extra_messenger_ai_state.status IN ('unsuccessful','needs_attention') THEN 'in_progress' ELSE extra_messenger_ai_state.status END,
 reason=CASE WHEN extra_messenger_ai_state.status IN ('unsuccessful','needs_attention') THEN NULL ELSE extra_messenger_ai_state.reason END,updated_at=now();
 RETURN jsonb_build_object('outcome','queued','job_id',v_job);
END
$function$
;
CREATE OR REPLACE FUNCTION public.extra_messenger_ai_followup_candidate(p_page_id text, p_chat_id uuid, p_own_claim uuid)
 RETURNS TABLE(chat_id uuid, customer_message_id bigint, anchor_reply_id bigint, stage smallint, anchor_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT c.id,cm.id,a.id,d.stage,a.created_at
 FROM public.extra_support_chats c
 JOIN public.extra_messenger_ai_settings cfg ON cfg.page_id=c.messenger_page_id AND cfg.enabled AND cfg.provider_checked_at IS NOT NULL AND cfg.provider_error IS NULL
 JOIN public.extra_messenger_ai_state st ON st.chat_id=c.id AND st.status='in_progress' AND st.current_order_code IS NULL
 JOIN LATERAL (SELECT m.id,m.body,m.created_at FROM public.extra_support_messages m WHERE m.chat_id=c.id AND m.sender='customer' ORDER BY m.id DESC LIMIT 1) cm ON true
 JOIN LATERAL (SELECT m.id,m.sender,m.staff_name,m.external_message_id,m.created_at FROM public.extra_support_messages m WHERE m.chat_id=c.id ORDER BY m.id DESC LIMIT 1) lm ON true
 LEFT JOIN public.extra_messenger_ai_followup_ledger f ON f.chat_id=c.id AND f.customer_message_id=cm.id AND f.stage=3 AND f.id IS DISTINCT FROM p_own_claim
 JOIN public.extra_support_messages a ON a.id=coalesce(f.anchor_reply_id,lm.id) AND a.chat_id=c.id AND a.sender='staff' AND a.staff_name='EXTRA AI'
 CROSS JOIN LATERAL (SELECT public.extra_messenger_ai_followup_stage(a.created_at,f.sent_at,f.state,now()) stage) d
 WHERE c.channel='messenger' AND c.messenger_page_id=p_page_id
 AND (p_chat_id IS NULL OR c.id=p_chat_id)
 AND c.status='open' AND c.ai_mode='auto' AND c.ai_started_at IS NOT NULL AND c.assigned_staff_id IS NULL
 AND c.messenger_psid ~ '^[0-9]{5,80}$' AND c.messenger_psid IS DISTINCT FROM cfg.question_quotes_test_psid
 AND c.last_customer_at BETWEEN now()-interval '23 hours 59 minutes' AND now()
 AND cm.created_at BETWEEN now()-interval '23 hours 59 minutes' AND now()
 AND c.last_staff_at>=c.last_customer_at AND c.last_customer_at<=a.created_at
 AND a.external_message_id IS NOT NULL AND a.id>cm.id AND a.created_at>=cm.created_at
 AND lm.sender='staff' AND lm.staff_name='EXTRA AI'
 AND d.stage IS NOT NULL
 AND (f.id IS NULL OR (f.state='sent' AND f.external_message_id IS NOT NULL AND f.external_message_id=lm.external_message_id AND lm.id>a.id))
 AND public.extra_messenger_ai_followup_consultation_intent(cm.body)
 AND NOT EXISTS (SELECT 1 FROM public.extra_support_messages m WHERE m.chat_id=c.id AND m.sender='customer' AND lower(m.body) ~ '(đừng nhắn|ngừng nhắn|không mua|không đi|không cần|đã mua|mua rồi|đã đặt|đặt rồi|đã thanh toán|thanh toán rồi|đã chuyển khoản|chuyển khoản rồi|đã ck|ck rồi|đã cọc|cọc rồi|đã book|book rồi|đã nhận vé|nhận vé rồi|có vé rồi|đã có vé|khiếu nại|hoàn tiền|thử nghiệm)')
 AND NOT EXISTS (SELECT 1 FROM public.extra_support_messages m WHERE m.chat_id=c.id AND m.id>cm.id AND m.sender='staff' AND m.staff_name IS DISTINCT FROM 'EXTRA AI')
 AND NOT EXISTS (SELECT 1 FROM public.extra_messenger_ai_followup_ledger x WHERE x.chat_id=c.id AND x.id IS DISTINCT FROM p_own_claim AND x.id IS DISTINCT FROM f.id AND (x.customer_message_id=cm.id OR x.created_at>=now()-interval '60 minutes'))
 AND NOT EXISTS (SELECT 1 FROM public.extra_messenger_ai_jobs j WHERE j.chat_id=c.id AND j.state IN ('queued','running'))
 AND NOT EXISTS (SELECT 1 FROM public.extra_messenger_ai_outbox o WHERE o.chat_id=c.id AND (o.state IN ('sending','uncertain') OR (o.state='failed' AND o.created_at>=cm.created_at)))
 AND NOT public.extra_messenger_ai_followup_has_order(c.id)
 AND NOT EXISTS (SELECT 1 FROM public.extra_messenger_day_before r WHERE r.chat_id=c.id AND r.claimed_at>=now()-interval '24 hours')
 AND (SELECT count(*) FROM public.extra_messenger_ai_followup_ledger x WHERE x.state IN ('failed','uncertain') AND x.created_at>=now()-interval '15 minutes') < 3
 AND (d.stage<>60 OR EXISTS(SELECT 1 FROM public.extra_messenger_ai_followup_next_show()))
 ORDER BY a.created_at ASC,c.id
$function$
;
CREATE OR REPLACE FUNCTION public.extra_messenger_ai_followup_claim(p_page_id text, p_chat_id uuid, p_customer_message_id bigint, p_anchor_reply_id bigint, p_stage integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare d record;l public.extra_messenger_ai_followup_ledger%rowtype;psid text;
begin
 if not exists(select 1 from public.extra_messenger_ai_followup_control where singleton and enabled) then return jsonb_build_object('outcome','disabled'); end if;
 -- Serialize all claims, including across overlapping scheduled invocations.
 perform pg_advisory_xact_lock(hashtextextended('extra-ai-followup',0));
 if exists(select 1 from public.extra_messenger_ai_followup_ledger where created_at>clock_timestamp()-interval '55 seconds') then return jsonb_build_object('outcome','throttled'); end if;
 select c.messenger_psid into psid from public.extra_support_chats c where c.id=p_chat_id and c.messenger_page_id=p_page_id for update;
 if not found then return jsonb_build_object('outcome','stale'); end if;
 select * into d from public.extra_messenger_ai_followup_due(p_page_id,p_chat_id);
 if not found or d.customer_message_id is distinct from p_customer_message_id or d.anchor_reply_id is distinct from p_anchor_reply_id or d.stage is distinct from p_stage then return jsonb_build_object('outcome','stale'); end if;
 insert into public.extra_messenger_ai_followup_ledger(chat_id,customer_message_id,anchor_reply_id,stage)
 values(p_chat_id,p_customer_message_id,p_anchor_reply_id,p_stage)
 on conflict(chat_id,customer_message_id,stage) do nothing returning * into l;
 if not found then return jsonb_build_object('outcome','duplicate'); end if;
 return jsonb_build_object('outcome','send','id',l.id,'claim_token',l.claim_token,'psid',psid,'stage',l.stage);
end $function$
;
CREATE OR REPLACE FUNCTION public.extra_messenger_ai_followup_consultation_intent(p_body text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT coalesce(
   length(btrim(p_body)) BETWEEN 1 AND 300
   AND (public.extra_messenger_ai_followup_intent(p_body)
     OR lower(p_body) ~ '(lịch diễn|lịch show|giờ diễn|mấy giờ|địa điểm|ở đâu|bao nhiêu|giá.*vé|giá.*ghế|hạng.*vé|sơ đồ ghế|ghế.*ngồi|vé.*ghế|[0-9]+[[:space:]]*(người|khách|vé|ghế)|phân vân.*vé|tư vấn.*vé)')
   AND lower(p_body) !~ '(không mua|không đi|không đặt|không lấy|không cần|đừng nhắn|ngừng nhắn|khỏi|thôi|huỷ|hủy|từ chối|đã mua|mua rồi|đã đặt|đặt rồi|thanh toán|chuyển khoản|mã đơn|mã vé|lỗi|khiếu nại|hoàn tiền|ảnh|không phải|nhầm|quần|áo|đùa|test|thử nghiệm|chưa muốn|để sau|để hôm khác|chưa cần|tham khảo|sẽ báo|sẽ liên hệ|tự liên hệ|để mình xem|để anh xem|để chị xem|để em xem)'
 ,false)
$function$
;
CREATE OR REPLACE FUNCTION public.extra_messenger_ai_followup_due(p_page_id text, p_chat_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(chat_id uuid, customer_message_id bigint, anchor_reply_id bigint, stage smallint, anchor_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT * FROM public.extra_messenger_ai_followup_candidate(p_page_id,p_chat_id,NULL::uuid)
$function$
;
CREATE OR REPLACE FUNCTION public.extra_messenger_ai_followup_email_key(p_email text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN length(btrim(p_email))<=254 AND btrim(p_email) ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}$' THEN lower(btrim(p_email)) ELSE NULL END
$function$
;
CREATE OR REPLACE FUNCTION public.extra_messenger_ai_followup_finish(p_id uuid, p_claim_token uuid, p_result text, p_body text, p_external_message_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare l public.extra_messenger_ai_followup_ledger%rowtype;cid uuid;v_now timestamptz;
begin
 select chat_id into cid from public.extra_messenger_ai_followup_ledger where id=p_id;
 if not found then return jsonb_build_object('outcome','not_found');end if;
 perform 1 from public.extra_support_chats where id=cid for update;
 select * into l from public.extra_messenger_ai_followup_ledger where id=p_id for update;
 if l.claim_token is distinct from p_claim_token or l.state<>'sending' then return jsonb_build_object('outcome','stale');end if;
 if p_result is null or p_result not in ('sent','failed','uncertain','skipped') then return jsonb_build_object('outcome','invalid');end if;
 if p_result='sent' and (p_external_message_id is null or char_length(p_external_message_id) not between 4 and 200 or p_body is null or char_length(btrim(p_body)) not between 1 and 1200) then return jsonb_build_object('outcome','invalid');end if;
 v_now:=clock_timestamp();
 update public.extra_messenger_ai_followup_ledger set state=p_result,sent_at=case when p_result='sent' then v_now else null end,external_message_id=case when p_result='sent' then p_external_message_id else null end where id=p_id;
 if p_result='sent' then
  insert into public.extra_support_messages(chat_id,sender,body,staff_name,external_message_id)
  values(cid,'staff',btrim(p_body),'EXTRA AI',p_external_message_id)
  on conflict(external_message_id) where external_message_id is not null do nothing;
  update public.extra_support_chats set last_staff_at=greatest(last_staff_at,v_now),updated_at=v_now where id=cid;
 end if;
 return jsonb_build_object('outcome',p_result);
end $function$
;
CREATE OR REPLACE FUNCTION public.extra_messenger_ai_followup_has_order(p_chat_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 WITH contacts AS (
   SELECT c.customer_phone phone,NULL::text email FROM public.extra_support_chats c WHERE c.id=p_chat_id
   UNION ALL SELECT q.quote->>'phone',q.quote->>'email' FROM public.extra_messenger_ai_quotes q WHERE q.chat_id=p_chat_id
   UNION ALL SELECT r.parts[2],NULL::text FROM public.extra_support_messages m
     CROSS JOIN LATERAL regexp_matches(m.body,'(^|[^0-9])((?:[+]84|84|0)(?:[ .-]?[0-9]){9})(?![0-9])','g') r(parts)
     WHERE m.chat_id=p_chat_id AND m.sender='customer'
   UNION ALL SELECT NULL::text,r.parts[1] FROM public.extra_support_messages m
     CROSS JOIN LATERAL regexp_matches(m.body,'([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,})','g') r(parts)
     WHERE m.chat_id=p_chat_id AND m.sender='customer'
 ), keys AS (
   SELECT DISTINCT public.extra_messenger_ai_followup_phone_key(phone) phone,
     public.extra_messenger_ai_followup_email_key(email) email FROM contacts
 ), purchases AS (
   SELECT 1 FROM public.extra_messenger_ai_orders x JOIN public.extra_payment_orders o ON o.code=x.order_code
     WHERE x.chat_id=p_chat_id AND o.status IN ('paid','review','pending')
   UNION ALL SELECT 1 FROM public.extra_payment_orders o JOIN keys k
     ON (k.phone IS NOT NULL AND k.phone=public.extra_messenger_ai_followup_phone_key(o.buyer_phone))
      OR (k.email IS NOT NULL AND k.email=public.extra_messenger_ai_followup_email_key(o.buyer_email))
     WHERE o.status IN ('paid','review','pending')
   UNION ALL SELECT 1 FROM public.ticket_sales t JOIN keys k
     ON k.email IS NOT NULL AND k.email=public.extra_messenger_ai_followup_email_key(t.customer_email)
     WHERE t.payment_verified IS TRUE
 )
 SELECT EXISTS(SELECT 1 FROM purchases)
$function$
;
CREATE OR REPLACE FUNCTION public.extra_messenger_ai_followup_intent(p_body text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 select coalesce(
 length(btrim(p_body)) between 1 and 300
 and lower(p_body) ~ '(giá vé|vé bao nhiêu|bao nhiêu tiền|giá bao nhiêu|xin giá|giá show|còn vé|còn ghế|còn chỗ|chọn ghế|chọn chỗ|đặt vé|mua vé|book vé|hạng vé|vé hạng|vé vip|mấy vé|2 vé|3 vé|4 vé|vé cho)'
 and lower(p_body) !~ '(không mua|không đi|không đặt|không lấy|không cần|đừng nhắn|ngừng nhắn|khỏi|thôi|huỷ|hủy|từ chối|đã mua|mua rồi|đã đặt|đặt rồi|thanh toán|chuyển khoản|mã đơn|mã vé|lỗi|khiếu nại|hoàn tiền|ảnh|không phải|nhầm|quần|áo|đùa|test|thử nghiệm|chưa muốn|để sau|để hôm khác|chưa cần)'
 ,false);
$function$
;
CREATE OR REPLACE FUNCTION public.extra_messenger_ai_followup_next_show()
 RETURNS TABLE(show_id text, artist text, days_remaining integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT s.id,s.artist,s.show_date-(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
 FROM public.managed_shows s
 WHERE s.status='announced' AND s.id ~ '^[A-Za-z0-9_-]{1,100}$'
 AND length(btrim(s.artist)) BETWEEN 1 AND 150
 AND s.prices IS NOT NULL AND s.prices<>'{}'::jsonb
 AND CASE WHEN s.show_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          THEN s.show_date+s.show_time::time > now() AT TIME ZONE 'Asia/Ho_Chi_Minh'
          ELSE false END
 ORDER BY s.show_date,s.show_time,s.id LIMIT 1
$function$
;
CREATE OR REPLACE FUNCTION public.extra_messenger_ai_followup_phone_key(p_phone text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 WITH k AS (SELECT regexp_replace(coalesce(p_phone,''),'[^0-9]','','g') d)
 SELECT CASE WHEN btrim(coalesce(p_phone,'')) !~ '^[+0-9 ().-]{9,24}$' THEN NULL
 WHEN d ~ '^84[0-9]{9}$' THEN '0'||substr(d,3)
 WHEN d ~ '^[0-9]{9,15}$' THEN d ELSE NULL END FROM k
$function$
;
CREATE OR REPLACE FUNCTION public.extra_messenger_ai_followup_stage(p_anchor timestamp with time zone, p_first_sent timestamp with time zone, p_first_state text, p_now timestamp with time zone)
 RETURNS smallint
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE
 WHEN p_first_state IS NULL AND p_first_sent IS NULL
   AND p_anchor > p_now-interval '60 minutes' AND p_anchor <= p_now-interval '3 minutes' THEN 3::smallint
 WHEN p_first_state='sent' AND p_first_sent >= p_anchor+interval '3 minutes'
   AND p_anchor >= p_now-interval '120 minutes' AND p_anchor <= p_now-interval '60 minutes'
   AND p_first_sent <= p_now-interval '57 minutes' THEN 60::smallint
 ELSE NULL::smallint END
$function$
;
CREATE OR REPLACE FUNCTION public.extra_messenger_ai_followup_verify(p_id uuid, p_claim_token uuid, p_page_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE l public.extra_messenger_ai_followup_ledger%rowtype; c public.extra_support_chats%rowtype; d record; s record; cid uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.extra_messenger_ai_followup_control WHERE singleton AND enabled) THEN RETURN jsonb_build_object('outcome','disabled'); END IF;
 SELECT chat_id INTO cid FROM public.extra_messenger_ai_followup_ledger WHERE id=p_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','stale'); END IF;
 SELECT * INTO c FROM public.extra_support_chats WHERE id=cid FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','stale'); END IF;
 SELECT * INTO l FROM public.extra_messenger_ai_followup_ledger WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR l.claim_token IS DISTINCT FROM p_claim_token OR l.state<>'sending' OR l.stage NOT IN (3,60) OR l.created_at<=clock_timestamp()-interval '45 seconds' THEN RETURN jsonb_build_object('outcome','stale'); END IF;
 SELECT * INTO d FROM public.extra_messenger_ai_followup_candidate(p_page_id,c.id,l.id);
 IF NOT FOUND OR d.customer_message_id IS DISTINCT FROM l.customer_message_id OR d.anchor_reply_id IS DISTINCT FROM l.anchor_reply_id OR d.stage IS DISTINCT FROM l.stage THEN RETURN jsonb_build_object('outcome','stale'); END IF;
 IF l.stage=60 THEN
   SELECT * INTO s FROM public.extra_messenger_ai_followup_next_show();
   IF NOT FOUND THEN RETURN jsonb_build_object('outcome','no_show'); END IF;
   RETURN jsonb_build_object('outcome','ok','psid',c.messenger_psid,'show_id',s.show_id,'artist',s.artist,'days_remaining',s.days_remaining);
 END IF;
 RETURN jsonb_build_object('outcome','ok','psid',c.messenger_psid);
END $function$
;
CREATE OR REPLACE FUNCTION public.extra_messenger_ai_followup_window(p_customer_at timestamp with time zone, p_reply_at timestamp with time zone, p_now timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT coalesce(p_customer_at <= p_reply_at
   AND p_customer_at >= p_now - interval '23 hours 59 minutes'
   AND p_reply_at BETWEEN p_now - interval '60 minutes' AND p_now - interval '3 minutes',false)
$function$
;
CREATE OR REPLACE FUNCTION public.extra_messenger_ai_handoff_attention()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.status='needs_attention' THEN
    PERFORM public.extra_messenger_ai_set_mode(NEW.chat_id,'manual');
  END IF;
  RETURN NEW;
END
$function$
;
CREATE OR REPLACE FUNCTION public.extra_messenger_ai_is_active(p_chat_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT EXISTS(SELECT 1 FROM public.extra_support_chats c JOIN public.extra_messenger_ai_settings s ON s.page_id=c.messenger_page_id
 WHERE c.id=p_chat_id AND c.channel='messenger' AND c.ai_mode='auto' AND c.ai_started_at IS NOT NULL AND s.enabled);
$function$
;
CREATE OR REPLACE FUNCTION public.extra_messenger_ai_keep_auto()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.channel='messenger' AND NEW.ai_mode='auto' THEN
    NEW.ai_started_at:=COALESCE(NEW.ai_started_at,clock_timestamp());
    NEW.assigned_staff_id:=NULL;
    NEW.assigned_at:=NULL;
  END IF;
  RETURN NEW;
END
$function$
;
CREATE OR REPLACE FUNCTION public.extra_messenger_ai_set_mode(p_chat_id uuid, p_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  c public.extra_support_chats%rowtype;
  v_source bigint;
  v_queue jsonb;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('auto','manual') THEN
    RETURN jsonb_build_object('outcome','invalid');
  END IF;

  SELECT * INTO c
  FROM public.extra_support_chats
  WHERE id=p_chat_id FOR UPDATE;
  IF NOT FOUND OR c.channel <> 'messenger' THEN
    RETURN jsonb_build_object('outcome','not_found');
  END IF;

  IF p_mode='manual' THEN
    UPDATE public.extra_support_chats SET ai_mode='manual',updated_at=now() WHERE id=p_chat_id AND ai_mode IS DISTINCT FROM 'manual';
    UPDATE public.extra_messenger_ai_jobs SET state='cancelled',lease_token=NULL,lease_until=NULL,completed_at=now(),updated_at=now(),last_error='Chuyển cho nhân viên Sale; không tự trả lời tiếp.' WHERE chat_id=p_chat_id AND kind='inbound' AND state IN ('queued','running');
    RETURN jsonb_build_object('outcome','updated','mode','manual','in_flight',EXISTS(SELECT 1 FROM public.extra_messenger_ai_outbox WHERE chat_id=p_chat_id AND state='sending'));
  END IF;

  UPDATE public.extra_support_chats
  SET ai_mode='auto',
      ai_started_at=COALESCE(ai_started_at,clock_timestamp()),
      assigned_staff_id=NULL,
      assigned_at=NULL
  WHERE id=p_chat_id;

  IF c.ai_mode='manual' THEN
    UPDATE public.extra_messenger_ai_state SET status='in_progress',reason=NULL,updated_at=now() WHERE chat_id=p_chat_id AND status='needs_attention';
  END IF;

  IF c.status='open'
     AND c.last_customer_at > now()-interval '24 hours'
     AND c.last_customer_at > COALESCE(c.last_staff_at,'epoch'::timestamptz)
  THEN
    SELECT max(id) INTO v_source
    FROM public.extra_support_messages
    WHERE chat_id=p_chat_id AND sender='customer';
    IF v_source IS NOT NULL THEN
      v_queue:=public.extra_messenger_ai_enqueue(p_chat_id,'inbound','inbound:'||v_source,v_source);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'outcome','updated','mode','auto','queue',v_queue,
    'in_flight',EXISTS(
      SELECT 1 FROM public.extra_messenger_ai_outbox
      WHERE chat_id=p_chat_id AND state='sending')
  );
END
$function$
;
CREATE OR REPLACE FUNCTION public.extra_reserve_order(p_code text, p_token text, p_show text, p_venue text, p_seats text[], p_amount bigint, p_name text, p_phone text, p_email text)
 RETURNS TABLE(order_code text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare taken text[];
begin
 if cardinality(p_seats) is null or cardinality(p_seats)<1 or cardinality(p_seats)>23 or cardinality(p_seats)<>(select count(distinct x) from unnest(p_seats) x) then raise exception 'Invalid seats';end if;
 perform pg_advisory_xact_lock(hashtext(p_show));
 if exists(select 1 from public.extra_show_blocked_seats b where b.show_id=p_show and b.seat_id=any(p_seats)) then raise exception 'Seats blocked by admin';end if;
 select array_agg(distinct x) into taken from (
  select unnest(e.seats) x from public.extra_payment_orders e where e.show_id=p_show and (e.status='paid' or (e.status='pending' and e.expires_at>now()))
  union all
  select unnest(seats) x from public.ticket_sales where show_id=p_show and payment_verified=true
 ) q;
 if p_seats && coalesce(taken,array[]::text[]) then raise exception 'Seats already reserved';end if;
 insert into public.extra_payment_orders(code,access_token,show_id,venue_id,seats,amount_vnd,buyer_name,buyer_phone,buyer_email)
 values(p_code,p_token,p_show,p_venue,p_seats,p_amount,p_name,p_phone,p_email);
 return query select o.code,o.expires_at from public.extra_payment_orders o where o.code=p_code;
end $function$
;
CREATE OR REPLACE FUNCTION public.extra_support_ingest_messenger(p_page_id text, p_psid text, p_mid text, p_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_chat uuid;v_message bigint;v_status text;v_queue jsonb;
BEGIN
 IF p_page_id IS NULL OR p_psid IS NULL OR p_page_id !~ '^[0-9]{5,40}$' OR p_psid !~ '^[0-9]{5,80}$'
 OR p_mid IS NULL OR char_length(p_mid) NOT BETWEEN 4 AND 200 OR p_text IS NULL OR char_length(btrim(p_text)) NOT BETWEEN 1 AND 1200 THEN RETURN jsonb_build_object('outcome','invalid'); END IF;
 PERFORM pg_advisory_xact_lock(hashtext(p_page_id),hashtext(p_psid));
 SELECT id,status INTO v_chat,v_status FROM public.extra_support_chats WHERE messenger_page_id=p_page_id AND messenger_psid=p_psid FOR UPDATE;
 IF v_chat IS NULL THEN
  INSERT INTO public.extra_support_chats(access_hash,customer_name,channel,messenger_page_id,messenger_psid,status)
  VALUES(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),'Khách Messenger','messenger',p_page_id,p_psid,'open') RETURNING id INTO v_chat;
 END IF;
 INSERT INTO public.extra_support_messages(chat_id,sender,body,external_message_id) VALUES(v_chat,'customer',btrim(p_text),p_mid)
 ON CONFLICT(external_message_id) WHERE external_message_id IS NOT NULL DO NOTHING RETURNING id INTO v_message;
 IF v_message IS NULL THEN RETURN jsonb_build_object('outcome','duplicate','chat_id',v_chat); END IF;
 UPDATE public.extra_support_chats SET updated_at=now(),last_customer_at=now(),status='open',
 assigned_staff_id=CASE WHEN v_status='closed' THEN NULL ELSE assigned_staff_id END,assigned_at=CASE WHEN v_status='closed' THEN NULL ELSE assigned_at END WHERE id=v_chat;
 v_queue:=public.extra_messenger_ai_enqueue(v_chat,'inbound','inbound:'||v_message,v_message);
 RETURN jsonb_build_object('outcome','received','chat_id',v_chat,'message_id',v_message,'ai_queued',v_queue->>'outcome'='queued','ai_job_id',v_queue->>'job_id');
END
$function$
;
CREATE TRIGGER extra_messenger_ai_handoff_attention_on_state AFTER INSERT OR UPDATE OF status ON public.extra_messenger_ai_state FOR EACH ROW WHEN ((new.status = 'needs_attention'::text)) EXECUTE FUNCTION public.extra_messenger_ai_handoff_attention();
CREATE TRIGGER extra_messenger_ai_keep_auto_on_chat BEFORE INSERT OR UPDATE ON public.extra_support_chats FOR EACH ROW EXECUTE FUNCTION public.extra_messenger_ai_keep_auto();
grant select,insert,update,delete on all tables in schema public to service_role;
grant usage,select on all sequences in schema public to service_role;
insert into public.extra_messenger_ai_followup_control(singleton,enabled) values (true,false);
