#!/usr/bin/env python3
"""Experimental hardening of Navish's macOS Chrome adapter.

No extra runtime packages. Existing Chrome automation permissions are required.
This module never changes those permissions or falls back to another controller.
DOM events are synthetic; dispatch is not proof of application-level completion.
"""
from __future__ import annotations
import argparse
import contextlib
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from dataclasses import dataclass
from urllib.parse import urlsplit

VERSION = "browser-hardening-candidate-20260918"
MAX_STEPS = 32

class BrowserError(RuntimeError):
    def __init__(self, code: str, details: dict | None = None):
        self.code, self.details = code, details or {}
        super().__init__(code)
    def result(self):
        return {"ok": False, "error": self.code, **self.details}

@dataclass(frozen=True)
class Target:
    window_id: int
    tab_id: int
    def __post_init__(self):
        if type(self.window_id) is not int or type(self.tab_id) is not int or min(self.window_id, self.tab_id) <= 0:
            raise BrowserError("INVALID_TARGET")
    @classmethod
    def parse(cls, value: str):
        try:
            w, t = value.split(":")
            return cls(int(w), int(t))
        except (ValueError, TypeError, AttributeError):
            raise BrowserError("INVALID_TARGET") from None
    def text(self):
        return f"{self.window_id}:{self.tab_id}"

class Deadline:
    def __init__(self, milliseconds: int):
        if type(milliseconds) is not int or not 1 <= milliseconds <= 120000:
            raise BrowserError("INVALID_TIMEOUT")
        self.end = time.monotonic() + milliseconds / 1000
    def remaining(self):
        value = self.end - time.monotonic()
        if value <= 0:
            raise BrowserError("TIMEOUT")
        return value


def apple_string(value: str) -> str:
    """AppleScript strings are not JSON string literals (notably Unicode)."""
    if not isinstance(value, str) or any(ord(c) < 32 for c in value):
        raise BrowserError("INVALID_APPLE_STRING")
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'


