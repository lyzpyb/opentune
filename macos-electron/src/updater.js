const { app, dialog, shell } = require('electron');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

const REPO = 'lyzpyb/opentune';

function parseSemVer(raw) {
  const cleaned = String(raw || '').trim().replace(/^v/i, '').split('-')[0];
  const parts = cleaned.split('.').map((n) => parseInt(n, 10) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function isNewerVersion(latest, current) {
  const a = parseSemVer(latest);
  const b = parseSemVer(current);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

function httpsGetJson(rawUrl) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      rawUrl,
      {
        headers: {
          'User-Agent': `OpenTune/${app.getVersion()} (https://github.com/${REPO})`,
          Accept: 'application/vnd.github+json',
        },
        timeout: 10000,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
  });
}

function downloadFileWithProgress(rawUrl, destPath, onProgress, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      rawUrl,
      {
        headers: {
          'User-Agent': `OpenTune/${app.getVersion()}`,
          Accept: 'application/octet-stream',
        },
        timeout: 30000,
      },
      (res) => {
        if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) {
            reject(new Error('重定向次数过多'));
            return;
          }
          const nextUrl = new URL(res.headers.location, rawUrl).toString();
          downloadFileWithProgress(nextUrl, destPath, onProgress, redirectsLeft - 1)
            .then(resolve)
            .catch(reject);
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          reject(new Error(`下载失败 (HTTP ${res.statusCode})`));
          return;
        }

        const total = parseInt(res.headers['content-length'] || '0', 10) || 0;
        let received = 0;
        let lastPct = -1;
        const fileStream = fs.createWriteStream(destPath);

        res.on('data', (chunk) => {
          received += chunk.length;
          if (total > 0) {
            const pct = Math.min(100, Math.round((received / total) * 100));
            if (pct !== lastPct) {
              lastPct = pct;
              onProgress(pct, received, total);
            }
          }
        });

        res.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close(() => resolve(destPath));
        });
        fileStream.on('error', (err) => {
          fs.rmSync(destPath, { force: true });
          reject(err);
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('下载超时')));
    req.on('error', reject);
  });
}

