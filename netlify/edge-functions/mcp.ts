import {Buffer} from 'node:buffer';
import {netlifyHandler} from '../../connector/netlify-handler.mjs';
globalThis.Buffer??=Buffer;
export default (req:Request)=>netlifyHandler(req,(name:string)=>Netlify.env.get(name));
