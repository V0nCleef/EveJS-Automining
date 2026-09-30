"""Check the authored HUD strings and language fallback without a game client."""
import ast
import json
import sys
import subprocess
from pathlib import Path
from types import SimpleNamespace

root = Path(__file__).resolve().parents[1]
scope = {'session': SimpleNamespace(languageID='ZH'), 'unicode': str}
exec((root / 'client/i18n.py').read_text(encoding='utf-8'), scope)
catalog = scope['_AM_ZH']
locales = json.loads((root / 'client/locales.json').read_text(encoding='utf-8'))
patterns = json.loads((root / 'client/statusPatterns.json').read_text(encoding='utf-8'))
assert [p['regex'] for p in patterns['patterns']] == [pattern for pattern, _ in scope['_AM_ZH_PATTERNS']]
scope['_AM_TRANSLATIONS'] = {language: dict(zip(locales['keys'], rows)) for language, rows in locales['translations'].items()}
scope['_AM_PATTERN_TRANSLATIONS'] = {language: list(zip([p['regex'] for p in patterns['patterns']], rows)) for language, rows in patterns['translations'].items()}
assert set(locales['keys']) == set(catalog)
tree = ast.parse((root / 'client/hud.py').read_text(encoding='utf-8'))
widget_names = {'Button', 'Checkbox', 'Combo', 'SingleLineEditText', 'EveLabelMedium', 'EveLabelSmall', 'Section'}
labels = set()
for node in ast.walk(tree):
    if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name) or node.func.id not in widget_names:
        continue
    for keyword in node.keywords:
        value = keyword.value
        if keyword.arg in ('text', 'label', 'hint', 'hintText') and isinstance(value, ast.Constant) and isinstance(value.value, str):
            labels.add(value.value)
        if keyword.arg == 'options' and isinstance(value, (ast.List, ast.Tuple)):
            for pair in value.elts:
                if isinstance(pair, ast.Tuple) and isinstance(pair.elts[0], ast.Constant):
                    labels.add(pair.elts[0].value)
missing = labels - set(catalog) - {'', 'AutoMining'}
assert not missing, 'Untranslated authored HUD labels: ' + repr(sorted(missing))
assert scope['_am_language']() == 'zh'
assert scope['_am_tr']('Mining') == '采矿'
assert scope['_am_status']('Mining with 2 module(s).') == '正在使用 2 个模块采矿。'
assert scope['_am_storage_label']('Container: My Ore (123)') == '货柜： My Ore (123)'
sys.modules['localization'] = SimpleNamespace(GetLanguageID=lambda: 'zh-CN')
scope['session'].languageID = 'EN'
assert scope['_am_language']() == 'zh'
del sys.modules['localization']
scope['session'].languageID = 'FR'
assert scope['_am_language']() == 'fr'
for language in ('de', 'fr', 'es', 'it', 'ru', 'ja', 'ko'):
    scope['session'].languageID = language.upper()
    translated = scope['_AM_TRANSLATIONS'][language]
    assert all(translated.values()), language
    assert scope['_am_tr']('Mining') == translated['Mining'], language
    assert scope['_am_tr']('AutoMining') == scope['_AM_NAMES'][language], language
    expected = patterns['translations'][language][0] % '95'
    expected = expected.replace('AutoMining', scope['_AM_NAMES'][language])
    assert scope['_am_status']('Armed - waiting for ore hold to reach 95%.') == expected, language
scope['session'].languageID = 'EN'
assert scope['_am_language']() == 'en'
assert scope['_am_tr']('Mining') == 'Mining'
for language in ('de','fr','es','it','ru','zh','ja','ko'):
    scope['session'].languageID=language.upper()
    source='AutoMining stopped for %d fleet pilot(s). Recall ordered: %d. Recall failures: %d.'
    assert scope['_am_tr'](source,2,5,1)!=source % (2,5,1),language
    assert scope['_am_status']('Activation interval must be between 90 and 86400 seconds.')!='Activation interval must be between 90 and 86400 seconds.',language
    assert scope['_am_status']('Only the current fleet boss can stop fleet AutoMining.')!='Only the current fleet boss can stop fleet AutoMining.',language
