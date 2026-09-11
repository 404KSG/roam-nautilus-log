const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../src/log-core');

test('reusing translated label rectangles matches a fresh layout at the new center',()=>{
  for(const offset of [[120,75],[-85,201],[0,0]]) {
    const labels=Array.from({length:18},(_,i)=>({uid:`task-${i}`,angle:i*0.31,anchorY:150-Math.sin(i*0.31)*140,sortKey:i,width:80+(i%3)*10,height:18}));
    const options={centerX:200,centerY:150,exclusionRadius:150,gap:24,trackGap:18,layout:'side-rails',rowGap:26,collisionPadding:6,labels};
    const original=core.placeExternalLabels(options);
    const shifted=core.translateLabelRects({rects:original,dx:offset[0],dy:offset[1]});
    const recalculated=core.placeExternalLabels({...options,centerX:200+offset[0],centerY:150+offset[1],labels:labels.map(label=>({...label,anchorY:label.anchorY+offset[1]}))});
    for(let i=0;i<labels.length;i++) {
      for(const key of ['x','y','width','height','anchorY','connectorKneeX','connectorRailX','track']) {
        assert.ok(Math.abs(shifted[i][key]-recalculated[i][key])<1e-7,`${i}:${key}`);
      }
      assert.equal(shifted[i].uid,recalculated[i].uid);
    }
    assert.notEqual(shifted,original);
    assert.notEqual(shifted[0],original[0]);
  }
});
