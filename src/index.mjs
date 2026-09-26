export const TOOL_ID='mutation-test-scope-planner';
export const LIMITS=Object.freeze({bytes:65536,functions:100,dependencies:200,tests:100,covers:100,depth:16,milliseconds:5000});
const SEVERITY=Object.freeze({'input-unreadable':'warning','input-invalid':'warning','export-incomplete':'warning','byte-limit':'warning','record-limit':'warning','depth-limit':'warning','time-limit':'warning','identity-duplicate':'warning','dependency-unsupported':'warning','dependent-tests-missing':'error'});
const MESSAGE=Object.freeze({'input-unreadable':'Evidence could not be read.','input-invalid':'Evidence structure is invalid or unsupported.','export-incomplete':'Evidence does not assert complete coverage.','byte-limit':'Evidence exceeds the byte limit.','record-limit':'Evidence exceeds a record limit.','depth-limit':'Evidence exceeds JSON depth 16.','time-limit':'Planning exceeded 5000 milliseconds.','identity-duplicate':'An exported identity or dependency is duplicated.','dependency-unsupported':'A dynamic or unsupported dependency cannot be mapped safely.','dependent-tests-missing':'A changed target has no dependent test in complete coverage evidence.'});
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const only=(x,keys)=>Object.keys(x).every(k=>keys.includes(k));
const id=x=>typeof x==='string'&&x.length>0&&x.length<=128&&![...x].some(char=>{const code=char.codePointAt(0);return code<32||code>=127&&code<=159||code>=0xD800&&code<=0xDFFF||code>=0x200E&&code<=0x200F||code>=0x2028&&code<=0x202E||code>=0x2066&&code<=0x2069;});
const cmp=(a,b)=>a<b?-1:a>b?1:0;
function finding(ruleId,pointer=''){if(!Object.hasOwn(SEVERITY,ruleId))throw Error('Unknown rule');return {ruleId,severity:SEVERITY[ruleId],message:MESSAGE[ruleId],location:{file:'@evidence',pointer}};}
function report(findings,plan=[],checked=0){findings.sort((a,b)=>cmp(a.location.pointer,b.location.pointer)||cmp(a.ruleId,b.ruleId));const status=findings.some(x=>x.severity==='warning')?'incomplete':findings.some(x=>x.severity==='error')?'fail':'pass';return {schemaVersion:'1',tool:TOOL_ID,status,summary:{checked,errors:findings.filter(x=>x.severity==='error').length,warnings:findings.filter(x=>x.severity==='warning').length},plan:status==='incomplete'?[]:plan,findings};}
export const incomplete=ruleId=>report([finding(ruleId)]);
function tooDeep(value){const stack=[[value,0]];while(stack.length){const [item,depth]=stack.pop();if(depth>LIMITS.depth)return true;if(item&&typeof item==='object')for(const child of Object.values(item))stack.push([child,depth+1]);}return false;}

export function planScope(evidence,{now=()=>performance.now()}={}){
  const start=now(),timed=()=>now()-start>LIMITS.milliseconds,findings=[];
  if(tooDeep(evidence))return incomplete('depth-limit');
  if(!object(evidence)||!only(evidence,['schemaVersion','complete','secondsPerMutant','functions','dependencies','tests','metadata'])||evidence.schemaVersion!=='1'||!object(evidence.complete)||!only(evidence.complete,['changes','dependencies','coverage'])||!Array.isArray(evidence.functions)||!Array.isArray(evidence.dependencies)||!Array.isArray(evidence.tests)||!Number.isInteger(evidence.secondsPerMutant)||evidence.secondsPerMutant<1||evidence.secondsPerMutant>3600)return incomplete('input-invalid');
  if(evidence.complete.changes!==true||evidence.complete.dependencies!==true||evidence.complete.coverage!==true)return incomplete('export-incomplete');
  if(evidence.functions.length>LIMITS.functions||evidence.dependencies.length>LIMITS.dependencies||evidence.tests.length>LIMITS.tests)return incomplete('record-limit');
  const byId=new Map(),reverse=new Map();
  for(const [i,item] of evidence.functions.entries()){
    if(timed())return incomplete('time-limit');
    if(!object(item)||!only(item,['id','public','changed','mutants'])||!id(item.id)||typeof item.public!=='boolean'||typeof item.changed!=='boolean'||!Number.isInteger(item.mutants)||item.mutants<0||item.mutants>1000||item.changed&&item.mutants===0){findings.push(finding('input-invalid',`/functions/${i}`));continue;}
    if(byId.has(item.id))findings.push(finding('identity-duplicate',`/functions/${i}/id`));else byId.set(item.id,{...item,i});
  }
  for(const [i,item] of evidence.dependencies.entries()){
    if(timed())return incomplete('time-limit');
    if(!object(item)||!only(item,['caller','callee','kind'])||!id(item.caller)||!id(item.callee)||!id(item.kind)||!byId.has(item.caller)||!byId.has(item.callee)){findings.push(finding('input-invalid',`/dependencies/${i}`));continue;}
    if(item.kind!=='static'){findings.push(finding('dependency-unsupported',`/dependencies/${i}/kind`));continue;}
    const callers=reverse.get(item.callee)??new Set();if(callers.has(item.caller))findings.push(finding('identity-duplicate',`/dependencies/${i}`));callers.add(item.caller);reverse.set(item.callee,callers);
  }
  const tests=[];const testIds=new Set();
  for(const [i,item] of evidence.tests.entries()){
    if(timed())return incomplete('time-limit');
    if(!object(item)||!only(item,['id','covers'])||!id(item.id)||!Array.isArray(item.covers)){findings.push(finding('input-invalid',`/tests/${i}`));continue;}
    if(item.covers.length>LIMITS.covers){findings.push(finding('record-limit',`/tests/${i}/covers`));continue;}
    if(testIds.has(item.id))findings.push(finding('identity-duplicate',`/tests/${i}/id`));testIds.add(item.id);
    if(item.covers.some(name=>!id(name)||!byId.has(name))){findings.push(finding('input-invalid',`/tests/${i}/covers`));continue;}
    tests.push({i,covers:new Set(item.covers)});
  }
  if(timed())return incomplete('time-limit');
  if(findings.some(x=>x.severity==='warning'))return report(findings);
  const plan=[];for(const target of byId.values()){
    if(!target.changed)continue;
    if(timed())return incomplete('time-limit');
    const reached=new Set([target.id]),pending=[target.id];while(pending.length){if(timed())return incomplete('time-limit');for(const caller of reverse.get(pending.pop())??[])if(!reached.has(caller)){reached.add(caller);pending.push(caller);}}
    const selected=tests.filter(test=>[...test.covers].some(name=>reached.has(name))).map(test=>`/tests/${test.i}`);
    if(selected.length===0)findings.push(finding('dependent-tests-missing',`/functions/${target.i}`));
    plan.push({target:`/functions/${target.i}`,risk:target.public?'high':'medium',tests:selected,estimatedMutants:target.mutants,estimatedSeconds:target.mutants*evidence.secondsPerMutant});
  }
  if(timed())return incomplete('time-limit');
  if(plan.length===0)findings.push(finding('export-incomplete','/functions'));
  return report(findings,plan,plan.length);
}
