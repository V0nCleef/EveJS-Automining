"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { emittedBootstrap } = require("../lib/clientSource");
const fs=require("node:fs"),path=require("node:path"),{spawnSync}=require("node:child_process");

test("emitted bootstrap keeps quoted values and inline comments while compacting canonical indentation", () => {
  const source = "# comment\nif ready:\n    value = '    # keep' # inline\n\n    if value:\n        act(value)\n";
  assert.equal(emittedBootstrap(source), "if ready:\n value = '    # keep' # inline\n\n if value:\n  act(value)\n");
});

test("unfamiliar indentation and multiline or continued strings cannot be compacted", () => {
  for (const source of ["if ready:\n\tact()\n", "value = '''\n    # string\n'''\n", "value = 'one\\\n    two'\n"])
    assert.equal(emittedBootstrap(source), source);
  assert.equal(emittedBootstrap("# comment\nif ready:\n  act()\n"), "if ready:\n  act()\n");
  assert.equal(emittedBootstrap("if ready:\n    values = {'one': True,\n              'two': False}\n"), "if ready:\n values = {'one': True,\n              'two': False}\n");
});

test("actual authored login bootstrap retains its AST and code/string tokens after emission",()=>{
  const source=fs.readFileSync(path.join(__dirname,"../client/login.py"),"utf8"),emitted=emittedBootstrap(source);
  const script="import ast,io,json,sys,tokenize\na,b=json.load(sys.stdin)\nassert ast.dump(ast.parse(a),include_attributes=False)==ast.dump(ast.parse(b),include_attributes=False)\ndef code(s):\n return [(t.type,'INDENT' if t.type==tokenize.INDENT else t.string) for t in tokenize.generate_tokens(io.StringIO(s).readline) if t.type not in (tokenize.COMMENT,tokenize.NL)]\nassert code(a)==code(b)\n";
  const result=spawnSync(process.env.EVEJS_PYTHON||"python",["-B","-c",script],{input:JSON.stringify([source,emitted]),encoding:"utf8"});
  assert.equal(result.status,0,result.stderr||result.error?.message);
});
