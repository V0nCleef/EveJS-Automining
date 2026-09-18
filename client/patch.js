"use strict";
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const MARKER = "# AutoMining client companion.";
const hash = data => crypto.createHash("sha256").update(data).digest("hex");

// Python 2 marshal reader used only to locate the *outer* module fields.
// Nested vendor code is preserved byte-for-byte; nothing is decompiled/recompiled.
function locate(buffer) {
  let pos = 8;
  const i32 = () => { const x = buffer.readInt32LE(pos); pos += 4; return x; };
  function string() { const n = i32(); if (n < 0 || pos + n > buffer.length) throw Error("Invalid marshal string"); pos += n; }
  function object() {
    const t = String.fromCharCode(buffer[pos++]);
    if ("0NFTS.".includes(t)) return;
    if (t === "i" || t === "r" || t === "R") { pos += 4; return; }
    if (t === "I" || t === "g") { pos += 8; return; }
    if (t === "y") { pos += 16; return; }
    if (t === "l") { const n = Math.abs(i32()); pos += 2 * n; return; }
    if (t === "s" || t === "t" || t === "u") { string(); return; }
    if (t === "f") { const n = buffer[pos++]; pos += n; return; }
    if (t === "x") { for (let i=0;i<2;i++) { const n=buffer[pos++]; pos+=n; } return; }
    if (t === "(" || t === "[" || t === "<" || t === ">") { const n = i32(); if(n<0)throw Error("Invalid marshal length"); for(let i=0;i<n;i++)object(); return; }
    if (t === "{") { while(buffer[pos] !== 48) { object(); object(); } pos++; return; }
    if (t === "c") { pos += 16; for(let i=0;i<8;i++)object(); pos += 4; object(); return; }
    throw Error(`Unsupported Python 2 marshal type ${t} at ${pos-1}`);
  }
  if (buffer.readUInt32LE(0) !== 0x0a0df303 || buffer[pos++] !== 99) throw Error("Expected supported Python 2.7 bytecode");
  const stackOffset = pos + 8;
  pos += 16;
  if(buffer[pos++] !== 115)throw Error("Expected module bytecode string");
  const lengthOffset=pos, length=i32(), codeOffset=pos; pos+=length;
  if(buffer[pos++] !== 40)throw Error("Expected module constants tuple");
  const countOffset=pos,count=i32();
  for(let i=0;i<count;i++)object();
  if(pos>buffer.length || count>65534)throw Error("Invalid module constants");
  return {stackOffset,lengthOffset,length,codeOffset,countOffset,count,constEnd:pos};
}
function patchPyj(original, source) {
  if(hash(original)!=="a719bad7223f22f474cdad060610540e81bb55c7141089e0e64e47ee295f32f4") throw Error("Unsupported or modified eveCommands client module");
  const raw=zlib.inflateSync(original);
  if(raw.includes(Buffer.from(MARKER)))throw Error("AutoMining client companion is already installed");
  const loc=locate(raw), code=raw.subarray(loc.codeOffset,loc.codeOffset+loc.length);
  if(code[code.length-4]!==100 || code[code.length-1]!==83)throw Error("Unsupported command module epilogue");
  const noneIndex=code.readUInt16LE(code.length-3);
  const extra=Buffer.from([100,loc.count&255,loc.count>>8,100,noneIndex&255,noneIndex>>8,4,85]);
  const nextCode=Buffer.concat([code.subarray(0,-4),extra,code.subarray(-4)]);
  const literal=Buffer.from(source,"utf8"), constant=Buffer.alloc(5+literal.length);
  constant[0]=115;constant.writeUInt32LE(literal.length,1);literal.copy(constant,5);
  const head=Buffer.from(raw.subarray(0,loc.codeOffset));
  head.writeInt32LE(Math.max(3,raw.readInt32LE(loc.stackOffset)),loc.stackOffset);
  head.writeInt32LE(nextCode.length,loc.lengthOffset);
  const consts=Buffer.from(raw.subarray(loc.codeOffset+loc.length,loc.constEnd));
  consts.writeInt32LE(loc.count+1,1);
  const patched=Buffer.concat([head,nextCode,consts,constant,raw.subarray(loc.constEnd)]);
  locate(patched);
  return zlib.deflateSync(patched);
}
module.exports={patchPyj,locate,hash,MARKER};
