function chartInput(count=20,width=720) {
  const items=Array.from({length:count},(_,i)=>({uid:`task-${i}`,description:`${String(i).padStart(4,'0')} ${i%3?'Review project notes and prepare implementation details':'核对任务进展并整理下一步说明'}`,
    todo:true,done:i%4===0,start:360+i*2,end:380+i*2}));
  return {containerWidth:width,items,events:items,startMinutes:360,endMinutes:1200,
    currentLabels:['Current task','Current event'],nowMinutes:510,interactive:true,showEstimateCue:true};
}
function measure(text) {return [...text].reduce((n,c)=>n+(c.charCodeAt(0)>255?12:6.2),0);}
module.exports={chartInput,measure};
