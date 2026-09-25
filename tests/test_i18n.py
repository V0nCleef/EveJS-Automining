"""Check the authored HUD strings and language fallback without a game client."""
import ast
import json
import sys
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
widget_names = {'Button', 'Checkbox', 'Combo', 'SingleLineEditText', 'EveLabelMedium', 'EveLabelSmall'}
labels = set()
for node in ast.walk(tree):
    if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name) or node.func.id not in widget_names:
        continue
    for keyword in node.keywords:
        value = keyword.value
        if keyword.arg in ('text', 'label', 'hint') and isinstance(value, ast.Constant) and isinstance(value.value, str):
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
assert scope['_am_storage_label']('Container: My Ore (123)') == '货柜：My Ore (123)'
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
print('PASS: all authored HUD translations, dynamic statuses and per-client language selection.')
