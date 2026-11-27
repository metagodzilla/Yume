"""Single-pass attention couple for SDXL.

Cross-attention mixes the shared prompt with each character prompt. Spatial
UNet LoRA deltas are multiplied by the same feathered masks. Text-token
projections have no image position, so those stay shared.
"""

from __future__ import annotations

import contextvars
import logging
from typing import Any

from yume_server.regional import feathered_masks, resample, spatial_hw

_LOG = logging.getLogger("yume.regional")
_JOB: contextvars.ContextVar[dict[str, Any] | None] = contextvars.ContextVar("yume_couple", default=None)


def _character_adapters(loras: list[Any], regions: list[Any], masks: list[list[list[float]]]) -> dict[str, list[list[float]]]:
    names: dict[str, str] = {}
    for index, lora in enumerate(loras or []):
        if str(getattr(lora, "kind", "style") or "style") != "character" or getattr(lora, "enabled", True) is False:
            continue
        label = str(getattr(lora, "name", "") or "").strip()
        if label:
            names[label] = f"lora_{index}"
    found: dict[str, list[list[float]]] = {}
    for region, mask in zip(regions, masks):
        adapter = names.get(str(getattr(region, "lora_name", "") or "").strip())
        if adapter:
            found[adapter] = mask
    return found


def _cached_flat(job: dict[str, Any], mask: list[list[float]], height: int, width: int) -> list[float]:
    cache: dict[tuple[int, int, int], list[float]] = job["cache"]
    key = (id(mask), height, width)
    if key not in cache:
        cache[key] = resample(mask, height, width)
    return cache[key]


def _mask_delta(delta: Any, mask: list[list[float]], job: dict[str, Any]) -> Any:
    import torch

    if delta.dim() == 3:
        found = spatial_hw(int(delta.shape[1]), int(job["width"]), int(job["height"]))
        if not found:
            return delta
        height, width = found
        if height * width != int(delta.shape[1]):
            return delta
        flat = _cached_flat(job, mask, height, width)
        weight = torch.tensor(flat, device=delta.device, dtype=delta.dtype).view(1, height * width, 1)
        return delta * weight
    if delta.dim() == 4 and int(delta.shape[-2]) * int(delta.shape[-1]) >= 16:
        height, width = int(delta.shape[-2]), int(delta.shape[-1])
        flat = _cached_flat(job, mask, height, width)
        weight = torch.tensor(flat, device=delta.device, dtype=delta.dtype).view(1, 1, height, width)
        return delta * weight
    return delta


def _masked_forward(module: Any, original: Any, args: tuple[Any, ...], kwargs: dict[str, Any]) -> Any:
    job = _JOB.get()
    if job is None or not job.get("adapter_masks") or not args:
        return original(*args, **kwargs)
    try:
        saved = getattr(module, "_active_adapter", None)
        adapters = list(module.active_adapters)
        if not adapters:
            return original(*args, **kwargs)
        base = module.base_layer(*args, **kwargs)
        acc = base
        try:
            for adapter in adapters:
                module.set_adapter(adapter)
                if list(module.active_adapters) != [adapter]:
                    raise RuntimeError(f"could not isolate {adapter}")
                full = original(*args, **kwargs)
                delta = full - module.base_layer(*args, **kwargs)
                mask = job["adapter_masks"].get(adapter)
                if mask is not None:
                    delta = _mask_delta(delta, mask, job)
                acc = acc + delta
            return acc.to(dtype=base.dtype)
        finally:
            module._active_adapter = saved
    except Exception:
        if not job.get("lora_warned"):
            job["lora_warned"] = True
            _LOG.exception("character LoRA mask failed; that layer stays global")
        return original(*args, **kwargs)


def _install_lora_masks(unet: Any, adapter_masks: dict[str, list[list[float]]]) -> list[tuple[Any, Any]]:
    if not adapter_masks:
        return []
    wrapped: list[tuple[Any, Any]] = []
    for module in unet.modules():
        if not hasattr(module, "lora_A") or not hasattr(module, "base_layer") or not hasattr(module, "set_adapter"):
            continue
        original = module.forward

        def forward(*args: Any, _module: Any = module, _original: Any = original, **kwargs: Any) -> Any:
            return _masked_forward(_module, _original, args, kwargs)

        module.forward = forward
        wrapped.append((module, original))
    return wrapped


