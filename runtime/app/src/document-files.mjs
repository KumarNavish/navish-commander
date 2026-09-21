import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {allowed,readFileTool,writeFileTool,editBlockTool,getFileInfoTool} from './files.mjs';
import {atomicWrite} from './util.mjs';

const MAX_FILE=16*1024*1024;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const extension=p=>path.extname(p).toLowerCase();
const images={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'};
const formats=new Set(['.docx','.xlsx','.xlsm','.pdf',...Object.keys(images)]);
async function documentBrowser(){
  const {default:puppeteer}=await import('puppeteer-core');
  const executablePath=[process.env.NAVISH_CHROMIUM,process.env.CHROMIUM_BIN,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome'].find(p=>p&&fs.existsSync(p));
  if(!executablePath)throw Error('Document rendering requires installed Chrome/Chromium; set NAVISH_CHROMIUM to its executable. No browser is downloaded.');
  return puppeteer.launch({executablePath,headless:true,pipe:true,timeout:30000});
}
async function imageBlock(buffer,mime){
  if(buffer.length<=300000)return {type:'image',mimeType:mime,data:buffer.toString('base64')};
  const browser=await documentBrowser();
  try{
    const page=await browser.newPage();await page.setJavaScriptEnabled(false);
    await page.setViewport({width:1024,height:1024});
    await page.setContent(`<style>body{margin:0}img{display:block;max-width:1024px;max-height:1024px}</style><img src="data:${mime};base64,${buffer.toString('base64')}">`,{waitUntil:'load',timeout:15000});
    const img=await page.$('img');const data=await img.screenshot({type:'jpeg',quality:65,encoding:'base64',timeout:15000});
    if(data.length>700000)throw Error('Image thumbnail exceeds the response budget');
    return {type:'image',mimeType:'image/jpeg',data,resized:true};
  }finally{await browser.close();}
}
function bytes(p){const st=fs.statSync(p);if(!st.isFile()||st.size>MAX_FILE)throw Error('Document must be a regular file of at most 16 MiB');return fs.readFileSync(p);}
function bounded(result,max=16384){
  const content=String(result.content??''),buffer=Buffer.from(content),truncated=buffer.length>max;
  // TextDecoder streaming discards an incomplete final UTF-8 sequence.
  return {...result,content:truncated?new TextDecoder().decode(buffer.subarray(0,max),{stream:true}):content,truncated:truncated||!!result.truncated};
}
async function handler(ext){
  if(ext==='.docx')return new (await import('./vendor-docx.mjs')).DocxFileHandler();
  return new (await import('./vendor-excel.mjs')).ExcelFileHandler();
}
async function validatePackage(p,ext){
  if(!['.docx','.xlsx','.xlsm'].includes(ext))return;
  const {default:Zip}=await import('pizzip'),{XMLValidator}=await import('fast-xml-parser');
  const zip=new Zip(bytes(p));let total=0;
  for(const [name,entry] of Object.entries(zip.files)){
    if(entry.dir)continue;
    const expanded=entry.asUint8Array();total+=expanded.length;
    if(total>64*1024*1024)throw Error('Expanded document exceeds 64 MiB');
    if(/\.(xml|rels)$/.test(name)&&XMLValidator.validate(Buffer.from(expanded).toString('utf8'))!==true)throw Error(`Invalid document XML: ${name}`);
  }
  if(!zip.file(ext==='.docx'?'word/document.xml':'xl/workbook.xml'))throw Error('Document package is missing its main part');
}

async function pdfRead(buffer,args){
  const {getDocumentProxy,extractImages}=await import('unpdf');
  const pdf=await getDocumentProxy(new Uint8Array(buffer));
  try{
    const offset=args.offset<0?Math.max(0,pdf.numPages+args.offset):args.offset??0;
    const end=Math.min(pdf.numPages,offset+Math.min(args.length??20,100));
    let content='',nextOffset=offset,nextTextOffset=0,truncated=false;const imageBlocks=[];let imageBytes=0,imagesTruncated=false;
    for(let i=offset;i<end;i++){
      const page=await pdf.getPage(i+1),text=await page.getTextContent();
      const pageText=`[Page ${i+1}]\n`+text.items.map(x=>x.str+(x.hasEOL?'\n':' ')).join('')+'\n';
      const start=i===offset?(args.options?.textOffset??0):0;
      const remaining=(args.maxBytes??16384)-Buffer.byteLength(content);
      const part=bounded({content:pageText.slice(start)},remaining);
      content+=part.content;truncated=part.truncated;
      nextOffset=truncated?i:i+1;nextTextOffset=truncated?start+part.content.length:0;
      if(args.options?.extractImages){
        const {PNG}=await import('pngjs');
        for(const img of await extractImages(pdf,i+1)){
          if(imageBlocks.length>=4||img.width*img.height>16000000){imagesTruncated=true;continue;}
          const scale=Math.min(1,1024/Math.max(img.width,img.height));
          const w=Math.max(1,Math.floor(img.width*scale)),h=Math.max(1,Math.floor(img.height*scale));
          const png=new PNG({width:w,height:h});
          for(let y=0;y<h;y++)for(let x=0;x<w;x++){
            const src=(Math.floor(y/scale)*img.width+Math.floor(x/scale))*img.channels,dst=(y*w+x)*4;
            for(let c=0;c<3;c++)png.data[dst+c]=img.data[src+(img.channels===1?0:c)];
            png.data[dst+3]=img.channels===4?img.data[src+3]:255;
          }
          const data=PNG.sync.write(png).toString('base64');
          if(imageBytes+data.length>2*1024*1024){imagesTruncated=true;continue;}
          imageBytes+=data.length;imageBlocks.push({type:'image',mimeType:'image/png',data,page:i+1});
        }
      }
      page.cleanup();
      if(truncated||Buffer.byteLength(content)>=(args.maxBytes??16384))break;
    }
    return {type:'pdf',content,pageCount:pdf.numPages,offset,nextOffset:nextOffset<pdf.numPages?nextOffset:null,nextTextOffset,hasMore:nextOffset<pdf.numPages,truncated,imagesTruncated,imageBlocks};
  }finally{await pdf.loadingTask.destroy();}
}

async function download(url){
  let current=new URL(url);const signal=AbortSignal.timeout(15000);
  for(let n=0;n<6;n++){
    if(!['http:','https:'].includes(current.protocol)||current.username||current.password)throw Error('Use an HTTP(S) URL without embedded credentials');
    const response=await fetch(current,{signal,redirect:'manual'});
    if([301,302,303,307,308].includes(response.status)){
      await response.body?.cancel();current=new URL(response.headers.get('location'),current);continue;
    }
    if(!response.ok){await response.body?.cancel();throw Error(`URL read failed: HTTP ${response.status}`);}
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_FILE)throw Error('URL response exceeds 16 MiB');chunks.push(value);}}finally{await reader.cancel();}
    return {buffer:Buffer.concat(chunks),url:current.href,mime:response.headers.get('content-type')?.split(';')[0]};
  }
  throw Error('URL redirect limit exceeded');
}

