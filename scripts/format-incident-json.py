"""Rewrites incident.json files in the repository's compact style: small flat objects on one line."""
import json
import sys


def dump(value, indent=0):
    pad = '  ' * indent
    if isinstance(value, dict):
        flat = all(not isinstance(v, (dict, list)) for v in value.values())
        one_line = '{ ' + ', '.join(f'{json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}' for k, v in value.items()) + ' }'
        if flat and len(one_line) + len(pad) <= 120:
            return one_line
        items = [f'{pad}  {json.dumps(k)}: {dump(v, indent + 1)}' for k, v in value.items()]
        return '{\n' + ',\n'.join(items) + f'\n{pad}}}'
    if isinstance(value, list):
        if not value:
            return '[]'
        if all(isinstance(v, str) for v in value) and sum(len(v) + 4 for v in value) + len(pad) <= 120:
            return '[' + ', '.join(json.dumps(v, ensure_ascii=False) for v in value) + ']'
        items = [f'{pad}  {dump(v, indent + 1)}' for v in value]
        return '[\n' + ',\n'.join(items) + f'\n{pad}]'
    return json.dumps(value, ensure_ascii=False)


for path in sys.argv[1:]:
    with open(path) as f:
        data = json.load(f)
    with open(path, 'w') as f:
        f.write(dump(data) + '\n')
