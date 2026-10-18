"""Provision Vertex AI Search for the shared seed corpus only.

Run explicitly in the chosen billed GCP project. No private workspace sources,
memories, transcripts or credentials are uploaded by this script.
"""

import argparse
import json

from google.api_core.exceptions import AlreadyExists, NotFound
from google.cloud import discoveryengine_v1 as discovery
from app.workspaces.seed import load


def configure(args):
    parent = f"projects/{args.project}/locations/global/collections/default_collection"
    store_name = parent + "/dataStores/" + args.data_store
    stores = discovery.DataStoreServiceClient()
    try:
        stores.get_data_store(name=store_name)
    except NotFound:
        stores.create_data_store(
            parent=parent,
            data_store_id=args.data_store,
            data_store=discovery.DataStore(
                display_name="Alter shared knowledge",
                industry_vertical="GENERIC",
                solution_types=["SOLUTION_TYPE_SEARCH"],
                content_config="NO_CONTENT",
            ),
        ).result(timeout=300)
    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
            "audience": {"type": "string", "indexable": True, "retrievable": True},
            "documentKey": {"type": "string", "indexable": True, "retrievable": True},
            "title": {
                "type": "string",
                "searchable": True,
                "retrievable": True,
                "keyPropertyMapping": "title",
            },
            "locator": {"type": "string", "retrievable": True},
            "text": {"type": "string", "searchable": True, "retrievable": True},
        },
    }
    discovery.SchemaServiceClient().update_schema(
        schema=discovery.Schema(
            name=store_name + "/schemas/default_schema", json_schema=json.dumps(schema)
        ),
        allow_missing=True,
    ).result(timeout=300)
    documents = []
    for key in ("designDoc", "statusDoc", "wiki", "testPlan"):
        document = load(f"docs/{key}.json")
        for index, section in enumerate(document["sections"]):
            documents.append(
                discovery.Document(
                    id=f"{document['id']}_{index}",
                    struct_data={
                        "audience": "team",
                        "documentKey": key,
                        "title": document["title"],
                        "locator": section["section"],
                        "text": "\n".join(section["lines"]),
                    },
                )
            )
    result = (
        discovery.DocumentServiceClient()
        .import_documents(
            request=discovery.ImportDocumentsRequest(
                parent=store_name + "/branches/default_branch",
                inline_source=discovery.ImportDocumentsRequest.InlineSource(
                    documents=documents
                ),
                reconciliation_mode="INCREMENTAL",
            )
        )
        .result(timeout=300)
    )
    if result.error_samples:
        raise RuntimeError(
            "Some seed documents could not be indexed. Inspect the Search import operation in GCP."
        )
    engines = discovery.EngineServiceClient()
    engine_name = parent + "/engines/" + args.engine
    try:
        engines.get_engine(name=engine_name)
    except NotFound:
        try:
            engines.create_engine(
                parent=parent,
                engine_id=args.engine,
                engine=discovery.Engine(
                    display_name="Alter shared knowledge",
                    solution_type="SOLUTION_TYPE_SEARCH",
                    industry_vertical="GENERIC",
                    data_store_ids=[args.data_store],
                    search_engine_config=discovery.Engine.SearchEngineConfig(
                        search_tier="SEARCH_TIER_STANDARD"
                    ),
                ),
            ).result(timeout=300)
        except AlreadyExists:
            pass
    serving_config = engine_name + "/servingConfigs/default_search"
    response = discovery.SearchServiceClient().search(
        request={
            "serving_config": serving_config,
            "query": "one-tap production approval",
            "filter": 'audience: ANY("team")',
            "page_size": 3,
        }
    )
    matches = list(response.results)
    if not matches:
        raise RuntimeError(
            "Import succeeded but Search has not returned matches yet. Allow indexing to finish and rerun."
        )
    print("SEARCH_SERVING_CONFIG: " + serving_config)
    print(
        f"Verified Search returned {len(matches)} seed matches. Add the config to the local API YAML and redeploy."
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--data-store", default="alter-shared-seed")
    parser.add_argument("--engine", default="alter-knowledge")
    configure(parser.parse_args())
