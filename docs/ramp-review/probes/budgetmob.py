from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/opt/.devin/google-chrome.sh',args=['--no-sandbox'])
    m=b.new_page(viewport={'width':390,'height':844}); m.goto('http://localhost:5314/',wait_until='networkidle'); m.wait_for_timeout(500)
    print('sw',m.evaluate('document.documentElement.scrollWidth'),'over',m.evaluate('[...document.querySelectorAll("*")].filter(e=>e.getBoundingClientRect().right>391).map(e=>e.tagName+"."+e.className).slice(0,5)'))
    m.screenshot(path='/home/ubuntu/review-shots/budget-final-390.png',full_page=True)
    b.close()
