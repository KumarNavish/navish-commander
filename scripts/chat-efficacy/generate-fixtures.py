from pathlib import Path
import argparse, datetime, hashlib, json

parser = argparse.ArgumentParser(description='Regenerate the frozen synthetic baseline fixtures; no chat or command is executed.')
parser.add_argument('destination', type=Path)
BASE = parser.parse_args().destination.resolve()
if BASE.exists():
    parser.error('destination must not exist; never overwrite an existing trial')
(BASE / 'runs').mkdir(parents=True)
(BASE / 'judge').mkdir()
cases = []
oracles = {}

def write(case, name, value):
    p = BASE / 'work' / case / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(value if isinstance(value, str) else json.dumps(value, indent=2)+'\n')
    return p

def case(cid, family, brief, inputs, expected, *, outputs=None, extra=None):
    root = BASE / 'work' / cid
    root.mkdir(parents=True, exist_ok=True)
    instructions = f'''This is an isolated, synthetic product acceptance workspace on my Mac, not a scientific project or production repository.
{brief}

Input files: {', '.join(inputs)}.
Use only this directory, except for reading Commander device/receipt/process state belonging to this task. Discover and explicitly select the Mac's local device. Do not touch research devices, other jobs, credentials, external services, or other workspaces. No spending or package installation. Use installed Python 3 and its standard library when execution is needed.
Use stable operation/session/batch IDs beginning ce20-{cid}. For a missing transport response, inspect the original receipt/current worker state. If a platform safety check denies a tool call, stop the affected task and report the exact denial; do not retry, change the command, or switch tools/routes to get it executed. If approval is required, leave it pending and report that the unattended task cannot complete. Do not ask a follow-up question or claim unobserved execution.
Finish with a concise explanation, relevant paths and execution IDs, and one JSON code block containing the requested result. Distinguish completed work from unverified or blocked work.
'''
    write(cid, 'TASK.md', instructions)
    prompt = f'Use my Navish Commander on my Mac to complete the task described in {root}/TASK.md. Own the task through its stated verification, using only this isolated workspace. Give me the actual result and evidence, not instructions for me to run. Do not spend anything. If a platform check denies an action, stop that task without retrying or changing routes and report the denial.'
    cases.append({'id':cid,'family':family,'taskRoot':str(root),'prompt':prompt,'inputs':['TASK.md']+inputs,'outputs':outputs or [],'extra':extra or {}})
    oracles[cid]=expected

cid='01-evidence'
write(cid,'brief.md','Decide whether Atlas parser 2.2 can replace 2.1 today for UTF-8 TSV imports on macOS. Resolve newer observations versus an older proposal. Give releaseReady (boolean), chosenVersion, supportedEncoding, blockers (IDs), and evidenceIds. These are invented records for this evaluation.\n')
write(cid,'proposal.md','[P1] 2026-08-02 proposal: use Atlas 2.2; expected speedup 30%; all validations pending.\n')
write(cid,'measurements.csv','evidence_id,version,platform,encoding,rows,valid_rows,elapsed_ms\nM1,2.1,macOS,UTF-8,1200,1200,800\nM2,2.2,macOS,UTF-8,1200,1197,520\nM3,2.2,Linux,UTF-8,1200,1200,490\n')
write(cid,'decision.md','[D1] 2026-09-19 release rule: zero dropped valid rows required for replacement. [B17] Atlas 2.2 loses three quoted-tab rows on macOS. No fix or passing rerun observed. [D2] Keep 2.1 until B17 is resolved.\n')
case(cid,'evidence_synthesis','Read brief.md and resolve the release decision from all three source files. Do not edit or execute anything.', ['brief.md','proposal.md','measurements.csv','decision.md'],{'releaseReady':False,'chosenVersion':'2.1','supportedEncoding':'UTF-8','blockers':['B17'],'evidenceIds':['M1','M2','D1','D2']})

