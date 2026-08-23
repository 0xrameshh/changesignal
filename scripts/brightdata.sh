#!/usr/bin/env bash
set -euo pipefail

COMMAND="${1:-}"
COLLECTOR_ID="${BRIGHTDATA_COLLECTOR_ID:-}"
TARGET_URL="${BRIGHTDATA_TARGET_URL:-https://bun.sh/blog}"
HEAL_PROMPT="${BRIGHTDATA_HEAL_PROMPT:-The target page changed its HTML and the latest run returned an incomplete entries array. Keep the same JSON shape and restore title, published date, category label, URL, and short summary from the public changelog cards. Exclude author names, reactions, comments, and personal data.}"

case "$COMMAND" in
  create)
    ./node_modules/.bin/bdata scraper create "$TARGET_URL" \
      "Extract each public changelog card with its article title, published date, category label, short summary, and article URL. Return JSON with an entries array. Do not include author names, reactions, comments, or personal data." \
      --name changesignal-bun-blog --json --pretty
    ;;
  run)
    if [[ -z "$COLLECTOR_ID" ]]; then
      echo "BRIGHTDATA_COLLECTOR_ID is required for a run." >&2
      exit 1
    fi
    ./node_modules/.bin/bdata scraper run "$COLLECTOR_ID" "$TARGET_URL" --json --pretty
    ;;
  heal)
    if [[ -z "$COLLECTOR_ID" ]]; then
      echo "BRIGHTDATA_COLLECTOR_ID is required for healing." >&2
      exit 1
    fi
    HEAL_FLAGS=(--json --pretty --url "$TARGET_URL")
    if [[ "${BRIGHTDATA_HEAL_AUTO_APPROVE:-false}" == "true" ]]; then
      HEAL_FLAGS+=(--auto-approve --auto-save)
    fi
    ./node_modules/.bin/bdata scraper heal "$COLLECTOR_ID" \
      "$HEAL_PROMPT" \
      "${HEAL_FLAGS[@]}"
    ;;
  *)
    echo "Usage: $0 {create|run|heal}" >&2
    exit 1
    ;;
esac
