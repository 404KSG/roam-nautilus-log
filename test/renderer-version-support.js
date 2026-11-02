import { installRendererBridge } from '../src/renderer-bridge';
import { createRendererPlanSession } from '../src/renderer-plan-session';
import { createPlanWatchBridge } from '../src/plan-watch';
import { createDeskView } from '../src/desk-view';
import { createChartHelp } from '../src/chart-help';
import { createRenderBlock, rendererSourceText } from '../src/entry-helpers';
import { createRenderBlock as legacyScaffold } from './fixtures/renderer-v1/entry-helpers';
import { CODE_UID, LEGACY_UIDS, inspectRenderer } from '../src/renderer-contract';
import { createManagedGraph } from './managed-template-graph.cjs';
import { projectPull } from './pull-projection.cjs';

// The real bridge, plan watcher, renderer session, Desk and Help share a raw
// synthetic Roam boundary. Neither readiness nor successful writes are canned.
export function installVersionFixture({ core, taskCore, settings, getChildren, readString, resolveTaskInstance, getClockRenderContext, pageTitle }) {
  const codeGraph = createManagedGraph({day:false});
  // Scaffold and task fixtures occupy the same graph; keep their UIDs distinct.
  const renamed = new Map([...codeGraph.blocks.keys()].filter(uid=>uid.startsWith('source-')||uid==='external-note').map(uid=>[uid,`scaffold-${uid}`]));
  for (const block of [...codeGraph.blocks.values()]) {
    codeGraph.blocks.delete(block.uid);
    const value={...block,uid:renamed.get(block.uid)||block.uid,parentUid:renamed.get(block.parentUid)||block.parentUid,
      string:block.string.replace(/\(\(([^()]+)\)\)/g,(full,uid)=>renamed.has(uid)?`((${renamed.get(uid)}))`:full)};
    codeGraph.blocks.set(value.uid,value);
  }
  codeGraph.roam.graph = {name:'renderer-version-fixture',type:'hosted'};
  codeGraph.add({uid:'r2-code-header',parentUid:'render-page',order:1,string:'r2 source'});
  codeGraph.add({uid:CODE_UID,parentUid:'r2-code-header',order:0,string:rendererSourceText()});
  const watches = new Set(), generations = [];
  const page = {'block/uid':'10-29-2026','node/title':pageTitle,
    'block/children':[{'block/uid':'baseline-plan','block/order':0},{'block/uid':'legacy-plan','block/order':1}]};
  const roots = new Map([
    ['baseline-plan', `[[Nautilus Log]] {{[[roam/render]]:((${CODE_UID})) 22 15 5 "" 21}}`],
    ['legacy-plan', `[[Nautilus Log]] {{[[roam/render]]:((${LEGACY_UIDS[0]})) 22 15 5 "" 21}}`],
  ]);
  let legacyTitle='{{[[DONE]]}} Historical task 20m d10:20';
  const legacyRows = () => [{'block/uid':'legacy-task','block/string':legacyTitle,'block/order':0,'block/refs':[]}];
  const entity = uid => {
    if(uid===page['block/uid']) return page;
    if(roots.has(uid)) return {'block/uid':uid,'block/string':roots.get(uid),'block/order':uid==='legacy-plan'?1:0,'block/open':true,'block/page':page,
      'block/_children':[{'block/uid':page['block/uid']}],
      'block/children':uid==='legacy-plan'?legacyRows():getChildren().map(row=>({...row,'block/children':[]}))};
    const row=[...getChildren(),...legacyRows()].find(child=>child['block/uid']===uid);
    const string=row?.['block/string'] ?? readString(uid);
    return typeof string==='string' && string ? {'block/uid':uid,'block/string':string,'block/order':row?.['block/order']??0,
      'block/open':true,'block/page':page,'block/children':[]} : null;
  };
  const original = window.roamAlphaAPI;
  const lookupUid = lookup => Array.isArray(lookup) ? lookup[1] : /^\[:block\/uid "([^"]+)"\]$/.exec(String(lookup))?.[1] || lookup;
  const rawPull = codeGraph.roam.data.pull.bind(codeGraph.roam.data), rawQuery = codeGraph.roam.q.bind(codeGraph.roam);
  const api = window.roamAlphaAPI = {
    ...original,graph:codeGraph.roam.graph,user:{uid:()=> 'fixture-user'},util:{...codeGraph.roam.util,...original.util},
    q(query,...args){
      const source=String(query);
      if(source.includes('roam/render') || source.includes('roam/templates') || args.some(uid=>codeGraph.blocks.has(uid))) return rawQuery(query,...args);
      if(source.includes('?parent-page-title')) return pageTitle;
      if(source.includes('?title')) return [[pageTitle]];
      if(source.includes(':find ?s')) return entity(args[0]) ? [[entity(args[0])['block/string']]] : [];
      return rawQuery(query,...args);
    },
    data:{...codeGraph.roam.data,
      pull(pattern,lookup){
        const uid=lookupUid(lookup);
        if(codeGraph.blocks.has(uid) || codeGraph.pages.has(uid) || [...codeGraph.pages.values()].includes(uid)) return rawPull(pattern,Array.isArray(lookup)?lookup:[':block/uid',uid]);
        return projectPull(pattern,entity(uid));
      },
      addPullWatch(pattern,lookup,callback){watches.add({pattern,uid:lookupUid(lookup),callback});},
      removePullWatch(pattern,lookup,callback){for(const value of watches)if(value.callback===callback&&value.uid===lookupUid(lookup)&&value.pattern===pattern)watches.delete(value);},
      block:{...codeGraph.roam.data.block,async update({block}){
        if(!codeGraph.blocks.has(block.uid)) throw Error('Unexpected task write in renderer coexistence fixture');
        Object.assign(codeGraph.blocks.get(block.uid),block);codeGraph.trace.push(['update',block.uid]);
      }},
    },
    ui:{...codeGraph.roam.ui,components:{...codeGraph.roam.ui.components,
      renderBlock({uid,el}){const input=document.createElement('textarea');input.id=`block-input-fixture-${uid}`;input.value=entity(uid)?.['block/string']||'';el.append(input);},
    }},
  };
  api.createBlock = api.data.block.create;
  api.updateBlock = api.data.block.update;
  delete window.nautilusLogR2; delete window.nautilusLogExtensionData;
  const notify = () => {for(const value of [...watches])value.callback();};
  const install = () => {
    const watcher=createPlanWatchBridge({roam:api,readString:uid=>entity(uid)?.['block/string']||''});
    const desk=createDeskView({host:window,document,readPlan:watcher.read,watchPlan:watcher.subscribe,getSettings:()=>settings,revision:'fixture-r2'});
    const help=createChartHelp({host:window,document,revision:'f'.repeat(40)});
    const handle=installRendererBridge({host:window,core,taskCore,
      getScope:()=>({provider:window.roamAlphaAPI,graph:window.roamAlphaAPI.graph.name,user:window.roamAlphaAPI.user.uid()}),
      canMutatePlan:(uid,family)=>{const value=inspectRenderer(entity(uid)?.['block/string']);return value.mutable&&(family==='legacy'?value.kind==='legacy':value.kind==='current');},
      services:{createRendererPlanSession,readPlan:watcher.read,watchPlan:watcher.subscribe,resolveTaskInstance,getClockRenderContext,
        shouldSuppressRenderContext:()=>false,isRightSidebarRenderContext:()=>false,
        openDesk:options=>desk.open(options),registerDeskHost:options=>desk.registerHost(options),closeDeskHost:container=>desk.closeForHost(container),
        toggleChartHelp:options=>help.toggle(options),closeChartHelp:anchor=>help.closeForAnchor(anchor),
        locatePlanTask:()=>Promise.resolve(),
        syncCalendarPlan:()=>{throw Error('Unexpected Calendar write');},
      }});
    handle.publish(settings,false);handle.setReady(true);
    const generation={handle,watcher,desk,help};generations.push(generation);
    desk.restoreMountedHosts(options=>{
      const revision=options.container.closest('[data-nautilus-renderer]')?.getAttribute('data-nautilus-renderer');
      if(revision==='2')handle.bridge.registerDeskHost(options);else if(!revision||revision==='1')handle.legacy?.registerDeskHost(options);
    });
    window.dispatchEvent(new CustomEvent('nautilus-log:settings-changed'));
    return generation;
  };
  install();
  const destroy = generation => {generation.handle.destroy();generation.desk.destroy();generation.help.destroy();generation.watcher.destroy();};
  const runScaffold = () => createRenderBlock('roam/render','roam-render-Nautilus-Log','r2',CODE_UID,'Nautilus Log',
    `[[Nautilus Log]] {{[[roam/render]]:((${CODE_UID})) 22 15 5 "" 21}}`,`{{[[roam/render]]:((${CODE_UID}))`);
  return {
    notify,install,
    updateLegacyTitle(value){legacyTitle=value;notify();},
    current:()=>generations.at(-1).handle.bridge,
    currentSource:()=>codeGraph.blocks.get(CODE_UID).string,
    legacySource:()=>codeGraph.blocks.get(LEGACY_UIDS[0])?.string,
    async legacyWrite(){const start=codeGraph.trace.length;await legacyScaffold('roam/render','roam-render-Nautilus-Log','v1',LEGACY_UIDS[0],
      'Nautilus Log',`[[Nautilus Log]] {{[[roam/render]]:((${LEGACY_UIDS[0]})) 22 15 5 "" 21}}`,`{{[[roam/render]]:((${LEGACY_UIDS[0]}))`);
      return codeGraph.trace.slice(start).filter(row=>['create','update'].includes(row[0]));},
    async verifySourceRefusal(kind){
      const block=codeGraph.blocks.get(CODE_UID),saved=block.string;
      block.string=kind==='newer'?saved.replace(';; nautilus-renderer 2',';; nautilus-renderer 3'):saved.replace('(ns nautilus-log-r2',';; foreign same-revision content\n(ns nautilus-log-r2');
      const expected=block.string,start=codeGraph.trace.length;let message='';
      try{await runScaffold();}catch(error){message=error.message;}
      const preserved=block.string===expected,writes=codeGraph.trace.slice(start).filter(row=>['create','update','request'].includes(row[0]));
      block.string=saved;return {message,preserved,writes};
    },
    async verifyAmbiguousTemplate(){let message='';const before=JSON.stringify([...codeGraph.blocks]);try{await runScaffold();}catch(error){message=error.message;}
      return {message,preserved:before===JSON.stringify([...codeGraph.blocks])};},
    staleCleanup(){const old=generations[0],container=document.querySelector('#chart-root .nautilus-log-desk-host'),anchor=document.querySelector('#chart-root .nautilus-log-help-btn');
      old.handle.bridge.closeDeskHost(container);old.handle.bridge.closeChartHelp(anchor);
      window.nautilusLogExtensionData?.closeDeskHost?.(container);window.nautilusLogExtensionData?.closeChartHelp?.(anchor);},
    disposePrevious(){generations.slice(0,-1).forEach(destroy);},
    legacyGlobalCleanup(){if(window.nautilusLogExtensionData)window.nautilusLogExtensionData.running=false;delete window.nautilusLogCore;delete window.nautilusLogTaskCore;},
    destroy(){generations.forEach(destroy);},
    state:()=>({watches:watches.size,generations:generations.length,revision:window.nautilusLogR2?.revision,running:window.nautilusLogR2?.running,
      currentSourceUnchanged:codeGraph.blocks.get(CODE_UID).string===rendererSourceText()}),
  };
}
