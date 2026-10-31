#!/usr/bin/env python3
"""Bounded retention for generated CyberBlog files; dry-run unless --apply."""
import argparse, datetime as dt, fcntl, json, os, re, shutil, stat, time
from pathlib import Path
TOKEN='cyber-cms-generated-v1'
DAY=86400

def size(p):
    if p.is_symlink(): return 0
    if p.is_file(): return p.stat().st_size
    return sum(f.stat().st_size for root,dirs,files in os.walk(p,followlinks=False) for name in files if not (f:=Path(root,name)).is_symlink())

def occupied(p):
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit(): continue
        try:
            cwd=(entry/'cwd').resolve()
            if cwd==p or p in cwd.parents:return True
        except (OSError,RuntimeError):pass
    return False

def maintain(base,tmp,apply=False,now=None,free_override=None):
    now=time.time() if now is None else now
    base=base.resolve();tmp=tmp.resolve()
    runtime=base/'cyberblog-cms-prod/app/server/.runtime'
    daily=runtime/'github-daily';backups=base/'cyberblog-cms-backups';dev=base/'cyberblog-cms-work'
    disk=shutil.disk_usage(base);free=disk.free if free_override is None else free_override
    pressure=free<4*1024**3 or disk.used/disk.total>=0.8
    actions=[];errors=[]
    today=dt.datetime.fromtimestamp(now,dt.timezone(dt.timedelta(hours=8))).date()
    active={str(today),str(today-dt.timedelta(days=1))}
    try:
        state=json.loads((daily/'state.json').read_text())
        active.update(r['date'] for r in state.get('runs',[]) if r.get('state')=='running')
    except FileNotFoundError:pass
    except (ValueError,KeyError) as e: errors.append('Cannot read active task state; daily cache cleanup skipped');active=None
    def remove(p,reason,allow_git=False):
        if p.is_symlink() or not p.exists():return
        resolved=p.resolve()
        allowed=(resolved.parent==daily or resolved.parent==backups or resolved.parent==dev or resolved.parent==base or resolved.parent==tmp)
        if not allowed or resolved in [base,dev,runtime,daily,backups,tmp]:raise ValueError('Unsafe cleanup target')
        if occupied(resolved):return
        if not allow_git and (resolved/'.git').exists():return
        amount=size(resolved)
        if apply:
            if resolved.is_dir():shutil.rmtree(resolved)
            else:resolved.unlink()
        actions.append({'path':str(resolved),'reason':reason,'bytes':amount})
    if daily.is_dir() and active is not None:
        caches=[]
        for p in daily.iterdir():
            if not p.is_dir() or p.is_symlink() or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',p.name) or p.name in active:continue
            try:age=(today-dt.date.fromisoformat(p.name)).days
            except ValueError:continue
            if age>(7 if pressure else 30):remove(p,'expired research cache')
            else:caches.append(p)
        budget=256*1024**2 if pressure else 512*1024**2
        total=sum(size(p) for p in caches)
        for p in sorted(caches,key=lambda p:p.name):
            if total<=budget:break
            amount=size(p);remove(p,'research cache size budget');total-=amount
    if backups.is_dir():
        managed=[p for p in backups.iterdir() if p.is_dir() and not p.is_symlink() and (p/'.cms-disposable').is_file() and (p/'.cms-disposable').read_text().strip()==TOKEN]
        managed.sort(key=lambda p:p.stat().st_mtime,reverse=True)
        keep=3 if pressure else 5;total=sum(size(p) for p in managed)
        for p in managed[keep:]:
            amount=size(p)
            if now-p.stat().st_mtime>14*DAY or total>512*1024**2:
                remove(p,'expired deployment backup',allow_git=True);total-=amount
    generated=[base/'cms-daily-publish-check',base/'cms-daily-auto-qa',base/'cms-test',dev/'ui-fixtures']
    if dev.is_dir():generated += list(dev.glob('.test-fixtures-old-*'))
    for p in generated:
        marker=p/'.cms-disposable'
        if p.is_dir() and not p.is_symlink() and marker.is_file() and marker.read_text().strip()==TOKEN and now-p.stat().st_mtime>(3 if pressure else 14)*DAY:
            remove(p,'expired generated test/build directory',allow_git=True)
    if tmp.is_dir():
        for p in tmp.glob('cms-*.log'):
            if p.is_file() and not p.is_symlink() and now-p.stat().st_mtime>14*DAY:remove(p,'expired project diagnostic log')
    after=shutil.disk_usage(base)
    report={'checkedAt':dt.datetime.fromtimestamp(now,dt.timezone.utc).isoformat(),'applied':apply,'pressure':pressure,'beforeFreeBytes':free,'afterFreeBytes':after.free,'usedPercent':round(after.used/after.total*100,1),'removedBytes':sum(a['bytes']for a in actions)if apply else 0,'plannedBytes':sum(a['bytes']for a in actions),'actions':actions,'errors':errors,'policy':{'cacheDays':7 if pressure else 30,'cacheBudgetMB':256 if pressure else 512,'backupDays':14,'minimumBackups':keep if backups.is_dir() else 5,'temporaryDays':3 if pressure else 14,'pressureFreeGB':4}}
    if apply:
        runtime.mkdir(parents=True,exist_ok=True,mode=0o700)
        out=runtime/'storage-maintenance.json';temp=out.with_suffix('.tmp');temp.write_text(json.dumps(report,ensure_ascii=False,indent=2));temp.chmod(0o600);temp.replace(out)
    return report

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--apply',action='store_true');ap.add_argument('--base',type=Path,default=Path('/root'));ap.add_argument('--tmp-dir',type=Path,default=Path('/tmp'));args=ap.parse_args()
    lock=args.base/'.cyber-cms-storage.lock'
    with lock.open('a') as f:
        try:fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:return
        report=maintain(args.base,args.tmp_dir,args.apply);print(json.dumps(report,ensure_ascii=False))
        if report['errors']:raise SystemExit(1)
if __name__=='__main__':main()
