/**
 * User-facing text for the VS Code UI. (Diagnosis text lives in core/messages.ts.)
 * Style: like VS Code's own UI. Title Case for buttons, links, commands and view names; short,
 * neutral sentence-case messages; "..." on actions that ask for more input.
 */
export const text = {
  // Status bar
  statusSetup: 'Setup Required',
  statusSelectBoard: 'No Board Selected',
  statusTooltip: 'Integrated Workbench: board and port for this sketch',
  statusProblem: 'Board Issue',

  // Sketch view
  openSketch: 'Open a sketch to build and upload.',
  sketchesHeading: 'Sketches',
  noSketches:
    'No sketches found. A sketch is a folder containing an .ino file of the same name (for example, Blink/Blink.ino).',
  sketchKind: 'Arduino sketch',
  selectBoard: 'Select Board...',
  noBoardsPlugged: 'No boards connected',
  boardSaved: 'Stored in sketch.yaml',
  engineMissing: 'Build engine not installed.',
  boardPackageMissing: 'Board package not installed.',
  recommendedMissing: (n: number) => `${n} recommended package${n === 1 ? '' : 's'} not installed.`,
  install: 'Install',
  view: 'View',
  boardCheck: 'Diagnostics',
  monitorSoon: 'Serial Monitor (coming soon)',
  unknownBoard: 'Unknown device',
  refreshPorts: 'Refresh Ports',
  showOutput: 'Show Output',
  cancel: 'Cancel',
  moreInProblems: (n: number) => `${n} more in the Problems panel`,

  // Pickers
  pickBoard: 'Select a board',
  pickPort: 'Select a port',
  detectedSection: 'Connected',
  allBoardsSection: 'Installed boards',
  noPortsFound: 'No boards connected',
  openBoardDoctor: 'Show Diagnostics',
  loadingBoards: 'Loading boards...',
  noBoardPackages: 'No board packages installed',
  openTools: 'Install Board Packages...',

  // Boards and Tools
  comingSoon: 'Coming soon',
  downloading: 'Downloading',
  removing: 'Uninstalling',
  installingCore: (id: string) => `Installing ${id}`,
  coreInstallFailed: (id: string) =>
    `Failed to install ${id}. See the Integrated Workbench output for details.`,
  coreRemoveFailed: (id: string) =>
    `Failed to uninstall ${id}. See the Integrated Workbench output for details.`,
  needsEngineFirst: 'Requires the build engine, which is installed first.',
  notInIndex: 'Not found in the package index. Refresh to update.',
  noDownloadHere: 'Not available for this platform.',
  usingYourOwn: 'Using the arduino-cli configured in settings or on PATH.',
  trustRegistry: (pkg: string, registry: string) => `Install ${pkg} from "${registry}"?`,
  trustRegistryDetail: (spec: string) =>
    `This package comes from a third-party registry (${spec}). Registries can download and run programs on this computer. Install only from registries you trust. You will not be asked again for this registry.`,
  trustAndInstall: 'Trust and Install',
  addRegistryPrompt: 'Add Registry',
  addRegistryPlaceholder: 'owner/repo, owner/repo@branch, https://.../index.json, or a local folder path',
  registryHelpUrl: 'https://github.com/EthanLowenthal/sketchdesk/blob/main/docs/REGISTRY.md',

  // Build / upload (shown in the sidebar)
  notInSketch: 'No sketch open.',
  needEngine: 'Build engine required. Install it from Boards and Tools.',
  needBoard: 'Select a board.',
  needBoardPackage: (board: string) =>
    `Board package for ${board} required. Install it from Boards and Tools.`,
  needPort: 'Connect a board and select its port.',
  building: (sketch: string, board: string) => `Compiling ${sketch} for ${board}`,
  uploading: (sketch: string, port: string) => `Uploading ${sketch} to ${port}`,
  buildOk: 'Compilation succeeded',
  uploadOk: (port: string) => `Upload to ${port} complete`,
  buildFailed: (errors: number) =>
    errors > 0 ? `Compilation failed: ${errors} error${errors === 1 ? '' : 's'}` : 'Compilation failed',
  uploadFailed: (port: string) => `Upload to ${port} failed`,

  // Diagnostics actions
  copied: (cmd: string) => `Copied to clipboard: ${cmd}`,
  adminPrompt: (cmd: string) =>
    `"${cmd}" requires administrator privileges and will not be run automatically. Copy it and run it in an administrator terminal.`,
  adminCopy: 'Copy Command',

  /** Static strings rendered inside the sidebar webviews (sent with each state update). */
  webview: {
    board: 'Board',
    port: 'Port',
    disconnected: 'disconnected',
    verify: 'Verify',
    upload: 'Upload',
    monitor: 'Monitor',
    verifyTip: 'Compile',
    uploadTip: 'Compile and Upload',
    install: 'Install',
    update: 'Update',
    uninstall: 'Uninstall',
    installed: 'Installed',
    uninstallTip: 'Uninstall this board package',
    unverifiedBadge: 'unverified',
    unverifiedTip: 'Some details have not been verified against a primary source',
    sourceTip: 'From registry',
    searchPlaceholder: 'Search boards and tools',
    refreshList: 'Refresh Package Index',
    output: 'Show Output',
    recommended: 'Recommended',
    installedGroup: 'Installed',
    available: 'Available',
    comingSoon: 'Coming Soon',
    registries: 'Registries',
    builtIn: 'Built-in',
    noMatches: 'No matching packages.',
    noRecommendations: 'No recommendations for this workspace.',
    browseHint: 'Search to browse all available packages.',
    needEngineToBrowse: 'Install the build engine to browse all board packages.',
    errorSingular: 'error',
    errorPlural: 'errors',
    moreInProblems: 'more in the Problems panel',
    addRegistry: 'Add Registry...',
    configure: 'Configure',
    documentation: 'Documentation',
  },
};
