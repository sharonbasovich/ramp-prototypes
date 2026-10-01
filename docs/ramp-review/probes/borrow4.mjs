const post=(u,b)=>fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b??{})}).then(async r=>({s:r.status,b:await r.json().catch(()=>null)}));
const W='http://localhost:5313/api';
await post(W+'/reset'); await post(W+'/owner-confirm',{assetId:'M-204'});
const al=await post(W+'/allocate',{}); const plan=al.b?.plan; console.log('allocate',al.s,plan?.status,plan?.totalCostCents,plan?.potentialAvoidedCents,plan?.transfers?.map(t=>t.assetId).join(','));
const req=plan.request;
// forged: claim cheaper cost / nonexistent asset / HDMI-only asset for USB-C request
const f1=await post(W+'/reserve',{request:req,plan:{...plan,totalCostCents:1}}); console.log('forged cost',f1.s,JSON.stringify(f1.b).slice(0,160));
const f2=await post(W+'/reserve',{request:req,plan:{...plan,transfers:[...plan.transfers.slice(0,1),{...plan.transfers[0],assetId:'NOPE-1'}]}}); console.log('forged asset',f2.s,JSON.stringify(f2.b).slice(0,160));
const rs=await Promise.all(Array.from({length:10},(_,i)=>post(W+'/reserve',{request:{...req,id:'race-'+i},plan:{...plan,request:{...req,id:'race-'+i}}})));
const t={}; rs.forEach(r=>t[r.s]=(t[r.s]||0)+1); console.log('10 parallel reserve',t);
const st=await fetch(W+'/state').then(r=>r.json());
console.log('active',(st.world.reservations||[]).filter(r=>['active','confirmed'].includes(r.status)).map(r=>r.assetId+':'+r.requestId).join(' '));
