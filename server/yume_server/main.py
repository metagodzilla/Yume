"""HTTP API for Yume's SaladCloud container.

The process listens on IPv6 (`::`) because Salad's Container Gateway requires it.
`/health` is the liveness probe. `/ready` stays 503 until the model is loaded,
which is what the startup and readiness probes should call.
"""

from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from yume_mesh.generate import generate_mesh
from yume_server.catalog import CivitaiAuthError, delete_version, ensure_default, install_version, list_models, set_default
from yume_server.generate import A1111_SAMPLERS, SCHEDULERS, generate_images, mock_mode, start_model
from yume_server.jobs import cancel as cancel_job
from yume_server.jobs import get as get_job
from yume_server.jobs import pause as pause_job
from yume_server.jobs import result as job_result
from yume_server.jobs import resume as resume_job
from yume_server.jobs import submit as submit_job
from yume_server.stats import collect as collect_stats

state: dict[str, Any] = {"ready": False, "error": None}


class LoraIn(BaseModel):
    name: str
    weight: float = 0.8


class MeshIn(BaseModel):
    image: str = Field(min_length=1)
    views: list[dict[str, str]] = []
    seed: int | None = None


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
    strength: float = 0.45
    mode: str = "txt2img"
    clip_skip: int = 2
    model_name: str | None = None
    model_hash: str | None = None
    vae: str | None = None
    embeddings: list[str] = []
    hires_scale: float | None = None
    hires_denoise: float = 0.45
    hires_upscaler: str = "Latent"
    hires_steps: int = 15
    mask: str | None = None


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
        if not lora.name.strip():
            raise HTTPException(status_code=400, detail="A LoRA is missing its name.")
        if not 0 <= lora.weight <= 2:
            raise HTTPException(status_code=400, detail="LoRA weight must be from 0 to 2.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    async def prepare() -> None:
        try:
            await asyncio.to_thread(ensure_default)
            if not mock_mode():
                await asyncio.to_thread(start_model)
            state["ready"] = True
        except Exception as exc:  # noqa: BLE001 - surface the load error on /ready
            state["error"] = str(exc)

    if mock_mode():
        await prepare()
        yield
        return

    task = asyncio.create_task(prepare())
    yield
    task.cancel()


app = FastAPI(title="Yume Salad", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, Any]:
    stats = collect_stats()
    return {
        "status": "ok",
        "gpu": stats["gpu"],
        "vramUsedMb": stats["vramUsedMb"],
        "vramTotalMb": stats["vramTotalMb"],
        "model": "Animagine XL 4.0",
        "ready": state["ready"] and not state["error"],
    }


@app.get("/ready")
def ready() -> dict[str, str]:
    if os.environ.get("YUME_READY", "1") == "0":
        raise HTTPException(status_code=503, detail="Model is still downloading.")
    if state["error"]:
        raise HTTPException(status_code=503, detail=state["error"])
    if not state["ready"]:
        raise HTTPException(status_code=503, detail="Model is still loading.")
    return {"status": "ready", "model": "Animagine XL 4.0"}


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
            {"name": "Default model", "status": "pass" if default and default.get("name") == "Animagine XL 4.0" else "fail", "detail": (default or {}).get("name") or "missing"},
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


class DefaultIn(BaseModel):
    versionId: int


@app.get("/models")
def models(request: Request) -> dict[str, Any]:
    _check_key(request)
    return {"models": list_models()}


@app.post("/models/install")
def install(body: InstallIn, request: Request) -> dict[str, Any]:
    _check_key(request)
    token = request.headers.get("x-civitai-token", "").strip() or None
    try:
        record = install_version(body.versionId, token)
    except CivitaiAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - the download can fail for network or HTTP reasons
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return record


@app.delete("/models/{version_id}")
def remove_model(version_id: int, request: Request) -> dict[str, str]:
    _check_key(request)
    try:
        delete_version(version_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "deleted"}


@app.post("/models/default")
def choose_default(body: DefaultIn, request: Request) -> dict[str, Any]:
    _check_key(request)
    try:
        return set_default(body.versionId)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/generate")
def generate(body: GenerateIn, request: Request) -> dict[str, Any]:
    _check_key(request)
    if not state["ready"]:
        raise HTTPException(status_code=503, detail="Model is still loading.")
    _validate(body)
    try:
        images, seeds, model, consistency = generate_images(body)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "images": images,
        "seeds": seeds,
        "model": model,
        "scheduler": body.scheduler,
        "consistency": consistency,
    }


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
