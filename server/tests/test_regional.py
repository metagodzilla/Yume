from types import SimpleNamespace

from yume_server.regional import (
    OVERLAP,
    attention_weights,
    detect_kind,
    drawing_mode,
    feathered_masks,
    fold_interaction,
    masks_overlap,
    spatial_hw,
)


def test_character_tags_are_detected_and_other_loras_stay_style() -> None:
    assert detect_kind(tags=["character", "anime"]) == "character"
    assert detect_kind(name="Momo character lora") == "character"
    assert detect_kind(type_name="LORA", tags=["style", "clothing"], name="ribbon") == "style"
    assert detect_kind(explicit="character") == "character"


def _body(**kwargs):
    defaults = {"regions": [], "reference_image": None, "pose": False, "copy_picture": False, "style": False, "mode": "txt2img", "region_mode": "separate"}
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def test_two_characters_use_one_together_pass_and_boxes_do_not_switch_mode() -> None:
    assert drawing_mode(_body()) == "plain"
    solo = _body(regions=[SimpleNamespace(prompt="pink hair", lora_name="momo")])
    assert drawing_mode(solo) == "plain"
    pair = _body(
        regions=[
            SimpleNamespace(prompt="pink hair", lora_name="momo", x=0, y=0, w=0.5, h=1),
            SimpleNamespace(prompt="blue eyes", lora_name="ken", x=0.5, y=0, w=0.5, h=1),
        ],
        region_mode="separate",
    )
    assert drawing_mode(pair) == "together"
    posed = _body(regions=pair.regions, reference_image="abc", pose=True)
    assert drawing_mode(posed) == "reference"


def test_masks_overlap_in_the_middle_and_layout_switches_the_axis() -> None:
    assert OVERLAP > 0.2
    side = feathered_masks(2, "side", 32, 24)
    stack = feathered_masks(2, "stack", 32, 24)
    assert masks_overlap(side) and masks_overlap(stack)
    assert side[0][12][0] > 0.9 and side[1][12][0] < 0.05
    assert side[0][12][16] > 0.2 and side[1][12][16] > 0.2
    assert stack[0][0][16] > 0.9 and stack[1][0][16] < 0.05
    assert stack[0][12][16] > 0.2 and stack[1][12][16] > 0.2
    assert feathered_masks(1, "side", 32, 24) == []
    middle = attention_weights([side[0][12][16], side[1][12][16]])
    assert middle[0] > 0 and middle[1] > 0.15 and middle[2] > 0.15
    edge = attention_weights([side[0][12][0], side[1][12][0]])
    assert edge[2] == 0 and edge[1] > 0.4


def test_interaction_joins_the_shared_prompt_only_for_two_characters() -> None:
    assert fold_interaction("two people", "hugging", True) == "two people, hugging"
    assert fold_interaction("two people hugging", "hugging", True) == "two people hugging"
    assert fold_interaction("two people", "kissing", False) == "two people"


def test_spatial_size_matches_an_sdxl_latent() -> None:
    assert spatial_hw(104 * 152, 832, 1216) == (152, 104)
    assert spatial_hw(52 * 76, 832, 1216) == (76, 52)
    assert spatial_hw(77, 832, 1216) is None
