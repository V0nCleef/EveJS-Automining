"""Every authored Fleet Command label and server error has nine-language coverage."""
import ast,json,re,subprocess,zlib,base64
from pathlib import Path
root=Path(__file__).resolve().parents[1]
main=json.loads((root/'client/locales.json').read_text(encoding='utf-8'))
locales=json.loads((root/'client/fleetCommand.locales.json').read_text(encoding='utf-8'))
keys=set()
for node in ast.walk(ast.parse((root/'client/fleetCommand.py').read_text(encoding='utf-8'))):
    if not isinstance(node,ast.Call) or not isinstance(node.func,ast.Name):continue
    position={'tr':0,'label':1,'button':1,'section':1}.get(node.func.id)
    if position is not None and len(node.args)>position:
        value=node.args[position]
        if isinstance(value,ast.Constant) and isinstance(value.value,str) and value.value:keys.add(value.value)
keys.update(['Mining','Hauling','Boosting','PVE','Offline','ON','OFF',
    'Fleet filter','Personal filter','All compatible resources',
    'applied','restored','started','refused','stopped','recalled','recallFailed',
    'offline','notMember','notMiner','failed','filter','restore','start','stop','recall','mining','restoreMining','miningApplied',
    'Lock targets automatically','Approach out-of-range ore','Target priority','Automatic survey','Automatic compression',
    'Survey seconds','Nearest first','Furthest first','Largest volume first','Smallest volume first'])
keys.update(re.findall(r'throw Error\("([^"]+)"\)',(root/'lib/fleetCommand.js').read_text()))
missing=keys-set(locales['en'])-set(main['keys'])
assert not missing,sorted(missing)
for language in ['en','de','fr','es','it','ru','zh','ja','ko']:
    assert set(locales[language])==set(locales['en']),language
    assert all(isinstance(value,str) and value.strip() for value in locales[language].values()),language
    if language!='en':
        fallback=dict(zip(main['keys'],main['translations'][language]))
        assert all(locales[language].get(key,fallback.get(key)) for key in keys),(language,sorted(keys))
# Check the actual on-demand bytes, not only the authored catalogue.
encoded=subprocess.check_output(['node','-e',"process.stdout.write(require('./lib/fleetCommandSource').source().source)"],cwd=root)
tree=ast.parse(zlib.decompress(base64.b64decode(encoded)).decode('utf-8'))
assignment=tree.body[0]
emitted=json.loads(ast.literal_eval(assignment.value.args[0]))
assert emitted==locales
print('PASS: every Fleet Command authored label, button, hint, roster state, order result and server error is covered in all nine delivered languages.')
