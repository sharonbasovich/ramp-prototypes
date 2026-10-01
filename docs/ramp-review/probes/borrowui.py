from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/opt/.devin/google-chrome.sh',args=['--no-sandbox'])
    pg=b.new_page(viewport={'width':1536,'height':1024}); pg.goto('http://localhost:5313/',wait_until='networkidle')
    pg.get_by_role('button',name='Reset demo').click(); pg.wait_for_timeout(1000)
    print([x.inner_text() for x in pg.get_by_role('button').all()][:25])
    try:
        pg.get_by_role('button',name='Find available equipment').click(); pg.wait_for_timeout(800)
        oc=pg.get_by_role('button',name='Request from owner')
        if oc.count(): oc.first.click(); pg.wait_for_timeout(800)
    except Exception as e: print('err',e)
    for k in ['Potential spending avoided','Proposed solution','Confirm and reserve']:
        bb=pg.get_by_text(k).first.bounding_box(); print('pre',k,round(bb['y']+bb['height']) if bb else None)
    pg.screenshot(path='/home/ubuntu/review-shots/borrow2-pre.png')
    pg.get_by_role('button',name='Confirm and reserve').click(); pg.wait_for_timeout(1500)
    t=pg.inner_text('body'); i=t.find('3. Review'); print('POST:',t[i:i+500].replace('\n',' | '))
    pg.screenshot(path='/home/ubuntu/review-shots/borrow2-post.png')
    m=b.new_page(viewport={'width':390,'height':844}); m.goto('http://localhost:5313/',wait_until='networkidle'); m.wait_for_timeout(500)
    print('mobile sw',m.evaluate('document.documentElement.scrollWidth'))
    m.screenshot(path='/home/ubuntu/review-shots/borrow2-mobile.png',full_page=True)
    b.close()
