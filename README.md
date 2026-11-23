# extra-music-ticket
Ticket booking system for Extra Music Show

## Google Analytics visitor map

Admin Overview includes a country map and city ranking from GA4's realtime Data
API. Counts describe active users in the last 30 minutes. The total, country and
city reports are queried separately with the selected web stream's exact ID.

### Setup

1. Apply `supabase/migrations/042_extra_google_analytics.sql` before deploying the
   feature. It creates service-only connection and short-lived OAuth-state tables.
2. Use the existing server configuration: `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`, `ADMIN_MEDIA_SECRET`, `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY`. Enable Google Analytics Admin API and Google
   Analytics Data API in the Google Cloud project owning the OAuth client.
3. Keep the existing registered redirect URI:
   `https://iextra.net/api/auth/google/callback`. The `ga4.` state namespace routes
   Analytics callbacks without changing the existing Google sign-in flow.
4. In Admin Overview, choose **Kết nối Google Analytics**, authorize the Google
   account with access to the GA4 property, then select its web stream for
   `iextra.net` or `www.iextra.net`. A Measurement ID alone does not grant report
   access. If no suitable property/stream exists, create it in Google Analytics
   and reload the list.

The connection requests only `analytics.readonly`. Admins can connect, choose a
stream and disconnect; show managers can view aggregate reports. Refresh tokens
and PKCE verifiers are encrypted server-side, and no credential appears in report
or public configuration responses. Rotating `ADMIN_MEDIA_SECRET` requires
reconnecting Analytics. A disconnected or failed report is never represented as
a successful zero-user report.

Selecting a stream enables consent-based GA4 measurement on the public production
website. Declining measurement loads no Google tag. Internal portals and ticket
receipt pages are excluded. The shared initial page view is sent once per document
and measurement ID; existing per-show ecommerce/Meta/Google Ads behavior remains
independent of the optional global configuration lookup.

The map uses bundled Natural Earth country geometry, with small-country symbols
from geographic centroids. City coordinates and individual visitor locations are
not plotted. Reports refresh every minute while visible. See the official
[realtime API schema](https://developers.google.com/analytics/devguides/reporting/data/v1/realtime-api-schema)
for supported geographic dimensions.

## Sale commissions by show

Apply `supabase/migrations/20261123151046_sale_commission_per_show_progressive.sql`
before deploying the commission reporting and checkout changes. It adds private,
service-only per-show policies and immutable checkout price snapshots while
keeping the old reservation RPC and global settings table available for rollout.

Admin's **Hoa hồng theo show** menu edits that show's thresholds and percentages.
Each existing show starts with its own policy: tickets 1–10 at 15%, 11–30 at 18%,
31–50 at 22%, and 51–550 at 25%. Newly saved shows without a policy use the same
starter schedule until an Admin saves a separate policy. Saving a policy affects
only that show and recalculates its displayed historical commissions. Concurrent
edits use a version token and cannot silently overwrite each other.

The shared server report builder groups lifetime paid orders by **Sale ID + show**,
assigns ticket ordinals before applying report date filters, and applies each
ticket's marginal rate to its actual net price after discounts. Gift and VIP/free
tickets do not advance the sequence. Only verified, paid orders count; authoritative
online status and exact Sale ID override duplicate legacy records. For example,
20 paid tickets at 500,000 VND each produce 750,000 + 900,000 = **1,650,000 VND**.

Checkout stores the paid/gift split and exact net amounts atomically with the seat
reservation. Integer arithmetic preserves the order's paid total; commission is
rounded once per order and its band breakdown sums to that rounded amount. The
migration reconstructs old snapshots only where the original split can be
established from same-row prices or unchanged show metadata and an exact promotion
match. Unknown snapshots, invalid chronology and missing policy ranges are never
silently estimated: reports show a reconciliation issue or fail safely. The final
tier is a finite cap; Admin must extend the show's policy to cover later tickets.

Admin, Sale and Staff views consume the same server-calculated results. Detailed
rows and CSV exports may be capped, but displayed financial totals use complete
history. The feature computes reportable commission and does not issue payouts.

## Sale workspace and customer ticket links

The Sale portal fills the viewport width and has a left-hand desktop menu with
**Home**, **Bán vé**,
**Hoa hồng**, and **Chăm sóc khách hàng**, with compact navigation on mobile.
Visited views preserve their booking and conversation drafts while switching
sections. Inactive seat-inventory and inbox polling pauses; a pending payment
continues checking its status so confirmed payment can refresh the Sale's totals.

Paid bookings and the Sale's customer list provide **Sao chép đường dẫn vé**.
The authenticated, read-only `/api/staff/ticket-link?code=…` endpoint checks exact
Sale ownership, paid status and the complete issued seat set before returning a
signed customer link. Unassigned orders and legacy name matches do not bypass
ownership. Responses are not cached and never include the raw payment access
token or check-in secrets. Clipboard failures reveal a selectable link for manual
copying. Requesting or copying a link does not issue tickets or send another email;
the existing payment email workflow remains responsible for email delivery.