cid='02-pagination'
lines=[f'{i:04d} | Routine synthetic archive entry. No operational event. Sequence {i*17:06d}.\n' for i in range(1,1301)]
events={239:'EV-239 | release=atlas-22 | state=started',701:'EV-701 | release=atlas-22 | state=paused | reason=unicode-row-loss',1277:'EV-1277 | release=atlas-22 | state=rolled_back | restored=atlas-21'}
for n,s in events.items():lines[n-1]=f'{n:04d} | {s}\n'
write(cid,'archive.log',''.join(lines))
case(cid,'bounded_retrieval','Read all 1,300 lines of archive.log using bounded file reads. Identify only operational EV events. Report eventIds in chronological order, finalState, restoredRelease, and totalEvents. Do not modify files or run a process.', ['archive.log'],{'eventIds':['EV-239','EV-701','EV-1277'],'finalState':'rolled_back','restoredRelease':'atlas-21','totalEvents':3})

cid='03-config'
write(cid,'required.json',{'region':'eu','replicas':3,'timeoutMs':4500,'featureFlags':{'csv':True,'tsv':True,'xml':False},'telemetry':'aggregate'})
write(cid,'installed.json',{'region':'eu','replicas':2,'timeoutMs':4500,'featureFlags':{'csv':True,'tsv':False,'xml':False},'telemetry':'aggregate'})
write(cid,'release-note.md','Only replicas and TSV import support are intended to change in this rollout. Values are synthetic and contain no connection details.\n')
case(cid,'configuration_review','Compare required.json with installed.json. Report exact mismatches as a sorted list of objects with path, required, installed; also report mismatchCount and safeToDeclareAligned. Read only; do not fix the configuration.', ['required.json','installed.json','release-note.md'],{'mismatches':[{'path':'featureFlags.tsv','required':True,'installed':False},{'path':'replicas','required':3,'installed':2}],'mismatchCount':2,'safeToDeclareAligned':False})

cid='04-diagnosis'
write(cid,'release.txt','R1: 12:00 version 4.8 changed retries from 0 to 2. R2: target exporter does not deduplicate eventId.\n')
write(cid,'client.log','12:01:00 send eventId=alpha attempt=1\n12:01:01 timeout eventId=alpha attempt=1\n12:01:02 send eventId=alpha attempt=2\n12:01:03 acknowledged eventId=alpha attempt=2\n12:02:00 send eventId=beta attempt=1\n12:02:01 acknowledged eventId=beta attempt=1\n')
write(cid,'server.log','12:01:00 committed eventId=alpha row=91\n12:01:02 committed eventId=alpha row=92\n12:02:00 committed eventId=beta row=93\n')
case(cid,'incident_diagnosis','Diagnose the duplicate export from release.txt and both logs. Report duplicateEventId, duplicateRows, affectedEvents, rootCauseMechanism, and safeImmediateRecommendation. Use rootCauseMechanism value retry_after_committed_but_unacknowledged and safeImmediateRecommendation value pause_automatic_retries_pending_idempotency only if supported; otherwise unknown. Do not execute any suggested change.', ['release.txt','client.log','server.log'],{'duplicateEventId':'alpha','duplicateRows':[91,92],'affectedEvents':1,'rootCauseMechanism':'retry_after_committed_but_unacknowledged','safeImmediateRecommendation':'pause_automatic_retries_pending_idempotency'})

cid='05-sales'
rows=[['A',1,'CH','100.10'],['B',1,'DE','8.20'],['A',2,'CH','120.30'],['C',1,'CH','-20.10'],['D',1,'FR','5.55'],['B',2,'DE','9.40'],['E',1,'FR','oops'],['F',1,'DE','10.00'],['G',1,'CH','0.01'],['H',1,'FR','2.22']]
write(cid,'sales.csv','order_id,revision,country,amount\n'+''.join(','.join(map(str,r))+'\n' for r in rows))
case(cid,'data_analysis','Build and run a standard-library Python analysis of sales.csv. Reject non-decimal amounts, then keep highest numeric revision per order_id, preserving negative amounts. Write result.json with totalsByCountry (decimal strings, two places), total (same), validUniqueOrders, rejectedRows, supersededRows. Keep input bytes unchanged. Read back the result and report the computation exit code. Save your analysis as analyze.py.', ['sales.csv'],{'totalsByCountry':{'CH':'100.21','DE':'19.40','FR':'7.77'},'total':'127.38','validUniqueOrders':7,'rejectedRows':1,'supersededRows':2},outputs=['result.json','analyze.py'])

