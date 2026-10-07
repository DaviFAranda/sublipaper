"""Snapshot consistente dos bancos locais para atualização da instalação."""
import json, sqlite3, shutil, sys
from pathlib import Path
root=Path(sys.argv[1]).resolve();target=Path(sys.argv[2]).resolve()
target.mkdir(parents=True,exist_ok=False)
files=[]
for folder in (root/'dados',root/'Pedidos/dados'):
 if folder.exists():
  for source in folder.rglob('*'):
   if not source.is_file() or source.suffix.lower() not in ('.sqlite3','.sqlite','.db'):continue
   relative=source.relative_to(root);out=target/relative;out.parent.mkdir(parents=True,exist_ok=True)
   with sqlite3.connect(source.as_uri()+'?mode=ro',uri=True) as db,sqlite3.connect(out) as dest:
    assert db.execute('PRAGMA quick_check').fetchone()[0]=='ok',relative
    db.backup(dest)
   files.append(str(relative))
for relative in ('config.json','Pedidos/config.json'):
 source=root/relative
 if source.exists():out=target/relative;out.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,out)
(target/'bancos.json').write_text(json.dumps(files,ensure_ascii=False,indent=2),encoding='utf-8')
print(f'Backup concluído: {len(files)} bancos. {target}')
