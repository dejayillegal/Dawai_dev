import { spawn } from 'node:child_process';
import fs from 'node:fs';

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runBrowserQualification() {
  const userDataDir = `/tmp/chromium-aidaw-${Date.now()}`;
  fs.mkdirSync(userDataDir, { recursive: true });

  const chrome = spawn(
    '/usr/bin/chromium',
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required',
      `--user-data-dir=${userDataDir}`,
      '--remote-debugging-port=9222',
      '--window-size=1440,900',
      'http://localhost:3000',
    ],
    { stdio: 'ignore' }
  );

  try {
    let targets = null;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch('http://127.0.0.1:9222/json');
        if (res.ok) {
          const list = await res.json();
          const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:3000'));
          if (page && page.webSocketDebuggerUrl) {
            targets = page;
            break;
          }
        }
      } catch {
        // wait
      }
      await sleep(250);
    }

    if (!targets) {
      throw new Error('Could not connect to Chromium DevTools target');
    }

    const ws = new WebSocket(targets.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    let msgId = 1;
    const pending = new Map();
    const consoleErrors = [];
    const pageErrors = [];

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.id && pending.has(data.id)) {
        const { resolve, reject } = pending.get(data.id);
        pending.delete(data.id);
        if (data.error) reject(new Error(data.error.message));
        else resolve(data.result);
      } else if (data.method === 'Runtime.exceptionThrown') {
        pageErrors.push(data.params?.exceptionDetails?.text || 'Exception');
      } else if (data.method === 'Runtime.consoleAPICalled' && data.params?.type === 'error') {
        consoleErrors.push(data.params.args.map((a) => a.value ?? a.description).join(' '));
      }
    };

    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = msgId++;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });

    await send('Runtime.enable');
    await send('Page.enable');
    await sleep(1500);

    const evaluate = async (expression) => {
      const res = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (res.exceptionDetails) {
        throw new Error(
          res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'Eval failed'
        );
      }
      return res.result.value;
    };

    const report = {};

    // G0: Build & Runtime Startup
    report.G0 = await evaluate(`(async () => {
      const root = document.getElementById('root');
      const text = document.body.innerText;
      const buttons = Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim()).filter(Boolean);
      const canvases = document.querySelectorAll('canvas').length;
      return {
        title: document.title,
        rootMounted: !!root && root.children.length > 0,
        hasPlayButton: buttons.some(b => b.includes('PLAY') || b.includes('Play') || b.includes('▶')),
        hasExportButton: buttons.some(b => b.includes('Export')),
        buttonCount: buttons.length,
        canvasCount: canvases,
        textSample: text.slice(0, 180).replace(/\\n+/g, ' ')
      };
    })()`);

    // G1: Project Integrity & Real IndexedDB Persistence
    report.G1 = await evaluate(`(async () => {
      const store = window.__AIDAW_STORE__;
      const { encodeSnapshot, decodeSnapshot } = await import('/src/engine/persistence.ts');
      await store.whenSaved();
      const initial = store.get().project;
      const testName = 'Chromium Qualified Techno ' + Date.now();
      store.dispatch({ type: 'SET_NAME', name: testName }, 'Rename in Chromium');
      store.flushSave();
      await store.whenSaved();
      const afterRename = store.get().project;

      // Verify IndexedDB databases
      const dbs = await indexedDB.databases();
      const jsonBackup = encodeSnapshot(afterRename);
      const restored = decodeSnapshot(jsonBackup);

      return {
        initialRev: initial.revision,
        updatedRev: afterRename.revision,
        namePersisted: afterRename.name === testName,
        indexedDbNames: dbs.map(d => d.name),
        backupRoundtripMatch: restored.name === testName && restored.id === afterRename.id,
        saveStatus: store.get().saveStatus,
        saveError: store.get().error || null
      };
    })()`);

    // Reload page in Chromium to verify real IndexedDB hydration across browser sessions
    await send('Page.reload');
    await sleep(1500);
    const hydrationCheck = await evaluate(`(async () => {
      const store = window.__AIDAW_STORE__;
      await store.whenSaved();
      const p = store.get().project;
      return { hydratedName: p.name, revision: p.revision, saveStatus: store.get().saveStatus };
    })()`);
    report.G1.hydratedAfterReload = hydrationCheck;

    // G2: Editing, Locks, Per-Span Automation & MIDI Chase
    report.G2 = await evaluate(`(async () => {
      const store = window.__AIDAW_STORE__;
      const { regenSection } = await import('/src/engine/composer.ts');
      const { uid } = await import('/src/engine/theory.ts');
      await store.whenSaved();
      const p0 = store.get().project;
      const sec1 = p0.sections[1];
      const sec2 = p0.sections[2];
      store.dispatch({ type: 'SET_SECTION', id: sec2.id, patch: { lock: true } }, 'Lock sec2');
      const pLocked = store.get().project;
      const regenPatch = regenSection(pLocked, sec1.id);
      store.dispatch({ type: 'PATCH', patch: regenPatch }, 'Regen unlocked sec1 with sec2 locked');
      const pAfterRegen = store.get().project;

      // Unlock sec2
      store.dispatch({ type: 'SET_SECTION', id: sec2.id, patch: { lock: false } }, 'Unlock sec2');

      // Select first clip with len >= 4 and split at midpoint
      const firstTrack = store.get().project.tracks.find(t => t.clips.some(c => c.len >= 4));
      const targetClip = firstTrack.clips.find(c => c.len >= 4);
      const clipsBefore = firstTrack.clips.length;
      store.dispatch({ type: 'SPLIT_CLIP', id: targetClip.id, at: targetClip.start + 2, rightId: uid('clip') }, 'Split clip');
      const clipsAfter = store.get().project.tracks.find(t => t.id === firstTrack.id).clips.length;

      return {
        lockedSectionProtected: JSON.stringify(pLocked.sections[2]) === JSON.stringify(pAfterRegen.sections[2]),
        perSpanAutoCount: pAfterRegen.auto.length,
        splitClipWorked: clipsAfter === clipsBefore + 1
      };
    })()`);

    // G3: Musical Composition & Diagnostics across all 8 styles
    report.G3 = await evaluate(`(async () => {
      const { STYLES } = await import('/src/engine/styles.ts');
      const { newProject, defaultParams } = await import('/src/engine/composer.ts');
      const { diagnose } = await import('/src/engine/diagnostics.ts');
      const styleMetrics = {};
      for (const style of Object.keys(STYLES)) {
        const p = newProject(defaultParams(style, 2026));
        const d = diagnose(p);
        styleMetrics[style] = {
          tracks: p.tracks.length,
          sections: p.sections.length,
          differentiation: +d.differentiation.toFixed(2),
          independence: +d.independence.toFixed(2),
          coverage: +d.coverage.toFixed(2),
          headroom: +d.headroom.toFixed(2)
        };
      }
      return { stylesEvaluated: Object.keys(styleMetrics).length, styleMetrics };
    })()`);

    // G4: Synth & Effects — Render all 27 SynthKind voices in real Chromium OfflineAudioContext
    report.G4 = await evaluate(`(async () => {
      const { playVoice, makeNoise } = await import('/src/engine/voices.ts');
      const { Rng } = await import('/src/engine/theory.ts');
      const kinds = [
        'kick','sub','rumble','midbass','hat','ohat','ride','shaker','clap','snare',
        'perc','conga','tom','clang','acid','stab','lead','arp','pad','dubchord',
        'drone','noise','crackle','riser','impact','downlift','crash'
      ];
      const results = {};
      for (const kind of kinds) {
        const sr = 44100;
        const ctx = new OfflineAudioContext(2, sr * 1, sr);
        const rng = new Rng(42);
        const env = {
          ctx,
          noise: makeNoise(ctx, 42),
          dirt: 0.3,
          stepDur: 0.125,
          random: () => rng.next(),
          sources: new Set(),
          onStart() {},
          onEnd() {}
        };
        const cutoff = ctx.createConstantSource(); cutoff.offset.value = 0; cutoff.start();
        const res = ctx.createConstantSource(); res.offset.value = 0; res.start();
        playVoice(kind, env, ctx.destination, 0.01, 0.4, { t: 0, d: 4, p: kind === 'crash' ? 60 : 48, v: 0.9, acc: true }, { cutoff, res });
        const buf = await ctx.startRendering();
        const ch0 = buf.getChannelData(0);
        let peak = 0, sumSq = 0, finite = true;
        for (let i = 0; i < ch0.length; i++) {
          const s = ch0[i];
          if (!Number.isFinite(s)) { finite = false; break; }
          const a = Math.abs(s);
          if (a > peak) peak = a;
          sumSq += s * s;
        }
        const rms = Math.sqrt(sumSq / ch0.length);
        results[kind] = { finite, peak: +peak.toFixed(4), rms: +rms.toFixed(4), audible: peak > 0.005 && rms > 0.0001 };
      }
      const allAudible = Object.values(results).every(r => r.finite && r.audible);
      return { totalVoicesTested: kinds.length, allAudible, sampleVoices: { kick: results.kick, acid: results.acid, pad: results.pad, clap: results.clap } };
    })()`);

    // G5: Routing & Sidechain DSP in Real Chromium AudioWorklet + OfflineAudioContext
    report.G5 = await evaluate(`(async () => {
      const { Graph, Scheduler } = await import('/src/engine/audio.ts');
      const { SC_WORKLET_SRC } = await import('/src/engine/worklet.ts');
      const { newProject, defaultParams, mkClip } = await import('/src/engine/composer.ts');
      const p = newProject({ ...defaultParams('hypnotic', 77), bars: 12 });
      const sr = 44100;

      // Ensure both kick and bass have active notes in bar 0 (steps 0..16)
      const kickTrack = p.tracks.find(t => t.synth === 'kick');
      const bassTrack = p.tracks.find(t => t.sc === 'bass');
      kickTrack.clips = [mkClip(0, 2, 16, [{ t: 0, d: 1, p: 36, v: 1 }, { t: 4, d: 1, p: 36, v: 1 }, { t: 8, d: 1, p: 36, v: 1 }, { t: 12, d: 1, p: 36, v: 1 }], 'Kick')];
      bassTrack.clips = [mkClip(0, 2, 16, [{ t: 0, d: 16, p: 36, v: 0.9 }], 'Sustained Sub')];

      const runWithSc = async (scOn) => {
        const c = new OfflineAudioContext(2, sr * 2, sr);
        const u = URL.createObjectURL(new Blob([SC_WORKLET_SRC], { type: 'application/javascript' }));
        await c.audioWorklet.addModule(u);
        URL.revokeObjectURL(u);
        const proj = structuredClone(p);
        proj.scOn = scOn;
        // Solo the bass track so kick is only a sidechain key input (audible kick output suppressed!)
        proj.tracks.forEach(t => { t.solo = t.id === bassTrack.id; t.mute = false; });
        const g = new Graph(c, true, undefined, false, 77);
        const sched = new Scheduler(g);
        g.sync(proj);
        sched.scheduleWindow(proj, 0, 16, s => s * 0.11, false, 16);
        const b = await c.startRendering();
        g.kill();
        const d = b.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
        return Math.sqrt(sum / d.length);
      };

      const rmsScOn = await runWithSc(true);
      const rmsScOff = await runWithSc(false);

      return {
        workletModuleLoadedInChromium: true,
        rmsBassWithSidechain: +rmsScOn.toFixed(5),
        rmsBassWithoutSidechain: +rmsScOff.toFixed(5),
        gainReductionMeasured: rmsScOn < rmsScOff && rmsScOn > 0
      };
    })()`);

    // G6: Playback Reliability & Realtime Engine Lifecycle in Chromium
    report.G6 = await evaluate(`(async () => {
      const store = window.__AIDAW_STORE__;
      const engine = store.engine;
      await engine.play(0);
      await new Promise(r => setTimeout(r, 350));
      const stateDuringPlay = engine.state;
      const playingFlag = engine.playing;
      const step1 = engine.getStep();
      const workletOk = engine.workletOk;
      await new Promise(r => setTimeout(r, 250));
      const step2 = engine.getStep();
      // Live tempo adjustment while playing
      store.dispatch({ type: 'SET_PARAMS', patch: { bpm: 138 } }, 'Tempo change live');
      await new Promise(r => setTimeout(r, 150));
      const step3 = engine.getStep();
      store.stop();
      const stateAfterStop = engine.playing;
      return {
        audioContextState: stateDuringPlay,
        playingStarted: playingFlag,
        workletActiveInRealtime: workletOk,
        stepProgression: [+step1.toFixed(2), +step2.toFixed(2), +step3.toFixed(2)],
        advancedMonotonically: step2 > step1 && step3 > step2,
        stoppedCleanly: stateAfterStop === false && engine.graph === null
      };
    })()`);

    // G7: Export — Native Chromium WAV Render (Range + Stem), Cancellation Latency, MIDI & ALS
    report.G7 = await evaluate(`(async () => {
      const { renderWav, isolateStemProject } = await import('/src/engine/audio.ts');
      const { exportProjectToMidi } = await import('/src/engine/midiExport.ts');
      const { exportProjectToAls } = await import('/src/engine/alsExport.ts');
      const { newProject, defaultParams } = await import('/src/engine/composer.ts');

      const p = newProject({ ...defaultParams('peak', 909), bars: 16 });
      const states = [];
      const wavRes = await renderWav(p, {
        sampleRate: 44100,
        bits: 24,
        startBar: 0,
        endBar: 4,
        tailSec: 1,
        cancelled: () => false,
        onState: (s) => { if (!states.includes(s)) states.push(s); }
      });

      // Stem render test
      const kickTrack = p.tracks.find(t => t.synth === 'kick');
      const stemProj = isolateStemProject(p, kickTrack.id);
      const stemRes = await renderWav(stemProj, {
        sampleRate: 44100,
        bits: 16,
        startBar: 0,
        endBar: 2,
        tailSec: 0,
        cancelled: () => false,
        onState: () => {}
      });

      // Cancellation latency test
      let cancelFlag = false;
      let cancelRequestedAt = 0;
      let cancelSettledAt = 0;
      try {
        await renderWav(p, {
          sampleRate: 44100,
          bits: 16,
          startBar: 0,
          endBar: 16,
          tailSec: 2,
          cancelled: () => cancelFlag,
          onState: (s, prog) => {
            if (s === 'RENDERING' && prog > 0 && !cancelFlag) {
              cancelFlag = true;
              cancelRequestedAt = performance.now();
            }
          }
        });
      } catch (e) {
        cancelSettledAt = performance.now();
      }

      const midiBlob = exportProjectToMidi(p);
      const alsBlob = await exportProjectToAls(p);

      return {
        wavVerified: wavRes.frames === wavRes.expectedFrames && wavRes.blob.size > 44,
        wavFrames: wavRes.frames,
        wavPeakDb: +wavRes.peakDb.toFixed(2),
        wavRmsDb: +wavRes.rmsDb.toFixed(2),
        wavSidechainMode: wavRes.sc,
        statesObserved: states,
        stemVerified: stemRes.frames === stemRes.expectedFrames && stemRes.blob.size > 44,
        cancelLatencyMs: +(cancelSettledAt - cancelRequestedAt).toFixed(2),
        midiBytes: midiBlob.size,
        alsBytes: alsBlob.size
      };
    })()`);

    // G8: Cross-Platform — Responsive Mobile/Tablet Viewports & PWA Service Worker in Chromium
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
    });
    await sleep(500);
    const mobileCheck = await evaluate(`(async () => {
      const buttons = Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim());
      const manifestLink = document.querySelector('link[rel="manifest"]')?.getAttribute('href');
      const swSupported = 'serviceWorker' in navigator;
      const reg = swSupported ? await navigator.serviceWorker.getRegistration() : null;
      return {
        viewport: [window.innerWidth, window.innerHeight],
        hasMobileBottomNav: buttons.includes('Compose') && buttons.includes('Layers') && buttons.includes('Inspect'),
        manifestHref: manifestLink,
        serviceWorkerActive: !!reg
      };
    })()`);

    await send('Emulation.setDeviceMetricsOverride', {
      width: 820,
      height: 1180,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await sleep(400);
    const tabletCheck = await evaluate(`(async () => ({
      viewport: [window.innerWidth, window.innerHeight],
      canvasCount: document.querySelectorAll('canvas').length
    }))()`);

    report.G8 = {
      mobilePhone: mobileCheck,
      tablet: tabletCheck,
      apkExists: fs.existsSync('/app/applet/android/app/build/outputs/apk/debug/app-debug.apk'),
      apkSizeBytes: fs.existsSync('/app/applet/android/app/build/outputs/apk/debug/app-debug.apk')
        ? fs.statSync('/app/applet/android/app/build/outputs/apk/debug/app-debug.apk').size
        : 0,
    };

    report.browserErrors = { consoleErrors, pageErrors };

    console.log(JSON.stringify(report, null, 2));
    ws.close();
  } catch (innerErr) {
    console.error('Inner qualification error:', innerErr);
    throw innerErr;
  } finally {
    chrome.kill('SIGKILL');
    await sleep(300);
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup race
    }
  }
}

runBrowserQualification().catch((err) => {
  console.error('Qualification failed:', err);
  process.exit(1);
});
