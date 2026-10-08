"""Windows integration test. Every server and database is isolated in a temporary checkout."""
import json, os, shutil, sqlite3, subprocess, sys, tempfile, unittest, urllib.request, socket
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def git(p,*args):return subprocess.check_output(['git','-C',str(p),*args],stderr=subprocess.STDOUT).decode().strip()
class UpdateTests(unittest.TestCase):
 def test_update_preserves_data_and_recovers(self):
  self.temp=tempfile.TemporaryDirectory(prefix='sublipaper-update-');qa=Path(self.temp.name).resolve();source=qa/'source';source.mkdir()
  files=git(ROOT,'ls-files','--cached','--others','--exclude-standard','-z').split('\0')
  for name in set(files):
   if name and (ROOT/name).is_file():p=source/name;p.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/name,p)
  git(source,'init','-b','main');git(source,'config','user.name','QA');git(source,'config','user.email','qa@example.invalid');git(source,'add','.');git(source,'commit','-m','QA baseline')
  subprocess.run(['git','clone','--bare',str(source),str(qa/'remote.git')],check=True,capture_output=True);git(source,'remote','add','origin',str(qa/'remote.git'))
  subprocess.run(['git','clone',str(qa/'remote.git'),str(qa/'installed')],check=True,capture_output=True);installed=qa/'installed';self.installed=installed
  with socket.socket() as probe:probe.bind(('127.0.0.1',0));port=probe.getsockname()[1]
  self.port=port
  (installed/'config.json').write_text(json.dumps({'port':port,'python':sys.executable}));art=qa/'artes';art.mkdir();(installed/'Pedidos/config.json').write_text(json.dumps({'art_root':str(art)}))
  (installed/'dados').mkdir()
  with sqlite3.connect(installed/'dados/preservar.sqlite3') as db:db.execute('CREATE TABLE sample(value TEXT)');db.execute("INSERT INTO sample VALUES('preservado')")
  p=source/'README.md';p.write_text(p.read_text(encoding='utf-8')+'\nQA updated.\n',encoding='utf-8');git(source,'add','README.md');git(source,'commit','-m','QA update');git(source,'push','origin','main')
  def run():
   logfile=qa/'update-output.txt'
   with logfile.open('wb') as log:result=subprocess.run(['powershell','-NoProfile','-ExecutionPolicy','Bypass','-File',str(installed/'atualizar.ps1'),'-NoBrowser'],stdout=log,stderr=subprocess.STDOUT,timeout=120)
   result.stdout=logfile.read_text(encoding='utf-8',errors='replace');result.stderr='';return result
  result=run();self.assertEqual(result.returncode,0,result.stdout+result.stderr);self.assertIn('QA updated.',(installed/'README.md').read_text(encoding='utf-8'))
  backup=next((qa/'Backups_Sublipaper').glob('atualizacao-*'))
  for p in (installed/'dados/preservar.sqlite3',backup/'dados/preservar.sqlite3'):
   with sqlite3.connect(p) as db:self.assertEqual(db.execute('SELECT value FROM sample').fetchone()[0],'preservado')
  with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health') as response:self.assertTrue(os.path.samefile(json.load(response)['root'],installed))
  self.assertEqual(run().returncode,0)
  p=installed/'README.md';original=p.read_bytes();p.write_bytes(original+b'\nLocal change\n');head=git(installed,'rev-parse','HEAD');self.assertNotEqual(run().returncode,0);self.assertEqual(git(installed,'rev-parse','HEAD'),head);self.assertTrue(p.read_bytes().endswith(b'Local change\n'));p.write_bytes(original)
  p=source/'public/factory.mjs';valid_js=p.read_text(encoding='utf-8');p.write_text(valid_js+'\nconst = ;\n',encoding='utf-8');git(source,'add','public/factory.mjs');git(source,'commit','-m','QA invalid update');git(source,'push','origin','main')
  result=run();self.assertNotEqual(result.returncode,0,result.stdout+result.stderr);self.assertEqual(git(installed,'rev-parse','HEAD'),head)
  with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health') as response:self.assertTrue(json.load(response)['ok'])
  p.write_text(valid_js,encoding='utf-8');server=source/'server.mjs';server.write_text(server.read_text(encoding='utf-8').replace('const ROOT=',"throw new Error('QA startup failure');\nconst ROOT=",1),encoding='utf-8')
  git(source,'add','public/factory.mjs','server.mjs');git(source,'commit','-m','QA startup failure');git(source,'push','origin','main')
  result=run();self.assertNotEqual(result.returncode,0,result.stdout+result.stderr);self.assertEqual(git(installed,'rev-parse','HEAD'),head)
  with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health') as response:self.assertTrue(json.load(response)['ok'])
 def tearDown(self):
  if hasattr(self,'installed'):
   # Stop only the server whose health reports this disposable checkout.
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{self.port}/api/health') as response:assert os.path.samefile(json.load(response)['root'],self.installed)
    command="$script:systemRoot=$env:QA_CHECKOUT; . (Join-Path $systemRoot 'ferramentas/deploy.ps1'); Stop-OwnedSystem (Get-OwnedSystemProcess)"
    subprocess.run(['powershell','-NoProfile','-Command',command],env={**os.environ,'QA_CHECKOUT':str(self.installed)},check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=30)
   except Exception as exc:print('QA cleanup:',exc)
  if hasattr(self,'temp'):
   try:
    target=Path(self.temp.name).resolve()
    assert target.parent==Path(tempfile.gettempdir()).resolve() and target.name.startswith('sublipaper-update-')
    self.temp.cleanup()
   except OSError:pass
if __name__=='__main__':unittest.main(verbosity=2)
