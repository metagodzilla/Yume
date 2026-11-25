import os

os.environ.setdefault("YUME_MOCK", "1")
os.environ.setdefault("YUME_API_KEY", "test-key")
os.environ.setdefault("YUME_MODEL_DIR", "/tmp/yume-model-cache")

from fastapi.testclient import TestClient  # noqa: E402

from yume_server.main import app  # noqa: E402
from yume_server.pose import R_ANKLE, R_HIP, R_KNEE, bone_length, retarget, synthetic_reference  # noqa: E402
from yume_server.reference import style_scale  # noqa: E402


def test_tall_pose_has_longer_legs_than_the_chibi_reference() -> None:
    source = synthetic_reference()
    short_leg = bone_length(source, R_HIP, R_KNEE) + bone_length(source, R_KNEE, R_ANKLE)
    head = bone_length(source, 1, 0)
    assert head > short_leg
    petite = retarget(source, "petite", 512, 768, fit=True)
    tall = retarget(source, "tall", 512, 768, fit=True, height_cm=182)
    petite_leg = bone_length(petite, R_HIP, R_KNEE) + bone_length(petite, R_KNEE, R_ANKLE)
    tall_leg = bone_length(tall, R_HIP, R_KNEE) + bone_length(tall, R_KNEE, R_ANKLE)
    assert tall_leg > petite_leg
    ys = [point[1] for point in tall if point is not None]
    xs = [point[0] for point in tall if point is not None]
    assert min(ys) > 20 and max(ys) < 748
    assert min(xs) > 10 and max(xs) < 502


def test_fit_off_keeps_the_short_leg_ratio() -> None:
    source = synthetic_reference()
    raw = retarget(source, "tall", 512, 768, fit=False)
    source_ratio = bone_length(source, R_HIP, R_KNEE) / max(1.0, bone_length(source, 1, 0))
    raw_ratio = bone_length(raw, R_HIP, R_KNEE) / max(1.0, bone_length(raw, 1, 0))
    assert abs(source_ratio - raw_ratio) < 0.02


def test_style_scale_turns_down_layout_blocks() -> None:
    scale = style_scale(0.55)
    assert scale["down"]["block_2"] == [0.0, 0.0]
    assert scale["up"]["block_0"][1] == 0.55


def test_pose_preview_changes_with_body_size() -> None:
    headers = {"Salad-Api-Key": "test-key"}
    with TestClient(app) as client:
        denied = client.post("/reference/pose", json={"image": "aW1hZ2U="})
        assert denied.status_code == 401
        petite = client.post("/reference/pose", headers=headers, json={"image": "aW1hZ2U=", "body": "petite", "fit": True, "width": 256, "height": 384})
        tall = client.post("/reference/pose", headers=headers, json={"image": "aW1hZ2U=", "body": "tall", "fit": True, "width": 256, "height": 384, "height_cm": 185})
        assert petite.status_code == 200, petite.text
        assert tall.status_code == 200, tall.text
        assert petite.json()["skeleton"].startswith("iVBOR")
        assert petite.json()["skeleton"] != tall.json()["skeleton"]
        generated = client.post(
            "/generate",
            headers=headers,
            json={"prompt": "1girl", "width": 512, "height": 512, "reference_image": "aW1hZ2U=", "pose": True, "copy_picture": True, "style": True, "strength": 0.6},
        )
        assert generated.status_code == 200, generated.text
        assert generated.json()["consistency"] == "pose+img2img+style"
