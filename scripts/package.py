"""Build an upload candidate from an explicit runtime allowlist (never from the workspace)."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parent.parent
plugin = root / 'plugins' / 'codex-jev-compaction'
manifest = json.loads((plugin / '.codex-plugin/plugin.json').read_text())
files = []
for name in ['.codex-plugin', 'assets', 'hooks', 'scripts', 'skills', 'src', 'examples']:
    files.extend(p for p in (plugin / name).rglob('*') if p.is_file())
files.extend(plugin / name for name in ['package.json', 'README.md', 'LICENSE', 'PRIVACY.md', 'TERMS.md', '.env.example'])
assert all(not p.is_symlink() and p.name != '.env' and p.stat().st_size < 1024 * 1024 for p in files)
output = root / 'artifacts' / f"codex-jev-compaction-{manifest['version']}.zip"
output.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for p in sorted(files):
        archive.write(p, Path(manifest['name']) / p.relative_to(plugin))
print(json.dumps({'archive': str(output), 'files': len(files), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'submitted': False}, indent=2))
