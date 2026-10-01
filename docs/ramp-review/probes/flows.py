import asyncio, sys, os
from playwright.async_api import async_playwright
CH='/opt/.devin/google-chrome.sh'
OUT='/home/ubuntu/review-shots/flows'; os.makedirs(OUT,exist_ok=True)
log=open(OUT+'/flows.log','w')
async def snap(pg,name):
    await pg.wait_for_timeout(700)
    await pg.screenshot(path=f'{OUT}/{name}.png')
    t=await pg.inner_text('body'); open(f'{OUT}/{name}.txt','w').write(t)
    log.write(f'\n===== {name}\n{t[:3000]}\n'); log.flush()
async def dl(pg,click,name):
    try:
        async with pg.expect_download(timeout=5000) as d: await click()
        dd=await d.value; p=f'{OUT}/{name}-{dd.suggested_filename}'; await dd.save_as(p); log.write(f'\nDOWNLOAD {p}\n'+open(p,errors='ignore').read()[:2500]+'\n')
    except Exception as e: log.write(f'\nDOWNLOAD FAIL {name} {e}\n')
async def step(desc,coro):
    try: await coro
    except Exception as e: log.write(f'\nSTEP FAIL {desc}: {str(e)[:300]}\n')
async def cart(b,base,tag):
    pg=await b.new_page(viewport={'width':1536,'height':1024},accept_downloads=True); await pg.goto(base); await pg.wait_for_timeout(1200)
    await step('reset',pg.get_by_role('button',name='Reset demo').click()); await snap(pg,f'cart-{tag}-0-initial')
    await step('deadline1',pg.select_option('#deadline',index=0)); await snap(pg,f'cart-{tag}-1-deadline-changed-no-recalc')
    await step('find',pg.get_by_role('button',name='Find the cheapest order').click()); await snap(pg,f'cart-{tag}-2-1day')
    await step('deadline3',pg.select_option('#deadline',index=2)); await step('find',pg.get_by_role('button',name='Find the cheapest order').click())
    await step('approve',pg.get_by_role('button',name='Approve purchase plan').click()); await snap(pg,f'cart-{tag}-3-approved')
    await dl(pg,lambda: pg.get_by_role('button',name='Export plan').click(),f'cart-{tag}')
    await step('inc',pg.get_by_role('button',name='Increase Coffee').click()); await snap(pg,f'cart-{tag}-4-after-qty-change')
    exp=await pg.get_by_role('button',name='Export plan').is_disabled(); log.write(f'\ncart export disabled after change: {exp}\n')
    await step('find',pg.get_by_role('button',name='Find the cheapest order').click()); await snap(pg,f'cart-{tag}-5-coffee5')
    await pg.close()
async def pay(b,base,tag):
    pg=await b.new_page(viewport={'width':1536,'height':1024}); await pg.goto(base); await pg.wait_for_timeout(1200)
    await step('reset',pg.get_by_role('button',name='↻ Reset sandbox').click()); await pg.wait_for_timeout(500)
    for sc in ['Same invoice, different filename','Same invoice, new layout','Changed invoice number','Unreadable scan','Next month’s real bill']:
        await step(sc,pg.get_by_role('button',name=sc).click()); await step('validate',pg.get_by_role('button',name='Validate invoice →').click()); await pg.wait_for_timeout(500)
        await step('pay',pg.get_by_role('button',name='Try to get paid').click())
        await snap(pg,f'pay-{tag}-{sc[:18].replace(" ","_").replace("’","")}')
    await step('burst',pg.get_by_role('button',name='Send 10 requests at once').click()); await step('validate',pg.get_by_role('button',name='Validate invoice →').click()); await pg.wait_for_timeout(500)
    await step('pay',pg.get_by_role('button',name='Try to get paid').click()); await snap(pg,f'pay-{tag}-burst')
    await pg.mouse.wheel(0,900); await snap(pg,f'pay-{tag}-burst-scrolled')
    # changed input: edit amount on filename scenario
    await step('reset',pg.get_by_role('button',name='↻ Reset sandbox').click()); await pg.wait_for_timeout(500)
    await step('sc',pg.get_by_role('button',name='Changed invoice number').click())
    await step('amt',pg.locator('input[type=text]').nth(2).fill('481.00')); await step('validate',pg.get_by_role('button',name='Validate invoice →').click()); await snap(pg,f'pay-{tag}-changed-amount-481')
    await pg.close()
async def borrow(b,base,tag):
    pg=await b.new_page(viewport={'width':1536,'height':1024},accept_downloads=True); await pg.goto(base); await pg.wait_for_timeout(1200)
    await step('reset',pg.get_by_role('button',name='Reset demo').click()); await snap(pg,f'borrow-{tag}-0')
    await step('when',pg.select_option('#f-when',index=0)); await snap(pg,f'borrow-{tag}-1-tomorrow-before-find')
    await step('find',pg.get_by_role('button',name='Find available equipment').click()); await snap(pg,f'borrow-{tag}-2-tomorrow')
    await step('when',pg.select_option('#f-when',index=1)); await step('ports',pg.select_option('#f-ports',index=2)); await step('find',pg.get_by_role('button',name='Find available equipment').click()); await snap(pg,f'borrow-{tag}-3-usbc')
    await step('ports',pg.select_option('#f-ports',index=0)); await step('find',pg.get_by_role('button',name='Find available equipment').click())
    await step('owner',pg.get_by_role('button',name='Request from owner').first.click()); await snap(pg,f'borrow-{tag}-4-owner')
    await step('reserve',pg.get_by_role('button',name='Confirm and reserve').click()); await snap(pg,f'borrow-{tag}-5-reserved')
    await dl(pg,lambda: pg.get_by_role('button',name='Export purchase list').click(),f'borrow-{tag}')
    await step('qty',pg.select_option('#f-qty',index=3)); await step('find',pg.get_by_role('button',name='Find available equipment').click()); await snap(pg,f'borrow-{tag}-6-after-reserve-4mon')
    await pg.close()
async def budget(b,base,tag):
    pg=await b.new_page(viewport={'width':1536,'height':1024}); await pg.goto(base); await pg.wait_for_timeout(1200)
    await step('reset',pg.get_by_role('button',name='Reset sandbox').click()); await pg.wait_for_timeout(500)
    await step('launch',pg.get_by_role('button',name='▶ Launch simultaneous requests').click()); await snap(pg,f'budget-{tag}-1-launch')
    await pg.mouse.wheel(0,900); await snap(pg,f'budget-{tag}-1b-launch-scrolled')
    await step('cancel',pg.get_by_role('button',name='Cancel').first.click()); await snap(pg,f'budget-{tag}-2-cancel')
    await step('budget',pg.fill('#budget-input','150')); await pg.keyboard.press('Tab'); await snap(pg,f'budget-{tag}-3-budget150')
    await pg.close()
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=CH)
        for fn,slug,port in [(cart,'cart-tetris',5311),(pay,'pay-me-twice',5312),(borrow,'borrowfirst',5313),(budget,'budget-brawl',5314)]:
            for tag,url in [('sqlite',f'http://localhost:{port}/'),('static',f'http://localhost:5399/ramp-prototypes/{slug}/')]:
                await fn(b,url,tag)
        await b.close()
asyncio.run(main())
