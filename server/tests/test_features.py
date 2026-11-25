import json
import os

os.environ["YUME_MOCK"] = "1"
os.environ["YUME_FEATURE_ROOT"] = "/tmp/yume-features-test"

from yume_server.features import known_features, read_used, remember_used, restore_features  # noqa: E402


def test_only_used_features_are_remembered_and_restored() -> None:
    root = os.environ["YUME_FEATURE_ROOT"]
    os.makedirs(root, exist_ok=True)
    used = os.path.join(root, "used.json")
    if os.path.exists(used):
        os.remove(used)
    assert known_features(["pose", "nope", "pose", "upscaler"]) == ["pose", "upscaler"]
    remember_used("pose")
    remember_used("not-a-feature")
    assert read_used() == ["pose"]
    assert json.loads(open(used, encoding="utf-8").read()) == ["pose"]
    assert restore_features(["pose", "made-up"]) == []
