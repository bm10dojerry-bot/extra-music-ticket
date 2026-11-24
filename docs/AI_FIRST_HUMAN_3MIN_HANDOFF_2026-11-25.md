# AI Sale Extra 2.0 — conversation ownership (confirmed by owner 2026-11-25)

## Mandatory behavior
- AI is the default and primary owner of every incoming Messenger customer conversation. DO NOT automatically assign all incoming messages to Sale staff.
- A human agent intervenes only by explicitly taking over or replying within a Messenger conversation.
- On confirmed human intervention, pause all automated AI outbound replies for that conversation. Continue recording incoming context.
- Track the latest confirmed human activity time. If no new human response/activity for a full 180 seconds, AI resumes handling the conversation, with full context, without a second greeting.
- Each subsequent confirmed human action resets the 180-second inactivity timer. Human intervention takes precedence over AI; pending AI sends must be cancelled or guarded against races.
- If the customer requests a human, do not forcibly take over while the customer is awaiting the human; define escalation rules separately.
- On resumption, do not claim a human said something they did not; avoid duplicate replies and preserve message ordering.
- Do not use a one-shot in-memory timer in a serverless function. Use durable timestamps and a scheduled job or event-driven state evaluation.
- Idempotency by Messenger MID and atomic ownership transition. Test concurrent human/AI events and exact 180-second boundary.

## Current code gap
- `app/api/meta/messenger/webhook/route.ts` calls `extra_support_assign_chat` after ingest, which routes to staff.
- `app/api/staff/support-chats/route.ts` provides human staff reply and routing, but no verified AI-first ownership or three-minute resumption logic.
- Before enabling, identify the actual AI runtime and Meta Page conversation activity signals. Avoid inferring human intervention from messages authored by AI or from mere page delivery.
- Do not deploy before safe tests; preserve booking, payment and existing typing indicator.

## Implementation order
1. Text AI sales script and AI-first ownership / human pause-resume.
2. End-to-end test with permitted Messenger accounts.
3. Voice inbound/outbound only after text works.
4. Phone calls remain deferred.
