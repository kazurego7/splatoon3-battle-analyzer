import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

test('seek and chart death positions share screen coordinates across aspect ratios and margins', async () => {
  const source=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const sync=source.slice(source.indexOf('function syncChartViewport()'),source.indexOf('function refreshChartLayout()'));
  for(const [width,height,leftMargin,rightMargin,expanded] of [[350,200,10,10,false],[350,132,10,10,false],[804,260,27,18,false],[1500,180,51,33,true],[350,400,10,10,false]]){
    const rect={left:17,width,height};
    const track={left:17+leftMargin,right:17+width-rightMargin,width:width-leftMargin-rightMargin};
    const context={window:{innerWidth:width},chartHeight:250,chartBounds:{},elements:{analysisChart:{getBoundingClientRect:()=>rect,setAttribute(){}},timeline:{getBoundingClientRect:()=>track},videoPanel:{classList:{contains:()=>expanded}},chartHit:{setAttribute(){}}}};
    vm.runInNewContext(sync+';syncChartViewport();',context);
    const bounds=context.chartBounds;
    const scale=Math.min(width/bounds.width,height/250);
    const offset=(width-bounds.width*scale)/2;
    for(const ratio of [0,.1,.37,.8,1]){
      const chart=rect.left+offset+(bounds.left+ratio*(bounds.right-bounds.left))*scale;
      const seek=track.left+ratio*track.width;
      assert.ok(Math.abs(chart-seek)<.001,`${width}x${height} at ${ratio}: ${chart} != ${seek}`);
    }
  }
});
