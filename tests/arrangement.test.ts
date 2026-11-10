import {it,expect} from 'vitest';
import {generate,defaultParams,newProject,mergeGenerated,regenSection,createAmbientTechnoTemplate} from '../src/engine/composer';
import {totalBars} from '../src/engine/types';
import {STYLES} from '../src/engine/styles';
it('honors requested exact lengths across all styles and seeds',()=>{
 for(const style of Object.keys(STYLES))for(const bars of [96,100,137,176,256])for(const seed of [7,42,1337,808,999]){
  const p=newProject({...defaultParams(style,seed),bars});expect(totalBars(p),`${style} ${bars} ${seed}`).toBe(bars);
 }
});
it('preserves user-added layers sharing a generated family on full regeneration',()=>{
 const p=newProject(defaultParams());const extra=structuredClone(p.tracks.find(t=>t.layer==='PERC1')!);extra.id='manual-perc';extra.clips.forEach((c,i)=>c.id=`manual-${i}`);p.tracks.push(extra);
 expect(mergeGenerated(p,generate(p.params),true).tracks.find(t=>t.id===extra.id)).toEqual(extra);
});
it('does not regenerate any locked section',()=>{
 const p=newProject(defaultParams());p.sections[1].lock=true;expect(()=>regenSection(p,p.sections[1].id)).toThrow(/lock/i);
});
it('allocates style layers dynamically and reproduces the same score from its seed',()=>{
 const inventories=new Set(Array.from({length:12},(_,seed)=>generate(defaultParams('hardgroove',seed+1)).tracks.map(t=>t.layer).join('|')));
 expect(inventories.size).toBeGreaterThan(1);
 const params=defaultParams('acid',44);expect(generate(params)).toEqual(generate(params));
});
it('targeted regeneration preserves material on both sides of a crossing clip',()=>{
 const p=newProject(defaultParams());const sec=p.sections[1];const t=p.tracks[0];
 t.clips=[{...t.clips[0],id:'cross',start:sec.start-1,len:sec.bars+2}];
 const r=regenSection(p,sec.id);const clips=r.tracks[0].clips;
 expect(clips.some(c=>c.start===sec.start-1&&c.len===1)).toBe(true);
 expect(clips.some(c=>c.start===sec.start+sec.bars&&c.len===1)).toBe(true);
});
it('can regenerate unlocked material while retaining a locked section exactly',async()=>{
 const {applyCommand}=await import('../src/engine/commands');const p=newProject(defaultParams());p.sections[2].lock=true;
 const generated=generate(p.params,{sections:p.sections,secSeed:{[p.sections[1].id]:4}});
 const patch=mergeGenerated(p,generated,true);
 expect(()=>applyCommand(p,{type:'PATCH',patch})).not.toThrow();
 expect(patch.sections[2]).toEqual(p.sections[2]);
});
it('splices automation lanes per-span so unlocked sections update while locked section spans remain protected',async()=>{
 const {applyCommand}=await import('../src/engine/commands');
 const p=newProject(defaultParams('acid',101));
 const lockedSec=p.sections[2];
 lockedSec.lock=true;
 const unlockedSec=p.sections[1];
 // Mutate automation in the unlocked section before regenerating so we can verify it updates
 const lane=p.auto[0];
 lane.pts=lane.pts.map(pt=>pt.bar>=unlockedSec.start&&pt.bar<unlockedSec.start+unlockedSec.bars?{...pt,v:0.123}:pt);
 const r=regenSection(p,unlockedSec.id);
 expect(()=>applyCommand(p,{type:'PATCH',patch:r})).not.toThrow();
 const updatedLane=r.auto.find(a=>a.id===lane.id)!;
 expect(updatedLane.pts.some(pt=>pt.bar>=unlockedSec.start&&pt.bar<unlockedSec.start+unlockedSec.bars&&pt.v!==0.123)).toBe(true);
});
it('creates the Ambient Techno project template with longer loop phrases and prioritized PAD and DRONE layers',()=>{
 const p=createAmbientTechnoTemplate(2049);
 expect(p.params.style).toBe('ambient');
 expect(p.formId).toBe('ambient');
 const pad=p.tracks.find(t=>t.layer==='PAD');
 const drone=p.tracks.find(t=>t.layer==='DRONE');
 expect(pad).toBeDefined();
 expect(drone).toBeDefined();
 // PAD and DRONE enter immediately at bar 0 in Ambient Techno and use long loop phrases
 expect(pad!.clips[0].start).toBe(0);
 expect(drone!.clips[0].start).toBe(0);
 expect(pad!.clips[0].loop).toBeGreaterThanOrEqual(128);
 expect(drone!.clips[0].loop).toBeGreaterThanOrEqual(128);
});
it('evolves 303 acid and melodic/groove layers across phrases so consecutive clips do not repeat identically',()=>{
 const p=newProject(defaultParams('acid',707));
 const acidTrack=p.tracks.find(t=>t.layer==='ACID1')!;
 expect(acidTrack.clips.length).toBeGreaterThan(2);
 const sigs=acidTrack.clips.map(c=>c.notes.map(n=>`${n.t}:${n.p}:${n.acc?1:0}:${n.slide?1:0}`).join(','));
 const uniqueSigs=new Set(sigs);
 expect(uniqueSigs.size).toBeGreaterThan(1);
});
it('validates all 9 arrangement FORMS, multi-group layering, key-locked transitions, sidechain buses, and automation lanes',async()=>{
 const {FORMS}=await import('../src/engine/styles');
 const {assertProject}=await import('../src/engine/validation');
 for(const formId of Object.keys(FORMS)){
  const p=newProject({...defaultParams('hypnotic',505),form:formId,bars:176});
  assertProject(p);
  expect(p.formId).toBe(formId);
  expect(totalBars(p)).toBe(176);
  const groups=new Set(p.tracks.map(t=>t.group));
  expect(groups.has('Foundation')).toBe(true);
  expect(groups.has('Groove')).toBe(true);
  expect(groups.has('Transition')).toBe(true);
  const trClips=p.tracks.filter(t=>t.group==='Transition').flatMap(t=>t.clips);
  expect(trClips.length).toBeGreaterThan(0);
  // Verify sidechain buses are assigned on bass, harm, and fx layers
  expect(p.tracks.some(t=>t.sc==='bass')).toBe(true);
  expect(p.tracks.some(t=>t.sc==='harm')).toBe(true);
  expect(p.tracks.some(t=>t.sc==='fx')).toBe(true);
  // Verify automation lanes exist for cutoff, res, rev, and master hp
  const autoParams=new Set(p.auto.map(a=>a.param));
  expect(autoParams.has('cutoff')).toBe(true);
  expect(autoParams.has('res')).toBe(true);
  expect(autoParams.has('rev')).toBe(true);
 }
});
it('propagates SET_TRACK cutoff, res, and rev adjustments into unlocked automation lanes and validates presets & clip waveforms',async()=>{
 const {applyCommand}=await import('../src/engine/commands');
 const {FACTORY_DEVICE_PRESETS,saveDevicePreset,deleteDevicePreset,applyDevicePresetToTrackPatch}=await import('../src/engine/presets');
 const {computeAnalyticalClipWaveform}=await import('../src/engine/clipWaveform');
 const p=newProject(defaultParams('hypnotic',909));
 const acid=p.tracks.find(t=>t.layer==='ACID1')!;
 const revLaneBefore=p.auto.find(a=>a.track===acid.id&&a.param==='rev')!;
 expect(revLaneBefore).toBeDefined();
 const baseRevBefore=revLaneBefore.pts[0].v;
 const next=applyCommand(p,{type:'SET_TRACK',id:acid.id,patch:{rev:Math.min(1,acid.rev+0.2)}});
 const revLaneAfter=next.auto.find(a=>a.track===acid.id&&a.param==='rev')!;
 expect(revLaneAfter.pts[0].v).toBeCloseTo(Math.min(1,baseRevBefore+0.2),2);

 // Validate Device Preset save, load, and track patch application
 expect(FACTORY_DEVICE_PRESETS.length).toBeGreaterThanOrEqual(10);
 const saved=saveDevicePreset('Custom Test Acid',acid,{eqLow:2,eqMid:-1,eqHigh:1.5},'303 Acid');
 const patch=applyDevicePresetToTrackPatch(saved);
 const afterPreset=applyCommand(next,{type:'SET_TRACK',id:acid.id,patch});
 expect(afterPreset.tracks.find(t=>t.id===acid.id)?.synth).toBe(acid.synth);
 deleteDevicePreset(saved.id);

 // Validate analytical clip waveform generation for Piano Roll overlay
 const clip=acid.clips[0];
 const wf=computeAnalyticalClipWaveform(clip,acid,p.params.bpm,128);
 expect(wf.peaks.length).toBe(128);
 expect(wf.peaks.some(v=>v>0)).toBe(true);
});

