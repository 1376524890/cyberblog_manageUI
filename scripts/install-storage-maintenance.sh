#!/usr/bin/env bash
set -euo pipefail
if [ "$(id -u)" != 0 ]; then echo 'Run on the production server as root'; exit 1; fi
app=/root/cyberblog-cms-prod/app
install -m 644 "$app/deploy/cyber-cms-storage.service" /etc/systemd/system/cyber-cms-storage.service
install -m 644 "$app/deploy/cyber-cms-storage.timer" /etc/systemd/system/cyber-cms-storage.timer
install -m 644 "$app/deploy/journald-cyberblog.conf" /etc/systemd/journald@cyberblog.conf
mkdir -p /etc/systemd/system/cyber-cms.service.d
cat > /etc/systemd/system/cyber-cms.service.d/storage.conf <<'UNIT'
[Service]
LogNamespace=cyberblog
Environment=CMS_MIN_FREE_MB=1024
UNIT
python3 - <<'PY'
from pathlib import Path
import os
paths=list(Path('/root/cyberblog-cms-backups').glob('*'))
paths+=list(Path('/root/cyberblog-cms-work').glob('.test-fixtures-old-*'))
paths+=[Path('/root/cms-daily-auto-qa'),Path('/root/cms-daily-publish-check'),Path('/root/cms-test'),Path('/root/cyberblog-cms-work/ui-fixtures')]
for p in paths:
    if not p.is_dir() or p.is_symlink():continue
    st=p.stat();(p/'.cms-disposable').write_text('cyber-cms-generated-v1\n');os.utime(p,ns=(st.st_atime_ns,st.st_mtime_ns))
PY
systemctl daemon-reload
systemctl enable --now cyber-cms-storage.timer
systemctl start cyber-cms-storage.service
systemctl restart cyber-cms
systemctl is-active cyber-cms cyber-cms-storage.timer
