#!/usr/bin/env python3
"""A decorative native caret class must never toggle the plan's fold state."""
import importlib.util
import json
import os
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
os.environ['NAUTILUS_RENDERER_OUT']=os.environ.get('NAUTILUS_FOLD_STABILITY_OUT','/tmp/nautilus-fold-stability')
spec=importlib.util.spec_from_file_location('fold_fixture',ROOT/'test/chart-renderer.py')
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
OUT=f.OUT


def run():
    (OUT/'bundle').mkdir()
    subprocess.check_call(['node','test/chart-renderer-bundle.cjs',str(OUT/'bundle')],cwd=ROOT)
    f.write_page(f.COMPONENT.read_text())
    report={'cases':[]};errors=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        try:
            page=browser.new_page(viewport={'width':1200,'height':1000})
            page.on('pageerror',lambda error:errors.append(str(error)))
            for context,width in [('main',720),('sidebar',280)]:
                f.load(page,'mixed',context,width,real_desk=True)
                root=page.locator('#chart-root .nautilus-log-container')
                assert page.locator('#chart-root .nautilus-log-desk-btn').inner_text().strip()==''
                source=page.evaluate('()=>__chartHarness.sourceRows()')
                # Mount another exact component for the same plan, as in the
                # reported main-window plus sidebar setup.
                page.evaluate('''()=>{
                  const owner=document.createElement('section');owner.className='roam-block-container rm-block--open';owner.style.width='280px';
                  const main=document.createElement('div');main.className='rm-block-main';
                  const controls=document.createElement('div');controls.className='rm-block__controls';
                  const caret=document.createElement('span');caret.className='rm-caret rm-caret-open rm-caret-hidden';controls.append(caret);
                  const mount=document.createElement('div');mount.id='stability-copy';main.append(controls,mount);
                  const raw=document.createElement('div');raw.className='rm-block-children';owner.append(main,raw);
                  document.getElementById('sidebar-render-context').append(owner);
                  scittle.core.eval_string('(rdom/render ['+__chartEvaluator.namespace+'/main {:block-uid "baseline-plan"}] (.getElementById js/document "stability-copy"))');
                }''')
                copy=page.locator('#stability-copy .nautilus-log-container')
                expect(copy).to_be_visible()
                page.evaluate('()=>window.stableCopySvg=document.querySelector("#stability-copy svg.nautilus-log-svg")')
                page.evaluate('''()=>{const owner=document.getElementById('native-plan-owner'),caret=document.getElementById('native-plan-caret');
                  owner.classList.remove('rm-block--open');owner.classList.add('rm-block--closed');
                  caret.classList.remove('rm-caret-open');caret.classList.add('rm-caret-closed','rm-caret-hidden');
                  document.getElementById('native-plan-outline').hidden=true;}''')
                samples=[]
                for hidden in [True,False]*8:
                    page.evaluate('hidden=>document.getElementById("native-plan-caret").classList.toggle("rm-caret-hidden",hidden)',hidden)
                    f.settle_renderer(page)
                    samples.append(root.evaluate('e=>({folded:e.dataset.nautilusNativeFolded,visible:e.getClientRects().length>0,svg:!!e.querySelector("svg.nautilus-log-svg")})'))
                    expect(copy).to_be_visible()
                    assert page.evaluate('()=>stableCopySvg===document.querySelector("#stability-copy svg.nautilus-log-svg")')
                transitions=sum(a['folded']!=b['folded'] for a,b in zip(samples,samples[1:]))
                case={'context':context,'decorativeChanges':len(samples),'foldTransitions':transitions,'samples':samples}
                report['cases'].append(case);(OUT/'result.json').write_text(json.dumps(report,indent=2))
                print(json.dumps(case))
                assert transitions==0 and all(s['folded']=='true' and not s['visible'] and not s['svg'] for s in samples), 'Caret appearance changed the actual fold state; this creates repeated chart/Desk disappearance.'
                # The same decorative churn on an expanded plan must retain
                # its chart and Desk instances, including across a second copy.
                page.locator('#native-plan-caret').click();f.settle_renderer(page)
                page.evaluate('()=>{window.stableSvg=document.querySelector("svg.nautilus-log-svg");window.stableDesk=document.querySelector(".nautilus-desk")}')
                for hidden in [True,False]*8:
                    page.evaluate('hidden=>document.getElementById("native-plan-caret").classList.toggle("rm-caret-hidden",hidden)',hidden)
                    f.settle_renderer(page)
                    assert page.evaluate('()=>stableSvg===document.querySelector("svg.nautilus-log-svg")&&stableDesk===document.querySelector(".nautilus-desk")')
                    expect(root).to_be_visible()
                assert page.evaluate('()=>__chartHarness.sourceRows()')==source and f.state(page)['writes']==0
                case['expandedIdentityStable']=True
                case['simultaneousCopyUnchanged']=True
                # A genuinely empty plan stays reachable even when its native
                # block is closed and has no useful expand affordance.
                f.load(page,'empty',context,width,real_desk=True)
                page.evaluate('()=>{const owner=document.getElementById("native-plan-owner");owner.classList.remove("rm-block--open");owner.classList.add("rm-block--closed");document.getElementById("native-plan-caret").classList.add("rm-caret-closed")}')
                expect(page.locator('.nautilus-log-desk-btn')).to_be_visible()
                case['verifiedEmptyPlanReachable']=True
            report['pageErrors']=errors
        finally:browser.close()
    assert not errors,errors
    (OUT/'result.json').write_text(json.dumps(report,indent=2))
    print(f'PASS: decorative caret churn cannot blink expanded/collapsed plans; {OUT}')


if __name__=='__main__':run()
