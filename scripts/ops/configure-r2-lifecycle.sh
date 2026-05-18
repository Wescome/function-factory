#!/bin/bash
# Sets a 30-day expiry on per-stage attempt logs in the ff-workspaces R2 bucket.
# Does NOT affect _summary.json or per-event objects (no expiry on those).
wrangler r2 bucket lifecycle add ff-workspaces \
  attempt-logs-30d \
  "runs/_attempt-logs/" \
  --expire-days 30 \
  --force
