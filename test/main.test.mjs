import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('../dist/main.mjs',import.meta.url),'utf8');
const cid='QmdRFSobiBMoKKyNZnwahtn8uzPFxat86qg1Mu7KobJcSb',hash='0x'+'ab'.repeat(32);
const native='0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',directory='0x835482fe0532f169024d5e9410199369aad5c77e';
const addr=n=>'0x'+n.toString(16).padStart(40,'0');
const meta=()=>({deployment:cid,hasIndexingErrors:false,block:{number:1000,hash}});
const row=(i=1)=>({id:addr(i),inputToken:{id:native,name:'Ether',symbol:'ETH',decimals:18},outputToken:{id:addr(i),name:'Example native Ether',symbol:'fETH-1',decimals:18},protocol:{id:directory,name:'Rari Fuse',slug:'rari-fuse'}});
const pool=(number=0,ids=[addr(1)])=>({id:addr(10000+number),name:'Registered Example',poolNumber:String(number),marketIDs:ids});
const response=data=>({ok:true,json:async()=>({data})});
async function load(handler){
 const calls=[];
 const mock=async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,options,body});return handler(body,calls.length);};
 const context=vm.createContext({AbortController,setTimeout,clearTimeout});
 const dependency=new vm.SyntheticModule(['default'],function(){this.setExport('default',mock);},{context});
 const module=new vm.SourceTextModule(code,{context});
 await module.link(s=>{assert.equal(s,'node-fetch');return dependency;});await module.evaluate();
 return{run:module.namespace.returnTags,calls,exports:Object.keys(module.namespace)};
}
const fixture=(rows=[row()],pools=[pool()],changes={})=>async(body)=>response({_meta:{...meta(),...changes},...(body.query.includes('NativeMarkets(')?{markets:rows}:body.query.includes('FusePools(')?{fusePools:pools}:{})});
test('one exported async function has exactly two arguments; bad arguments do not read',async()=>{
 const x=await load(fixture());assert.deepEqual(x.exports,['returnTags']);assert.equal(x.run.length,2);assert.equal(x.run.constructor.name,'AsyncFunction');
 for(const chain of ['10','01','0x1','__proto__',1,null])await assert.rejects(x.run(chain,'key'),/Unsupported/);
 for(const key of ['',null,' white space '])await assert.rejects(x.run('1',key),/API key/);
 assert.equal(x.calls.length,0);
});
test('dynamic native receipt, canonical query, pool context and bearer-only key',async()=>{
 const x=await load(fixture()),[tag]=await x.run('1','test-key');
 assert.equal(tag['Contract Address'],'eip155:1:'+addr(1));assert.equal(tag['Public Name Tag'],'Pool 0 fETH-1 Token');
 assert.equal(tag['Project Name'],'Rari Capital');assert.match(tag['Public Note'],/native-ETH receipt token/);assert.match(tag['Public Note'],/registered name: Registered Example/);
 assert.match(tag['Public Note'],/not a statement that the pool currently accepts deposits/);
 assert.equal(x.calls[0].options.headers.authorization,'Bearer test-key');assert(!x.calls[0].url.includes('test-key'));
 assert.equal(x.calls[1].body.variables.block.hash,hash);assert.equal(x.calls[1].body.variables.native,native);
 assert.equal(x.calls[2].body.variables.last,'');assert.match(x.calls[2].body.query,/orderBy: poolNumber/);assert.match(x.calls[2].body.query,/\$last: String!/);
});
test('all markets page by ID, even more than 1000; no partial truncation',async()=>{
 const rows=Array.from({length:1001},(_,i)=>({...row(i+1),outputToken:{...row(i+1).outputToken,symbol:'fETH-'+(i+1)}})),x=await load(async(body)=>response({_meta:meta(),...(body.query.includes('NativeMarkets(')?{markets:body.variables.last?rows.slice(1000):rows.slice(0,1000)}:body.query.includes('FusePools(')?{fusePools:[pool(0,rows.map(r=>r.id))]}:{})}));
 const tags=await x.run('1','key');assert.equal(tags.length,1001);assert.equal(x.calls[2].body.variables.last,addr(1000));
 assert.equal(new Set(tags.map(t=>t['Public Name Tag'])).size,1001);
});
test('all pools page by their unique sequential number',async()=>{
 const pools=Array.from({length:1001},(_,i)=>pool(i,i===1000?[addr(1)]:[])).sort((a,b)=>a.poolNumber<b.poolNumber?-1:1),x=await load(async(body)=>response({_meta:meta(),...(body.query.includes('NativeMarkets(')?{markets:[row()]}:body.query.includes('FusePools(')?{fusePools:body.variables.last===''?pools.slice(0,1000):pools.slice(1000)}:{})}));
 const [tag]=await x.run('1','key');assert.equal(tag['Public Name Tag'],'Pool 1000 fETH-1 Token');assert.equal(x.calls[3].body.variables.last,pools[999].poolNumber);
});
test('two genuine native tokens in the same pool are address-disambiguated',async()=>{
 const x=await load(fixture([row(1),row(2)],[pool(193,[addr(1),addr(2)])]));
 // These fixture addresses share their first eight hex characters, so the
 // module refuses ambiguous shortened names instead of quietly merging them.
 await assert.rejects(x.run('1','key'),/Ambiguous/);
 const a={...row(),id:'0x275983fdef769da214cbfe3a809170159c51ebeb',outputToken:{...row().outputToken,id:'0x275983fdef769da214cbfe3a809170159c51ebeb'}},b={...row(),id:'0x2c88b6dd5dd6f576b4ee6566dee706a4039906fd',outputToken:{...row().outputToken,id:'0x2c88b6dd5dd6f576b4ee6566dee706a4039906fd'}};
 const y=await load(fixture([a,b],[pool(193,[a.id,b.id])]));const tags=await y.run('1','key');
 assert.equal(tags[0]['Public Name Tag'],'Pool 193 fETH-1 Token (275983fd)');assert.equal(tags[1]['Public Name Tag'],'Pool 193 fETH-1 Token (2c88b6dd)');
});
test('metadata and membership contradictions, malformed output and unknown native associations throw',async()=>{
 const broken=[[],[{...row(),outputToken:null}],[{...row(),outputToken:{...row().outputToken,id:addr(7)}}],[{...row(),inputToken:{...row().inputToken,id:addr(7)}}],[{...row(),protocol:{...row().protocol,id:addr(9)}}],[{...row(),outputToken:{...row().outputToken,decimals:-1}}],[row(),row()]];
 for(const rows of broken){const x=await load(fixture(rows));await assert.rejects(x.run('1','key'));}
 for(const pools of [[],[pool(0,[])],[pool(0,[addr(1)]),pool(1,[addr(1)])],[pool(1),pool(0,[])],[{...pool(),poolNumber:'-1'}]]){const x=await load(fixture([row()],pools));await assert.rejects(x.run('1','key'));}
 const repeated=await load(fixture([row()],[pool(0,[addr(1),addr(1)])]));assert.equal((await repeated.run('1','key')).length,1);
 const eightDecimals=await load(fixture([{...row(),outputToken:{...row().outputToken,decimals:8}}]));assert.equal((await eightDecimals.run('1','key')).length,1);
});
test('errors, changed deployment/snapshot and missing initial hash are not empty results',async()=>{
 for(const changes of [{deployment:'wrong'},{hasIndexingErrors:true},{block:{number:1000,hash:null}}]){const x=await load(fixture([row()],[pool()],changes));await assert.rejects(x.run('1','key'));}
 for(const change of [{block:{number:999,hash}},{block:{number:1000,hash:'0x'+'cd'.repeat(32)}}]){const x=await load(async(body,n)=>response({_meta:n===1?meta():{...meta(),...change},markets:[row()],fusePools:[pool()]}));await assert.rejects(x.run('1','key'));}
 const x=await load(async()=>({ok:true,json:async()=>({errors:[{message:'credential-from-provider'}],data:{markets:[]}})}));await assert.rejects(x.run('1','key'),e=>!e.message.includes('credential-from-provider'));
});
test('creator-provided text is plain, token notes explicit, and long tags use permitted ellipsis',async()=>{
 const r={...row(),outputToken:{...row().outputToken,symbol:'X'.repeat(80),name:'<Pool> `Native` ETH'}},p={...pool(),name:'[Admin](https://example.com)'};
 const x=await load(fixture([r],[p])),[tag]=await x.run('1','key');
 assert(tag['Public Name Tag'].length<=50);assert(tag['Public Name Tag'].endsWith('...'));assert(!/[<>`\[\]_*]/.test(tag['Public Note']));assert.match(tag['Public Note'],/token/);
});
test('historical metadata may omit a hash only after an explicit hash-bound snapshot',async()=>{
 const x=await load(async(body,n)=>response({_meta:n===1?meta():{...meta(),block:{number:1000,hash:null}},...(body.query.includes('NativeMarkets(')?{markets:[row()]}:body.query.includes('FusePools(')?{fusePools:[pool()]}:{})}));assert.equal((await x.run('1','key')).length,1);
});
