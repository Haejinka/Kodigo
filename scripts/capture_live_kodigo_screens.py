from pathlib import Path

from playwright.sync_api import sync_playwright

out = Path('deliverables/live_kodigo_screens')
out.mkdir(parents=True, exist_ok=True)
email = __import__('os').environ['KODIGO_SCREENSHOT_EMAIL']
password = __import__('os').environ['KODIGO_SCREENSHOT_PASSWORD']

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1280, 'height': 900}, device_scale_factor=1)
    page.goto('http://localhost:5173/login', wait_until='networkidle')
    page.screenshot(path=str(out / 'figure-03-login.png'), full_page=True)
    page.locator('input[type="email"]').fill(email)
    page.locator('input[type="password"]').fill(password)
    page.get_by_role('button', name='Sign in').click()
    page.wait_for_url('**/dashboard', timeout=15000)
    routes = [
        ('figure-04-dashboard.png', '/dashboard'),
        ('figure-05-pos.png', '/pos'),
        ('figure-06-inventory.png', '/inventory'),
        ('figure-07-suppliers.png', '/suppliers'),
        ('figure-08-settings-security.png', '/settings/security'),
    ]
    for filename, route in routes:
        page.goto('http://localhost:5173' + route, wait_until='networkidle')
        page.screenshot(path=str(out / filename), full_page=True)
    browser.close()
print(out)
