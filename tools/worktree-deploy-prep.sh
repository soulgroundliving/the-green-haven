#!/usr/bin/env bash
# tools/worktree-deploy-prep.sh
# Prep / cleanup helper for firebase deploy from a git worktree.
# Why: worktrees don't inherit functions/.env or functions/node_modules from main.
# Ref: CLAUDE.md section 5 + next_session_handoff_2026_05_25_sprint7_marketplace_complete.md (Lesson 4)
# Security: .env contents NEVER displayed (per feedback_never_display_secret_files).
#          Only file existence and key-line counts are reported.

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bash tools/worktree-deploy-prep.sh <subcommand>

Subcommands:
  prep      Copy functions/.env from main repo + run npm install in functions/
  cleanup   Remove worktree-local functions/.env (run AFTER firebase deploy)
  status    Show current state of main + worktree (read-only)
  help      Show this message

Why this exists:
  Firebase deploy from a git worktree needs functions/.env AND
  functions/node_modules locally. Worktrees do NOT inherit either from
  the main repo. This script automates the copy + install + cleanup
  without ever displaying secret values.

Typical flow:
  bash tools/worktree-deploy-prep.sh prep
  firebase deploy --only functions:yourFn
  bash tools/worktree-deploy-prep.sh cleanup
EOF
}

abspath() { ( cd "$1" 2>/dev/null && pwd ); }

detect_main_repo() {
  local common_dir
  common_dir=$(git rev-parse --git-common-dir 2>/dev/null) || {
    echo "ERROR: not inside a git repository." >&2
    exit 1
  }
  abspath "$(dirname "$common_dir")"
}

in_worktree() {
  local git_dir common_dir
  git_dir=$(abspath "$(git rev-parse --git-dir)")
  common_dir=$(abspath "$(git rev-parse --git-common-dir)")
  [ "$git_dir" != "$common_dir" ]
}

count_env_keys() {
  if [ -f "$1" ]; then
    grep -cE '^[A-Z][A-Z0-9_]*=' "$1" 2>/dev/null || echo 0
  else
    echo 0
  fi
}

require_worktree() {
  if ! in_worktree; then
    echo "ERROR: you appear to be in the MAIN repo ($MAIN_REPO)." >&2
    echo "       This script is for git worktrees only. In the main repo, deploy normally." >&2
    exit 1
  fi
}

cmd_status() {
  echo "Main repo:        $MAIN_REPO"
  echo "Current worktree: $(pwd)"
  echo
  if [ -f "$MAIN_REPO/functions/.env" ]; then
    echo "main functions/.env:        present ($(count_env_keys "$MAIN_REPO/functions/.env") key lines)"
  else
    echo "main functions/.env:        MISSING -- create it before running prep"
  fi
  if [ -f functions/.env ]; then
    echo "worktree functions/.env:    present ($(count_env_keys functions/.env) key lines)"
  else
    echo "worktree functions/.env:    absent"
  fi
  if [ -d functions/node_modules ]; then
    echo "worktree node_modules:      present"
  else
    echo "worktree node_modules:      absent"
  fi
}

cmd_prep() {
  if [ ! -f "$MAIN_REPO/functions/.env" ]; then
    echo "ERROR: main repo missing functions/.env at $MAIN_REPO/functions/.env" >&2
    echo "       Create it in the main repo first, then re-run." >&2
    exit 2
  fi

  if [ -f functions/.env ]; then
    echo "[INFO] functions/.env already present in this worktree -- leaving alone."
  else
    cp "$MAIN_REPO/functions/.env" functions/.env
    chmod 600 functions/.env 2>/dev/null || true
    echo "[OK]   Copied functions/.env from main repo ($(count_env_keys functions/.env) keys)"
  fi

  if [ -d functions/node_modules ]; then
    echo "[INFO] functions/node_modules already present -- skipping npm install."
  else
    echo "[STEP] Running npm install in functions/ (~9s, ~520 packages)..."
    ( cd functions && npm install --no-audit --no-fund )
    echo "[OK]   functions/node_modules installed."
  fi

  echo
  echo "Next: firebase deploy --only functions:yourFn"
  echo "Then: bash tools/worktree-deploy-prep.sh cleanup"
}

cmd_cleanup() {
  if [ -f functions/.env ]; then
    rm -f functions/.env
    echo "[OK]   Removed worktree-local functions/.env"
  else
    echo "[INFO] functions/.env already absent."
  fi
  if [ -d functions/node_modules ]; then
    echo "[INFO] functions/node_modules kept (gitignored; speeds up next deploy)."
  fi
}

MAIN_REPO=$(detect_main_repo)

case "${1:-}" in
  prep)
    require_worktree
    cmd_prep
    ;;
  cleanup)
    require_worktree
    cmd_cleanup
    ;;
  status)
    cmd_status
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    echo "ERROR: unknown subcommand: $1" >&2
    usage >&2
    exit 1
    ;;
esac
