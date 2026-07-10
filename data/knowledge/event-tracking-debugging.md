---
id: event-tracking-debugging
title: Event Tracking Debugging
tags: events, tracking, metrics, timeline
---
# Event tracking debugging

Event tracking issues require the metric name, event timestamp, profile
identifier, payload shape, API response, and whether the event appears in the
profile activity timeline. A successful API response does not always mean the
event has qualified every flow or segment; ingestion delay, malformed customer
properties, duplicate profile identifiers, or timestamp conversion can affect
downstream behavior.

Ask for the profile email or customer ID, event name, event timestamp with time
zone, request ID if available, and a sample payload with secrets removed.
Compare storefront time, API accepted time, and activity timeline time before
declaring data loss. If several customers report the same delay in one region,
correlate tickets before treating each report as isolated.

Customer-facing phrasing should ask for profile, metric, timestamp, and payload
details. It should explain that the team will compare the event payload,
profile timeline, and downstream qualification before recommending a change.
