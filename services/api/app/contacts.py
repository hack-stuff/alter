"""Member email addresses, stored apart from member documents that teammates can read."""


def contact(store, wid, mid):
    value = store.get(f"workspaces/{wid}/contacts/{mid}") or {}
    return {key: value[key] for key in ("email", "emailVerified") if key in value}
