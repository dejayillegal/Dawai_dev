# AIDAW

AIDAW is a browser-based, AI-native techno digital audio workstation built with React, TypeScript, and Vite. Its workflow integrates multi-section algorithmic composition, arrangement editing, inspection, mixer/sidechain routing, and AI-assisted proposals into a single workspace powered by the Web Audio API.

## Project status

All core DAW modules, persistence layers, synthesis voices, sidechain `AudioWorklet` DSP, multi-format exports (`.wav`, stem `.wav`, `.mid`, `.als`), Progressive Web App (PWA) support, and Capacitor Android packaging (`android/`) are implemented and verified across release gates **G0–G8**. See [implementation status](docs/IMPLEMENTATION_STATUS.md) for the complete gate ledger, Chromium 156 runtime metrics, and APK build identity.

## Requirements

- Node.js (`>=22`) and npm
- Optional for browser gate qualification (`npm run qualify:gates`): Chromium (`/usr/bin/chromium`)
- For Android APK packaging (`npm run android:build`): Java JDK 21 and Android SDK (`/opt/android-sdk` or configured via `ANDROID_HOME` / `android/local.properties`)

## Web development & verification

```sh
npm install
npm run dev
```

Build, test, and run full checks:

```sh
npm run typecheck      # tsc --noEmit
npm test               # vitest run (94 tests across 18 test files)
npm run build          # vite build (single-file production bundle)
npm run check          # runs typecheck, test, and build sequentially
npm run qualify:gates  # runs real headless Chromium CDP qualification across G0-G8
```

## Export capabilities

- **WAV Audio (`.wav`)**: 16-bit PCM, 24-bit PCM, or 32-bit IEEE float at 44.1 kHz, 48 kHz, or 96 kHz. Supports **Full Mix** or **Single Track Stem** (with pre-solo kick sidechain key preservation), configurable **Start Bar / End Bar** range, configurable **Reverb Tail** (`0s`, `2s`, `4s`, `8s`), cooperative cancellation, and independent byte-level WAV verification.
- **MIDI (`.mid`)**: Standard SMF Type 1 multi-track MIDI at 480 PPQ with tempo/time-signature meta events, GM drum channel mapping, microtiming, and single-clip export from Piano Roll or Inspect panels.
- **Ableton Live Set (`.als`)**: Gzip-compressed XML project export with arrangement sections, tracks, MIDI clips, and automation envelopes.

## Projects and recovery

The Project menu can download a validated `.aidaw.json` backup and open a saved project after confirmation. Autosave keeps checksummed current/previous snapshots and preserves original legacy data. IndexedDB (`aidaw.durable.v1`) commits each score and typed journal entry atomically, checks SHA-256 integrity, and rejects stale-window writes. LocalStorage snapshots provide synchronous fallback on page exit.

## Android packaging & GitHub Actions APK workflow

Capacitor Android scaffolding is configured in `android/` and bundles the production web assets locally:

```sh
npm run android:sync   # builds production web bundle and syncs into android/
npm run android:build  # syncs web bundle and runs ./gradlew assembleDebug
```

The debug APK is generated at `android/app/build/outputs/apk/debug/app-debug.apk` (generated APK binaries and `android/local.properties` remain gitignored per `AGENTS.md`).

### Automated GitHub Actions APK Generation (`.github/workflows/android-apk.yml`)

On every `push`, `pull_request`, or manual **Run workflow** (`workflow_dispatch`) in GitHub Actions, the **Build Android Debug APK** workflow automatically:
1. Installs Node.js 24, JDK 21 (Temurin), and the Android SDK (`android-actions/setup-android@v3`).
2. Runs `npm ci` and `npm run check` (strict TypeScript, 94 Vitest unit/integration tests, and Vite production build).
3. Runs `npm run android:build` (`npx cap sync android` + `./gradlew assembleDebug`).
4. Verifies `android/app/build/outputs/apk/debug/app-debug.apk`, computes its SHA-256 hash, posts a build summary table, and uploads the **`aidaw-debug-apk`** artifact (`app-debug.apk`, `aidaw-debug.apk`, and `app-debug.apk.sha256`) to the workflow run summary page (and attaches it to a GitHub Release when pushing a tag).

## Architecture and preservation

Keep the existing composition and audio behavior intact when changing the application: preserve the unified workspace, 8 techno style grammars and multi-section arrangement, transition atoms, per-span automation lock splicing, shared playback/export scheduling and graph, and genuine `AudioWorklet` sidechain processing.

See [AGENTS.md](AGENTS.md) for change-safety guidance and [SKILLS.md](SKILLS.md) for common repository workflows and verification expectations.