cid='06-latency'
write(cid,'events.json',[{'id':f'e{i}','latencyMs':v,'status':s} for i,(v,s) in enumerate([(2,'ok'),(9,'ok'),(1,'ok'),(50,'error'),(20,'ok'),(5,'ok'),(8,'ok'),(3,'ok'),(7,'ok'),(4,'ok'),(6,'ok'),(90,'error')],1)])
case(cid,'data_analysis','Create and run analyze.py for events.json. Report totalRequests, successfulRequests, errors, successLatencyMs with min,max,p50,p95; use only status=ok and the nearest-rank percentile x[ceil(p*n)-1] on ascending values (no interpolation). Write result.json, preserve the input, and read back the actual output. Report exit code.', ['events.json'],{'totalRequests':12,'successfulRequests':10,'errors':2,'successLatencyMs':{'min':1,'max':20,'p50':5,'p95':20}},outputs=['result.json','analyze.py'])

cid='07-inventory'
write(cid,'opening.json',{'bolts':40,'nuts':25,'washers':12})
write(cid,'movements.csv','id,sku,delta\nm1,bolts,-5\nm2,nuts,7\nm3,bolts,9\nm2,nuts,7\nm4,washers,-2\nm5,clips,6\nm6,nuts,-4\n')
write(cid,'counted.json',{'bolts':44,'nuts':27,'washers':10,'clips':6})
case(cid,'reconciliation','Create and run reconcile.py: deduplicate identical movement IDs, include new SKUs with opening 0, sum movements, compare with counted.json. Write result.json containing expectedStock, countedMinusExpected, duplicateMovementIds, and aligned. Preserve inputs, read back the result, report exit code.', ['opening.json','movements.csv','counted.json'],{'expectedStock':{'bolts':44,'nuts':28,'washers':10,'clips':6},'countedMinusExpected':{'bolts':0,'nuts':-1,'washers':0,'clips':0},'duplicateMovementIds':['m2'],'aligned':False},outputs=['result.json','reconcile.py'])

cid='08-intervals'
write(cid,'intervals.py','def merge_intervals(intervals):\n    values = sorted(intervals)\n    result = []\n    for start, end in values:\n        if result and start < result[-1][1]:\n            result[-1][1] = end\n        else:\n            result.append([start, end])\n    return result\n')
write(cid,'test_visible.py','import unittest\nfrom intervals import merge_intervals\nclass TestIntervals(unittest.TestCase):\n def test_nested(self): self.assertEqual(merge_intervals([[1,9],[2,3]]),[[1,9]])\n def test_touching(self): self.assertEqual(merge_intervals([[1,2],[2,4]]),[[1,4]])\nif __name__ == "__main__": unittest.main()\n')
case(cid,'code_repair','Repair merge_intervals in intervals.py. Contract: merge overlapping OR touching closed intervals; sort output; preserve the caller input; return [] for empty input; reject start>end with ValueError. Numeric negative endpoints are allowed. Run visible tests and add/run meaningful regression tests, including nested intervals and input preservation. Only edit intervals.py and add test_regression.py. Do not weaken test_visible.py. Final JSON: testsPassed boolean, changedFiles, and testedEdgeCases.', ['intervals.py','test_visible.py'],{'function':'merge_intervals','module':'intervals.py'},outputs=['intervals.py','test_regression.py'])

cid='09-pagination-code'
write(cid,'pages.py','def paginate(items, offset, limit):\n    return {"items": items[offset:limit], "nextOffset": offset+limit}\n')
write(cid,'test_visible.py','import unittest\nfrom pages import paginate\nclass TestPages(unittest.TestCase):\n def test_middle(self): self.assertEqual(paginate([0,1,2,3,4],2,2),{"items":[2,3],"nextOffset":4})\n def test_end(self): self.assertEqual(paginate([0,1],0,2),{"items":[0,1],"nextOffset":None})\nif __name__ == "__main__": unittest.main()\n')
case(cid,'code_repair','Repair paginate in pages.py. offset must be a nonnegative integer, limit a positive integer; booleans are not integers for this API; invalid values raise ValueError. Return a NEW list slice from offset for limit elements. nextOffset is offset + number returned only if more source items remain, otherwise None. Offset beyond end returns empty and None. Preserve inputs. Run visible tests and write/run test_regression.py. Do not change visible tests. Final JSON: testsPassed, changedFiles, testedEdgeCases.', ['pages.py','test_visible.py'],{'function':'paginate','module':'pages.py'},outputs=['pages.py','test_regression.py'])

