---
id: segmentation-audience-rules
title: Segmentation And Audience Rules
tags: segments, audiences, filters, recalculation
---
# Segmentation and audience rules

Segment count differences usually come from rule logic, event recency windows,
profile properties, consent filters, or recalculation timing. A saved segment
can lag behind recent events while recalculation finishes, and boolean rule
changes can remove profiles that looked eligible in an export.

Ask for the segment name, expected count, observed count, rule definition,
sample profile that should qualify, and the time the segment was last edited.
Compare profile properties, recent events, and consent state for the sample
profile before treating the count difference as a defect. For campaign
audiences, capture whether the audience snapshot was created before or after
the segment recalculated.

Customer-facing phrasing should ask for the segment name, expected count, sample
profile, and rule definition. Avoid promising that profiles will be added until
the rule evaluation and recalculation state are checked.
