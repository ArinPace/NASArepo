"""Record the 30-second demo: a captioned screen recording of the game.

Needs Python Playwright, a Chrome or Chromium binary and ffmpeg.
    python3 demo/make_demo.py --team "Team name"
Writes docs/demo.mp4 (under 30 seconds, captions burned in, no sound).
"""
import argparse, json, os, pathlib, shutil, subprocess, time
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument('--team', default='', help='team name for the first caption')
ap.add_argument('--chrome', default=os.environ.get('CHROME', '/usr/bin/google-chrome'))
ap.add_argument('--seed', type=int, default=1012, help='world number: one where the launch weather call comes up')
ap.add_argument('--out', default=str(ROOT / 'docs' / 'demo.mp4'))
args = ap.parse_args()

W, H = 1280, 720
PLAYERS = ['Ana', 'Ben', 'Chidi', 'Dee']
OVERLAY = """
(() => {
  const el = document.createElement('div');
  el.id = 'demo-caption';
  el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;padding:14px 28px 12px;background:rgba(7,10,18,.93);border-top:2px solid #f4c152;font-family:"Atkinson Hyperlegible",system-ui,sans-serif;color:#f3efe6;display:flex;flex-direction:column;gap:4px;align-items:center;text-align:center';
  el.innerHTML = '<div id="demo-line" style="font-size:30px;font-weight:700;line-height:1.2"></div><div style="font-size:13px;color:#8fa0bd;letter-spacing:.04em">Screen recording of the game. The game code was written with an AI assistant (Claude).</div>';
  document.body.appendChild(el);
})()
"""

shots = []  # (start, end) in seconds of the raw recording


