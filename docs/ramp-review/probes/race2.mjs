const post=(u,b)=>fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b??{})}).then(async r=>({s:r.status,b:await r.json().catch(()=>null)}));
const B='http://localhost:5314/api';
await post(B+'/reset');
const rs=await Promise.all(Array.from({length:20},(_,i)=>post(B+'/requests',{requestId:'rv-'+i,agentId:i%2?'ben':'ada',itemId:'monitor',qty:1})));
const pick=rs.map(r=>r.b.result).map(x=>`${x.requestId}:${x.status}:${x.reason}:held=${x.fundsHeld??x.reservedMinor??x.holdMinor}`); console.log(pick.slice(0,4).join('\n'));
console.log(JSON.stringify(rs[1].b.result));
const holder=rs.find(r=>JSON.stringify(r.b.result).match(/"(fundsHeld|held)":true/))?.b.result.requestId;
const other=rs.map(r=>r.b.result.requestId).find(id=>id!==holder);
const a=await post(B+`/requests/${other}/approve`); console.log('approve no-funds',a.s,JSON.stringify(a.b).slice(0,300));
// Borrow concurrent reserve: two clients reserve same plan
const W='http://localhost:5313/api';
await post(W+'/reset'); await post(W+'/owner-confirm',{assetId:'M-204'});
const al=await post(W+'/allocate',{}); const plan=al.b.plan; const req=al.b.plan.request??null;
console.log('plan keys',Object.keys(plan).join(','));
const st=await fetch(W+'/state').then(r=>r.json());
