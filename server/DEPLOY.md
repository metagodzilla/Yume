# Deploy Yume's image server on SaladCloud

This container runs [Animagine XL 4.0](https://huggingface.co/cagliostrolab/animagine-xl-4.0) (CreativeML Open RAIL++-M, the same license as SDXL, with no extra restrictions added by the finetune). It is a public Hugging Face repo, so the container downloads the weights on first boot. You do not bake the checkpoint into the image.

Nothing in this repo creates a Salad account or starts a container group. The script prints a request and only sends it if you pass `--apply` yourself.

Prices below are from [salad.com/pricing](https://salad.com/pricing/) and the [billing docs](https://docs.salad.com/container-engine/explanation/billing-pricing/billing) (billing page updated November 2, 2026). Confirm the number in the portal before you leave a group running. GPU prices include vCPU and RAM. You are billed per second only while an instance is **running**. Allocation, image download, and cold start are not billed. A group that stays up while you are not drawing still costs money, so stop it when you are done.

## What to rent

Animagine XL 4.0 is an SDXL model. One image at a time in fp16 is comfortable on 24 GB and can fit on 12 GB. This server draws images one by one, not as a single large batch.

| Choice | Why |
| --- | --- |
| RTX 3090, 24 GB | The default. Low priority was listed at $0.127 per GPU-hour, Lowest at $0.090, High at $0.200. |
| RTX 4090, 24 GB | Faster, listed from $0.160 (Lowest) to $0.440 (High) per GPU-hour. |
| RTX 4070 Ti, 12 GB | Cheaper, listed from $0.080 to $0.200. Use it if 24 GB is scarce. Keep the batch at 1 if it runs out of memory. |

One replica is enough to start. A second replica keeps the gateway up when a Salad node disconnects, and it costs the same rate again. Low priority is the usual cost/reliability trade. Medium if nodes get preempted too often.

Rough idle cost if you leave one RTX 3090 running at Low: about $0.127 per hour, about $3 a day. Stop the group from the portal when you are not using it.

## Container image

The publish workflow builds the GPU target and pushes:

- `ghcr.io/metagodzilla/yume-server:latest`
- `ghcr.io/metagodzilla/yume-server:1.4.4`

`POST /models/install` returns a job id immediately. Poll `GET /models/install/{id}` for `bytesDone`, `bytesTotal`, `state`, and `error`. `GET /errors` (Salad API key required) lists the last 50 sanitized failures. `POST /client-report` stores a phone report in that same list. Set `CIVITAI_TOKEN` on the container when a download must succeed even if the phone does not send `X-Civitai-Token`.

A package created from a private repository is private. Salad cannot pull a private GHCR image until you either make **only the package** public, or give Salad registry credentials.

To make just the package public (leave the `yume` repo private): open `https://github.com/users/metagodzilla/packages/container/yume-server/settings`, under Danger Zone choose **Change package visibility**, and set it to Public. The repo stays private.

Or keep the package private and add registry credentials on the Salad container group: registry `ghcr.io`, username `metagodzilla`, password a GitHub personal access token with the `read:packages` scope.

## 1. Build and push the image

From `server/`:

```bash
docker build -t YOUR_DOCKERHUB_USER/yume-salad:1 .
docker push YOUR_DOCKERHUB_USER/yume-salad:1
```

The default image target is the CUDA one (`pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime`). A mock image, with no GPU and no weights, is:

```bash
docker build --target app -t yume-salad:mock .
docker run --rm -p 8080:8080 -e YUME_API_KEY=dev -e YUME_MOCK=1 yume-salad:mock
```

The container listens on `::` port 8080 so it accepts the IPv6 connections Salad's gateway uses.

## 2. Create the container group

In [portal.salad.com](https://portal.salad.com): Organization, then Project, then **Deploy a Container Group**, then **Custom**.

- **Image:** `YOUR_DOCKERHUB_USER/yume-salad:1`
- **Replicas:** 1 (or 2)
- **Priority:** Low
- **vCPU:** 4
- **Memory:** 16384 MB
- **GPU:** RTX 3090 (24 GB). If you use the API, do not trust a copied GPU id. List current ids first (command below). Salad's own quickstart (August 24, 2026) shows example ids for the 3090, 3090 Ti, and 4090, and tells you to refresh them.
- **Storage:** 25 GB (`26843545600` bytes) so the Hugging Face cache has room. Storage on Salad is ephemeral. A new node downloads the model again.
- **Environment**
  - `YUME_API_KEY` — a long random string. If you turn gateway auth on, set this to your Salad API key so the phone can send one key.
  - `YUME_MODEL_ID` — `cagliostrolab/animagine-xl-4.0`
  - `YUME_MODEL_DIR` — `/models` (checkpoint cache; the default file is downloaded from Hugging Face)
  - `CIVITAI_TOKEN` — optional. Required only when installing other Civitai files. Leave it unset and the default Animagine download still works.
  - `YUME_LORA_DIR` — `/loras`
  - `HF_HOME` — `/models`
  - `YUME_MODEL_ALLOWLIST` — optional comma-separated Hugging Face ids the phone is allowed to request. The default model is always allowed.
  - `YUME_IP_ADAPTER` — set to `1` only if you want turnaround angles to use IP-Adapter (the server then downloads `h94/IP-Adapter`). Leave it unset and a turnaround still uses img2img from the front view, which needs less extra weight.
- **Command:** leave empty. The image already starts uvicorn.
- **Container Gateway:** enabled
  - Port `8080`
  - Protocol HTTP
  - Authentication **on**
  - Load balancer: least connections (better for a GPU that should not take two heavy jobs at once)
  - Client and server timeouts: `100000` (the API maximum; that is also the default)
- **Probes**
  - Startup: HTTP GET `/ready` port 8080, initial delay **600s**, period 60s, timeout 10s, failure threshold 20. The 600s delay plus 20 failures is about 30 minutes. A 60s delay was too short: the first boot used to download Animagine twice and took about 21 minutes. The schema allows at most 20 failures and a 1200s initial delay.
  - Readiness: HTTP GET `/ready` port 8080, period 10s, failure threshold 3.
  - Liveness: HTTP GET `/health` port 8080, period 30s, failure threshold 3.
- **Autostart:** on in the portal. The public API defaults this to false, so the example script starts the group in a second call.

`/health` and `/ready` are open so the probes can call them. `POST /generate` requires the key.

## 3. API example

List GPU classes (read-only):

```bash
curl --request GET \
  --url "https://api.salad.com/api/public/organizations/$SALAD_ORGANIZATION/gpu-classes" \
  --header "Salad-Api-Key: $SALAD_API_KEY"
```

Create, then start. `server/scripts/create-container-group.sh` prints the body. It does not send anything unless you add `--apply`.

```bash
export SALAD_ORGANIZATION=your-org
export SALAD_PROJECT=your-project
export SALAD_API_KEY=your-salad-api-key
export YUME_IMAGE=YOUR_DOCKERHUB_USER/yume-salad:1
export GPU_CLASS_ID=the-id-from-the-list-above
./scripts/create-container-group.sh
./scripts/create-container-group.sh --apply
```

The start call, from Salad's API reference, is:

```bash
curl --request POST \
  --url "https://api.salad.com/api/public/organizations/$SALAD_ORGANIZATION/projects/$SALAD_PROJECT/containers/yume/start" \
  --header "Salad-Api-Key: $SALAD_API_KEY"
```

When the group is Ready, the portal shows an `https://` gateway URL. Put that URL in the Yume app under Settings, SaladCloud, with no `/generate` on the end. Paste the same key you set as `YUME_API_KEY`.

The phone sends three headers with that one value: `Salad-Api-Key` (what the gateway checks when auth is on), `Authorization: Bearer`, and `X-Api-Key` (what the container checks).

## 4. Draw

In the app, pick SaladCloud, save the endpoint and key, then Draw. The first time, the button can sit on "Sending it to Salad" for several minutes. That is the node waking up. Later drawings are a normal SDXL run (20 to 28 steps).

LoRA files are not downloaded for you. Copy a `.safetensors` into `/loras` in the image if you want them, and type that filename in Advanced.

## Request shape

`POST /generate`

```json
{
  "prompt": "string",
  "negative_prompt": "string",
  "width": 832,
  "height": 1216,
  "count": 1,
  "seed": 10,
  "steps": 28,
  "cfg": 5.5,
  "scheduler": "euler_a",
  "model": "cagliostrolab/animagine-xl-4.0",
  "loras": [{ "name": "ribbon.safetensors", "weight": 0.7 }],
  "reference_image": "<base64 png, optional>",
  "strength": 0.45,
  "mode": "img2img"
}
```

`reference_image` is optional. The phone sends the front view of a character turnaround so later angles stay closer to that picture. `strength` is the img2img strength (the phone uses 0.45). Schedulers: `euler_a`, `euler`, `dpm_2m`, `dpm_2m_karras`, `ddim`, `lcm`.

Response: `{ "images": ["<base64 png>"], "seeds": [10], "model": "...", "scheduler": "euler_a", "consistency": "txt2img" }`. `consistency` is `txt2img`, `img2img`, or `ip-adapter`. Mock mode reports `img2img` when a reference is present, and `ip-adapter` only when `YUME_IP_ADAPTER` is set. It does not load either model.

## 3D mesh container

Make 3D on a character sends the front view to `POST /mesh` and expects a textured `.glb`. Use a **second container group**. The picture image stays on Animagine XL. Loading both models in one process would fight over the GPU, and TRELLIS needs its own CUDA extensions.

The model is [microsoft/TRELLIS-image-large](https://github.com/microsoft/TRELLIS) (about 1.2B parameters). The TRELLIS model and most of its code are **MIT**. That is why this project uses it instead of Hunyuan3D-2. Hunyuan3D-2 can take several views, but the Tencent Hunyuan 3D 2.0 Community License does not apply in the European Union, the United Kingdom, or South Korea, and it is not a normal open-source license. TRELLIS-image-large takes **one** image. The phone may send the other turnaround views, and the server reports them as `ignored_views`. It does not pretend to be multi-view.

Two extra licenses sit under the GLB export, and this is not legal advice. Read them before you use the mesh for anything other than a personal project:

- `nvdiffrast`, which TRELLIS uses while baking the texture, is under the NVIDIA Source Code License. That license is limited to non-commercial use.
- `diffoctreerast` and FlexiCubes have their own notices in the TRELLIS repo.

Microsoft's README says an NVIDIA GPU with **at least 16 GB** is required, and that they tested A100 and A6000. Rent a 24 GB card (RTX 3090 or 4090) so the texture bake has room. Do not use the 12 GB option from the picture server. vCPU 4 and 16 GB RAM match the picture container. Give the disk at least 40 GB (`42949672960` bytes). The Hugging Face repo is larger than Animagine XL, and a new Salad node downloads it again.

Cold start is the same shape as the picture server, usually longer because the checkpoint is bigger and the image includes custom CUDA code. `/health` stays open. `/ready` stays 503 until `TrellisImageTo3DPipeline` has loaded. Use the same probe timings as section 2 (startup failure threshold 20, period 60s). Do not send a mesh until `/ready` is 200. Salad's gateway timeout cannot go past `100000` ms, so a request that arrives before the model is loaded will be cut off even though a cold start itself is not billed. After the group is Ready, the server bakes a 512 texture with the step counts from TRELLIS's own example so the job has a chance to finish inside that window. If the gateway still cuts it off, the group was not Ready or the GPU is under 16 GB.

Mock image, no weights:

```bash
docker build -f mesh.Dockerfile -t yume-mesh:mock server
docker run --rm -p 8080:8080 -e YUME_API_KEY=dev -e YUME_MOCK=1 yume-mesh:mock
```

The GPU image is not built by that file. Install TRELLIS the way its README describes (Linux, CUDA 11.8 or 12.2, `setup.sh` with the sparse-conv and nvdiffrast extras), copy `server/yume_mesh` in, and start:

```bash
python -m uvicorn yume_mesh.main:app --host :: --port 8080
```

Leave `YUME_MOCK` unset. Optional `YUME_MESH_MODEL` defaults to `microsoft/TRELLIS-image-large`. `YUME_API_KEY` is the same key the phone already stores. Gateway auth, probes, and the three request headers match the picture container. In the app, Settings → SaladCloud → 3D endpoint is this group's URL. If you leave it empty, the phone calls `/mesh` on the picture endpoint, and that container answers 503 telling you to deploy this one.

`POST /mesh`

```json
{ "image": "<base64 png of the front view>", "views": [{ "angle": "side", "image": "<base64 png>" }] }
```

Response: `{ "glb": "<base64>", "model": "microsoft/TRELLIS-image-large", "mode": "trellis", "multi_view": false, "ignored_views": 1, "note": "..." }`. Mock mode returns `mode: "mock"` and a small stand-in GLB. The phone says, in both modes, that fingers and hair often need cleanup.

## Default checkpoint

The picture container loads one checkpoint the first time it starts, before `/ready` turns 200. It is **Animagine XL 4.0**, version **v4.0**.

Startup uses the Hugging Face diffusers layout only (`model_index.json`, `unet`, `vae`, `text_encoder`, `text_encoder_2`, tokenizers). It does **not** also download `animagine-xl-4.0.safetensors` or `animagine-xl-4.0-opt.safetensors`. Those root files are the same weights a second time (about 6.9 GB plus another ~7 GB of diffusers folders) and were why the first boot took about 21 minutes.

- Civitai model: [1188071](https://civitai.com/models/1188071)
- Version id: `1337429`
- Single-file checkpoint, not downloaded on boot: `animagine-xl-4.0.safetensors` (about 6.9 GB) at `https://huggingface.co/cagliostrolab/animagine-xl-4.0/resolve/main/animagine-xl-4.0.safetensors`
- Civitai’s download URL for this version returns 401 unless a token is sent, so the server does not use it for the default model. Other Civitai checkpoints and LoRAs still install from `https://civitai.com/api/download/models/{versionId}` when `CIVITAI_TOKEN` is set on the container, or when the phone sends the token it saved in Settings (`X-Civitai-Token`). If neither is set, install returns a clear 401 telling you to add the token. The default Animagine load does not need one.
- SHA256: `1D5B43FF75B6AB598502D4C779D2FBFA3DCECA51C60C3B609640A60772333916`
- Model hash written into PNGs: `1d5b43ff75` (AutoV2)
- Base model: SDXL 1.0
- Civitai license fields on that model: credit not required (`allowNoCredit`), commercial use includes Image, Rent, RentCivit, Sell, and SellMerge, derivatives allowed, a different license allowed. The weights themselves are the CreativeML Open RAIL++-M release. This app does not redistribute the file. The diffusers folders land in the Hugging Face cache under `HF_HOME` (default `/models`) on first boot.
- The model's NSFW flag is false (level 3).

The version's own sample images use **Euler a**, **25 steps**, and **CFG 6**, with a negative prompt about lowres, bad anatomy, bad hands, text, extra digits, and watermarks. The app uses those as the starting sampler, steps, CFG, and negative prompt. It also turns on the score tags `masterpiece, high score, great score, absurdres` and clip skip 2. Clip skip 2 is the setting in Animagine XL 4.0's own prompting guide; the sample metadata does not itself set clip skip. The size default is 832×1216. The phone lists this checkpoint as **Default**. Any other installed checkpoint can replace it.

Pony, Illustrious, and NoobAI checkpoints are SDXL-shaped files and load with the SDXL pipeline. SD 1.5 uses the SD 1.5 pipeline. Flux uses `FluxPipeline` when that diffusers build is installed; it wants a 24 GB GPU. Mock mode records those settings and does not load the weights.

`POST /models/install` with `{ "versionId": 1337429 }` registers the default model and does not fetch the single-file checkpoint. Other version ids still download their file. `GET /models` lists the cache. `POST /models/default` changes the default. `DELETE /models/{versionId}` removes one, and will not remove the last checkpoint. A Civitai token, when a file needs a logged-in download, is sent as `X-Civitai-Token` and is not written to logs.

Samplers accepted by name: Euler a, Euler, DPM++ 2M, DPM++ 2M Karras, DPM++ SDE Karras, DDIM, LMS, Heun, UniPC, LCM. Hires fix generates smaller, resizes with Lanczos, then runs img2img at the hires denoise. LoRAs arrive as `{ "name", "weight" }` from `<lora:name:weight>` tags. Each PNG gets an Automatic1111 `parameters` text chunk: prompt, negative, Steps, Sampler, CFG scale, Seed, Size, Model, Model hash, Lora hashes, Clip skip, and Hires when it was used.

The first boot downloads the diffusers folders once (about 7 GB) and then loads them into VRAM. Set the startup probe `initial_delay_seconds` to 600 so Salad waits ten minutes before the first `/ready` check, then allows about twenty more minutes of failures. A new Salad node has empty disk and downloads the folders again. `HF_HOME` and `YUME_MODEL_DIR` should stay on the container disk so the cache survives a process restart on the same node.

## Status, jobs, and diagnostics

`GET /health` stays open for probes and now includes the GPU name and whether Animagine XL 4.0 is the loaded model. `GET /ready` is still the readiness probe. `GET /stats` and `GET /diagnostics` need the same API key as `/generate`. They report GPU, VRAM, RAM, and disk when `pynvml`, `psutil`, or `nvidia-smi` is available. Mock mode says there is no GPU instead of inventing one.

`POST /jobs` starts a picture and returns an id. Poll `GET /jobs/{id}`, then `GET /jobs/{id}/result`. `POST /jobs/{id}/pause` holds a queued job. A running GPU step is stopped and must start over on `POST /jobs/{id}/resume`, because the sampler cannot freeze mid-image. `POST /jobs/{id}/cancel` drops it.
