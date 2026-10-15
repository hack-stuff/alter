from email.message import EmailMessage
from email.utils import formataddr
from hashlib import sha256
import base64
import re
from app.google.drive import run


def send(service, action, member, caller, account_email, operation):
    # Anonymous judges receive inbox delivery. Only a currently verified own address may receive Gmail.
    email = member.get("email", "")
    if not (
        member["id"] in action["to_members"]
        and caller.email_verified
        and caller.email.casefold() == email.casefold()
        and member.get("emailVerified")
    ):
        return {"inboxOnly": True}
    if not re.fullmatch(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+", account_email):
        raise ValueError("The demo account sender is not configured.")
    message = EmailMessage()
    message["From"] = formataddr((f"Alter for {member['name']}", account_email))
    message["To"] = email
    message["Subject"] = action["subject"]
    message["Message-ID"] = f"<{sha256(operation.encode()).hexdigest()}@alter.demo>"
    message.set_content(action["body"])
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode("ascii")
    result = run(service.users().messages().send(userId="me", body={"raw": raw}))
    return {
        "gmailMessageUrl": f"https://mail.google.com/mail/u/0/#sent/{result['id']}",
        "url": f"https://mail.google.com/mail/u/0/#sent/{result['id']}",
    }
