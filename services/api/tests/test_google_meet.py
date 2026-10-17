from types import SimpleNamespace

from app.google.calendar import create_meet


class MissingEvent(Exception):
    resp = SimpleNamespace(status=404)


class Call:
    def __init__(self, fn):
        self.fn = fn

    def execute(self, num_retries=0):
        assert num_retries == 0
        return self.fn()


class CalendarService:
    def __init__(self):
        self.event = None
        self.inserts = []
        self.reads_after_insert = 0

    def events(self):
        return self

    def get(self, **kwargs):
        def read():
            if self.event is None:
                raise MissingEvent()
            self.reads_after_insert += 1
            if self.reads_after_insert == 1:
                return self.event
            return {**self.event, "hangoutLink": "https://meet.google.com/abc-defg-hij"}
        return Call(read)

    def insert(self, **kwargs):
        def write():
            self.inserts.append(kwargs)
            self.event = {"conferenceData": {"createRequest": {"status": {"statusCode": "pending"}}}}
            return self.event
        return Call(write)


def test_creates_one_google_meet_conference_on_the_workspace_calendar(monkeypatch):
    monkeypatch.setattr("app.google.calendar.time.sleep", lambda _: None)
    service = CalendarService()
    first = create_meet(service, "calendar-1", "workspace-1", "priya")
    second = create_meet(service, "calendar-1", "workspace-1", "priya")
    assert first == second == "https://meet.google.com/abc-defg-hij"
    assert len(service.inserts) == 1
    request = service.inserts[0]
    assert request["calendarId"] == "calendar-1"
    assert request["conferenceDataVersion"] == 1
    assert request["body"]["conferenceData"]["createRequest"]["conferenceSolutionKey"]["type"] == "hangoutsMeet"
