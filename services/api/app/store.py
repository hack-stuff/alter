"""Document storage with atomic callbacks shared by SQLite and Firestore.

Callbacks stage all writes until reads finish, matching Firestore's transaction
read-before-write requirement. Callbacks must never perform external side effects.
"""

from copy import deepcopy
from pathlib import Path
from threading import RLock
from typing import Callable, TypeVar
import json
import sqlite3

T = TypeVar("T")


def clean(value):
    from datetime import datetime

    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items()}
    if isinstance(value, list):
        return [clean(v) for v in value]
    return value


class Transaction:
    def __init__(self, reader, lister):
        self.reader, self.lister = reader, lister
        self.writes: dict[str, dict | None] = {}

    def get(self, path):
        return deepcopy(self.writes[path] if path in self.writes else self.reader(path))

    def list(self, collection):
        records = {row["id"]: row for row in self.lister(collection)}
        prefix = collection + "/"
        for key, value in self.writes.items():
            if key.startswith(prefix) and "/" not in key[len(prefix) :]:
                if value is None:
                    records.pop(key[len(prefix) :], None)
                else:
                    records[key[len(prefix) :]] = {
                        **deepcopy(value),
                        "id": key[len(prefix) :],
                    }
        return list(records.values())

    def set(self, path, value):
        self.writes[path] = clean(deepcopy(value))

    def delete(self, path):
        self.writes[path] = None


class SQLiteStore:
    def __init__(self, filename: str):
        if filename != ":memory:":
            Path(filename).parent.mkdir(parents=True, exist_ok=True)
        self.lock = RLock()
        self.connection = sqlite3.connect(
            filename, check_same_thread=False, isolation_level=None
        )
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA busy_timeout=30000")
        self.connection.execute(
            "CREATE TABLE IF NOT EXISTS documents (path TEXT PRIMARY KEY, body TEXT NOT NULL)"
        )

    def get(self, path):
        with self.lock:
            row = self.connection.execute(
                "SELECT body FROM documents WHERE path=?", (path,)
            ).fetchone()
            return json.loads(row[0]) if row else None

    def list(self, collection):
        with self.lock:
            prefix = collection + "/"
            rows = self.connection.execute(
                "SELECT path, body FROM documents WHERE substr(path,1,?)=?",
                (len(prefix), prefix),
            ).fetchall()
            return [
                {**json.loads(body), "id": path[len(prefix) :]}
                for path, body in rows
                if "/" not in path[len(prefix) :]
            ]

    def atomic(self, callback: Callable[[Transaction], T]) -> T:
        with self.lock:
            self.connection.execute("BEGIN IMMEDIATE")
            try:
                tx = Transaction(self.get, self.list)
                result = callback(tx)
                for path, value in tx.writes.items():
                    if value is None:
                        self.connection.execute(
                            "DELETE FROM documents WHERE path=?", (path,)
                        )
                    else:
                        self.connection.execute(
                            "INSERT INTO documents(path,body) VALUES(?,?) ON CONFLICT(path) DO UPDATE SET body=excluded.body",
                            (path, json.dumps(value)),
                        )
                self.connection.execute("COMMIT")
                return result
            except BaseException:
                self.connection.execute("ROLLBACK")
                raise

    def set(self, path, value):
        return self.atomic(lambda tx: tx.set(path, value))

    def descendants(self, prefix):
        with self.lock:
            return [
                row[0]
                for row in self.connection.execute(
                    "SELECT path FROM documents WHERE substr(path,1,?)=?",
                    (len(prefix + "/"), prefix + "/"),
                )
            ]

    def delete_tree(self, prefix):
        with self.lock:
            self.connection.execute(
                "DELETE FROM documents WHERE path=? OR substr(path,1,?)=?",
                (prefix, len(prefix + "/"), prefix + "/"),
            )


class FirestoreStore:
    def __init__(self, project):
        self.project = project
        self._client = None
        self.lock = RLock()

    @property
    def client(self):
        with self.lock:
            if self._client is None:
                from google.cloud import firestore

                self._client = firestore.Client(project=self.project)
            return self._client

    @staticmethod
    def native(value):
        # Native timestamps support both TTL policies and request.time in security rules.
        from datetime import datetime

        return {
            key: (
                datetime.fromisoformat(item)
                if key == "expiresAt" and isinstance(item, str)
                else item
            )
            for key, item in value.items()
        }

    def get(self, path):
        snapshot = self.client.document(path).get()
        return clean(snapshot.to_dict()) if snapshot.exists else None

    def list(self, collection):
        return [
            {**clean(snapshot.to_dict()), "id": snapshot.id}
            for snapshot in self.client.collection(collection).stream()
        ]

    def atomic(self, callback):
        from google.cloud import firestore

        transaction = self.client.transaction()

        @firestore.transactional
        def execute(native):
            def read(path):
                snapshot = self.client.document(path).get(transaction=native)
                return clean(snapshot.to_dict()) if snapshot.exists else None

            def listing(collection):
                return [
                    {**clean(snapshot.to_dict()), "id": snapshot.id}
                    for snapshot in self.client.collection(collection).stream(
                        transaction=native
                    )
                ]

            tx = Transaction(read, listing)
            result = callback(tx)
            for path, value in tx.writes.items():
                if value is None:
                    native.delete(self.client.document(path))
                else:
                    native.set(self.client.document(path), self.native(value))
            return result

        return execute(transaction)

    def set(self, path, value):
        return self.atomic(lambda tx: tx.set(path, value))

    def delete_tree(self, prefix):
        self.client.recursive_delete(self.client.document(prefix))
