import {it,expect,vi,afterEach} from 'vitest';
import {Store} from '../src/store';
import {defaultParams,newProject} from '../src/engine/composer';
import {buildProposal} from '../src/engine/assist';
afterEach(()=>vi.useRealTimers());
it('invalidates proposals on edit and never reuses a revision on undo/redo',()=>{
 vi.useFakeTimers();const s=new Store(newProject(defaultParams()));const initial=s.get().project;
 const proposal=buildProposal(initial,'Mute','test',{tracks:initial.tracks.map(t=>({...t,mute:true}))});s.addProposal(proposal);
 s.dispatch({type:'SET_NAME',name:'Edit'},'Rename');const editRevision=s.get().project.revision;
 expect(s.get().previewId).toBeNull();expect(s.get().proposals).toHaveLength(0);
 s.undo();expect(s.get().project.revision).toBeGreaterThan(editRevision);s.addProposal(proposal);expect(s.acceptProposal(proposal.id)).toBe(false);
 s.redo();expect(s.get().project.name).toBe('Edit');
});
it('rejected batches leave score/history intact and expose a useful error',()=>{
 vi.useFakeTimers();const s=new Store(newProject(defaultParams()));const initial=s.get().project;
 expect(s.dispatch({type:'SET_TRACK',id:'absent',patch:{vol:1}},'Bad')).toBe(false);
 expect(s.get().project).toBe(initial);expect(s.get().entries).toHaveLength(0);expect(s.get().error).toMatch(/Missing/);
});
it('failed writes are visible and do not mark unsaved work saved',()=>{
 vi.useFakeTimers();const s=new Store(newProject(defaultParams()),{getItem:()=>null,setItem:()=>{throw new Error('quota');}});
 s.dispatch({type:'SET_NAME',name:'Unsaved'},'Rename');vi.advanceTimersByTime(900);
 expect(s.get().saveStatus).toBe('Save failed');expect(s.get().error).toBe('quota');expect(s.get().project.name).toBe('Unsaved');
});
it('tracks and reverts sequential filter cutoff and resonance automation lane point changes via undo()',()=>{
 vi.useFakeTimers();
 const s=new Store(newProject(defaultParams('hypnotic',1337)));
 const arpTrack=s.get().project.tracks.find(t=>t.layer==='ARP')??s.get().project.tracks[0];
 const cutoffLane=s.get().project.auto.find(a=>a.track===arpTrack.id&&a.param==='cutoff')!;
 const resLane=s.get().project.auto.find(a=>a.track===arpTrack.id&&a.param==='res')!;
 expect(cutoffLane).toBeDefined();
 expect(resLane).toBeDefined();
 const origCutoffPts=structuredClone(cutoffLane.pts);
 const origResPts=structuredClone(resLane.pts);

 // 1) First edit to filter cutoff automation curve via SET_AUTO
 const editedCutoffPts1=[...origCutoffPts.slice(0,2),{bar:12,v:0.88,curve:0.45}];
 expect(s.dispatch({type:'SET_AUTO',lane:{...cutoffLane,pts:editedCutoffPts1}},'Cutoff curve edit 1',`auto:${cutoffLane.id}`)).toBe(true);
 expect(s.get().project.auto.find(a=>a.id===cutoffLane.id)!.pts).toEqual(editedCutoffPts1);

 // 2) Second rapid edit within 1500ms must NOT overwrite the first entry for discrete point commits
 const editedCutoffPts2=[...editedCutoffPts1,{bar:20,v:0.24,curve:-0.5}];
 expect(s.dispatch({type:'SET_AUTO_PTS',id:cutoffLane.id,pts:editedCutoffPts2},'Cutoff curve edit 2')).toBe(true);
 expect(s.get().project.auto.find(a=>a.id===cutoffLane.id)!.pts).toEqual(editedCutoffPts2);

 // 3) Edit resonance curve via SET_AUTO
 const editedResPts=[...origResPts.slice(0,2),{bar:16,v:0.91,curve:0.6}];
 expect(s.dispatch({type:'SET_AUTO',lane:{...resLane,pts:editedResPts}},'Resonance curve edit')).toBe(true);
 expect(s.get().project.auto.find(a=>a.id===resLane.id)!.pts).toEqual(editedResPts);

 // Undo step 3 -> reverts resonance curve to original while keeping cutoff edit 2
 s.undo();
 expect(s.get().project.auto.find(a=>a.id===resLane.id)!.pts).toEqual(origResPts);
 expect(s.get().project.auto.find(a=>a.id===cutoffLane.id)!.pts).toEqual(editedCutoffPts2);

 // Undo step 2 -> reverts cutoff curve to edit 1
 s.undo();
 expect(s.get().project.auto.find(a=>a.id===cutoffLane.id)!.pts).toEqual(editedCutoffPts1);

 // Undo step 1 -> reverts cutoff curve to original
 s.undo();
 expect(s.get().project.auto.find(a=>a.id===cutoffLane.id)!.pts).toEqual(origCutoffPts);
});
it('shifts and reverts unlocked filter cutoff and resonance automation curves when SET_TRACK adjusts cutoff/res',()=>{
 vi.useFakeTimers();
 const s=new Store(newProject(defaultParams('hypnotic',1337)));
 const arpTrack=s.get().project.tracks.find(t=>t.layer==='ARP')!;
 const cutoffLaneId=`a_${arpTrack.id}_cutoff`;
 const beforePts=structuredClone(s.get().project.auto.find(a=>a.id===cutoffLaneId)!.pts);
 const beforeCutoff=arpTrack.cutoff;
 expect(s.dispatch({type:'SET_TRACK',id:arpTrack.id,patch:{cutoff:Math.min(1,beforeCutoff+0.2)}},'Increase cutoff')).toBe(true);
 const shiftedPts=s.get().project.auto.find(a=>a.id===cutoffLaneId)!.pts;
 expect(shiftedPts[0].v).toBeGreaterThan(beforePts[0].v);
 s.undo();
 expect(s.get().project.auto.find(a=>a.id===cutoffLaneId)!.pts).toEqual(beforePts);
 expect(s.get().project.tracks.find(t=>t.id===arpTrack.id)!.cutoff).toBeCloseTo(beforeCutoff,5);
});

