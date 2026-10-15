#!/usr/bin/env bash
# Run from anywhere in this checkout; requires ADC, never a pasted access token.
set -euo pipefail
api_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_dir="$(cd "$api_dir/../.." && pwd)"
cd "$repo_dir"
if [[ ! -x "$api_dir/.venv/bin/python" ]]; then
  echo "Create services/api/.venv and install services/api[dev] with requirements.lock first." >&2
  exit 1
fi
export PYTHONPATH="$api_dir${PYTHONPATH:+:$PYTHONPATH}"
exec "$api_dir/.venv/bin/python" -m pytest "$api_dir/tests/test_vertex_live.py" --live-models -x -v --tb=short -s "$@"
