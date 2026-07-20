# Run this

```
cd fiber-recovery-verify && npm install --legacy-peer-deps && npm test
```
Both tests pass, or stop and report the failure.

```
cd ../keel-spike && npm install --legacy-peer-deps
npm run lint:deps      # must print "D6 import boundary: clean."
npm test               # must print "G1 = GREEN"
```

If `npm test` is RED: read the failing check's printed explanation. If it's a
wrong method name/return shape, fix it only in `src/substrate.ts`, re-run. If
the fix isn't obvious (the mechanism itself doesn't hold, not just a wrong
signature), stop and paste the exact failure — don't work around it.

Report back: GREEN or RED, what you changed in substrate.ts and why, exact
commands run.
