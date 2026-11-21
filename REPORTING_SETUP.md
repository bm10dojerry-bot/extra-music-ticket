# Extra Music Show — email sales reports

Recipient: **bm10dojerry@gmail.com**. Never commit credentials.

## Status
This repository contains a **reporting integration foundation**, not a complete booking or payment system. No real sale notifications can occur until the payment backend securely creates verified sales and invokes the internal endpoint. The database schema is a starter and must be integrated with the final order schema before accepting production sales.

## Setup
1. Create a Supabase project, run `supabase/migrations/001_reporting.sql` in SQL Editor. Configure the server-side URL and service-role key in Vercel environment variables.
2. Create a Resend account and verify a sender domain you control. Set `RESEND_API_KEY`, `REPORT_FROM_EMAIL`, `REPORT_TO_EMAIL=bm10dojerry@gmail.com`.
3. Generate independent long random values for `REPORT_WEBHOOK_SECRET` and `CRON_SECRET` and set them in Vercel environment variables. Do not send them in chat or commit them.
4. Redeploy. Configure Vercel Cron for the daily endpoint. Schedule `0 16 * * *` UTC corresponds to 23:00 Asia/Ho_Chi_Minh. **Check your Vercel plan's cron scheduling precision and limits before relying on an exact 23:00 delivery.**
5. After a **server-side verified** VNPAY IPN or authorized offline sale, write a paid sale record with `payment_verified=true`, then POST `{ "saleId": "<uuid>" }` to `/api/internal/sales/notify` with `Authorization: Bearer <REPORT_WEBHOOK_SECRET>`. Never call this endpoint from the public browser. Do not mark an order paid based only on client redirect parameters.
6. Test with a verified test sale and review provider logs. The report endpoints require secrets and cannot be used to sell tickets themselves.

## Reporting endpoints
- `POST /api/internal/sales/notify`: send an email for an existing verified paid sale. Idempotent per sale.
- `GET /api/cron/daily-report`: send a summary of verified paid sales for the current Vietnam calendar day. Idempotent per day.

## Production considerations
- The claim-before-send strategy prevents common duplicates, but an interruption between provider acceptance and response may still require reconciliation. Use a durable outbox and provider message IDs for stronger exactly-once semantics.
- Daily aggregation currently requests up to 10,000 rows. Add pagination for larger volumes.
- Implement a verified VNPAY IPN, transactional order persistence, admin/offline-sale authorization, seat inventory, customer tickets, and QR check-in separately before launch.
- Never expose the Supabase service-role key or report webhook secret in client code.
