# Screenshot And Demo Capture Guide

Use this guide to capture clean project visuals without exposing secrets or
personal local state.

## Before Capturing

1. Start a clean demo:

```powershell
npm ci
npm run build
$env:APPROVAL_DRAFT_PROVIDER = 'openai'
$env:APPROVAL_RESPONSE_STYLE = 'balanced'
npm run demo:showcase
```

2. Do not show terminals containing `OPENAI_API_KEY`.
3. Keep the browser on the local Approval Desk URL.
4. Use synthetic tickets only. Do not paste real customer data into the demo.

## Suggested Still Screenshots

Capture these in order:

1. **Automation Evidence dashboard**
   - Shows guardrails, activity, estimated minutes saved, and audit counts.
2. **Conversation workspace**
   - Shows `TKT-1010`, the original vague ticket, the manual customer reply
     box, and the conversation timeline.
3. **Adaptive recommendation panel**
   - Shows classifier evidence, lifecycle state, Draft Customer Response,
     **What changed**, and **Why this draft is safe**.
4. **Approval controls**
   - Shows named-field approval and editable customer response.
5. **Post-approval result**
   - Shows updated ticket revision and audit JSON readback.

## Suggested GIF Flow

Keep the GIF under 45 seconds:

1. Select `TKT-1001`.
2. Choose a draft style.
3. Click **Create recommendation**.
4. Briefly hover or pause on **Why this draft is safe**.
5. Approve category and customer response with an actor.
6. Show the refreshed dashboard/audit result.

## Suggested README Placement

If screenshots are added later, place them under:

```text
docs/assets/
```

Recommended filenames:

```text
approval-desk-evidence.png
approval-desk-conversation.png
approval-desk-recommendation.png
approval-desk-approval-audit.png
approval-desk-showcase.gif
```

Then link them from `README.md` near **Use The Local Approval Desk**.

## Redaction Checklist

- No API keys in terminal history or screenshots.
- No real emails, domains, customer names, or payloads.
- No local absolute filesystem paths unless intentionally showing setup.
- No browser tabs with unrelated personal content.

