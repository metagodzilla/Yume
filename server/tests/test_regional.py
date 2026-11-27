from yume_server.regional import detect_kind, plan_regions, region_boxes


def test_character_tags_are_detected_and_other_loras_stay_style() -> None:
    assert detect_kind(tags=["character", "anime"]) == "character"
    assert detect_kind(name="Momo character lora") == "character"
    assert detect_kind(type_name="LORA", tags=["style", "clothing"], name="ribbon") == "style"
    assert detect_kind(explicit="character") == "character"


def test_two_characters_split_the_frame_and_one_does_not() -> None:
    side = region_boxes(2, "side")
    assert side == [{"x": 0.0, "y": 0.0, "w": 0.5, "h": 1.0}, {"x": 0.5, "y": 0.0, "w": 0.5, "h": 1.0}]
    stack = region_boxes(2, "stack")
    assert stack[0]["h"] == 0.5 and stack[1]["y"] == 0.5
    assert region_boxes(1, "side") == []
    solo = plan_regions([{"name": "momo", "weight": 0.8, "kind": "character", "prompt": "pink hair"}], "side")
    assert solo is None
    pair = plan_regions(
        [
            {"name": "momo", "weight": 0.8, "kind": "character", "prompt": "pink hair", "enabled": True},
            {"name": "ink", "weight": 0.6, "kind": "style", "prompt": "lineart"},
            {"name": "ken", "weight": 0.7, "kind": "character", "prompt": "blue eyes", "enabled": True},
        ],
        "side",
    )
    assert pair is not None and len(pair) == 2
    assert pair[0]["lora_name"] == "momo" and pair[0]["w"] == 0.5 and pair[1]["lora_name"] == "ken"
    assert pair[0]["prompt"] == "pink hair"
