# Diagnostic Evaluation Harness

The diagnostic harness exercises the production classifier, evidence-readiness logic, shared diagnostic workflow, and operator gates. It does not create a second diagnostic engine.

Run it with:

```powershell
npm run evaluate:diagnostics
```

The current scenario matrix covers eleven scenarios across eight families:

- ordinary outage triage;
- deterministic known-cause guidance;
- active known-event correlation;
- out-of-window event rejection;
- partial evidence;
- campaign-editor ambiguity;
- bounded specialist escalation;
- failed-fix recheck;
- customer confirmation;
- stale customer reply handling;
- adversarial prompt-injection text.

The report measures:

- category accuracy;
- known-cause recall;
- known-event precision and recall;
- support-state and diagnosis-outcome accuracy;
- operator-stage accuracy;
- premature action and approval-bypass counts;
- stale-context action count;
- unsafe customer-response count.

Known-event matching is intentionally bounded. A ticket must match the related known cause, service and symptom patterns, and the event’s time window. An active event can surface the existing platform-fix state, while an investigating event remains non-confirmed. Event IDs and match reasons are operator/audit metadata; internal event-matching details are not copied into customer responses.

The harness is deterministic and local. It does not call GPT, mutate tickets, approve recommendations, send responses, record diagnoses, mark fixes, or close tickets.
