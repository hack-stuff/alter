from app.google.drive import run
from app.workspaces.seed import load
from app.errors import error


def seed(service, file_id):
    metadata = run(
        service.spreadsheets().get(spreadsheetId=file_id, fields="sheets.properties")
    )
    sheets = metadata.get("sheets", [])
    requests = (
        [
            {
                "updateSheetProperties": {
                    "properties": {
                        "sheetId": sheets[0]["properties"]["sheetId"],
                        "title": "Tracker",
                    },
                    "fields": "title",
                }
            }
        ]
        if sheets
        else [{"addSheet": {"properties": {"title": "Tracker", "sheetId": 0}}}]
    )
    run(
        service.spreadsheets().batchUpdate(
            spreadsheetId=file_id, body={"requests": requests}
        )
    )
    data = load("sheet.json")
    run(
        service.spreadsheets()
        .values()
        .update(
            spreadsheetId=file_id,
            range="'Tracker'!A1:F",
            valueInputOption="RAW",
            body={
                "values": [
                    data["headers"] + ["_alter_operation"],
                    *[row + ["seed"] for row in data["rows"]],
                ]
            },
        )
    )
    sheet_id = sheets[0]["properties"]["sheetId"] if sheets else 0
    run(
        service.spreadsheets().batchUpdate(
            spreadsheetId=file_id,
            body={
                "requests": [
                    {
                        "updateDimensionProperties": {
                            "range": {
                                "sheetId": sheet_id,
                                "dimension": "COLUMNS",
                                "startIndex": 5,
                                "endIndex": 6,
                            },
                            "properties": {"hiddenByUser": True},
                            "fields": "hiddenByUser",
                        }
                    }
                ]
            },
        )
    )


def read(service, file_id):
    values = run(
        service.spreadsheets()
        .values()
        .get(spreadsheetId=file_id, range="'Tracker'!A1:F")
    ).get("values", [])
    return {
        "headers": values[0][:5] if values else [],
        "rows": [(row[:5] + [""] * 5)[:5] for row in values[1:]],
        "operations": [row[5] if len(row) > 5 else "" for row in values[1:]],
        "url": f"https://docs.google.com/spreadsheets/d/{file_id}/edit",
    }


def apply(service, action, operation):
    file_id = action["fileId"]
    current = read(service, file_id)
    matches = [
        row
        for row, marker in zip(current["rows"], current["operations"])
        if marker == operation
    ]
    if matches:
        if matches != action["rows"]:
            raise RuntimeError(
                "A partially applied spreadsheet operation requires reconciliation."
            )
        return {"url": current["url"]}
    values = [row + [operation] for row in action["rows"]]
    if action.get("startRow"):
        index = action["startRow"] - 2
        if current["rows"][index : index + len(values)] != action["before"]:
            raise error(
                409, "DOCUMENT_CHANGED", "The tracker changed. Review a new proposal."
            )
        run(
            service.spreadsheets()
            .values()
            .update(
                spreadsheetId=file_id,
                range=f"'Tracker'!A{index + 2}:F{index + 1 + len(values)}",
                valueInputOption="RAW",
                body={"values": values},
            )
        )
    else:
        run(
            service.spreadsheets()
            .values()
            .append(
                spreadsheetId=file_id,
                range="'Tracker'!A:F",
                valueInputOption="RAW",
                insertDataOption="INSERT_ROWS",
                body={"values": values},
            )
        )
    return {"url": current["url"]}
