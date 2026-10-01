from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/opt/.devin/google-chrome.sh',args=['--no-sandbox'])
    for name,port in [('cart',5311),('pay',5312),('borrow',5313),('budget',5314)]:
        pg=b.new_page(viewport={'width':390,'height':844})
        pg.goto(f'http://localhost:{port}/',wait_until='networkidle'); pg.wait_for_timeout(800)
        r=pg.evaluate("""()=>{const W=document.documentElement.clientWidth;const o=[];for(const e of document.querySelectorAll('body *')){const r=e.getBoundingClientRect();if(r.right>W+1&&r.width>0){let s=e.tagName.toLowerCase()+(e.className&&typeof e.className==='string'?'.'+e.className.split(' ').slice(0,2).join('.'):'');o.push(s+' right='+Math.round(r.right)+' text='+(e.textContent||'').trim().slice(0,40))}}return {sw:document.documentElement.scrollWidth,W,o:o.slice(0,8)}}""")
        print(name,r['sw'],r['W']); [print('  ',x) for x in r['o']]
        pg.screenshot(path=f'/home/ubuntu/review-shots/overflow-{name}.png',full_page=True)
    b.close()
