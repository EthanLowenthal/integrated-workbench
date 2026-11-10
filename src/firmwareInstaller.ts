import { existsSync, promises as fsp } from 'node:fs';
import { userInfo } from 'node:os';
import { basename, join } from 'node:path';
import * as vscode from 'vscode';
import type { ProbeHost } from './core/probes/host.js';
import { TIMEOUTS } from './core/timeouts.js';
import type { BoardDoctor } from './doctor.js';
import type { FirmwarePackage, ToolPackage } from './registry/types.js';
import type { RegistryService } from './registryService.js';
import type { Runs } from './runs.js';
import type { Session } from './session.js';
import { text } from './text.js';
import { streamProcess } from './toolchains/process.js';
import { findUf2Drives, uf2Fits, type Uf2Drive } from './toolchains/micropython/uf2.js';
import { errorLine, esptoolSteps } from './toolchains/micropython/esptool.js';
import { installTool, platformKey, toolBinPath } from './tools.js';
import type { ToolsModel } from './toolsModel.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mb = (bytes?: number) => (bytes ? `${Math.max(1, Math.round(bytes / 1_000_000))} MB` : '');

/**
 * "Install MicroPython on Board...": picks firmware from the registry, confirms, downloads it
 * (SHA-256 checked, cached), and installs it:
 * - uf2: waits for the BOOTSEL drive, checks the file fits the chip, copies it.
 * - esptool: erases the board's flash and writes the firmware over the selected port.
 */
export class FirmwareInstaller {
  constructor(
    private readonly registry: RegistryService,
    private readonly session: Session,
    private readonly runs: Runs,
    private readonly doctor: BoardDoctor,
    private readonly tools: ToolsModel,
    private readonly toolsDir: string,
    private readonly cacheDir: string,
    private readonly host: ProbeHost,
  ) {}

  /** USB IDs currently plugged in ("2e8a:0003"). */
  private usbIds(): Set<string> {
    return new Set((this.doctor.state.snapshot?.usb ?? []).map((d) => `${d.vid}:${d.pid}`));
  }

  async run(packageId?: string): Promise<boolean> {
    const all = this.registry.firmware;
    const pkg = packageId ? all.find((p) => p.id === packageId) : await this.pick(all);
    if (!pkg) return false;
    if (!(await this.confirm(pkg))) return false;
    return pkg.method === 'uf2' ? this.installUf2(pkg) : this.installEsptool(pkg);
  }

  private async pick(all: FirmwarePackage[]): Promise<FirmwarePackage | undefined> {
    const usb = this.usbIds();
    const drives = await findUf2Drives({ platform: process.platform, user: safeUser() });
    const fits = (p: FirmwarePackage) =>
      p.method === 'uf2' &&
      (drives.some((d) => p.uf2BoardIds?.includes(d.boardId)) ||
        (p.bootloaderUsb ?? []).some((id) => usb.has(id)));
    const sorted = [...all].sort((a, b) => Number(fits(b)) - Number(fits(a)));
    type Item = vscode.QuickPickItem & { pkg?: FirmwarePackage };
    const items: Item[] = [];
    let section = '';
    for (const p of sorted) {
      const s = fits(p) ? text.firmware.connectedSection : p.method === 'uf2' ? 'Raspberry Pi' : 'ESP32';
      if (s !== section) {
        items.push({ label: s, kind: vscode.QuickPickItemKind.Separator });
        section = s;
      }
      items.push({
        label: p.name,
        description: [p.version, mb(p.file.size)].filter(Boolean).join(' · '),
        detail: [p.description, p.method === 'uf2' ? text.firmware.viaUf2 : text.firmware.viaEsptool]
          .filter(Boolean)
          .join(' '),
        pkg: p,
      });
    }
    const choice = await vscode.window.showQuickPick(items, {
      title: text.firmware.pickTitle,
      placeHolder: text.firmware.pickPlaceholder,
      matchOnDescription: true,
      matchOnDetail: true,
    });
    return choice?.pkg;
  }

