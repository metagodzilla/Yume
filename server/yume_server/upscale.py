"""2K/4K upscale and a separate manga redraw.

Pure planning (size, tiles, panels, speech bubbles) runs without a GPU.
Mock mode returns a PNG of the target size. A real node lazily downloads the
anime ESRGAN, the SDXL tile ControlNet, MistoLine, and the face IP-Adapter,
then chains 4x passes and a tiled refine.
"""

from __future__ import annotations

import base64
import io
import logging
import os
import struct
import threading
import zlib
from typing import Any

from yume_server.tagger import load_rgb, read_appearance

_LOG = logging.getLogger("yume.upscale")
TILE_REPO = "xinsir/controlnet-tile-sdxl-1.0"
LINEART_REPO = "TheMistoAI/MistoLine"
FACE_WEIGHT = "ip-adapter-plus-face_sdxl_vit-h.safetensors"
IP_REPO = "h94/IP-Adapter"
IP_SUBFOLDER = "sdxl_models"
_READY = False
_LOCK = threading.Lock()


def mock_mode() -> bool:
    return os.environ.get("YUME_MOCK", "").strip().lower() in {"1", "true", "yes"}


def snap8(value: int) -> int:
    return max(8, int(round(value / 8) * 8))


def plan_target(width: int, height: int, preset: str) -> dict[str, int]:
    """Long edge 2048 for 2K, or 3840 (inside 3840–4096) for 4K. Aspect stays."""
    key = (preset or "").lower().replace(" ", "")
    if key not in {"2k", "4k"}:
        raise ValueError("Choose 2K or 4K.")
    long_edge = 2048 if key == "2k" else 3840
    src_w = max(1, int(width))
    src_h = max(1, int(height))
    if src_w >= src_h:
        out_w = long_edge
        out_h = snap8(int(round(src_h * long_edge / src_w)))
    else:
        out_h = long_edge
        out_w = snap8(int(round(src_w * long_edge / src_h)))
    dst_long = max(out_w, out_h)
    if key == "4k" and dst_long > 4096:
        scale = 4096 / dst_long
        out_w, out_h = snap8(int(out_w * scale)), snap8(int(out_h * scale))
        dst_long = max(out_w, out_h)
    src_long = max(src_w, src_h)
    passes = 0
    grown = src_long
    while grown < dst_long and passes < 3:
        grown *= 4
        passes += 1
    return {"width": out_w, "height": out_h, "passes": passes, "longEdge": dst_long}


def detail_denoise(detail: float) -> float:
    amount = max(0.0, min(1.0, float(detail)))
    return round(0.2 + amount * 0.25, 3)


def repair_denoise(strength: float) -> float:
    amount = max(0.0, min(1.0, float(strength)))
    return round(0.3 + amount * 0.35, 3)


def redraw_denoise(strength: float) -> float:
    amount = max(0.0, min(1.0, float(strength)))
    return round(0.4 + amount * 0.35, 3)


def _starts(length: int, tile: int, overlap: int) -> list[int]:
    if length <= tile:
        return [0]
    step = max(1, tile - overlap)
    starts = [0]
    while starts[-1] + tile < length:
        nxt = min(starts[-1] + step, length - tile)
        if nxt == starts[-1]:
            break
        starts.append(nxt)
    return starts


def tile_boxes(width: int, height: int, tile: int = 768, overlap: int = 64) -> list[tuple[int, int, int, int]]:
    boxes = []
    for y in _starts(max(1, height), tile, overlap):
        for x in _starts(max(1, width), tile, overlap):
            boxes.append((x, y, min(width, x + tile), min(height, y + tile)))
    return boxes or [(0, 0, max(1, width), max(1, height))]


def _luma(pixel: tuple[int, int, int]) -> float:
    return (pixel[0] + pixel[1] + pixel[2]) / 3


def _content_bands(gutters: list[bool]) -> list[tuple[int, int]]:
    bands: list[tuple[int, int]] = []
    start = None
    for index, gutter in enumerate([*gutters, True]):
        if not gutter and start is None:
            start = index
        elif gutter and start is not None:
            if index - start >= 8:
                bands.append((start, index))
            start = None
    return bands


