from app.google.drive import run


def text(sections):
    return (
        "\n\n".join(
            section["section"] + "\n" + "\n".join(section["lines"])
            for section in sections
        )
        + "\n"
    )


def read(service, file_id):
    document = run(service.documents().get(documentId=file_id))
    chunks = []

    def walk(content):
        for element in content:
            if "paragraph" in element:
                chunks.append(
                    "".join(
                        part.get("textRun", {}).get("content", "")
                        for part in element["paragraph"].get("elements", [])
                    )
                )
            for row in element.get("table", {}).get("tableRows", []):
                for cell in row.get("tableCells", []):
                    walk(cell.get("content", []))

    walk(document.get("body", {}).get("content", []))
    raw = "".join(chunks)
    sections = []
    for block in raw.strip().split("\n\n"):
        lines = block.splitlines()
        if lines:
            sections.append({"section": lines[0], "lines": lines[1:]})
    if not sections:
        sections = [{"section": document.get("title", "Document"), "lines": []}]
    return {
        "sections": sections,
        "revision": document["revisionId"],
        "rawText": "".join(chunks),
        "endIndex": document.get("body", {})
        .get("content", [{"endIndex": 2}])[-1]
        .get("endIndex", 2),
        "url": f"https://docs.google.com/document/d/{file_id}/edit",
    }


def replace(service, file_id, sections, required_revision=None):
    current = read(service, file_id)
    requests = []
    end = current["endIndex"] - 1
    if end > 1:
        requests.append(
            {"deleteContentRange": {"range": {"startIndex": 1, "endIndex": end}}}
        )
    requests.append({"insertText": {"location": {"index": 1}, "text": text(sections)}})
    body = {
        "requests": requests,
        "writeControl": {
            "requiredRevisionId": required_revision or current["revision"]
        },
    }
    run(service.documents().batchUpdate(documentId=file_id, body=body))
