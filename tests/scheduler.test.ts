import {it,expect,vi} from 'vitest';
import {Scheduler} from '../src/engine/audio';
import {newProject,defaultParams} from '../src/engine/composer';
it('removing an automation lane cancels its queued events and restores the base',()=>{
 const cancel=vi.fn(),value=vi.fn(),ramp=vi.fn();const param={cancelScheduledValues:cancel,setValueAtTime:value,linearRampToValueAtTime:ramp};
 const p=newProject(defaultParams());const t=p.tracks[0];const lane={id:'vol-test',track:t.id,param:'vol' as const,pts:[{bar:0,v:0.1},{bar:32,v:0.8}]};p.auto=[lane];
 const graph={strips:new Map([[t.id,{volA:{gain:param}}]])};const scheduler=new Scheduler(graph as any);
 scheduler.scheduleAutomation(p,0,1,true);cancel.mockClear();value.mockClear();
 scheduler.scheduleAutomation({...p,auto:[]},4,5,true);
 expect(cancel).toHaveBeenCalledWith(5);expect(value).toHaveBeenCalledWith(1,5);
});
it('subdivides Bezier-curved automation segments into multiple smooth AudioParam ramps',()=>{
 const cancel=vi.fn(),value=vi.fn(),ramp=vi.fn();const param={cancelScheduledValues:cancel,setValueAtTime:value,linearRampToValueAtTime:ramp};
 const p=newProject(defaultParams());const t=p.tracks[0];
 p.auto=[{id:'vol-curve',track:t.id,param:'vol' as const,pts:[{bar:0,v:0.2},{bar:8,v:0.9,curve:0.55}]}];
 const graph={strips:new Map([[t.id,{volA:{gain:param}}]])};const scheduler=new Scheduler(graph as any);
 scheduler.scheduleAutomation(p,0,0,true);
 expect(ramp.mock.calls.length).toBeGreaterThanOrEqual(6);
});
it('exposes Aw (Graph) and RE (Engine) pre-warming for low-latency worklet initialization',()=>{
 return import('../src/engine/audio').then(({Aw,RE,Graph,Engine})=>{
  expect(Aw).toBe(Graph);
  expect(RE).toBe(Engine);
  expect(typeof Aw.prewarmWorkletNodes).toBe('function');
  const eng=new RE();
  expect(typeof eng.prewarm).toBe('function');
 });
});

