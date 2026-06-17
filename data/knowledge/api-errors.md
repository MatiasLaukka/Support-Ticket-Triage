---
id: api-errors
title: API Error Investigation
tags: api, errors, rate-limit, validation
---
# API error investigation

Record the endpoint, status code, request identifier, region, and timestamp.
Correlate repeated 5xx reports before treating them as isolated requests. For
4xx responses, verify payload validation and published limits first.
