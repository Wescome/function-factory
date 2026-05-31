#!/bin/sh

# Ensure directories
mkdir -p /data/dolt "$GC_HOME" /data/cities/factory

# Install supervisor config
cp /etc/gc/supervisor.toml "$GC_HOME/supervisor.toml"

# Bootstrap Factory city — write city.toml, formula, rig dir, and registry.
cp /etc/gc/factory/city.toml /data/cities/factory/city.toml
mkdir -p /data/cities/factory/formulas
cp /etc/gc/factory/formulas/factory-coding-v1.toml /data/cities/factory/formulas/factory-coding-v1.toml
# Fidelity validator — the RELEASE step invokes /data/cities/factory/fidelity/fidelity-release.sh.
mkdir -p /data/cities/factory/fidelity
cp -R /etc/gc/factory/fidelity/. /data/cities/factory/fidelity/
cp /etc/gc/factory/fidelity-checks.toml /data/cities/factory/fidelity-checks.toml
chmod +x /data/cities/factory/fidelity/fidelity-release.sh
mkdir -p /data/cities/factory/rigs/function-factory
printf '[[cities]]\npath = "/data/cities/factory"\nname = "factory"\n' > "$GC_HOME/cities.toml"

# Dolt identity required for bead store init
dolt config --global --add user.name "Gas City" >/dev/null 2>&1 || true
dolt config --global --add user.email "gc@gascity.local" >/dev/null 2>&1 || true

# Configure/push Dolt bead store backup to R2.
# AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are already in env (injected by Worker).
# DOLT_R2_ENDPOINT is a Worker secret: https://<account-id>.r2.cloudflarestorage.com
find_dolt_beads_dir() {
  # Prefer known path first for speed.
  if [ -d "/data/cities/factory/.gc/runtime/packs/dolt" ]; then
    printf '%s\n' "/data/cities/factory/.gc/runtime/packs/dolt"
    return 0
  fi
  # Fallback: discover Dolt data dir in /data tree.
  local hit
  hit="$(find /data -type d \( -name '.dolt' -o -name 'doltdb' \) 2>/dev/null | head -n 1 || true)"
  if [ -n "$hit" ]; then
    dirname "$hit"
    return 0
  fi
  return 1
}

configure_dolt_remote() {
  local beads_dir="$1"
  [ -n "$beads_dir" ] || return 1
  [ -n "${DOLT_R2_ENDPOINT:-}" ] || return 1
  cd "$beads_dir" || return 1
  dolt remote remove r2 2>/dev/null || true
  dolt remote add r2 "s3://dolt-data/factory?endpoint=${DOLT_R2_ENDPOINT}&region=auto" 2>/dev/null || true
  cd /data || true
  return 0
}

# Background push loop — discover the bead store and sync every 60s.
(while true; do
  sleep 60
  DOLT_BEADS_DIR="$(find_dolt_beads_dir || true)"
  if [ -n "$DOLT_BEADS_DIR" ]; then
    configure_dolt_remote "$DOLT_BEADS_DIR"
    cd "$DOLT_BEADS_DIR" && dolt push r2 main 2>/dev/null || true
    cd /data || true
  fi
done) &

# NOTE: Do NOT start dolt sql-server here. city.toml beads.provider = "bd" means
# gc supervisor run starts and manages its own Dolt instance via gc helper.
# A manually started Dolt on port 3306 conflicts with gc helper's Dolt and
# causes "dolt server could not start" / city init_failed.

# Gas City supervisor — multi-city, domain-agnostic.
# Config read from $GC_HOME/supervisor.toml (bind=0.0.0.0, port=9443, allow_mutations=true)
# Factory city pre-registered in $GC_HOME/cities.toml; additional cities via API at runtime.
# tini (PID 1) restarts this script if gc supervisor run exits — filesystem survives.
gc supervisor run
