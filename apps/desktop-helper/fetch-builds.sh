#!/usr/bin/env bash
# Copies the newest desktop helper builds from GitHub Actions into the web app, which serves
# them from /downloads/ (deploy hosting afterwards). Needs the GitHub CLI: gh auth login.
set -euo pipefail
cd "$(dirname "$0")/../.."
run=$(gh run list --workflow desktop-helper.yml --branch main --status success --limit 1 --json databaseId --jq '.[0].databaseId')
[ -n "$run" ] || { echo "No successful desktop helper build yet." >&2; exit 1; }
out=apps/web/public/downloads
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
gh run download "$run" --dir "$tmp"
mkdir -p "$out"
for dir in "$tmp"/alter-helper-*; do
  cp "$dir/$(basename "$dir")" "$out/"
done
chmod +x "$out"/alter-helper-*
ls -l "$out"