  private async confirm(pkg: FirmwarePackage): Promise<boolean> {
    if (pkg.method === 'uf2') {
      const ok = text.firmware.install;
      return (
        (await vscode.window.showWarningMessage(
          text.firmware.confirmUf2(pkg.name, pkg.version),
          { modal: true, detail: text.firmware.confirmUf2Detail },
          ok,
        )) === ok
      );
    }
    const port = this.session.port;
    if (!port || !this.session.selectedBoard) {
      await this.runs.task(
        text.firmware.title(pkg.version),
        async () => {
          throw new Error(text.needPort);
        },
        text.firmware.failed,
      );
      return false;
    }
    const esptool = this.registry.toolProviding('esptool');
    const needsTool = !this.esptoolBin();
    const ok = text.firmware.eraseAndInstall;
    return (
      (await vscode.window.showWarningMessage(
        text.firmware.confirmEsptool(pkg.name, pkg.version, port),
        {
          modal: true,
          detail: [
            text.firmware.confirmEsptoolDetail,
            needsTool && esptool ? text.firmware.downloadsEsptool(mb(esptoolSize(esptool))) : '',
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
        ok,
      )) === ok
    );
  }

  /** Downloads the firmware file once (verified by SHA-256) and returns its path. */
  private async download(pkg: FirmwarePackage, signal: AbortSignal): Promise<string> {
    const name = basename(new URL(pkg.file.url).pathname);
    const asTool: ToolPackage = {
      id: pkg.id,
      kind: 'tool',
      name: pkg.name,
      version: pkg.version,
      provides: [pkg.id],
      downloads: { [platformKey(process.platform)]: { ...pkg.file, bin: name } },
    };
    const cached = toolBinPath(this.cacheDir, asTool);
    if (cached && existsSync(cached)) return cached;
    return installTool({ storageDir: this.cacheDir, pkg: asTool, host: this.host, signal });
  }

  private esptoolBin(): string | undefined {
    const pkg = this.registry.toolProviding('esptool');
    const bin = pkg ? toolBinPath(this.toolsDir, pkg) : undefined;
    return bin && existsSync(bin) ? bin : undefined;
  }

  private installUf2(pkg: FirmwarePackage): Promise<boolean> {
    const T = text.firmware;
    return this.runs.task(
      T.title(pkg.version),
      async (signal, log, setTitle) => {
        log(`${T.downloading(pkg.name)}\n`);
        const file = await this.download(pkg, signal);
        const data = await fsp.readFile(file);
        const before = new Set((this.doctor.state.snapshot?.ports ?? []).map((p) => p.path));

        // Wait for the board in BOOTSEL mode (the user holds the button while plugging it in).
        let drive: Uf2Drive | undefined;
        const deadline = Date.now() + TIMEOUTS.bootselWaitMs;
        for (let first = true; ; first = false) {
          const drives = await findUf2Drives({ platform: process.platform, user: safeUser() });
          drive = drives.find((d) => pkg.uf2BoardIds?.includes(d.boardId)) ?? drives[0];
          if (drive) break;
          if (first) {
            setTitle(T.waitingForBootsel);
            log(`${T.bootselHelp}\n`);
          }
          if (signal.aborted) throw new Error(text.cancelled);
          if (Date.now() > deadline) throw new Error(T.noBootselDrive);
          await sleep(1000);
        }
        if (!uf2Fits(data, drive.boardId))
          throw new Error(T.wrongChip(pkg.name, drive.model ?? drive.boardId));

        setTitle(T.copying(basename(drive.path)));
        log(`${T.copying(drive.path)}\n`);
        try {
          await fsp.writeFile(join(drive.path, basename(file)), data);
        } catch (err) {
          // The board often restarts (and the drive disappears) as the last block lands.
          await sleep(2000);
          if (existsSync(join(drive.path, 'INFO_UF2.TXT'))) throw err;
        }

        // The board restarts as MicroPython: pick up its new serial port.
        setTitle(T.restarting);
        const until = Date.now() + TIMEOUTS.firmwareRebootMs;
        while (Date.now() < until && !signal.aborted) {
          await sleep(1000);
          const st = await this.doctor.refresh();
          const fresh = (st.snapshot?.ports ?? []).find((p) => p.vid && !before.has(p.path));
          if (fresh) {
            await this.session.refreshBoards();
            if (this.session.project) await this.session.setPort(fresh.path);
            log(`${T.onPort(fresh.path)}\n`);
            return T.installed(pkg.version, fresh.path);
          }
        }
        return T.installedNoPort(pkg.version);
      },
      T.failed,
    );
  }

  private installEsptool(pkg: FirmwarePackage): Promise<boolean> {
    const T = text.firmware;
    const port = this.session.port!;
    return this.runs.task(
      T.title(pkg.version),
      async (signal, log, setTitle) => {
        let bin = this.esptoolBin();
        if (!bin) {
          const tool = this.registry.toolProviding('esptool');
          if (!tool) throw new Error(T.noEsptool);
          setTitle(T.downloading('esptool'));
          log(`${T.downloading('esptool')}\n`);
          if (!(await this.tools.install(tool.id)) || !(bin = this.esptoolBin()))
            throw new Error(T.esptoolInstallFailed);
        }
        setTitle(T.downloading(pkg.name));
        log(`${T.downloading(pkg.name)}\n`);
        const file = await this.download(pkg, signal);

        await this.runs.uploadHooks.before?.(port); // the Serial Monitor lets go of the port
        try {
          const run = async (args: string[], timeoutMs: number) => {
            log(`$ esptool ${args.join(' ')}\n`);
            const res = await streamProcess(bin!, args, { onStdout: log, onStderr: log, signal, timeoutMs });
            if (signal.aborted) throw new Error(text.cancelled);
            if (res.timedOut) throw new Error(T.timedOut);
            if (res.code !== 0) throw new Error(errorLine(`${res.stdout}\n${res.stderr}`) || T.esptoolFailed);
          };
          const steps = esptoolSteps(pkg.chip!, pkg.address!, port, file);
          setTitle(T.erasing(port));
          await run(steps.erase, TIMEOUTS.flashEraseMs);
          setTitle(T.writing(port));
          await run(steps.write, TIMEOUTS.flashWriteMs);
        } finally {
          void this.runs.uploadHooks.after?.(port);
        }
        return T.installed(pkg.version, port);
      },
      T.failed,
    );
  }
}

function esptoolSize(pkg: ToolPackage): number | undefined {
  return pkg.downloads[platformKey(process.platform)]?.size;
}

function safeUser(): string | undefined {
  try {
    return userInfo().username;
  } catch {
    return undefined;
  }
}
