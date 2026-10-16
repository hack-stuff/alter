"""Authenticated HTTP API. Development simulation is explicitly opt-in."""

import asyncio
from contextlib import asynccontextmanager
from html import escape

from fastapi import Depends, FastAPI, Header, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from app.config import Settings
from app.engine import Engine, public_card
from app.errors import error
from app.models import *
from app.util import identifier, now


def create_app(settings=None, engine=None):
    settings = settings or Settings.from_env()
    engine = engine or Engine(settings)

    @asynccontextmanager
    async def lifespan(app):
        yield
        for job in list(engine.jobs):
            job.cancel()
        await asyncio.gather(*engine.jobs, return_exceptions=True)

    app = FastAPI(title="Alter API", version="1.0.0", lifespan=lifespan)
    app.state.engine = engine
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST", "PUT"],
        allow_headers=["Authorization", "Content-Type", "X-Dev-Uid"],
    )

    @app.middleware("http")
    async def bounded_request(request, call_next):
        # Buffer a bounded body even when Content-Length is missing or dishonest.
        if request.method in ("POST", "PUT", "PATCH"):
            data = bytearray()
            async for chunk in request.stream():
                data.extend(chunk)
                if len(data) > 65536:
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
        except Exception:
            # Do not let provider exception strings reach Uvicorn logs or the browser.
            return JSONResponse(
                {
                    "detail": {
                        "error": {
                            "code": "SERVICE_UNAVAILABLE",
                            "message": "The request could not be completed. Please contact the administrator.",
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

    def member(user=Depends(caller)):
        return engine.auth.member(user)

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
    async def create(req: CreateWorkspace, request: Request, user=Depends(caller)):
        result = await run_in_threadpool(
            engine.workspaces.create, user, req.name, ip(request)
        )
        engine.schedule(provision(result["workspaceId"], result["memberId"]))
        return result

    @app.post("/v1/workspaces/join")
    async def join(req: JoinWorkspace, user=Depends(caller)):
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

    @app.post("/v1/chat")
    async def chat(req: ChatRequest, ctx=Depends(member)):
        return await engine.chat(ctx, req.message, req.conversationId)

    @app.post("/v1/alters/{member_id}/ask", response_model=Answer)
    async def ask(member_id: str, req: AskRequest, ctx=Depends(member)):
        return await engine.hop(ctx, identifier(member_id), req.question)

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

    @app.post("/v1/escalations/{escalation_id}/respond")
    def respond(escalation_id: str, req: EscalationReply, ctx=Depends(member)):
        return engine.respond(ctx, identifier(escalation_id), req.text)

    @app.post("/v1/memories")
    def teach(req: TeachMemory, ctx=Depends(member)):
        return engine.teach(ctx, req.content)

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
    def cleanup():
        recover_writes()
        return engine.cleanup()

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

    return app


app = create_app()
