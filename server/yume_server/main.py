"""HTTP API for Yume's SaladCloud container.

The process listens on IPv6 (`::`) because Salad's Container Gateway requires it.
`/health` is the liveness probe. `/ready` stays 503 until the model is loaded,
which is what the startup and readiness probes should call.
"""

from __future__ import annotations

import asyncio
import contextvars
import json
import logging
import os
import threading
import traceback
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from yume_mesh.generate import generate_mesh
from yume_server.catalog import RETIRED_DEFAULTS, cancel_install, delete_version, ensure_boot_default, ensure_jobs_loaded, install_progress, list_installs, list_models, pause_install, restore_models, resume_install, set_default, start_install
from yume_server.errors import add_client_report, list_errors, record_error, sanitize
from yume_server.generate import A1111_SAMPLERS, LoraInstalling, SCHEDULERS, friendly_lora_error, generate_images, loaded_model_name, loaded_version, mark_default_loaded, mock_mode, prepare_loras, release_loaded, start_model, start_use, use_progress
from yume_server.jobs import cancel as cancel_job
from yume_server.jobs import get as get_job
from yume_server.jobs import pause as pause_job
from yume_server.jobs import result as job_result
from yume_server.jobs import resume as resume_job
from yume_server.jobs import submit as submit_job
from yume_server.startup import snapshot as startup_snapshot
from yume_server.stats import collect as collect_stats
from yume_server.tagger import read_appearance
from yume_server.threed import glb_path, job_view, start_job
from yume_server.version import version_payload

state: dict[str, Any] = {"ready": False, "error": None}
_PAYLOAD: contextvars.ContextVar[Any] = contextvars.ContextVar("yume_payload", default=None)


class LoraIn(BaseModel):
    name: str = ""
    weight: float = 0.8
    versionId: int | None = None
    baseModel: str | None = None
    triggers: list[str] = []
    kind: str = "style"
    prompt: str = ""


class RegionIn(BaseModel):
    prompt: str = ""
    x: float = 0
    y: float = 0
    w: float = 1
    h: float = 1
    lora_name: str = ""
    lora_weight: float = 0.8


class TagIn(BaseModel):
    image: str = Field(min_length=1)


class UpdateIn(BaseModel):
    ref: str = "latest"
    sha256: str = ""


class MeshIn(BaseModel):
    image: str = Field(min_length=1)
    views: list[dict[str, str]] = []
    seed: int | None = None


class UpscaleIn(BaseModel):
    image: str = Field(min_length=1)
    preset: str = "2k"
    enhance: bool = True
    detail: float = 0.35
    repair: float = 0.45
    prompt: str = ""
    references: list[str] = []
    character_tags: str = ""
    loras: list[LoraIn] = []


class MangaIn(BaseModel):
    image: str = Field(min_length=1)
    preset: str = "2k"
    colorize: bool = False
    redraw: float = 0.55
    strength: float | None = None
    prompt: str = ""
    hints: str = ""
    references: list[str] = []
    character_tags: str = ""
    clothes: str = ""
    outfit: str = "clothes"
    job: str = "redraw"
    x: float | None = None
    y: float | None = None
    strokes: list[dict[str, Any]] = []
    body: str = "average"
    height_cm: float | None = None
    bust_cm: float | None = None
    hip_cm: float | None = None
    loras: list[LoraIn] = []


class SegmentIn(BaseModel):
    image: str = Field(min_length=1)
    x: float = 0.5
    y: float = 0.4
    strokes: list[dict[str, Any]] = []


class PoseIn(BaseModel):
    image: str = Field(min_length=1)
    width: int = 832
    height: int = 1216
    fit: bool = True
    body: str = "average"
    height_cm: float | None = None
    bust_cm: float | None = None
    hip_cm: float | None = None


class ThreeDIn(BaseModel):
    image: str = Field(min_length=1)
    views: list[dict[str, str]] = []