/** Load the document engines ahead of the first document call; hosts that load modules slowly otherwise pay it inside a chat turn. */
export async function warmDocumentEngines(pause=async()=>{}){
  const modules=['pizzip','fast-xml-parser','./vendor-docx.mjs','./vendor-excel.mjs','unpdf','pdf-lib','markdown-it','puppeteer-core'];
  const warmed=[],failed=[];
  for(const name of modules){
    try{await import(name);warmed.push(name);}catch(e){failed.push({module:name,error:e.message});}
    await pause();
  }
  return {warmed,failed};
}
export async function readDocument(args,config){
  if(!args.isUrl&&!path.isAbsolute(args.path))throw Error('Local file path must be absolute');
  if(!args.isUrl&&!formats.has(extension(args.path)))return readFileTool(args,config);
  let p,ext,downloaded;
  if(args.isUrl){
    downloaded=await download(args.path);ext=extension(new URL(downloaded.url).pathname);
    const byMime={'application/pdf':'.pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'.docx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'.xlsx',...Object.fromEntries(Object.entries(images).map(([e,m])=>[m,e]))};
    ext=byMime[downloaded.mime]??ext;
  }else{p=allowed(args.path,config);ext=extension(p);}
  const buffer=downloaded?.buffer??bytes(p),identity={path:args.path,...(downloaded?{url:downloaded.url}:{}),size:buffer.length};
  if(ext==='.pdf')return {...identity,...await pdfRead(buffer,args)};
  if(images[ext]){
    const image=await imageBlock(buffer,images[ext]);
    return {...identity,type:'image',mimeType:image.mimeType,resized:!!image.resized,imageBlocks:[image]};
  }
  if(['.docx','.xlsx','.xlsm'].includes(ext)){
    let dir;
    try{
      if(downloaded){dir=fs.mkdtempSync(path.join(os.tmpdir(),'navish-url-'));p=path.join(dir,'document'+ext);fs.writeFileSync(p,buffer,{mode:0o600});}
      await validatePackage(p,ext);
      const result=await (await handler(ext)).read(p,{...args,length:Math.min(args.length??200,1000)});
      return {...identity,type:ext.slice(1),...bounded(result,args.maxBytes)};
    }finally{if(dir)fs.rmSync(dir,{recursive:true,force:true});}
  }
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'navish-url-'));
  try{p=path.join(dir,'download');fs.writeFileSync(p,buffer,{mode:0o600});return {...readFileTool({...args,path:p},{}),...identity};}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
}
export async function readDocuments(args,config){
  // Sequential reads bound parser memory; each file has an independent outcome.
  const files=[];for(const p of args.paths){try{files.push(await readDocument({path:p,maxBytes:args.maxBytes,length:200},config));}catch(e){files.push({path:p,error:e.message});}}
  return {files};
}

