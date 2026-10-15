import json
from threading import local

SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.compose",
]


class DemoCredentials:
    def __init__(self, settings, secrets):
        self.settings, self.secrets = settings, secrets
        self.thread = local()

    def service(self, api, version):
        # httplib2 transports are not thread-safe; each worker gets its own clients.
        clients = getattr(self.thread, "clients", None)
        if clients is None:
            self.thread.clients = clients = {}
        key = (api, version)
        if key not in clients:
            from google.oauth2.credentials import Credentials
            from googleapiclient.discovery import build

            values = json.loads(self.secrets.read(self.settings.google_oauth_secret))
            credentials = Credentials(
                token=None,
                refresh_token=values["refresh_token"],
                token_uri="https://oauth2.googleapis.com/token",
                client_id=values["client_id"],
                client_secret=values["client_secret"],
                scopes=SCOPES,
            )
            clients[key] = build(
                api, version, credentials=credentials, cache_discovery=False
            )
        return clients[key]