def find_panels(pixels: list[tuple[int, int, int]], width: int, height: int) -> list[tuple[int, int, int, int]]:
    """Split a page on white gutters. One rectangle when the page has no gutter."""
    if width < 16 or height < 16:
        return [(0, 0, width, height)]

    def paper(pixel: tuple[int, int, int]) -> bool:
        return _luma(pixel) > 235

    rows = [sum(1 for x in range(width) if paper(pixels[y * width + x])) / width > 0.96 for y in range(height)]
    cols = [sum(1 for y in range(height) if paper(pixels[y * width + x])) / height > 0.96 for x in range(width)]
    rects = []
    for y0, y1 in _content_bands(rows):
        for x0, x1 in _content_bands(cols):
            if x1 - x0 >= 8 and y1 - y0 >= 8:
                rects.append((x0, y0, x1 - x0, y1 - y0))
    return rects or [(0, 0, width, height)]


def find_bubbles(pixels: list[tuple[int, int, int]], width: int, height: int) -> list[tuple[int, int, int, int]]:
    """White regions that contain ink. Those are the speech bubbles to protect."""
    if width < 8 or height < 8:
        return []
    step = max(1, int(max(width, height) / 180))
    sw, sh = max(1, width // step), max(1, height // step)
    paper: list[bool] = []
    for y in range(sh):
        sy = min(height - 1, y * step + step // 2)
        for x in range(sw):
            sx = min(width - 1, x * step + step // 2)
            paper.append(_luma(pixels[sy * width + sx]) > 235)
    seen = [False] * (sw * sh)
    rects: list[tuple[int, int, int, int]] = []
    page = width * height
    for index, is_paper in enumerate(paper):
        if not is_paper or seen[index]:
            continue
        stack = [index]
        seen[index] = True
        min_x = max_x = index % sw
        min_y = max_y = index // sw
        while stack:
            current = stack.pop()
            x, y = current % sw, current // sw
            min_x, max_x = min(min_x, x), max(max_x, x)
            min_y, max_y = min(min_y, y), max(max_y, y)
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < sw and 0 <= ny < sh:
                    nxt = ny * sw + nx
                    if paper[nxt] and not seen[nxt]:
                        seen[nxt] = True
                        stack.append(nxt)
        x0, y0 = min_x * step, min_y * step
        x1, y1 = min(width, (max_x + 1) * step), min(height, (max_y + 1) * step)
        bw, bh = x1 - x0, y1 - y0
        area = bw * bh
        if area < page * 0.004 or area > page * 0.28 or (bw > width * 0.9 and bh > height * 0.9):
            continue
        ink = 0
        jump = max(1, step)
        for yy in range(y0, y1, jump):
            row = yy * width
            for xx in range(x0, x1, jump):
                if _luma(pixels[row + xx]) < 50:
                    ink += 1
        if ink >= 3:
            rects.append((x0, y0, bw, bh))
    return rects


def scale_rects(rects: list[tuple[int, int, int, int]], src_w: int, src_h: int, dst_w: int, dst_h: int) -> list[tuple[int, int, int, int]]:
    sx = dst_w / max(1, src_w)
    sy = dst_h / max(1, src_h)
    scaled = []
    for x, y, w, h in rects:
        scaled.append((int(x * sx), int(y * sy), max(1, int(w * sx)), max(1, int(h * sy))))
    return scaled


def compose_prompt(*, kind: str, prompt: str, hints: str, tags: str, colorize: bool) -> str:
    user = ", ".join(part.strip() for part in (tags, prompt, hints) if part and part.strip())
    if kind == "manga" and not colorize:
        mono = "monochrome, greyscale, manga page, clean lineart, screentone, black and white"
        return ", ".join(part for part in (mono, user) if part)
    if kind == "manga":
        color = "full color, anime coloring, clean lineart, manga"
        return ", ".join(part for part in (color, user) if part)
    return user


def diffusion_tiles(panels: list[tuple[int, int, int, int]], width: int, height: int, limit: int = 768) -> list[tuple[int, int, int, int]]:
    """Subdivide panels that are larger than the VRAM tile."""
    if not panels:
        panels = [(0, 0, width, height)]
    tiles: list[tuple[int, int, int, int]] = []
    for x, y, w, h in panels:
        tiles.extend((x + box[0], y + box[1], box[2], box[3]) for box in tile_boxes(w, h, limit, 48))
    return tiles


def _number(body: Any, name: str, default: float) -> float:
    value = getattr(body, name, None)
    if value is None:
        return default
    return float(value)


def _tags_from(references: list[bytes], sheet: str) -> str:
    found: list[str] = []
    for raw in references[:4]:
        try:
            for tag in read_appearance(raw).get("tags") or []:
                if tag and tag not in found:
                    found.append(str(tag))
        except Exception:
            _LOG.info("a reference could not be tagged")
    extra = [part.strip() for part in (sheet or "").split(",") if part.strip()]
    for tag in extra:
        if tag not in found:
            found.append(tag)
    return ", ".join(found)


def _png(width: int, height: int, red: int, green: int, blue: int) -> str:
    raw = bytearray()
    row = bytes((red, green, blue)) * width
    for _ in range(height):
        raw.append(0)
        raw.extend(row)
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(bytes(raw), 1)) + chunk(b"IEND", b"")
    return base64.b64encode(png).decode("ascii")


def ensure_upscale_weights() -> None:
    global _READY
    if mock_mode() or _READY:
        return
    with _LOCK:
        if _READY:
            return
        from yume_server.generate import ensure_anime_upscaler

        if not ensure_anime_upscaler():
            raise RuntimeError("The anime upscaler is still downloading. Try again in a moment.")
        from huggingface_hub import snapshot_download

        cache = os.environ.get("HF_HOME") or os.environ.get("YUME_MODEL_DIR") or "/models"
        from yume_server.startup import note_file, tqdm_factory

        snapshot_download(TILE_REPO, cache_dir=cache, tqdm_class=tqdm_factory("controlnet-tile", "Tile ControlNet", "ControlNet"))
        note_file("controlnet-tile", name="Tile ControlNet", kind="ControlNet", done=1, total=1, state="done")
        snapshot_download(LINEART_REPO, cache_dir=cache, tqdm_class=tqdm_factory("controlnet-line", "Lineart ControlNet", "ControlNet"))
        note_file("controlnet-line", name="Lineart ControlNet", kind="ControlNet", done=1, total=1, state="done")
        snapshot_download(IP_REPO, allow_patterns=[f"{IP_SUBFOLDER}/{FACE_WEIGHT}", f"{IP_SUBFOLDER}/image_encoder/**"], cache_dir=cache, tqdm_class=tqdm_factory("ip-adapter-face", "IP-Adapter Face", "IP-Adapter"))
        note_file("ip-adapter-face", name="IP-Adapter Face", kind="IP-Adapter", done=1, total=1, state="done")
        _READY = True
        _LOG.info("upscale weights ready")


def schedule_upscale_weights() -> None:
    if mock_mode():
        return

    def run() -> None:
        try:
            ensure_upscale_weights()
        except Exception:
            _LOG.exception("upscale weights could not be downloaded yet")

    threading.Thread(target=run, name="yume-upscale-weights", daemon=True).start()


def run_upscale(body: Any) -> dict[str, Any]:
    return _run(body, kind="upscale")


def run_manga(body: Any) -> dict[str, Any]:
    if str(getattr(body, "job", "") or "") == "edit":
        from yume_server.manga_edit import run_edit

        return run_edit(body)
    return _run(body, kind="manga")


def _run(body: Any, *, kind: str) -> dict[str, Any]:
    raw = base64.b64decode(getattr(body, "image"), validate=False)
    width, height, pixels = load_rgb(raw)
    preset = str(getattr(body, "preset", "2k") or "2k")
    planned = plan_target(width, height, preset)
    references = [base64.b64decode(item, validate=False) for item in (getattr(body, "references", None) or []) if item]
    sheet = str(getattr(body, "character_tags", "") or "")
    loras = list(getattr(body, "loras", None) or [])
    enhance = bool(getattr(body, "enhance", False))
    colorize = bool(getattr(body, "colorize", False))
    identity = bool(references or sheet.strip() or loras)
    if kind == "manga":
        mode = "manga"
    elif identity:
        mode = "repair"
    elif enhance:
        mode = "enhance"
    else:
        mode = "esrgan"
    if mode == "repair":
        denoise = repair_denoise(_number(body, "repair", 0.45))
    elif mode == "manga":
        denoise = redraw_denoise(_number(body, "redraw", 0.55))
    elif mode == "enhance":
        denoise = detail_denoise(_number(body, "detail", 0.35))
    else:
        denoise = 0.0
    tags = _tags_from(references, sheet) if mode in {"repair", "manga", "enhance"} else ""
    used = compose_prompt(
        kind=kind,
        prompt=str(getattr(body, "prompt", "") or ""),
        hints=str(getattr(body, "hints", "") or ""),
        tags=tags,
        colorize=colorize,
    )
    bubbles = find_bubbles(pixels, width, height) if kind == "manga" else []
    panels = find_panels(pixels, width, height) if kind == "manga" else [(0, 0, width, height)]
    scaled_panels = scale_rects(panels, width, height, planned["width"], planned["height"])
    tiles = diffusion_tiles(scaled_panels, planned["width"], planned["height"])
    control = []
    if mode == "manga":
        control = ["lineart", "tile"]
    elif mode == "repair":
        control = ["tile"]
    payload = {
        "width": planned["width"],
        "height": planned["height"],
        "preset": "4k" if preset.lower().replace(" ", "") == "4k" else "2k",
        "mode": mode,
        "passes": planned["passes"],
        "tiles": len(tiles),
        "panels": len(panels),
        "bubbles": len(bubbles),
        "denoise": denoise,
        "prompt": used,
        "controlnet": control,
        "ip_adapter": "plus-face" if references and mode in {"repair", "manga"} else "",
        "face_pass": bool(references and mode == "repair"),
        "colorize": colorize if kind == "manga" else False,
        "loras": [str(getattr(lora, "name", "") or "") for lora in loras if str(getattr(lora, "name", "") or "").strip()],
        "model": "RealESRGAN_x4plus_anime_6B",
    }
    if mock_mode():
        payload["image"] = _png(planned["width"], planned["height"], 40 if mode != "manga" else 20, 24, 36)
        return payload
    if mode != "esrgan":
        from yume_server.generate import prepare_loras

        prepare_loras(body, None)
    image = _gpu(raw, references, planned, mode, denoise, used, loras, scale_rects(bubbles, width, height, planned["width"], planned["height"]))
    payload["image"] = base64.b64encode(image).decode("ascii")
    return payload


def _gpu(raw: bytes, references: list[bytes], planned: dict[str, int], mode: str, denoise: float, prompt: str, loras: list[Any], bubbles: list[tuple[int, int, int, int]], pose: Any = None, holes: list[tuple[int, int, int, int]] | None = None) -> bytes:
    ensure_upscale_weights()
    from PIL import Image

    image = Image.open(io.BytesIO(raw)).convert("RGB")
    for _ in range(int(planned["passes"])):
        image = _esrgan_pass(image)
    image = image.resize((planned["width"], planned["height"]), Image.Resampling.LANCZOS)
    if mode == "esrgan":
        return _encode(image)
    faithful = image.copy()
    reference = Image.open(io.BytesIO(references[0])).convert("RGB") if references else None
    pose_image = Image.open(io.BytesIO(pose)).convert("RGB").resize(image.size) if pose else None
    refined = _refine(image, reference, mode, denoise, prompt, loras, pose_image)
    if holes:
        refined = _fill_holes(refined, holes)
    if mode in {"manga", "edit"} and bubbles:
        refined = _restore_bubbles(refined, faithful, bubbles)
    if mode == "repair" and reference is not None:
        refined = _face_pass(refined, reference, prompt)
    return _encode(refined)


def _encode(image: Any) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _esrgan_pass(image: Any) -> Any:
    from yume_server.features import ensure_feature

    if not ensure_feature("upscaler"):
        raise RuntimeError("The upscaler runtime is still installing. Try again in a moment.")
    import numpy as np
    import torch
    from PIL import Image
    from spandrel import ImageModelDescriptor, ModelLoader

    from yume_server.generate import anime_upscaler_path

    weight = anime_upscaler_path()
    model = ModelLoader().load_from_file(weight)
    if not isinstance(model, ImageModelDescriptor):
        raise RuntimeError("The anime upscaler file is not an image model.")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model.to(device).eval()
    scale = int(getattr(model, "scale", 4) or 4)
    array = np.asarray(image)
    height, width = array.shape[:2]
    out = np.zeros((height * scale, width * scale, 3), dtype=np.float32)
    cover = np.zeros((height * scale, width * scale, 1), dtype=np.float32)
    overlap = 16
    for x0, y0, x1, y1 in tile_boxes(width, height, 256, overlap):
        crop = array[y0:y1, x0:x1]
        tensor = torch.from_numpy(crop).permute(2, 0, 1).unsqueeze(0).float().div(255.0).to(device)
        with torch.no_grad():
            restored = model(tensor).clamp(0, 1)
        piece = restored[0].permute(1, 2, 0).detach().cpu().numpy()
        ph, pw = piece.shape[:2]
        ox, oy = x0 * scale, y0 * scale
        mask = np.ones((ph, pw, 1), dtype=np.float32)
        fade = overlap * scale
        ramp = np.linspace(0, 1, max(fade, 1), dtype=np.float32)
        if x0 > 0:
            mask[:, :fade, 0] *= ramp
        if y0 > 0:
            mask[:fade, :, 0] *= ramp[:, None]
        if x1 < width:
            mask[:, -fade:, 0] *= ramp[::-1]
        if y1 < height:
            mask[-fade:, :, 0] *= ramp[::-1, None]
        out[oy : oy + ph, ox : ox + pw] += piece * mask
        cover[oy : oy + ph, ox : ox + pw] += mask
    merged = np.clip(out / np.maximum(cover, 1e-6), 0, 1)
    return Image.fromarray((merged * 255).astype("uint8"))


def _ink(image: Any) -> Any:
    gray = image.convert("L")
    return gray.point(lambda pixel: 0 if pixel < 180 else 255).convert("RGB")


def _refine(image: Any, reference: Any, mode: str, denoise: float, prompt: str, loras: list[Any], pose: Any = None) -> Any:
    from diffusers import ControlNetModel, StableDiffusionXLControlNetImg2ImgPipeline, StableDiffusionXLImg2ImgPipeline

    from yume_server.generate import _apply_loras, _clear_loras, loaded_pipe

    pipe = loaded_pipe()
    if pipe is None:
        raise RuntimeError("The checkpoint is still loading.")
    negative = "lowres, bad anatomy, bad hands, extra fingers, deformed, blurry, text, watermark"
    if mode == "manga" and "monochrome" in prompt:
        negative = f"{negative}, color, colorful"
    controls: list[Any] = []
    scales: list[float] = []
    if mode == "edit":
        from yume_server.reference import CONTROLNET_REPO

        controls = [
            ControlNetModel.from_pretrained(CONTROLNET_REPO, torch_dtype=pipe.unet.dtype),
            ControlNetModel.from_pretrained(LINEART_REPO, torch_dtype=pipe.unet.dtype),
        ]
        scales = [0.85, 0.55]
    elif mode == "manga":
        controls = [
            ControlNetModel.from_pretrained(LINEART_REPO, torch_dtype=pipe.unet.dtype),
            ControlNetModel.from_pretrained(TILE_REPO, torch_dtype=pipe.unet.dtype),
        ]
        scales = [0.85, 0.45 if "full color" in prompt else 0.7]
    elif mode == "repair":
        controls = [ControlNetModel.from_pretrained(TILE_REPO, torch_dtype=pipe.unet.dtype)]
        scales = [max(0.45, 0.9 - denoise)]
    adapters: list[str] = []
    if controls:
        runner = StableDiffusionXLControlNetImg2ImgPipeline(**pipe.components, controlnet=controls if len(controls) > 1 else controls[0])
    else:
        runner = StableDiffusionXLImg2ImgPipeline(**pipe.components)
    if reference is not None and mode in {"repair", "manga"}:
        runner.load_ip_adapter(IP_REPO, subfolder=IP_SUBFOLDER, weight_name=FACE_WEIGHT)
        runner.set_ip_adapter_scale(0.65)
    try:
        adapters = _apply_loras(runner, loras)
        canvas = image.copy()
        for x0, y0, x1, y1 in tile_boxes(image.width, image.height, 768, 64):
            crop = image.crop((x0, y0, x1, y1))
            kwargs: dict[str, Any] = {
                "prompt": prompt or "anime illustration",
                "negative_prompt": negative,
                "image": crop,
                "strength": denoise,
                "num_inference_steps": 16,
                "guidance_scale": 5.0,
            }
            if reference is not None and mode in {"repair", "manga"}:
                kwargs["ip_adapter_image"] = reference
            if controls:
                if mode == "edit" and pose is not None:
                    kwargs["control_image"] = [pose.crop((x0, y0, x1, y1)), _ink(crop)]
                elif mode == "manga":
                    kwargs["control_image"] = [_ink(crop), crop]
                else:
                    kwargs["control_image"] = crop
                kwargs["controlnet_conditioning_scale"] = scales if len(scales) > 1 else scales[0]
            piece = runner(**kwargs).images[0]
            canvas.paste(piece.resize((x1 - x0, y1 - y0)), (x0, y0))
        return canvas
    finally:
        if adapters:
            _clear_loras(runner, adapters)


def _face_pass(image: Any, reference: Any, prompt: str) -> Any:
    from yume_server.generate import loaded_pipe

    pipe = loaded_pipe()
    if pipe is None:
        return image
    from diffusers import StableDiffusionXLImg2ImgPipeline

    width, height = image.size
    fw, fh = max(64, int(width * 0.42)), max(64, int(height * 0.34))
    fw, fh = fw - fw % 8, fh - fh % 8
    x, y = max(0, (width - fw) // 2), max(0, int(height * 0.06))
    crop = image.crop((x, y, x + fw, y + fh))
    runner = StableDiffusionXLImg2ImgPipeline(**pipe.components)
    runner.load_ip_adapter(IP_REPO, subfolder=IP_SUBFOLDER, weight_name=FACE_WEIGHT)
    runner.set_ip_adapter_scale(0.8)
    refined = runner(
        prompt=prompt or "face, detailed eyes",
        negative_prompt="deformed, extra eyes, bad face",
        image=crop,
        ip_adapter_image=reference,
        strength=0.3,
        num_inference_steps=12,
        guidance_scale=4.5,
    ).images[0]
    image.paste(refined.resize((fw, fh)), (x, y))
    return image


def _fill_holes(image: Any, holes: list[tuple[int, int, int, int]]) -> Any:
    from diffusers import StableDiffusionXLImg2ImgPipeline

    from yume_server.generate import loaded_pipe

    pipe = loaded_pipe()
    if pipe is None:
        return image
    runner = StableDiffusionXLImg2ImgPipeline(**pipe.components)
    for x, y, w, h in holes:
        crop = image.crop((x, y, x + w, y + h)).resize((max(64, w - w % 8), max(64, h - h % 8)))
        filled = runner(prompt="manga background, screentone, empty", negative_prompt="person, face, text", image=crop, strength=0.65, num_inference_steps=12, guidance_scale=4.5).images[0]
        image.paste(filled.resize((w, h)), (x, y))
    return image


def _restore_bubbles(redrawn: Any, original: Any, rects: list[tuple[int, int, int, int]]) -> Any:
    for x, y, w, h in rects:
        redrawn.paste(original.crop((x, y, x + w, y + h)), (x, y))
    return redrawn
