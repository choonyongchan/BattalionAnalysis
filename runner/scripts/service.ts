/**
 * Runs the supervisor in the background via Task Scheduler, as SYSTEM, started at boot and re-launched
 * every 5 minutes if dead. Pair with `bun run runner` first. Usage: `bun run runner:service <command>`.
 */

import { join } from 'node:path';

/** Scheduled task name. */
const TASK_NAME = 'WhatsAppBridge';

/** Repo root: the task's working directory, where `.env.whatsapp` lives. */
const REPO_ROOT = join(import.meta.dir, '..', '..');

/** Append-only log of the supervisor's output. */
const LOG_PATH = join(REPO_ROOT, 'runner', 'data', 'bridge.log');

/** PowerShell that kills only this bridge's bun processes, not every bun on the machine. */
const KILL_BRIDGE = `Get-CimInstance Win32_Process -Filter "Name='bun.exe'" |
  Where-Object { $_.CommandLine -match 'runner[\\\\/]src[\\\\/](supervisor|index)\\.ts' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;

/** A PowerShell single-quoted string literal. */
function psQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** PowerShell that registers (or replaces) and starts the task. */
export function installScript(bunPath: string, repoRoot: string, logPath: string): string {
  const cmdArgs = `/c ""${bunPath}" --env-file=.env.whatsapp runner\\src\\supervisor.ts >> "${logPath}" 2>&1"`;
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

/** PowerShell for every subcommand. */
export function scripts(bunPath: string, repoRoot: string, logPath: string): Record<string, string> {
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

/** Runs one subcommand: install, uninstall, start, stop, restart or status. */
function main(command: string | undefined): void {
  const all = scripts(process.execPath, REPO_ROOT, LOG_PATH);
  if (process.platform !== 'win32' || command === undefined || !Object.hasOwn(all, command)) {
    console.error(`usage (Windows only): bun run runner:service <${Object.keys(all).join('|')}>`);
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
