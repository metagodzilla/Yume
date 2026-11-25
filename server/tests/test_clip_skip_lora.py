import os

os.environ.setdefault("YUME_MOCK", "1")
os.environ.setdefault("YUME_API_KEY", "test-key")
os.environ.setdefault("YUME_MODEL_DIR", "/tmp/yume-model-cache")

from yume_server.generate import (  # noqa: E402
    _ClipSkipEncoder,
    _apply_loras,
    _clear_loras,
    _clip_skip_applied,
    unwrap_clip_skip,
)


class _Output:
    def __init__(self, states: tuple[int, ...]) -> None:
        self.hidden_states = states


class _Encoder:
    def __call__(self, *args, **kwargs):
        states = tuple(range(13))
        return _Output(states)


class _Pipe:
    def __init__(self) -> None:
        self.text_encoder = _Encoder()
        self.text_encoder_2 = _Encoder()


def test_lora_load_and_unload_see_the_real_encoder_for_clip_skip_1_and_2(monkeypatch) -> None:
    monkeypatch.setattr("yume_server.peft_setup.ensure_peft", lambda: True)
    seen: list[tuple[str, str, int]] = []

    def load(pipe, path, adapter_name):
        seen.append(("load", type(pipe.text_encoder).__name__, pipe.text_encoder is pipe._real))

    def unload():
        seen.append(("unload", type(pipe.text_encoder).__name__, pipe.text_encoder is pipe._real))

    pipe = _Pipe()
    pipe._real = pipe.text_encoder
    monkeypatch.setattr(_Pipe, "load_lora_weights", load, raising=False)
    monkeypatch.setattr(_Pipe, "set_adapters", lambda *args, **kwargs: None, raising=False)
    monkeypatch.setattr(_Pipe, "unload_lora_weights", lambda self: unload(), raising=False)

    class _Lora:
        name = "ribbon.safetensors"
        weight = 0.8
        versionId = None

    monkeypatch.setattr("yume_server.generate.resolve_lora_path", lambda lora: "/models/loras/ribbon.safetensors")

    for skip in (1, 2):
        unwrap_clip_skip(pipe)
        # A previous draw must not leave the wrapper in place.
        pipe.text_encoder = _ClipSkipEncoder(pipe._real, 1)
        unwrap_clip_skip(pipe)
        adapters = _apply_loras(pipe, [_Lora()])
        try:
            with _clip_skip_applied(pipe, skip):
                output = pipe.text_encoder()
                seen.append(("draw", type(pipe.text_encoder).__name__, output.hidden_states[-2]))
        finally:
            unwrap_clip_skip(pipe)
            _clear_loras(pipe, adapters)
        assert type(pipe.text_encoder).__name__ == "_Encoder"
        assert type(pipe.text_encoder_2).__name__ == "_Encoder"

    loads = [item for item in seen if item[0] == "load"]
    draws = [item for item in seen if item[0] == "draw"]
    unloads = [item for item in seen if item[0] == "unload"]
    assert all(name == "_Encoder" and real for _, name, real in loads)
    assert all(name == "_Encoder" and real for _, name, real in unloads)
    # Clip skip 1 puts the last layer where SDXL reads [-2]. Clip skip 2 leaves that slot alone.
    assert draws[0][2] == 12 and draws[0][1] == "_ClipSkipEncoder"
    assert draws[1][2] == 11 and draws[1][1] == "_Encoder"
