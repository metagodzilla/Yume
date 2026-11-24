"""Separate Salad container for image-to-3D. Same key headers as the image server."""

from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from yume_mesh.generate import generate_mesh, mock_mode, start_model

state: dict[str, Any] = {"ready": False, "error": None}


class ViewIn(BaseModel):
    angle: str = ""
    image: str = ""


class MeshIn(BaseModel):
    image: str = Field(min_length=1)
    views: list[ViewIn] = []
    seed: int | None = None


def _same(left: str, right: str) -> bool:
    if len(left) != len(right):
        return False
    mismatch = 0
    for a, b in zip(left, right):
        mismatch |= ord(a) ^ ord(b)
    return mismatch == 0


def check_key(request: Request) -> None:
    expected = os.environ.get("YUME_API_KEY", "").strip()
    if not expected:
        raise HTTPException(status_code=500, detail="The container has no YUME_API_KEY set.")
    header = request.headers.get("authorization", "")
    bearer = header[7:].strip() if header.lower().startswith("bearer ") else ""
    provided = request.headers.get("x-api-key") or request.headers.get("salad-api-key") or bearer
    if not provided or not _same(provided.strip(), expected):
        raise HTTPException(status_code=401, detail="Invalid API key.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if mock_mode():
        state["ready"] = True
        yield
        return

    async def load() -> None:
        try:
            await asyncio.to_thread(start_model)
            state["ready"] = True
        except Exception as exc:  # noqa: BLE001 - surface the load error on /ready
            state["error"] = str(exc)

    task = asyncio.create_task(load())
    yield
    task.cancel()


app = FastAPI(title="Yume mesh", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready")
def ready() -> dict[str, str]:
    if state["error"]:
        raise HTTPException(status_code=503, detail=state["error"])
    if not state["ready"]:
        raise HTTPException(status_code=503, detail="Mesh model is still loading.")
    return {"status": "ready"}


@app.post("/mesh")
def mesh(body: MeshIn, request: Request) -> dict[str, Any]:
    check_key(request)
    if not state["ready"]:
        raise HTTPException(status_code=503, detail="Mesh model is still loading.")
    try:
        return generate_mesh(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
