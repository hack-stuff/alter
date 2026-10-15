"""Secret access: Secret Manager in production, local files for development.

A development run may set ALTER_SECRET_DIR (default ~/.config/alter/secrets) to
keep the demo OAuth bundle and similar local secrets out of git and out of the
cloud. The fallback only reads a file when one exists for the requested secret;
the deployed backend has no such directory and keeps using Secret Manager.
"""

import os
from pathlib import Path
from threading import Lock

DEFAULT_DIR = Path.home() / ".config" / "alter" / "secrets"


def local_key(name: str) -> str:
    """The file name for a secret: the NAME part of its resource path."""
    if "/secrets/" in name:
        return name.split("/secrets/", 1)[1].split("/", 1)[0]
    return name


class Secrets:
    def __init__(self):
        self.values = {}
        self.lock = Lock()

    def read(self, name):
        if not name:
            raise RuntimeError("A required secret resource is not configured.")
        with self.lock:
            if name not in self.values:
                local = self._local_file(name)
                if local is not None:
                    self.values[name] = local.read_text()
                else:
                    self.values[name] = self._from_manager(name)
            return self.values[name]

    def _local_file(self, name):
        directory = Path(os.getenv("ALTER_SECRET_DIR") or DEFAULT_DIR)
        candidate = directory / f"{local_key(name)}.json"
        return candidate if candidate.is_file() else None

    def _from_manager(self, name):
        from google.cloud import secretmanager

        return (
            secretmanager.SecretManagerServiceClient()
            .access_secret_version(request={"name": name}, timeout=10)
            .payload.data.decode("utf-8")
        )
