// Compress large wire envelopes, leaving durable records and their hashes in
// the existing canonical JSON representation. Decode limits cover expanded data.
export const MAX_CHANNEL_MESSAGE_BYTES=1048576;
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
async function boundedBytes(stream,limit){
  const reader=stream.getReader(),parts=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>limit)throw Error('CHANNEL_MESSAGE_TOO_LARGE');parts.push(value);
  }}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.byteLength;}return bytes;
}
export async function encodeChannelMessage(value){
  const text=JSON.stringify(value),bytes=encoder.encode(text);
  if(bytes.byteLength>MAX_CHANNEL_MESSAGE_BYTES)throw Error('CHANNEL_MESSAGE_TOO_LARGE');
  if(bytes.byteLength<4096)return text;
  const compressed=await boundedBytes(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')),MAX_CHANNEL_MESSAGE_BYTES);
  return compressed.byteLength<bytes.byteLength?compressed:text;
}
export async function decodeChannelMessage(message){
  if(typeof message==='string'){
    if(encoder.encode(message).byteLength>MAX_CHANNEL_MESSAGE_BYTES)throw Error('CHANNEL_MESSAGE_TOO_LARGE');
    return JSON.parse(message);
  }
  const bytes=message instanceof ArrayBuffer?new Uint8Array(message):ArrayBuffer.isView(message)?new Uint8Array(message.buffer,message.byteOffset,message.byteLength):null;
  if(!bytes||bytes.byteLength>MAX_CHANNEL_MESSAGE_BYTES)throw Error('INVALID_CHANNEL_MESSAGE');
  return JSON.parse(decoder.decode(await boundedBytes(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),MAX_CHANNEL_MESSAGE_BYTES)));
}