def main():
    tmp = ROOT / '.cache' / 'demo-raw'
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    with sync_playwright() as p:
        br = p.chromium.launch(executable_path=args.chrome, args=['--no-sandbox', '--force-device-scale-factor=1'])
        ctx = br.new_context(viewport={'width': W, 'height': H}, record_video_dir=str(tmp), record_video_size={'width': W, 'height': H})
        t0 = time.time()
        pg = ctx.new_page()
        url = (ROOT / 'docs' / 'index.html').as_uri()
        pg.goto(url); pg.wait_for_timeout(500)
        # Fix the world number and seat four players, then reload so the game restores that state.
        pg.evaluate("""([seed, players]) => { const s = JSON.parse(localStorage.getItem('go-no-go-v1')); s.seed = seed; s.players = players; s.stage = 'setup'; localStorage.setItem('go-no-go-v1', JSON.stringify(s)); }""", [args.seed, PLAYERS])
        pg.reload(); pg.wait_for_timeout(900)
        pg.evaluate(OVERLAY)
        # A sync flash: the caption bar turns magenta for a moment. Finding it in the
        # recording tells us how far the recording's clock is from this script's clock.
        pg.wait_for_timeout(600)
        pg.evaluate("() => { document.getElementById('demo-caption').style.background = '#ff00ff'; }")
        sync_wall = time.time() - t0
        pg.wait_for_timeout(400)
        pg.evaluate("() => { document.getElementById('demo-caption').style.background = 'rgba(7,10,18,.93)'; }")
        pg.wait_for_timeout(600)

        def caption(text):
            pg.evaluate("t => { document.getElementById('demo-line').textContent = t; }", text)

        def scroll(sel=None, top=None, smooth=True, offset=90):
            if sel:
                pg.evaluate("([s, o, sm]) => { const el = [...document.querySelectorAll('h2, h3')].find(h => h.textContent.trim().toLowerCase().startsWith(s)); window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - o, behavior: sm ? 'smooth' : 'instant' }); }", [sel.lower(), offset, smooth])
            else:
                pg.evaluate("([t, sm]) => window.scrollTo({ top: t, behavior: sm ? 'smooth' : 'instant' })", [top, smooth])

        class Shot:
            def __init__(self, text, seconds): self.text, self.seconds = text, seconds
            def __enter__(self):
                caption(self.text); pg.wait_for_timeout(350)
                self.start = time.time() - t0
                return self
            def __exit__(self, *a):
                left = self.seconds - (time.time() - t0 - self.start)
                if left > 0: pg.wait_for_timeout(int(left * 1000))
                shots.append((self.start, self.start + self.seconds))
                pg.wait_for_timeout(400)  # hold the picture a moment so the cut never shows the next screen

        def all_go():
            for b in pg.get_by_role('button', name='GO', exact=True).all(): b.click()

        # 1. start screen
        scroll(top=0, smooth=False)
        with Shot((f'{args.team}  ·  ' if args.team else '') + 'Challenge: Space Mission Design Game', 3.0):
            pass
        pg.get_by_role('button', name='Begin Pre-Phase A').click(); pg.wait_for_timeout(400)

        # 2. pitch: pick the science
        scroll('science objectives', smooth=False, offset=20); pg.wait_for_timeout(200)
        with Shot('GO / NO-GO: design a real mission to asteroid Apophis', 3.0):
            pg.wait_for_timeout(500); pg.get_by_role('checkbox', name='Watch it change').dispatch_event('click')
            pg.wait_for_timeout(700); pg.get_by_role('checkbox', name='What it is made of').dispatch_event('click')
        all_go(); pg.get_by_role('button', name='Phase A: choose the route').click(); pg.wait_for_timeout(600)

        # 3. route: walk the launch date to the good window
        scroll('launch chart', smooth=False, offset=20); pg.wait_for_timeout(300)
        with Shot('Real orbits. The game finds the launch window ESA chose', 4.5):
            pg.wait_for_timeout(500)
            for _ in range(10):  # dispatched clicks, so the page does not scroll to the buttons
                pg.get_by_role('button', name='Launch 5 days earlier').dispatch_event('click'); pg.wait_for_timeout(190)
            pg.wait_for_timeout(250)
            pg.get_by_role('button', name='Best arrival for this launch').dispatch_event('click')
        all_go(); pg.get_by_role('button', name='Phase B: design the spacecraft').click(); pg.wait_for_timeout(600)

        # 4. design: the snowball
        pg.get_by_role('button', name='Two-propellant engine').click()
        pg.get_by_role('button', name='Precise pointing').click()
        pg.get_by_role('button', name='1 m dish').click(); pg.wait_for_timeout(200)
        scroll('instruments', smooth=False, offset=20); pg.wait_for_timeout(300)
        with Shot('Every part drags mass, power and cost with it', 3.5):
            pg.wait_for_timeout(500); pg.get_by_role('checkbox', name='Visible-infrared spectrometer').dispatch_event('click')
            pg.wait_for_timeout(600); pg.get_by_role('checkbox', name='Telescopic camera').dispatch_event('click')
            pg.wait_for_timeout(500); scroll(top=0)
        # 5. a thousand flights
        scroll('a thousand flights', smooth=False, offset=20); pg.wait_for_timeout(300)
        with Shot('Fly it 1,000 times before you commit', 3.0):
            pg.wait_for_timeout(500); pg.get_by_role('button', name='Fly this design 1,000 times').dispatch_event('click')
        # 6. the poll
        scroll('go / no-go poll', smooth=False, offset=60); pg.wait_for_timeout(300)
        with Shot('Every console votes GO or NO-GO', 3.0):
            pg.wait_for_timeout(450)
            for b in pg.get_by_role('button', name='GO', exact=True).all():
                b.dispatch_event('click'); pg.wait_for_timeout(380)
        pg.get_by_role('button', name='Phase C and D: build and test').click(); pg.wait_for_timeout(500)
        all_go(); pg.get_by_role('button', name='Launch', exact=True).click(); pg.wait_for_timeout(500)

        # 7. a call in flight
        scroll(top=0, smooth=False)
        try:  # let the film reach launch day by itself, so it keeps playing after the call
            pg.locator('.poll.call').wait_for(timeout=20000)
        except Exception:
            raise SystemExit('no call came up on launch day: choose another --seed')
        with Shot('Then make the calls in flight', 3.5):
            pg.wait_for_timeout(1500); pg.locator('.poll.call button.card').first.dispatch_event('click')
            pg.wait_for_timeout(150); pg.get_by_role('button', name='Faster').dispatch_event('click')
        for _ in range(30):  # finish the flight, taking the second option at each remaining call
            pg.wait_for_timeout(200)
            if pg.get_by_role('button', name='Read the debrief').count(): break
            call = pg.locator('.poll.call')
            if call.count():
                opts = call.locator('button.card').all(); opts[min(1, len(opts) - 1)].click(); continue
            skip = pg.locator('button', has_text='Skip to the')
            if skip.count() and skip.first.is_enabled(): skip.first.click()
        pg.get_by_role('button', name='Read the debrief').click(); pg.wait_for_timeout(600)

        # 8. the debrief
        scroll(top=0, smooth=False); pg.wait_for_timeout(200)
        with Shot('See which decision made the difference', 3.5):
            pg.wait_for_timeout(1500); scroll('why it happened', offset=30)
        print('headline:', pg.locator('h2').first.inner_text(), '| score', pg.locator('.score').first.inner_text())

        # 9. the other world: Ice Hunter
        scroll('try again', smooth=False, offset=200); pg.wait_for_timeout(200)
        pg.get_by_role('button', name='New mission').click(); pg.wait_for_timeout(400)
        pg.locator('button.card', has_text='Ice Hunter').click(); pg.wait_for_timeout(200)
        pg.get_by_role('button', name='Begin Pre-Phase A').click(); pg.wait_for_timeout(300)
        all_go(); pg.get_by_role('button', name='Phase A: choose the route').click(); pg.wait_for_timeout(500)
        pg.locator('button.card', has_text='50 km orbit').dispatch_event('click'); pg.wait_for_timeout(200)
        scroll('how long will you map', smooth=False, offset=300); pg.wait_for_timeout(300)
        with Shot('Also inside: hunt for ice at the Moon\u2019s south pole', 2.5):
            pg.wait_for_timeout(900); pg.locator('button.card', has_text='12 months').dispatch_event('click')
        video = pg.video
        ctx.close()
        wall = time.time() - t0
        br.close()
        raw = video.path()

    # Find the sync flash in the recording and shift every cut by the difference.
    from PIL import Image
    frames = tmp / 'sync'
    frames.mkdir()
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-t', str(sync_wall + 3), '-i', str(raw), '-vf', f'fps=25,crop={W}:20:0:{H - 30},scale=64:2', str(frames / 'f%04d.png')], check=True)
    seen = None
    for k, f in enumerate(sorted(frames.glob('f*.png'))):
        r, g, b = Image.open(f).convert('RGB').getpixel((32, 1))
        if r > 200 and g < 90 and b > 200:
            seen = k / 25
            break
    if seen is None: raise SystemExit('could not find the sync flash in the recording')
    lag = sync_wall - seen
    print('recording lag', round(lag, 2), 's')
    shots[:] = [(a - lag, b - lag) for a, b in shots]
    total = sum(b - a for a, b in shots)
    print('shots:', json.dumps([(round(a, 2), round(b, 2)) for a, b in shots]), 'total', round(total, 2))
    assert total <= 29.9, 'the demo must stay under 30 seconds'
    parts = ''.join(f'[0:v]trim=start={a:.3f}:end={b:.3f},setpts=PTS-STARTPTS[v{k}];' for k, (a, b) in enumerate(shots))
    graph = parts + ''.join(f'[v{k}]' for k in range(len(shots))) + f'concat=n={len(shots)}:v=1:a=0,fps=30,format=yuv420p[v]'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(raw), '-filter_complex', graph, '-map', '[v]', '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart',
                    '-metadata', 'title=GO / NO-GO demo', '-metadata', 'comment=Screen recording of the game. Game code written with Claude, an AI assistant.', args.out], check=True)
    print('wrote', args.out)


main()
