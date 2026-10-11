#!/bin/sh
# Checks scripts/install.sh without running it for real: a syntax pass, shellcheck when it is
# installed, a dry run that must exit 0 and print the plan and exactly its four commands in order
# (the runtime quick start), and checks the installer's safety invariants.
# Run it from the repo root: `sh scripts/check-install.sh`.
set -eu

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
script="$root/scripts/install.sh"
status=0

ok() { printf 'check-install: ok    %s\n' "$*"; }
bad() { printf 'check-install: FAIL  %s\n' "$*" >&2; status=1; }

[ -f "$script" ] || { printf 'check-install: %s is missing\n' "$script" >&2; exit 1; }

# 1  syntax
if sh -n "$script"; then ok "sh -n"; else bad "sh -n"; fi

# 2  shellcheck, when present
if command -v shellcheck >/dev/null 2>&1; then
  if shellcheck -s sh "$script"; then ok "shellcheck"; else bad "shellcheck"; fi
else
  printf 'check-install: skip  shellcheck (not installed)\n'
fi

# 3  the dry run: exit 0, the plan printed, exactly the four README commands in order (pnpm install
#    for the runtime). The caller's HORMES_NO_OPEN and HORMES_REF are
#    dropped and the clone path is a folder that does not exist, so the run is the same on every Mac:
#    the checks, a clone, the four commands, the open.
out="$(mktemp)"
trap 'rm -f "$out"' EXIT
if (unset HORMES_NO_OPEN HORMES_REF; HORMES_REPO_URL="https://example.invalid/hormes.git" HORMES_DIR="$out.hormes" HORMES_DRY_RUN=1 sh "$script") >"$out" 2>&1; then
  ok "dry run exits 0"
else
  bad "dry run exited non-zero:"
  cat "$out" >&2
fi
if grep -q '^hormes: The plan:$' "$out"; then ok "prints the plan"; else bad "no plan printed"; fi
if grep -q '^hormes: Dry run: every step is printed, none is run\.$' "$out"; then ok "says it is a dry run"; else bad "dry run not announced"; fi
expected="pnpm install
pnpm build:hands
pnpm build:mac
open --env HORMES_AUTO_WAKE=0 -a Hormes --args --install-permissions"
# git lines are the clone or the update, not README commands; the script installs no tool itself, so nothing else may appear
actual="$(sed -n 's/^hormes: \$ //p' "$out" | grep -v -E '^git ' || true)"
if [ "$actual" = "$expected" ]; then
  ok "the four commands, in order"
else
  bad "the commands are not the expected four (README's, with pnpm install); got:"
  printf '%s\n' "$actual" >&2
fi
if grep -q -E '^hormes: \$ git clone .*https://example.invalid/hormes\.git |^hormes: \$ git .*-C .* (merge --quiet --ff-only|rebase --quiet) ' "$out"; then
  ok "clones, or pulls an existing checkout"
else
  bad "neither a clone nor a pull was announced"
fi

# 4  what it must never do: outside comments and printed messages, no sudo, no rm, no ~/.hormes/env,
#    and pnpm run doctor is named, never run
body="$(grep -v -E '^[[:space:]]*#' "$script" | grep -v -E '^[[:space:]]*(say|fail) ')"
if printf '%s\n' "$body" | grep -q -w 'sudo'; then bad "sudo appears outside comments and messages"; else ok "no sudo"; fi
if printf '%s\n' "$body" | grep -q -w 'rm'; then bad "rm appears outside comments and messages"; else ok "no rm"; fi
if printf '%s\n' "$body" | grep -q -F '.hormes/env'; then bad "~/.hormes/env is touched outside comments and messages"; else ok "never touches ~/.hormes/env"; fi
if printf '%s\n' "$body" | grep -q 'doctor'; then bad "pnpm run doctor is run; it may only be named"; else ok "pnpm run doctor is named, never run"; fi
if grep -q -E '^main "\$@"$' "$script" && [ "$(tail -n 1 "$script")" = 'main "$@"' ]; then ok "one main, called on the last line"; else bad "main is not the last line"; fi
if grep -q '^set -eu$' "$script"; then ok "set -eu"; else bad "no set -eu"; fi

exit "$status"
