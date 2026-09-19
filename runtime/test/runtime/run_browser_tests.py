#!/usr/bin/env python3
"""Real Chromium integration with a test-only Ego adapter and owned-process cleanup."""
import errno
import http.server
import json
import os
import pathlib
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
HTML = b'''<!doctype html><meta charset=utf-8><title>Commander controlled acceptance fixture</title><main><input id=q><input type=password value=synthetic-secret-value><button id=save>Save</button><button class=duplicate>Duplicate</button><button class=duplicate>Duplicate</button><div id=result>Not saved</div><div id=click-count>0</div></main><script>save.onclick=()=>{document.querySelector('#click-count').textContent=String(Number(document.querySelector('#click-count').textContent)+1);result.textContent='Saved '+q.value;};</script>'''


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(HTML)

    def log_message(self, *args):
        pass


def stop_owned_browser(browser, endpoint):
    """Close the exact fixture browser, then stop only its isolated process group."""
    if endpoint and browser.poll() is None:
        # Browser.close lets Chromium flush profile state before its leader exits.
        script = """const ws = new WebSocket(process.argv[1]);
const timer=setTimeout(()=>process.exit(2),2500);
ws.onopen=()=>ws.send(JSON.stringify({id:1,method:'Browser.close'}));
ws.onclose=()=>{clearTimeout(timer);process.exit(0)};
ws.onerror=()=>{clearTimeout(timer);process.exit(2)};"""
        try:
            subprocess.run(['node', '--input-type=module', '-e', script, endpoint],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=4)
        except subprocess.TimeoutExpired:
            pass  # Continue with termination of the owned process group.
    # The Popen leader may exit before its profile-writing children. They belong
    # to this new session, not to the user's browser or another test's browser.
    try:
        os.killpg(browser.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        browser.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(browser.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        browser.wait(timeout=5)


def remove_owned_profile(directory):
    """Retry only transient directory teardown, never browser actions or tests."""
    deadline = time.monotonic() + 3
    while True:
        try:
            shutil.rmtree(directory)
            return
        except FileNotFoundError:
            return
        except OSError as error:
            if error.errno not in (errno.ENOTEMPTY, errno.EEXIST) or time.monotonic() >= deadline:
                raise
            time.sleep(.05)


def main():
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    directory = pathlib.Path(tempfile.mkdtemp(prefix='navish-chrome-'))
    browser = None
    endpoint = None
    log = None
    try:
        log = (directory / 'chrome.log').open('w')
        browser = subprocess.Popen([
            os.environ.get('CHROMIUM_BIN', '/usr/bin/chromium'), '--headless', '--no-sandbox', '--disable-dev-shm-usage',
            '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + str(directory),
            'about:blank',
        ], stdout=log, stderr=log, start_new_session=True)
        deadline = time.monotonic() + 10
        active = directory / 'DevToolsActivePort'
        while not active.exists() and browser.poll() is None and time.monotonic() < deadline:
            time.sleep(.03)
        if not active.exists():
            raise RuntimeError('isolated Chromium did not start')
        port, browser_path = active.read_text().splitlines()
        endpoint = f'ws://127.0.0.1:{port}{browser_path}'
        (directory / 'fixture.html').write_bytes(HTML)
        env = {**os.environ, 'NAVISH_TEST_CDP': endpoint,
               'NAVISH_TEST_HTML': str(directory / 'fixture.html'),
               'NAVISH_TEST_WEB': f'http://127.0.0.1:{server.server_port}',
               'NAVISH_TEST_SPACES': str(directory / 'spaces.json'),
               'NAVISH_TEST_ERRORS': str(ROOT / 'test/runtime/fixture-errors.log')}
        result = subprocess.run(['node', '--test', str(ROOT / 'test/runtime/browser-jobs.test.mjs')],
                                env=env, cwd=ROOT, timeout=35)
        return result.returncode
    finally:
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=5)
        try:
            if browser is not None:
                stop_owned_browser(browser, endpoint)
        finally:
            if log is not None:
                log.close()
            remove_owned_profile(directory)


if __name__ == '__main__':
    raise SystemExit(main())
