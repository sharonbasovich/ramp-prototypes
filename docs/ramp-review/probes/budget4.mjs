const B='http://localhost:5314/api';
const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b??{})}).then(async r=>[r.status,await r.json().catch(()=>null)]);
const st=()=>fetch(B+'/state').then(r=>r.json()).then(j=>j.result);
await post('/reset'); let s=await st(); const epoch=s.epoch??s.wallet?.epoch; console.log('epoch',epoch,'wallet',JSON.stringify(s.wallet).slice(0,200));
const rs=await Promise.all(Array.from({length:20},(_,i)=>post('/requests',{epoch,requestId:'rv-'+i,agentId:i%2?'ben':'ada',itemId:'monitor',qty:1})));
const tally={}; for(const [c,j] of rs){const k=c+':'+(j?.result?.status??j?.error?.code);tally[k]=(tally[k]||0)+1} console.log('20 concurrent',tally);
s=await st(); const w=s.totals; console.log('totals',JSON.stringify(w).slice(0,240),'invariant',(w.spentMinor+w.reservedMinor)<=w.budgetMinor);
console.log('stale epoch',(await post('/requests',{epoch:epoch-1,requestId:'old',agentId:'ada',itemId:'keyboard',qty:1}))[1]?.error?.code);
// expiry swept on command path (no GET in between)
await post('/reset'); s=await st(); const e2=s.epoch??s.wallet?.epoch;
console.log('config',JSON.stringify((await post('/config',{epoch:e2,quoteTtlMs:1000}))).slice(0,160));
s=await st(); const e3=s.epoch??s.wallet?.epoch;
const [c1,r1]=await post('/requests',{epoch:e3,requestId:'exp-1',agentId:'ada',itemId:'monitor',qty:1}); console.log('placed',c1,r1?.result?.status);
await new Promise(r=>setTimeout(r,1600));
const [c2,r2]=await post('/requests/exp-1/approve',{epoch:e3}); console.log('approve after ttl',c2,JSON.stringify(r2).slice(0,220));
const [c3,r3]=await post('/requests',{epoch:e3,requestId:'exp-2',agentId:'ben',itemId:'keyboard',qty:1}); console.log('next place',c3,r3?.result?.status);
