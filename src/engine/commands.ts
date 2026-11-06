import type { AutoLane, AutoPoint, Clip, Note, Project, ScCfg, ScGroup, Section, Track } from './types';
import { assertProject, assertLocks } from './validation';
import { clamp } from './theory';

export type Source = 'user' | 'ai' | 'composer';

export type Command =
  | { type: 'BATCH'; cmds: Command[] }
  | { type: 'SET_PARAMS'; patch: Partial<Project['params']> }
  | { type: 'SET_NAME'; name: string }
  | { type: 'SET_TRACK'; id: string; patch: Partial<Omit<Track, 'clips' | 'id'>> }
  | { type: 'ADD_TRACK'; track: Track }
  | { type: 'SET_SECTION'; id: string; patch: Partial<Omit<Section, 'id'>> }
  | { type: 'SET_OVERRIDE'; key: string; value: number | null }
  | { type: 'SET_CLIP'; id: string; patch: Partial<Omit<Clip, 'id'>> }
  | { type: 'ADD_CLIP'; track: string; clip: Clip }
  | { type: 'DEL_CLIP'; id: string }
  | { type: 'SPLIT_CLIP'; id: string; at: number; rightId: string }
  | { type: 'DUP_CLIP'; id: string; copyId: string }
  | { type: 'SET_NOTES'; clip: string; notes: Note[] }
  | { type: 'SET_SC'; group: ScGroup; patch: Partial<ScCfg> }
  | { type: 'SET_SC_ON'; on: boolean }
  | { type: 'SET_AUTO'; lane: AutoLane }
  | { type: 'SET_AUTO_PTS'; id: string; pts: AutoPoint[] }
  | { type: 'DEL_AUTO'; id: string }
  | { type: 'SET_LOOP'; loop: Project['loop'] }
  | { type: 'PATCH'; patch: Partial<Pick<Project, 'tracks' | 'auto' | 'sections' | 'sc' | 'scOn' | 'secSeed' | 'overrides' | 'formId' | 'params'>> };

const clonePts = (pts: AutoPoint[]): AutoPoint[] =>
  pts.map((pt) => (pt.curve !== undefined ? { bar: pt.bar, v: pt.v, curve: pt.curve } : { bar: pt.bar, v: pt.v }));

const cloneLane = (lane: AutoLane): AutoLane => ({
  ...lane,
  pts: clonePts(lane.pts),
});

const mapClips = (p: Project, f: (c: Clip, t: Track) => Clip | Clip[] | null): Project => ({
  ...p,
  tracks: p.tracks.map((t) => {
    let changed = false;
    const clips: Clip[] = [];
    for (const c of t.clips) {
      const r = f(c, t);
      if (r === c) { clips.push(c); continue; }
      changed = true;
      if (r === null) continue;
      if (Array.isArray(r)) clips.push(...r); else clips.push(r);
    }
    return changed ? { ...t, clips } : t;
  }),
});

function reduceCommand(p: Project, c: Command): Project {
  switch (c.type) {
    case 'BATCH': return c.cmds.reduce(reduceChecked, p);
    case 'SET_PARAMS': return { ...p, params: { ...p.params, ...c.patch } };
    case 'SET_NAME': return { ...p, name: c.name };
    case 'SET_TRACK': {
      const prevTrack = p.tracks.find((t) => t.id === c.id);
      const tracks = p.tracks.map((t) => (t.id === c.id ? { ...t, ...c.patch } : t));
      let auto = p.auto;
      const hasLockedSec = p.sections.some((s) => s.lock);
      if (prevTrack && !prevTrack.lock && !hasLockedSec && (c.patch.cutoff !== undefined || c.patch.res !== undefined)) {
        const cutDelta = c.patch.cutoff !== undefined ? c.patch.cutoff - prevTrack.cutoff : 0;
        const resDelta = c.patch.res !== undefined ? c.patch.res - prevTrack.res : 0;
        if (Math.abs(cutDelta) > 1e-6 || Math.abs(resDelta) > 1e-6) {
          auto = p.auto.map((lane) => {
            if (lane.track !== c.id) return lane;
            if (lane.param === 'cutoff' && Math.abs(cutDelta) > 1e-6) {
              return { ...lane, pts: lane.pts.map((pt) => ({ ...pt, v: +clamp(pt.v + cutDelta, 0, 1).toFixed(3) })) };
            }
            if (lane.param === 'res' && Math.abs(resDelta) > 1e-6) {
              return { ...lane, pts: lane.pts.map((pt) => ({ ...pt, v: +clamp(pt.v + resDelta, 0, 1).toFixed(3) })) };
            }
            return lane;
          });
        }
      }
      return { ...p, tracks, auto };
    }
    case 'ADD_TRACK': return { ...p, tracks: [...p.tracks, c.track] };
    case 'SET_SECTION': return { ...p, sections: p.sections.map((s) => (s.id === c.id ? { ...s, ...c.patch } : s)) };
    case 'SET_OVERRIDE': {
      const o = { ...p.overrides };
      if (c.value === null) delete o[c.key]; else o[c.key] = c.value;
      return { ...p, overrides: o };
    }
    case 'SET_CLIP': return mapClips(p, (cl) => (cl.id === c.id ? { ...cl, ...c.patch } : cl));
    case 'ADD_CLIP': return { ...p, tracks: p.tracks.map((t) => (t.id === c.track ? { ...t, clips: [...t.clips, c.clip] } : t)) };
    case 'DEL_CLIP': return mapClips(p, (cl) => (cl.id === c.id ? null : cl));
    case 'SPLIT_CLIP':
      return mapClips(p, (cl) => {
        if (cl.id !== c.id || c.at <= cl.start + 1e-6 || c.at >= cl.start + cl.len - 1e-6) return cl;
        const right: Clip = { ...cl, id: c.rightId, start: c.at, len: cl.start + cl.len - c.at, off: (((cl.off + (c.at - cl.start) * 16) % cl.loop) + cl.loop) % cl.loop };
        return [{ ...cl, len: c.at - cl.start }, right];
      });
    case 'DUP_CLIP':
      return mapClips(p, (cl) => (cl.id === c.id ? [cl, { ...cl, id: c.copyId, start: cl.start + cl.len, label: cl.label }] : cl));
    case 'SET_NOTES': return mapClips(p, (cl) => (cl.id === c.clip ? { ...cl, notes: c.notes } : cl));
    case 'SET_SC': return { ...p, sc: { ...p.sc, [c.group]: { ...p.sc[c.group], ...c.patch } } };
    case 'SET_SC_ON': return { ...p, scOn: c.on };
    case 'SET_AUTO': {
      const nextLane = cloneLane(c.lane);
      const exists = p.auto.some((a) => a.id === nextLane.id);
      return {
        ...p,
        auto: exists ? p.auto.map((a) => (a.id === nextLane.id ? nextLane : cloneLane(a))) : [...p.auto.map(cloneLane), nextLane],
      };
    }
    case 'SET_AUTO_PTS': {
      const nextPts = clonePts(c.pts);
      return {
        ...p,
        auto: p.auto.map((a) => (a.id === c.id ? { ...a, pts: nextPts } : cloneLane(a))),
      };
    }
    case 'DEL_AUTO': return { ...p, auto: p.auto.filter((a) => a.id !== c.id).map(cloneLane) };
    case 'SET_LOOP': return { ...p, loop: c.loop };
    case 'PATCH': return { ...p, ...c.patch, ...(c.patch.auto ? { auto: c.patch.auto.map(cloneLane) } : {}) };
  }
}

