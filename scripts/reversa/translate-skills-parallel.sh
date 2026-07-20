#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORKER="$ROOT_DIR/scripts/reversa/translate-skill-to-english.mjs"
TMP_DIR="$ROOT_DIR/.reversa/tmp"
BACKUP_DIR="$ROOT_DIR/.reversa/skill-translation-backups"
JOBS="${JOBS:-8}"
DRY_RUN="${DRY_RUN:-0}"
KEEP_BACKUPS="${KEEP_BACKUPS:-1}"
MODEL="${OPENAI_MODEL:-gpt-4o-mini}"
MAX_FILES="${MAX_FILES:-0}"
PT_GREP="Português|Objetivo|Processo|Agente|Executor|descreve|orquestra|Especifica|análise|regras|entrada|saída|executa|gere|produz|sistema|documenta"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required but not installed." >&2
  exit 1
fi

if [ ! -x "$WORKER" ]; then
  echo "Worker not found: $WORKER" >&2
  exit 1
fi

if [ "${DRY_RUN}" -ne 0 ]; then
  echo "Dry-run mode enabled. No files will be modified."
fi

mapfile -t CANDIDATES < <(rg --files "$ROOT_DIR/.agents/skills" "$ROOT_DIR/.claude/skills" "$ROOT_DIR/.kiro/skills" -g 'SKILL.md')

declare -a TO_TRANSLATE=()
for file in "${CANDIDATES[@]}"; do
  if rg -q -m 1 -e "$PT_GREP" "$file"; then
    TO_TRANSLATE+=("$file")
  fi

done

if [ "${MAX_FILES}" -gt 0 ] && [ "${#TO_TRANSLATE[@]}" -gt "$MAX_FILES" ]; then
  TO_TRANSLATE=("${TO_TRANSLATE[@]:0:MAX_FILES}")
fi

COUNT=${#TO_TRANSLATE[@]}
if [ "$COUNT" -eq 0 ]; then
  echo "No Portuguese SKILL.md files matched." >&2
  exit 0
fi

echo "Found ${COUNT} SKILL.md files to translate."

echo
for f in "${TO_TRANSLATE[@]}"; do
  echo "$f"
done

echo

if [ "${DRY_RUN}" -ne 0 ]; then
  echo "DRY-RUN done. Set DRY_RUN=0 to apply changes."
  exit 0
fi

mkdir -p "$TMP_DIR" "$BACKUP_DIR"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
RUN_BACKUP_DIR="$BACKUP_DIR/$TIMESTAMP"
mkdir -p "$RUN_BACKUP_DIR"

export OPENAI_API_KEY="${OPENAI_API_KEY:-}"
if [ -z "$OPENAI_API_KEY" ]; then
  echo "OPENAI_API_KEY is required for live translation." >&2
  exit 1
fi

printf '%s\0' "${TO_TRANSLATE[@]}" | xargs -0 -n 1 -P "$JOBS" node "$WORKER" "$ROOT_DIR" "$RUN_BACKUP_DIR" "$MODEL"

echo "Done. Backups in: $RUN_BACKUP_DIR"
