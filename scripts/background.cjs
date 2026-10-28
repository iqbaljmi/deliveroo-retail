const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const runtime = path.join(root, 'runtime');
const supervisor = path.join(__dirname, 'supervisor.cjs');
const task = 'DeliverooRetailStockManager';
const runKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const registry = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
const psQuote = value => "'" + value.replace(/'/g, "''") + "'";
function ps(code) { return spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', code], { cwd: root, windowsHide: true, encoding: 'utf8' }); }
function alive(pid) { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } }
function running() {
  try { const lock = JSON.parse(fs.readFileSync(path.join(runtime, 'supervisor.lock'), 'utf8')); return alive(lock.pid); } catch { return false; }
}
const launch = 'Start-Process -FilePath ' + psQuote(process.execPath) + ' -ArgumentList ' + psQuote('"' + supervisor + '"') + ' -WorkingDirectory ' + psQuote(root) + ' -WindowStyle Hidden';
function start() {
  if (running()) { console.log('Background supervisor is already running.'); return; }
  let installation;
  try { installation = JSON.parse(fs.readFileSync(path.join(runtime, 'installation.json'), 'utf8')); } catch {}
  const result = ps(installation?.method?.startsWith('Task Scheduler') ? 'Start-ScheduledTask -TaskName ' + psQuote(task) : launch);
  if (result.status !== 0) throw new Error(result.stderr || 'Could not start the background server.');
  console.log('Background start requested. Open http://localhost:3000/login');
}
async function stop() {
  if (!running()) { console.log('Background supervisor is already stopped.'); return; }
  fs.writeFileSync(path.join(runtime, 'stop.request'), new Date().toISOString());
  const deadline = Date.now() + 16000;
  while (running() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 300));
  if (running()) throw new Error('The supervisor has not stopped yet. Check runtime logs.');
  console.log('Background server stopped.');
}
function install() {
  if (process.platform !== 'win32') throw new Error('Windows automatic startup is supported by this installer.');
  if (!fs.existsSync(path.join(root, '.next', 'BUILD_ID'))) throw new Error('Run npm run build before installing automatic startup.');
  const actionArguments = '-NoProfile -NonInteractive -WindowStyle Hidden -Command "& ' + psQuote(process.execPath) + ' ' + psQuote(supervisor) + '; exit $LASTEXITCODE"';
  const script = [
    "$ErrorActionPreference='Stop'",
    '$identity=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name',
    '$action=New-ScheduledTaskAction -Execute ' + psQuote(powershell) + ' -Argument ' + psQuote(actionArguments) + ' -WorkingDirectory ' + psQuote(root),
    '$trigger=New-ScheduledTaskTrigger -AtLogOn -User $identity',
    '$principal=New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited',
    '$settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval ([TimeSpan]::FromMinutes(1)) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -Hidden',
    'Register-ScheduledTask -TaskName ' + psQuote(task) + ' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description ' + psQuote('Deliveroo stock manager at localhost:3000. Starts at Windows sign-in and runs in the background.') + ' -Force | Out-Null',
  ].join('; ');
  const result = ps(script);
  let method;
  if (result.status === 0) method = 'Task Scheduler (current-user sign-in)';
  else {
    // A current-user startup entry works without administrator access.
    const command = '"' + powershell + '" -NoProfile -NonInteractive -WindowStyle Hidden -Command "' + launch.replace(/"/g, '\\"') + '"';
    const added = spawnSync(registry, ['ADD', runKey, '/v', task, '/t', 'REG_SZ', '/d', command, '/f'], { windowsHide: true, encoding: 'utf8' });
    if (added.status !== 0) throw new Error('Automatic startup could not be installed: ' + (added.stderr || result.stderr));
    method = 'Current-user Windows startup';
  }
  fs.writeFileSync(path.join(runtime, 'installation.json'), JSON.stringify({ method, task, root, installedAt: new Date().toISOString() }, null, 2));
  console.log('Automatic startup installed: ' + method + '.');
  start();
}
async function uninstall() {
  const removed = ps("$ErrorActionPreference='Stop'; if(Get-ScheduledTask -TaskName " + psQuote(task) + " -ErrorAction SilentlyContinue){Unregister-ScheduledTask -TaskName " + psQuote(task) + ' -Confirm:$false}');
  const query = spawnSync(registry, ['QUERY', runKey, '/v', task], { windowsHide: true, encoding: 'utf8' });
  if (query.status === 0) {
    const deleted = spawnSync(registry, ['DELETE', runKey, '/v', task, '/f'], { windowsHide: true, encoding: 'utf8' });
    if (deleted.status !== 0) throw new Error(deleted.stderr || 'Could not remove the startup entry.');
  }
  if (removed.status !== 0) throw new Error(removed.stderr || 'Could not remove the scheduled task.');
  await stop();
  console.log('Automatic startup removed. Project files and logs retained.');
}
(async () => {
  fs.mkdirSync(runtime, { recursive: true });
  switch (process.argv[2]) {
    case 'install': install(); break;
    case 'start': start(); break;
    case 'stop': await stop(); break;
    case 'uninstall': await uninstall(); break;
    case 'status': {
      const state = fs.existsSync(path.join(runtime, 'status.json')) ? JSON.parse(fs.readFileSync(path.join(runtime, 'status.json'), 'utf8')) : {};
      const installation = fs.existsSync(path.join(runtime, 'installation.json')) ? JSON.parse(fs.readFileSync(path.join(runtime, 'installation.json'), 'utf8')) : {};
      console.log(JSON.stringify({ ...state, supervisorAlive: running(), startup: installation.method || 'not installed', logs: path.join(runtime, 'server.log') }, null, 2)); break;
    }
    default: throw new Error('Use install, start, stop, status or uninstall.');
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
