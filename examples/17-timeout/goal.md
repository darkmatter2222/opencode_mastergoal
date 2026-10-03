# Timed-out verifier cannot pass

Timed-out verifier cannot pass

Do not modify acceptance tests. Implement solution.mjs where applicable.

```mastergoal
{
  "version": 1,
  "title": "Timed-out verifier cannot pass",
  "mode": "verified",
  "checks": [
    {
      "id": "hang",
      "type": "script",
      "path": "verify.mjs",
      "runtime": "node",
      "timeoutMs": 150
    }
  ]
}
```