function execFileAsync(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

function getRunningAppBundlePath() {
  if (!app.isPackaged || process.platform !== 'darwin') return null;
  const marker = '.app/Contents/';
  const idx = process.execPath.indexOf(marker);
  if (idx === -1) return null;
  return process.execPath.slice(0, idx + 4);
}

function createUpdater({ onStateChange, onBeforeQuit, getMainWindow }) {
  let state = {
    status: 'idle',
    currentVersion: app.getVersion(),
    latestVersion: '',
    releaseUrl: `https://github.com/${REPO}/releases/latest`,
    downloadUrl: '',
    isZip: false,
    progress: 0,
    message: '',
  };

  const emit = (patch) => {
    state = { ...state, ...patch };
    onStateChange(state);
  };

  async function checkForUpdates({ silent = true } = {}) {
    if (state.status === 'downloading' || state.status === 'installing') return state;
    const currentVersion = app.getVersion();
    emit({ status: 'checking', currentVersion, message: '正在检查更新...' });

    try {
      const release = await httpsGetJson(`https://api.github.com/repos/${REPO}/releases/latest`);
      const latestTag = String(release?.tag_name || '').trim();
      const latestVersion = latestTag.replace(/^v/i, '');
      const assets = Array.isArray(release?.assets) ? release.assets : [];

      const zipAsset =
        assets.find((a) => /universal.*\.zip$/i.test(a.name)) ||
        assets.find((a) => /\.zip$/i.test(a.name));
      const dmgAsset =
        assets.find((a) => /universal.*\.dmg$/i.test(a.name)) ||
        assets.find((a) => /\.dmg$/i.test(a.name));

      const releaseUrl = release?.html_url || `https://github.com/${REPO}/releases/latest`;

      if (latestVersion && isNewerVersion(latestVersion, currentVersion)) {
        emit({
          status: 'available',
          currentVersion,
          latestVersion,
          releaseUrl,
          downloadUrl: zipAsset?.browser_download_url || dmgAsset?.browser_download_url || '',
          isZip: Boolean(zipAsset),
          progress: 0,
          message: `发现新版本 v${latestVersion}`,
        });
      } else {
        emit({
          status: 'up-to-date',
          currentVersion,
          latestVersion: latestVersion || currentVersion,
          releaseUrl,
          downloadUrl: '',
          isZip: false,
          progress: 0,
          message: `当前已是最新版本 v${currentVersion}`,
        });
        if (!silent) {
          const win = getMainWindow();
          dialog.showMessageBox(win || undefined, {
            type: 'info',
            title: '检查更新',
            message: `OpenTune 当前已是最新版本 (v${currentVersion})`,
            detail: '无需更新，你的登录态与本地配置均保持完好。',
          });
        }
      }
    } catch (err) {
      emit({
        status: 'error',
        currentVersion,
        message: '检查更新失败，请稍后重试',
      });
      if (!silent) {
        const win = getMainWindow();
        dialog.showMessageBox(win || undefined, {
          type: 'warning',
          title: '检查更新失败',
          message: '无法连接 GitHub Releases 获取最新版本信息',
          detail: err && err.message ? err.message : '请检查网络连接后重试。',
        });
      }
    }
    return state;
  }

  async function startUpdate() {
    if (state.status !== 'available' && state.status !== 'error') return;
    if (!state.downloadUrl) {
      shell.openExternal(state.releaseUrl);
      return;
    }

    const targetAppPath = getRunningAppBundlePath();
    if (!state.isZip || !targetAppPath) {
      // Dev mode or older release without .zip asset: open release page cleanly
      shell.openExternal(state.releaseUrl);
      emit({
        status: 'available',
        message: targetAppPath
          ? '该版本未包含 .zip 更新包，已为你打开 Releases 下载页'
          : '当前为开发模式运行，已为你打开 Releases 下载页',
      });
      return;
    }

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentune-update-'));
    const zipPath = path.join(workDir, `opentune-${state.latestVersion}.zip`);
    const extractDir = path.join(workDir, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });

    try {
      emit({ status: 'downloading', progress: 0, message: `正在下载 v${state.latestVersion}...` });
      await downloadFileWithProgress(state.downloadUrl, zipPath, (pct) => {
        emit({ status: 'downloading', progress: pct, message: `正在下载 v${state.latestVersion} (${pct}%)` });
      });

      emit({ status: 'installing', progress: 100, message: '正在解压并解除隔离属性...' });
      await execFileAsync('/usr/bin/ditto', ['-xk', zipPath, extractDir]);

      const entries = fs.readdirSync(extractDir);
      const appName = entries.find((name) => name.endsWith('.app'));
      if (!appName) {
        throw new Error('更新包中未找到 .app 应用文件');
      }
      const newAppPath = path.join(extractDir, appName);

      // Clear macOS quarantine attribute before replacing so Gatekeeper won't block relaunch
      try {
        await execFileAsync('/usr/bin/xattr', ['-cr', newAppPath]);
      } catch (_) {}

      emit({ status: 'installing', progress: 100, message: '即将替换并重启 OpenTune...' });

      const scriptPath = path.join(workDir, 'apply-update.sh');
      const scriptContent = `#!/bin/sh
set -e
OLD_PID="$1"
TARGET_APP="$2"
NEW_APP="$3"
WORK_DIR="$4"
BACKUP_APP="\${TARGET_APP}.backup-\$\$"

i=0
while kill -0 "$OLD_PID" 2>/dev/null && [ $i -lt 60 ]; do
  sleep 0.25
  i=$((i + 1))
done

if [ -d "$TARGET_APP" ]; then
  mv "$TARGET_APP" "$BACKUP_APP"
fi

if mv "$NEW_APP" "$TARGET_APP"; then
  rm -rf "$BACKUP_APP" "$WORK_DIR"
  /usr/bin/xattr -cr "$TARGET_APP" 2>/dev/null || true
  /usr/bin/open -n "$TARGET_APP"
else
  if [ -d "$BACKUP_APP" ]; then
    mv "$BACKUP_APP" "$TARGET_APP"
  fi
  rm -rf "$WORK_DIR"
  exit 1
fi
`;
      fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });

      const child = spawn('/bin/sh', [scriptPath, String(process.pid), targetAppPath, newAppPath, workDir], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();

      onBeforeQuit();
      app.quit();
    } catch (err) {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch (_) {}
      emit({
        status: 'error',
        progress: 0,
        message: `自动更新失败：${err && err.message ? err.message : '未知错误'}`,
      });
    }
  }

  return {
    getState: () => state,
    checkForUpdates,
    startUpdate,
  };
}

module.exports = { createUpdater };
