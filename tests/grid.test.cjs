'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {publicGrid}=require('../lib/grid');

test('native bubble identity takes precedence over box keys and obsolete cluster methods',()=>{
  const ball={publicGridKey:'cached-box'};
  const scene={getGridBubbleIDForEntity:()=>7,getPublicGridClusterKeyForEntity(){throw Error('obsolete');}};
  assert.equal(publicGrid(scene,ball),7);
  scene.getGridBubbleIDForEntity=()=>null;
  assert.equal(publicGrid(scene,ball),null,'No geometry or stale-key fallback for a removed Ball');
});

test('legacy scene live cluster authority and empty context remain supported',()=>{
  const ball={};
  assert.equal(publicGrid({getLivePublicGridClusterKeyForEntity:()=> 'live',getPublicGridClusterKeyForEntity:()=> 'stale'},ball),'live');
  assert.equal(publicGrid({getPublicGridClusterKeyForEntity:()=> 'legacy'},ball),'legacy');
  assert.equal(publicGrid(null,ball),null);assert.equal(publicGrid({},null),null);
});
