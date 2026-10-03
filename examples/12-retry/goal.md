# Bounded async retry

Retry a rejected async function up to n attempts and propagate its last error.

Do not modify acceptance tests. Implement solution.mjs where applicable.

```mastergoal
{
  "version": 1,
  "title": "Bounded async retry",
  "mode": "verified",
  "checks": [
    {
      "id": "acceptance",
      "type": "script",
      "runtime": "node",
      "path": "verify.mjs"
    }
  ]
}
```
