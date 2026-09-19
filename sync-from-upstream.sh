#!/usr/bin/env bash
# Refresh this repository from the panel's source inside the parent project.
#
# One-way: upstream is the source of truth for the app, this repository is a
# published snapshot of it. Files that exist only here (this script, the README,
# the Dockerfile) are kept — copying blindly would overwrite them, which is a
# mistake worth making only once.
#
#   ./sync-from-upstream.sh [path-to-svelte-ops]
#
# Afterwards: npm ci && npm run check, then read `git diff` before committing.
# The diff is the point — it is the last look at what is about to be published.

set -euo pipefail

SRC="${1:-$HOME/shipping-system/frontend/svelte-ops}"
DST="$(cd "$(dirname "$0")" && pwd)"

[ -d "$SRC/src" ] || { echo "not a svelte-ops checkout: $SRC" >&2; exit 1; }

# Kept, never overwritten by a sync.
#
# src/app-fonts.css is the important one: this repository ships its own
# open-licensed font stack, and that file is where it is declared. Let a sync
# overwrite it and the next build pulls in font binaries that must not be
# published here.
KEEP="README.md Dockerfile nginx.conf sync-from-upstream.sh LICENSE src/app-fonts.css .gitignore"

# Fonts are an allowlist, not a blocklist: only the open-licensed files this
# repository ships may come across, and anything else under src/lib/fonts/ is
# skipped whatever it is called. The .gitignore rules are a second line of
# defence; this is the first, because a sync that overwrote .gitignore would
# disarm them in the same pass.
FONT_DIR="src/lib/fonts/"
FONT_ALLOW="SNPro-"

cd "$SRC"
git ls-files . | while read -r f; do
  for k in $KEEP; do [ "$f" = "$k" ] && continue 2; done
  case "$f" in
    "$FONT_DIR"*)
      base=${f#"$FONT_DIR"}
      case "$base" in "$FONT_ALLOW"*) ;; *) continue;; esac
      ;;
  esac
  mkdir -p "$DST/$(dirname "$f")"
  cp "$SRC/$f" "$DST/$f"
done

echo "synced from $SRC"
echo
echo "Before committing, check that nothing unpublishable came with it:"
echo "  git status --short src/lib/fonts/   # must show no new font binaries"
echo "  grep -rniE 'password|secret|api[_-]?key|token *=' src/"
echo "  git diff"