class _CoupleProcessor:
    def __init__(self, original: Any) -> None:
        self.original = original

    def __call__(self, attn: Any, hidden_states: Any, encoder_hidden_states: Any = None, attention_mask: Any = None, temb: Any = None, *args: Any, **kwargs: Any) -> Any:
        job = _JOB.get()
        if job is None or encoder_hidden_states is None or not job.get("contexts"):
            return self.original(attn, hidden_states, encoder_hidden_states, attention_mask, temb, *args, **kwargs)
        try:
            return self._blend(attn, hidden_states, encoder_hidden_states, attention_mask, temb, args, kwargs, job)
        except Exception:
            if not job.get("attn_warned"):
                job["attn_warned"] = True
                _LOG.exception("attention couple failed; this layer uses the shared prompt only")
            return self.original(attn, hidden_states, encoder_hidden_states, attention_mask, temb, *args, **kwargs)

    def _call(self, attn: Any, hidden: Any, context: Any, attention_mask: Any, temb: Any, args: tuple[Any, ...], kwargs: dict[str, Any]) -> Any:
        mask = attention_mask
        if mask is not None and context is not None and getattr(mask, "shape", None) is not None and mask.shape[-1] != context.shape[1]:
            mask = None
        return self.original(attn, hidden, encoder_hidden_states=context, attention_mask=mask, temb=temb, *args, **kwargs)

    def _blend(self, attn: Any, hidden_states: Any, encoder_hidden_states: Any, attention_mask: Any, temb: Any, args: tuple[Any, ...], kwargs: dict[str, Any], job: dict[str, Any]) -> Any:
        import torch

        contexts = job["contexts"]
        masks = job["masks"]
        base = contexts[0]
        cfg = hidden_states.shape[0] == encoder_hidden_states.shape[0] and hidden_states.shape[0] == base.shape[0] * 2
        if cfg:
            half = hidden_states.shape[0] // 2
            neg_out = self._call(attn, hidden_states[:half], encoder_hidden_states[:half], attention_mask, temb, args, kwargs)
            pos_hidden = hidden_states[half:]
        else:
            neg_out = None
            pos_hidden = hidden_states
        outputs = []
        for context in contexts:
            ctx = context.to(device=pos_hidden.device, dtype=pos_hidden.dtype)
            if ctx.shape[0] == 1 and pos_hidden.shape[0] != 1:
                ctx = ctx.expand(pos_hidden.shape[0], -1, -1)
            elif ctx.shape[0] != pos_hidden.shape[0]:
                ctx = ctx[:1].expand(pos_hidden.shape[0], -1, -1)
            outputs.append(self._call(attn, pos_hidden, ctx, attention_mask, temb, args, kwargs))
        found = spatial_hw(int(pos_hidden.shape[1]), int(job["width"]), int(job["height"]))
        if not found or len(outputs) < 2:
            mixed = outputs[0]
        else:
            height, width = found
            weights = [torch.ones(pos_hidden.shape[0], pos_hidden.shape[1], 1, device=outputs[0].device, dtype=outputs[0].dtype)]
            for mask in masks:
                flat = _cached_flat(job, mask, height, width)
                weights.append(torch.tensor(flat, device=outputs[0].device, dtype=outputs[0].dtype).view(1, height * width, 1).expand(pos_hidden.shape[0], -1, -1))
            stacked = torch.stack(weights, dim=0)
            total = stacked.sum(dim=0).clamp_min(1e-6)
            mixed = outputs[0] * (stacked[0] / total)
            for index, output in enumerate(outputs[1:], start=1):
                mixed = mixed + output * (stacked[index] / total)
        if neg_out is None:
            return mixed
        return torch.cat([neg_out, mixed], dim=0)


def bind_together(pipe: Any, body: Any, regions: list[Any], conditioning: dict[str, Any] | None) -> dict[str, Any]:
    from yume_server.generate import sdxl_conditioning

    state: dict[str, Any] = {"pipe": pipe, "processors": None, "forwards": [], "token": None}
    if conditioning is None or not regions:
        return state
    shared = str(body.prompt or "")
    contexts = [conditioning["prompt_embeds"]]
    skip = int(getattr(body, "clip_skip", 2) or 2)
    negative = str(getattr(body, "negative_prompt", "") or "")
    for region in regions:
        character = str(getattr(region, "prompt", "") or "").strip()
        text = f"{shared}, {character}" if character else shared
        region_cond, _count = sdxl_conditioning(pipe, text, negative, skip)
        contexts.append(region_cond["prompt_embeds"])
    layout = "stack" if str(getattr(body, "region_layout", "side") or "side") == "stack" else "side"
    masks = feathered_masks(len(regions), layout, 64, 64)
    adapter_masks = _character_adapters(list(getattr(body, "loras", None) or []), regions, masks)
    job = {
        "contexts": contexts,
        "masks": masks,
        "adapter_masks": adapter_masks,
        "width": int(body.width),
        "height": int(body.height),
        "cache": {},
        "lora_warned": False,
        "attn_warned": False,
    }
    forwards: list[tuple[Any, Any]] = []
    previous = None
    token = None
    try:
        forwards = _install_lora_masks(pipe.unet, adapter_masks)
        previous = dict(pipe.unet.attn_processors)
        processors = {}
        for name, processor in previous.items():
            processors[name] = _CoupleProcessor(processor) if "attn2" in name else processor
        pipe.unet.set_attn_processor(processors)
        token = _JOB.set(job)
    except Exception:
        if token is not None:
            _JOB.reset(token)
        if previous is not None:
            pipe.unet.set_attn_processor(previous)
        for module, forward in forwards:
            module.forward = forward
        raise
    state.update({"processors": previous, "forwards": forwards, "token": token})
    if not adapter_masks:
        scope = "global, kept at their weights"
    elif forwards:
        scope = "masked on spatial layers"
    else:
        scope = "global, because this UNet has no isolated LoRA layers"
    _LOG.info(
        "together regions=%s layout=%s; shared prompt covers the picture, character prompts use feathered overlap; character LoRAs are %s",
        len(regions),
        layout,
        scope,
    )
    return state


def unbind_together(state: dict[str, Any] | None) -> None:
    if not state:
        return
    token = state.get("token")
    if token is not None:
        _JOB.reset(token)
    pipe = state.get("pipe")
    previous = state.get("processors")
    if pipe is not None and previous is not None:
        pipe.unet.set_attn_processor(previous)
    for module, forward in state.get("forwards") or []:
        module.forward = forward
