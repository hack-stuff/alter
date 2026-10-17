"""One-time demo-account OAuth. Writes to Secret Manager or a local dev file; never prints tokens."""

import argparse, json
from pathlib import Path

from google.auth.transport.requests import AuthorizedSession
from google_auth_oauthlib.flow import InstalledAppFlow
from google.cloud import secretmanager
from app.google.creds import SCOPES
from app.google.meet import MEET_SCOPE


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--client-file",
        required=True,
        help="Local OAuth desktop-client JSON (gitignored).",
    )
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument(
        "--secret",
        help="Existing projects/PROJECT/secrets/NAME resource (production).",
    )
    target.add_argument(
        "--out-file",
        help="Local JSON path for the development backend "
        "(ALTER_SECRET_DIR/NAME.json is what the API reads in dev).",
    )
    parser.add_argument(
        "--account-email",
        required=True,
        help="Team-owned demo account; register as an OAuth test user.",
    )
    parser.add_argument(
        "--include-meet",
        action="store_true",
        help="Request Meet room creation consent for open, no-knock calls.",
    )
    args = parser.parse_args()
    flow = InstalledAppFlow.from_client_secrets_file(
        args.client_file, SCOPES + ([MEET_SCOPE] if args.include_meet else [])
    )
    credentials = flow.run_local_server(
        port=0,
        access_type="offline",
        prompt="consent",
        authorization_prompt_message="Open this URL in your browser and sign in as the demo account:\n{url}",
        open_browser=False,
    )
    if not credentials.refresh_token:
        raise RuntimeError(
            "No refresh token was issued. Revoke the previous consent and authorize again."
        )
    profile = AuthorizedSession(credentials).get(
        "https://gmail.googleapis.com/gmail/v1/users/me/profile", timeout=20
    )
    profile.raise_for_status()
    if profile.json().get("emailAddress", "").casefold() != args.account_email.casefold():
        raise RuntimeError("The authorized Google account does not match --account-email; no credentials were saved.")
    payload = {
        "client_id": credentials.client_id,
        "client_secret": credentials.client_secret,
        "refresh_token": credentials.refresh_token,
        "account_email": args.account_email,
    }
    if args.include_meet:
        payload["meet_refresh_token"] = credentials.refresh_token
    if args.out_file:
        path = Path(args.out_file)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2))
        path.chmod(0o600)
        print("Stored OAuth credentials at " + str(path))
        return
    version = secretmanager.SecretManagerServiceClient().add_secret_version(
        request={
            "parent": args.secret,
            "payload": {"data": json.dumps(payload).encode()},
        }
    )
    print("Stored OAuth credentials in " + version.name)


if __name__ == "__main__":
    main()
