"""Прогон всех примеров в браузере: ошибки, Serial, осциллограф, скриншоты.

Запуск: сначала сервер на 8080 (./start.sh), потом прогон.
  ./start.sh &
  LD_LIBRARY_PATH=/tmp/libsys/usr/lib/x86_64-linux-gnu python3 tests/probe_all.py
"""
import asyncio, json, pathlib
from playwright.async_api import async_playwright

URL = "http://127.0.0.1:8080/"
OUT = pathlib.Path(__file__).parent / "shots"
OUT.mkdir(exist_ok=True)

IDS = ["blink", "led", "button", "pot", "rc", "servo", "lcd", "oled",
       "dht", "sonar", "danger", "esp32", "pico", "pico-pwm", "two-boards",
       "rgb", "relay", "joystick", "seg7", "stepper", "power", "scope-pwm",
       "multimeter", "probe", "shift595", "motor", "keypad", "overvolt", "short", "rpi5-led"]


async def main():
    rep = {}
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])
        ctx = await b.new_context(viewport={"width": 1500, "height": 950}, locale="ru-RU")
        page = await ctx.new_page()
        errs, cons = [], []
        page.on("pageerror", lambda e: errs.append(str(e)[:300]))
        page.on("console", lambda m: cons.append((m.type, m.text[:200])))
        await page.goto(URL, wait_until="load", timeout=60000)
        await page.wait_for_timeout(2500)
        rep["boot"] = {
            "errors": list(errs),
            "parts": await page.evaluate("()=>document.querySelectorAll('#partsLayer .part').length"),
            "status": await page.evaluate("()=>document.getElementById('statusText').textContent"),
            "tabs": await page.evaluate("()=>[...document.querySelectorAll('.sketch-tab')].map(e=>e.innerText.replace(/\\n/g,' '))"),
        }

        for ex in IDS:
            errs.clear()
            await page.select_option("#exampleSelect", ex)
            await page.wait_for_timeout(3000)
            info = await page.evaluate("""()=>({
                status: document.getElementById('statusText').textContent,
                parts: document.querySelectorAll('#partsLayer .part').length,
                wires: document.querySelectorAll('#wiresLayer .wire').length,
                serial: document.getElementById('serialOut').innerText.slice(-220),
                warn: document.getElementById('warnText').textContent,
                problems: document.getElementById('problemsOut').innerText.slice(0,200),
                running: !document.getElementById('stopBtn').disabled,
                scope: !document.getElementById('scopeWrap').classList.contains('hidden'),
                channels: [...document.querySelectorAll('#scopeChannels select')].map(s=>s.selectedOptions[0]?.textContent||''),
                tabs: [...document.querySelectorAll('.sketch-tab')].map(e=>e.innerText.replace(/\\n/g,' ')),
            })""")
            info["errors"] = list(errs)
            info["console"] = [c for c in cons if c[0] == "error"][-3:]
            rep[ex] = info
            await page.screenshot(path=str(OUT / f"{ex}.png"))
            # осциллограф: есть ли ненулевые отсчёты
            if info["scope"]:
                await page.wait_for_timeout(700)
                rep[ex]["scope_data"] = await page.evaluate("""()=>{
                    const s = window.__sim.scope;
                    return s.channels.map(c => ({ on: c.on, label: c.source?.label || '', count: c.count }));
                }""")
            cons.clear()

        # проверка переключения плат в примере с двумя платами и запуск вручную
        await page.select_option("#exampleSelect", "two-boards")
        await page.wait_for_timeout(2500)
        tabs = await page.evaluate("()=>[...document.querySelectorAll('.sketch-tab')].map(e=>e.dataset.board)")
        if len(tabs) > 1:
            await page.click(f'.sketch-tab[data-board="{tabs[1]}"]')
            await page.wait_for_timeout(400)
        rep["two_boards_switch"] = {
            "tabs": tabs,
            "code_head": await page.evaluate("()=>document.getElementById('code').value.split('\\n')[0]"),
            "badge": await page.evaluate("()=>document.getElementById('langBadge').textContent"),
            "serial": await page.evaluate("()=>document.getElementById('serialOut').innerText.slice(-160)"),
        }
        await page.screenshot(path=str(OUT / "two_boards_switch.png"))

        rep["fatal_errors"] = errs
        await b.close()
    print(json.dumps(rep, ensure_ascii=False, indent=1))


asyncio.run(main())
