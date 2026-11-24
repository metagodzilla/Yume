# Mock mesh server. No GPU and no TRELLIS weights.
#   docker build -f mesh.Dockerfile -t yume-mesh:mock .
#
# The real TRELLIS image is a different container from the SDXL one.
# Build it from Microsoft's TRELLIS install (Linux, CUDA, at least 16 GB).
# Point the command at this app once `import trellis` works:
#   python -m uvicorn yume_mesh.main:app --host :: --port 8080
# Leave YUME_MOCK unset on that image. See DEPLOY.md.
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY yume_mesh ./yume_mesh
ENV YUME_MOCK=1 \
    YUME_API_KEY=change-me \
    PORT=8080
EXPOSE 8080
CMD ["python", "-m", "uvicorn", "yume_mesh.main:app", "--host", "::", "--port", "8080"]
