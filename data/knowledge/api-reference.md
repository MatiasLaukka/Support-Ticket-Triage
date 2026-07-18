---
id: api-reference
title: API Reference
tags: api, endpoints, validation, requests
---
# API reference

API support issues require the endpoint, request ID, timestamp, response status,
redacted payload, and expected result. A request can be accepted by the API while
later processing, validation, or downstream qualification still changes the
customer-visible result.

Ask for the endpoint path, request ID, event or request timestamp with time
zone, API response status, and a sample payload with secrets removed. Compare
the API response with downstream processing before saying a request succeeded
end to end.

Customer-facing phrasing should ask for request details and explain what will be
compared. Never ask for API keys, tokens, passwords, or live secrets.
