"""Export shared seed documents as Vertex AI Search JSONL; no workspace data is indexed."""

import json
from app.workspaces.seed import load

for key in ("designDoc", "statusDoc", "wiki", "testPlan"):
    document = load(f"docs/{key}.json")
    for index, section in enumerate(document["sections"]):
        print(
            json.dumps(
                {
                    "id": f"{document['id']}_{index}",
                    "structData": {
                        "audience": "team",
                        "documentKey": key,
                        "title": document["title"],
                        "locator": section["section"],
                        "text": "\n".join(section["lines"]),
                    },
                }
            )
        )
