# 1536x1024 above-the-fold check: where do the key result blocks land after the primary action?
import sys
from playwright.sync_api import sync_playwright
APPS={'cart':(5311,'Find the cheapest order',['Optimized plan','less']),
 'pay':(5312,'Send 10 requests at once →',['Duplicate blocked','payments recorded']),
 'borrow':(5313,'Find available equipment',['Potential spending avoided','Proposed solution']),
 'budget':(5314,'▶ Launch simultaneous requests',['Prevented over-budget','Available','Time'])}
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/opt/.devin/google-chrome.sh',args=['--no-sandbox'])
    for n,(port,btn,keys) in APPS.items():
        pg=b.new_page(viewport={'width':1536,'height':1024})
        pg.goto(f'http://localhost:{port}/',wait_until='networkidle')
        try: pg.get_by_role('button',name=btn).first.click(timeout=5000); pg.wait_for_timeout(1500)
        except Exception as e: print(n,'click fail',str(e)[:80])
        for k in keys:
            loc=pg.get_by_text(k,exact=False).first
            try: bb=loc.bounding_box(timeout=3000); print(n,repr(k),'top=',round(bb['y']) if bb else None,'IN' if bb and bb['y']+bb['height']<=1024 else 'BELOW')
            except Exception: print(n,repr(k),'not found')
        print(n,'pageHeight',pg.evaluate('document.documentElement.scrollHeight'))
        pg.screenshot(path=f'/home/ubuntu/review-shots/fold-{n}.png')
    b.close()
