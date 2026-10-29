#!/usr/bin/env python3
"""Page ownership regression. Current and legacy native styles are optional inputs.
No live graph/browser profile, no copied client runtime, no forced layout compensation.
"""
import importlib.util
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('DESK_SCOPE_TEST_OUT', '/tmp/nautilus-desk-scope'))


def run():
    spec = importlib.util.spec_from_file_location('desk_view_fixture', ROOT/'test/desk-view.py')
    fixture = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fixture)
    fixture.OUT = OUT
    fixture.bundle()
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={'width': 760, 'height': 917})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.route('http://**/*', lambda route: route.abort())
            page.route('https://**/*', lambda route: route.abort())
            def setup(width, spacing, context='main'):
                page.set_viewport_size({'width': width, 'height': 917})
                page.goto((OUT/'index.html').as_uri())
                page.wait_for_function('() => window.deskHarness?.mount')
                page.evaluate('''({spacing,context})=>{
                  document.querySelector('.rm-article-wrapper').className='rm-article-wrapper '+spacing;
                  deskHarness.mount({empty:true,count:0});
                  deskHarness.api.addChild('scope-card-a','plan-desk','{{[[TODO]]}} First plain task');
                  deskHarness.api.addChild('scope-card-b','plan-desk','{{[[TODO]]}} Second plain task');
                  const owner=document.querySelector('[data-fixture-host="plan-desk"]');
                  if(context==='sidebar'||context==='embed') {
                    const surface=document.createElement('div');
                    if(context==='sidebar') { surface.id='right-sidebar'; surface.className='rm-sidebar-window'; }
                    else surface.className='rm-embed-container';
                    owner.before(surface);surface.append(owner);
                  }
                  if(context==='nested') {
                    const nested=document.createElement('div');nested.className='rm-article-wrapper rm-spacing--small';
                    owner.before(nested);nested.append(owner);
                  }
                }''', {'spacing': spacing, 'context': context})
            def snap():
                page.wait_for_timeout(400)  # The native padding transition lasts 300ms.
                return page.evaluate('''()=>{
                  const q=s=>document.querySelector(s),r=el=>{if(!el)return null;const b=el.getBoundingClientRect();return {x:b.x,width:b.width};};
                  const owner=q('[data-fixture-host="plan-desk"]'),root=owner.querySelector('.nautilus-desk');
                  return {title:r(q('article>h1')),chart:r(owner.querySelector('.fixture-shell')),desk:r(root),
                    deskStyle:root?{marginLeft:getComputedStyle(root).marginLeft,width:root.style.width,maxInlineSize:getComputedStyle(root).maxInlineSize}:null,
                    wrappers:[...document.querySelectorAll('.rm-article-wrapper')].map(el=>{const s=getComputedStyle(el);return {...r(el),left:s.paddingLeft,right:s.paddingRight,claimsPage:el.matches('.rm-article-wrapper[class*="rm-spacing--"]:has(.rm-desk-page)')};}),
                    rootClass:root?.className,gridMin:root?getComputedStyle(root.querySelector('.nautilus-desk__grid')).minHeight:null};
                }''')
            def toggle(name):
                # Do not let Playwright's automatic actionability scrolling
                # change the coordinate frame under measurement.
                page.get_by_role('button',name=name,exact=True).evaluate('el=>el.click()')
            matrix = [('rm-spacing--small',760),('rm-spacing--small',1200),('rm-spacing--medium',900),('rm-spacing--medium',1400),
                      ('rm-spacing--large',1200),('rm-spacing--large',1600),('rm-spacing--full rm-spacing--left-sidebar-open',760),
                      ('rm-spacing--full rm-spacing--right-sidebar-open',1200)]
            for spacing,width,context in [(s,w,'main') for s,w in matrix]+[('rm-spacing--small',760,c) for c in ['sidebar','embed','nested']]:
                setup(width,spacing,context)
                off = snap()
                toggle('Open Desk')
                on = snap()
                delta = {key:on[key]['x']-off[key]['x'] for key in ['title','chart']}
                row = {'spacing':spacing,'width':width,'context':context,'off':off,'on':on,'delta':delta}
                results.append(row)
                (OUT/'measurements.json').write_text(json.dumps(results,indent=2))
                assert all(abs(value)<=0.5 for value in delta.values()), row
                for edge in ['x','width']:
                    assert abs(on['desk'][edge]-on['chart'][edge])<=0.5, row
                assert abs(on['desk']['x'] + on['desk']['width'] - on['chart']['x'] - on['chart']['width'])<=0.5, row
                assert on['deskStyle']['marginLeft'] == '0px' and on['deskStyle']['width'] == '100%', row
                assert 'rm-desk-page' not in on['rootClass'].split(), row
                assert [(x['left'],x['right']) for x in on['wrappers']]==[(x['left'],x['right']) for x in off['wrappers']], row
                assert all(not x['claimsPage'] for x in on['wrappers']), row
                assert on['gridMin']=='0px', row
                toggle('Hide Desk')
                closed = snap()
                for key in ['title','chart']:
                    assert abs(closed[key]['x']-off[key]['x'])<=0.5, (row,closed)
                assert page.evaluate('()=>deskHarness.api.stats.writes.length')==0
            # Positive control: an actual native page still owns the host padding.
            setup(1200,'rm-spacing--small')
            control_before = snap()
            page.evaluate('''()=>{const native=document.createElement('div');native.className='rm-desk-page';native.id='native-page-control';document.querySelector('.rm-article-wrapper').append(native);}''')
            native = snap()
            assert native['wrappers'][0]['claimsPage']
            toggle('Open Desk')
            with_inline = snap()
            assert with_inline['wrappers']==native['wrappers'], (native,with_inline)
            toggle('Hide Desk')
            assert snap()['wrappers']==native['wrappers']
            # A current stylesheet must retain its own 12px/0 page rule. Legacy
            # snapshots are checked against their own positive-control baseline.
            native_css=Path(os.environ.get('ROAM_NATIVE_CSS', ROOT/'test/desk-native-fixture.css')).read_text()
            if ':has(.rm-desk-page)' in native_css:
                assert (native['wrappers'][0]['left'],native['wrappers'][0]['right'])==('12px','0px')
                assert native['wrappers'][0]['left']!=control_before['wrappers'][0]['left']
            # Restore native page-sized cards, but never its viewport minimum.
            page.evaluate('()=>document.querySelector("#native-page-control").remove()')
            toggle('Open Desk')
            style=page.locator('.nautilus-desk').evaluate('''root=>{
              const grid=root.querySelector('.nautilus-desk__grid'),tile=grid.firstElementChild;
              const s=getComputedStyle(grid),t=getComputedStyle(tile),p=getComputedStyle(tile.querySelector('.rm-desk-tile__preview'));
              return {gap:s.columnGap,rowGap:s.rowGap,padding:s.padding,tilePadding:t.padding,previewSize:p.fontSize,previewLine:p.lineHeight,min:s.minHeight};
            }''')
            assert style=={'gap':'12px','rowGap':'0px','padding':'8px 12px','tilePadding':'12px 12px 8px','previewSize':'13px','previewLine':'19.5px','min':'0px'}, style
            assert not errors, errors
            (OUT/'results.json').write_text(json.dumps({'status':'passed','cases':results,'nativePageControl':native,'inlineCardStyles':style,'pageerrors':errors,
                'native_css':os.environ.get('ROAM_NATIVE_CSS','offline contract'),'limitation':'Synthetic graph/host structure; not a fresh Desktop measurement.'},indent=2))
            print(f'PASSED: {len(results)} spacing/context round trips, native page ownership and inline card geometry; artifacts: {OUT}')
        finally:
            browser.close()


if __name__=='__main__':
    run()
