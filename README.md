# extra-music-ticket
Ticket booking system for Extra Music Show

## Artist image uploads

Apply `supabase/migrations/20261123193821_dynamic_artist_media_slots.sql` before
deploying the dynamic artist upload fix. It extends the media slot constraint
without modifying saved images or access policies. Nondefault artist slots must
belong to an existing saved show, including hidden shows; the upload API verifies
this before writing to Storage. Admin's artist editor and image gallery use the
same show IDs, and public media reads return the same saved slots.

Media uploads accept PNG, JPEG and WebP up to 4 MiB, with matching client/server
validation to leave room for multipart data below Vercel's default
[request-body limit](https://vercel.com/docs/functions/limitations#request-body-size).
Original bytes are retained, including PNG transparency. Admin verifies the exact
new URL through the public media API before reporting success and shows upload
feedback next to the selected image. Regression checks use synthetic files and
mocked storage: `node --test tests/media-upload-routes.test.cjs`.

## Show poster frames and uploads

Both homepage show grids and the Admin poster preview use a centered 2:3 frame.
Existing posters cover that frame at display time, with excess edges clipped and
proportions preserved. The selected-file preview uses the same crop as publication.

New show-poster uploads accept JPEG, PNG or WebP up to 4 MiB. After authorization
and an exact saved-show lookup, the server decodes the image with a 40-million-pixel
limit, applies EXIF orientation, and creates a 1200 × 1800 WebP using centered
cover resizing. The encoder uses quality 90 and retains transparency where present.
See Sharp's [resize](https://sharp.pixelplumbing.com/api-resize/) and
[orientation](https://sharp.pixelplumbing.com/api-operation/#autoorient) documentation.
The immutable normalized object is saved before its path is assigned to the show.
Admin verifies that exact new URL before clearing the selected-file draft.

Poster processing is separate from artist PNG uploads. Existing stored source
images are not rewritten. Regression fixtures use actual local Sharp processing
with mocked external services: `node --test tests/show-poster-routes.test.cjs`.

## Google Analytics visitor map

Admin Overview opens with a Vietnam-centered map using GA4's realtime Data API.
A compact Vietnam/world switch changes only the viewport. Counts describe active
users in the last 30 minutes. The total, country and city reports are queried
separately with the selected web stream's exact ID.

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
from geographic centroids. The Vietnam view uses more detailed 50m coastlines,
subdued regional place names and transparent, softly fading land colours to blend
into Admin's background. Its responsive frame includes mainland Vietnam and the
static Hoàng Sa and Trường Sa island references, with readable two-line captions
on mobile. These reference symbols use representative positions from the official
[geographic gazetteer](https://www.mae.gov.vn/noidung/Lists/VBQPPL/Attachments/514/1_DanhMuc_TT_DiaDanh_BanHanh.pdf)
(VN-2000 DMS converted for approximate schematic placement). They are separate
from Analytics, are not interactive visitor pins, and remain visible without traffic.
The world view keeps the small island symbols and omits the close-set captions.
Activity markers remain a consistent screen size. Offscreen markers are excluded
from keyboard focus; the world view restores
international coverage without filtering report totals or making another request.
Each activity point remains a country aggregate. City coordinates and individual
visitor locations are not plotted. Reports refresh every minute while visible.
Synthetic viewport and marker checks are in `tests/google-analytics-map-ui.test.cjs`.
See the official
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

## Admin workspace

Admin uses the Sale portal's full-width layout, dark styling and left desktop
navigation. The sidebar groups all 22 sections and supports Vietnamese searches
with or without accents. On mobile, **Home**, **Vé**, **Sale**, **Chat** and **Thêm**
remain at the bottom of the screen. Show managers see **Show** in place of the
admin-only Sale report. **Thêm** opens a searchable native dialog containing the
complete menu; dismissing it restores scrolling and keyboard focus.

Overview keeps the transparent GA4 map first. Responsive content styles stack
editors and filters, constrain long select values, and keep wide data tables
scrolling inside their panels. Navigation preserves dashboard-owned form state
and mounts only the active feature, so existing polling cleanup remains in place.
The current section is recorded at `/admin?section=…` without discarding unrelated
query parameters. Backend permissions, reports and payment actions are unchanged.

Synthetic navigation checks: `node --test tests/admin-workspace-ui.test.cjs`.
They use the optional matching React renderer described in
`tests/sale-workspace-ui.test.cjs`; no production data or write actions are used.