async function stagedWrite(target,args,config,prepare){
  const p=allowed(target,config);let before,mode=0o600;
  if(fs.existsSync(p)){if(!fs.lstatSync(p).isFile())throw Error('Document destination must be a regular file');before=bytes(p);mode=fs.statSync(p).mode&0o777;}
  if(args.expectedSha256&&hash(before??Buffer.alloc(0))!==args.expectedSha256)throw Error('EDIT_SOURCE_CHANGED: read the current file before editing');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'navish-document-')),stage=path.join(dir,'document'+extension(p));
  try{
    if(before)fs.writeFileSync(stage,before,{mode:0o600});
    const result=await prepare(stage);
    const after=bytes(stage);await validatePackage(stage,extension(p));
    if(before?(!fs.existsSync(p)||hash(bytes(p))!==hash(before)):fs.existsSync(p))throw Error('EDIT_SOURCE_CHANGED: no file was changed');
    atomicWrite(p,after,mode);
    return {...result,path:p,bytes:after.length,...(before?{beforeSha256:hash(before)}:{}),sha256:hash(after)};
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
export async function writeDocument(args,config){
  const ext=extension(args.path);
  if(ext==='.pdf')throw Error('Use commander_write_pdf to create or modify PDF files');
  if(ext==='.xls'||ext==='.xlsm')throw Error('Use .xlsx for spreadsheet writes; legacy XLS and macro preservation are not supported');
  if(!['.docx','.xlsx'].includes(ext)&&!images[ext])return writeFileTool(args,config);
  if(ext==='.xlsx'){
    let value;try{value=JSON.parse(args.content);}catch{throw Error('Spreadsheet content must be JSON rows or named sheets');}
    const rows=v=>Array.isArray(v)&&v.every(row=>Array.isArray(row));
    if(!rows(value)&&!(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length&&Object.values(value).every(rows)))throw Error('Spreadsheet content must contain 2D row arrays');
  }
  return stagedWrite(args.path,args,config,async p=>{
    if(images[ext]){
      if(args.mode==='append')throw Error('Appending to images is not supported');
      const encoded=args.content.replace(/^data:image\/[a-z]+;base64,/, '');
      if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)||!encoded.length)throw Error('Image content must be base64');
      fs.writeFileSync(p,Buffer.from(encoded,'base64'));
    }else await (await handler(ext)).write(p,args.content,args.mode??'rewrite');
    return {mode:args.mode??'rewrite'};
  });
}
export async function editDocument(args,config){
  const ext=extension(args.file_path);
  if(ext==='.xls'||ext==='.xlsm')throw Error('Spreadsheet edits require .xlsx; legacy XLS and macros are not supported');
  if(!['.docx','.xlsx'].includes(ext))return editBlockTool(args,config);
  if(!fs.existsSync(allowed(args.file_path,config)))throw Error('Document to edit does not exist');
  return stagedWrite(args.file_path,args,config,async p=>{
    await validatePackage(p,ext);const engine=await handler(ext);
    if(ext==='.xlsx'){
      if(typeof args.range!=='string'||!Array.isArray(args.content)||!args.content.length||!args.content.every(Array.isArray))throw Error('Spreadsheet edits require range and a nonempty 2D content array');
      const [,cells]=engine.parseRange(args.range);
      if(cells){const {startRow,startCol,endRow,endCol}=engine.parseCellRange(cells);
        if(cells.includes(':')&&(args.content.length>endRow-startRow+1||args.content.some(r=>r.length>endCol-startCol+1)))throw Error('Content exceeds the specified spreadsheet range');}
    }else if(typeof args.old_string!=='string'||!args.old_string||typeof args.new_string!=='string')throw Error('DOCX edits require old_string and new_string');
    const result=await engine.editRange(p,args.range??'',ext==='.docx'?args:args.content,args);
    if(!result.success)throw Error((result.errors??['Document edit failed']).map(e=>typeof e==='string'?e:e.error).join('; '));
    return result;
  });
}
export async function documentInfo(args,config){
  const result=await getFileInfoTool(args,config),ext=extension(args.path);
  if(result.type!=='file'||!formats.has(ext))return result;
  if(ext==='.pdf'){const {PDFDocument}=await import('pdf-lib');return {...result,pageCount:(await PDFDocument.load(bytes(result.path))).getPageCount()};}
  if(['.docx','.xlsx','.xlsm'].includes(ext)){await validatePackage(result.path,ext);return {...result,document:await (await handler(ext)).getInfo(result.path)};}
  return {...result,mimeType:images[ext]};
}

