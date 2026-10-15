"""Workspace/owner-scoped retrieval, with BM25 as a first-class offline fallback."""

from collections import Counter
import math
import re

WORDS = re.compile(r"[a-z0-9]+")


def words(text):
    return WORDS.findall(text.lower())


def retrieve(
    store,
    wid,
    mid,
    query,
    limit=6,
    personal=False,
    serving_config="",
    search_client=None,
    requester=None,
):
    sources = []
    workspace = store.get(f"workspaces/{wid}") or {}
    for source in store.list(f"workspaces/{wid}/sources"):
        if source.get("status", "active") != "active":
            continue
        if (
            source.get("importedBy")
            and source.get("audience") == "owner"
            and requester not in (None, mid)
        ):
            continue
        if source.get("audience") != "team" and source.get("owner") != mid:
            continue
        if source.get("scope") == "personal" and not personal:
            continue
        source = {
            **source,
            "sourceId": source.get("sourceId", source.get("sourceKey", source["id"])),
        }
        # Collection row IDs are storage keys; logical source IDs are explicitly preserved below.
        source["sourceId"] = source.get("logicalId", source["sourceId"])
        key = source.get("documentKey")
        if key and workspace.get("google", {}).get("docs", {}).get(key):
            source["url"] = workspace["google"]["docs"][key]
        sources.append(source)
    for memory in store.list(f"workspaces/{wid}/memories"):
        current_evidence = all(
            (source := store.get(f"workspaces/{wid}/sources/{sid}"))
            and source.get("status", "active") == "active"
            and source.get("version", 1) == version
            for sid, version in memory.get("sourceVersions", {}).items()
        )
        if (
            current_evidence
            and memory.get("owner") == mid
            and memory.get("state") == "approved"
            and (personal or memory.get("scope") != "personal")
            and (
                memory.get("audience", "team") == "team"
                or requester == mid
                or (requester is None and personal)
            )
        ):
            sources.append(
                {
                    "sourceId": memory["id"],
                    "title": "Approved memory"
                    if memory["source"] != "starter"
                    else "Starter notes",
                    "locator": memory["id"],
                    "text": memory["content"],
                    "owner": mid,
                }
            )
    if not sources:
        return []
    terms = words(query)
    tokens = [words(s["text"] + " " + s["title"]) for s in sources]
    average = sum(map(len, tokens)) / len(tokens)
    counts = [Counter(t) for t in tokens]

    def score(index):
        total = 0
        for term in terms:
            frequency = counts[index][term]
            if not frequency:
                continue
            documents = sum(term in count for count in counts)
            inverse = math.log(1 + (len(sources) - documents + 0.5) / (documents + 0.5))
            total += (
                inverse
                * frequency
                * 2.2
                / (
                    frequency
                    + 1.2 * (0.25 + 0.75 * len(tokens[index]) / max(1, average))
                )
            )
        return total

    ranked = [(score(i), source) for i, source in enumerate(sources)]
    ranked.sort(key=lambda row: row[0], reverse=True)
    results = [source for score_, source in ranked[:limit] if score_ > 0]
    if serving_config:
        # Search is restricted to known, ACL-filtered source IDs. Search never grants access.
        try:
            if search_client is None:
                from google.cloud import discoveryengine_v1

                search_client = discoveryengine_v1.SearchServiceClient()
            response = search_client.search(
                request={
                    "serving_config": serving_config,
                    "query": query,
                    "page_size": limit,
                    "filter": 'audience: ANY("team")',
                }
            )
            by_id = {s["id"]: s for s in sources}
            by_id.update({s["sourceId"]: s for s in sources})
            ordered = []
            for item in response.results:
                source = by_id.get(item.document.id)
                if source and source not in ordered:
                    ordered.append(source)
            merged = [dict(s, retrievalBackend="vertex_search") for s in ordered]
            merged.extend(
                dict(s, retrievalBackend="lexical") for s in results if s not in ordered
            )
            import logging, json

            logging.getLogger("alter.retrieval").info(
                json.dumps(
                    {
                        "event": "retrieval_completed",
                        "backend": "vertex_search" if ordered else "lexical",
                        "searchMatches": len(ordered),
                    }
                )
            )
            return merged[:limit]
        except Exception:
            # The documented BM25 fallback remains scoped to exactly the same authorized records.
            pass
    return [dict(s, retrievalBackend="lexical") for s in results]


def citations(sources):
    return [
        {
            key: source[key]
            for key in ("sourceId", "title", "locator", "url", "retrievalBackend")
            if source.get(key)
        }
        for source in sources
    ]
