import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileTool } from '../app/src/files.mjs';

function fixture(content,fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'navish-file-page-'));
 const file=path.join(root,'input');fs.writeFileSync(file,content);
 try{return fn(args=>readFileTool({path:file,...args},{allowedDirectories:[root]}));}
 finally{fs.rmSync(root,{recursive:true,force:true});}
}

test('line offsets can reach records beyond the initial byte cap',()=>{
 const lines=Array.from({length:1400},(_,i)=>`${i}: ${'record '.repeat(12)}`);
 fixture(lines.join('\n'),read=>{
  const page=read({offset:1250,length:75,maxBytes:8192});
  assert.equal(page.content,lines.slice(1250,1325).join('\n'));
  assert.equal(page.truncated,false);assert.equal(page.nextOffset,1325);assert.equal(page.hasMore,true);
 });
});

test('negative offsets locate the actual file tail with bounded output',()=>{
 const lines=Array.from({length:1800},(_,i)=>`row-${i} ${'x'.repeat(80)}`);
 fixture(lines.join('\n'),read=>{
  const page=read({offset:-3,length:1,maxBytes:512});
  assert.equal(page.content,lines.slice(-3).join('\n'));
  assert.equal(page.offset,1797);assert.equal(page.hasMore,false);assert.equal(page.nextOffset,null);
 });
});

test('line scanning skips huge lines without retaining them',()=>{
 fixture('x'.repeat(2*1024*1024)+'\nactual tail\n',read=>{
  const page=read({offset:1,length:1,maxBytes:32});
  assert.equal(page.content,'actual tail');assert.equal(page.truncated,false);
 });
});

test('CRLF lines and a terminal empty line preserve split semantics',()=>{
 fixture('zero\r\none\r\nlast\r\n',read=>{
  assert.equal(read({offset:1,length:2,maxBytes:100}).content,'one\nlast');
  assert.equal(read({offset:-2,maxBytes:100}).content,'last\n');
  assert.equal(read({offset:3,length:1,maxBytes:100}).returnedLines,1);
  assert.equal(read({offset:4,length:1,maxBytes:100}).returnedLines,0);
 });
});

test('byte-limited pages do not corrupt split UTF-8 characters',()=>{
 fixture('aé🙂z\nnext\n',read=>{
  for(const maxBytes of [1,2,3,4,5,6,7,8]){
   const page=read({offset:0,length:1,maxBytes});
   assert.ok(Buffer.byteLength(page.content)<=maxBytes);
   assert.ok(!page.content.includes('\uFFFD'));
  }
  assert.equal(read({offset:1,length:1,maxBytes:16}).content,'next');
 });
});

test('a partial line is explicitly flagged and is not skipped by the cursor',()=>{
 fixture('one\nsecond long line\nthree\n',read=>{
  const page=read({offset:0,length:20,maxBytes:10});
  assert.equal(page.content,'one\nsecond');assert.equal(page.partialLastLine,true);
  assert.equal(page.nextOffset,1);assert.equal(page.truncated,true);
  assert.equal(read({offset:page.nextOffset,length:1,maxBytes:64}).content,'second long line');
 });
});

test('a cap ending at a newline does not create an unobserved empty line',()=>{
 fixture('one\ntwo\n',read=>{
  const page=read({offset:0,length:20,maxBytes:4});
  assert.equal(page.content,'one');assert.equal(page.returnedLines,1);
  assert.equal(page.nextOffset,1);assert.equal(page.partialLastLine,false);assert.equal(page.truncated,true);
 });
});

test('a cap between CR and LF preserves complete line semantics',()=>{
 fixture('one\r\ntwo',read=>{
  const page=read({offset:0,length:1,maxBytes:4});
  assert.equal(page.content,'one');assert.ok(!page.content.includes('\r'));
  assert.equal(read({offset:1,length:1,maxBytes:10}).content,'two');
 });
});

test('out-of-range offset and empty files return an honest terminal page',()=>{
 fixture('a\nb',read=>{
  const page=read({offset:9,length:2,maxBytes:1});
  assert.equal(page.content,'');assert.equal(page.truncated,false);assert.equal(page.hasMore,false);
 });
 fixture('',read=>assert.equal(read({maxBytes:10}).content,''));
});

test('binary reads retain their existing prefix-byte contract',()=>{
 fixture(Buffer.from([0,1,2,3,4,5]),read=>{
  const page=read({offset:999,length:1,maxBytes:3});
  assert.equal(page.type,'binary');assert.equal(page.base64,'AAEC');assert.equal(page.truncated,true);
 });
});

test('invalid windows are rejected instead of silently coercing or allocating',()=>{
 fixture('ok',read=>{
  for(const args of [{maxBytes:0},{maxBytes:-1},{maxBytes:Infinity},{offset:1.5},{length:-1}])
   assert.throws(()=>read(args));
 });
});