function reduceChecked(p: Project, c: Command): Project {
  if (!c || typeof c !== 'object') throw new Error('Invalid command');
  const patchFields:Record<string,string[]>={
    SET_PARAMS:Object.keys(p.params), SET_TRACK:['layer','name','color','group','synth','vol','pan','mute','solo','lock','sc','rev','del','cutoff','res'],
    SET_SECTION:['role','name','start','bars','energy','lock','levels'], SET_CLIP:['start','len','loop','off','notes','gain','mute','label','transpose'],
    SET_SC:['thr','ratio','atk','rel','hpf','mix','knee'], PATCH:['tracks','auto','sections','sc','scOn','secSeed','overrides','formId','params']
  };
  if('patch' in c){if(!c.patch||typeof c.patch!=='object'||Object.keys(c.patch).some(k=>!patchFields[c.type]?.includes(k)))throw new Error('Unsupported command patch field');}
  if(c.type==='SET_SC'&&!['bass','harm','fx'].includes(c.group))throw new Error('Unknown sidechain bus');
  if(c.type==='SPLIT_CLIP'&&!Number.isFinite(c.at))throw new Error('Invalid split time');
  if(c.type==='BATCH'&&(!Array.isArray(c.cmds)||c.cmds.length>10000))throw new Error('Invalid command batch');
  const tracks = p.tracks; const clips = tracks.flatMap(t=>t.clips);
  if (['SET_TRACK','SET_SECTION','SET_CLIP','DEL_CLIP','SPLIT_CLIP','DUP_CLIP','DEL_AUTO','SET_AUTO_PTS'].includes(c.type)) {
    const id = (c as {id:string}).id;
    const pool = c.type==='SET_TRACK'?tracks:c.type==='SET_SECTION'?p.sections:(c.type==='DEL_AUTO'||c.type==='SET_AUTO_PTS')?p.auto:clips;
    if(!pool.some(x=>x.id===id))throw new Error(`Missing target: ${id}`);
  }
  if(c.type==='ADD_CLIP'&&!tracks.some(t=>t.id===c.track))throw new Error('Missing clip track');
  if(c.type==='SET_NOTES'&&!clips.some(x=>x.id===c.clip))throw new Error('Missing notes clip');
  const next=reduceCommand(p,c);
  if(!next)throw new Error('Unsupported command');
  assertProject(next);assertLocks(p,next);return next;
}

export function applyCommand(p:Project,c:Command):Project {
  assertProject(p);
  let commandCount=0;
  const checkDepth=(cmd:Command,depth:number):void=>{if(++commandCount>10000)throw new Error('Command count exceeds limit');if(depth>32)throw new Error('Command nesting exceeds limit');if(cmd.type==='BATCH'){if(!Array.isArray(cmd.cmds)||cmd.cmds.length>10000)throw new Error('Invalid batch');cmd.cmds.forEach(x=>checkDepth(x,depth+1));}};
  checkDepth(c,0);
  const next=reduceChecked(p,structuredClone(c));
  assertLocks(p,next);return next;
}

export interface HistoryEntry { id: number; label: string; source: Source; before: Project; after: Project; time: number; key?: string }
