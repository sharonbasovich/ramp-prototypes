from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/opt/.devin/google-chrome.sh',args=['--no-sandbox'])
    pg=b.new_page(viewport={'width':1536,'height':1024}); pg.goto('http://localhost:5314/',wait_until='networkidle')
    pg.get_by_role('button',name='Reset sandbox').click(); pg.wait_for_timeout(800)
    pg.get_by_role('button',name='▶ Launch simultaneous requests').click(); pg.wait_for_timeout(2500)
    print('scrollH',pg.evaluate('document.documentElement.scrollHeight'))
    print(pg.inner_text('body')[:900].replace('\n',' | '))
    pg.screenshot(path='/home/ubuntu/review-shots/budget-final-1536-launched.png')
    m=b.new_page(viewport={'width':390,'height':844}); m.goto('http://localhost:5314/',wait_until='networkidle'); m.wait_for_timeout(800)
    print('mobile launched sw',m.evaluate('document.documentElement.scrollWidth'))
    m.screenshot(path='/home/ubuntu/review-shots/budget-final-390-launched.png',full_page=True)
    b.close()
