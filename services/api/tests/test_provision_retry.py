from app.auth import Caller


def test_failed_google_setup_retries_without_replacing_workspace(system):
    client, engine = system
    created = engine.workspaces.create(Caller("owner"), "Dev", "local", demo_day=True)
    wid = created["workspaceId"]
    guest = engine.workspaces.join(
        Caller("guest"), "Guest", created["inviteUrl"].split("/")[-1]
    )
    path = f"workspaces/{wid}"
    workspace = engine.store.get(path)
    engine.store.set(path, {**workspace, "state": "provisioning_failed", "setupError": "failed"})
    engine.store.set(f"{path}/plans/preserved", {"title": "Keep this design"})

    assert client.post(
        "/v1/workspaces/retry-provision", headers={"X-Dev-Uid": "guest"}
    ).status_code == 403
    response = client.post(
        "/v1/workspaces/retry-provision", headers={"X-Dev-Uid": "owner"}
    )
    assert response.status_code == 200
    assert response.json()["workspaceId"] == guest["workspaceId"] == wid
    assert client.post(
        "/v1/workspaces/retry-provision", headers={"X-Dev-Uid": "owner"}
    ).status_code == 409
    assert engine.store.get(f"{path}/plans/preserved")["title"] == "Keep this design"
    assert engine.store.get(path)["state"] == "ready"