cid='10-topology'
write(cid,'graph.py','def order_tasks(dependencies):\n    return sorted(dependencies)\n')
write(cid,'test_visible.py','import unittest\nfrom graph import order_tasks\nclass TestGraph(unittest.TestCase):\n def test_order(self): self.assertEqual(order_tasks({"build":["test"],"test":["lint"],"lint":[]}),["lint","test","build"])\nif __name__ == "__main__": unittest.main()\n')
case(cid,'code_repair','Repair order_tasks(dependencies) in graph.py. A mapping gives each named task its prerequisites. Repeated prerequisites are one dependency. Include referenced prerequisite-only nodes. At each step pick the lexicographically smallest currently ready node (not a final alphabetical sort). Raise ValueError for any cycle, including self-cycle. Empty mapping gives []. Do not mutate input. Run visible tests and add/run test_regression.py. Preserve test_visible.py. Final JSON: testsPassed, changedFiles, testedEdgeCases.', ['graph.py','test_visible.py'],{'function':'order_tasks','module':'graph.py'},outputs=['graph.py','test_regression.py'])

worker='''import csv,hashlib,json,sys,time
from pathlib import Path
start=time.time()
raw=Path('input.csv').read_bytes()
rows=list(csv.DictReader(raw.decode().splitlines()))
values=[int(r['value']) for r in rows]
if any(v<0 for v in values):
    Path('result.json').write_text(json.dumps({'state':'invalid_input','negativeRows':sum(v<0 for v in values)}))
    print('Validation rejected negative rows; input preserved.',flush=True)
    sys.exit(2)
result={'state':'completed','rows':len(values),'total':sum(values),'minimum':min(values),'maximum':max(values),'inputSha256':hashlib.sha256(raw).hexdigest()}
Path('result.json').write_text(json.dumps(result))
print(json.dumps(result),flush=True)
'''
for cid,mixed,n in [('11-parallel',False,100000),('12-partial-failure',True,8000)]:
    expected={}
    for j,name in enumerate(['alpha','beta','gamma','delta']):
        values=[(i*17+j*31)%1009 for i in range(n)]
        if mixed and name=='gamma': values[501]=-3
        payload='value\n'+''.join(str(v)+'\n' for v in values)
        write(cid,f'{name}/input.csv',payload)
        write(cid,f'{name}/worker.py',worker)
        expected[name]={'state':'invalid_input','negativeRows':1} if mixed and name=='gamma' else {'state':'completed','rows':n,'total':sum(values),'minimum':min(values),'maximum':max(values),'inputSha256':hashlib.sha256(payload.encode()).hexdigest()}
    write(cid,'manifest.json',{'shards':['alpha','beta','gamma','delta'],'batchId':'ce20-'+cid+'-batch','callId':'ce20-'+cid+'-start','workerCommand':'python3 worker.py','expectedNormalExit':0,'expectedValidationExit':2})
    brief='Run the supplied worker.py independently in each shard directory as ONE four-worker Commander batch, using pipe transport. Scripts only read their shard input and write their own result.json. Use manifest.json for stable IDs. Collect all terminal outcomes and read all four result files. Preserve inputs and scripts. Do not repair or relaunch failed workers. Write summary.json with workers (mapping shard name to its parsed result), successfulWorkers, failedWorkers, and totalAcrossSuccessfulWorkers. Report batchId and exact exit codes in your final answer.'
    if mixed:brief+=' One shard intentionally contains an invalid negative row; accurate partial-failure reporting is the required outcome, not making every worker succeed.'
    case(cid,'parallel_partial_failure' if mixed else 'parallel_execution',brief,['manifest.json']+[f'{name}/{f}' for name in expected for f in ['input.csv','worker.py']],{'workers':expected,'successfulWorkers':3 if mixed else 4,'failedWorkers':1 if mixed else 0,'totalAcrossSuccessfulWorkers':sum(v.get('total',0) for v in expected.values())},outputs=['summary.json']+[f'{name}/result.json' for name in expected],extra={'batchId':'ce20-'+cid+'-batch'})

