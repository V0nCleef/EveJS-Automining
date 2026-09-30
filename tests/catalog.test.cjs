"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createCatalog } = require("../lib/catalog");

test("ore picker excludes all compressed products, including batch records missing native mappings", () => {
  const rows = [
    {typeID:1,name:"Veldspar",volume:0.1}, {typeID:2,name:"Dense Veldspar",volume:0.1},
    {typeID:3,name:"Compressed Veldspar"}, {typeID:4,name:"Batch Compressed Arkonor III-Grade"},
    {typeID:5,name:"Batch Compressed Bistot"}, {typeID:6,name:"Ancient Compressed Blue Ice"},
    {typeID:7,name:"batch COMPRESSED Scordite"}, {typeID:8,name:"Unlabelled inventory product"},
    {typeID:9,name:"Gas inventory product",groupID:4168}, {typeID:10,name:"Scordite",published:false},
    {typeID:11,name:"Blue Ice",kind:"ice",volume:1000}, {typeID:12,name:"Fullerite-C50",kind:"gas",volume:null},
  ];
  let reads=0;
  const dependencies = {
    "referenceData.js": {TABLE:{ITEM_TYPES:"itemTypes"},readStaticRows:()=>{reads++;return rows;}},
    "miningInventory.js": {classifyMiningMaterialType:type=>({kind:type.kind||"ore"})},
    "miningStaticData.js": {isCompressedType:id=>id===8},
  };
  const catalog=createCatalog("fixture",file=>dependencies[path.basename(file)]);
  assert.deepEqual(catalog().map(row=>row.name),["Blue Ice","Dense Veldspar","Fullerite-C50","Veldspar"]);
  assert.deepEqual(catalog().map(({typeID,volume})=>({typeID,volume})),[
    {typeID:11,volume:1000},{typeID:2,volume:0.1},{typeID:12,volume:null},{typeID:1,volume:0.1}]);
  assert.equal(catalog(),catalog());assert.equal(reads,1);
});
