-- Prevent a real but invalid/previously paid booking code from being
-- auto-reassigned to another customer's order with the same amount.
CREATE OR REPLACE FUNCTION public.extra_confirm_payment_smart(p_tx bigint, p_code text, p_amount bigint, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_order public.extra_payment_orders%ROWTYPE;
  v_existing public.extra_payment_events%ROWTYPE;
  v_tx_at timestamptz := now();
  v_bank_time text := coalesce(p_payload->>'transactionDate', '');
  v_candidate text := '';
  v_candidate_count integer := 0;
  v_result text := 'unmatched';
  v_match text := '';
  v_how text := 'none';
BEGIN
  IF p_tx IS NULL OR p_tx <= 0 OR p_amount IS NULL OR p_amount <= 0
     OR coalesce(p_payload->>'transferType','') <> 'in'
     OR p_payload IS NULL THEN
    RAISE EXCEPTION 'Invalid incoming bank transfer';
  END IF;

  -- Serialize all transfers of the same amount, including webhook retries.
  PERFORM pg_advisory_xact_lock(76941, hashtext(p_amount::text));

  SELECT * INTO v_existing
  FROM public.extra_payment_events
  WHERE transaction_id = p_tx
  FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'outcome', v_existing.outcome,
      'order_code', CASE WHEN v_existing.outcome = 'paid' THEN coalesce(v_existing.order_code,'') ELSE '' END,
      'matched_by', 'replay'
    );
  END IF;

  -- SePay's transactionDate is local bank time (Vietnam). Use it rather than
  -- webhook arrival time so a delayed notification cannot unfairly expire a paid booking.
  IF v_bank_time ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN
    BEGIN
      v_tx_at := v_bank_time::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh';
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      v_tx_at := now();
    END;
  END IF;
  IF v_tx_at > now() + interval '5 minutes'
     OR v_tx_at < now() - interval '7 days' THEN
    v_tx_at := now();
  END IF;

  -- Fast path: exact code, exact amount, and the transfer falls within
  -- the 15-minute holding window (using time recorded by the bank).
  IF coalesce(p_code,'') ~ '^EX[0-9A-F]{16}$' THEN
    -- Known, already-paid or wrong-amount codes must not be reassigned.
    IF EXISTS (
      SELECT 1 FROM public.extra_payment_orders k
      WHERE k.code = p_code
        AND (k.status <> 'pending'
          OR k.amount_vnd <> p_amount
          OR k.is_vip_invitation = true
          OR v_tx_at NOT BETWEEN k.created_at AND k.expires_at)
    ) THEN
      v_result := 'code_conflict_review';
    END IF;
    SELECT * INTO v_order
    FROM public.extra_payment_orders
    WHERE code = p_code
      AND status = 'pending'
      AND is_vip_invitation = false
      AND amount_vnd = p_amount
      AND v_tx_at BETWEEN created_at AND expires_at
    FOR UPDATE;
    IF FOUND THEN
      v_how := 'order_code';
    END IF;
  END IF;

  -- Fallback for missing/typoed transfer content. Never match by amount alone:
  -- require a UNIQUE still-pending order active at the actual bank transfer time.
  IF v_order.id IS NULL AND v_result <> 'code_conflict_review' THEN
    SELECT count(*), min(code) INTO v_candidate_count, v_candidate
    FROM (
      SELECT code
      FROM public.extra_payment_orders
      WHERE status = 'pending'
        AND is_vip_invitation = false
        AND amount_vnd = p_amount
        AND v_tx_at BETWEEN created_at AND expires_at
      LIMIT 2
    ) candidates;

    IF v_candidate_count = 1 THEN
      SELECT * INTO v_order
      FROM public.extra_payment_orders
      WHERE code = v_candidate AND status = 'pending'
        AND amount_vnd = p_amount
        AND v_tx_at BETWEEN created_at AND expires_at
      FOR UPDATE;
      IF FOUND THEN v_how := 'unique_amount_time'; END IF;
    ELSIF v_candidate_count > 1 THEN
      v_result := 'ambiguous_review';
    ELSE
      v_result := 'unmatched';
    END IF;
  END IF;

  IF v_order.id IS NOT NULL THEN
    -- Matches the advisory lock used by the booking/reservation RPC.
    PERFORM pg_advisory_xact_lock(hashtext(v_order.show_id));

    IF EXISTS (
      SELECT 1 FROM public.extra_payment_orders e
      WHERE e.id <> v_order.id AND e.show_id = v_order.show_id
        AND (e.status = 'paid' OR (e.status = 'pending' AND e.expires_at > now()))
        AND e.seats && v_order.seats
    ) OR EXISTS (
      SELECT 1 FROM public.ticket_sales t
      WHERE t.show_id = v_order.show_id AND t.payment_verified = true
        AND t.seats && v_order.seats
    ) OR EXISTS (
      SELECT 1 FROM public.extra_tickets t
      WHERE t.show_id = v_order.show_id AND t.seat_id = ANY(v_order.seats)
    ) OR EXISTS (
      SELECT 1 FROM public.extra_show_blocked_seats b
      WHERE b.show_id = v_order.show_id AND b.seat_id = ANY(v_order.seats)
    ) THEN
      v_result := 'seat_conflict_review';
    ELSE
      UPDATE public.extra_payment_orders
      SET status = 'paid',
          paid_at = v_tx_at,
          sepay_transaction_id = p_tx
      WHERE id = v_order.id AND status = 'pending';
      IF NOT FOUND THEN RAISE EXCEPTION 'Order changed during payment confirmation'; END IF;

      PERFORM public.extra_issue_paid_tickets(v_order.code);
      v_result := 'paid';
      v_match := v_order.code;
    END IF;
  END IF;

  INSERT INTO public.extra_payment_events(
    transaction_id, order_code, amount_vnd, payload, outcome
  ) VALUES (
    p_tx,
    CASE WHEN v_result = 'paid' THEN v_match ELSE coalesce(p_code,'') END,
    p_amount,
    p_payload,
    v_result
  );

  RETURN jsonb_build_object(
    'outcome', v_result,
    'order_code', v_match,
    'matched_by', CASE WHEN v_result = 'paid' THEN v_how ELSE 'none' END
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public.extra_confirm_payment_smart(bigint,text,bigint,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.extra_confirm_payment_smart(bigint,text,bigint,jsonb) TO service_role;
