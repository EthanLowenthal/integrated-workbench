/**
 * User-facing text for the VS Code UI. (Diagnosis text lives in core/messages.ts.)
 * Plain English, and always say what to do next.
 */
export const text = {
  // Status bar
  statusSetup: 'Set up',
  statusSelectBoard: 'Select board',
  statusTooltip: 'Integrated Workbench: board and port for this sketch. Click to open the sidebar.',
  statusProblem: 'Board problem',

  // Sketch view
  openSketch: 'Open a file in an Arduino sketch to build and upload it.',
  selectBoard: 'Select board',
  noBoardsPlugged: 'No boards plugged in',
  boardSaved: 'Saved in sketch.yaml',
  engineMissing: "The build engine isn't installed yet.",
  boardPackageMissing: "Support for this board isn't installed yet.",
  recommendedMissing: (n: number) => `${n} recommended item${n === 1 ? '' : 's'} not installed`,
  setUp: 'Set up',
  show: 'Show',
  boardCheck: 'Board check',
  monitorSoon: 'Serial monitor: coming next',
  unknownBoard: 'Unrecognized board',

  // Pickers
  pickBoard: 'Which board are you building for?',
  pickPort: 'Which port is your board on?',
  detectedSection: 'Plugged in',
  allBoardsSection: 'All installed boards',
  noPortsFound: 'No boards are plugged in.',
  openBoardDoctor: "Why isn't my board showing up?",
  loadingBoards: 'Loading boards...',
  noBoardPackages: 'No board packages installed yet',
  openTools: 'Open Boards and tools to install one',

  // Boards and tools
  comingSoon: 'Coming soon',
  downloading: 'Downloading',
  removing: 'Removing',
  installingCore: (id: string) => `Installing ${id}`,
  coreInstallFailed: (id: string) =>
    `Couldn't install ${id}. See the Integrated Workbench output for details.`,
  coreRemoveFailed: (id: string) => `Couldn't remove ${id}. See the Integrated Workbench output for details.`,
  needsEngineFirst: 'Installs the build engine first.',
  notInIndex: "Not in arduino-cli's board list. Try refreshing.",
  noDownloadHere: 'No download for this computer.',
  usingYourOwn: 'Using your own arduino-cli.',
  trustRegistry: (pkg: string, registry: string) => `Install ${pkg} from the "${registry}" registry?`,
  trustRegistryDetail: (spec: string) =>
    `This is the first install from ${spec}. It isn't the built-in registry, so make sure you trust its author: registries can point at programs to download. You won't be asked again for this registry.`,
  trustAndInstall: 'Trust and install',
  addRegistryPrompt: 'Add a registry',
  addRegistryPlaceholder: 'owner/repo, owner/repo@branch, https://.../index.json, or a local folder',
  registryHelpUrl: 'https://github.com/EthanLowenthal/sketchdesk/blob/main/docs/REGISTRY.md',

  // Build / upload (shown in the sidebar)
  notInSketch: 'Open a file in an Arduino sketch first.',
  needEngine: 'Install the build engine first (Boards and tools).',
  needBoard: 'Pick a board first.',
  needBoardPackage: (board: string) => `Install support for ${board} first (Boards and tools).`,
  needPort: 'Plug in your board and pick its port.',
  building: (sketch: string, board: string) => `Compiling ${sketch} for ${board}`,
  uploading: (sketch: string, port: string) => `Uploading ${sketch} to ${port}`,
  buildOk: (sketch: string) => `${sketch} compiled`,
  uploadOk: (sketch: string, port: string) => `${sketch} uploaded to ${port}`,
  buildFailed: (errors: number) =>
    errors > 0 ? `Compile failed with ${errors} error${errors === 1 ? '' : 's'}` : 'Compile failed',
  uploadFailed: (port: string) => `Upload to ${port} failed`,

  // Board Doctor actions
  copied: (cmd: string) => `Copied: ${cmd}`,
  adminPrompt: (cmd: string) =>
    `This needs administrator rights, so Integrated Workbench won't run it for you. Copy "${cmd}" and paste it into a terminal opened as administrator.`,
  adminCopy: 'Copy command',
};
