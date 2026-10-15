"""Provision a director workspace using a verified administrator Firebase token from env."""

import argparse, os
import httpx

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--base", required=True)
parser.add_argument("--name", default="Director")
args = parser.parse_args()
response = httpx.post(
    args.base.rstrip("/") + "/internal/video-workspaces",
    headers={"Authorization": "Bearer " + os.environ["ALTER_ADMIN_ID_TOKEN"]},
    json={"name": args.name},
    timeout=30,
)
if response.is_error:
    raise SystemExit(
        "Workspace provisioning request failed (HTTP "
        + str(response.status_code)
        + ")."
    )
print(response.text)
