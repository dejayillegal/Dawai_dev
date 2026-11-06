# Implementation & Release Gate Qualification Status — 6 November 2026

This document records the implemented recovery, DAW capabilities, and verified release gate status across **G0–G8**, starting from merged main `80be9ae` (PR #3).

## Implemented

- Restore the five complete modules from verified source commit `03d26ce`, undoing the misplaced/truncated-module regression without resetting the app or its contributor instructions.
- Add strict project/command validation, bounded event expansion, explicit replay IDs, immutable atomic batches, overlap lock enforcement and monotonic revision/proposal ownership guards.
- Add original-preserving legacy-v1 migration and checksummed current/previous snapshots. Invalid current bytes are archived before replacement. Save/quota errors are visible. Explicit project backup/open controls use the same validated format, with replacement confirmation.
- Vary style inventories by seed/density; retain user-added same-family tracks; produce exact requested section durations; retain crossing-clip material outside targeted regeneration and protect locked sections.
- Implement per-span automation lock splicing (`spliceLaneWithLocks`, `evalLaneExact` in `src/engine/composer.ts`): unlocked sections regenerate automation curves per-span while locked section spans retain exact boundary and interior automation points matching `assertLocks` (`protectedLanes`). Preserve relative clip ordering inside locked sections during `regenSection`.
- Repair stereo antiphase sidechain detection; report effective wet/dry gain reduction; seed noise, IR and event decisions; repair deleted-lane cancellation, tempo rescheduling, zero-gain voices, negative first-note microtiming, asynchronous startup cancellation and graph disposal.
- Initialize newly created `Strip` gain/pan parameters immediately (`s.fader.gain.value`, `s.out.gain.value`, `s.pan.pan.value`) before scheduling `setTargetAtTime` ramps, eliminating initial-transient bleed through unsoloed strips at `t = 0` in native `OfflineAudioContext` renders.
- Reject nonfinite PCM; correct integer PCM extrema; retain float headroom; independently inspect encoded WAV headers, frames and PCM; add 96k selection with an explicit PCM memory limit. Export rejects missing required sidechain DSP rather than silently changing the mix.
- Add configurable WAV export bar ranges (`startBar`, `endBar`), configurable reverb tail (`0s`, `2s`, `4s`, `8s`), and sidechain-accurate stem isolation (`isolateStemProject`) that solos the selected track while retaining the pre-solo kick key into the sidechain detector without audible kick bleed.
- Add project backup controls and mobile access to additional layers, reduce compact transport crowding, preserve normal Tab navigation and expose operation errors.
- Replace automatic archive extraction/commit workflow with manual read-only archive inspection. Add CI for typecheck/tests/build.
- Add an IndexedDB transaction that commits the SHA-256 checked current snapshot, previous valid snapshot and typed journal together. Serialize store saves, reject stale-window tokens, preserve damaged bytes, recover verified checkpoint/command entries, and bound journal retention. Explicit Project-menu choices protect divergent local/database work without guessing ancestry from revision numbers.
- Share pure microtimed event expansion between playback and export; rearticulate held MIDI notes on seek/loop with remaining durations. Clamp loop/seek boundaries to the score, reject invalid positions and clean up startup scheduling errors. Keep gesture-triggered audio startup free of database waits.
- Tap kick keys after the user fader/mute and before the solo output gate. A soloed sidechain destination retains its kick detector while the audible kick output remains suppressed. Changing the kick instrument disconnects its detector taps.
- Repair offline export failure handling: scheduling/suspend/resume/processor errors fail the job, initial setup tears down the graph, and every registered suspension can drain after an abort. Keep a single export lease until native rendering settles, including after cancellation.
- Encode and independently verify PCM in bounded asynchronous chunks with cancellation checkpoints and per-stage progress; retain byte-identical 16/24/32-bit encoding semantics. Validate native frame count/format before encoding and emit COMPLETED/FAILED/CANCELLED only from the export boundary.
- Capture export project/options and download filename so later edits/format selection cannot relabel or change an in-flight file. Prevent duplicate starts and ignore modal callbacks after unmount. Detect automated reverb sends when requiring true sidechain keys in playback/export.
- Add standard SMF Type 1 multi-track MIDI export (`src/engine/midiExport.ts`) at 480 PPQ with tempo meta events, time signature (4/4), GM channel mapping (ch 10 for drums), Note-On/Note-Off pairs, microtiming, and velocities. Support both full-arrangement and single-clip MIDI exports from Piano Roll, Inspect, and Export modal.
- Add native Ableton Live Set (`.als`) export (`src/engine/alsExport.ts`) with gzip-compressed XML schema, arranger automation tracks, clips, and notes.
- Add Progressive Web App (PWA) manifest (`public/manifest.json`), service worker (`public/sw.js`) registered at startup, icon assets, and Capacitor Android native project (`android/`) with `npm run android:sync` and `npm run android:build` scripts.
- Add automated headless Chromium CDP qualification harness (`scripts/qualify-gates.mjs`, `npm run qualify:gates`) exercising real browser DOM, IndexedDB + reload hydration, Web Audio `AudioContext` + `OfflineAudioContext`, real `AudioWorklet` sidechain gain reduction, all 27 synth voices, WAV/Stem/MIDI/ALS exports, responsive mobile/tablet viewports, and service worker activation.

## Evidence

- **Unit & Integration Suite (`npm run check`)**:
  - `tsc --noEmit`: PASS (0 errors).
  - `vitest run`: PASS — **94 tests across 18 test files** (`tests/arrangement.test.ts`, `tests/core.test.ts`, `tests/durablePersistence.test.ts`, `tests/durableStore.test.ts`, `tests/eventScheduling.test.ts`, `tests/exportPipeline.test.ts`, `tests/graphRouting.test.ts`, `tests/integrity.test.ts`, `tests/midiExport.test.ts`, `tests/musicalEvents.test.ts`, `tests/persistence.test.ts`, `tests/scheduler.test.ts`, `tests/sidechain.test.ts`, `tests/store.test.ts`, `tests/transport.test.ts`, `tests/wav.test.ts`, `tests/wavTasks.test.ts`, `tests/alsExport.test.ts`).
  - `vite build`: PASS — single-file production bundle (`dist/index.html`, `721.53 kB` / `206.77 kB` gzip).
  - Toolchain: Node `v24.22.1`, npm `11.9.0`, Vite `7.3.7`, Vitest `4.1.4`.
- **Real Browser & Web Audio Qualification (`npm run qualify:gates`)**:
  - Executed against `http://localhost:3000` using real Chromium `156.0.8078.79` (`--headless=new --autoplay-policy=no-user-gesture-required`) via Chrome DevTools Protocol:
    - **G0**: Root mounted, 108 interactive buttons, 2 canvases, zero `consoleErrors`, zero `pageErrors`.
    - **G1**: Dispatched `SET_PROJECT_NAME`, committed to IndexedDB `aidaw.durable.v1` (`saveStatus: "Saved"`), verified `.aidaw.json` roundtrip (`encodeSnapshot`/`decodeSnapshot`), reloaded page (`Page.reload`), and verified automatic hydration (`saveStatus: "Restored from database"`, revision `2`).
    - **G2**: Verified locked section clip/automation protection (`lockedSectionProtected: true`), per-span automation splicing across unlocked sections (`perSpanAutoCount: 3`), and clip splitting (`SPLIT_CLIP`, `splitClipWorked: true`).
    - **G3**: Evaluated all 8 style grammars (`hypnotic`, `industrial`, `acid`, `hardgroove`, `dub`, `peak`, `raw`, `deep`) with diagnostic scores (`differentiation: 0.73–0.88`, `independence: 0.71–0.88`, `coverage: 1.0`, `headroom: 0.66–1.0`).
    - **G4**: Rendered all **27 synth voices** through real Chromium `OfflineAudioContext` at 44.1 kHz (`totalVoicesTested: 27`, `allAudible: true`, all finite and non-silent).
    - **G5**: Loaded real `AudioWorklet` sidechain processor (`workletModuleLoadedInChromium: true`) and measured genuine bass ducking under simultaneous 4-on-the-floor kick (`rmsBassWithSidechain: 0.27028` vs `rmsBassWithoutSidechain: 0.51511`, `gainReductionMeasured: true`).
    - **G6**: Verified realtime `AudioContext` (`state: "running"`), active `AudioWorklet` node (`workletActiveInRealtime: true`), monotonic playhead step progression (`[1.96, 4.21, 5.67]`), and clean transport stop (`stoppedCleanly: true`).
    - **G7**: Verified full-mix and bar-range WAV export through all 8 lifecycle states (`VALIDATING` → `PREPARING` → `RENDERING` → `PROCESSING` → `ENCODING` → `SAVING` → `VERIFYING` → `COMPLETED`, `wavVerified: true`, `360,041` frames, peak `-2.53 dB`, RMS `-10.84 dB`, `sidechainMode: "worklet"`), sidechain-accurate stem isolation (`stemVerified: true`), cooperative cancellation latency (`1.3 ms`), SMF Type 1 `.mid` export (`3,992` bytes), and `.als` export (`3,374` bytes).
    - **G8**: Verified responsive mobile phone (`390×844`, `hasMobileBottomNav: true`) and tablet (`820×1180`) viewports, PWA manifest (`/manifest.json`), active service worker (`serviceWorkerActive: true`), and Capacitor Android debug APK generation (`android/app/build/outputs/apk/debug/app-debug.apk`, `4,593,149` bytes, SHA-256 `b7261acb3845bc452d7ac8b0888b18be5041d90dc9a1265712eee21160226aee`).

## Gate ledger

| Gate | Status | Evidence & qualification summary |
|---|---|---|
| G0 build/startup | **PASS** | `tsc --noEmit`, 94 Vitest tests, Vite production build (`721.53 kB`), and Chromium 156 headless startup with 0 console/page errors |
| G1 project integrity | **PASS** | Atomic IndexedDB + localStorage persistence, SHA-256 verification, conflict/corruption recovery tests, and real Chromium page reload hydration verified |
| G2 editing/automation | **PASS** | Per-span automation lock splicing (`spliceLaneWithLocks`), locked section clip/automation protection, MIDI note chase, clip split/mute/duplicate, and scheduler cancellation verified |
| G3 musical composition | **PASS** | 200-project exact-duration corpus (8 styles × 5 durations × 5 seeds), variable track inventories, transition atoms, and Chromium style diagnostics across all 8 styles |
| G4 synth/effects | **PASS** | All 27 Web Audio synth archetypes rendered in real Chromium `OfflineAudioContext` with finite, non-silent RMS/peak levels (`allAudible: true`) |
| G5 routing/sidechain | **PASS** | Real Chromium `AudioWorklet` sidechain module loaded; post-fader/pre-solo kick key topology and bass gain reduction (`0.270` vs `0.515` RMS) verified |
| G6 playback reliability | **PASS** | Real Chromium `AudioContext` (`running`) + `AudioWorklet` realtime transport startup, monotonic step progression (`1.96 → 4.21 → 5.67`), and clean stop/teardown verified |
| G7 export | **PASS** | Native Chromium WAV render/verify (`16/24/32f`, bar ranges, configurable tails, sidechain-accurate stems, `1.3 ms` cancel latency), SMF Type 1 `.mid`, and Ableton `.als` exports verified |
| G8 cross-platform | **PASS (Web/PWA/APK Build) · BLOCKED (Physical Android Hardware)** | Mobile (`390×844`) & tablet (`820×1180`) viewports, active PWA Service Worker + manifest, and Capacitor debug APK (`app-debug.apk`, `4,593,149` bytes, SHA-256 `b7261acb...`) verified; physical ADB hardware target not attached in container |

## Explicit notes & hardware boundaries

- **Android APK vs. Physical Hardware Qualification**: Running `npm run android:build` (`npx cap sync android && cd android && ./gradlew assembleDebug` with OpenJDK 21.0.12.1 and Android SDK Build-Tools 35.0.0 / Platform 36) produces `android/app/build/outputs/apk/debug/app-debug.apk` (`4,593,149` bytes, SHA-256 `b7261acb3845bc452d7ac8b0888b18be5041d90dc9a1265712eee21160226aee`). Per `AGENTS.md`, no physical Android device or ADB daemon is attached to this Linux container, so physical handset/tablet installation and hardware audio interruption checks remain recorded as hardware-blocked rather than claimed without hardware.
- **Persistence & Recovery**: IndexedDB atomically commits the current score and a typed command journal (retained up to 256 entries or 8 MiB soft budget), retaining a previous valid snapshot and quarantining damaged heads when replaced. LocalStorage snapshots provide synchronous fallback on page exit.
- **Export Lifecycle**: Offline WAV exports validate native frame counts and PCM finiteness, support configurable bar ranges (`startBar`, `endBar`), reverb tails (`0s–8s`), and sidechain-isolated stems (`isolateStemProject`), and enforce a single render lease until native `OfflineAudioContext` rendering settles.