print('PASS: all authored HUD translations, dynamic statuses and per-client language selection.')

# Authored Jobs, PVE and fleet statuses must exist in every catalogue.
import re
for filename in ('lib/pve.js','lib/pveDeployment.js','lib/pveAmmo.js','lib/fleetGroups.js','lib/fleetOre.js','client/pve.py'):
    source=(root/filename).read_text(encoding='utf8')
    fixed=set(re.findall(r'[\"\']([A-Z][^\"\'\n]{5,}[.!?:])[\"\']',source))
    assert not fixed-set(catalog), (filename,sorted(fixed-set(catalog)))
for language in ('de','fr','es','it','ru','zh','ja','ko'):
    scope['session'].languageID=language.upper()
    for source in ('Jobs','Hauling','Hostile priority','Select a fleet preset','PVE job interrupted.','Invalid job settings.'):
        assert scope['_am_tr'](source)!=source,(language,source)
    assert scope['_am_status']('Fleet coordination paused: Invalid fleet preset.')!='Fleet coordination paused: Invalid fleet preset.',language
    value=scope['_am_tr']('Automatic range: %.0f m | Current orbit: %.0f m | Weapons: %d',12000,8500,3)
    assert '12000' in value and '8500' in value and '3' in value,language
print('PASS: Jobs/PVE/fleet fixed messages, native hints/sections and parameter templates in all nine languages.')
for language in ('de','fr','es','it','ru','zh','ja','ko'):
    scope['session'].languageID=language.upper()
    for source in ('Receive fleet ore','Waiting for fleet compression.','Nearby fleet miners transfer accepted ore into your fleet hangar. Compressed-only reception waits for compression.'):
        assert scope['_am_tr'](source)!=source,(language,source)
    assert scope['_am_status']('Waiting for fleet compression.')!='Waiting for fleet compression.',language
print('PASS: fleet hangar collection label, full compression explanation and wait status in all nine languages.')
for language in ('de','fr','es','it','ru','zh','ja','ko'):
    scope['session'].languageID=language.upper()
    for source in ('Collected m3','Delivered m3','Completed pickups','Transport deliveries','Rats destroyed','Damage dealt','Rat destroyed.'):
        assert scope['_am_tr'](source)!=source,(language,source)
    result=scope['_am_tr']('PVE rats destroyed: %d | Damage dealt: %.1f',4,1234.5)
    assert '4' in result and '1234.5' in result,language
    source='Fleet ore reception paused: Native fleet ore transfer could not be confirmed.'
    assert scope['_am_status'](source)!=source,language
print('PASS: PVE/hauling statistics and collector statuses/templates in all nine languages.')
source='Live combat statistics are unavailable; restart the server.'
for language in ('en','de','fr','es','it','ru','zh','ja','ko'):
    scope['session'].languageID=language.upper()
    translated=scope['_am_tr'](source)
    assert translated and (translated==source if language=='en' else translated!=source),(language,translated)
    assert scope['_am_status'](source)==translated,language
print('PASS: optional combat capture failure notice is complete in all nine languages.')

