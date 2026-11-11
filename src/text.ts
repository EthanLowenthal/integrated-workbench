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
  selectBoard: 'Select Board...',
  noBoardsPlugged: 'No boards connected',
  notifications: 'Notifications',
  notificationsBadge: (n: number) => `${n} item${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} attention`,
  dismiss: 'Dismiss',
  engineMissing: 'Build engine not installed.',
  serialEngineDetail:
    'MicroPython projects talk to the board through the Serial Monitor Engine (serial-monitor). About 2 MB, installed once. Python is not needed.',
  deleteFromBoard: (path: string) => `Delete ${path} from the board?`,
  deleteFromBoardDetail: 'The file is removed from the board. This cannot be undone.',
  delete: 'Delete',
  cancelled: 'Cancelled.',
  bootselNotice: 'Raspberry Pi board in BOOTSEL mode.',
  bootselNoticeDetail:
    'The board is waiting for firmware. Install MicroPython to use it with MicroPython projects.',
  notMicroPythonNotice: 'The board did not answer as a MicroPython board.',
  notMicroPythonDetail:
    'It may run other firmware (for example an Arduino sketch) or be busy. Installing MicroPython replaces what is on it.',
  installMicroPython: 'Install MicroPython...',
  firmware: {
    pickTitle: 'Install MicroPython on Board',
    pickPlaceholder: 'Select the board',
    connectedSection: 'Connected in BOOTSEL mode',
    viaUf2: 'Copied to the board in BOOTSEL mode.',
    viaEsptool: 'Written over the selected port with esptool.',
    install: 'Install',
    eraseAndInstall: 'Erase and Install',
    confirmUf2: (name: string, version: string) => `Install ${name} ${version}?`,
    confirmUf2Detail:
      'Hold BOOTSEL on the board while connecting it, if it is not already in BOOTSEL mode. The program on the board is replaced; files saved by MicroPython are usually kept.',
    confirmEsptool: (name: string, version: string, port: string) => `Install ${name} ${version} on ${port}?`,
    confirmEsptoolDetail:
      'This erases the board, including any program and saved files, then writes MicroPython. It cannot be undone.',
    downloadsEsptool: (size: string) => `esptool (${size}) is downloaded once first.`,
    title: (version: string) => `Installing MicroPython ${version}`,
    downloading: (what: string) => `Downloading ${what}`,
    waitingForBootsel: 'Waiting for a board in BOOTSEL mode',
    bootselHelp:
      'Hold the BOOTSEL button while connecting the board, then release it. The board appears as a drive named RPI-RP2 or RP2350.',
    noBootselDrive: 'No board in BOOTSEL mode was found within 60 s.',
    wrongChip: (name: string, board: string) => `${name} does not fit the connected board (${board}).`,
    copying: (where: string) => `Copying firmware to ${where}`,
    restarting: 'Waiting for the board to restart',
    onPort: (port: string) => `MicroPython is running on ${port}.`,
    installed: (version: string, port: string) => `MicroPython ${version} installed on ${port}`,
    installedNoPort: (version: string) =>
      `MicroPython ${version} installed. Reconnect the board if its port does not appear.`,
    failed: 'MicroPython installation failed',
    noEsptool: 'No registry provides esptool.',
    esptoolInstallFailed: 'Could not install esptool. See the Integrated Workbench output.',
    esptoolFailed: 'esptool failed.',
    timedOut: 'esptool stopped at its time limit.',
    erasing: (port: string) => `Erasing the board on ${port}`,
    writing: (port: string) => `Writing MicroPython to ${port}`,
  },
  micropythonUi: {
    run: 'Run',
    runTip: 'Run the open .py file (or main.py) on the board without saving it there',
    stop: 'Stop',
    uploadTip: 'Copy changed files to the board, then restart it to run main.py',
    repl: 'REPL',
    replTip: 'Open the Serial Monitor (MicroPython REPL)',
    board: 'Board',
    filesOnBoard: 'Files on Board',
    list: 'List Files',
    listTip: 'Stops the running program to read the board',
    refresh: 'Refresh',
    noFiles: 'No files on the board.',
    open: 'Open a read-only copy',
    deleteTip: 'Delete from the board',
  },
  engineMissingDetail:
    'The build engine (arduino-cli) compiles and uploads sketches and manages board packages. About 17 MB, installed once.',
  boardPackageMissing: 'Board package not installed.',
  boardPackageMissingDetail: (board: string) => `${board} needs its board package to compile and upload.`,
  registryErrors: (name: string, n: number) => `Registry "${name}" has ${n} error${n === 1 ? '' : 's'}.`,
  packageUpdates: (n: number) => `${n} board package or tool update${n === 1 ? '' : 's'} available.`,
  libraryUpdates: (n: number) => `${n} library update${n === 1 ? '' : 's'} available.`,
  librariesRequired: (n: number) =>
    `${n} librar${n === 1 ? 'y' : 'ies'} used by this sketch ${n === 1 ? 'is' : 'are'} not installed.`,
  install: 'Install',
  view: 'View',
  detectBoard: 'Detect Board...',
  detectWaiting: 'Connect your board now',
  detectWaitingDetail:
    'Watching USB for a new device. Use a data cable, and plug it in directly if possible.',
  detectSecondsLeft: 's left',
  detectDone: 'Done',
  openMonitor: 'Open Serial Monitor',
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
  availableSection: 'Available to install',
  notInstalled: (pkg: string) => `Not installed · ${pkg}`,
  installsPackage: 'Selecting a board installs its board package first.',
  installingFor: (pkg: string) => `Installing ${pkg}`,
  listBoardsFailed: (err: string) => `Could not list boards: ${err}`,
  boardNotFoundAfterInstall: (board: string) =>
    `${board} was not found after installing. Select the board again.`,
  openTools: 'Install Board Packages...',

  // Boards and Tools
  downloading: 'Downloading',
  removing: 'Uninstalling',
  installingCore: (id: string) => `Installing ${id}`,
  coreInstallFailed: (id: string) =>
    `Failed to install ${id}. See the Integrated Workbench output for details.`,
  coreRemoveFailed: (id: string) =>
    `Failed to uninstall ${id}. See the Integrated Workbench output for details.`,
  needsEngineFirst: 'Installing this also installs the build engine.',
  notInIndex: 'Not found in the package index. Refresh to update.',
  noDownloadHere: 'Not available for this platform.',
  usingYourOwn: 'Using an existing arduino-cli installation.',
  trustRegistry: (pkg: string, registry: string) => `Install ${pkg} from "${registry}"?`,
  trustRegistryDetail: (spec: string) =>
    `This package comes from a third-party registry (${spec}). Registries can download and run programs on this computer. Install only from registries you trust. You will not be asked again for this registry.`,
  trustAndInstall: 'Trust and Install',
  addRegistryPrompt: 'Add Registry',
  addRegistryPlaceholder: 'owner/repo, owner/repo@branch, https://.../index.json, or a local folder path',
  registryHelpUrl: 'https://github.com/EthanLowenthal/integrated-workbench/blob/main/docs/REGISTRY.md',

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

  /** Why an upload failed (from the uploader's output), shown under the result. */
  uploadAdvice: {
    nanoOldBootloader:
      'The board did not answer the uploader. Most Nano clones, and Nanos made before 2018, use the old bootloader.',
    nanoNewBootloader: 'The board did not answer the uploader. This Nano may use the new bootloader.',
    useOption: (label: string) => `Use "${label}" and Upload`,
    notInSync:
      'The board did not answer the uploader. Check that the selected board matches the connected one, then try again; on some boards, press reset just as the upload starts.',
    espBootMode:
      'The ESP32 did not enter upload mode. Hold its BOOT button while the upload starts, then release it.',
    doubleReset:
      'No board answered on the port. Double-press the reset button, then upload again within a few seconds.',
    portBusy: 'The port is in use. Close other programs that use it, such as another serial monitor.',
    permission:
      'No permission to open the port. On Linux, add yourself to the dialout group and log in again.',
  },

  // MicroPython
  needSerialEngine: 'Serial Monitor Engine required. Install it from Boards and Tools.',
  noMainPy: 'No main.py in this project. Open the .py file to run.',
  running: (file: string, port: string) => `Running ${file} on ${port}`,
  runDone: (file: string) => `${file} finished`,
  runStopped: (file: string) => `${file} stopped`,
  runFailed: (file: string, message: string) => `${file}: ${message}`,
  filesUploaded: (n: number, port: string) => `Uploaded ${n} file${n === 1 ? '' : 's'} to ${port}`,
  noChanges: 'Board is up to date',
  syncSummary: (uploaded: number, unchanged: number) =>
    `${uploaded} uploaded, ${unchanged} unchanged. Nothing on the board was deleted.`,

  // Diagnostics actions
  copied: (cmd: string) => `Copied to clipboard: ${cmd}`,
  adminPrompt: (cmd: string) =>
    `"${cmd}" requires administrator privileges and will not be run automatically. Copy it and run it in an administrator terminal.`,
  adminCopy: 'Copy Command',

  newSketch: {
    title: 'New Sketch',
    prompt: 'Name of the new sketch. A folder with this name and a matching .ino file are created.',
    chooseFolder: 'Create Sketch Here',
    nameRequired: 'Enter a name.',
    nameTooLong: 'Use 63 characters or fewer.',
    nameInvalid: 'Use letters, digits, "_", "." and "-", starting with a letter, digit or "_".',
    exists: (name: string) => `A folder named "${name}" already exists.`,
  },

  settingsPage: {
    title: 'Sketch Settings',
    titleFor: (sketch: string) => `Sketch Settings: ${sketch}`,
    ui: {
      noSketch: 'Open a file in a sketch to edit its settings.',
      storedIn:
        'Board and board options are stored in the workspace settings (.vscode/settings.json). An existing sketch.yaml from Arduino IDE is used as the starting point and never changed. The port is stored on this computer only.',
      openYaml: 'Open Settings File',
      board: 'Board',
      boardDescription: 'The board this sketch is compiled and uploaded for.',
      selectBoard: 'Select Board...',
      changeBoard: 'Change...',
      noBoard: 'No board selected',
      boardPackageMissing: 'The board package for this board is not installed.',
      installPackage: 'Open Boards and Tools',
      engineMissing: 'The build engine is not installed.',
      options: 'Board Options',
      optionsDescription:
        'Settings for this board, such as flash size, CPU speed, or upload method. Only values that differ from the default are saved.',
      noOptions: 'This board has no options.',
      resetOptions: 'Reset to Defaults',
      defaultLabel: 'default',
      modified: 'Modified',
      port: 'Port',
      portDescription: 'The serial port used for uploading and the Serial Monitor.',
      noPorts: 'No boards connected',
      refresh: 'Refresh',
      disconnected: 'disconnected',
      monitor: 'Serial Monitor',
      baud: 'Baud Rate',
      baudDescription: 'Must match Serial.begin() in the sketch. Remembered per sketch.',
      lineEnding: 'Line Ending',
      lineEndingDescription: 'Appended to each message sent from the Serial Monitor.',
      intellisense: 'IntelliSense',
      intellisenseDescription:
        'Autocomplete, go to definition, and error squiggles for the selected board, its core, and installed libraries.',
      intellisenseStatus: {
        off: 'Waiting for a board and its board package.',
        needsExtension: 'Requires the C/C++ extension.',
        updating: 'Updating...',
        ready: 'Up to date.',
        error: 'Could not read the build settings.',
      },
      installCpp: 'Install C/C++ Extension',
      refreshIntellisense: 'Refresh',
      writeCompileCommands: 'Write compile_commands.json',
      clangdHint: 'Using clangd instead? Write a compile_commands.json into the sketch folder.',
    },
  },

  libraries: {
    installing: 'Installing',
    uninstalling: 'Uninstalling',
    installFailed: (name: string) =>
      `Failed to install ${name}. See the Integrated Workbench output for details.`,
    uninstallFailed: (name: string) =>
      `Failed to uninstall ${name}. See the Integrated Workbench output for details.`,
    /** Static strings for the Libraries webview. */
    ui: {
      searchPlaceholder: 'Search libraries',
      refresh: 'Refresh',
      required: 'Required by This Sketch',
      noLibraryFor: 'No library found that provides this header.',
      installed: 'Installed',
      noneInstalled: 'No libraries installed.',
      results: 'Search Results',
      noResults: 'No matching libraries.',
      engineMissing: 'Requires the build engine.',
      openTools: 'Open Boards and Tools',
      install: 'Install',
      update: 'Update',
      uninstall: 'Uninstall',
      by: 'by',
    },
  },

  /** Build panel (output of Verify and Upload). */
  build: {
    ui: {
      empty: 'No builds yet. Output from Verify and Upload appears here.',
      openLine: 'Go to this line',
      copy: 'Copy Output',
    },
  },

  /** IntelliSense (autocomplete and error squiggles in the editor). */
  intellisense: {
    needsExtension: 'IntelliSense requires the C/C++ extension.',
    needsClangd: 'IntelliSense requires clangd.',
    setUpClangd: 'Set Up clangd',
    install: 'Install',
    updating: 'Updating IntelliSense...',
    failed: 'IntelliSense could not read the build settings.',
    wrote: (file: string) => `Wrote ${file}`,
  },

  /** Serial Monitor (controller messages and the panel's static strings). */
  monitor: {
    noPort: 'No port selected. Connect a board and select its port in the Sketch view.',
    engineMissing: 'Serial Monitor Engine not installed.',
    pausedForUpload: 'Paused for upload',
    portBusy: 'The port is in use by another Run or Upload.',
    waitingForPort: 'Waiting for the port to reconnect...',
    portGone: (port: string) => `${port} did not reconnect.`,
    logFiles: 'Log files',
    /** Plain strings for the webview. */
    ui: {
      connect: 'Connect',
      disconnect: 'Disconnect',
      install: 'Install',
      engineMissing: 'Serial Monitor Engine not installed.',
      baud: 'Baud rate',
      lineEnding: 'Line ending',
      endings: {
        none: 'No line ending',
        lf: 'New line (LF)',
        cr: 'Carriage return (CR)',
        crlf: 'Both (CRLF)',
      },
      timestamps: 'Timestamps',
      hex: 'Hex',
      autoscroll: 'Autoscroll',
      filter: 'Filter',
      clear: 'Clear Output',
      interrupt: 'Interrupt (Ctrl-C)',
      softReset: 'Soft Reset (Ctrl-D)',
      save: 'Save Output...',
      monitorTab: 'Monitor',
      plotTab: 'Plot',
      pausePlot: 'Pause',
      resumePlot: 'Resume',
      sendPlaceholder: 'Message (Enter to send, Up/Down for history)',
      send: 'Send',
      status: {
        idle: 'Not connected',
        connecting: 'Connecting',
        connected: 'Connected',
        paused: 'Paused',
        reconnecting: 'Reconnecting',
        error: 'Not connected',
      },
      noPort: 'No port',
      plotEmpty:
        'Numeric values in the output are plotted here, for example "temp=21.5 humidity=40" or "21.5,40".',
      linesTrimmed: 'Older lines removed',
    },
  },

  /** Static strings rendered inside the sidebar webviews (sent with each state update). */
  webview: {
    board: 'Board',
    port: 'Port',
    disconnected: 'disconnected',
    flash: 'Flash',
    flashTip: 'Program storage used',
    ram: 'RAM',
    ramTip: 'RAM used by global variables',
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
    sourceTip: 'From registry',
    searchPlaceholder: 'Search boards and tools',
    refreshList: 'Refresh Package Index',
    output: 'Show Output',
    recommended: 'Recommended',
    installedGroup: 'Installed',
    available: 'Available',
    registries: 'Registries',
    builtIn: 'Built-in',
    noMatches: 'No matching packages.',
    noRecommendations: 'No recommendations for this workspace.',
    searchToBrowse: 'Search to see all packages.',
    errorSingular: 'error',
    errorPlural: 'errors',
    moreInProblems: 'more in the Problems panel',
    settings: 'Settings',
    sketchSettings: 'Sketch Settings...',
    extensionSettings: 'Extension Settings...',
    addRegistry: 'Add Registry...',
    configure: 'Configure...',
    documentation: 'Documentation',
  },
};
