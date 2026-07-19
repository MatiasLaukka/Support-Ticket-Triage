# Codex Skill AI Showcase

- Mode: controlled
- Provider provenance: classification=controlled-local-simulation; drafting=controlled-local-simulation; network=disabled.
- Final ticket status: resolved

## Governed MCP tool calls

1. `get_ticket_workflow`
2. `evaluate_ticket`
3. `get_ticket_workflow`
4. `mark_response_done`
5. `get_ticket_workflow`
6. `evaluate_ticket`
7. `get_ticket_workflow`
8. `mark_response_done`
9. `get_ticket_workflow`
10. `evaluate_ticket`
11. `get_ticket_workflow`
12. `mark_response_done`
13. `get_ticket_workflow`
14. `record_diagnosis`
15. `get_ticket_workflow`
16. `evaluate_ticket`
17. `get_ticket_workflow`
18. `mark_response_done`
19. `get_ticket_workflow`
20. `evaluate_ticket`
21. `get_ticket_workflow`
22. `mark_response_done`
23. `get_ticket_workflow`
24. `record_diagnosis`
25. `get_ticket_workflow`
26. `mark_fix_available`
27. `get_ticket_workflow`
28. `evaluate_ticket`
29. `get_ticket_workflow`
30. `mark_response_done`
31. `get_ticket_workflow`
32. `evaluate_ticket`
33. `get_ticket_workflow`
34. `mark_response_done`
35. `get_ticket_workflow`
36. `close_ticket`
37. `get_ticket_workflow`

## AI execution traces

- Evaluation 1: preference=gpt-preferred; classification=used; drafting=used.
- Evaluation 2: preference=gpt-preferred; classification=used; drafting=used.
- Evaluation 3: preference=gpt-preferred; classification=used; drafting=used.
- Evaluation 4: preference=gpt-preferred; classification=used; drafting=used.
- Evaluation 5: preference=gpt-preferred; classification=used; drafting=used.
- Evaluation 6: preference=gpt-preferred; classification=used; drafting=used.
- Evaluation 7: preference=gpt-preferred; classification=used; drafting=used.

## Workflow stages

- active: next guided action is `evaluate-ticket`.
- review: next guided action is `review-recommendation`.
- customer-replied: next guided action is `evaluate-ticket`.
- review: next guided action is `review-recommendation`.
- customer-replied: next guided action is `evaluate-ticket`.
- review: next guided action is `review-recommendation`.
- diagnosis-ready: next guided action is `record-diagnosis`.
- diagnosis-recorded: next guided action is `evaluate-ticket`.
- review: next guided action is `review-recommendation`.
- customer-replied: next guided action is `evaluate-ticket`.
- review: next guided action is `review-recommendation`.
- diagnosis-ready: next guided action is `record-diagnosis`.
- fix-ready: next guided action is `mark-fix-available`.
- verification: next guided action is `evaluate-ticket`.
- review: next guided action is `review-recommendation`.
- customer-replied: next guided action is `evaluate-ticket`.
- review: next guided action is `review-recommendation`.
- ready-for-close: next guided action is `close-ticket`.
- closed: next guided action is `none`.

## Explicit approvals

- Scripted portfolio-reviewer simulation: required=true; fields=tags,customerResponse; actor=portfolio-reviewer.
- Scripted portfolio-reviewer simulation: required=true; fields=category,team,tags,customerResponse; actor=portfolio-reviewer.
- Scripted portfolio-reviewer simulation: required=true; fields=customerResponse; actor=portfolio-reviewer.
- Scripted portfolio-reviewer simulation: required=true; fields=customerResponse; actor=portfolio-reviewer.
- Scripted portfolio-reviewer simulation: required=true; fields=customerResponse; actor=portfolio-reviewer.
- Scripted portfolio-reviewer simulation: required=true; fields=customerResponse; actor=portfolio-reviewer.
- Scripted portfolio-reviewer simulation: required=true; fields=customerResponse; actor=portfolio-reviewer.

## Parsed audit events

- 1. type=recommendation-submitted; actor=skill-showcase; timestamp=2026-06-10T10:00:00.000Z.
- 2. type=recommendation-approved; actor=portfolio-reviewer; timestamp=2026-06-10T10:00:02.000Z.
- 3. type=customer-response-sent; actor=portfolio-reviewer; timestamp=2026-06-10T10:00:04.000Z.
- 4. type=customer-reply-received; actor=Jamie Lee; timestamp=2026-06-10T10:00:04.001Z.
- 5. type=recommendation-submitted; actor=skill-showcase; timestamp=2026-06-10T10:00:05.000Z.
- 6. type=recommendation-approved; actor=portfolio-reviewer; timestamp=2026-06-10T10:00:07.000Z.
- 7. type=customer-response-sent; actor=portfolio-reviewer; timestamp=2026-06-10T10:00:09.000Z.
- 8. type=customer-reply-received; actor=Jamie Lee; timestamp=2026-06-10T10:00:09.001Z.
- 9. type=recommendation-submitted; actor=skill-showcase; timestamp=2026-06-10T10:00:10.000Z.
- 10. type=recommendation-approved; actor=portfolio-reviewer; timestamp=2026-06-10T10:00:12.000Z.
- 11. type=customer-response-sent; actor=portfolio-reviewer; timestamp=2026-06-10T10:00:14.000Z.
- 12. type=diagnosis-completed; actor=product-support; timestamp=2026-06-10T10:00:15.000Z.
- 13. type=recommendation-submitted; actor=skill-showcase; timestamp=2026-06-10T10:00:16.000Z.
- 14. type=recommendation-approved; actor=portfolio-reviewer; timestamp=2026-06-10T10:00:18.000Z.
- 15. type=customer-response-sent; actor=portfolio-reviewer; timestamp=2026-06-10T10:00:20.000Z.
- 16. type=customer-reply-received; actor=Jamie Lee; timestamp=2026-06-10T10:00:20.001Z.
- 17. type=recommendation-submitted; actor=skill-showcase; timestamp=2026-06-10T10:00:21.000Z.
- 18. type=recommendation-approved; actor=portfolio-reviewer; timestamp=2026-06-10T10:00:23.000Z.
- 19. type=customer-response-sent; actor=portfolio-reviewer; timestamp=2026-06-10T10:00:25.000Z.
- 20. type=diagnosis-completed; actor=product-support; timestamp=2026-06-10T10:00:26.000Z.
- 21. type=fix-available; actor=product-support; timestamp=2026-06-10T10:00:27.000Z.
- 22. type=recommendation-submitted; actor=skill-showcase; timestamp=2026-06-10T10:00:28.000Z.
- 23. type=recommendation-approved; actor=portfolio-reviewer; timestamp=2026-06-10T10:00:30.000Z.
- 24. type=customer-response-sent; actor=portfolio-reviewer; timestamp=2026-06-10T10:00:32.000Z.
- 25. type=customer-reply-received; actor=Jamie Lee; timestamp=2026-06-10T10:00:32.001Z.
- 26. type=recommendation-submitted; actor=skill-showcase; timestamp=2026-06-10T10:00:33.000Z.
- 27. type=recommendation-approved; actor=portfolio-reviewer; timestamp=2026-06-10T10:00:35.000Z.
- 28. type=customer-response-sent; actor=portfolio-reviewer; timestamp=2026-06-10T10:00:37.000Z.
- 29. type=ticket-updated; actor=portfolio-reviewer; timestamp=2026-06-10T10:00:38.000Z.