# Exercise the actual emitted dictionaries, including Chinese after deduplication.
emitted = subprocess.check_output(['node', '-e', "process.stdout.write(require('./lib/clientSource').buildClientSource(process.cwd()))"], cwd=root).decode('utf8')
compile(emitted, '<emitted-AutoMining-companion>', 'exec')
start = emitted.index('import re as _am_re')
last = emitted.index('_AM_PATTERN_TRANSLATIONS = dict((language, list(zip(')
end = emitted.index('\n', last)
bundle_scope = {'session': SimpleNamespace(languageID='EN'), 'unicode': str}
exec(compile(emitted[start:end], '<emitted-localization>', 'exec'), bundle_scope)
for language in ('en','de','fr','es','it','ru','zh','ja','ko'):
    bundle_scope['session'].languageID = language.upper()
    rows = catalog if language == 'zh' else scope['_AM_TRANSLATIONS'].get(language, {})
    for source in locales['keys']:
        expected = source if language == 'en' else rows[source].replace('AutoMining', scope['_AM_NAMES'][language])
        assert bundle_scope['_am_tr'](source) == expected, (language, source)
    if language != 'en':
        assert bundle_scope['_am_status']('Live combat statistics are unavailable; restart the server.') != 'Live combat statistics are unavailable; restart the server.', language
        assert bundle_scope['_am_status']('Mining with 2 module(s).') != 'Mining with 2 module(s).', language
    else:
        assert bundle_scope['_am_status']('Mining with 2 module(s).') == 'Mining with 2 module(s).'
print('PASS: actual emitted bundle preserves every translated label, nine language fallbacks and dynamic statuses after catalogue deduplication.')

# Prove each full-line comment candidate is a real Python comment, not a string.
import io
import tokenize
for filename in ('companion.py','i18n.py','hud.py','hauling.py','transport.py','pve.py','drones.py','fleet.py','activity.py'):
    authored=(root/'client'/filename).read_text(encoding='utf8')
    tokens=list(tokenize.generate_tokens(io.StringIO(authored).readline))
    multiline=[token for token in tokens if token.type==tokenize.STRING and token.start[0]!=token.end[0]]
    skipped="'''" in authored or '"""' in authored or re.search(r'\\\r?\n',authored)
    assert not multiline or skipped,filename
    if skipped:continue
    comment_lines={token.start[0] for token in tokens if token.type==tokenize.COMMENT}
    candidates={index for index,line in enumerate(authored.splitlines(True),1) if re.match(r'^[ \t]*#[^\r\n]*\r?\n$',line)}
    assert candidates<=comment_lines,filename
assert emitted.startswith('# coding: utf-8\n')
print('PASS: emitted comment omission retains the UTF-8 header, skips multiline/continued strings and removes only verified Python comment lines.')
for language in ('de','fr','es','it','ru','zh','ja','ko'):
    bundle_scope['session'].languageID=language.upper()
    for source in ('Enable shared hauling','Fleet coordination is managed by the hauling job.','Select Fleet pickup and apply settings before requesting pickup.','(left fleet)','Fleet totals include earlier contributors not shown.'):
        assert bundle_scope['_am_tr'](source)!=source,(language,source)
    assert '7' in bundle_scope['_am_tr']('Fleet: %s | Reserved bin: %s','Ore Team','7')
    assert '2' in bundle_scope['_am_tr']('Shared pool: %d hauler(s), %d available, %d request(s)',2,1,3)
print('PASS: shared hauling, applied-pickup guidance, reservation templates and earlier fleet contributor labels in all nine languages.')
for language in ('de','fr','es','it','ru','zh','ja','ko'):
    bundle_scope['session'].languageID=language.upper()
    for source in ("Put into booster's fleet hangar",'Requires Receive fleet ore, the same fleet, hangar access and 2500 m range. The booster chooses which ore to accept.',
                   'Fleet ore delivery needs an enabled receiver in this fleet.','Fleet ore delivery needs a nearby stationary booster within 2500 m.',
                   'Fleet ore delivery needs fleet hangar access.','Waiting for ore to deliver to the fleet hangar.',
                   'Ore ready for delivery to the fleet hangar.',"Ore delivered to the booster's fleet hangar."):
        assert bundle_scope['_am_tr'](source)!=source,(language,source)
    translated=bundle_scope['_am_status']('Fleet ore delivery paused: Fleet ore storage is full.')
    assert 'Fleet ore delivery paused:' not in translated and 'Fleet ore storage is full.' not in translated,language
print('PASS: explicit fleet-hangar mode/helper, receiver/range/access/compression statuses and nested failure translation in all nine languages.')

