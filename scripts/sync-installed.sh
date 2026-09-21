#!/usr/bin/env bash
# Sync the installed hook copies to the committed HEAD of this repo.
# Extracts `git archive HEAD` into a temp dir, then atomically mv's the whole
# thing over the install dir — files deleted from version control do not linger,
# and the live dir never shows a half-applied state.
#
# Also (idempotently) installs itself as .git/hooks/post-commit so every commit
# re-syncs automatically. Overwrites only a post-commit hook this script wrote;
# a foreign one is left alone with a warning.
set -uo pipefail

# A failed sync leaves the installed copy silently behind HEAD -- the exact failure
# mode this install-copy scheme exists to prevent. post-commit cannot block a commit,
# so the least we can do is say so loudly and exit non-zero.
die() {
  echo "" >&2
  echo "!! sync-installed.sh FAILED: $1" >&2
  echo "!! ${INSTALL_DIR:-<install dir>} is now BEHIND HEAD -- live hooks run stale code." >&2
  echo "!! Re-run outside the sandbox: bash $0" >&2
  echo "" >&2
  exit 1
}

REPO="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_DIR="${INSTALL_DIR:-/Users/51mini/.local/share/secret-cheeragent}"

# TMPDIR, not a hardcoded /tmp: a sandboxed caller only gets its own temp dir.
tmp="$(mktemp -d "${TMPDIR:-/tmp}/cheer-sync.XXXXXX")" || die "cannot create a temp dir under ${TMPDIR:-/tmp}"
trap 'rm -rf "$tmp"' EXIT

git -C "$REPO" archive HEAD | tar -x -C "$tmp" || die "git archive HEAD | tar -x failed"

mkdir -p "$(dirname "$INSTALL_DIR")" || die "cannot create $(dirname "$INSTALL_DIR")"
# Whole-dir swap in three moves: old aside -> new in -> old dropped. Never
# writes files into the live dir incrementally, so no partial state and no
# residue of files deleted from version control.
old=""
if [ -d "$INSTALL_DIR" ]; then
  old="$INSTALL_DIR.old-$$"
  mv "$INSTALL_DIR" "$old" || die "cannot move $INSTALL_DIR aside"
fi
if ! mv "$tmp" "$INSTALL_DIR"; then
  # Put the old copy back rather than leaving no install dir at all.
  [ -n "$old" ] && mv "$old" "$INSTALL_DIR"
  die "cannot move the new tree into $INSTALL_DIR"
fi
trap - EXIT          # $tmp is now $INSTALL_DIR; do not delete it
rm -rf "$old"

HOOK="$REPO/.git/hooks/post-commit"
SELF="$(cd "$(dirname "$0")" && pwd)/sync-installed.sh"
want="#!/usr/bin/env bash
exec \"$SELF\""
if [ -e "$HOOK" ] && ! grep -q 'sync-installed.sh' "$HOOK" 2>/dev/null; then
  echo "warning: $HOOK exists and is not ours, leaving it untouched" >&2
elif [ "$(cat "$HOOK" 2>/dev/null)" = "$want" ]; then
  :   # already ours and current -- do not rewrite (.git/hooks is unwritable under the sandbox)
elif printf '%s\n' "$want" > "$HOOK" 2>/dev/null; then
  chmod +x "$HOOK"
else
  echo "warning: cannot write $HOOK (sandbox?); commits will not auto-sync until you re-run this outside it" >&2
fi

echo "synced $REPO@HEAD -> $INSTALL_DIR"
