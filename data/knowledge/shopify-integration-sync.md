---
id: shopify-integration-sync
title: Shopify Integration Sync
tags: shopify, ecommerce, catalog, orders
---
# Shopify integration sync

Shopify sync issues can affect orders, products, customers, catalog fields, and
ecommerce events. Useful evidence includes store URL, integration connection
state, OAuth scopes, last successful sync time, object type, object ID, SKU, and
whether the source record is visible in Shopify.

Ask for the store URL, affected object ID, SKU or order number, expected field,
last update time in Shopify, and whether the integration was recently
reconnected. Compare Shopify update time with platform import history before
changing severity. If several stores in one region report delayed ecommerce
events, correlate them as a possible incident.

Customer-facing phrasing should ask for store, object ID, SKU or order number,
and sync timing. Do not claim data is lost until the source object and import
history have been checked.
