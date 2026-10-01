from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/opt/.devin/google-chrome.sh',args=['--no-sandbox'])
    pg=b.new_page(viewport={'width':1536,'height':1024}); errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto('http://localhost:5398/ramp-prototypes/exitlane/',wait_until='networkidle'); pg.wait_for_timeout(800)
    for val in ['{garbage','{"bookings":"x","epoch":-1}','null']:
        pg.evaluate("([k,v])=>localStorage.setItem(k,v)",['exitlane:v1',val]); pg.reload(wait_until='networkidle'); pg.wait_for_timeout(800)
        t=pg.inner_text('body'); i=t.find('$550')
        print(repr(val[:20]),'mode', 'browser sandbox' in t.lower(), 'has550', i>=0, 'notice', [l for l in t.split('\n') if 'storage' in l.lower() or 'restor' in l.lower()][:2])
    print('errors',errs[:3])
    pg.screenshot(path='/home/ubuntu/review-shots/exit2-static-corrupt.png')
    b.close()