def osa(script: str, timeout: float) -> str:
    if sys.platform != "darwin":
        raise BrowserError("MACOS_REQUIRED")
    try:
        p = subprocess.run(["/usr/bin/osascript"], input=script, text=True,
                           capture_output=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        # A timed-out mutation may already have happened. Caller must reconcile.
        raise BrowserError("AUTOMATION_TIMEOUT", {"completion": "unknown", "retryMutation": False}) from None
    if p.returncode:
        # Avoid echoing page contents, command arguments, or user input in errors.
        code = "AUTOMATION_ERROR"
        for marker in ("TARGET_MISSING", "URL_CHANGED", "CHROME_NOT_RUNNING", "NO_WINDOWS"):
            if marker in p.stderr:
                code = marker
                break
        raise BrowserError(code, {"exitCode": p.returncode})
    return p.stdout.rstrip("\n")


def target_script(target: Target) -> str:
    # IDs, never mutable front-window or tab-position indices.
    return f'''if not running then error "CHROME_NOT_RUNNING"
set ws to every window whose id is {target.window_id}
if (count of ws) is not 1 then error "TARGET_MISSING"
set w to item 1 of ws
set ts to every tab of w whose id is {target.tab_id}
if (count of ts) is not 1 then error "TARGET_MISSING"
set t to item 1 of ts'''


def js_literal(js: str) -> str:
    # Pass one escaped AppleScript literal, avoiding a shell/base64 subprocess.
    return apple_string(js.replace("\r", " ").replace("\n", " ").replace("\t", " "))


DOM = r'''
const norm = s => String(s || "").trim().replace(/\s+/g, " ");
const visible = e => {
  if (!e || !e.isConnected || e.closest('[hidden],[inert]')) return false;
  const s = getComputedStyle(e), r = e.getBoundingClientRect();
  return s.display !== 'none' && s.visibility !== 'hidden' && s.visibility !== 'collapse' && r.width > 0 && r.height > 0;
};
const disabled = e => e.matches(':disabled') || !!e.closest('[aria-disabled="true"],[inert]');
const text = e => norm(e.innerText || e.getAttribute('aria-label') || e.textContent);
const fail = (error, extra = {}) => ({ok:false, error, dispatched:false, ...extra});
if (cfg.expectedUrl && location.href !== cfg.expectedUrl) return fail('URL_CHANGED');
if (cfg.action === 'snapshot') {
  const take = (selector, f, n) => Array.from(document.querySelectorAll(selector)).filter(e=>visible(e)&&!e.closest('[data-private]')).slice(0,n).map(f);
  const inputs = take('input,textarea,[contenteditable]', e => ({tag:e.tagName, type:e.type || '', name:e.name || '', placeholder:e.getAttribute('placeholder') || '', aria:e.getAttribute('aria-label') || '', value:'[omitted]'}), 40);
  const headings = take('h1,h2,h3', e => ({tag:e.tagName,text:text(e).slice(0,200)}), 30);
  const buttons = take('button,[role="button"]', e => ({text:text(e).slice(0,120),disabled:disabled(e)}), 40);
  const links = take('a[href]', e => ({text:text(e).slice(0,120),href:e.href}), 40);
  // Free-text extraction is opt-in; editable controls and scripts are excluded.
  let body = '';
  if (cfg.includeText) {
    const root = document.querySelector('main') || document.body;
    if (root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node && body.length < 4000; node = walker.nextNode()) {
        const p = node.parentElement;
        if (p && visible(p) && !p.closest('input,textarea,[contenteditable],script,style,noscript,select,[data-private]')) body += ' ' + norm(node.textContent);
      }
    }
  }
  return {ok:true,title:document.title,url:location.href,ready:document.readyState,headings,buttons,links,inputs,...(cfg.includeText ? {text:body.trim().slice(0,4000)} : {})};
}
if (cfg.action === 'wait-text') return {ok:true,matched:(document.body?.innerText || '').includes(cfg.text)};
let es;
try {
  es = cfg.action === 'click-text'
    ? Array.from(document.querySelectorAll('button,a,[role="button"]')).filter(e => text(e).toLowerCase() === norm(cfg.text).toLowerCase())
    : Array.from(document.querySelectorAll(cfg.selector));
} catch (_) { return fail('INVALID_SELECTOR'); }
es = es.filter(visible);
if (cfg.action === 'wait-selector') return {ok:true,matched:es.length === 1};
if (es.length === 0) return fail('NOT_FOUND');
if (es.length !== 1) return fail('AMBIGUOUS_TARGET', {matches:es.length});
const e = es[0];
if (disabled(e)) return fail('DISABLED');
if (cfg.action === 'click' || cfg.action === 'click-text') {
  e.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
  const r = e.getBoundingClientRect();
  const x = Math.max(0, Math.min(innerWidth - 1, r.left + r.width/2));
  const y = Math.max(0, Math.min(innerHeight - 1, r.top + r.height/2));
  const hit = document.elementFromPoint(x,y);
  if (!hit || !(hit === e || e.contains(hit))) return fail('OBSCURED');
  // Recheck after scrolling before a mutation. Never automatically repeat click.
  if (!e.isConnected || !visible(e) || disabled(e)) return fail('TARGET_CHANGED');
  e.click();
  return {ok:true,dispatched:true,verified:false,synthetic:true};
}
if (cfg.action === 'fill') {
  if (e.readOnly || e.getAttribute('aria-readonly') === 'true') return fail('READONLY');
  // Do not log, read back, or write secrets through this general-purpose adapter.
  if (e.type === 'password' || /password|one-time-code/i.test(e.autocomplete || '')) return fail('SENSITIVE_FIELD');
  const value = String(cfg.value);
  e.focus();
  if (e.isContentEditable) {
    e.textContent = value;
  } else if (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA') {
    if (e.tagName === 'INPUT' && !['text','search','email','tel','url','number'].includes(e.type)) return fail('UNSUPPORTED_INPUT');
    const proto = e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);
  } else return fail('NOT_EDITABLE');
  e.dispatchEvent(new Event('input',{bubbles:true}));
  e.dispatchEvent(new Event('change',{bubbles:true}));
  const matched = e.isContentEditable ? e.textContent === value : e.value === value;
  return matched ? {ok:true,dispatched:true,verified:true,verification:'immediate-dom-value'} : fail('VALUE_REJECTED',{dispatched:true});
}
return fail('UNKNOWN_ACTION');
'''


def dom_script(action: str, expected_url: str | None = None, **kwargs) -> str:
    cfg = json.dumps({"action": action, "expectedUrl": expected_url, **kwargs}, ensure_ascii=True)
    # DOM is written without line comments so joining lines retains semantics.
    body = "\n".join(line for line in DOM.splitlines() if not line.lstrip().startswith("//"))
    return f"(()=>{{const cfg={cfg};try{{const run=()=>{{{body}}};return JSON.stringify(run());}}catch(e){{return JSON.stringify({{ok:false,error:'DOM_ERROR',uncertain:!['snapshot','wait-text','wait-selector'].includes(cfg.action)}});}}}})()"


class Chrome:
    def active(self, deadline: Deadline) -> Target:
        raw = osa('''tell application "Google Chrome"
if not running then error "CHROME_NOT_RUNNING"
if (count of windows) is 0 then error "NO_WINDOWS"
set w to front window
set t to active tab of w
return (id of w as text) & ":" & (id of t as text)
end tell''', deadline.remaining())
        return Target.parse(raw)

    def open(self, url: str, deadline: Deadline) -> Target:
        validate_url(url)
        raw = osa(f'''tell application "Google Chrome"
if not running then error "CHROME_NOT_RUNNING"
if (count of windows) is 0 then make new window
set w to front window
set t to make new tab at end of tabs of w with properties {{URL:{apple_string(url)}}}
return (id of w as text) & ":" & (id of t as text)
end tell''', deadline.remaining())
        return Target.parse(raw)

    def evaluate(self, target: Target, js: str, deadline: Deadline) -> dict:
        script = f'''tell application "Google Chrome"
{target_script(target)}
return execute t javascript {js_literal(js)}
end tell'''
        raw = osa(script, deadline.remaining())
        try:
            obj = json.loads(raw)
        except (ValueError, TypeError):
            raise BrowserError("INVALID_BROWSER_RESPONSE", {"completion":"unknown", "retryMutation":False}) from None
        if not isinstance(obj, dict) or type(obj.get("ok")) is not bool:
            raise BrowserError("INVALID_BROWSER_RESPONSE")
        return obj

    def navigate(self, target: Target, url: str, expected_url: str, deadline: Deadline) -> dict:
        validate_url(url)
        script = f'''tell application "Google Chrome"
{target_script(target)}
if (URL of t) is not {apple_string(expected_url)} then error "URL_CHANGED"
set URL of t to {apple_string(url)}
return "DISPATCHED"
end tell'''
        osa(script, deadline.remaining())
        return {"ok": True, "dispatched": True, "verified": False}


def validate_url(url: str):
    if not isinstance(url, str) or any(ord(c) < 32 for c in url):
        raise BrowserError("INVALID_URL")
    p = urlsplit(url)
    if (p.scheme not in ("https", "http", "file") or p.username or p.password
            or (p.scheme in ("https", "http") and not p.hostname)
            or (p.scheme == "file" and p.netloc not in ("", "localhost"))):
        raise BrowserError("UNSUPPORTED_URL")


@contextlib.contextmanager
def target_lock(target: Target, deadline: Deadline, root: Path | None = None):
    """Serialize cooperating commands on a target; a batch holds its whole workflow."""
    root = root or Path.home() / ".navish-commander" / "browser-locks"
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    filename = root / f"{target.window_id}-{target.tab_id}.lock"
    fd = os.open(filename, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "a+") as stream:
        while True:
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                time.sleep(min(0.05, deadline.remaining()))
        try:
            yield
        finally:
            fcntl.flock(stream, fcntl.LOCK_UN)


MUTATIONS = {"click", "click-text", "fill", "navigate"}
ACTIONS = MUTATIONS | {"snapshot", "wait-selector", "wait-text"}

def validate_step(step: dict):
    if not isinstance(step, dict) or step.get("action") not in ACTIONS:
        raise BrowserError("INVALID_STEP")
    action = step["action"]
    if action in MUTATIONS and (not isinstance(step.get("expected_url"), str) or not step["expected_url"]):
        raise BrowserError("EXPECTED_URL_REQUIRED")
    required = {"click":["selector"], "click-text":["text"], "fill":["selector","value"],
                "navigate":["url"], "wait-selector":["selector"], "wait-text":["text"]}.get(action, [])
    if any(not isinstance(step.get(k), str) or (k != "value" and not step[k]) for k in required):
        raise BrowserError("INVALID_STEP")
    if "expected_url" in step and not isinstance(step["expected_url"], str):
        raise BrowserError("INVALID_STEP")
    if action == "navigate":
        validate_url(step["url"])
    if set(step) - {"action","expected_url","selector","text","value","url","includeText"}:
        raise BrowserError("UNKNOWN_STEP_FIELD")


def run_step(backend: Chrome, target: Target, step: dict, deadline: Deadline) -> dict:
    validate_step(step)
    action = step["action"]
    if action == "navigate":
        return backend.navigate(target, step["url"], step["expected_url"], deadline)
    args = {k: v for k, v in step.items() if k not in {"action", "expected_url"}}
    js = dom_script(action, step.get("expected_url"), **args)
    interval = .05
    while True:
        deadline.remaining()
        result = backend.evaluate(target, js, deadline)
        if not result["ok"]:
            raise BrowserError(result.get("error", "BROWSER_ERROR"),
                               {k:v for k,v in result.items() if k not in ("ok","error")})
        if action not in {"wait-selector", "wait-text"} or result.get("matched"):
            return result
        time.sleep(min(interval, deadline.remaining()))
        interval = min(.25, interval * 1.5)


def run_workflow(backend: Chrome, target: Target, steps: list, deadline: Deadline) -> dict:
    if not isinstance(steps, list) or not 1 <= len(steps) <= MAX_STEPS:
        raise BrowserError("INVALID_BATCH")
    # Validate every step before executing any mutation.
    for step in steps:
        validate_step(step)
    receipts = []
    for i, step in enumerate(steps):
        start = time.monotonic()
        try:
            result = run_step(backend, target, step, deadline)
        except BrowserError as e:
            return {"ok":False,"error":e.code,"failedStep":i,"completedSteps":len(receipts),
                    "target":target.text(),"results":receipts,"failure":e.result(),"retryMutation":False}
        receipts.append({"step":i,"action":step["action"],"elapsedMs":round((time.monotonic()-start)*1000,3),"result":result})
    return {"ok":True,"target":target.text(),"completedSteps":len(receipts),"results":receipts}


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise BrowserError("INVALID_ARGUMENTS")

def main(argv=None) -> int:
    started = time.monotonic()
    action = None
    try:
        parser = Parser(description=__doc__)
        parser.add_argument("--target", help="Stable window-id:tab-id from open/active")
        parser.add_argument("--expect-url")
        parser.add_argument("--timeout-ms", type=int, default=10000)
        parser.add_argument("--include-text", action="store_true")
        parser.add_argument("action", choices=sorted(ACTIONS | {"open","active","status","batch"}))
        parser.add_argument("args", nargs="*")
        ns = parser.parse_args(argv)
        action = ns.action
        deadline, backend = Deadline(ns.timeout_ms), Chrome()
        if action in {"active", "status"}:
            if ns.args: raise BrowserError("INVALID_ARGUMENTS")
            target = backend.active(deadline)
            result = {"ok":True,"target":target.text(),"version":VERSION}
        elif action == "open":
            if len(ns.args) != 1: raise BrowserError("INVALID_ARGUMENTS")
            target = backend.open(ns.args[0], deadline)
            result = {"ok":True,"target":target.text(),"dispatched":True,"verified":False}
        else:
            if not ns.target: raise BrowserError("TARGET_REQUIRED")
            target = Target.parse(ns.target)
            if action == "batch":
                if len(ns.args) != 1: raise BrowserError("INVALID_ARGUMENTS")
                raw = sys.stdin.read(131073) if ns.args[0] == "-" else Path(ns.args[0]).read_text()
                if len(raw) > 131072: raise BrowserError("BATCH_TOO_LARGE")
                steps = json.loads(raw)
            else:
                fields = {"click":["selector"],"click-text":["text"],"fill":["selector","value"],
                          "navigate":["url"],"wait-selector":["selector"],"wait-text":["text"],"snapshot":[]}[action]
                if len(fields) != len(ns.args): raise BrowserError("INVALID_ARGUMENTS")
                step = {"action":action, **dict(zip(fields, ns.args))}
                if ns.expect_url is not None: step["expected_url"] = ns.expect_url
                if action == "snapshot": step["includeText"] = ns.include_text
                steps = [step]
            with target_lock(target, deadline):
                result = run_workflow(backend,target,steps,deadline)
        result["elapsedMs"] = round((time.monotonic()-started)*1000,3)
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result["ok"] else 1
    except BrowserError as e:
        print(json.dumps({**e.result(),"action":action,"elapsedMs":round((time.monotonic()-started)*1000,3)}))
        return 1
    except (OSError, ValueError, TypeError):
        print(json.dumps({"ok":False,"error":"INVALID_INPUT_OR_IO","action":action}))
        return 1

if __name__ == "__main__":
    sys.exit(main())
