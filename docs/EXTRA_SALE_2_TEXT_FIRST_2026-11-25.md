# Extra Sale 2.0 — text first, voice second

## User-approved order (25 Nov 2026)
1. Greet once using Facebook name when safe and local time, without guessing gender; disclose AI assistance once.
2. Recognize the show from the incoming ad/referral if available.
3. Ask preferred view: audience-left, audience-right or center. Do not lead with distance.
4. Describe artist interaction only when relevant: planned 20–30 minutes, possible access through aisles, never promise every seat a visit.
5. Present only verified, current, show-specific promotions and conditions.
6. Ask budget if unknown, check live price and availability, then hand off to existing reservation/payment flow.
7. Offer voice politely during consultation, never send without opt-in and confirmed audio transport.

## Integration gate
Current repository Messenger webhook ingests text and assigns conversations to human staff. There is no verified autonomous AI reply path in these files. The new text policy is a reusable library, not an enabled chatbot. Before wiring it, locate/confirm actual AI runtime, ownership and permission boundaries; add conversation state and tests. Never send automated messages from a human-assigned conversation without explicit routing design.

Voice work remains disabled until text workflow is integrated and tested. No deployment, no production webhook changes.
