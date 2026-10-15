from threading import Lock


class Secrets:
    def __init__(self):
        self.values = {}
        self.lock = Lock()

    def read(self, name):
        if not name:
            raise RuntimeError("A required secret resource is not configured.")
        with self.lock:
            if name not in self.values:
                from google.cloud import secretmanager

                self.values[name] = (
                    secretmanager.SecretManagerServiceClient()
                    .access_secret_version(request={"name": name}, timeout=10)
                    .payload.data.decode("utf-8")
                )
            return self.values[name]
