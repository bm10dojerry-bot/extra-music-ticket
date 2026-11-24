# Messenger Voice Extra 2.0 — implementation checklist (2026-11-25)

Status: isolated development branch only; NOT deployed or verified end-to-end.

## Current code findings
- app/api/meta/messenger/webhook/route.ts currently ignores messages without text, including audio attachments.
- lib/facebook-messenger.ts currently sends text only.
- docs/TIEP_TUC_META_MESSENGER_2026-11-24.md records that real customer webhook delivery and App Review are not yet verified.
- Previously exposed Meta access token must be revoked and rotated by an authorized operator before live tests.

## Phase 1: incoming voice
1. Verify webhook subscriptions, Meta App identity and signed deliveries with a permitted tester.
2. Detect audio attachment metadata without logging private audio URLs.
3. Retrieve attachments securely with strict timeouts, size limits and allowed hosts; do not blindly fetch untrusted URLs.
4. Transcribe Vietnamese speech; handle uncertainty and ask only for unclear details.
5. Feed transcription into existing conversation context; deduplicate by message ID.

## Phase 2: outgoing voice
1. Track explicit per-conversation opt-in and opt-out.
2. Generate short Vietnamese audio using approved TTS provider.
3. Verify supported audio upload/attachment send method on Messenger and send success in a test conversation.
4. Fall back to text if unsupported, expired or unsuccessful.
5. Do not announce voice availability before successful transport testing.

## Safety / release
- Keep typing indicator, seat availability, booking, payment and confirmation logic untouched.
- No hardcoded secrets, PSIDs, audio URLs or customer content in logs.
- Feature flag default OFF, unit tests and integration tests before staged deployment.
- No AI phone calls or VinaPhone integration in this phase.
