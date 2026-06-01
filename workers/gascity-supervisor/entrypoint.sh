#!/bin/sh

# Ensure directories
mkdir -p "$GC_HOME" /data/cities/factory

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

# Gas City supervisor — multi-city, domain-agnostic.
# Config read from $GC_HOME/supervisor.toml (bind=0.0.0.0, port=9443, allow_mutations=true)
# Factory city pre-registered in $GC_HOME/cities.toml; additional cities via API at runtime.
# tini (PID 1) restarts this script if gc supervisor run exits — filesystem survives.
gc supervisor run
