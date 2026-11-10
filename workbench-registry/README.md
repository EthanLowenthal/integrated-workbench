# Built-in registry

The data Integrated Workbench ships with: tools it can download (`tools.json`), Arduino board packages (`arduino-cores.json`), USB IDs (`usb.json`), vendor driver pages (`drivers.json`) and project recipes (`recipes.json`). `index.json` ties them together; `schema.json` defines the format.

How to build your own registry, and how to contribute here: [docs/REGISTRY.md](../docs/REGISTRY.md). Check changes with `npm run registry:check -- --downloads`.