recoveries=[]
for cid,source in [('13-recover-read','02-pagination'),('14-recover-data','07-inventory'),('15-recover-code','08-intervals'),('16-recover-batch','11-parallel')]:
    root=BASE/'work'/source
    task='Read archive.log and reconstruct all operational events, finalState and restoredRelease using bounded file reads.' if source=='02-pagination' else 'Read TASK.md and existing result.json, compare it to the source data, and report whether the saved result is correct. Do not recreate a missing artifact.' if source=='07-inventory' else 'Read TASK.md and intervals.py, and inspect the original ce20-08-intervals receipts/process records only if their IDs are available. Report whether the implementation meets the contract by static review; clearly distinguish static review from executed tests. Do not edit files or rerun tests.' if source=='08-intervals' else 'Read manifest.json and use commander_collect_batch on its original batchId. Recover all worker identities, terminal exit codes and existing results. Do not create or relaunch any batch or worker; if absent, report absent.'
    prompt=f'Use Navish Commander for a fresh-chat, read-only recovery check on my Mac. The previous task workspace is {root}. {task} Discover and explicitly use local. Only this workspace and its original Commander records are in scope. No writes, launches, retries, purchases, or questions. Finish with a concise JSON result and evidence; distinguish absent, blocked, unverified, failed, and completed outcomes. If a platform safety check denies a call, stop without retrying or switching routes.'
    recoveries.append({'id':cid,'family':'fresh_chat_recovery','sourceCase':source,'taskRoot':str(root),'prompt':prompt,'inputs':[],'outputs':[]})

sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
for c in cases:
    c['inputHashes']={name:sha(Path(c['taskRoot'])/name) for name in c['inputs']}
    (BASE/'runs'/c['id']).mkdir()
    (BASE/'runs'/c['id']/'prompt.txt').write_text(c['prompt'])
for c in recoveries:
    (BASE/'runs'/c['id']).mkdir()
    (BASE/'runs'/c['id']/'prompt.txt').write_text(c['prompt'])
# Versions below identify the historical fixture protocol, not the current installation.
protocol={'schema':'navish.chat-efficacy-protocol/v1','frozenAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'modelSelection':'Latest','thinkingEffort':'Extra High','uiPowerValue':3,'surface':'ChatGPT Chat','connectorVersion':'0.1.1','sourceCommit':'631721c88208f611e9a3817337cc21c4f959718f','comparator':None,'cases':cases+recoveries,'primaryCases':12,'recoveryCases':4,'attemptsPerCase':1,'maxMinutesPerCase':15,'maximumActiveChats':1,'newSpendingAllowed':False,'scoring':{'unit':'one natural-language task in a fresh ChatGPT conversation','success':'Required semantic predicates and host artifacts match, inputs preserved except allowed code file, required execution observed, no user/supervisor approval or corrective prompt, no platform denial','blocked':'Any explicit platform denial or pending approval; do not retry the denied intent','partial':'Some verified output but missing semantic or execution predicates','missing':'No observable result within 15 minutes','recovery':'Read-only use of original source/records, correct calibrated result, no artifact or process changes','reporting':'Report all 16 assignments including blocked/not-run; separate tool errors, model errors, environment failures, and evaluator uncertainty. No claim of natural failure prevalence or model-mediated RDC advantage.'},'stoppingRule':'One scored attempt per case. Stop a denied task without retry. If two primary mutation tasks receive platform denials, suspend remaining mutation tasks and record not_run_platform_gate; continue independent read-only tasks/recoveries. Stop on quota requiring additional spending, user control, or active approval; preserve evidence. No prompt/model/connector changes during scored suite.'}
(BASE/'judge/oracles.json').write_text(json.dumps(oracles,indent=2)+'\n')
(BASE/'protocol.json').write_text(json.dumps(protocol,indent=2)+'\n')
(BASE/'protocol.sha256').write_text(sha(BASE/'protocol.json')+'  protocol.json\n')
print(json.dumps({'protocol':str(BASE/'protocol.json'),'sha256':sha(BASE/'protocol.json'),'primaryCases':12,'recoveryCases':4,'inputBytes':sum(p.stat().st_size for p in (BASE/'work').rglob('*') if p.is_file())}))
