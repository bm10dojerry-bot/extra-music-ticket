# Messenger Page API → +1 Extra unified Sale inbox

This integration is **dormant until the Page owner grants Meta permissions**. The existing on-site chat remains fully usable without Meta credentials.

## Connect the real +1 Extra Page

1. In [Meta for Developers](https://developers.facebook.com/apps/), create or open the business app that owns the +1 Extra Facebook Page integration. Add the Messenger API / Webhooks product.
2. In Meta Business settings, verify the intended Page ID. The old site used `https://m.me/61594194236470`; **verify this ID belongs to the intended Page** rather than relying only on the link.
3. Grant the app Page messaging access (especially `pages_messaging`; Webhooks Page subscription may also require `pages_manage_metadata`). The account must have permission to manage Page messages. For conversations with the general public, complete Meta's required App Review / advanced access and publish the app in the required mode.
4. Generate the **Page Access Token** (not an Ads API token). Obtain the Meta app's App Secret and invent a long random webhook Verify Token. These are private credentials; **do not paste them into chat or source control**.
5. In Vercel project `extra-music-ticket`, add these Production environment variables via its protected environment settings:
   - `META_MESSENGER_PAGE_ID`: exact approved Facebook Page ID.
   - `META_MESSENGER_PAGE_ACCESS_TOKEN`: the Page Access Token.
   - `META_MESSENGER_APP_SECRET`: Meta app secret.
   - `META_MESSENGER_VERIFY_TOKEN`: your own long random verification string (16+ characters).
   - Optional `META_MESSENGER_GRAPH_VERSION`: Graph API version, defaults to `v24.0`. Update as Meta API versions evolve.
6. Redeploy Production so the server-side variables become available. In the app's Meta Messenger Webhooks settings, set:
   - **Callback URL:** `https://iextra.net/api/meta/messenger/webhook`
   - **Verify Token:** exactly the value of `META_MESSENGER_VERIFY_TOKEN`
   - **Object:** Page
   - **Webhook subscription:** `messages` for inbound text messages. The app must be subscribed to the Page's messaging events, not merely the Webhooks product.
7. After successful webhook verification and Page subscription, send a test text message to the Page from a test Facebook account that is allowed by the app's access level. Look for a conversation marked **Facebook Messenger** in the Sale/Admin inbox.
8. Test a reply from the assigned Sale. A reply sends through the Graph Send API using the Page token, then records the message in the Extra inbox after successful Meta acknowledgement. Respect Meta's messaging windows/allowed message types.

## How this works

- **Customer messages to Facebook Page:** Meta signs a webhook event; the server verifies `X-Hub-Signature-256`, rejects mismatched Pages and duplicates, saves the text in `extra_support_chats` and `extra_support_messages`, and uses the existing 8-active-chats-per-Sale allocator.
- **Sale replies to Facebook Page:** Verified Sale/Admin sends from its own Extra inbox; the server validates ownership, calls Meta's Send API and saves the response after Meta success.
- **Customer messages written directly on iextra.net:** remain in native on-site chat as before. A visitor's browser session cannot automatically be assigned a Messenger PSID just because the Page API is connected. Merging an anonymous website visitor with a Facebook account would require their deliberate Messenger interaction/identity link and user consent.
- Text messages only are ingested in this initial bridge. Attachments, historical Facebook inbox sync, read receipts and older conversations are not automatically imported.
- Even with credentials, Meta may reject messages outside allowed response periods, or while the app is not approved for public use. The Extra inbox returns an error instead of showing an unaccepted Meta send as successful.
- **Never embed the Page Access Token or App Secret in browser code.** All Meta API calls occur server-side.

## Troubleshooting

- `GET /api/meta/messenger/webhook` without configured credentials returns **503**: normal before the owner adds Page credentials.
- A challenge with wrong verify token returns 403. A POST with invalid `X-Hub-Signature-256` returns 403.
- Sale sees a Messenger chat but sending is disabled: ensure all four environment variables exist in the Production deployment.
- Meta webhook not arriving: check the app's Page subscription, permission status, app mode and that it is subscribed to the right Page.
- Still no Page token? Ads account data in Windsor.ai is *not* a Facebook Page message token.

References:
- https://developers.facebook.com/docs/messenger-platform/getting-started/quick-start
- https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-pages
