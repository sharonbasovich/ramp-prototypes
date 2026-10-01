const post=(u,b)=>fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b??{})}).then(async r=>({s:r.status,b:await r.json().catch(()=>null)}));
const W='http://localhost:5313/api';
await post(W+'/reset'); await post(W+'/owner-confirm',{assetId:'M-204'});
const al=await post(W+'/allocate',{}); const plan=al.b.plan; const request=plan.request;
console.log('plan status',plan.status,'cost',plan.totalCostCents,'baseline',plan.baseline?.totalCents??JSON.stringify(plan.baseline).slice(0,80),'avoided',plan.potentialAvoidedCents,'transfers',plan.transfers.map(t=>t.assetId).join(','));
const rs=await Promise.all(Array.from({length:10},(_,i)=>post(W+'/reserve',{request:{...request,id:'race-'+i},plan:{...plan,request:{...request,id:'race-'+i}}})));
const t={}; rs.forEach(r=>t[r.s]=(t[r.s]||0)+1); console.log('borrow 10 parallel reserve same plan',t);
const st=await fetch(W+'/state').then(r=>r.json());
const res=(st.world.reservations||[]).filter(r=>r.status==='active'||r.status==='confirmed'); console.log('active reservations',res.length,JSON.stringify(res.map(r=>[r.assetId,r.requestId,r.status])));