async function markdownPdf(content,options={},config={}){
  const {default:MarkdownIt}=await import('markdown-it');
  const browser=await documentBrowser();
  try{
    const page=await browser.newPage();await page.setJavaScriptEnabled(false);await page.setRequestInterception(true);
    // A document may embed authorized local images; rendering never fetches
    // remote assets or uses the user's signed-in browser profile.
    page.on('request',async request=>{try{
      if(request.url().startsWith('data:'))return await request.continue();
      const url=new URL(request.url());
      if(url.protocol==='file:'&&request.resourceType()==='image'){
        const p=allowed(decodeURIComponent(url.pathname),config),mime=images[extension(p)];
        if(mime)return await request.respond({status:200,contentType:mime,body:bytes(p)});
      }
      await request.abort();
    }catch{try{await request.abort();}catch{}}});
    const markdown=new MarkdownIt({html:true,linkify:false});
    const html=`<!doctype html><html><head><meta charset="utf-8"><base href="file:///"><style>body{font:11pt sans-serif;line-height:1.45}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:5px}img,svg{max-width:100%}pre{white-space:pre-wrap}h1,h2,h3{break-after:avoid}</style></head><body>${markdown.render(content)}</body></html>`;
    await page.setContent(html,{waitUntil:'load',timeout:15000});
    const safe=Object.fromEntries(['format','landscape','scale','margin','printBackground','preferCSSPageSize'].filter(k=>k in options).map(k=>[k,options[k]]));
    return Buffer.from(await page.pdf({format:'A4',printBackground:true,margin:{top:'18mm',bottom:'18mm',left:'18mm',right:'18mm'},...safe,timeout:30000}));
  }finally{await browser.close();}
}
export async function writePdf(args,config){
  const target=args.outputPath??args.path;
  if(extension(target)!=='.pdf')throw Error('PDF destination must use .pdf');
  if(Array.isArray(args.content)&&(!args.outputPath||path.resolve(args.outputPath)===path.resolve(args.path)))throw Error('PDF modification requires a distinct outputPath to preserve the original');
  return stagedWrite(target,args,config,async p=>{
    const {PDFDocument}=await import('pdf-lib');let document;
    if(typeof args.content==='string')document=await PDFDocument.load(await markdownPdf(args.content,args.options,config));
    else{
      document=await PDFDocument.load(bytes(allowed(args.path,config)));
      for(const op of args.content){
        if(op.type==='delete'){
          const indexes=op.pageIndexes;
          if(!Array.isArray(indexes)||!indexes.length||indexes.some(i=>!Number.isSafeInteger(i)||i<0||i>=document.getPageCount())||new Set(indexes).size!==indexes.length)throw Error('Invalid PDF page deletion indexes');
          for(const i of [...indexes].sort((a,b)=>b-a))document.removePage(i);
        }else if(op.type==='insert'){
          if(!Number.isSafeInteger(op.pageIndex)||op.pageIndex<0||op.pageIndex>document.getPageCount()||Number(typeof op.markdown==='string')+Number(typeof op.sourcePdfPath==='string')!==1)throw Error('PDF insert requires a valid index and exactly one of markdown or sourcePdfPath');
          const source=await PDFDocument.load(op.sourcePdfPath?bytes(allowed(op.sourcePdfPath,config)):await markdownPdf(op.markdown,op.pdfOptions,config));
          const pages=await document.copyPages(source,source.getPageIndices());pages.forEach((page,i)=>document.insertPage(op.pageIndex+i,page));
        }else throw Error('Unknown PDF operation');
      }
    }
    if(!document.getPageCount())throw Error('A PDF must retain at least one page');
    fs.writeFileSync(p,await document.save());return {pageCount:document.getPageCount(),sourcePath:args.path};
  });
}
