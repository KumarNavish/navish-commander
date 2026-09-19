#!/usr/bin/env python3
"""Reference sender/decrypter for navish-github-control/v1.

Requires `cryptography` and never needs the controller's private key.
"""
from __future__ import annotations
import argparse, base64, json, os, secrets, sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import x25519
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

PROTOCOL="navish-github-control/v1"

def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00","Z")

def aad(meta):
    fields=[meta["protocol"],meta["commandId"],meta["controllerId"],meta["createdAt"],meta["expiresAt"]]
    if any(not isinstance(x,str) or "\0" in x for x in fields): raise ValueError("invalid authenticated metadata")
    return "\0".join(fields).encode()

def hkdf(shared,salt,info):
    return HKDF(algorithm=hashes.SHA256(),length=32,salt=salt,info=info.encode()).derive(shared)

def load_public(pem):
    k=serialization.load_pem_public_key(pem.encode() if isinstance(pem,str) else pem)
    if not isinstance(k,x25519.X25519PublicKey): raise TypeError("expected X25519 public key")
    return k

def load_private(pem):
    k=serialization.load_pem_private_key(pem.encode() if isinstance(pem,str) else pem,password=None)
    if not isinstance(k,x25519.X25519PrivateKey): raise TypeError("expected X25519 private key")
    return k

def public_pem(k):
    return k.public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo).decode()

def private_pem(k):
    return k.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()).decode()

def prepare(device,payload,command_id,ttl_sec):
    import re
    for value in (device.get("controllerId"),command_id,payload.get("targetDevice"),payload.get("tool")):
        if not isinstance(value,str) or value in (".","..") or not re.fullmatch(r"[A-Za-z0-9._-]{1,160}",value): raise ValueError("invalid preparation identifier")
    if type(ttl_sec) is not int or not 1<=ttl_sec<=86400: raise ValueError("invalid command lifetime")
    timeout=payload.get("timeoutMs",120000)
    if type(timeout) is not int or not 1<=timeout<=3600000 or not isinstance(payload.get("args",{}),dict): raise ValueError("invalid command budget/arguments")
    created=now_iso(); expires=(datetime.now(timezone.utc)+timedelta(seconds=ttl_sec)).isoformat(timespec="milliseconds").replace("+00:00","Z")
    meta={"protocol":PROTOCOL,"commandId":command_id,"controllerId":device["controllerId"],"createdAt":created,"expiresAt":expires}
    eph=x25519.X25519PrivateKey.generate(); salt=os.urandom(32); iv=os.urandom(12)
    shared=eph.exchange(load_public(device["publicKeyPem"])); key=hkdf(shared,salt,PROTOCOL+":request")
    enc=AESGCM(key).encrypt(iv,json.dumps(payload,separators=(",",":"),ensure_ascii=False).encode(),aad(meta))
    envelope={**meta,"crypto":{"kex":"x25519","kdf":"hkdf-sha256","aead":"aes-256-gcm","ephemeralPublicKeyPem":public_pem(eph.public_key()),"salt":base64.b64encode(salt).decode(),"iv":base64.b64encode(iv).decode(),"tag":base64.b64encode(enc[-16:]).decode(),"ciphertext":base64.b64encode(enc[:-16]).decode()}}
    return envelope,private_pem(eph)

def decrypt_result(response_private_pem,envelope):
    if envelope.get("protocol")!=PROTOCOL: raise ValueError("unsupported protocol")
    c=envelope["crypto"]; salt=base64.b64decode(c["salt"]); iv=base64.b64decode(c["iv"])
    shared=load_private(response_private_pem).exchange(load_public(c["ephemeralPublicKeyPem"])); key=hkdf(shared,salt,PROTOCOL+":result")
    enc=base64.b64decode(c["ciphertext"])+base64.b64decode(c["tag"])
    return json.loads(AESGCM(key).decrypt(iv,enc,aad(envelope)).decode())

def atomic_write(path,data,mode=0o600):
    p=Path(path);p.parent.mkdir(parents=True,exist_ok=True);tmp=p.with_name(p.name+f".tmp-{os.getpid()}-{secrets.token_hex(4)}")
    fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,mode)
    try:
        os.write(fd,data.encode() if isinstance(data,str) else data);os.fsync(fd)
    finally: os.close(fd)
    try:
        os.link(tmp,p)  # Atomic no-clobber publication; never replace an existing response key.
    finally: tmp.unlink(missing_ok=True)

def main():
    ap=argparse.ArgumentParser(); sub=ap.add_subparsers(dest="cmd",required=True)
    p=sub.add_parser("prepare");p.add_argument("--device-json",required=True);p.add_argument("--target",required=True);p.add_argument("--tool",required=True);p.add_argument("--args-json",default="{}");p.add_argument("--timeout-ms",type=int,default=120000);p.add_argument("--ttl-sec",type=int,default=900);p.add_argument("--command-id");p.add_argument("--out",required=True);p.add_argument("--response-key",required=True)
    d=sub.add_parser("decrypt");d.add_argument("--result",required=True);d.add_argument("--response-key",required=True)
    a=ap.parse_args()
    if a.cmd=="prepare":
        device=json.loads(Path(a.device_json).read_text());cid=a.command_id or ("cmd-"+datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")+"-"+secrets.token_hex(8));payload={"targetDevice":a.target,"tool":a.tool,"args":json.loads(a.args_json),"timeoutMs":a.timeout_ms};env,key=prepare(device,payload,cid,a.ttl_sec)
        if Path(a.out).resolve()==Path(a.response_key).resolve() or Path(a.out).exists() or Path(a.response_key).exists(): raise ValueError("existing or conflicting output paths; preserve the original envelope and response key")
        atomic_write(a.response_key,key);atomic_write(a.out,json.dumps(env,indent=2)+"\n");print(json.dumps({"ok":True,"commandId":cid,"repoRelativePath":f"commands/{device['controllerId']}/{cid}.json","commandFile":a.out,"responseKey":a.response_key},indent=2))
    else:
        result=decrypt_result(Path(a.response_key).read_text(),json.loads(Path(a.result).read_text()));print(json.dumps(result,indent=2))
if __name__=="__main__":main()
