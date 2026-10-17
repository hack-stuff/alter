def open_room(team):
    c, _, h, _ = team
    meeting = c.post(
        "/v1/meetings",
        headers=h,
        json={"title": "Team sync", "participants": ["dev", "kani"], "representedMember": "siddhi", "consent": True},
    ).json()
    room = c.post("/v1/rooms", headers=h, json={"meetingId": meeting["id"]})
    assert room.status_code == 201, room.text
    return room.json()


def test_guests_join_by_link_and_exchange_offers(team):
    c, _, h, _ = team
    room = open_room(team)
    code = room["code"]
    assert room["alter"]["name"] == "Siddhi"
    guest = {"X-Dev-Uid": "judge"}
    assert c.get(f"/v1/rooms/{code}", headers=guest).json()["title"] == "Team sync"

    host = c.post(f"/v1/rooms/{code}/join", headers=h, json={"name": "Alice"}).json()
    joined = c.post(f"/v1/rooms/{code}/join", headers=guest, json={"name": "Judge"}).json()
    assert [p["name"] for p in joined["peers"]] == ["Alice", "Judge"]
    assert joined["peers"][0]["host"] and not joined["peers"][1]["host"]

    sent = c.post(f"/v1/rooms/{code}/signal", headers=guest, json={"peerId": joined["peerId"], "to": host["peerId"], "kind": "offer", "data": "sdp"})
    assert sent.status_code == 200
    polled = c.post(f"/v1/rooms/{code}/poll", headers=h, json={"peerId": host["peerId"], "after": 0}).json()
    assert [(s["from"], s["kind"], s["data"]) for s in polled["signals"]] == [(joined["peerId"], "offer", "sdp")]
    again = c.post(f"/v1/rooms/{code}/poll", headers=h, json={"peerId": host["peerId"], "after": polled["signals"][0]["seq"]}).json()
    assert again["signals"] == []

    # A peer can only speak as itself, and only the organizer ends the room.
    spoof = c.post(f"/v1/rooms/{code}/poll", headers=guest, json={"peerId": host["peerId"], "after": 0})
    assert spoof.status_code == 403
    assert c.post(f"/v1/rooms/{code}/leave", headers=guest, json={"peerId": joined["peerId"]}).status_code == 200
    assert c.post(f"/v1/rooms/{code}/end", headers=h).status_code == 200
    assert c.post(f"/v1/rooms/{code}/poll", headers=h, json={"peerId": host["peerId"], "after": 0}).json()["ended"]
    summary = c.get(f"/v1/rooms/{code}/summary", headers=guest).json()
    assert summary["ended"] and summary["state"] == "capturing" and summary["alter"] == "Siddhi"


def test_unknown_room_links_are_rejected(team):
    c, _, h, _ = team
    assert c.get("/v1/rooms/abc-defg-hij", headers=h).status_code == 404
    assert c.get("/v1/rooms/not-a-code", headers=h).status_code == 404
