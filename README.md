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
