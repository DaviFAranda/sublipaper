"""Verificação estática sem importar o aplicativo ou acessar seus bancos."""
import ast, json, subprocess, sys
from pathlib import Path
root=Path(sys.argv[1]).resolve()
files=subprocess.check_output(['git','-C',str(root),'ls-files','--cached','--others','--exclude-standard','-z']).decode().split('\0')
checked=0
for name in set(files):
 p=root/name
 if not name or not p.is_file():continue
 if p.suffix=='.py':ast.parse(p.read_text(encoding='utf-8-sig'),filename=name);checked+=1
 elif p.suffix in ('.mjs','.js'):subprocess.run(['node','--check',str(p)],check=True,capture_output=True);checked+=1
 elif p.suffix=='.json':json.loads(p.read_text(encoding='utf-8-sig'));checked+=1
print(f'OK: {checked} arquivos Python, JavaScript e JSON verificados sem acessar dados.')
