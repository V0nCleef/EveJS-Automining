"use strict";
const {test}=require("node:test"), assert=require("node:assert/strict"), path=require("node:path");
const {createCompression}=require("../lib/compression");
test("compression respects per-item facility access and skips already compressed/empty/unrelated items",()=>{
  const items=[{itemID:1,typeID:10,quantity:4},{itemID:2,typeID:20,quantity:4},{itemID:3,typeID:10,quantity:0},{itemID:4,typeID:30,quantity:4}];
  const calls=[];
  const action=createCompression("/fixture",file=>{
    if(file.endsWith("inSpaceCompressionMgrService.js"))return class {Handle_CompressItemInSpace(args,session){calls.push(args);return [1];}};
    if(file.endsWith("itemStore.js"))return {listContainerItems:(owner,ship)=>{assert.equal(owner,42);assert.equal(ship,100);return items;}};
    return {isCompressibleType:id=>id===10||id===20,isCompressedType:id=>id===20,
      resolveInSpaceCompressionContext:(_,id,item)=>({success:id===102&&item.typeID===10})};
  });
  const scene={dynamicEntities:new Map([[101,{itemID:101,kind:"ship"}],[102,{itemID:102,kind:"ship"}]])};
  assert.match(action(scene,{characterID:42},{itemID:100}),/Compressed 1/);
  assert.deepEqual(calls,[[1,102]]);
  scene.dynamicEntities.delete(102);
  assert.match(action(scene,{characterID:42},{itemID:100}),/waiting/);
  assert.equal(calls.length,1);
});
test("fleet compression targets the selected booster and never substitutes another active facility",()=>{
  const calls=[],contexts=[];
  const compress=createCompression("/fixture",file=>{
    if(file.endsWith("inSpaceCompressionMgrService.js"))return class {Handle_CompressItemInSpace(args){calls.push(args);return [1];}};
    if(file.endsWith("itemStore.js"))return {listContainerItems:()=>[{itemID:1,typeID:10,quantity:20}]};
    return {isCompressibleType:()=>true,isCompressedType:()=>false,resolveInSpaceCompressionContext:(_,id)=>{contexts.push(id);return {success:id===102};}};
  });
  const scene={dynamicEntities:new Map([[101,{kind:"ship",itemID:101}],[102,{kind:"ship",itemID:102}]])};
  assert.match(compress(scene,{characterID:42},{itemID:100},101),/waiting/);assert.deepEqual(contexts,[101]);assert.deepEqual(calls,[]);
  compress(scene,{characterID:42},{itemID:100},102);assert.deepEqual(calls,[[1,102]]);
});
