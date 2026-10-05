import test from 'node:test';
import assert from 'node:assert/strict';
import '../static/capsule.js';
const {svg}=globalThis.GemCapsule;
test('capsule escapes untrusted text and excludes secrets and active content',()=>{
 const result=svg({name:'<script>alert(1)</script>',source:'import',status:'held',signals:{mentions:5,authors:4},url:'https://user:password@example.com/project?token=secret#private',votes:[{seat:'skeptic',vote:'hold',reason:'<image onload="x"/>'}],evidence:{pages:[]},api_key:'do-not-export'});
 assert.ok(result.includes('&lt;script&gt;'));
 for(const forbidden of ['<script','<image','onload="','password','token=secret','do-not-export','private','href='])assert.ok(!result.includes(forbidden),forbidden);
 assert.ok(result.includes('example.com/project'));
});
test('demo cannot be presented as a real shortlist and Grok absence stays explicit',()=>{
 const result=svg({source:'demo',status:'shortlisted',votes:[]});
 assert.ok(result.includes('DEMO · ВЫМЫШЛЕННЫЙ ПРИМЕР'));
 assert.ok(!result.includes('SHORTLIST'));
 assert.ok(result.includes('Grok: оценка отсутствует'));
 assert.ok(result.includes('Источники не приложены'));
});
test('synthetic evidence, rejected status, time and missing metrics remain faithful',()=>{
 assert.ok(svg({evidence:{synthetic:true}}).includes('DEMO'));
 const result=svg({status:'rejected',signals:{mentions:NaN},votes:[{seat:'runner',vote:'reject'}]},'daylight',new Date('2026-01-01T12:00:00Z'));
 assert.ok(result.includes('REJECTED'));
 assert.ok(result.includes('2026-01-01 12:00:00 UTC'));
 assert.ok(result.includes('0 / 1'));
 assert.ok(!result.includes('NaN'));
});
