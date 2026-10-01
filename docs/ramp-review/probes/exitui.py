import re
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/opt/.devin/google-chrome.sh',args=['--no-sandbox'])
    pg=b.new_page(viewport={'width':1536,'height':1024}); pg.goto('http://localhost:5315/',wait_until='networkidle')
    btn=lambda n: pg.get_by_role('button',name=re.compile(n,re.I)).first
    btn('reset').click(); pg.wait_for_timeout(800)
    print('buttons',[x.inner_text().strip() for x in pg.get_by_role('button').all()][:25])
    print('scrollH',pg.evaluate('document.documentElement.scrollHeight'))
    pg.screenshot(path='/home/ubuntu/review-shots/exit-1536-initial.png')
    for n in ['cancel','prepare','approve','execute']:
        try: btn(n).click(timeout=4000); pg.wait_for_timeout(900)
        except Exception as e: print('step fail',n,str(e)[:60])
    pg.screenshot(path='/home/ubuntu/review-shots/exit-1536-executed.png')
    t=pg.inner_text('body')
    for w in ['sent','Sent','refund received','Refund received','EDT','EST','UTC','Browser sandbox','SQLite','55,000','$550']:
        i=t.find(w); print(repr(w), t[max(0,i-60):i+60].replace('\n',' | ') if i>=0 else '-')
    m=b.new_page(viewport={'width':390,'height':844}); m.goto('http://localhost:5315/',wait_until='networkidle'); m.wait_for_timeout(500)
    print('mobile sw',m.evaluate('document.documentElement.scrollWidth'))
    m.screenshot(path='/home/ubuntu/review-shots/exit-mobile.png',full_page=True)
    b.close()
