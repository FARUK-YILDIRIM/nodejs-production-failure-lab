# Postmortem · Incident {{id}}: {{title}}

> Blameless format: explain how the system allowed the failure, not who caused it.
> Date: {{date}} · Your time to resolve in the lab: {{time}}

## Summary

_Two or three sentences: what happened, who was affected, how it was fixed._

## Impact

- Who and what was affected:
- How badly (latency, errors, requests, with numbers):
- For how long:

## Timeline

| Time | Event |
|---|---|
| | Impact started |
| | Alert fired |
| | Investigation started |
| | Root cause identified |
| | Mitigation applied |
| | Fix deployed and verified |

Time to detect: · Time to mitigate: · Time to resolve:

## Detection

- How was it detected?
- How could it have been detected sooner? Write the alert rule (PromQL) that would have fired first:

```yaml
- alert:
  expr:
  for:
```

## Root cause

_The underlying technical cause, explained so that a teammate who wasn't there understands it._

## Trigger

_Why did the problem show up at this moment?_

## Evidence

_The chain of observations that proves the root cause: queries, trace ids, flame graphs, screenshots. Include the red herrings you ruled out and how._

1.
2.
3.

## Mitigation and fix

- Mitigation (stop the bleeding, minutes):
- Fix (remove the cause):
- Before / after (paste the `./lab verify` table):

## Action items

| Type | Action | Owner |
|---|---|---|
| Prevent | | |
| Detect | | |
| Mitigate | | |

## Lessons learned

- What went well:
- What went wrong:
- Where we got lucky:
