# Yume

Yume is a phone app for drawing anime images in the style of a Civitai / Automatic1111 generator. The main screen is the prompt, the negative prompt, the checkpoint, LoRAs, the sampler, steps, CFG, seed, clip skip, and size. It browses the public Civitai API, installs a version onto your Salad container, and writes Automatic1111 `parameters` into each PNG so Civitai can read the resources back. Characters, turnarounds, and the 3D sheet are still there, off the main screen.

The starting checkpoint is Animagine XL 4.0 v4.0 (Civitai version `1337429`). See [server/DEPLOY.md](server/DEPLOY.md) for the license fields and the download.

Version 1.3.0 adds a first-launch wizard (Salad, phone only, or demo), a Connect screen, server start/stop/delete, and an idle auto-stop. A setup link is `yume://setup?url=...` and never includes the API key.

Version 1.2.0 adds a home status row for the Salad server, an in-app APK update (`npm run release` writes `releases/latest.json` and the checksum; you host the APK and paste that URL into Settings), a cloud checklist, a problem report with secrets removed, and a queue that survives leaving the app. Phone mode is aimed at a Galaxy S25 Ultra (512×768, 8 steps, Hexagon NPU when the Qualcomm runtime is present). This build does not ship Qualcomm’s QNN SDK and will not pretend a preview is an on-device diffusion result. Expo’s JS update service is not used, because it needs their signed update server.

Drawings can come from three places. Demo studio paints a preview on the phone. OpenAI (`gpt-image-1` or `dall-e-3`) uses a key you store on the device. SaladCloud runs an open-source anime model (Animagine XL 4.0) in a container you deploy. See [server/DEPLOY.md](server/DEPLOY.md).

## Run it on your phone with Expo Go

1. Install [Expo Go](https://expo.dev/go) from the App Store or Google Play.
2. Install dependencies and start the dev server:

   ```bash
   npm install
   npm start
   ```

3. Scan the QR code.
   - **Android:** open Expo Go and scan the code.
   - **iPhone:** scan with the Camera app, then open the project in Expo Go.
4. Keep the phone on the same Wi-Fi network as the computer. If the phone cannot reach your machine, start a tunnel instead:

   ```bash
   npx expo start --tunnel
   ```

The app uses only libraries that ship with Expo Go, so you do not need a custom dev client for day-to-day use.

Demo studio is on the first time you open Yume. Draw a frame, build a character, and look through History without an API key. The images in that mode are generated on the phone. They are a stand-in so the rest of the app is usable, not a substitute for the model.

## Use your own OpenAI key

1. Create a key at [platform.openai.com](https://platform.openai.com/api-keys). Image generation has to be available on that account.
2. In the app, open **Settings**, paste the key, and save it.
3. Saving a key turns Demo studio off. Turn the switch back on any time you want the on-device preview instead.

The key is stored with [`expo-secure-store`](https://docs.expo.dev/versions/latest/sdk/securestore/) (the iOS keychain and Android Keystore). Yume reads it only when you press Draw, and the app calls `https://api.openai.com/v1/images/generations` directly from the phone. The key is not written to logs. A browser preview of this project has no phone keychain, and OpenAI blocks browser calls, so real generations happen in Expo Go or in an installed build.

`gpt-image-1` sizes are 1024×1024, 1024×1536, and 1536×1024. `dall-e-3` uses 1024×1024, 1024×1792, and 1792×1024. Yume requests one image at a time, up to four.

If OpenAI refuses the call, the message says which kind of problem it was: missing key, rejected key, content policy, rate limit, or an account with no image credits left.

## What gets sent

Style names on screen are for you. The prompt that leaves the phone is built from generic art wording plus your sentence and the character's traits. The character's name stays on the device. The watercolor preset is labeled Ghibli-inspired in the interface, and that name is not added to the API prompt.

History (prompt, style, and image files) and saved characters stay on the phone. Clear History deletes those frames. Removing a character does not delete drawings you already made.

Saving a frame asks for permission to add photos, then writes it to the photo library. Share opens the system share sheet.

## Checks

```bash
npm run typecheck
npm run check
```

`npm run check` typechecks, runs the prompt and generation tests, and runs the Salad API tests in mock mode.

## Civitai generator

Models is the browser. Filter by checkpoint, LoRA, LyCORIS, embedding, or VAE, and by base model (SD 1.5, SDXL, Pony, Illustrious, NoobAI, Flux). NSFW results stay off until you turn them on. A model page shows previews, trigger words, and the settings from its sample image. Install stores it in the phone's list in demo mode, or asks Salad to download `https://civitai.com/api/download/models/{versionId}`.

Prompt text can use `(word:1.2)`, `[word]`, `<lora:name:0.8>`, `BREAK`, and embedding names. Import takes a parameters block, a Civitai image URL or id, or a PNG that already has the parameters chunk, and fills the generator. Missing resources are listed so you can install them.

Demo mode still draws on the phone. The PNG metadata is real. The weights are not.

## Prompts, styles, and remix

The box at the top is your draft. **Enhance prompt** adds the selected style, the character sheet, and the frame. Turn it off for raw mode: the preview is your text. **Expand snippets** replaces `{hair_color}` and the other tokens with a word from the library. The preview under Advanced is what actually gets sent, and you can edit it before Draw. Reset rebuilds it.

Negative prompt, seed, steps, CFG, sampler, size, checkpoint, and LoRAs are on that same Advanced panel. Salad receives all of them. OpenAI uses the prompt and the closest frame size it supports. Demo studio uses the prompt and stores the other settings so Remix can bring them back.

Styles are editable. Built-ins are templates: change the prefix, suffix, and negative, duplicate them, reorder them, or delete them. Snippets and saved prompt templates live on the snippets screen. Export JSON copies the whole library; Merge and Replace read a pasted file.

History has **Remix**. It reopens that drawing with the exact prompt, negative, seed, size, and sampler.

## Character turnaround

On Cast, open **Turnaround** for a saved character. Yume draws front, three-quarter, side, three-quarter back, and back, plus an optional face close-up. Swipe the viewer or tap an angle. **Save the turnaround sheet** writes every angle into one image.

Every angle uses the same seed and the same character description, with a different angle sentence. On Salad, the front view is sent back as `reference_image` so the other angles are img2img (or IP-Adapter if the server has `YUME_IP_ADAPTER=1`). On OpenAI, `gpt-image-1` edits the front view; `dall-e-3` cannot edit, so those angles are new pictures and the screen says so. Demo studio keeps the seed and the traits. It does not copy pixels, and the screen says that too.

**Fix in plain words** takes a sentence such as "make her hair longer" or "jacket should be red", updates the saved character, and redraws one angle or all of them. Earlier versions stay. Undo puts the previous sheet and the previous traits back. Compare shows before and after for the angle you are looking at.

**Expression sheet** draws happy, angry, sad, surprised, sleepy, and determined with that same character and seed.

## 3D sheet

**Make 3D** on a character builds a textured `.glb`. Drag to rotate, pinch or use the zoom buttons, and leave auto-spin on. **Share the .glb** exports the file. **Save 3D turnaround sheet** takes front, side, and back pictures of that mesh and saves one image.

Demo studio does not run a 3D model. It builds a simple colored figure from the hair, eyes, and outfit so the viewer, the export, and the sheet still work. The screen says so. On Salad, the mesh is a second container running Microsoft TRELLIS (MIT for the model and most of the code) from the front view only. Hair, fingers, and thin clothes often need cleanup. See [server/DEPLOY.md](server/DEPLOY.md).

## SaladCloud

Step-by-step deploy notes, GPU class, probes, and cost figures are in [server/DEPLOY.md](server/DEPLOY.md). Short version: build the image in `server/`, push it, create a container group with Container Gateway auth on port 8080, set `YUME_API_KEY`, and paste the gateway URL plus that key into Settings. This repository does not deploy anything for you.

## Installable Android APK (no Expo account)

The release APK is a normal sideload file. It bundles the JavaScript, so the phone does not need Metro, a dev server, or Expo Go. Secure Store, saving to photos, and sharing are the same native modules as in Expo Go. Nothing in the app asks for an Expo account.

You need JDK 17 and an Android SDK with:

- `platforms;android-37.0` (also symlinked as `platforms/android-37`, which is the folder Gradle looks up for compileSdk 37)
- `build-tools;37.0.0`
- `ndk;27.1.12297006`
- `cmake;3.22.1`
- `platform-tools`

Then:

```bash
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export ANDROID_HOME=$HOME/android-sdk
npm install
npm run build:apk
```

The APK is written to `dist/yume-1.0.0.apk`. Copy it to the phone and install it. Android will warn that it is from outside the Play Store.

The first run creates `android/app/yume-release.keystore` and `android/keystore.properties`. Both are gitignored. The properties file holds the passwords. To regenerate the key, delete those two files and run `npm run build:apk` again. A new key is a different signature, so a phone that already has Yume installed must uninstall it before the new APK will install.

`.github/workflows/android-apk.yml` is the same build on GitHub Actions, with no Expo token. Each CI run creates its own keystore unless you cache `android/app/yume-release.keystore` and `android/keystore.properties` yourself.

iOS cannot be built here. It needs a Mac and an Apple Developer account.
