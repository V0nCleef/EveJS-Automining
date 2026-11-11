"""Parse generated delivery with the Python 2.7 grammar; not a runtime/client test."""
import base64
import json
import re
import sys
import zlib
from lib2to3 import pygram, pytree
from lib2to3.pgen2 import driver

parser = driver.Driver(pygram.python_grammar, convert=pytree.convert)

def check(source):
    parser.parse_string(source.rstrip() + '\n')

expression = sys.stdin.read()
check(expression)
encoded = re.search(r'b64decode\("([A-Za-z0-9+/=]+)"\)', expression).group(1)
bootstrap = base64.b64decode(encoded).decode('utf-8')
check(bootstrap)
payload = re.search(r"json.loads\(base64.b64decode\('([A-Za-z0-9+/=]+)'\)\)", bootstrap).group(1)
providers = json.loads(base64.b64decode(payload))
checks = 2
for provider in providers:
    source = zlib.decompress(base64.b64decode(provider['source'])).decode('utf-8')
    check(source)
    checks += 1
    if provider['id'] == 'automining':
        outer64 = re.search(r"b64decode\('([A-Za-z0-9+/=]+)'\)", source).group(1)
        outer = zlib.decompress(base64.b64decode(outer64)).decode('utf-8')
        check(outer)
        companion64 = json.loads(re.search(r'^_am_source64 = (.+)$', outer, re.M).group(1))
        check(zlib.decompress(base64.b64decode(companion64)).decode('utf-8'))
        checks += 2
print('PASS: %d Python 2.7 grammar checks; no Python 2.7 runtime or retail client executed.' % checks)
