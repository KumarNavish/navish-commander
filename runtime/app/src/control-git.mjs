import fs from 'node:fs';
import path from 'node:path';
import { run, ensureDir } from './util.mjs';

const DEFAULT_GIT_TIMEOUT_MS = 20000;
function must(r, label) {
  if (r.code !== 0) { const e=new Error(`${label}: Git operation did not complete (exit ${r.code ?? 'unknown'})`); e.code='CONTROL_GIT_FAILED'; throw e; }
  return r;
}
function git(cwd, args, env, timeoutMs=DEFAULT_GIT_TIMEOUT_MS) {
  return run('git', ['-C', cwd, ...args], {
    env: { ...process.env, GIT_TERMINAL_PROMPT:'0', ...env },
    timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
}
function fetchBranch(repoDir, branch, depth=128) {
  return git(repoDir, ['fetch', '--no-tags', `--depth=${depth}`, 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], undefined, 30000);
}

export function ensureControlClone({ repo, branch, repoDir, gitName='Navish Commander', gitEmail='navish-commander@localhost' }) {
  ensureDir(path.dirname(repoDir));
  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    ensureDir(repoDir);
    must(run('git', ['init', repoDir], { timeoutMs: 10000 }), 'git init');
    must(git(repoDir, ['remote', 'add', 'origin', repo]), 'add origin');
    git(repoDir, ['config', 'user.name', gitName]);
    git(repoDir, ['config', 'user.email', gitEmail]);
    const remote = git(repoDir, ['ls-remote', '--exit-code', '--heads', 'origin', branch], undefined, 10000);
    if (remote.code === 0 && remote.stdout.trim()) {
      must(fetchBranch(repoDir, branch, 128), 'fetch control branch');
      must(git(repoDir, ['switch', '-C', branch, `origin/${branch}`]), 'switch control branch');
    } else {
      must(git(repoDir, ['switch', '--orphan', branch]), 'create orphan control branch');
      fs.writeFileSync(path.join(repoDir, '.gitignore'), '.DS_Store\n');
      must(git(repoDir, ['add', '.gitignore']), 'git add');
      must(git(repoDir, ['commit', '-m', 'Initialize Navish Commander control branch']), 'initial control commit');
      must(git(repoDir, ['push', '-u', 'origin', branch], undefined, 30000), 'push control branch');
    }
  } else {
    assertClean(repoDir);
    must(git(repoDir, ['remote', 'set-url', 'origin', repo]), 'set origin');
    must(fetchBranch(repoDir, branch, 128), 'fetch control branch');
    must(git(repoDir, ['switch', branch]), 'switch control branch');
    must(git(repoDir, ['reset', '--hard', `origin/${branch}`]), 'reset control branch');
    must(git(repoDir, ['clean', '-fd']), 'clean control branch');
  }
  git(repoDir, ['config', 'user.name', gitName]);
  git(repoDir, ['config', 'user.email', gitEmail]);
}

export function remoteHead(repoDir, branch) {
  const r = git(repoDir, ['ls-remote', '--exit-code', '--heads', 'origin', branch], undefined, 10000);
  must(r, 'git ls-remote');
  const sha = r.stdout.trim().split(/\s+/)[0] || '';
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error(`invalid remote head for ${branch}`);
  return sha;
}

export function localHead(repoDir) {
  const r = git(repoDir, ['rev-parse', 'HEAD'], undefined, 5000);
  must(r, 'git rev-parse');
  return r.stdout.trim();
}

export function sync(repoDir, branch) {
  must(fetchBranch(repoDir, branch, 128), 'git fetch');
  const status = git(repoDir, ['status', '--porcelain'], undefined, 5000);
  must(status, 'git status');
  if (status.stdout.trim()) throw new Error('control worktree has uncommitted changes');
  must(git(repoDir, ['reset', '--hard', `origin/${branch}`]), 'git reset');
  must(git(repoDir, ['clean', '-fd']), 'git clean');
  return localHead(repoDir);
}

function assertClean(repoDir){
  const r=must(git(repoDir,['status','--porcelain'],undefined,5000),'git status');
  if(r.stdout.trim()){const e=new Error('CONTROL_WORKTREE_DIRTY: refusing to discard local files');e.code='CONTROL_WORKTREE_DIRTY';throw e;}
}
function resetRemote(repoDir,branch){
  assertClean(repoDir);
  must(git(repoDir,['reset','--hard',`origin/${branch}`]),'update control branch');
}
function destination(repoDir,relativePath){
  if(typeof relativePath!=='string'||path.isAbsolute(relativePath)||relativePath.split('/').some(x=>!x||x==='.'||x==='..'||x==='.git'||x.includes('\\')))throw new Error('INVALID_CONTROL_PATH');
  const root=path.resolve(repoDir),parts=relativePath.split('/');let current=root;
  for(const part of parts){current=path.join(current,part);try{if(fs.lstatSync(current).isSymbolicLink())throw new Error('CONTROL_PATH_SYMLINK')}catch(e){if(e.code!=='ENOENT')throw e}}
  return current;
}

/** One known-fresh publication omits a redundant fetch. A refused or lost push
 * is reconciled against the exact remote content before another push is allowed.
 */
export function publishFile({repoDir,branch,relativePath,content,message,retries=6,assumeFresh=false,onGit=null}){
  if(typeof content!=='string'||!Number.isSafeInteger(retries)||retries<1||retries>6)throw new Error('INVALID_PUBLICATION');
  const trace=phase=>{if(onGit)onGit(phase)};
  for(let attempt=0;attempt<retries;attempt++){
    assertClean(repoDir);
    if(!assumeFresh||attempt>0){trace('fetch-before-publish');must(fetchBranch(repoDir,branch),'fetch before publish');resetRemote(repoDir,branch)}
    const p=destination(repoDir,relativePath);ensureDir(path.dirname(p));fs.writeFileSync(p,content,{mode:0o600});
    must(git(repoDir,['add','--',relativePath]),'stage publication');
    const diff=git(repoDir,['diff','--cached','--quiet'],undefined,5000);
    if(diff.code===0)return {changed:false,head:localHead(repoDir),fastPath:assumeFresh&&attempt===0};
    if(diff.code!==1)must(diff,'compare publication');
    must(git(repoDir,['commit','-m',message]),'commit publication');
    trace('push');const push=git(repoDir,['push','origin',`HEAD:${branch}`],undefined,30000);
    if(push.code===0)return {changed:true,head:localHead(repoDir),fastPath:assumeFresh&&attempt===0,attempt:attempt+1};
    trace('reconcile');const fetched=fetchBranch(repoDir,branch);
    if(fetched.code!==0){const e=new Error('CONTROL_PUBLICATION_UNCERTAIN: remote acknowledgement unavailable; local commit retained');e.code='CONTROL_PUBLICATION_UNCERTAIN';throw e;}
    const remote=git(repoDir,['show',`origin/${branch}:${relativePath}`],undefined,10000);
    if(remote.code===0&&remote.stdout===content){resetRemote(repoDir,branch);return {changed:true,reconciled:true,head:localHead(repoDir),attempt:attempt+1}}
    // A successful fetch establishes the competing branch; retain all of it.
    resetRemote(repoDir,branch);assumeFresh=false;
  }
  const e=new Error('CONTROL_PUBLICATION_FAILED: bounded retries exhausted');e.code='CONTROL_PUBLICATION_FAILED';throw e;
}
