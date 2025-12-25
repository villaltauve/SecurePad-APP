# SecurePad

SecurePad is a Windows 11 desktop application built with Electron, React, and Tailwind CSS. It delivers a modern Notepad-like experience with a Windows 11-inspired dark theme and a lock screen that protects editor content.

## Features

- Authentication lock screen with error animation and glass (mica) effect inspired by Windows 11.
- Local user system: register and sign in with encrypted credentials and per-machine unique usernames.
- Full-screen text editor with custom title, lock button, and status bar showing the current line and column.
- Responsive layout styled with Segoe UI and a Windows 11-inspired dark palette.
- Ready-to-ship packaging configuration using `electron-builder`.
- Centered action strip and application menu for `New`, `Open`, `Save`, and `Save As`, plus keyboard shortcuts (`Ctrl+N`, `Ctrl+O`, `Ctrl+S`, `Ctrl+Shift+S`).
- Open and save `.txt` files (or any extension) through native dialogs, including confirmation when unsaved changes exist.
- Word counter with progress bar toward a configurable daily goal (700 words by default).
- Daily 700-word streak tracker with visual feedback and historical record.
- Encrypted saves (AES-256-GCM) tied to user credentials: documents are unreadable outside SecurePad and decrypt automatically when reopened through the app.
- In-app document renaming and silent auto-save into `Documents/SecurePad` when a file path does not yet exist.

## Requirements

- Node.js 20 or later (LTS recommended).
- npm 10 or later.

## Core commands

- `npm install`: install dependencies.
- `npm run dev`: launch Vite and Electron in parallel (renderer on `http://localhost:5173`).
- `npm run lint`: run ESLint.
- `npm run typecheck`: validate types with TypeScript.
- `npm run build`: generate the static renderer bundle (`dist`).
- `npm run build:app`: package the desktop application with electron-builder.

## Authentication and encryption

- Accounts persist in `securepad-users.dat`, encrypted with AES-256-GCM inside the `userData` folder. Set `SECUREPAD_USER_SECRET` to customize the master key (recommended for production).
- Each document is stored with a `SECUREPAD::` header followed by an AES-256-GCM payload. The encryption key is derived from the active session credentials (username + password).
- Opening a plain `.txt` file loads it normally; saving re-encrypts and secures the file automatically.
- Documents without an existing path are auto-saved silently to `Documents/SecurePad/<name>.txt` after you assign a name inside the app.

## Relevant structure

- `src/`: React (renderer) code.
  - `App.tsx`: lock screen, editor, and status bar.
  - `index.css`: base styles and Tailwind setup.
- `electron/`: Electron main-process files.
  - `main.js`: creates the mica window and switches between dev/prod.
  - `preload.js`: exposes secure APIs to the renderer.
