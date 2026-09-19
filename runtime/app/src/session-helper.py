#!/usr/bin/env python3
import argparse, errno, json, os, pty, selectors, signal, subprocess, time
from pathlib import Path
from datetime import datetime, timezone

def iso():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')

def atomic_json(path, obj):
    p=Path(path)
    tmp=p.with_name(p.name+f'.tmp-{os.getpid()}')
    fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    try:
        with os.fdopen(fd,'w') as stream:
            stream.write(json.dumps(obj,indent=2)+'\n');stream.flush();os.fsync(stream.fileno())
        os.replace(tmp,p)
        directory=os.open(p.parent,os.O_RDONLY)
        try:
            try: os.fsync(directory)
            except OSError as e:
                if e.errno not in (errno.EINVAL,errno.ENOTSUP,errno.EBADF): raise
        finally: os.close(directory)
    finally:
        try: tmp.unlink()
        except FileNotFoundError: pass

def daemonize(state):
    first=os.fork()
    if first>0:
        _,status=os.waitpid(first,0)
        if os.WIFEXITED(status): raise SystemExit(os.WEXITSTATUS(status))
        raise SystemExit(1)
    os.setsid()
    second=os.fork()
    if second>0: os._exit(0)
    devnull=os.open(os.devnull,os.O_RDONLY)
    logfd=os.open(state/'helper.log',os.O_WRONLY|os.O_CREAT|os.O_APPEND,0o600)
    os.dup2(devnull,0); os.dup2(logfd,1); os.dup2(logfd,2)
    if devnull>2: os.close(devnull)
    if logfd>2: os.close(logfd)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--daemonize',action='store_true')
    ap.add_argument('--state-dir',required=True)
    ap.add_argument('--cwd')
    ap.add_argument('command',nargs=argparse.REMAINDER)
    a=ap.parse_args()
    cmd=a.command[1:] if a.command and a.command[0]=='--' else a.command
    if not cmd: raise SystemExit('missing command')

    state=Path(a.state_dir)
    state.mkdir(parents=True,exist_ok=True); os.chmod(state,0o700)
    if a.daemonize: daemonize(state)

    out_path=state/'output.log'; meta_path=state/'meta.json'
    control=state/'control'; processing=state/'processing'; acks=state/'acks'
    for d in (control,processing,acks):
        d.mkdir(parents=True,exist_ok=True); os.chmod(d,0o700)

    env=dict(os.environ)
    env.setdefault('PYTHONUNBUFFERED','1')
    env.setdefault('PYTHON_BASIC_REPL','1')
    env.setdefault('PYTHON_COLORS','0')
    env.setdefault('NO_COLOR','1')
    env.setdefault('TERM','xterm-256color')
    child_pid,master=pty.fork()
    if child_pid==0:
        try:
            if a.cwd: os.chdir(a.cwd)
            os.execvpe(cmd[0],cmd,env)
        except BaseException:
            os._exit(127)
    os.set_blocking(master,False)
    out=open(out_path,'ab',buffering=0)

    sel=selectors.DefaultSelector(); sel.register(master,selectors.EVENT_READ)
    meta={
        'sessionId':state.name,'helperPid':os.getpid(),'pid':child_pid,
        'state':'running','startedAt':iso(),'command':cmd,
        'cwd':a.cwd or os.getcwd(),'outputFile':str(out_path),
        'controlDir':str(control),'ackDir':str(acks),
        'helperLog':str(state/'helper.log'),'transport':'pty-file-control',
        'inputReady':False
    }
    atomic_json(meta_path,meta)
    started_mono=time.monotonic()
    last_output_mono=started_mono
    seen_output=False
    input_ready=False

    child_code=None
    def poll_child():
        nonlocal child_code
        if child_code is not None: return child_code
        try:
            got,status=os.waitpid(child_pid,os.WNOHANG)
        except ChildProcessError:
            return child_code
        if got==0: return None
        child_code=os.waitstatus_to_exitcode(status)
        return child_code

    def stop(sig=signal.SIGTERM):
        try: os.killpg(child_pid,sig)
        except ProcessLookupError: pass
    signal.signal(signal.SIGTERM,lambda *_: stop(signal.SIGTERM))
    signal.signal(signal.SIGINT,lambda *_: stop(signal.SIGINT))

    def drain(capture=None):
        nonlocal last_output_mono, seen_output
        got=False
        while True:
            try:
                b=os.read(master,65536)
                if not b: break
                out.write(b); got=True
                if capture is not None:
                    capture.extend(b)
                    if len(capture)>1048576:
                        del capture[:-1048576]
                seen_output=True
                last_output_mono=time.monotonic()
                if len(b)<65536: break
            except BlockingIOError: break
            except OSError: break
        return got

    def maybe_input_ready():
        nonlocal input_ready
        if input_ready: return
        now=time.monotonic()
        settled=(seen_output and now-last_output_mono>=0.50)
        quiet_boot=(not seen_output and now-started_mono>=0.75)
        if settled or quiet_boot:
            input_ready=True
            meta['inputReady']=True
            meta['inputReadyAt']=iso()
            atomic_json(meta_path,meta)

    def controls():
        for req_path in sorted(control.glob('*.json')):
            claim=processing/req_path.name
            try: os.replace(req_path,claim)
            except FileNotFoundError: continue
            req_id=claim.stem
            try:
                req=json.loads(claim.read_text())
                action=req.get('action')
                if action=='input':
                    data=str(req.get('input',''))
                    if req.get('newline',True): data+='\n'
                    requested=max(0,min(int(req.get('waitMs',0)),15000))
                    grace=max(0,min(int(req.get('graceMs',1000 if requested else 0)),2000))
                    captured=bytearray()
                    written=os.write(master,data.encode())
                    deadline=time.monotonic()+(requested+grace)/1000.0
                    while time.monotonic()<deadline:
                        remaining=max(0.0,deadline-time.monotonic())
                        events=sel.select(timeout=min(0.03,remaining))
                        if events: drain(captured)
                        if poll_child() is not None:
                            drain(captured)
                            break
                    drain(captured)
                    resp={'ok':True,'written':written,'output':captured.decode(errors='replace')}
                elif action=='signal':
                    os.killpg(child_pid,int(req.get('signal',signal.SIGTERM)))
                    resp={'ok':True}
                elif action=='status':
                    resp={'ok':True,'state':'running' if poll_child() is None else 'terminal','pid':child_pid}
                else:
                    resp={'ok':False,'error':'unknown action'}
            except Exception as e:
                resp={'ok':False,'error':str(e)}
            atomic_json(acks/f'{req_id}.json',resp)
            try: claim.unlink()
            except FileNotFoundError: pass

    try:
        while True:
            events=sel.select(timeout=0.03)
            if events: drain()
            maybe_input_ready()
            controls()
            if poll_child() is not None:
                quiet=0
                for _ in range(100):
                    if drain(): quiet=0
                    else:
                        quiet+=1
                        if quiet>=5: break
                        time.sleep(0.01)
                controls()
                break
        code=poll_child()
        meta.update({'state':'completed' if code==0 else 'failed','exitCode':code,'finishedAt':iso()})
        atomic_json(meta_path,meta)
    except Exception as e:
        meta.update({'state':'failed','finishedAt':iso(),'helperError':repr(e)})
        atomic_json(meta_path,meta)
        raise
    finally:
        try: sel.close()
        except Exception: pass
        try: os.close(master)
        except Exception: pass
        out.close()

if __name__=='__main__':
    main()
