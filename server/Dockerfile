# Local image. It answers /generate with mock pictures and does not need a GPU.
#   docker build -t yume-salad:mock .
#
# Salad image, with PyTorch CUDA and diffusers. The weights download on first boot.
#   docker build --target gpu -t yume-salad:gpu .
FROM python:3.11-slim AS app
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY yume_server ./yume_server
COPY yume_mesh ./yume_mesh
ENV YUME_MOCK=1 \
    YUME_API_KEY=change-me \
    PORT=8080
EXPOSE 8080
# Salad's gateway connects over IPv6. Binding :: accepts those connections.
CMD ["python", "-m", "uvicorn", "yume_server.main:app", "--host", "::", "--port", "8080"]

FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime AS gpu
WORKDIR /app
COPY requirements.txt requirements-gpu.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-gpu.txt
COPY yume_server ./yume_server
COPY yume_mesh ./yume_mesh
ENV YUME_MODEL_ID=cagliostrolab/animagine-xl-4.0 \
    HF_HOME=/models \
    YUME_LORA_DIR=/loras \
    PORT=8080
EXPOSE 8080
CMD ["python", "-m", "uvicorn", "yume_server.main:app", "--host", "::", "--port", "8080"]
