const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const runtime = path.join(root, 'runtime');
fs.mkdirSync(runtime, { recursive: true });
const lock = path.join(runtime, 'supervisor.lock');
const stateFile = path.join(runtime, 'status.json');
const stopFile = path.join(runtime, 'stop.request');
const logFile = path.join(runtime, 'server.log');
function alive(pid) { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } }
try {
  const previous = JSON.parse(fs.readFileSync(lock, 'utf8'));
  if (alive(previous.pid)) process.exit(0);
} catch {}
let lockFd;
try { lockFd = fs.openSync(lock, 'wx'); }
catch (error) {
  if (error.code !== 'EEXIST') throw error;
  const previous = JSON.parse(fs.readFileSync(lock, 'utf8'));
  if (alive(previous.pid)) process.exit(0);
  fs.unlinkSync(lock);
  lockFd = fs.openSync(lock, 'wx');
}
fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid }));
if (fs.existsSync(stopFile)) fs.unlinkSync(stopFile);
let server = null; let stopping = false; let timer; let restarts = 0;
function log(message) { fs.appendFileSync(path.join(runtime, 'supervisor.log'), new Date().toISOString() + ' ' + message + '\n'); }
function state(status) { fs.writeFileSync(stateFile, JSON.stringify({ status, supervisorPid: process.pid, serverPid: server?.pid ?? null, restarts, url: 'http://localhost:3000', updatedAt: new Date().toISOString() }, null, 2)); }
function finish() {
  state('stopped');
  try { fs.closeSync(lockFd); fs.unlinkSync(lock); } catch {}
  process.exit(0);
}
function stop() {
  if (stopping) return;
  stopping = true; clearTimeout(timer); log('Stopping background server.');
  if (server) { server.kill(); setTimeout(finish, 10000).unref(); } else finish();
}
function start() {
  if (stopping) return;
  if (!fs.existsSync(path.join(root, '.next', 'BUILD_ID'))) { log('Production build missing. Run npm run build first.'); state('build-required'); finish(); return; }
  if (fs.existsSync(logFile) && fs.statSync(logFile).size > 10 * 1024 * 1024) {
    const previous = logFile + '.previous';
    if (fs.existsSync(previous)) fs.unlinkSync(previous);
    fs.renameSync(logFile, previous);
  }
  const output = fs.openSync(logFile, 'a');
  server = spawn(process.execPath, [path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '--hostname', 'localhost', '--port', '3000'], {
    cwd: root, env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' }, windowsHide: true, stdio: ['ignore', output, output],
  });
  fs.closeSync(output);
  state('starting'); log('Started production server PID ' + server.pid);
  server.once('spawn', () => state('running'));
  server.once('error', error => log('Server process error: ' + error.message));
  server.once('exit', (code, signal) => {
    log('Server exited. Code=' + code + ' signal=' + signal);
    server = null;
    if (stopping) return finish();
    restarts++; state('restarting');
    timer = setTimeout(start, 5000);
  });
}
process.on('SIGINT', stop); process.on('SIGTERM', stop);
setInterval(() => { if (fs.existsSync(stopFile)) stop(); }, 1000);
log('Background supervisor started PID ' + process.pid);
start();
