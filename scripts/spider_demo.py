#!/usr/bin/env python3
"""Terminal walkthrough for demos: stream sample posts into a running engine and log what JEV finds.

Everything printed comes from the real engine: each post is sent through the
extension API, and leads, checks and events are read back from /api/state.
The posts themselves are the fictional ones from sample_signals.py.
"""
import argparse
import json
import os
from pathlib import Path
import sys
import time
from datetime import datetime
from urllib.error import URLError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sample_signals import ROOT, sample_posts

COLOR = sys.stdout.isatty() and not os.getenv('NO_COLOR')
RAINBOW = [(255, 107, 150), (255, 189, 115), (203, 241, 142), (113, 236, 230), (154, 154, 255), (236, 143, 252)]
TAGS = {'spider': (255, 143, 177), 'jev': (241, 207, 138), 'lead': (145, 229, 199), 'check': (154, 154, 255),
        'engine': (143, 144, 166), 'done': (236, 143, 252)}
KINDS = {'ticker': 'TICKER', 'contract': 'CONTRACT', 'phrase': 'NEW NARRATIVE', 'topic': 'TOPIC'}


def paint(text, rgb, bold=False):
    if not COLOR:
        return text
    return f"\033[{'1;' if bold else ''}38;2;{rgb[0]};{rgb[1]};{rgb[2]}m{text}\033[0m"


def dim(text):
    return f'\033[2m{text}\033[0m' if COLOR else text


def rainbow(text):
    if not COLOR:
        return text
    out, i = '', 0
    for char in text:
        if char.strip():
            r, g, b = RAINBOW[i * len(RAINBOW) // max(1, len(text.replace(' ', ''))) % len(RAINBOW)]
            out += f'\033[1;38;2;{r};{g};{b}m{char}'
            i += 1
        else:
            out += char
    return out + '\033[0m'


def log(tag, message, pause=0.0):
    stamp = dim(datetime.now().strftime('%H:%M:%S'))
    print(f'{stamp} {paint(f"[{tag}]".ljust(9), TAGS[tag], True)} {message}', flush=True)
    time.sleep(pause)


def banner():
    spider = [
        '        \\   \\    /   /',
        '     ____\\   \\  /   /____',
        '          \\  (oo)  /',
        '     _____/ /    \\ \\_____',
        '         /  /    \\  \\',
        '        /  /      \\  \\',
    ]
    print()
    for line in spider:
        print('   ' + rainbow(line))
    print('\n   ' + rainbow('g e m s e a r c h') + dim('  ·  emerging signals walkthrough'))
    print('   ' + dim('local engine · visible posts · receipts kept') + '\n')


def call(base, path, body=None, key=''):
    headers = {'Content-Type': 'application/json'}
    if key:
        headers['X-Gem-Extension'] = key
    data = None if body is None else json.dumps(body).encode()
    with urlopen(Request(base + path, data, headers), timeout=10) as response:
        return json.loads(response.read())


def ago(seconds):
    hours = (time.time() - seconds) / 3600
    return f'{hours:.0f}h ago' if hours >= 1 else f'{hours * 60:.0f}m ago'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--speed', type=float, default=1.0, help='2 = twice as fast')
    args = parser.parse_args()
    base = f'http://127.0.0.1:{args.port}'
    step = .45 / max(args.speed, .1)
    banner()
    try:
        key = (ROOT / 'data' / 'extension-key').read_text().strip()
        before = call(base, '/api/state')
    except (OSError, URLError):
        sys.exit(f'Engine is not reachable on {base}. Start it first: python3 app.py')
    seen_events = {e['id'] for e in before['events']}
    log('engine', f'connected to {base} · Grok {"on" if (before.get("grok") or {}).get("enabled") else "off, local checks only"}', step)
    log('spider', 'released on the visible feed · walking between posts', step * 2)

    posts = sorted(sample_posts(), key=lambda p: p['created_at'])
    accepted = 0
    for post in posts:
        author = post['url'].split('/')[3]
        stamp = datetime.fromisoformat(post['created_at']).timestamp()
        text = post['text'].replace(' (sample)', '')
        text = text if len(text) <= 64 else text[:61] + '…'
        result = call(base, '/api/extension/ingest', {'posts': [post]}, key)
        accepted += result['accepted']
        status = paint('captured', TAGS['lead']) if result['accepted'] else dim('already seen')
        log('spider', f'{status} @{author} {dim(ago(stamp))}  {text}', step)
    if not accepted:
        log('engine', paint('nothing new: these sample posts were captured before.', TAGS['spider']))
        log('engine', 'for a clean run stop the engine, delete the data folder, start it again.')
        return

    log('jev', f'{accepted} posts queued · dedup by status id · grouping topics, $tickers, addresses, phrases', step)
    deadline, frames, state = time.time() + 40, '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏', None
    while time.time() < deadline:
        state = call(base, '/api/state')
        if state['spider'] and state['spider']['pending'] == 0 and not state['state']['running']:
            break
        frame = frames[int(time.time() * 10) % len(frames)]
        if COLOR:print(f"\r{dim(datetime.now().strftime('%H:%M:%S'))} {paint('[jev]'.ljust(9), TAGS['jev'], True)} {frame} crunching the sample…", end='', flush=True)
        time.sleep(.1)
    if COLOR:print('\r' + ' ' * 70 + '\r', end='')

    for event in reversed(state['events']):
        if event['id'] not in seen_events:
            log('engine', dim(event['message']), step / 2)

    leads = [p for p in state['projects'] if p.get('source') == 'spider' and p.get('kind')]
    order = {'phrase': 0, 'ticker': 1, 'contract': 2, 'topic': 3}
    for p in sorted(leads, key=lambda p: (order.get(p['kind'], 9), -p['signals']['authors'])):
        s = p['signals']
        growth = f"×{s['growth']} vs prev 18h" if s.get('growth') is not None else 'no growth baseline yet'
        label = paint(KINDS[p['kind']].ljust(13), TAGS['lead'], True)
        log('lead', f"{label} {p['name']}", step / 2)
        log('lead', dim(f"              {s['mentions']} mentions · {s['authors']} authors · {s['recent']} in last 6h · {growth}"), step / 2)
        votes = '  '.join(paint(v['seat'], TAGS['lead'] if v['vote'] == 'pass' else TAGS['jev']) + dim(':' + v['vote']) for v in p['votes'])
        verdict = {'shortlisted': paint('SHORTLIST', TAGS['lead'], True), 'held': paint('NEEDS DATA', TAGS['jev'], True),
                   'rejected': paint('REJECTED', TAGS['spider'], True)}[p['status']]
        log('check', f"              {votes}  →  {verdict}" + (dim('  · research only') if p.get('research_only') else ''), step)

    fastest = max(leads, key=lambda p: p['signals'].get('growth') or 0, default=None)
    if fastest and fastest['signals'].get('growth'):
        log('done', rainbow(f"fastest growing: {fastest['name']}  ×{fastest['signals']['growth']}"), step)
    log('done', f"{len(leads)} leads ready · open {paint(base, TAGS['done'], True)} → Discovery → sort by Fastest growing")
    print()


if __name__ == '__main__':
    main()
