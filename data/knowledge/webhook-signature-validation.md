---
id: webhook-signature-validation
title: Webhook Signature Validation
tags: webhooks, signatures, delivery, retries
---
# Webhook signature validation

Webhook signature failures often come from signing secret rotation, timestamp
tolerance, raw body handling, proxy transformations, or verification against the
wrong delivery payload. Delayed webhooks require comparing event creation time,
delivery attempt time, retry history, and endpoint response codes.

Ask for the delivery ID, endpoint URL, failure timestamp, signing secret
rotation time, timestamp tolerance, endpoint response code, and whether raw body
parsing changed recently. Do not collect live secrets. Compare the signed
payload and delivery headers with the customer's verification logic before
recommending a code change.

Customer-facing phrasing should ask for delivery ID, endpoint URL, failure
timestamp, signing secret rotation, raw body handling, and timestamp tolerance.
Avoid saying the signature is invalid on either side until payload and header
evidence are compared.
