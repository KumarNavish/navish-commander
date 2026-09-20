import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import Zip from 'pizzip';
import ExcelJS from 'exceljs';
import {PDFDocument} from 'pdf-lib';
import {PNG} from 'pngjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const server=path.resolve(process.env.NAVISH_MCP_SERVER||'src/server.mjs');
const digest=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
async function lab(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'navish-doc-test-'));
  const env={...process.env,NAVISH_CONFIG_DIR:root+'/config',NAVISH_STATE_DIR:root+'/state',NAVISH_DATA_DIR:root+'/data'};
  let client,counter=0;
  const connect=async()=>{client=new Client({name:'document-acceptance',version:'1'});const transport=new StdioClientTransport({command:process.execPath,args:[server],env,stderr:'pipe'});transport.stderr?.resume();await client.connect(transport);};
  await connect();
  const raw=(name,args)=>client.callTool({name:'commander_'+name,arguments:{device:'local',...args}});
  const call=async(name,args)=>{const r=await raw(name,args);assert.equal(r.isError,false,JSON.stringify(r));return r.structuredContent.result;};
  return {root,raw,call,id:()=>`doc-${++counter}`,restart:async()=>{await client.close();await connect();},close:async()=>{await client.close();fs.rmSync(root,{recursive:true,force:true});}};
}
test('DOCX round trip: exact XML edits, invalid/stale edits preserve source, replay survives restart',async()=>{
  const l=await lab();try{
    const p=l.root+'/report.docx';
    await l.call('write_file',{path:p,callId:l.id(),content:'# Research report\n\nA useful result.\n\nA repeated word repeated.'});
    const zip=new Zip(fs.readFileSync(p));
    zip.file('word/header1.xml','<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t xml:space="preserve"> header\n  whitespace </w:t></w:r></w:p></w:hdr>');
    fs.writeFileSync(p,zip.generate({type:'nodebuffer'}));fs.chmodSync(p,0o640);
    const before=digest(p);assert.match((await l.call('read_file',{path:p})).content,/useful result/);
    const ambiguous=await l.raw('edit_block',{file_path:p,callId:l.id(),old_string:'repeated',new_string:'changed'});assert.equal(ambiguous.isError,true);assert.equal(digest(p),before);
    const invalid=await l.raw('edit_block',{file_path:p,callId:l.id(),old_string:'A useful result.',new_string:'<broken>'});assert.equal(invalid.isError,true);assert.equal(digest(p),before);
    const edit={file_path:p,callId:l.id(),old_string:'A useful result.',new_string:'A verified result.',expectedSha256:before};
    await l.call('edit_block',edit);const edited=digest(p);await l.restart();await l.call('edit_block',edit);assert.equal(digest(p),edited);
    assert.equal(fs.statSync(p).mode&0o777,0o640);
    assert.equal(new Zip(fs.readFileSync(p)).file('word/header1.xml').asText(),zip.file('word/header1.xml').asText());
    await l.call('edit_block',{file_path:p,callId:l.id(),old_string:'header',new_string:'heading'});
    assert.match(new Zip(fs.readFileSync(p)).file('word/header1.xml').asText(),/ heading\n  whitespace /);
    const stale=await l.raw('edit_block',{...edit,callId:l.id()});assert.equal(stale.isError,true);
    assert.ok((await l.call('get_file_info',{path:p})).document);
  }finally{await l.close();}
});
test('XLSX preserves typed cells and sparse append; range overflow is rejected atomically',async()=>{
  const l=await lab();try{
    const p=l.root+'/measurements.xlsx';
    await l.call('write_file',{path:p,callId:l.id(),content:JSON.stringify({Measurements:[['count','valid','formula'],[3,true,'=A2*2']]})});
    await l.call('edit_block',{file_path:p,callId:l.id(),range:'Measurements!A10:B10',content:[[9,false]]});
    const before=digest(p);
    const overflow=await l.raw('edit_block',{file_path:p,callId:l.id(),range:'Measurements!A1:B1',content:[[1,2,3]]});assert.equal(overflow.isError,true);assert.equal(digest(p),before);
    await l.call('write_file',{path:p,callId:l.id(),mode:'append',content:JSON.stringify({Measurements:[[10,true]]})});
    const book=new ExcelJS.Workbook();await book.xlsx.readFile(p);const sheet=book.getWorksheet('Measurements');
    assert.equal(sheet.getCell('A10').value,9);assert.equal(sheet.getCell('A11').value,10);assert.deepEqual(sheet.getCell('C2').value,{formula:'A2*2'});
    assert.match((await l.call('read_file',{path:p,range:'Measurements!A2:C2'})).content,/"formula":"A2\*2"/);
    assert.match((await l.call('read_file',{path:p,sheet:'Measurements',offset:-2})).content,/\[9,false/);
    const info=await l.call('get_file_info',{path:p});assert.ok(info.document);
  }finally{await l.close();}
});
test('PDF creation, page read, insert/delete and rejected edits preserve original',async()=>{
  const l=await lab();try{
    const p=l.root+'/original.pdf',q=l.root+'/edited.pdf';
    const create={path:p,callId:l.id(),content:'# First page\n\nVerified document.\n\n<div style="page-break-before:always"></div>\n\n# Second page'};
    assert.equal((await l.call('write_pdf',create)).pageCount,2);const original=digest(p);
    await l.restart();await l.call('write_pdf',create);assert.equal(digest(p),original);
    const second=await l.call('read_file',{path:p,offset:1,length:1});assert.match(second.content,/Second page/);assert.doesNotMatch(second.content,/First page/);assert.equal(second.pageCount,2);
    let offset=1,textOffset=0,collected='';
    for(let i=0;i<20&&offset!==null;i++){
      const r=await l.call('read_file',{path:p,offset,length:1,maxBytes:10,options:{textOffset}});
      collected+=r.content;offset=r.nextOffset;textOffset=r.nextTextOffset;
    }
    assert.equal(offset,null);assert.equal(collected,second.content);
    const ops=[{type:'delete',pageIndexes:[0]},{type:'insert',pageIndex:1,sourcePdfPath:p}];
    assert.equal((await l.call('write_pdf',{path:p,outputPath:q,callId:l.id(),content:ops})).pageCount,3);assert.equal(digest(p),original);
    assert.equal((await PDFDocument.load(fs.readFileSync(q))).getPageCount(),3);
    const edited=digest(q);const bad=await l.raw('write_pdf',{path:p,outputPath:q,callId:l.id(),content:[{type:'delete',pageIndexes:[4]}]});assert.equal(bad.isError,true);assert.equal(digest(q),edited);
    assert.equal((await l.call('get_file_info',{path:q})).pageCount,3);
    const mixed=await l.call('read_multiple_files',{paths:[p,q,l.root+'/missing']});assert.equal(mixed.files.length,3);assert.match(mixed.files[2].error,/ENOENT/);
  }finally{await l.close();}
});
test('MCP emits native images once; PDF extraction and URL reads use bounded content',async()=>{
  const l=await lab();let httpServer;
  try{
    const png=new PNG({width:2,height:2});png.data.fill(255);const buffer=PNG.sync.write(png),p=l.root+'/image.png';fs.writeFileSync(p,buffer);
    const img=await l.raw('read_file',{path:p});assert.equal(img.content[1].type,'image');assert.equal(img.content[1].data,buffer.toString('base64'));assert.equal(JSON.stringify(img.structuredContent).includes(buffer.toString('base64')),false);
    const noise=new PNG({width:600,height:600});crypto.randomFillSync(noise.data);const large=l.root+'/large.png';fs.writeFileSync(large,PNG.sync.write(noise));
    const thumbnail=await l.raw('read_file',{path:large});assert.equal(thumbnail.structuredContent.result.resized,true);assert.equal(thumbnail.content[1].mimeType,'image/jpeg');assert.ok(Buffer.byteLength(JSON.stringify(thumbnail))<1048576);
    const doc=await PDFDocument.create(),page=doc.addPage();page.drawImage(await doc.embedPng(buffer),{x:10,y:10,width:100,height:100});const pdf=l.root+'/image.pdf';fs.writeFileSync(pdf,await doc.save());
    const extracted=await l.raw('read_file',{path:pdf,options:{extractImages:true}});assert.equal(extracted.content[1].type,'image');assert.equal(extracted.content[1].mimeType,'image/png');
    httpServer=http.createServer((req,res)=>{if(req.url==='/redirect'){res.writeHead(302,{location:'/text'});res.end();}else if(req.url==='/pdf'){res.writeHead(200,{'content-type':'application/pdf'});res.end(fs.readFileSync(pdf));}else{res.end('first\nsecond\nthird');}});
    await new Promise(r=>httpServer.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${httpServer.address().port}`;
    assert.equal((await l.call('read_file',{path:url+'/redirect',isUrl:true,offset:1,length:1})).content,'second');
    assert.equal((await l.call('read_file',{path:url+'/pdf',isUrl:true})).pageCount,1);
    assert.equal((await l.raw('read_file',{path:'file:///etc/passwd',isUrl:true})).isError,true);
  }finally{if(httpServer)await new Promise(r=>httpServer.close(r));await l.close();}
});
