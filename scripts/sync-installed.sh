#!/usr/bin/env bash
# Sync the installed hook copies to the committed HEAD of this repo.
# Extracts `git archive HEAD` into a temp dir, then atomically mv's the whole
# thing over the install dir — files deleted from version control do not linger,
# and the live dir never shows a half-applied state.
#
# Also (idempotently) installs itself as .git/hooks/post-commit so every commit
# re-syncs automatically. Overwrites only a post-commit hook this script wrote;
# a foreign one is left alone with a warning.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_DIR="${INSTALL_DIR:-/Users/51mini/.local/share/secret-cheeragent}"

tmp="$(mktemp -d /tmp/cheer-sync.XXXXXX)"
trap 'rm -rf "$tmp"' EXIT

git -C "$REPO" archive HEAD | tar -x -C "$tmp"

mkdir -p "$(dirname "$INSTALL_DIR")"
# Whole-dir swap in three moves: old aside -> new in -> old dropped. Never
# writes files into the live dir incrementally, so no partial state and no
# residue of files deleted from version control.
old=""
if [ -d "$INSTALL_DIR" ]; then
  old="$INSTALL_DIR.old-$$"
  mv "$INSTALL_DIR" "$old"
fi
mv "$tmp" "$INSTALL_DIR"
rm -rf "$old"

HOOK="$REPO/.git/hooks/post-commit"
SELF="$(cd "$(dirname "$0")" && pwd)/sync-installed.sh"
if [ -e "$HOOK" ] && ! grep -q 'sync-installed.sh' "$HOOK" 2>/dev/null; then
  echo "warning: $HOOK exists and is not ours, leaving it untouched" >&2
else
  cat > "$HOOK" <<EOF
#!/usr/bin/env bash
exec "$SELF"
EOF
  chmod +x "$HOOK"
fi

echo "synced $REPO@HEAD -> $INSTALL_DIR"
