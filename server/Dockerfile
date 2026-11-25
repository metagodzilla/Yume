# Slim GPU runtime. Torch and diffusers only.
#   docker build --target gpu -t ghcr.io/metagodzilla/yume-server:slim .
# Weights and feature packages are not in this image. WAI downloads at startup.
# 3D, pose detection, and the upscaler runtime install into /data the first time they are used.
#
# Local mock image, no GPU:
#   docker build -t yume-salad:mock .

FROM python:3.11-slim-bookworm AS wheels
ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /opt/wheels
COPY requirements.txt requirements-gpu.txt ./
RUN pip install --prefix=/opt/py --no-cache-dir \
        --index-url https://download.pytorch.org/whl/cu124 \
        torch==2.5.1 \
    && pip install --prefix=/opt/py --no-cache-dir -r requirements.txt -r requirements-gpu.txt \
    && python -c "import pathlib,shutil; root=pathlib.Path('/opt/py'); \
[shutil.rmtree(p, ignore_errors=True) for p in list(root.rglob('__pycache__'))]; \
[shutil.rmtree(p, ignore_errors=True) for p in list(root.rglob('tests')) if p.is_dir()]" \
    && rm -rf /root/.cache /tmp/*

FROM python:3.11-slim-bookworm AS gpu
ENV PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    YUME_MODEL_ID=cagliostrolab/animagine-xl-4.0 \
    HF_HOME=/models \
    YUME_MODEL_DIR=/models \
    YUME_LORA_DIR=/loras \
    YUME_FEATURE_ROOT=/data/features \
    YUME_RUNTIME_ROOT=/opt/yume \
    YUME_SERVER_REF=latest \
    YUME_GITHUB_REPO=metagodzilla/Yume \
    PYTHONPATH=/opt/yume/runtime \
    PORT=8080
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=wheels /opt/py /usr/local
COPY yume_runtime /opt/yume/runtime/yume_runtime
COPY yume_server /opt/yume/bundled/yume_server
COPY yume_mesh /opt/yume/bundled/yume_mesh
WORKDIR /app
EXPOSE 8080
CMD ["python", "-m", "yume_runtime.supervisor"]

FROM python:3.11-slim-bookworm AS app
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && rm -rf /root/.cache
COPY yume_runtime /opt/yume/runtime/yume_runtime
COPY yume_server /opt/yume/bundled/yume_server
COPY yume_mesh /opt/yume/bundled/yume_mesh
ENV YUME_MOCK=1 \
    YUME_API_KEY=change-me \
    YUME_RUNTIME_ROOT=/opt/yume \
    YUME_SERVER_REF=latest \
    YUME_GITHUB_REPO=metagodzilla/Yume \
    PYTHONPATH=/opt/yume/runtime \
    PORT=8080
EXPOSE 8080
CMD ["python", "-m", "yume_runtime.supervisor"]
