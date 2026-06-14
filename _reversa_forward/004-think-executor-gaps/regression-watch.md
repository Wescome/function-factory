# Regression Watch — 004-think-executor-gaps

| ID   | Invariant                                                                  | Check location            | Status |
|------|----------------------------------------------------------------------------|---------------------------|--------|
| W001 | claimBead called before runFiber in executeAtom()                          | think-executor.ts         | [X]    |
| W002 | releaseBead/failBead only fire after successful claim (assigned_to != NULL) | coordinator-do.ts:165-183 | [X]    |
| W003 | /consent route present in CoordinatorDO.fetch() routes                    | coordinator-do.ts:284     | [X]    |
| W004 | consent_audit table created on first /consent write                        | coordinator-do.ts         | [X]    |
| W005 | atom-execute queue message includes runId field                            | queue-handler.ts          | [X]    |
| W006 | After atom-execute completes, /next polled and ready beads dispatched      | queue-handler.ts          | [X]    |
