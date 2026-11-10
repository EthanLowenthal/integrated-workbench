/**
 * User-facing text for the VS Code UI. (Diagnosis text lives in core/messages.ts.)
 * Plain English, and always say what to do next.
 */
export const text = {
  // Status bar
  selectBoard: 'Select board',
  noPort: 'No port',
  boardProblem: 'Board problem',
  boardTooltip: 'Board to build for. Click to change.',
  portTooltip: 'Port to upload to. Click to change.',
  problemTooltip: 'Integrated Workbench found a problem with your board. Click for details.',
  buildTooltip: 'Verify (compile) this sketch',
  uploadTooltip: 'Compile and upload this sketch',

  // Pickers
  pickBoard: 'Which board are you building for?',
  pickPort: 'Which port is your board on?',
  detectedSection: 'Plugged in',
  allBoardsSection: 'All installed boards',
  noPortsFound: 'No boards are plugged in.',
  openBoardDoctor: "Why isn't my board showing up?",
  unknownBoard: 'Unrecognized board',
  loadingBoards: 'Loading boards...',
  noCoresInstalled:
    'No board support is installed yet. Install support for the classic boards (Uno, Nano, Mega, Leonardo)?',
  installAvr: 'Install',
  installingCore: (id: string) => `Installing ${id}...`,
  coreInstalled: (id: string) => `Installed ${id}.`,
  coreInstallFailed: (id: string) => `Couldn't install ${id}. See the Integrated Workbench output for details.`,

  // arduino-cli (Integrated Workbench's Arduino build engine)
  cliOffer: (mb: number) =>
    `To compile and upload Arduino sketches, Integrated Workbench needs its build engine (arduino-cli, ${mb} MB, downloaded once from Arduino's official GitHub releases). Download it now?`,
  cliDownload: 'Download',
  cliUseOwn: 'Use my own arduino-cli...',
  cliDownloading: 'Downloading Integrated Workbench build engine',
  cliReady: 'Integrated Workbench is ready to build Arduino sketches.',
  cliDownloadFailed: (err: string) => `Couldn't download the build engine: ${err}`,
  cliMissing:
    "Integrated Workbench can't download arduino-cli for this computer. Install it yourself, then set its path.",
  cliGuide: 'Installation guide',
  cliGuideUrl: 'https://arduino.github.io/arduino-cli/latest/installation/', // TODO verify
  cliSetPath: 'Set path...',
  copied: (cmd: string) => `Copied: ${cmd}. Paste it into a terminal, then try again.`,

  // Build / upload
  notInSketch: 'Open a file in an Arduino sketch folder first (a folder containing <folder name>.ino).',
  building: (sketch: string, board: string) => `Compiling ${sketch} for ${board}`,
  uploading: (sketch: string, port: string) => `Uploading ${sketch} to ${port}`,
  buildOk: (sketch: string) => `$(check) ${sketch} compiled`,
  uploadOk: (sketch: string, port: string) => `$(check) ${sketch} uploaded to ${port}`,
  buildFailed: (errors: number) =>
    errors > 0
      ? `Compile failed with ${errors} error${errors === 1 ? '' : 's'}. See the Problems panel.`
      : 'Compile failed. See the Integrated Workbench output for details.',
  uploadFailed: (port: string) => `Upload to ${port} failed. See the Integrated Workbench output for details.`,
  showOutput: 'Show output',
  needBoard: 'Pick a board first.',
  needPort: 'Plug in your board, then pick its port.',

  // Board Doctor
  doctorTitle: 'Board Doctor',
  doctorChecking: 'Checking USB devices...',
  doctorProbeFailed: (err: string) => `Integrated Workbench couldn't read your USB devices: ${err}`,
  adminPrompt: (cmd: string) =>
    `This needs administrator rights, so Integrated Workbench won't run it for you. Copy "${cmd}" and paste it into a terminal opened as administrator.`,
  adminCopy: 'Copy command',
};
