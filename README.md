# HexFlow

<img src="icon/app-icon.png" alt="HexFlow cover and app artwork" width="168">

An offline Android code workspace for Android 8.0 and later, with a touch-first editor and Live Preview. Created by **ShioliEnterprise @shi-end**.

## Edit and preview

- Use the bottom bar to open Files, Search, and Problems. More contains Outline, Import & export, and Settings, where you can choose the light or dark theme.
- Choose **Code**, **Split**, or **Preview**. Pick the HTML entry page to render. In Split view, changes refresh the isolated preview after a short pause. The Console shows browser JavaScript logs and errors.
- Edit files in tabs with line numbers, syntax highlighting, matching brackets, suggestions based on words in the current file, project search, and find and replace.
- Open the command palette with **⌘** or **Ctrl+P**. It includes quick file opening, Go to Line, JSON formatting, project checking, and ZIP export. Outline lists recognized declarations and headings.
- Import UTF-8 files and project ZIPs from Android's file picker. Export individual files or an entire project. The workspace is saved locally.

## Run and check

| Format | Run | Check |
| --- | --- | --- |
| HTML plus local CSS and JavaScript | Live Preview | HTML lint, CSS parser, and JavaScript syntax |
| JavaScript and TypeScript | Standalone scripts with console output | JavaScript syntax and TypeScript syntax plus selected single-file type errors |
| Python | Skulpt runtime with supported Python 3 syntax and libraries | Skulpt syntax parser |
| SQL | An isolated in-memory SQLite database | Run to see SQLite errors and query output |
| JSON and YAML | Data files | Syntax and structure |

Standalone scripts run in an offline worker with a Stop control and a 12-second limit. Node packages, imports between standalone scripts, interactive stdin, CPython packages, system commands, and production web servers require other runtimes. The preview serves local project files and blocks network access. A successful check only covers the rules of the selected checker.

Other UTF-8 file types can be edited. There is syntax highlighting for several additional formats, including Go, Rust, Kotlin, Swift, Java, C and C++. Desktop VS Code extensions, Git, a native terminal, debugger, and arbitrary compiler runtimes are outside this release.

## Build

Download **HexFlow.apk** from GitHub Releases. Tagged builds publish a debug-signed APK for testing. Each hosted build can use a different debug key, so export your project ZIP before replacing an older build if Android requires uninstalling it first.

For a local build, use JDK 17, Gradle 8.11.1, Android SDK Platform 35, and Android Build Tools 35.0.0. Run `gradle :app:assembleDebug`.

CodeMirror's license is in `app/src/main/assets/vendor/LICENSE`. Other bundled licenses are under `app/src/main/assets/vendor/licenses`.
