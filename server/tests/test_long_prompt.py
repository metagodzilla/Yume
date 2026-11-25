import os

os.environ.setdefault("YUME_MOCK", "1")
os.environ.setdefault("YUME_API_KEY", "test-key")
os.environ.setdefault("YUME_MODEL_DIR", "/tmp/yume-model-cache")

from yume_server.generate import chunk_token_ids, tidy_prompt  # noqa: E402


def test_prompt_over_77_tokens_is_split_into_clip_chunks() -> None:
    tokens = list(range(80))
    chunks = chunk_token_ids(tokens, bos=49406, eos=49407)
    assert len(chunks) == 2
    assert all(len(chunk) == 77 for chunk in chunks)
    assert chunks[0][0] == 49406 and chunks[0][-1] == 49407
    assert chunks[0][1:76] == tokens[:75]
    assert chunks[1][1:6] == tokens[75:]
    assert chunks[1][6:-1] == [49407] * 70


def test_duplicate_triggers_keep_the_first_spelling() -> None:
    assert tidy_prompt("Ribbon, ribbon, girl, Girl, <lora:ribbon:0.8>, <lora:ribbon:0.8>") == "Ribbon, girl, <lora:ribbon:0.8>"
    assert tidy_prompt("(blue eyes:1.2), (red, gold:1.1)") == "(blue eyes:1.2), (red, gold:1.1)"


def test_monochrome_trigger_is_removed_only_when_the_lora_asked_for_it() -> None:
    triggers = ["monochrome, sketch, line art"]
    assert tidy_prompt("1girl, monochrome, manga, sketch", triggers) == "1girl, manga"
    assert tidy_prompt("1girl, manga", []) == "1girl, manga"
    assert tidy_prompt("1girl, monochrome", []) == "1girl, monochrome"
