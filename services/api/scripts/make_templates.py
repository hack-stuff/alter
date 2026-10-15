"""Create the five demo templates once using the configured demo account."""

import json
from app.config import Settings
from app.google.creds import DemoCredentials
from app.google import drive, docs, sheets
from app.secrets import Secrets
from app.workspaces.seed import load


def main():
    settings = Settings.from_env()
    if not settings.google_oauth_secret:
        raise SystemExit("Set GOOGLE_OAUTH_SECRET_NAME.")
    credentials = DemoCredentials(settings, Secrets())
    service = credentials.service("drive", "v3")
    ids = {}
    for key in ("designDoc", "statusDoc", "wiki", "testPlan", "sheet"):
        mime = (
            "application/vnd.google-apps.spreadsheet"
            if key == "sheet"
            else "application/vnd.google-apps.document"
        )
        resource, created = drive.create_file(
            service,
            "templates",
            f"alter-template-v1:{key}",
            f"Alter template · {key}",
            mime,
        )
        ids[key] = resource["id"]
        if created:
            if key == "sheet":
                sheets.seed(credentials.service("sheets", "v4"), resource["id"])
            else:
                docs.replace(
                    credentials.service("docs", "v1"),
                    resource["id"],
                    load(f"docs/{key}.json")["sections"],
                )
        elif key != "sheet":
            current = docs.read(credentials.service("docs", "v1"), resource["id"])
            if not current["rawText"].strip():
                raise RuntimeError(
                    "An incomplete template requires manual reconciliation; it was not rewritten."
                )
    print("GOOGLE_TEMPLATE_IDS=" + json.dumps(ids))


if __name__ == "__main__":
    main()
