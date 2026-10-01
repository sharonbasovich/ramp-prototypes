const E='http://localhost:5315/api';
const post=(p,b)=>fetch(E+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b??{})}).then(async r=>[r.status,await r.json().catch(()=>null)]);
const get=(p)=>fetch(E+p).then(r=>r.json());
await post('/reset',{});
let s=(await get('/state')); const sum=(x)=>JSON.stringify(x).match(/"(estimatedRefundTotalMinor|refundableTotalMinor|totals)":[^}]*}?/g)?.slice(0,2);
console.log('state keys',Object.keys(s.result??s).join(','));
console.log('totals',sum(s));
console.log('cancel',(await post('/event/cancel'))[0]);
let [ps,pr]=await post('/packet/prepare'); console.log('prepare',ps,JSON.stringify(pr).slice(0,300));
let [as,ap]=await post('/packet/approve'); console.log('approve',as,ap?.ok);
// stale: advance clock 2 days
let [cs]=await post('/clock',{instant:'2025-04-27T14:00:00Z'}); console.log('clock',cs);
let [es,ex]=await post('/packet/execute'); console.log('execute after clock',es,JSON.stringify(ex).slice(0,300));
// fresh flow + concurrent execute
await post('/reset',{}); await post('/event/cancel'); await post('/packet/prepare'); await post('/packet/approve');
const rs=await Promise.all(Array.from({length:8},()=>post('/packet/execute')));
console.log('8x concurrent execute statuses',rs.map(r=>r[0]).join(','));
const st=await get('/state'); const reqs=(st.result??st).requests??(st.result??st).packet?.requests;
console.log('requests',JSON.stringify(reqs?.map?.(r=>[r.bookingId,r.status,r.attempts?.length??r.attemptCount]))?.slice(0,600));
const exp=await get('/packet/export'); console.log('export',JSON.stringify(exp).slice(0,700));
for (const bad of [{instant:'garbage'},{instant:''},{instant:'2025-13-40T00:00:00Z'}]) console.log('clock bad',JSON.stringify(bad),(await post('/clock',bad))[0]);
console.log('amounts float',(await post('/bookings/amounts',{bookingId:'bk-room',committedMinor:100.5,paidMinor:100.5,unpaidMinor:0}))[0]);
