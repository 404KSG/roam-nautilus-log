import { createTodayPlanSession } from '../src/today-plan';
import { createTodayPlanCommands } from '../src/today-plan-commands';
import { createTodayPlanLauncher } from '../src/today-plan-launcher';
import { createTimingTopbar } from '../src/timing-topbar';
import { createTimingRuntime } from '../src/timing-runtime';
import { freezeCanonicalTemplate, inspectCanonicalTemplate, readBlockTree } from '../src/entry-helpers';
const {createManagedGraph, CORE, ROOT, COMPONENT} = require('./managed-template-graph.cjs');
let graph, session, runtime, view, date, options, commands, release;
const palette = new Map();
const cleanup = () => {view?.destroy();commands?.destroy();session?.destroy();runtime?.destroy();release?.();release=null;};
async function mount(opts={}, reload=false) {
  cleanup();options=opts;
  if(!reload){
    graph=createManagedGraph();date=new Date(2026,8,9,10);
    if(opts.scenario==='partial'){let n=0;graph.hooks.beforeCreate=()=>{if(++n===3)throw Error('Injected third request failure');};}
    if(opts.scenario==='unsupported')graph.blocks.get('source-step').string='LOGBOOK::';
    if(opts.scenario==='long-word')graph.blocks.get('source-step')['unsupported-'+ 'long'.repeat(80)]=true;
    if(opts.scenario==='read-failed')graph.hooks.query=q=>{if(q.includes('?parent :block/uid "template"'))throw Error('Template read is unavailable in this isolated host.');};
    if(opts.scenario==='delayed'){
      const gate=new Promise(r=>release=r);graph.hooks.beforeCreate=()=>gate;
    }
    if(opts.scenario==='collision')graph.ids.push('external-note');
    if(opts.scenario==='nav-failed')graph.hooks.navigate=()=>{throw Error('Navigation unavailable');};
    if(opts.scenario==='midnight')graph.hooks.afterCreate=()=>{date=new Date(2026,8,10,0,0,1);};
    if(opts.timer==='pomo')graph.values.set('standalone-pomodoro-state',{startedAt:date.getTime()-300000});
    if(opts.timer==='clock'){
      graph.add({uid:'clock-task',string:'{{[[TODO]]}} Timed work 20m',parentUid:'notes-page',order:1});
      graph.add({uid:'drawer',string:'LOGBOOK::',parentUid:'clock-task',order:0});
      graph.add({uid:'running-clock',string:'CLOCK: [2026-09-09 Wed 09:50]',parentUid:'drawer',order:0});
    }
  }
  window.roamAlphaAPI=graph.roam;
  const main=document.querySelector('main'), hostGraph=graph;
  main.replaceChildren(Object.assign(document.createElement('h1'),{textContent:'Unrelated page'}));
  graph.hooks.afterNavigate=uid=>{
    const outline=id=>{
      const block=hostGraph.blocks.get(id),item=document.createElement('li');
      item.dataset.blockUid=id;
      item.append(Object.assign(document.createElement('div'),{textContent:block?.string || id}));
      const children=hostGraph.children(id);
      if(children.length){const list=document.createElement('ul');list.append(...children.map(child=>outline(child.uid)));item.append(list);}
      return item;
    };
    const list=document.createElement('ul');list.append(outline(uid));main.replaceChildren(list);
  };
  graph.values.set('language',opts.language||'en');
  document.body.classList.toggle('bp3-dark',Boolean(opts.dark));
  const extensionAPI={settings:graph.settings,ui:{commandPalette:{addCommand:c=>palette.set(c.label,c),removeCommand:({label})=>palette.delete(label)}}};
  const tracking=opts.surface==='execution';
  runtime=tracking?createTimingRuntime({extensionAPI,now:()=>date}):null;
  if(runtime) await runtime.initialize();
  session=createTodayPlanSession({extensionAPI,now:()=>date,buildComponentString:()=>COMPONENT,
    inspectTemplate:()=>inspectCanonicalTemplate(CORE),freezeTemplate:()=>freezeCanonicalTemplate(CORE),readTemplateTree:readBlockTree,
    trackingEnabled:()=>tracking,readTrackingSnapshot:()=>runtime?.getSnapshot(),subscribeTracking:fn=>runtime?.subscribe(fn),requestTrackingRefresh:opts=>runtime?.requestRefresh(opts)});
  session.initialize();
  commands=createTodayPlanCommands({extensionAPI,todayPlan:session});commands.initialize();
  view=tracking?createTimingTopbar({runtime,extensionAPI,todayPlan:session}):createTodayPlanLauncher({todayPlan:session,extensionAPI});
  view.initialize();
  return session.getState();
}
window.realPlan={mount,reload:()=>mount(options,true),cleanup,state:()=>session.getState(),
  tree:()=>readBlockTree(ROOT),blocks:()=>[...graph.blocks.values()],trace:()=>graph.trace,
  recover:()=>{release?.();release=null;delete graph.hooks.beforeCreate;delete graph.hooks.navigate;delete graph.hooks.query;},
  command:()=>[...palette.values()][0].callback(),
  retry:()=>session.discover({authoritative:true}),setDate:async()=>{date=new Date(2026,8,10,0,0,1);await runtime?.requestRefresh({immediate:true});await session.discover({authoritative:true});},
  noProvider:async()=>{view.destroy();view=createTimingTopbar({runtime,extensionAPI:{settings:graph.settings}});view.initialize();},
};
window.addEventListener('beforeunload',cleanup);
