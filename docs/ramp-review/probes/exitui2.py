import re
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/opt/.devin/google-chrome.sh',args=['--no-sandbox'])
    pg=b.new_page(viewport={'width':1536,'height':1024}); pg.goto('http://localhost:5315/',wait_until='networkidle')
    btn=lambda n: pg.get_by_role('button',name=re.compile(n,re.I)).first
    btn('^reset').click(); pg.wait_for_timeout(800)
    print('initial scrollH',pg.evaluate('document.documentElement.scrollHeight'))
    pg.screenshot(path='/home/ubuntu/review-shots/exit2-1536-initial.png')
    for n in ['^cancel event','review cancellation packet']:
        try: btn(n).click(timeout=4000); pg.wait_for_timeout(900)
        except Exception as e: print('fail',n,str(e)[:50])
    print('dialog buttons',[x.inner_text().strip()[:40] for x in pg.get_by_role('button').all() if x.is_visible()][:30])
    for n in ['approve','execute|run|send']:
        try: btn(n).click(timeout=4000); pg.wait_for_timeout(1200)
        except Exception as e: print('fail',n,str(e)[:50])
    try: pg.keyboard.press('Escape'); pg.wait_for_timeout(500)
    except: pass
    print('after scrollH',pg.evaluate('document.documentElement.scrollHeight'))
    t=pg.inner_text('body'); i=t.find('Cancellation summary'); print('SUMMARY',t[i:i+500].replace('\n',' | '))
    pg.screenshot(path='/home/ubuntu/review-shots/exit2-1536-executed.png')
    m=b.new_page(viewport={'width':390,'height':844}); m.goto('http://localhost:5315/',wait_until='networkidle'); m.wait_for_timeout(600)
    print('mobile sw',m.evaluate('document.documentElement.scrollWidth'))
    m.screenshot(path='/home/ubuntu/review-shots/exit2-390.png',full_page=True)
    b.close()
