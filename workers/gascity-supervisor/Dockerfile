FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates netcat-openbsd unzip bash openssl tini git \
    && DOLT_VERSION=2.0.3 \
    && curl -fsSL "https://github.com/dolthub/dolt/releases/download/v${DOLT_VERSION}/dolt-linux-amd64.tar.gz" \
       | tar -xz -C /usr/local/bin --strip-components=2 dolt-linux-amd64/bin/dolt \
    # bd — beads CLI required by gc-beads-bd.sh (bd provider bead store management).
    && BD_VERSION=1.0.4 \
    && curl -fsSL "https://github.com/gastownhall/beads/releases/download/v${BD_VERSION}/beads_${BD_VERSION}_linux_amd64.tar.gz" \
       | tar -xz -C /usr/local/bin bd \
    # bun — single static binary; runs the deterministic fidelity validator CLI.
    # The container has no node/python/jq, so the validator ships its own runtime.
    && BUN_VERSION=1.3.13 \
    && ARCH="$(dpkg --print-architecture)" \
    && case "$ARCH" in amd64) BUN_TARGET=bun-linux-x64 ;; arm64) BUN_TARGET=bun-linux-aarch64 ;; *) echo "unsupported arch $ARCH" && exit 1 ;; esac \
    && curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${BUN_TARGET}.zip" -o /tmp/bun.zip \
    && unzip -q /tmp/bun.zip -d /tmp/bun \
    && mv "/tmp/bun/${BUN_TARGET}/bun" /usr/local/bin/bun \
    && chmod +x /usr/local/bin/bun \
    && rm -rf /tmp/bun /tmp/bun.zip /var/lib/apt/lists/*
COPY gc-linux-amd64 /usr/local/bin/gc
RUN chmod +x /usr/local/bin/gc
COPY entrypoint.sh /entrypoint.sh
COPY supervisor.toml /etc/gc/supervisor.toml
COPY factory/city.toml /etc/gc/factory/city.toml
COPY factory/formulas/factory-coding-v1.toml /etc/gc/factory/formulas/factory-coding-v1.toml
# Gas City fidelity validator (IS-GC-FIDELITY-VALIDATION) — deterministic verdict
# bijection, RELEASE payload + HMAC, convergence loop, fail-closed emission.
COPY factory/fidelity /etc/gc/factory/fidelity
COPY factory/fidelity-checks.toml /etc/gc/factory/fidelity-checks.toml
RUN test -f /etc/gc/factory/fidelity-checks.toml
RUN chmod +x /entrypoint.sh /etc/gc/factory/fidelity/fidelity-release.sh
ENV GC_HOME=/data/gc
WORKDIR /data
EXPOSE 9443
EXPOSE 3306
ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