class GenerateIn(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    negative_prompt: str = ""
    width: int = 832
    height: int = 1216
    count: int = 1
    seed: int | None = None
    steps: int = 28
    cfg: float = 5.5
    scheduler: str = "euler_a"
    model: str | None = None
    loras: list[LoraIn] = []
    reference_image: str | None = None
    strength: float = 0.6
    mode: str = "txt2img"
    pose: bool = False
    pose_strength: float = 0.85
    pose_fit: bool = True
    pose_body: str = "average"
    pose_height_cm: float | None = None
    pose_bust_cm: float | None = None
    pose_hip_cm: float | None = None
    copy_picture: bool = False
    style: bool = False
    style_strength: float = 0.55
    clip_skip: int = 2
    model_name: str | None = None
    model_hash: str | None = None
    vae: str | None = None
    embeddings: list[str] = []
    hires_scale: float | None = None
    hires_denoise: float = 0.45
    hires_upscaler: str = "Latent"
    hires_steps: int = 18
    mask: str | None = None
    prediction_type: str | None = None
    regions: list[RegionIn] = []
    region_layout: str = "side"


def _check_key(request: Request) -> None:
    expected = os.environ.get("YUME_API_KEY", "").strip()
    if not expected:
        raise HTTPException(status_code=500, detail="The container has no YUME_API_KEY set.")
    header = request.headers.get("authorization", "")
    bearer = header[7:].strip() if header.lower().startswith("bearer ") else ""
    provided = request.headers.get("x-api-key") or request.headers.get("salad-api-key") or bearer
    if not provided or not _same(provided.strip(), expected):
        raise HTTPException(status_code=401, detail="Invalid API key.")


def _same(left: str, right: str) -> bool:
    if len(left) != len(right):
        return False
    mismatch = 0
    for a, b in zip(left, right):
        mismatch |= ord(a) ^ ord(b)
    return mismatch == 0


def _validate(body: GenerateIn) -> None:
    if body.width % 8 or body.height % 8 or not 512 <= body.width <= 1536 or not 512 <= body.height <= 1536:
        raise HTTPException(status_code=400, detail="Width and height must be multiples of 8, from 512 to 1536.")
    if not 1 <= body.count <= 4:
        raise HTTPException(status_code=400, detail="Count must be from 1 to 4.")
    if not 1 <= body.steps <= 50:
        raise HTTPException(status_code=400, detail="Steps must be from 1 to 50.")
    if not 1 <= body.cfg <= 20:
        raise HTTPException(status_code=400, detail="CFG must be from 1 to 20.")
    if body.scheduler not in SCHEDULERS and body.scheduler not in A1111_SAMPLERS:
        names = ", ".join(["Euler a", "Euler", "DPM++ 2M", "DPM++ 2M Karras", "DDIM", "LCM"])
        raise HTTPException(status_code=400, detail=f"Unknown sampler. Use one of: {names}.")
    if not 1 <= body.clip_skip <= 4:
        raise HTTPException(status_code=400, detail="Clip skip must be from 1 to 4.")
    for lora in body.loras:
        if not lora.name.strip() and not lora.versionId:
            raise HTTPException(status_code=400, detail="A LoRA is missing its name.")
        if not 0 <= lora.weight <= 2:
            raise HTTPException(status_code=400, detail="LoRA weight must be from 0 to 2.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    async def prepare() -> None:
        try:
            await asyncio.to_thread(ensure_boot_default)
            await asyncio.to_thread(ensure_jobs_loaded)
            await asyncio.to_thread(start_model)
            state["ready"] = True
        except Exception as exc:  # noqa: BLE001 - surface the load error on /ready
            state["error"] = str(exc)

    if mock_mode():
        await prepare()
        yield
        return

    from yume_server.peft_setup import ensure_peft
    from yume_server.selfheal import start_watch

    start_watch()
    threading.Thread(target=ensure_peft, name="peft-setup", daemon=True).start()
    task = asyncio.create_task(prepare())
    yield
    task.cancel()


app = FastAPI(title="Yume Salad", lifespan=lifespan)
_LOG = logging.getLogger("yume")


def _note(request: Request, status: int, detail: str, trace: str = "") -> None:
    if request.url.path in {"/health", "/ready"}:
        return
    record_error(endpoint=request.url.path, status=status, message=detail, payload=_PAYLOAD.get(), trace=trace)


@app.exception_handler(RequestValidationError)
async def readable_validation(request: Request, exc: RequestValidationError) -> JSONResponse:
    parts = []
    for err in exc.errors():
        loc = ".".join(str(item) for item in err.get("loc", []) if item != "body")
        message = str(err.get("msg") or "invalid")
        parts.append(f"{loc}: {message}" if loc else message)
    detail = "; ".join(parts) or "The request could not be read."
    _note(request, 400, detail)
    return JSONResponse(status_code=400, content={"detail": detail})


@app.exception_handler(HTTPException)
async def readable_http(request: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    _note(request, exc.status_code, detail)
    return JSONResponse(status_code=exc.status_code, content={"detail": detail})


@app.exception_handler(Exception)
async def readable_crash(request: Request, exc: Exception) -> JSONResponse:
    _LOG.exception("unhandled error on %s", request.url.path)
    detail = str(exc).strip() or "Internal Server Error"
    _note(request, 500, detail, traceback.format_exc())
    return JSONResponse(status_code=500, content={"detail": detail})


@app.middleware("http")
async def capture_payload(request: Request, call_next):
    raw = await request.body()
    payload: Any = None
    if raw:
        try:
            payload = json.loads(raw)
        except (json.JSONDecodeError, UnicodeError):
            payload = raw[:300].decode("utf-8", "replace")
    token = _PAYLOAD.set(sanitize(payload))

    sent = False

    async def receive():
        nonlocal sent
        if sent:
            return {"type": "http.request", "body": b"", "more_body": False}
        sent = True
        return {"type": "http.request", "body": raw, "more_body": False}

    try:
        return await call_next(Request(request.scope, receive))
    finally:
        _PAYLOAD.reset(token)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def schedule_reload() -> None:
    """Exit 75 tells the supervisor to start the app again. The container stays up."""
    if os.environ.get("YUME_SUPERVISOR") != "1":
        return

    def _exit() -> None:
        os._exit(75)

    threading.Timer(0.4, _exit).start()


@app.get("/version")
def version(request: Request) -> dict[str, Any]:
    _check_key(request)
    return version_payload()


@app.post("/admin/update")
def admin_update(body: UpdateIn, request: Request) -> dict[str, Any]:
    from yume_runtime.codepack import apply_update, same_secret

    expected = os.environ.get("YUME_ADMIN_TOKEN", "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="Set YUME_ADMIN_TOKEN on the container. The running Salad group is not changed from here.")
    provided = request.headers.get("x-admin-token", "").strip()
    if not same_secret(provided, expected):
        raise HTTPException(status_code=401, detail="Admin token was rejected.")
    root = Path(os.environ.get("YUME_RUNTIME_ROOT", "/opt/yume"))
    try:
        stamp = apply_update(body.ref or "latest", body.sha256, releases_dir=root / "releases", current_link=root / "app")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    schedule_reload()
    return {"ok": True, "reloading": os.environ.get("YUME_SUPERVISOR") == "1", "models": "kept on disk", **stamp}


@app.get("/health")
def health() -> dict[str, Any]:
    from yume_server.selfheal import SELF_HEAL_MESSAGE, health_failed

    stats = collect_stats()
    progress = startup_snapshot()
    body = {
        "status": "ok",
        "gpu": stats["gpu"],
        "vramUsedMb": stats["vramUsedMb"],
        "vramTotalMb": stats["vramTotalMb"],
        "model": loaded_model_name(),
        "ready": state["ready"] and not state["error"],
        "bootId": stats.get("bootId") or "",
        "startup": progress,
    }
    if health_failed():
        body["status"] = "moving"
        raise HTTPException(status_code=503, detail=progress.get("message") or SELF_HEAL_MESSAGE)
    return body


@app.get("/startup")
def startup() -> dict[str, Any]:
    """Model download progress. This answers before /ready."""
    return startup_snapshot()


@app.get("/progress")
def progress() -> dict[str, Any]:
    """Per-file weight progress. Answers before /ready, with no secrets."""
    body = startup_snapshot()
    return {"files": body.get("files") or [], **body}


@app.get("/ready")
def ready() -> dict[str, str]:
    from yume_server.selfheal import SELF_HEAL_MESSAGE

    progress = startup_snapshot()
    if os.environ.get("YUME_READY", "1") == "0":
        raise HTTPException(status_code=503, detail="Model is still downloading.")
    if progress.get("stage") == "relocating":
        raise HTTPException(status_code=503, detail=str(progress.get("message") or SELF_HEAL_MESSAGE))
    if progress.get("stage") == "error" and progress.get("message"):
        raise HTTPException(status_code=503, detail=str(progress["message"]))
    if state["error"]:
        raise HTTPException(status_code=503, detail=state["error"])
    if not state["ready"]:
        raise HTTPException(status_code=503, detail="Model is still loading.")
    return {"status": "ready", "model": loaded_model_name()}


@app.get("/stats")
def stats(request: Request) -> dict[str, Any]:
    _check_key(request)
    body = collect_stats()
    body["jobProgress"] = None
    return body


@app.get("/diagnostics")
def diagnostics(request: Request) -> dict[str, Any]:
    _check_key(request)
    body = collect_stats()
    models = list_models()
    default = next((item for item in models if item.get("isDefault")), None)
    disk_free = body.get("diskFreeMb") or 0
    return {
        "checks": [
            {"name": "GPU", "status": "warn" if body["source"] == "mock" else "pass", "detail": body["gpu"]},
            {"name": "Default model", "status": "pass" if default else "fail", "detail": (default or {}).get("name") or "missing"},
            {"name": "Disk", "status": "pass" if disk_free > 2048 else "warn", "detail": f"{disk_free} MB free"},
            {"name": "Installed", "status": "pass", "detail": f"{len(models)} in the cache"},
        ],
        "stats": body,
    }


@app.post("/jobs")
def create_job(body: GenerateIn, request: Request) -> dict[str, Any]:
    _check_key(request)
    _validate(body)
    return submit_job("generate", body)


@app.get("/jobs/{job_id}")
def read_job(job_id: str, request: Request) -> dict[str, Any]:
    _check_key(request)
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="No job with that id.")
    return job


@app.post("/jobs/{job_id}/cancel")
def stop_job(job_id: str, request: Request) -> dict[str, Any]:
    _check_key(request)
    try:
        return cancel_job(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="No job with that id.") from exc


@app.post("/jobs/{job_id}/pause")
def hold_job(job_id: str, request: Request) -> dict[str, Any]:
    _check_key(request)
    try:
        return pause_job(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="No job with that id.") from exc


@app.post("/jobs/{job_id}/resume")
def continue_job(job_id: str, body: GenerateIn, request: Request) -> dict[str, Any]:
    _check_key(request)
    try:
        return resume_job(job_id, body)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="No job with that id.") from exc


@app.get("/jobs/{job_id}/result")
def read_result(job_id: str, request: Request) -> dict[str, Any]:
    _check_key(request)
    try:
        return job_result(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="No job with that id.") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


class InstallIn(BaseModel):
    versionId: int
    type: str | None = None
    name: str | None = None
    filename: str | None = None
    baseModel: str | None = None
    triggers: list[str] = []


class RestoreModelIn(BaseModel):
    versionId: int
    type: str | None = None
    name: str | None = None
    filename: str | None = None
    baseModel: str | None = None
    triggers: list[str] = []


class RestoreIn(BaseModel):
    versionIds: list[int] = []
    lastUsedVersionId: int | None = None
    models: list[RestoreModelIn] = []
    features: list[str] = []


class DefaultIn(BaseModel):
    versionId: int


class UseIn(BaseModel):
    versionId: int


class ClientReportIn(BaseModel):
    appVersion: str = ""
    versionCode: int | None = None
    device: str = ""
    errors: list[dict[str, Any]] = []
    request: dict[str, Any] | None = None


@app.get("/errors")
def errors(request: Request) -> dict[str, Any]:
    _check_key(request)
    return {"errors": list_errors()}


@app.post("/client-report")
def client_report(body: ClientReportIn, request: Request) -> dict[str, str]:
    _check_key(request)
    add_client_report(body.model_dump())
    return {"status": "stored"}


@app.get("/models")
def models(request: Request) -> dict[str, Any]:
    _check_key(request)
    return {"models": list_models(), "activeVersionId": loaded_version()}


@app.get("/models/installs")
def installs(request: Request) -> dict[str, Any]:
    _check_key(request)
    return {"jobs": list_installs()}


@app.post("/models/restore")
def restore(body: RestoreIn, request: Request) -> dict[str, Any]:
    _check_key(request)
    token = request.headers.get("x-civitai-token", "").strip() or None
    hints = {
        item.versionId: {key: value for key, value in {"type": item.type, "name": item.name, "filename": item.filename, "baseModel": item.baseModel, "triggers": item.triggers}.items() if value}
        for item in body.models
    }
    version_ids = list(body.versionIds) or [item.versionId for item in body.models]
    if body.features:
        from yume_server.features import restore_features

        threading.Thread(target=restore_features, args=(body.features,), name="yume-features", daemon=True).start()
    return restore_models(version_ids, body.lastUsedVersionId, hints, token)


@app.post("/models/install")
def install(body: InstallIn, request: Request) -> dict[str, Any]:
    _check_key(request)
    token = request.headers.get("x-civitai-token", "").strip() or None
    hint = {key: value for key, value in {"type": body.type, "name": body.name, "filename": body.filename, "baseModel": body.baseModel, "triggers": body.triggers}.items() if value}
    return start_install(body.versionId, token, hint)


@app.get("/models/install/{job_id}")
def install_status(job_id: str, request: Request) -> dict[str, Any]:
    _check_key(request)
    if job_id == "installs":
        raise HTTPException(status_code=404, detail="No install job with that id.")
    try:
        return install_progress(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="No install job with that id.") from exc


@app.post("/models/install/{job_id}/pause")
def install_pause(job_id: str, request: Request) -> dict[str, Any]:
    _check_key(request)
    return _install_action(pause_install, job_id)


@app.post("/models/install/{job_id}/resume")
def install_resume(job_id: str, request: Request) -> dict[str, Any]:
    _check_key(request)
    token = request.headers.get("x-civitai-token", "").strip() or None
    try:
        return resume_install(job_id, token)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="No install job with that id.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/models/install/{job_id}/cancel")
def install_cancel(job_id: str, request: Request) -> dict[str, Any]:
    _check_key(request)
    return _install_action(cancel_install, job_id)


def _install_action(fn: Any, job_id: str) -> dict[str, Any]:
    try:
        return fn(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="No install job with that id.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/models/{version_id}")
def remove_model(version_id: int, request: Request) -> dict[str, Any]:
    _check_key(request)
    was_active = loaded_version() == version_id
    catalog = list_models()
    target = next((item for item in catalog if item.get("versionId") == version_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="That model is not installed.")
    others = [
        item
        for item in catalog
        if item.get("versionId") != version_id and (item.get("type") or "Checkpoint") == "Checkpoint"
    ]
    if (target.get("type") or "Checkpoint") == "Checkpoint" and not others and int(version_id) not in RETIRED_DEFAULTS:
        raise HTTPException(status_code=400, detail="Keep at least one checkpoint installed.")
    if was_active:
        release_loaded()
    try:
        delete_version(version_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    fallback = next((item for item in list_models() if (item.get("type") or "Checkpoint") == "Checkpoint"), None)
    job = None
    if was_active and fallback is not None:
        job = start_use(int(fallback["versionId"]))
    return {"status": "deleted", "activeVersionId": loaded_version(), "job": job}


@app.post("/models/use")
def use_model(body: UseIn, request: Request) -> dict[str, Any]:
    _check_key(request)
    try:
        return start_use(body.versionId)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/models/use/{job_id}")
def use_status(job_id: str, request: Request) -> dict[str, Any]:
    _check_key(request)
    if job_id == "current":
        raise HTTPException(status_code=404, detail="That checkpoint is already loaded.")
    try:
        return use_progress(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="No checkpoint load with that id.") from exc


@app.post("/models/default")
def choose_default(body: DefaultIn, request: Request) -> dict[str, Any]:
    _check_key(request)
    try:
        return set_default(body.versionId)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/reference/pose")
def reference_pose(body: PoseIn, request: Request) -> dict[str, Any]:
    _check_key(request)
    import base64

    from yume_server.reference import pose_preview

    try:
        raw = base64.b64decode(body.image, validate=False)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="The reference picture could not be read.") from exc
    preview = pose_preview(
        raw,
        fit=body.fit,
        size=body.body,
        width=body.width,
        height=body.height,
        height_cm=body.height_cm,
        bust_cm=body.bust_cm,
        hip_cm=body.hip_cm,
    )
    return preview


def _picture_job(kind: str, body: Any) -> dict[str, Any]:
    import base64

    from yume_server.generate import LoraInstalling
    from yume_server.upscale import run_manga, run_upscale

    try:
        base64.b64decode(body.image, validate=False)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="That picture could not be read.") from exc
    needs_model = kind == "manga" or bool(getattr(body, "enhance", True) or body.references or body.character_tags or body.loras)
    if needs_model and not state["ready"]:
        raise HTTPException(status_code=503, detail="Model is still loading.")
    def task(payload: Any, progress: Any) -> dict[str, Any]:
        return run_manga(payload, progress=progress) if kind == "manga" else run_upscale(payload, progress=progress)

    return submit_job(kind, body, task)


@app.post("/upscale")
def upscale(body: UpscaleIn, request: Request) -> dict[str, Any]:
    _check_key(request)
    return _picture_job("upscale", body)


@app.post("/manga")
def manga(body: MangaIn, request: Request) -> dict[str, Any]:
    _check_key(request)
    return _picture_job("manga", body)


@app.post("/manga/segment")
def manga_segment(body: SegmentIn, request: Request) -> dict[str, Any]:
    _check_key(request)
    from yume_server.manga_edit import run_segment

    try:
        return run_segment(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/generate")
def generate(body: GenerateIn, request: Request) -> dict[str, Any]:
    _check_key(request)
    if not state["ready"]:
        raise HTTPException(status_code=503, detail="Model is still loading.")
    _validate(body)
    token = request.headers.get("x-civitai-token", "").strip() or None
    try:
        prepare_loras(body, token)
    except LoraInstalling as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=friendly_lora_error(str(exc))) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return submit_job("generate", body)


@app.post("/tag")
def tag_photo(body: TagIn, request: Request) -> dict[str, Any]:
    _check_key(request)
    import base64

    try:
        raw = base64.b64decode(body.image, validate=False)
        return read_appearance(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/mesh")
def mesh(body: MeshIn, request: Request) -> dict[str, Any]:
    _check_key(request)
    if not mock_mode():
        raise HTTPException(
            status_code=503,
            detail="This container draws pictures. Deploy the mesh image as its own container group and put that URL in the 3D endpoint.",
        )
    if not state["ready"]:
        raise HTTPException(status_code=503, detail="Model is still loading.")
    try:
        return generate_mesh(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/3d/generate")
def threed_generate(body: ThreeDIn, request: Request) -> dict[str, Any]:
    _check_key(request)
    try:
        job_id = start_job(body.image, body.views)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"id": job_id}


@app.get("/3d/jobs/{job_id}")
def threed_job(job_id: str, request: Request) -> dict[str, Any]:
    _check_key(request)
    found = job_view(job_id)
    if found is None:
        raise HTTPException(status_code=404, detail="That 3D job does not exist.")
    return found


@app.get("/3d/jobs/{job_id}/model.glb")
def threed_model(job_id: str, request: Request):
    _check_key(request)
    path = glb_path(job_id)
    if not path:
        raise HTTPException(status_code=404, detail="That 3D job has no model yet.")
    return FileResponse(path, media_type="model/gltf-binary", filename="model.glb")
