const P='http://localhost:5312/api';
const post=(p,b)=>fetch(P+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json().then(j=>[r.status,j]));
await post('/reset',{});
const [,d]=await post('/documents',{filename:'partial.txt',contentBase64:Buffer.from('Invoice No: ZZ-77\nFrom: Other Vendor LLC\n').toString('base64')});
console.log('doc fields',JSON.stringify(d.fields),'found',d.found);
const [,v]=await post('/validate',{facts:d.fields}); console.log('validate partial',v.verdict.status,v.verdict.reason??'');
const [,p]=await post('/pay',{requestId:'rv-partial',facts:d.fields}); console.log('pay partial',p.outcome??p.status,JSON.stringify(p).slice(0,200));
const facts={supplier:'Race Co',invoiceNumber:'RC-1',currency:'USD',amountCents:9999,period:'2026-11'};
const rs=await Promise.all(Array.from({length:20},(_,i)=>post('/pay',{requestId:'race-'+i,facts})));
const t={};rs.forEach(([s,j])=>{const k=s+':'+(j.outcome??j.status);t[k]=(t[k]||0)+1});console.log('race20',t);
for (const bad of [{...facts,invoiceNumber:'RC-2',amountCents:-5},{...facts,invoiceNumber:'RC-3',amountCents:1.5},{...facts,invoiceNumber:'RC-4',currency:'XXX'}]){const [s,j]=await post('/pay',{requestId:'bad-'+bad.invoiceNumber,facts:bad});console.log('bad',bad.invoiceNumber,s,j.outcome??j.status,(j.verdict?.reason??j.error??'').toString().slice(0,80));}
