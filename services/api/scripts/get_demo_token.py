"""One-time demo-account OAuth. Writes a Secret Manager version, never prints tokens."""

import argparse, json
from google_auth_oauthlib.flow import InstalledAppFlow
from google.cloud import secretmanager
from app.google.creds import SCOPES


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--client-file",
        required=True,
        help="Local OAuth desktop-client JSON (gitignored).",
    )
    parser.add_argument(
        "--secret",
        required=True,
        help="Existing projects/PROJECT/secrets/NAME resource.",
    )
    parser.add_argument(
        "--account-email",
        required=True,
        help="Team-owned demo account; register as an OAuth test user.",
    )
    args = parser.parse_args()
    flow = InstalledAppFlow.from_client_secrets_file(args.client_file, SCOPES)
    credentials = flow.run_local_server(
        port=0,
        access_type="offline",
        prompt="consent",
        authorization_prompt_message="Open the authorization URL in the local browser to authorize the demo account.",
    )
    if not credentials.refresh_token:
        raise RuntimeError(
            "No refresh token was issued. Revoke the previous consent and authorize again."
        )
    payload = {
        "client_id": credentials.client_id,
        "client_secret": credentials.client_secret,
        "refresh_token": credentials.refresh_token,
        "account_email": args.account_email,
    }
    version = secretmanager.SecretManagerServiceClient().add_secret_version(
        request={
            "parent": args.secret,
            "payload": {"data": json.dumps(payload).encode()},
        }
    )
    print("Stored OAuth credentials in " + version.name)


if __name__ == "__main__":
    main()
