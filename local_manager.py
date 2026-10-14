import os
import re
import sys
import time
import shutil
import secrets
import subprocess
import urllib.request
import urllib.error
import json
import threading
import queue
from pathlib import Path

# Windows-friendly local manager. Requires cloudflared installed and available on PATH.
LOCAL_PORT = 3000
HEARTBEAT_SECONDS = 60
URL_RE = re.compile(r'https://[a-zA-Z0-9-]+\.trycloudflare\.com')

def request_json(url, token=None, payload=None, timeout=15):
    data = None if payload is None else json.dumps(payload).encode('utf-8')
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(url, data=data, headers=headers, method='GET' if data is None else 'POST')
    with urllib.request.urlopen(req, timeout=timeout) as response:
        raw = response.read().decode('utf-8', errors='replace')
        return json.loads(raw) if raw else {}

def main():
    print('=== Local Cloudflare Tunnel → Render Bridge ===')
    render_url = input('Render service URL (e.g. https://your-bridge.onrender.com): ').strip().rstrip('/')
    if not render_url.startswith('https://'):
        print('ERROR: Use the HTTPS Render URL.')
        input('Press Enter to exit...')
        return

    token = input('REGISTER_TOKEN (same value set in Render Environment): ').strip()
    if len(token) < 24:
        print('ERROR: Token must be at least 24 characters.')
        input('Press Enter to exit...')
        return

    if not shutil.which('cloudflared'):
        print('ERROR: cloudflared not found on PATH. Install it first: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/')
        input('Press Enter to exit...')
        return

    print(f'Checking Render bridge: {render_url}/_health')
    try:
        print('Bridge status:', request_json(render_url + '/_health'))
    except Exception as exc:
        print('WARNING: Could not check health:', exc)
        print('Ensure the Render service is deployed and REGISTER_TOKEN is set correctly.')

    cmd = ['cloudflared', 'tunnel', '--url', f'http://127.0.0.1:{LOCAL_PORT}', '--no-autoupdate']
    print(f'Starting Quick Tunnel to http://127.0.0.1:{LOCAL_PORT} ...')
    print('Keep this window open. Press Ctrl+C to stop.')

    output_queue = queue.Queue()

    def start_tunnel():
        child = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1, encoding='utf-8', errors='replace'
        )
        def reader():
            for output_line in child.stdout:
                output_queue.put(('line', output_line.rstrip()))
            output_queue.put(('exit', child.returncode))
        threading.Thread(target=reader, daemon=True).start()
        return child

    proc = start_tunnel()
    current_url = None
    last_register = 0
    try:
        while True:
            try:
                kind, value = output_queue.get(timeout=0.5)
                if kind == 'line':
                    print('[cloudflared]', value)
                    match = URL_RE.search(value)
                    if match:
                        found = match.group(0)
                        if found != current_url:
                            current_url = found
                            last_register = 0
                            print('Detected tunnel:', current_url)
                elif kind == 'exit':
                    print('cloudflared exited. Restarting in 3 seconds...')
                    time.sleep(3)
                    proc = start_tunnel()
                    current_url = None
                    last_register = 0
            except queue.Empty:
                pass

            if proc.poll() is not None:
                continue

            if current_url and time.time() - last_register >= HEARTBEAT_SECONDS:
                try:
                    result = request_json(
                        render_url + '/_register',
                        token=token,
                        payload={'url': current_url},
                        timeout=20
                    )
                    print('[bridge]', result)
                    last_register = time.time()
                except Exception as exc:
                    print('[bridge] registration/heartbeat failed:', exc)
                    last_register = time.time() - HEARTBEAT_SECONDS + 10
    except KeyboardInterrupt:
        print('\nStopping tunnel...')
    finally:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            try: proc.kill()
            except Exception: pass
        print('Stopped.')

if __name__ == '__main__':
    main()
