---
id: campaign-send-failures
title: Campaign Send Failures
tags: campaigns, send-status, templates, audience
---
# Campaign send failures

Campaign send issues usually start with the scheduled send time, campaign ID,
audience snapshot, template validation state, and suppression counts. A campaign
can remain in preparing state when audience calculation is still running,
template content fails validation, the sender identity is blocked, or the send
window conflicts with compliance settings.

Ask the customer for the campaign name, scheduled time, audience size they
expected, whether the campaign is a one-time send or resend, and any visible
error banner. Check whether the campaign has already created a message batch
before promising that a send can be cancelled or retried. If no messages have
left the platform, the next action can focus on validating the audience,
template, sender profile, and suppression summary.

Customer-facing phrasing should explain what is being checked and ask for the
campaign identifier, scheduled time, expected audience, and screenshot of any
error banner. Do not say a campaign was sent, cancelled, or recovered until the
send status and audit history support that statement.
