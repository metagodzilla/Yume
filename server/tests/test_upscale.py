import base64
import os

os.environ.setdefault("YUME_MOCK", "1")
os.environ.setdefault("YUME_API_KEY", "test-key")
os.environ.setdefault("YUME_MODEL_DIR", "/tmp/yume-model-cache")

from fastapi.testclient import TestClient  # noqa: E402

from yume_server.generate import _png  # noqa: E402
from yume_server.main import app  # noqa: E402
from yume_server.manga_edit import edit_prompt, expand_for_body, page_is_color, segment_person  # noqa: E402
from yume_server.pose import retarget_anchored, synthetic_reference  # noqa: E402
from yume_server.upscale import (  # noqa: E402
    compose_prompt,
    detail_denoise,
    find_bubbles,
    find_panels,
    plan_target,
    redraw_denoise,
    repair_denoise,
    scale_rects,
)


def _picture(width: int, height: int) -> str:
    return _png(width, height, 1)


def test_targets_are_2k_and_4k_long_edges_not_a_blind_scale() -> None:
    small = plan_target(832, 1216, "2k")
    assert small["longEdge"] == 2048
    assert small["height"] == 2048
    assert small["width"] % 8 == 0
    assert abs(small["width"] / small["height"] - 832 / 1216) < 0.03
    assert small["passes"] == 1
    four = plan_target(832, 1216, "4k")
    assert 3840 <= four["longEdge"] <= 4096
    assert four["passes"] == 1
    assert plan_target(400, 400, "4k")["passes"] == 2
    assert plan_target(5000, 3000, "2k")["passes"] == 0
    try:
        plan_target(100, 100, "3x")
        raise AssertionError("bad preset was accepted")
    except ValueError:
        pass


def test_denoise_ranges_and_prompts() -> None:
    assert detail_denoise(0) == 0.2 and detail_denoise(1) == 0.45
    assert repair_denoise(0) == 0.3 and repair_denoise(1) == 0.65
    assert redraw_denoise(0) == 0.4 and redraw_denoise(1) == 0.75
    mono = compose_prompt(kind="manga", prompt="", hints="Momo: pink hair", tags="", colorize=False)
    color = compose_prompt(kind="manga", prompt="sunset", hints="Momo: pink hair, blue eyes", tags="pink hair", colorize=True)
    assert "monochrome" in mono and "pink hair" in mono
    assert "monochrome" not in color and "pink hair" in color and "blue eyes" in color


def test_panels_and_bubbles() -> None:
    width, height = 40, 40
    pixels = [(180, 180, 180)] * (width * height)
    for y in range(18, 22):
        for x in range(width):
            pixels[y * width + x] = (250, 250, 250)
    panels = find_panels(pixels, width, height)
    assert len(panels) == 2
    bubble = [(140, 140, 140)] * (80 * 80)
    for y in range(10, 40):
        for x in range(10, 40):
            bubble[y * 80 + x] = (250, 250, 250)
    for y in range(20, 26):
        for x in range(18, 28):
            bubble[y * 80 + x] = (0, 0, 0)
    found = find_bubbles(bubble, 80, 80)
    assert len(found) == 1
    assert scale_rects([(10, 10, 20, 20)], 100, 100, 200, 200) == [(20, 20, 40, 40)]


def test_upscale_and_manga_are_separate_endpoints() -> None:
    headers = {"Authorization": "Bearer test-key"}
    image = _picture(64, 96)
    with TestClient(app) as client:
        assert client.post("/upscale", json={"image": image}).status_code == 401
        plain = client.post("/upscale", headers=headers, json={"image": image, "preset": "2k"})
        assert plain.status_code == 200, plain.text
        body = plain.json()
        assert body["mode"] == "esrgan" and body["height"] == 2048 and body["face_pass"] is False
        repair = client.post(
            "/upscale",
            headers=headers,
            json={"image": image, "preset": "4k", "references": [image], "character_tags": "pink hair", "loras": [{"name": "momo", "weight": 0.8}], "repair": 1},
        )
        assert repair.status_code == 200, repair.text
        fixed = repair.json()
        assert fixed["mode"] == "repair" and fixed["face_pass"] is True and fixed["ip_adapter"] == "plus-face"
        assert "tile" in fixed["controlnet"] and "momo" in fixed["loras"] and fixed["denoise"] == 0.65
        assert 3840 <= max(fixed["width"], fixed["height"]) <= 4096
        page = client.post(
            "/manga",
            headers=headers,
            json={"image": image, "preset": "2k", "colorize": True, "hints": "Momo: pink hair, blue eyes", "redraw": 0},
        )
        assert page.status_code == 200, page.text
        manga = page.json()
        assert manga["mode"] == "manga" and manga["colorize"] is True
        assert "lineart" in manga["controlnet"] and "tile" in manga["controlnet"]
        assert "pink hair" in manga["prompt"] and "monochrome" not in manga["prompt"]
        assert manga["denoise"] == 0.4
        edit = client.post(
            "/manga",
            headers=headers,
            json={
                "image": image,
                "job": "edit",
                "preset": "2k",
                "x": 0.5,
                "y": 0.4,
                "body": "tall",
                "outfit": "original",
                "clothes": "school uniform",
                "character_tags": "pink hair, blue eyes",
                "loras": [{"name": "momo", "weight": 0.8}],
                "colorize": False,
            },
        )
        assert edit.status_code == 200, edit.text
        swapped = edit.json()
        assert swapped["mode"] == "edit"
        assert swapped["controlnet"] == ["pose", "lineart"]
        assert "momo" in swapped["loras"] and swapped["outfit"] == "original" and "same outfit" in swapped["prompt"]
        assert "school uniform" not in swapped["prompt"]
        assert swapped["page"] == "color" and "full color" in swapped["prompt"]
        segment = client.post("/manga/segment", headers=headers, json={"image": image, "x": 0.5, "y": 0.4})
        assert segment.status_code == 200, segment.text
        assert segment.json()["segmenter"] == "ink" and segment.json()["mask"].startswith("iVBOR")


def test_edit_mask_follows_the_body_and_the_brush() -> None:
    width, height = 80, 80
    pixels = [(210, 210, 210)] * (width * height)
    for y in range(20, 55):
        for x in range(40, 60):
            pixels[y * width + x] = (10, 10, 12)
    found = segment_person(pixels, width, height, 50, 30, None)
    assert found["box"][0] <= 50 <= found["box"][0] + found["box"][2]
    erased = segment_person(pixels, width, height, 50, 30, [{"x": 50 / 80, "y": 30 / 80, "r": 0.2, "erase": True}])
    assert sum(erased["mask"]) < sum(found["mask"])
    source = synthetic_reference(width, height)
    tall = retarget_anchored(source, "tall", height_cm=185)
    petite = retarget_anchored(source, "petite", height_cm=148)
    from yume_server.pose import point_box

    assert point_box(tall)[3] > point_box(source)[3]
    assert point_box(petite)[3] < point_box(tall)[3]
    grown = expand_for_body(found["box"], source, tall)
    shrunk = expand_for_body(found["box"], source, petite)
    assert grown["box"][3] >= shrunk["box"][3]
    assert page_is_color([(20, 20, 20), (200, 30, 40)] * 50)
    assert not page_is_color([(20, 20, 20)] * 80)
    assert "monochrome" in edit_prompt(color=False, colorize=False, tags="pink hair", clothes="school uniform", outfit="original", prompt="")
    assert "school uniform" in edit_prompt(color=False, colorize=True, tags="", clothes="school uniform", outfit="clothes", prompt="")
