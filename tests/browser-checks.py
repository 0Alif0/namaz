from playwright.sync_api import sync_playwright

MOCK_PUSH = """
// Test double for the parts of the push stack a headless browser cannot provide.
// Everything downstream of these two objects is the real application code.
const fakeSubscription = {
  endpoint: 'https://web.push.apple.com/test-endpoint',
  toJSON: () => ({ endpoint: 'https://web.push.apple.com/test-endpoint',
                   keys: { p256dh: 'BTestPublicKey', auth: 'TestAuthSecret' } }),
  unsubscribe: async () => true,
};
let subscribed = null;
Object.defineProperty(navigator, 'serviceWorker', {
  configurable: true,
  value: {
    ready: Promise.resolve({
      pushManager: {
        getSubscription: async () => subscribed,
        subscribe: async () => { subscribed = fakeSubscription; return fakeSubscription; },
      },
    }),
    register: async () => ({}),
    addEventListener: () => {},
  },
});
window.PushManager = window.PushManager || function () {};
// Headless Chromium always reports Notification.permission as 'denied', so the
// permission object is doubled too. The state machine under test is untouched.
const N = function () {};
N.permission = 'granted';
N.requestPermission = async () => 'granted';
Object.defineProperty(window, 'Notification', { configurable: true, value: N });
"""

def state(pg):
    return {b.query_selector('.toggle-label').inner_text():
            b.query_selector('.toggle-state').inner_text()
            for b in pg.query_selector_all('.toggle')}

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width':393,'height':852}, device_scale_factor=2,
        geolocation={'latitude':40.64,'longitude':-73.98},
        permissions=['geolocation','notifications'],
        locale='en-US', timezone_id='America/New_York')
    ctx.grant_permissions(['geolocation','notifications'], origin='http://localhost:4173')
    ctx.add_init_script(MOCK_PUSH)
    pg = ctx.new_page()
    pg.on('console', lambda m: print('  console:', m.type, m.text[:200]))
    pg.on('pageerror', lambda e: print('  pageerror:', str(e)[:200]))
    pg.on('requestfailed', lambda r: print('  reqfail:', r.url, r.failure))
    pg.goto('http://localhost:4173/', wait_until='networkidle')
    pg.wait_for_timeout(1200)

    # 0. With permission refused the switches must snap back and say why.
    denied = ctx.new_page()
    denied.add_init_script("Object.defineProperty(window,'Notification',{configurable:true,value:Object.assign(function(){},{permission:'denied'})});")
    denied.goto('http://localhost:4173/', wait_until='networkidle'); denied.wait_for_timeout(900)
    denied.get_by_role('button', name='Enable all').click(); denied.wait_for_timeout(400)
    print('0. refused   ', state(denied), '->', denied.query_selector('.switch-message').inner_text()[:60])
    assert set(state(denied).values()) == {'OFF'}, 'must not claim to be on without permission'
    denied.close()

    print('1. initial   ', state(pg))
    assert set(state(pg).values()) == {'OFF'}, 'should start all off'

    pg.get_by_role('button', name='Enable all').click(); pg.wait_for_timeout(500)
    msg = pg.query_selector('.switch-message')
    print('   message:', msg.inner_text() if msg else None)
    print('2. enable all', state(pg))
    assert set(state(pg).values()) == {'ON'}

    pg.get_by_role('switch', name='Dhuhr').click(); pg.wait_for_timeout(400)
    print('3. dhuhr off ', state(pg))
    assert state(pg)['Dhuhr'] == 'OFF' and state(pg)['Fajr'] == 'ON'

    pg.get_by_role('switch', name='Dhuhr').click(); pg.wait_for_timeout(400)
    print('4. dhuhr on  ', state(pg))
    assert state(pg)['Dhuhr'] == 'ON'

    pg.get_by_role('button', name='Mute all').click(); pg.wait_for_timeout(500)
    print('5. mute all  ', state(pg))
    assert set(state(pg).values()) == {'OFF'}

    pg.reload(wait_until='networkidle'); pg.wait_for_timeout(1000)
    print('6. reloaded  ', state(pg))
    assert set(state(pg).values()) == {'OFF'}, 'mute must survive reload'

    pg.get_by_role('button', name='Enable all').click(); pg.wait_for_timeout(500)
    pg.reload(wait_until='networkidle'); pg.wait_for_timeout(1000)
    print('7. reloaded  ', state(pg))
    assert set(state(pg).values()) == {'ON'}, 'enable must survive reload'

    pg.screenshot(path='/tmp/shot-full.png', full_page=True)

    # Qibla overlay with no compass hardware -> honest fallback, not a fake needle.
    pg.click('.qibla-summary'); pg.wait_for_timeout(600)
    overlay = pg.inner_text('.overlay-card')
    print('8. overlay   ', ' | '.join(overlay.split('\n')))
    assert 'Compass unavailable' in overlay
    pg.screenshot(path='/tmp/shot-compass.png')
    pg.click('.overlay-card .button'); pg.wait_for_timeout(300)

    print('\nheader:', ' | '.join(pg.inner_text('.masthead').split('\n')))
    print('ALL BROWSER CHECKS PASSED')
    b.close()
