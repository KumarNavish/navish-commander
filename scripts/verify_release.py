#!/usr/bin/env python3
"""Verify a downloaded release against this checkout and its recorded evidence.

Usage: python3 scripts/verify_release.py [--integrity-only] RELEASE.zip SHA256SUMS.txt
By default checks integrity and source-bound recorded gates. --integrity-only
checks package/source integrity and explicitly leaves recorded gates unevaluated.
Neither mode reruns hosted trials or certifies a product.
"""
import hashlib
import json
from pathlib import Path
import statistics
import sys
import zipfile

root = Path(__file__).resolve().parents[1]


def require(condition, message):
    if not condition:
        raise SystemExit("FAIL: " + message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def record(name):
    return json.loads((root / "evidence" / name).read_text())


arguments = sys.argv[1:]
integrity_only = "--integrity-only" in arguments
if integrity_only:
    arguments.remove("--integrity-only")
require(len(arguments) == 2, __doc__.strip())
archive, sums = map(Path, arguments)
expected = {line.split(maxsplit=1)[1].lstrip(" *"): line.split()[0]
            for line in sums.read_text().splitlines() if line.strip()}
require(expected.get(archive.name) == digest(archive.read_bytes()), "archive checksum")
with zipfile.ZipFile(archive) as bundle:
    names = bundle.namelist()
    require(len(names) == len(set(names)), "duplicate ZIP entries")
    require(bundle.testzip() is None, "ZIP member integrity")
    authored = [p for base in ["src", "runtime/app", "skills", "docs", "evidence", ".claude-plugin"]
                for p in (root / base).rglob("*") if p.is_file()]
    authored += [root / p for p in [".mcp.json", "plugin.json", "manifest.json",
                                  "package.json", "package-lock.json", "README.md", "LICENSE"]]
    expected_names = {str(p.relative_to(root)) for p in authored}
    actual_names = {n for n in names if not n.endswith("/") and not n.startswith("node_modules/")}
    require(actual_names == expected_names, "authored package file inventory")
    for p in authored:
        name = str(p.relative_to(root))
        require(bundle.read(name) == p.read_bytes(), "source/package mismatch: " + name)
    h = hashlib.sha256()
    runtime = ["src/server.mjs"] + sorted(str(p.relative_to(root))
               for p in (root / "runtime/app/src").iterdir() if p.is_file())
    for name in runtime:
        h.update(name.encode())
        h.update(bundle.read(name))
source_hash = h.hexdigest()

if integrity_only:
    print(json.dumps({"archive": archive.name, "sha256": expected[archive.name],
                      "runtimeSourceSha256": source_hash, "packageIntegrity": "passed",
                      "recordedGates": "not_evaluated",
                      "scope": "package/source integrity only; no benchmark or conversation certification"}, indent=2))
    raise SystemExit(0)

for name in ["hosted-rdc-rc2-throughput.json", "hosted-rdc-rc2-inline.json"]:
    report = record(name)
    require(report["commanderSourceSha256"] == source_hash and report["sourceUnchanged"], name + " source")
    require(report["harnessSha256"] == digest((root / "scripts/benchmark-hosted-rdc.mjs").read_bytes()), name + " harness")
    require(all(s["verified"] for s in report["samples"]), name + " all outcomes")
    times = {b: [s["elapsedMs"] for s in report["samples"] if s["backend"] == b]
             for b in ["navish", "rdc"]}
    require(all(len(t) == 20 for t in times.values()), name + " trial count")
    ratio = statistics.median(times["rdc"]) / statistics.median(times["navish"])
    require(abs(ratio - report["throughputRatio"]) < 1e-10, name + " ratio")
    require(report["throughputInterval"]["lower"] >= 2 and report["throughputTargetPassed"], name + " 2x gate")

delivery = record("hosted-rdc-rc2-delivery.json")
require(delivery["commanderSourceSha256"] == source_hash and delivery["sourceUnchanged"], "delivery source")
require(delivery["harnessSha256"] == digest((root / "scripts/benchmark-delivery.mjs").read_bytes()), "delivery harness")
failures = {b: sum(not s["verified"] for s in delivery["samples"] if s["backend"] == b)
            for b in ["navish", "rdc"]}
require(failures["rdc"] > 0 and failures["navish"] <= failures["rdc"] / 2, "controlled failure reduction")
require(delivery["controlledTargetPassed"], "controlled delivery gate")
chat = record("chat-client-rc2.json")
require(chat["package"]["runtimeSourceSha256"] == source_hash, "live client runtime")
require(chat["independentChecks"]["singleAppendExactlyOnce"] and
        chat["independentChecks"]["allFourArtifactsMatch"] and
        chat["independentChecks"]["allSessionIdentitiesAndTerminalRecordsUnchangedAfterClientRestart"], "live client predicates")
print(json.dumps({"archive": archive.name, "sha256": expected[archive.name],
                  "runtimeSourceSha256": source_hash, "integrityAndRecordedGates": "passed",
                  "scope": "recorded local-plugin acceptance; not a fresh hosted benchmark or independent certification"}, indent=2))
