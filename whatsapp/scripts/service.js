/**
 * Runs the WhatsApp supervisor in the background forever, via Task Scheduler.
 *
 * `bun run whatsapp:service install` (from an Administrator terminal) registers a
 * task that runs as SYSTEM, so it starts at boot with nobody logged in and needs
 * no stored password. An every-5-minutes trigger with `IgnoreNew` is the
 * watchdog: a no-op while the supervisor runs, a relaunch once it has died.
 * Pair interactively with `bun run whatsapp` first - the QR needs a terminal.
 *
 * Usage: bun run whatsapp:service <install|uninstall|start|stop|restart|status>
 */

import { join } from 'node:path';

/** @type {string} Scheduled task name. */
export const TASK_NAME = 'WhatsAppBridge';

/** @type {string} Repo root: the task's working directory, where `.env.whatsapp` lives. */
const REPO_ROOT = join(import.meta.dir, '..', '..');

/** @type {string} Append-only log of the supervisor's output. */
const LOG_PATH = join(REPO_ROOT, 'whatsapp', 'data', 'bridge.log');

/**
 * @type {string} PowerShell that kills only this bridge's bun processes (the
 * supervisor and its child), not every bun on the machine.
 */
const KILL_BRIDGE = `Get-CimInstance Win32_Process -Filter "Name='bun.exe'" |
  Where-Object { $_.CommandLine -match 'whatsapp[\\\\/]src[\\\\/](supervisor|index)\\.js' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;

/**
 * Quotes a value as a PowerShell single-quoted string literal.
 *
 * @param {string} value Raw value.
 * @returns {string} The quoted literal.
 */
function psQuote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Builds the PowerShell that registers (or replaces) and starts the task.
 *
 * @param {string} bunPath Absolute path to the bun executable.
 * @param {string} repoRoot Absolute path to the repo root.
 * @param {string} logPath Absolute path to the log file.
 * @returns {string} A PowerShell script.
 */
export function installScript(bunPath, repoRoot, logPath) {
  const cmdArgs = `/c ""${bunPath}" --env-file=.env.whatsapp whatsapp\\src\\supervisor.js >> "${logPath}" 2>&1"`;
  return `$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force ${psQuote(join(logPath, '..'))} | Out-Null
$act  = New-ScheduledTaskAction -Execute 'cmd.exe' -WorkingDirectory ${psQuote(repoRoot)} -Argument ${psQuote(cmdArgs)}
$trig = @(
  New-ScheduledTaskTrigger -AtStartup
  New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)
)
$set  = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$prin = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName ${psQuote(TASK_NAME)} -Action $act -Trigger $trig -Settings $set -Principal $prin -Force | Out-Null
powercfg /change standby-timeout-ac 0
Start-ScheduledTask -TaskName ${psQuote(TASK_NAME)}`;
}

/**
 * Builds the PowerShell for every subcommand.
 *
 * @param {string} bunPath Absolute path to the bun executable.
 * @param {string} repoRoot Absolute path to the repo root.
 * @param {string} logPath Absolute path to the log file.
 * @returns {Record<string, string>} Subcommand name to PowerShell script.
 */
export function scripts(bunPath, repoRoot, logPath) {
  const task = psQuote(TASK_NAME);
  const stop = `Disable-ScheduledTask -TaskName ${task} | Out-Null
Stop-ScheduledTask -TaskName ${task}
${KILL_BRIDGE}`;
  const start = `Enable-ScheduledTask -TaskName ${task} | Out-Null
Start-ScheduledTask -TaskName ${task}`;
  return {
    install: `${KILL_BRIDGE}\n${installScript(bunPath, repoRoot, logPath)}`,
    uninstall: `${stop}\nUnregister-ScheduledTask -TaskName ${task} -Confirm:$false`,
    start,
    stop,
    restart: `${stop}\n${start}`,
    status: `(Get-ScheduledTask -TaskName ${task}).State
if (Test-Path ${psQuote(logPath)}) { Get-Content ${psQuote(logPath)} -Tail 5 }`,
  };
}

/**
 * Dispatches the subcommand.
 *
 * @param {string | undefined} command One of install, uninstall, start, stop, restart, status.
 * @returns {void}
 */
function main(command) {
  const all = scripts(process.execPath, REPO_ROOT, LOG_PATH);
  if (process.platform !== 'win32' || !Object.hasOwn(all, command ?? '')) {
    console.error(`usage (Windows only): bun run whatsapp:service <${Object.keys(all).join('|')}>`);
    process.exit(1);
  }
  const { exitCode } = Bun.spawnSync(
    ['powershell', '-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'\n${all[command]}`],
    { stdio: ['inherit', 'inherit', 'inherit'] },
  );
  if (exitCode !== 0) {
    console.error(command === 'status' ? 'Task not installed.' : 'Failed - run this from an Administrator terminal.');
    process.exit(exitCode);
  }
  if (command === 'install' || command === 'start' || command === 'restart') {
    console.log(`${TASK_NAME} running in the background. Log: ${LOG_PATH}`);
  }
}

if (import.meta.main) {
  main(process.argv[2]);
}
