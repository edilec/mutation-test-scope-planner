import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {planScope,TOOL_ID,LIMITS} from '../src/index.mjs';

const evidence=()=>({schemaVersion:'1',complete:{changes:true,dependencies:true,coverage:true},secondsPerMutant:3,functions:[{id:'branch',public:true,changed:true,mutants:4},{id:'wrapper',public:true,changed:false,mutants:0}],dependencies:[{caller:'wrapper',callee:'branch',kind:'static'}],tests:[{id:'branch-test',covers:['branch']},{id:'wrapper-test',covers:['wrapper']}]});
const run=(root,file='evidence.json')=>spawnSync(process.execPath,['bin/mutation-test-scope-planner.mjs','--root',root,'--input',file],{encoding:'utf8'});

test('changed public branch includes its direct and dependent tests without a score',()=>{
  const r=planScope(evidence(),{now:()=>0});assert.equal(TOOL_ID,'mutation-test-scope-planner');assert.equal(r.status,'pass');assert.deepEqual(r.plan,[{target:'/functions/0',risk:'high',tests:['/tests/0','/tests/1'],estimatedMutants:4,estimatedSeconds:12}]);assert.equal(r.summary.checked,1);assert.equal('mutationScore' in r,false);assert.doesNotMatch(JSON.stringify(r),/branch-test|wrapper-test/);
});
test('opaque path-like identities compare exactly through the 128-unit bound without rendering',()=>{
  const d=evidence(),identity='src/foo.mjs:branch';d.functions[0].id=identity;d.dependencies[0].callee=identity;d.tests[0].covers=[identity];
  let r=planScope(d,{now:()=>0});assert.equal(r.status,'pass');assert.doesNotMatch(JSON.stringify(r),/src\/foo|branch-test/);
  const exact='x'.repeat(128);d.functions[0].id=exact;d.dependencies[0].callee=exact;d.tests[0].covers=[exact];assert.equal(planScope(d,{now:()=>0}).status,'pass');
  const over=exact+'x';d.functions[0].id=over;d.dependencies[0].callee=over;d.tests[0].covers=[over];r=planScope(d,{now:()=>0});assert.equal(r.status,'incomplete');assert.ok(r.findings.some(x=>x.ruleId==='input-invalid'));
});
test('dynamic or unsupported path is incomplete, not a guessed score',()=>{
  const d=evidence();d.dependencies[0].kind='dynamic';let r=planScope(d,{now:()=>0});assert.equal(r.status,'incomplete');assert.ok(r.findings.some(x=>x.ruleId==='dependency-unsupported'));assert.deepEqual(r.plan,[]);
  d.dependencies[0].kind='reflection';r=planScope(d,{now:()=>0});assert.equal(r.status,'incomplete');assert.ok(r.findings.some(x=>x.ruleId==='dependency-unsupported'));
  d.dependencies[0].kind='static';d.complete.coverage=false;assert.equal(planScope(d,{now:()=>0}).status,'incomplete');
});
test('missing dependent tests is a completed failure; unrelated tests do not count',()=>{
  const d=evidence();d.tests=[{id:'unrelated',covers:[]}];let r=planScope(d,{now:()=>0});assert.equal(r.status,'fail');assert.ok(r.findings.some(x=>x.ruleId==='dependent-tests-missing'));d.tests=[];assert.equal(planScope(d,{now:()=>0}).status,'fail');
});
test('unknown fields, duplicate identities, and malformed coverage stay incomplete',()=>{
  const d=evidence();d.compatibilityMode='guess';assert.equal(planScope(d,{now:()=>0}).status,'incomplete');delete d.compatibilityMode;d.tests[1].id='branch-test';assert.equal(planScope(d,{now:()=>0}).status,'incomplete');d.tests[1].id='wrapper-test';d.tests[1].covers=['absent'];assert.equal(planScope(d,{now:()=>0}).status,'incomplete');
  d.tests[1].covers=['wrapper'];d.tests[1].id='private\u202e';const r=planScope(d,{now:()=>0});assert.equal(r.status,'incomplete');assert.doesNotMatch(JSON.stringify(r),/private/);
});
test('function, dependency, test, cover, depth and deadline bounds are two-sided',()=>{
  const d=evidence();d.functions=Array.from({length:LIMITS.functions},(_,i)=>({id:`f${i}`,public:false,changed:false,mutants:0}));d.functions[0].changed=true;d.functions[0].mutants=1;d.tests=[{id:'t',covers:['f0']}];d.dependencies=[];assert.equal(planScope(d,{now:()=>0}).status,'pass');d.functions.push({id:'extra',public:false,changed:false,mutants:0});assert.equal(planScope(d,{now:()=>0}).findings[0].ruleId,'record-limit');
  const q=evidence();q.functions=Array.from({length:LIMITS.functions},(_,i)=>({id:`f${i}`,public:i===0,changed:i===0,mutants:i===0?4:0}));q.tests=[{id:'t',covers:['f0']}];q.dependencies=[];for(let i=0;i<q.functions.length&&q.dependencies.length<LIMITS.dependencies;i++)for(let j=0;j<q.functions.length&&q.dependencies.length<LIMITS.dependencies;j++)if(i!==j)q.dependencies.push({caller:`f${i}`,callee:`f${j}`,kind:'static'});assert.equal(planScope(q,{now:()=>0}).status,'pass');q.dependencies.push({caller:'f1',callee:'f0',kind:'static'});assert.equal(planScope(q,{now:()=>0}).findings[0].ruleId,'record-limit');
  const t=evidence();t.tests=Array.from({length:LIMITS.tests},(_,i)=>({id:`t${i}`,covers:['branch']}));assert.equal(planScope(t,{now:()=>0}).status,'pass');t.tests.push({id:'extra',covers:['branch']});assert.equal(planScope(t,{now:()=>0}).findings[0].ruleId,'record-limit');
  const c=evidence();c.tests=[{id:'t',covers:Array.from({length:LIMITS.covers},()=> 'branch')}];assert.equal(planScope(c,{now:()=>0}).status,'pass');c.tests[0].covers.push('branch');assert.equal(planScope(c,{now:()=>0}).findings[0].ruleId,'record-limit');
  const z=evidence();z.metadata={};let x=z.metadata;for(let i=1;i<LIMITS.depth;i++){x.next={};x=x.next;}assert.equal(planScope(z,{now:()=>0}).status,'pass');x.next={};assert.equal(planScope(z,{now:()=>0}).findings[0].ruleId,'depth-limit');
  let tick=0;assert.equal(planScope(evidence(),{now:()=>tick++?LIMITS.milliseconds:0}).status,'pass');tick=0;assert.equal(planScope(evidence(),{now:()=>tick++?LIMITS.milliseconds+1:0}).findings[0].ruleId,'time-limit');
  const bounds=evidence();bounds.secondsPerMutant=3600;bounds.functions[0].mutants=1000;assert.equal(planScope(bounds,{now:()=>0}).status,'pass');bounds.secondsPerMutant=3601;assert.equal(planScope(bounds,{now:()=>0}).status,'incomplete');bounds.secondsPerMutant=1;bounds.functions[0].mutants=1001;assert.equal(planScope(bounds,{now:()=>0}).status,'incomplete');bounds.functions[0].mutants=1;assert.equal(planScope(bounds,{now:()=>0}).status,'pass');bounds.secondsPerMutant=0;assert.equal(planScope(bounds,{now:()=>0}).status,'incomplete');
});
test('CLI pass/fail, byte N/N+1, duplicate keys, invalid root and symlink confinement',()=>{
  let r=run(path.resolve('examples/pass'));assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout).status,'pass');r=run(path.resolve('examples/fail'));assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout).status,'fail');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mutation-scope-'));try{
    const d=evidence();let raw=JSON.stringify(d);fs.writeFileSync(path.join(dir,'evidence.json'),raw);r=run(dir);assert.equal(r.status,0);fs.writeFileSync(path.join(dir,'evidence.json'),raw.replace('"complete":{','"com\\u0070lete":false,"complete":{'));r=run(dir);assert.equal(r.status,2);assert.equal(JSON.parse(r.stdout).status,'incomplete');
    fs.writeFileSync(path.join(dir,'evidence.json'),Buffer.from([0x7b,0xff,0x7d]));r=run(dir);assert.equal(r.status,2);assert.equal(JSON.parse(r.stdout).findings[0].ruleId,'input-invalid');
    raw=JSON.stringify({...d,metadata:{padding:'x'.repeat(Math.max(0,LIMITS.bytes-Buffer.byteLength(JSON.stringify({...d,metadata:{padding:''}}))))}});fs.writeFileSync(path.join(dir,'evidence.json'),raw);assert.equal(fs.statSync(path.join(dir,'evidence.json')).size,LIMITS.bytes);r=run(dir);assert.equal(r.status,0);fs.appendFileSync(path.join(dir,'evidence.json'),' ');r=run(dir);assert.equal(r.status,2);assert.equal(JSON.parse(r.stdout).findings[0].ruleId,'byte-limit');
    r=run('/definitely-not-existing-mutation-scope');assert.equal(r.status,2);assert.equal(r.stdout,'');
    const outside=fs.mkdtempSync(path.join(os.tmpdir(),'mutation-outside-'));try{fs.writeFileSync(path.join(outside,'evidence.json'),JSON.stringify(d));fs.symlinkSync(path.join(outside,'evidence.json'),path.join(dir,'link.json'));r=run(dir,'link.json');assert.equal(r.status,2);assert.equal(JSON.parse(r.stdout).status,'incomplete');}finally{fs.rmSync(outside,{recursive:true,force:true});}
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
