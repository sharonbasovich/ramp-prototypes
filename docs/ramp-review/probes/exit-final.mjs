const E='http://localhost:5315/api';
const post=(p,b)=>fetch(E+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b??{})}).then(async r=>[r.status,await r.json().catch(()=>null)]);
const st=()=>fetch(E+'/state').then(r=>r.json()).then(j=>j.result);
const reqs=s=>s.requests.map(r=>`${r.bookingId}:${r.status}:${r.requestId}`).join(' ');
// 1 failed retry past cutoff
await post('/reset'); await post('/event/cancel'); await post('/packet/prepare'); await post('/packet/approve'); await post('/packet/execute');
let s=await st(); console.log('after exec',reqs(s)); const ids1=s.requests.map(r=>r.requestId);
const eq=s.requests.find(r=>r.bookingId==='bk-equipment');
await post('/clock',{instant:'2025-04-27T14:00:00Z'});
let [c,r]=await post(`/requests/${eq.requestId}/execute`); console.log('retry failed past +2d',c,JSON.stringify(r).slice(0,260));
[c,r]=await post(`/requests/${eq.requestId}/execute`); console.log('retry again',c,JSON.stringify(r).slice(0,200));
s=await st(); console.log('totals',JSON.stringify(s.totals).slice(0,260));
// 2 invalid paid amount then approve
await post('/reset');
console.log('amounts C!=P+U',JSON.stringify(await post('/bookings/amounts',{bookingId:'bk-catering',committedMinor:30000,paidMinor:35000,unpaidMinor:0})).slice(0,200));
console.log('amounts neg',(await post('/bookings/amounts',{bookingId:'bk-catering',committedMinor:30000,paidMinor:40000,unpaidMinor:-10000}))[0]);
await post('/event/cancel'); console.log('prepare',JSON.stringify((await post('/packet/prepare'))[1]?.result?.results?.map(x=>x.bookingId+':'+x.status)));
[c,r]=await post('/packet/approve'); console.log('approve',c,r?.ok,r?.error?.code??'');
// 3 reset replay: old request ids must not resurrect
await post('/reset'); s=await st(); console.log('after reset requests',s.requests.length,'outcomes',s.outcomes.length);
[c,r]=await post(`/requests/${ids1[0]}/execute`); console.log('execute old-epoch id after reset',c,r?.error?.code??JSON.stringify(r).slice(0,120));
await post('/event/cancel'); await post('/packet/prepare'); s=await st(); console.log('new ids',s.requests.map(r=>r.requestId).join(' '),'collide',s.requests.some(r=>ids1.includes(r.requestId)));
