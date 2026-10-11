# VC meeting demo materials

These are synthetic, versioned inputs for the hypothetical calendar day, not observed traction or a real investor meeting.

The current demo selects **only `Hormes-deck-v1.pdf`** (3,972 bytes, SHA-256 `5c43a13db154b84f793c82c7b6c1915d7c96573badc47026608ff7a1d37812a7`). It is the existing three-slide pitch. `Hormes-retention-v1.xlsx` is a historical fixture and is no longer selected or attached. No separate slide file is requested.

The explicitly supplied recipient is **JacobY@transposeplatform.vc**. The model cannot invent or replace the recipient or attachment paths. Hormes copies the selected catalog file into durable session storage and rechecks its size and SHA-256 before review, browser preparation and post-authentication sending.

Rehearse the source-backed brief, explicitly start silent meeting capture, and use this mock investor line:

> This looks interesting. Send me the latest pitch deck after this, and let’s reconnect next week.

End capture or save a clearly identified typed recap. Generate and review the follow-up, then choose **Prepare Gmail draft** with exactly one signed-in Gmail tab open. This creates an actual Gmail compose with the checked PDF. The optional local `.eml` export remains a distinct local file, not a Gmail completion receipt.

**Authenticate & send** is a separate explicit action. It uses the existing macOS owner approval sheet (Touch ID or Mac password), binds the reviewed recipient/body/attachment hashes and exact tab/compose identity, and rechecks the live compose after approval. Cancelled, missing or stale approval leaves the draft unsent. Missing byte-bound attachment evidence disables app sending. An uncertain native send outcome is not retried and is not a delivery receipt. Scheduling remains pending.

Development tests use fake approval and synthetic Gmail. Actual biometric approval and live sending must not run as part of automated rehearsal. The separately recorded live draft result determines whether Gmail attachment upload/readback is verified on the current account.
