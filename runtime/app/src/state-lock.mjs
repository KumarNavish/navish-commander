/** Cross-process metadata transactions. SQLite is only a mutex; JSON receipts remain authoritative. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';

const connections = new Map();
const ownerSymbol = Symbol.for('navish.commander.process-owner.v1');

function startIdentity(pid) {
  if (process.platform === 'linux') {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/);
      return `${fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}:${fields[19]}`;
    } catch { /* Fall back to the operating system's process-start description. */ }
  }
  try { return execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', timeout: 1000, env: { ...process.env, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; }
  catch { return null; }
}

export function processOwner() {
  return globalThis[ownerSymbol] ||= {
    pid: process.pid, startIdentity: startIdentity(process.pid),
    instanceId: crypto.randomUUID(), startedAt: new Date().toISOString(),
  };
}

/** A failed identity lookup is not evidence that a living process has died. */
export function ownerIsLive(owner) {
  if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) return false;
  if (owner.pid === process.pid) {
    const own = processOwner();
    if (owner.instanceId && owner.instanceId !== own.instanceId) return false;
    return !owner.startIdentity || !own.startIdentity || owner.startIdentity === own.startIdentity;
  }
  try { process.kill(owner.pid, 0); }
  catch (error) { if (error.code !== 'EPERM') return false; }
  const actual = owner.startIdentity ? startIdentity(owner.pid) : null;
  return !actual || !owner.startIdentity || actual === owner.startIdentity;
}

const DEFAULT_METADATA_TIMEOUT_MS = 5000;
const MAX_METADATA_TIMEOUT_MS = 60000;
const waitCell = new Int32Array(new SharedArrayBuffer(4));

function timeoutBudget(options) {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_METADATA_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > MAX_METADATA_TIMEOUT_MS) {
    throw new RangeError(`metadata timeoutMs must be an integer from 0 to ${MAX_METADATA_TIMEOUT_MS}`);
  }
  return timeoutMs;
}

function isSqliteBusy(error) {
  // Use SQLite primary codes, including extended BUSY/LOCKED codes. Corruption,
  // disk errors and syntax errors are not contention and must not be retried.
  return Number.isInteger(error?.errcode) && [5, 6].includes(error.errcode & 255);
}

function metadataError(cause, phase, acquired) {
  const busy = isSqliteBusy(cause);
  const error = new Error(busy ? 'Commander metadata lock deadline exceeded' : 'Commander metadata transaction failed', { cause });
  error.code = busy ? 'STATE_BUSY' : 'STATE_STORAGE_ERROR';
  error.metadataAcquired = acquired;
  error.metadataPhase = phase;
  // This layer knows only about metadata. In particular, failure to acquire a
  // finalization lock says nothing about an already dispatched browser/file job.
  return error;
}

function execMetadata(db, sql, deadline, phase, acquired = false) {
  for (;;) {
    const remaining = Math.max(0, deadline - performance.now());
    db.exec(`PRAGMA busy_timeout=${Math.min(100, Math.floor(remaining))}`);
    try { db.exec(sql); return; }
    catch (cause) {
      if (!isSqliteBusy(cause) || performance.now() >= deadline) throw metadataError(cause, phase, acquired);
      // SQLITE_LOCKED may return immediately without invoking the busy handler.
      Atomics.wait(waitCell, 0, 0, Math.min(10, Math.max(0, deadline - performance.now())));
    }
  }
}

function connection(P, deadline) {
  const root = path.resolve(P.stateRoot);
  let entry = connections.get(root);
  if (entry) return entry;
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = path.join(root, 'metadata-lock.sqlite');
  let db;
  try {
    db = new DatabaseSync(file, { timeout: 0, allowExtension: false });
    fs.chmodSync(file, 0o600);
    execMetadata(db, 'PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS mutex (id INTEGER PRIMARY KEY CHECK(id=1));', deadline, 'initialize');
  } catch (cause) {
    try { db?.close(); } catch { /* Do not cache a partially initialized connection. */ }
    if (cause.metadataAcquired !== undefined) throw cause;
    throw metadataError(cause, 'initialize', false);
  }
  entry = { db, depth: 0 }; connections.set(root, entry); return entry;
}

function invokeSynchronous(operation) {
  if (typeof operation !== 'function' || operation.constructor?.name === 'AsyncFunction') {
    throw new TypeError('State transactions require a synchronous function');
  }
  const result = operation();
  if (result && typeof result.then === 'function') throw new TypeError('State transactions must be synchronous');
  return result;
}

/** Only metadata SQL is retried. Never await or dispatch an action in this callback. */
export function withStateTransaction(P, operation, options = {}) {
  const deadline = performance.now() + timeoutBudget(options);
  const entry = connection(P, deadline);
  if (entry.depth) return invokeSynchronous(operation);
  execMetadata(entry.db, 'BEGIN IMMEDIATE', deadline, 'acquire');
  entry.depth++;
  try {
    const result = invokeSynchronous(operation);
    execMetadata(entry.db, 'COMMIT', deadline, 'commit', true);
    return result;
  } catch (error) {
    try { entry.db.exec('ROLLBACK'); } catch { /* It may already have rolled back. */ }
    throw error;
  } finally { entry.depth--; }
}

export function closeStateTransactions() {
  for (const entry of connections.values()) entry.db.close();
  connections.clear();
}
