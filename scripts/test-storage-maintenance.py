import importlib.util,json,os,tempfile,time,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('maintenance',Path(__file__).with_name('storage-maintenance.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Retention(unittest.TestCase):
 def setUp(self):
  self.t=tempfile.TemporaryDirectory();self.base=Path(self.t.name);self.tmp=self.base/'tmp';self.tmp.mkdir();self.daily=self.base/'cyberblog-cms-prod/app/server/.runtime/github-daily';self.daily.mkdir(parents=True);self.now=time.time();self.today=m.dt.datetime.fromtimestamp(self.now,m.dt.timezone(m.dt.timedelta(hours=8))).date()
 def tearDown(self):self.t.cleanup()
 def folder(self,p,days,marker=False):
  p.mkdir(parents=True);(p/'asset').write_text('test');
  if marker:(p/'.cms-disposable').write_text(m.TOKEN)
  os.utime(p,(self.now-days*m.DAY,)*2);return p
 def test_dry_run_and_protected_state(self):
  old=self.folder(self.daily/str(self.today-m.dt.timedelta(days=40)),40);recent=self.folder(self.daily/str(self.today),0)
  for name in ['state.json','featured-projects.json']:(self.daily/name).write_text('{"runs":[]}')
  fonts=self.folder(self.daily/'fonts',100)
  out=m.maintain(self.base,self.tmp,False,self.now);self.assertTrue(old.exists());self.assertEqual(len(out['actions']),1)
  m.maintain(self.base,self.tmp,True,self.now);self.assertFalse(old.exists());self.assertTrue(recent.exists());self.assertTrue(fonts.exists());self.assertTrue((self.daily/'featured-projects.json').exists())
 def test_active_old_task_is_preserved(self):
  old=self.folder(self.daily/str(self.today-m.dt.timedelta(days=40)),40);(self.daily/'state.json').write_text(json.dumps({'runs':[{'date':old.name,'state':'running'}]}));m.maintain(self.base,self.tmp,True,self.now);self.assertTrue(old.exists())
 def test_backup_floor_and_marker(self):
  root=self.base/'cyberblog-cms-backups';items=[self.folder(root/f'backup-{i}',20+i,True)for i in range(8)];manual=self.folder(root/'manual',100);m.maintain(self.base,self.tmp,True,self.now);self.assertEqual(sum(p.exists()for p in items),5);self.assertTrue(manual.exists())
 def test_only_marked_generated_directories(self):
  clean=self.folder(self.base/'cms-daily-auto-qa',20,True);keep=self.folder(self.base/'cms-daily-publish-check',20);m.maintain(self.base,self.tmp,True,self.now);self.assertFalse(clean.exists());self.assertTrue(keep.exists())
 def test_symlink_never_followed(self):
  target=self.folder(self.base/'private-content',50,True);(self.base/'cms-test').symlink_to(target,target_is_directory=True);m.maintain(self.base,self.tmp,True,self.now);self.assertTrue(target.exists())
 def test_pressure_shortens_cache_retention(self):
  old=self.folder(self.daily/str(self.today-m.dt.timedelta(days=10)),10);report=m.maintain(self.base,self.tmp,True,self.now,free_override=2*1024**3);self.assertTrue(report['pressure']);self.assertFalse(old.exists())
 def test_malformed_state_fails_closed(self):
  old=self.folder(self.daily/str(self.today-m.dt.timedelta(days=50)),50);(self.daily/'state.json').write_text('broken');r=m.maintain(self.base,self.tmp,True,self.now);self.assertTrue(old.exists());self.assertTrue(r['errors'])
if __name__=='__main__':unittest.main()