for language in ('de','fr','es','it','ru','zh','ja','ko'):
    bundle_scope['session'].languageID=language.upper()
    for source in ('Accept compressed ore','Accept uncompressed ore','Fleet ore admission is off.',
                   'Booster accepts compressed ore only; raw ore stays aboard.',
                   'Booster accepts uncompressed ore only; compressed ore stays aboard.'):
        assert bundle_scope['_am_tr'](source)!=source,(language,source)
print('PASS: independent booster ore admission labels and off/compressed-only/raw-only statuses are complete in all nine actual emitted languages.')

# Deployed PVE text uses complete runtime translations, including native ammo results.
deployment_sources = ['Belt patrol','Fleet escort','Reinforcement standby','Home station','Maximum route jumps',
    'Call reinforcements','Request reinforcements when attacked','Responder limit','Assignment','Joinable','Unavailable',
    'Joining the defense fleet.','Travelling to the defense fleet.','Warping to the defense fleet.',
    'Returning to the standby station.','PVE standby is ready.','Waiting for the selected public fleet anchor.',
    'Reinforcements requested.','Automatic reinforcements requested.','Reinforcements completed.','No reinforcement request.',
    'Choose a standby station before starting PVE.','Choose an active public fleet and anchor for escort.',
    'Reinforcements need an enabled fleet pilot in public space.','Reinforcement queue is full.',
    'Defense fleet join is unavailable.','Defense fleet join timed out.','PVE deployment is no longer available.',
    'PVE deployment no longer belongs to this pilot.','PVE standby destination is unavailable.',
    'PVE docked outside its assigned destination.','PVE route changed manually.','PVE route made no progress.',
    'PVE deployment interrupted; use Start / Resume to retry.','Unknown PVE deployment action.',
    'Selected route is outside the reinforcement range.','Selected route is unavailable.','No route with your route settings.',
    'Fleet coordination is managed by the PVE deployment.','Automatic reinforcement calls are unavailable.',
    'Ammo','Ammo source','Restock ammo when docked','PVE ammunition is ready.','PVE ammunition needs compatible charges.',
    'Reloading PVE ammunition.','PVE ammunition restock is incomplete.','PVE ammunition source is unavailable.',
    'PVE ammunition transfer could not be confirmed.','Invalid PVE ammunition targets.',
    'PVE ammunition source is short of stock.','PVE ammunition cargo capacity reached.']
for language in ('de','fr','es','it','ru','zh','ja','ko'):
    bundle_scope['session'].languageID=language.upper()
    for source in deployment_sources:
        translated = bundle_scope['_am_status'](source) if source.endswith('.') else bundle_scope['_am_tr'](source)
        assert translated!=source,(language,source)
    assert '51' in bundle_scope['_am_tr']('Out of range: %d jumps (limit %d).',51,50)
    assert '50' in bundle_scope['_am_tr']('Out of range: %d jumps (limit %d).',51,50)
    value=bundle_scope['_am_tr']('Loaded: %d | Cargo: %d',30,7)
    assert '30' in value and '7' in value
print('PASS: PVE deployment/escort/standby, native ammo status errors, queue/range/count templates and current-fleet request text resolve in all nine actual emitted languages.')

# Requested orbit range is a setting, not live movement telemetry.
for language in ('de','fr','es','it','ru','zh','ja','ko'):
    bundle_scope['session'].languageID=language.upper()
    for source in ('Escort orbits the selected pilot while idle, switches to a rat in combat, then returns to the pilot.',
                   'Automatic range follows your highest-DPS weapon, ammunition and skills.', 'Escorting the selected pilot.'):
        assert bundle_scope['_am_status'](source)!=source,(language,source)
    value=bundle_scope['_am_tr']('Automatic range: %.0f m | Orbit setting: %.0f m | Weapons: %d',12000,8500,3)
    assert all(number in value for number in ('12000','8500','3'))
print('PASS: escort idle/combat return explanation, highest-DPS range, requested orbit setting and idle status are complete in all nine emitted languages.')
