import {createHash} from 'node:crypto';
import {toolResult} from './queue.mjs';

// The full response is already durable in the local journal. A delivery limit
// must not turn a completed operation into a permanently pending queue entry.
// Project only the uploaded copy; never rewrite the original receipt or result.
export function boundResultEnvelope(message,limit){
  if(Buffer.byteLength(JSON.stringify(message))<=limit)return message;
  const response=message.response,value=response?.structuredContent??{};
  const raw=JSON.stringify(response),identity={};
  for(const key of ['operationId','toolName','requestSha256','device','path','callId','sessionId','batchId','jobId','repository']){
    const entry=value.connectorOperation?.[key];
    if(typeof entry==='string'&&entry.length<=4096)identity[key]=entry;
  }
  const projected={state:value.state??'uncertain',operationState:value.operationState??'unknown',
    operationId:message.id,connectorOperation:identity,retrySafe:false,result:null,
    code:'CONNECTOR_RESULT_TOO_LARGE',transportState:'result_omitted',
    originalResponseBytes:Buffer.byteLength(raw),responseLimitBytes:limit,
    responseSha256:createHash('sha256').update(raw).digest('hex'),originalResultRetainedLocally:true,
    message:'The full response is retained in the local journal. This delivery limit does not change the reported execution state. Do not replay the original mutation. Read the original process or batch with bounded output, or use a smaller read. The connector receipt retains this notice.'};
  for(const key of ['callId','sessionId','batchId','jobId']){
    const entry=value[key]??value.result?.[key]??identity[key];
    if(typeof entry==='string'&&entry.length<=120)projected[key]=entry;
  }
  if(Number.isInteger(value.result?.exitCode))projected.exitCode=value.result.exitCode;
  const bounded={...message,response:toolResult(projected,true)};
  if(Buffer.byteLength(JSON.stringify(bounded))>limit)throw Error('RESULT_NOTICE_TOO_LARGE');
  return bounded;
}
