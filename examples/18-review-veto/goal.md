# Independent review veto

Independent review veto

Do not modify acceptance tests. Implement solution.mjs where applicable.

```mastergoal
{
  "version": 1,
  "title": "Independent review veto",
  "mode": "verified",
  "checks": [
    {
      "id": "yes",
      "type": "equals",
      "actual": 1,
      "expected": 1
    }
  ],
  "review": {
    "id": "review",
    "type": "script",
    "path": "review.mjs",
    "runtime": "node"
  }
}
```
