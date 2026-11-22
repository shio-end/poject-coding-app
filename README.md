# Mobile Code Workbench

An offline Android code editor with a touch-first workspace, built with Android WebView and CodeMirror. Requires Android 8.0 or later and a current Android System WebView.

- Edit several files in tabs with syntax highlighting, line numbers, bracket matching, undo/redo, and word suggestions.
- Create, rename, and delete files. Paths such as `src/main.js` group files by directory in exported ZIPs.
- Find and replace in a file or search for matching lines across the project.
- Import UTF-8 text or a project ZIP through Android's file picker. Imports skip duplicate paths and accept up to 2 MiB of input after decompression. Export any open file or the entire project.
- Run an HTML entry point with local HTML, CSS and JavaScript. Open Console to inspect JavaScript logs and errors.
- The workspace is saved on the device. Export a ZIP before clearing app data.

The preview runs offline. Native terminals, Git operations, language servers, desktop extensions, and native language runtimes are outside this version. Suggestions use words from the current file.

## Build and install

Run **Build Android APK** in GitHub Actions. Download **Mobile-Code-Workbench-APK** from the run's artifacts, extract it, and install `app-debug.apk` on Android. This build is debug-signed for testing.

For a local build, install JDK 17, Gradle 8.11.1, Android SDK Platform 35 and Android Build Tools 35.0.0. Then run `gradle :app:assembleDebug`.

The bundled CodeMirror 5 assets are distributed under the license in `app/src/main/assets/vendor/LICENSE`.
