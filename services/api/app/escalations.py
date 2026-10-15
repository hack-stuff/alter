"""Conservative typed owner replies: ambiguous/conditional text never authorizes a write."""

from datetime import date
import re
from app.util import now

MONTHS = {
    name: i
    for i, name in enumerate(
        (
            "january",
            "february",
            "march",
            "april",
            "may",
            "june",
            "july",
            "august",
            "september",
            "october",
            "november",
            "december",
        ),
        1,
    )
}


def date_decision(text):
    if "?" in text or re.search(
        r"\b(not|never|maybe|unless|if|pending|can.t|cannot|don.t|tentative|no|might|could|should|would|unlikely|possible|assuming|provided|depending|hope|expect|estimate|target|thinking|discuss|considering|proposed|or|before|after)\b",
        text,
        re.I,
    ):
        return None
    match = re.search(r"\b(20\d{2})-(\d{2})-(\d{2})\b", text)
    try:
        if match:
            value = date(*map(int, match.groups()))
        else:
            match = re.search(
                r"\b(" + "|".join(MONTHS) + r")\s+(\d{1,2})(?:,?\s+(20\d{2}))?\b",
                text,
                re.I,
            )
            if not match:
                return None
            value = date(
                int(match[3]) if match[3] else now().year,
                MONTHS[match[1].lower()],
                int(match[2]),
            )
        remainder = text[: match.start()] + text[match.end() :]
        bare = remainder.strip(" .,!:").lower() in ("", "on", "by")
        affirmative = re.search(
            r"\b(yes|confirm(?:ed)?|commit(?:ted)?|approve(?:d)?|agree(?:d)?|will deliver|will be ready|ready by|we will|i will|we can|i can|works)\b",
            text,
            re.I,
        )
        if not bare and not affirmative:
            return None
        if value < now().date():
            return None
        return {"type": "date_commitment", "date": value.isoformat(), "text": text}
    except ValueError:
        return None
