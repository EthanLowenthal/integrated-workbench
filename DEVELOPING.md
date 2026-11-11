# Develop Integrated Workbench

This page describes how to build, test, and release the extension. For what the extension does,
see [README.md](README.md). For the registry format, see [docs/REGISTRY.md](docs/REGISTRY.md).

## Build and run

You need Node.js 20 or later.

1. Install the dependencies:

   ```sh
   npm install
   ```

1. In VS Code, open this folder and press F5. The **Run Integrated Workbench** launch
   configuration builds `dist/extension.js` and opens a window with the extension loaded.

To build a VSIX that you can install with **Extensions: Install from VSIX...**, run the following:

```sh
npm run package
```

## Test

The project has the following checks:

| Command                  | What it checks                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `npm test`               | Unit tests (Vitest), including parsers against output captured from real tools      |
| `npm run typecheck`      | TypeScript                                                                          |
| `npm run lint`           | ESLint, including the rules that keep `src/core` free of `vscode` and shell strings |
| `npm run registry:check` | The built-in registry against its schema                                            |
| `npm run test:e2e`       | The extension inside the installed VS Code, with a throwaway profile                |

CI runs the first four on Windows, macOS, and Linux for every push.

To include the real toolchain in the end-to-end test, point it at an `arduino-cli` and a data folder
that has `arduino:avr` installed:

```sh
E2E_CLI=/path/to/arduino-cli E2E_ARDUINO_DATA=/path/to/data npm run test:e2e
```

Test fixtures are in `test/fixtures/`. Files named `*.real.*` are captured from real tools and
boards; files named `*.synth.*` are written by hand. For where each one came from, see
[test/fixtures/README.md](test/fixtures/README.md).

## Update a pinned tool or firmware

Tools and firmware are listed in `workbench-registry/` with a version and a SHA-256 checksum for each
download. When you change a version, update the URL, checksum, and size together, then verify every
download:

```sh
npm run registry:check -- --downloads
```

CI also runs this check every Monday, so a download that changes or disappears is caught.

## Release

Releases are published by the Release workflow when a version tag is pushed.

1. In `package.json`, set `version`, and add a section for it at the top of `CHANGELOG.md`.
1. Commit, then tag the commit with the same version and push the tag:

   ```sh
   git tag v0.6.0
   git push origin v0.6.0
   ```

The workflow runs the checks, packages the VSIX, attaches it to a GitHub release, and publishes it
to the stores whose tokens are set as repository secrets:

- `VSCE_PAT`: an Azure DevOps personal access token with the Marketplace **Manage** scope, for
  the `ethml` publisher
- `OVSX_PAT`: an access token from open-vsx.org for the `ethml` namespace

A store without a token is skipped.
