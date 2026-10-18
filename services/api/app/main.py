"""Authenticated HTTP API. Development simulation is explicitly opt-in."""

import asyncio
from contextlib import asynccontextmanager
from dataclasses import replace
from html import escape

from fastapi import Depends, FastAPI, Header, Request, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from app.config import Settings
from app.engine import Engine, public_card
from app.errors import error
from app.models import *
from app.meeting_models import *
from app.plans import PlanEdit, PlanRevision
from app.day import MeetLink, day, validate_meet_url
from app.desktop import DesktopStart, DesktopStep
from app.google import meet_join
from app.rate_limits import take
from app.rooms import RoomCreate, RoomJoin, RoomLeave, RoomPoll, RoomSignal
from app.util import SIDDHI_IN_ROOM, SIDDHI_TAKEN, identifier, now, pretends_to_be_siddhi, zone


def create_app(settings=None, engine=None):
    settings = settings or Settings.from_env()
    engine = engine or Engine(settings)

    @asynccontextmanager
    async def lifespan(app):
        async def resume_work():
            while True:
                try:
                    await engine.workflows.reconcile()
                    for workspace in await run_in_threadpool(
                        engine.store.list, "workspaces"
                    ):
                        await run_in_threadpool(
                            engine.notifications.deliver, workspace["id"]
                        )
                except Exception:
                    pass  # Persisted jobs remain eligible for scheduled reconciliation.
                await asyncio.sleep(30)

        if engine.injected or not settings.missing():
            engine.schedule(resume_work())
        yield
        jobs = [
            job for job in engine.jobs if job.get_loop() is asyncio.get_running_loop()
        ]
        for job in jobs:
            job.cancel()
        await asyncio.gather(*jobs, return_exceptions=True)
        engine.jobs.difference_update(jobs)

    app = FastAPI(title="Alter API", version="1.0.0", lifespan=lifespan)
    app.state.engine = engine
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-Dev-Uid", "X-Meeting-Room", "X-Time-Zone"]
        + (["X-Real-IP"] if settings.dev_mode and settings.allow_forwarded_ip else []),
    )

    @app.middleware("http")
    async def bounded_request(request, call_next):
        # Buffer a bounded body even when Content-Length is missing or dishonest.
        if request.method in ("POST", "PUT", "PATCH"):
            # A desktop step carries one screenshot; everything else stays small.
            path = request.url.path
            limit = 2_200_000 if path.startswith("/v1/desktop/") and path.endswith("/step") else 65536
            data = bytearray()
            async for chunk in request.stream():
                data.extend(chunk)
                if len(data) > limit:
                    return JSONResponse(
                        {
                            "detail": {
                                "error": {
                                    "code": "BODY_TOO_LARGE",
                                    "message": "Request is too large.",
                                }
                            }
                        },
                        status_code=413,
                    )
            request._body = bytes(data)
        try:
            return await call_next(request)
        except Exception as exc:
            from app.diagnostics import report_unhandled_request

            reference = report_unhandled_request(exc)
            return JSONResponse(
                {
                    "detail": {
                        "error": {
                            "code": "SERVICE_UNAVAILABLE",
                            "message": f"The request could not be completed. Please contact the administrator. Reference: {reference}",
                        }
                    }
                },
                status_code=503,
            )

    @app.exception_handler(Exception)
    async def unavailable(request, exc):
        return JSONResponse(
            {
                "detail": {
                    "error": {
                        "code": "SERVICE_UNAVAILABLE",
                        "message": "The request could not be completed. Please try again or contact the administrator.",
                    }
                }
            },
            status_code=503,
        )

    def caller(
        authorization: str | None = Header(None), x_dev_uid: str | None = Header(None)
    ):
        engine.require_ready()
        return engine.auth.authenticate(authorization, x_dev_uid)

    def time_zone(value):
        return zone(value).key

    def member(user=Depends(caller), x_time_zone: str | None = Header(None)):
        return replace(
            engine.auth.member(user),
            time_zone=time_zone(x_time_zone) if x_time_zone else "",
        )

    def capture_member(
        authorization: str | None = Header(None),
        x_dev_uid: str | None = Header(None),
        x_meeting_room: str | None = Header(None),
        x_time_zone: str | None = Header(None),
    ):
        if x_meeting_room:
            from hashlib import sha256

            if len(x_meeting_room) > 200:
                raise error(403, "ROOM_SCOPE", "Invalid meeting room access.")
            return engine.meetings.room_context(
                sha256(x_meeting_room.encode()).hexdigest()
            )
        return member(caller(authorization, x_dev_uid), x_time_zone)

    async def provision(wid, mid):
        await run_in_threadpool(engine.workspaces.provision, wid)
        workspace = engine.store.get(f"workspaces/{wid}")
        if workspace and workspace["state"] == "ready":
            await engine.welcome(wid, mid, workspace["generation"])

    def ip(request):
        # Enable only behind a trusted proxy that overwrites this header.
        return (
            request.headers.get("x-real-ip", "")
            if settings.allow_forwarded_ip
            else (request.client.host if request.client else "unknown")
        )

    @app.get("/healthz")
    def health():
        return {"ok": True}

    @app.get("/readyz")
    def ready():
        engine.require_ready()
        return {"ok": True, "simulated": settings.dev_mode}

    @app.post("/v1/workspaces")
    async def create(
        req: CreateWorkspace,
        request: Request,
        user=Depends(caller),
        x_time_zone: str | None = Header(None),
    ):
        if pretends_to_be_siddhi(req.name):
            raise error(422, "NAME_TAKEN", SIDDHI_TAKEN)
        result = await run_in_threadpool(
            lambda: engine.workspaces.create(
                user, req.name, ip(request), time_zone=time_zone(x_time_zone)
            )
        )
        engine.schedule(provision(result["workspaceId"], result["memberId"]))
        return result

    @app.post("/v1/workspaces/join")
    async def join(req: JoinWorkspace, user=Depends(caller)):
        if pretends_to_be_siddhi(req.name):
            raise error(422, "NAME_TAKEN", SIDDHI_TAKEN)
        result = await run_in_threadpool(
            engine.workspaces.join, user, req.name, req.inviteCode
        )
        workspace = engine.store.get(f"workspaces/{result['workspaceId']}")
        engine.schedule(
            engine.welcome(
                result["workspaceId"], result["memberId"], workspace["generation"]
            )
        )
        return result

    @app.post("/v1/demo/day")
    async def enter_day(
        request: Request, user=Depends(caller), x_time_zone: str | None = Header(None)
    ):
        # Creates only a fresh isolated demo. It cannot claim someone else's role.
        binding = engine.store.get(f"userBindings/{user.uid}")
        if binding:
            ctx = engine.auth.member(user)
            current = engine.store.get(f"workspaces/{ctx.workspace_id}")
            if not current.get("demoDay"):
                raise error(
                    409,
                    "ALREADY_JOINED",
                    "Your current Alter is already connected. Open it rather than replacing it.",
                )
            return engine.workspaces.result(
                ctx.workspace_id, ctx.member_id, "product_lead", current["inviteCode"]
            )
        result = await run_in_threadpool(
            lambda: engine.workspaces.create(
                user, "Dev", ip(request), demo_day=True, time_zone=time_zone(x_time_zone)
            )
        )
        engine.schedule(provision(result["workspaceId"], result["memberId"]))
        return result

    @app.get("/v1/me")
    def me(ctx=Depends(member)):
        return engine.me(ctx)

    @app.put("/v1/me")
    def update(req: UpdateMe, ctx=Depends(member)):
        return engine.update_me(ctx, req.model_dump(exclude_none=True))

    @app.post("/v1/workspaces/reset")
    async def reset(request: Request, ctx=Depends(member)):
        result = await run_in_threadpool(engine.workspaces.reset, ctx, ip(request))
        engine.schedule(provision(result["workspaceId"], result["memberId"]))
        return result

    @app.post("/v1/workspaces/retry-provision")
    async def retry_provision(ctx=Depends(member)):
        wid, mid = await run_in_threadpool(engine.workspaces.retry_failed_provision, ctx)
        engine.schedule(provision(wid, mid))
        return {"workspaceId": wid, "state": "provisioning"}

    @app.post("/v1/chat")
    async def chat(req: ChatRequest, ctx=Depends(member)):
        return await engine.chat(ctx, req.message, req.conversationId)

    @app.get("/v1/day")
    def current_day(ctx=Depends(member)):
        return day(engine, ctx)

    @app.post("/v1/desktop/sessions")
    def desktop_start(req: DesktopStart, ctx=Depends(member)):
        return engine.desktop.start(ctx, req)

    @app.post("/v1/desktop/sessions/{sid}/step")
    async def desktop_step(sid: str, req: DesktopStep, ctx=Depends(member)):
        return await run_in_threadpool(engine.desktop.step, ctx, identifier(sid), req)

    @app.post("/v1/desktop/sessions/{sid}/stop")
    def desktop_stop(sid: str, ctx=Depends(member)):
        return engine.desktop.stop(ctx, identifier(sid))

    @app.put("/v1/day/meet-link")
    def meet_link(req: MeetLink, ctx=Depends(member)):
        url = validate_meet_url(req.url)
        path = f"workspaces/{ctx.workspace_id}/members/{ctx.member_id}"

        def save(tx):
            tx.set(path, {**tx.get(path), "meetUrl": url})

        engine.store.atomic(save)
        return {"meetUrl": url}

    @app.post("/v1/day/meet")
    def create_meet(ctx=Depends(member)):
        workspace = engine.store.get(f"workspaces/{ctx.workspace_id}")
        if not workspace or workspace.get("state") != "ready":
            raise error(409, "WORKSPACE_NOT_READY", "Finish Google setup before starting a meeting.")
        path = f"workspaces/{ctx.workspace_id}/members/{ctx.member_id}"
        profile = engine.store.get(path)
        if not profile:
            raise error(404, "MEMBER_NOT_FOUND", "Your workspace membership could not be found.")
        engine.store.atomic(
            lambda tx: take(
                tx,
                f"meet-create:{ctx.workspace_id}:{ctx.member_id}",
                12,
                message="Too many new meetings were started this hour. Please try again later.",
            )
        )
        try:
            url = validate_meet_url(engine.apps.create_meet(ctx.workspace_id, ctx.member_id))
        except HTTPException:
            raise
        except Exception as exc:
            from app.diagnostics import report_provision_failure
            report_provision_failure(exc)
            raise error(503, "MEET_CREATION_FAILED", "Google Meet could not create an open room. Check Meet access and retry.") from exc
        if not url:
            raise error(503, "MEET_CREATION_FAILED", "Google Meet did not return a usable join link. Retry shortly.")
        meet_join.prepare(engine.store, engine.settings, ctx.workspace_id, ctx.member_id, url)
        def save(tx):
            current_profile = tx.get(path)
            if not current_profile:
                raise error(404, "MEMBER_NOT_FOUND", "Your workspace membership could not be found.")
            tx.set(path, {**current_profile, "meetUrl": url})
            return url

        return {"meetUrl": engine.store.atomic(save)}

    # Alter's own meeting rooms. Guests only need to be signed in (anonymously).
    @app.post("/v1/rooms", status_code=201)
    def create_room(req: RoomCreate, ctx=Depends(member)):
        return engine.rooms.create(ctx, identifier(req.meetingId))

    @app.get("/v1/rooms/{code}")
    def room_info(code: str, user=Depends(caller)):
        return engine.rooms.info(code)

    @app.post("/v1/rooms/{code}/join")
    def join_room(code: str, req: RoomJoin, user=Depends(caller)):
        if pretends_to_be_siddhi(req.name):
            raise error(422, "NAME_TAKEN", SIDDHI_IN_ROOM)
        return engine.rooms.join(user, code, req.name)

    @app.post("/v1/rooms/{code}/poll")
    def poll_room(code: str, req: RoomPoll, user=Depends(caller)):
        return engine.rooms.poll(user, code, identifier(req.peerId), req.after)

    @app.post("/v1/rooms/{code}/signal")
    def signal_room(code: str, req: RoomSignal, user=Depends(caller)):
        return engine.rooms.signal(user, code, identifier(req.peerId), identifier(req.to), req.kind, req.data)

    @app.post("/v1/rooms/{code}/leave")
    def leave_room(code: str, req: RoomLeave, user=Depends(caller)):
        return engine.rooms.leave(user, code, identifier(req.peerId))

    @app.get("/v1/rooms/{code}/summary")
    def room_summary(code: str, user=Depends(caller)):
        return engine.rooms.summary(code)

    @app.post("/v1/rooms/{code}/end")
    def end_room(code: str, ctx=Depends(member)):
        return engine.rooms.end(ctx, code)

    @app.get("/v1/plans/{pid}")
    def get_plan(pid: str, ctx=Depends(member)):
        return engine.plans.public(ctx, engine.plans.get(ctx, identifier(pid)))

    @app.post("/v1/plans/{pid}/revise")
    def edit_plan(pid: str, req: PlanEdit, ctx=Depends(member)):
        return engine.plans.public(ctx, engine.plans.revise(ctx, identifier(pid), req))

    @app.post("/v1/plans/{pid}/undo")
    def undo_plan(pid: str, req: PlanRevision, ctx=Depends(member)):
        return engine.plans.public(ctx, engine.plans.undo(ctx, identifier(pid), req))

    @app.post("/v1/plans/{pid}/prepare")
    def prepare_plan(pid: str, req: PlanRevision, ctx=Depends(member)):
        return engine.plans.public(ctx, engine.plans.prepare(ctx, identifier(pid), req))

    @app.post("/v1/alters/{member_id}/ask", response_model=Answer)
    async def ask(member_id: str, req: AskRequest, ctx=Depends(member)):
        result = await engine.hop(ctx, identifier(member_id), req.question)
        engine.schedule(
            asyncio.to_thread(engine.notifications.deliver, ctx.workspace_id)
        )
        return result

    @app.post("/v1/approvals/{approval_id}/revise")
    def revise(approval_id: str, req: ReviseRequest, ctx=Depends(member)):
        return public_card(
            engine.proposals.revise(
                ctx, identifier(approval_id), req.instruction, engine.brain.planner(ctx)
            )
        )

    @app.post("/v1/approvals/{approval_id}/decision")
    def decide(approval_id: str, req: DecisionRequest, ctx=Depends(member)):
        return public_card(
            engine.application.decide(
                ctx, identifier(approval_id), req.decision, req.expectedRevision
            )
        )

    @app.get("/v1/artifacts/{aid}")
    def artifact(aid: str, ctx=Depends(member)):
        card = engine.proposals.owned(ctx, identifier(aid))
        if card["state"] != "applied" or card["kind"] not in ("doc_edit", "doc_create"):
            raise error(
                409, "ARTIFACT_NOT_READY", "A confirmed document result is required."
            )
        workspace = engine.store.get(f"workspaces/{ctx.workspace_id}")
        file_id = card["action"].get("fileId") or workspace["googleIds"].get(
            "created_" + aid
        )
        value = engine.apps.read_doc(ctx.workspace_id, file_id)
        from app.util import iso

        return {
            "sections": value["sections"],
            "revision": value["revision"],
            "refreshedAt": iso(),
            "url": card.get("externalUrl"),
        }

    @app.post("/v1/escalations/{escalation_id}/respond")
    async def respond(escalation_id: str, req: EscalationReply, ctx=Depends(member)):
        result = await run_in_threadpool(
            engine.respond, ctx, identifier(escalation_id), req.text
        )
        engine.schedule(
            asyncio.to_thread(engine.notifications.deliver, ctx.workspace_id)
        )
        return result

    @app.post("/v1/escalations/{eid}/preview")
    def preview_reply(eid: str, req: EscalationReply, ctx=Depends(member)):
        value = engine.store.get(
            f"workspaces/{ctx.workspace_id}/escalations/{identifier(eid)}"
        )
        if not value or value["owner"] != ctx.member_id:
            raise error(404, "NOT_FOUND", "No such priority question.")
        from app.escalations import date_decision

        return {
            "decision": date_decision(req.text)
            if value.get("effectDescription")
            else None,
            "effect": value.get(
                "effectDescription", "Send your answer to the requester."
            ),
        }

    @app.post("/v1/meetings", status_code=201)
    def create_meeting(req: MeetingCreate, ctx=Depends(member)):
        return engine.meetings.create(ctx, req)

    @app.get("/v1/meetings")
    def meetings(ctx=Depends(member)):
        return [
            m
            for m in engine.store.list(f"workspaces/{ctx.workspace_id}/meetings")
            if m["owner"] == ctx.member_id
        ]

    @app.get("/v1/meetings/{mid}")
    def meeting_detail(mid: str, ctx=Depends(member)):
        return engine.meetings.detail(ctx, identifier(mid))

    @app.post("/v1/meetings/{mid}/segments")
    def append_segments(mid: str, req: SegmentBatch, ctx=Depends(capture_member)):
        return engine.meetings.append(ctx, identifier(mid), req.segments)

    @app.post("/v1/meetings/{mid}/finalize", status_code=202)
    async def finalize_meeting(mid: str, ctx=Depends(member)):
        result = await run_in_threadpool(engine.meetings.finalize, ctx, identifier(mid))
        if result.get("jobId"):
            engine.schedule(engine.workflows.dispatch(result["jobId"]))
        return result

    @app.post("/v1/meetings/{mid}/revise")
    def revise_meeting(mid: str, req: BundleRevision, ctx=Depends(member)):
        return engine.meetings.revise(ctx, identifier(mid), req)

    @app.post("/v1/meetings/{mid}/approve", status_code=202)
    async def approve_meeting(mid: str, req: BundleApproval, ctx=Depends(member)):
        result = await run_in_threadpool(
            engine.meetings.approve, ctx, identifier(mid), req
        )
        engine.schedule(engine.workflows.dispatch(result["jobId"]))
        return result

    @app.post("/v1/meetings/{mid}/grant")
    def revoke_grant(mid: str, req: GrantDecision, ctx=Depends(member)):
        return engine.meetings.revoke(ctx, identifier(mid))

    @app.post("/v1/meetings/{mid}/ask")
    async def meeting_ask(mid: str, req: MeetingAsk, ctx=Depends(capture_member)):
        result = await engine.meetings.ask(ctx, identifier(mid), req.question)
        engine.schedule(
            asyncio.to_thread(engine.notifications.deliver, ctx.workspace_id)
        )
        return result

    @app.post("/v1/meetings/{mid}/room")
    def create_room(mid: str, ctx=Depends(member)):
        return engine.meetings.create_room(ctx, identifier(mid))

    @app.post("/v1/meetings/{mid}/commands")
    async def meeting_command(mid: str, req: WorkCommand, ctx=Depends(member)):
        result = await run_in_threadpool(
            engine.meetings.command, ctx, identifier(mid), req.command
        )
        if req.command in ("retry", "resume"):
            for jid in result["jobIds"]:
                engine.schedule(engine.workflows.dispatch(jid))
        return result

    @app.post("/v1/push/devices")
    def register_device(req: DeviceRegistration, ctx=Depends(member)):
        return engine.notifications.register(ctx, req.token)

    @app.delete("/v1/push/devices/{did}")
    def remove_device(did: str, ctx=Depends(member)):
        return engine.notifications.remove(ctx, identifier(did))

    @app.post("/v1/notifications/{nid}/read")
    def read_notification(nid: str, ctx=Depends(member)):
        return engine.notifications.read(ctx, identifier(nid))

    @app.post("/v1/memories")
    def teach(req: TeachMemory, ctx=Depends(member)):
        return engine.teach(
            ctx, req.content, req.audience, req.appliesTo, req.sourceIds
        )

    @app.put("/v1/memories/{mid}")
    def edit_memory(mid: str, req: MemoryEdit, ctx=Depends(member)):
        from app.util import iso

        path = f"workspaces/{ctx.workspace_id}/memories/{identifier(mid)}"
        fact = engine.brain.planner(ctx).atomic_memory(req.content)
        source_versions = engine.guidance_sources(ctx, req.sourceIds, req.audience)

        def save(tx):
            current = tx.get(path)
            if not current or current["owner"] != ctx.member_id:
                raise error(404, "NOT_FOUND", "No such memory.")
            if current.get("version", 1) != req.expectedVersion:
                raise error(
                    409,
                    "STALE_REVISION",
                    "This memory changed. Review the latest version.",
                )
            updated = {
                **current,
                "content": fact["content"],
                "scope": fact["scope"],
                "audience": "owner" if fact["scope"] == "personal" else req.audience,
                "appliesTo": req.appliesTo,
                "state": "proposed",
                "source": "correction",
                "version": req.expectedVersion + 1,
                "updatedAt": iso(),
                "sourceIds": req.sourceIds,
                "sourceVersions": source_versions,
                "evidence": {
                    "type": "owner_correction",
                    "by": ctx.member_id,
                    "text": req.content,
                },
            }
            tx.set(path + "/versions/" + str(req.expectedVersion), current)
            tx.set(path, updated)
            member_path = f"workspaces/{ctx.workspace_id}/members/{ctx.member_id}"
            member = tx.get(member_path)
            tx.set(
                member_path, {**member, "memoryEpoch": member.get("memoryEpoch", 0) + 1}
            )
            return {**updated, "id": mid}

        return engine.store.atomic(save)

    @app.post("/v1/sources", status_code=201)
    def import_source(req: SourceImport, ctx=Depends(member)):
        from hashlib import sha256
        from app.util import new_id, iso

        sid = new_id("src_")
        root = f"workspaces/{ctx.workspace_id}"

        def save(tx):
            if (
                len(
                    [
                        s
                        for s in tx.list(root + "/sources")
                        if s.get("importedBy") == ctx.member_id
                    ]
                )
                >= 20
            ):
                raise error(
                    429,
                    "SOURCE_LIMIT",
                    "This prototype supports twenty imported excerpts per person.",
                )
            source = {
                "logicalId": sid,
                "title": req.title,
                "text": req.text,
                "locator": "Imported excerpt · v1",
                "owner": ctx.member_id,
                "importedBy": ctx.member_id,
                "audience": req.audience,
                "scope": "work",
                "status": "active",
                "version": 1,
                "createdAt": iso(),
                "contentHash": sha256(req.text.encode()).hexdigest(),
            }
            tx.set(root + "/sources/" + sid, source)
            return {
                "id": sid,
                "title": req.title,
                "audience": req.audience,
                "version": 1,
                "status": "active",
            }

        return engine.store.atomic(save)

    @app.get("/v1/sources")
    def own_sources(ctx=Depends(member)):
        return [
            source
            for source in engine.store.list(f"workspaces/{ctx.workspace_id}/sources")
            if source.get("importedBy") == ctx.member_id
        ]

    @app.put("/v1/sources/{sid}")
    def update_source(sid: str, req: SourceUpdate, ctx=Depends(member)):
        from hashlib import sha256
        from app.util import iso

        path = f"workspaces/{ctx.workspace_id}/sources/{identifier(sid)}"

        def save(tx):
            source = tx.get(path)
            if not source or source.get("importedBy") != ctx.member_id:
                raise error(404, "NOT_FOUND", "No such imported source.")
            if source["version"] != req.expectedVersion:
                raise error(
                    409, "STALE_REVISION", "The source changed. Reload before editing."
                )
            updated = {
                **source,
                "text": req.text,
                "version": req.expectedVersion + 1,
                "contentHash": sha256(req.text.encode()).hexdigest(),
                "updatedAt": iso(),
            }
            updated["locator"] = f"Imported excerpt · v{updated['version']}"
            tx.set(path, updated)
            workspace_path = f"workspaces/{ctx.workspace_id}"
            workspace = tx.get(workspace_path)
            tx.set(
                workspace_path,
                {**workspace, "knowledgeEpoch": workspace.get("knowledgeEpoch", 0) + 1},
            )
            for memory in tx.list(f"workspaces/{ctx.workspace_id}/memories"):
                if sid in memory.get("sourceIds", []):
                    tx.set(
                        f"workspaces/{ctx.workspace_id}/memories/{memory['id']}",
                        {
                            **memory,
                            "state": "proposed",
                            "reason": "Source changed; review its current guidance.",
                        },
                    )
            member_path = f"workspaces/{ctx.workspace_id}/members/{ctx.member_id}"
            member = tx.get(member_path)
            tx.set(
                member_path, {**member, "memoryEpoch": member.get("memoryEpoch", 0) + 1}
            )
            return {**updated, "id": sid}

        return engine.store.atomic(save)

    @app.delete("/v1/sources/{sid}")
    def revoke_source(sid: str, ctx=Depends(member)):
        path = f"workspaces/{ctx.workspace_id}/sources/{identifier(sid)}"

        def save(tx):
            source = tx.get(path)
            if not source or source.get("importedBy") != ctx.member_id:
                raise error(404, "NOT_FOUND", "No such imported source.")
            tx.set(
                path, {**source, "status": "revoked", "version": source["version"] + 1}
            )
            workspace_path = f"workspaces/{ctx.workspace_id}"
            workspace = tx.get(workspace_path)
            tx.set(
                workspace_path,
                {**workspace, "knowledgeEpoch": workspace.get("knowledgeEpoch", 0) + 1},
            )
            for memory in tx.list(f"workspaces/{ctx.workspace_id}/memories"):
                if sid in memory.get("sourceIds", []):
                    tx.set(
                        f"workspaces/{ctx.workspace_id}/memories/{memory['id']}",
                        {**memory, "state": "revoked"},
                    )
            member_path = f"workspaces/{ctx.workspace_id}/members/{ctx.member_id}"
            member = tx.get(member_path)
            tx.set(
                member_path, {**member, "memoryEpoch": member.get("memoryEpoch", 0) + 1}
            )

        engine.store.atomic(save)
        return {"revoked": True}

    @app.post("/v1/memories/{memory_id}/decision")
    def memory_decision(memory_id: str, req: MemoryDecision, ctx=Depends(member)):
        return engine.memory_decision(ctx, identifier(memory_id), req.decision)

    @app.put("/v1/rules/{rule_id}")
    def rule(rule_id: str, req: RuleUpdate, ctx=Depends(member)):
        return engine.update_rule(ctx, identifier(rule_id), req.mode)

    @app.post("/v1/director/claim")
    def claim(req: DirectorClaim, user=Depends(caller)):
        return engine.claim(user, req.workspaceId, req.memberId, req.key)

    @app.get("/v1/workspace")
    def workspace(ctx=Depends(member)):
        return engine.snapshot(ctx)

    @app.post("/v1/conversations")
    def start_conversation(ctx=Depends(member)):
        return engine.start_conversation(ctx)

    @app.get("/v1/conversations/{cid}")
    def conversation(cid: str, ctx=Depends(member)):
        root = f"workspaces/{ctx.workspace_id}/conversations/{identifier(cid)}"
        value = engine.store.get(root)
        if not value:
            raise error(404, "NOT_FOUND", "No such conversation.")
        if value["owner"] != ctx.member_id:
            raise error(
                403, "FORBIDDEN", "This conversation belongs to another member."
            )
        return {
            "messages": sorted(
                engine.store.list(root + "/messages"), key=lambda x: x["ts"]
            ),
            "events": sorted(
                engine.store.list(root + "/events"), key=lambda x: x["ts"]
            ),
        }

    @app.post("/v1/conversations", status_code=201)
    def create_conversation(ctx=Depends(member)):
        from app.util import new_id, iso

        cid = new_id("conv_")
        engine.store.set(
            f"workspaces/{ctx.workspace_id}/conversations/{cid}",
            {"owner": ctx.member_id, "title": "New work session", "updatedAt": iso()},
        )
        return {"conversationId": cid}

    @app.get("/a2a/{wid}/{mid}/.well-known/agent-card.json")
    def card(wid: str, mid: str):
        from app.a2a.server import agent_card

        return agent_card(engine, identifier(wid), identifier(mid))

    @app.post("/a2a/{wid}/{mid}")
    async def a2a(wid: str, mid: str, request: Request):
        engine.require_ready()
        from app.a2a.server import receive

        return await receive(
            engine, identifier(wid), identifier(mid), await request.json()
        )

    def scheduler(authorization: str | None = Header(None)):
        if (
            not settings.scheduler_audience
            or not settings.scheduler_email
            or not authorization
            or not authorization.startswith("Bearer ")
        ):
            raise error(403, "FORBIDDEN", "Scheduler identity is required.")
        try:
            from google.oauth2 import id_token
            from google.auth.transport.requests import Request as GoogleRequest

            claims = id_token.verify_oauth2_token(
                authorization[7:], GoogleRequest(), settings.scheduler_audience
            )
            if claims.get("email") != settings.scheduler_email or not claims.get(
                "email_verified"
            ):
                raise ValueError()
        except Exception:
            raise error(403, "FORBIDDEN", "Scheduler identity is invalid.") from None

    @app.post("/internal/cleanup", dependencies=[Depends(scheduler)])
    async def cleanup():
        await run_in_threadpool(recover_writes)
        await engine.workflows.reconcile()
        return await run_in_threadpool(engine.cleanup)

    def workflow_identity(authorization: str | None = Header(None)):
        if settings.dev_mode and authorization == "Bearer local-worker":
            return
        try:
            from google.oauth2 import id_token
            from google.auth.transport.requests import Request as GoogleRequest

            claims = id_token.verify_oauth2_token(
                (authorization or "").removeprefix("Bearer "),
                GoogleRequest(),
                settings.service_url,
            )
            if (
                not settings.task_service_account
                or claims.get("email") != settings.task_service_account
                or claims.get("email_verified") is not True
            ):
                raise ValueError()
        except Exception:
            raise error(
                403, "FORBIDDEN", "A verified workflow service identity is required."
            ) from None

    @app.post("/internal/workflows/{jid}", dependencies=[Depends(workflow_identity)])
    async def run_workflow(jid: str):
        return await engine.workflows.run(identifier(jid))

    def recover_writes():
        from datetime import datetime, timedelta

        recovered = []
        for workspace in engine.store.list("workspaces"):
            aid = workspace.get("activeWrite")
            if not aid:
                continue
            pending = engine.store.get(f"workspaces/{workspace['id']}/approvals/{aid}")
            if pending and datetime.fromisoformat(
                pending["approvedAt"]
            ) < now() - timedelta(minutes=10):
                engine.application.recover(workspace["id"], aid)
                recovered.append(aid)
        return {"recovered": recovered}

    @app.post("/internal/recover", dependencies=[Depends(scheduler)])
    def recover():
        return recover_writes()

    @app.post("/internal/video-workspaces")
    async def video(req: VideoWorkspace, request: Request, user=Depends(caller)):
        if (
            not settings.admin_email
            or not user.email_verified
            or user.email.casefold() != settings.admin_email.casefold()
        ):
            raise error(403, "FORBIDDEN", "Administrator sign-in is required.")
        result = await run_in_threadpool(
            engine.workspaces.create, user, req.name, ip(request), True
        )
        engine.schedule(provision(result["workspaceId"], result["memberId"]))
        return result

    if settings.dev_mode:

        @app.get("/local/files/{file_id}", response_class=HTMLResponse)
        def local_file(file_id: str):
            value = engine.store.get("localResources/" + identifier(file_id))
            if not value:
                raise error(404, "NOT_FOUND", "No such simulated resource.")
            import json

            return HTMLResponse(
                "<!doctype html><title>Alter simulated Google file</title><h1>Simulated Google resource</h1><pre>"
                + escape(json.dumps(value, indent=2))
                + "</pre>",
                headers={
                    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
                    "Cache-Control": "no-store",
                },
            )

    from app.live import install_live

    install_live(app, engine, capture_member)
    return app


app = create_app()
