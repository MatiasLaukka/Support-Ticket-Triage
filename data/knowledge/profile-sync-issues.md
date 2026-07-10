---
id: profile-sync-issues
title: Profile Sync Issues
tags: profiles, consent, imports, identity
---
# Profile sync issues

Profile sync issues involve identity matching, duplicate records, consent
state, imports, and API updates. The same person can appear under multiple
profiles when email, phone, external ID, or ecommerce customer ID changes. A
profile update can also appear delayed if an import is still processing or the
latest update wrote to a different identifier.

Ask for the profile email, phone number if SMS is involved, external customer
ID, import filename or API request ID, update timestamp, and what field should
have changed. Check whether duplicate profiles exist before recommending a
merge. For consent issues, confirm source, opt-in or opt-out timestamp, region,
and channel.

Customer-facing phrasing should ask for identity and timestamp details, explain
that duplicate profiles and consent state are being checked, and avoid promising
profile merges until the matching identifiers are verified.
