package com.shioend.mobileworkbench;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.webkit.ConsoleMessage;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URLConnection;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Locale;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

public final class MainActivity extends Activity {
    private static final String EDITOR_HOST = "workbench.local";
    private static final String PREVIEW_HOST = "preview.workbench.local";
    private static final int OPEN_FILE = 1;
    private static final int SAVE_FILE = 2;
    private static final int LIMIT = 2 * 1024 * 1024;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private FrameLayout root;
    private WebView editor;
    private WebView preview;
    private LinearLayout previewPanel;
    private PendingExport pendingExport;

    private static final class PendingExport {
        final String text;
        final boolean zip;

        PendingExport(String text, boolean zip) {
            this.text = text;
            this.zip = zip;
        }
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(21, 27, 34));
        getWindow().setNavigationBarColor(Color.rgb(21, 27, 34));
        root = new FrameLayout(this);
        setContentView(root);
        editor = newWebView();
        editor.getSettings().setDomStorageEnabled(true);
        editor.addJavascriptInterface(new Bridge(), "AndroidBridge");
        editor.setWebViewClient(new LocalClient(EDITOR_HOST) {
            @Override WebResourceResponse response(String path) throws IOException {
                return new WebResourceResponse(mime(path), "UTF-8", getAssets().open(path));
            }
        });
        editor.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                    .setPositiveButton("Delete", (dialog, which) -> result.confirm())
                    .setNegativeButton("Cancel", (dialog, which) -> result.cancel())
                    .setOnCancelListener(dialog -> result.cancel()).show();
                return true;
            }
        });
        root.addView(editor);
        editor.loadUrl("https://" + EDITOR_HOST + "/index.html");
    }

    private WebView newWebView() {
        WebView view = new WebView(this);
        view.getSettings().setJavaScriptEnabled(true);
        view.getSettings().setAllowFileAccess(false);
        view.getSettings().setAllowContentAccess(false);
        view.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);
        return view;
    }

    private abstract static class LocalClient extends WebViewClient {
        private final String host;

        LocalClient(String host) { this.host = host; }

        private boolean local(Uri uri) {
            return "https".equals(uri.getScheme()) && host.equals(uri.getHost()) && uri.getPort() == -1;
        }

        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return !local(request.getUrl());
        }

        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String path = uri.getPath();
            if (local(uri) && "GET".equals(request.getMethod()) && path != null && path.startsWith("/") && validPath(path.substring(1))) {
                try { return response(path.substring(1)); }
                catch (IOException ignored) { }
            }
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(),
                new ByteArrayInputStream(new byte[0]));
        }

        abstract WebResourceResponse response(String path) throws IOException;
    }

    private final class Bridge {
        @android.webkit.JavascriptInterface public void pickFile() {
            runOnUiThread(() -> launchPicker(new Intent(Intent.ACTION_OPEN_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE).setType("*/*"), OPEN_FILE));
        }

        @android.webkit.JavascriptInterface public void exportFile(String name, String text) {
            runOnUiThread(() -> export(name, "text/plain", new PendingExport(text, false)));
        }

        @android.webkit.JavascriptInterface public void exportProject(String files) {
            runOnUiThread(() -> export("workbench-project.zip", "application/zip", new PendingExport(files, true)));
        }

        @android.webkit.JavascriptInterface public void preview(String entry, String files) {
            runOnUiThread(() -> openPreview(entry, files));
        }
    }

    private void export(String name, String mime, PendingExport request) {
        pendingExport = request;
        launchPicker(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType(mime).putExtra(Intent.EXTRA_TITLE, name), SAVE_FILE);
    }

    private void launchPicker(Intent intent, int request) {
        try { startActivityForResult(intent, request); }
        catch (android.content.ActivityNotFoundException e) {
            pendingExport = null;
            showStatus("Android file picker unavailable");
        }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        PendingExport export = pendingExport;
        if (request == SAVE_FILE) pendingExport = null;
        if (result != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        if (request == OPEN_FILE) io.execute(() -> importFiles(uri));
        if (request == SAVE_FILE && export != null) io.execute(() -> writeExport(uri, export));
    }

    private void importFiles(Uri uri) {
        try (InputStream raw = getContentResolver().openInputStream(uri)) {
            if (raw == null) throw new IOException("Cannot open file");
            String name = documentName(uri);
            JSONObject files = new JSONObject();
            if (name.toLowerCase(Locale.ROOT).endsWith(".zip")) {
                try (ZipInputStream zip = new ZipInputStream(raw)) {
                    int entries = 0;
                    int remaining = LIMIT;
                    for (ZipEntry entry; (entry = zip.getNextEntry()) != null;) {
                        if (++entries > 300) throw new IOException("ZIP has more than 300 entries");
                        byte[] bytes = readBounded(zip, remaining);
                        remaining -= bytes.length;
                        if (!entry.isDirectory() && validPath(entry.getName())) {
                            try { files.put(entry.getName(), decodeText(bytes)); }
                            catch (CharacterCodingException ignored) { }
                        }
                    }
                }
            } else {
                if (!validPath(name)) throw new IOException("Unsupported file name");
                files.put(name, decodeText(readBounded(raw, LIMIT)));
            }
            runOnUiThread(() -> {
                if (!isDestroyed()) editor.evaluateJavascript("window.importProjectFiles(JSON.parse(" + JSONObject.quote(files.toString()) + "))", null);
            });
        } catch (Exception e) {
            showStatus("Import failed. Use UTF-8 text or a ZIP up to 2 MB uncompressed.");
        }
    }

    private String documentName(Uri uri) {
        try (android.database.Cursor cursor = getContentResolver().query(uri,
            new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst() && cursor.getString(0) != null) return cursor.getString(0);
        }
        return "imported.txt";
    }

    private void writeExport(Uri uri, PendingExport export) {
        try (OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
            if (output == null) throw new IOException("Cannot open destination");
            if (export.zip) {
                JSONObject files = new JSONObject(export.text);
                try (ZipOutputStream zip = new ZipOutputStream(output)) {
                    Iterator<String> paths = files.keys();
                    while (paths.hasNext()) {
                        String path = paths.next();
                        if (!validPath(path)) throw new IOException("Invalid file path");
                        zip.putNextEntry(new ZipEntry(path));
                        zip.write(files.getString(path).getBytes(StandardCharsets.UTF_8));
                        zip.closeEntry();
                    }
                }
            } else {
                output.write(export.text.getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception e) {
            showStatus("Export failed. Choose a writable destination and retry.");
            return;
        }
        showStatus("Export complete");
    }

    private static byte[] readBounded(InputStream input, int maxBytes) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        for (int count; (count = input.read(buffer)) != -1;) {
            if (count > maxBytes - bytes.size()) throw new IOException("Import exceeds size limit");
            bytes.write(buffer, 0, count);
        }
        return bytes.toByteArray();
    }

    private static String decodeText(byte[] bytes) throws CharacterCodingException {
        String text = StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)).toString();
        if (text.indexOf(0) >= 0) throw new CharacterCodingException();
        return text.startsWith("\uFEFF") ? text.substring(1) : text;
    }

    private static boolean validPath(String path) {
        if (path.isEmpty() || path.length() > 240) return false;
        for (String part : path.split("/", -1)) {
            if (part.isEmpty() || ".".equals(part) || "..".equals(part)) return false;
            for (int index = 0; index < part.length(); index++) {
                char value = part.charAt(index);
                if (value < 32 || "\\<>:\"|?*%#&".indexOf(value) >= 0) return false;
            }
        }
        return true;
    }

    private static String mime(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "text/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        String guessed = URLConnection.guessContentTypeFromName(lower);
        return guessed == null ? "text/plain" : guessed;
    }

    private void showStatus(String message) {
        runOnUiThread(() -> {
            if (!isDestroyed()) editor.evaluateJavascript("window.nativeStatus(" + JSONObject.quote(message) + ")", null);
        });
    }

    private void openPreview(String entry, String json) {
        if (preview != null || !validPath(entry)) return;
        JSONObject files;
        try { files = new JSONObject(json); }
        catch (org.json.JSONException error) { return; }
        if (!files.has(entry)) return;

        previewPanel = new LinearLayout(this);
        previewPanel.setOrientation(LinearLayout.VERTICAL);
        previewPanel.setBackgroundColor(Color.rgb(21, 27, 34));
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        Button close = new Button(this);
        close.setText("Back to editor");
        close.setOnClickListener(view -> closePreview());
        toolbar.addView(close);
        Button toggle = new Button(this);
        toggle.setText("Console");
        toolbar.addView(toggle);
        previewPanel.addView(toolbar);

        preview = newWebView();
        previewPanel.addView(preview, new LinearLayout.LayoutParams(-1, 0, 1));
        ScrollView consoleScroll = new ScrollView(this);
        TextView log = new TextView(this);
        log.setTextColor(Color.WHITE);
        log.setTypeface(android.graphics.Typeface.MONOSPACE);
        log.setPadding(12, 8, 12, 8);
        log.setText("JavaScript console\n");
        consoleScroll.addView(log);
        consoleScroll.setVisibility(View.GONE);
        previewPanel.addView(consoleScroll, new LinearLayout.LayoutParams(-1,
            Math.round(150 * getResources().getDisplayMetrics().density)));
        toggle.setOnClickListener(view -> consoleScroll.setVisibility(
            consoleScroll.getVisibility() == View.VISIBLE ? View.GONE : View.VISIBLE));
        preview.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage message) {
                String text = log.getText() + message.messageLevel().name() + " " +
                    message.lineNumber() + "  " + TextUtils.ellipsize(message.message(), log.getPaint(), 2000,
                        TextUtils.TruncateAt.END) + "\n";
                log.setText(text.substring(Math.max(0, text.length() - 16000)));
                consoleScroll.post(() -> consoleScroll.fullScroll(View.FOCUS_DOWN));
                return true;
            }
        });
        preview.setWebViewClient(new LocalClient(PREVIEW_HOST) {
            @Override WebResourceResponse response(String path) throws IOException {
                if (path.isEmpty() || !files.has(path)) throw new IOException("Missing project file");
                return new WebResourceResponse(mime(path), "UTF-8", 200, "OK", Collections.singletonMap(
                    "Content-Security-Policy", "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; form-action 'none'; frame-src 'none'"),
                    new ByteArrayInputStream(files.optString(path).getBytes(StandardCharsets.UTF_8)));
            }
        });
        ((android.view.inputmethod.InputMethodManager) getSystemService(INPUT_METHOD_SERVICE))
            .hideSoftInputFromWindow(editor.getWindowToken(), 0);
        editor.setVisibility(View.GONE);
        root.addView(previewPanel);
        preview.loadUrl("https://" + PREVIEW_HOST + "/" + Uri.encode(entry, "/"));
    }

    private void closePreview() {
        if (preview == null) return;
        root.removeView(previewPanel);
        previewPanel.removeView(preview);
        preview.destroy();
        previewPanel = null;
        preview = null;
        editor.setVisibility(View.VISIBLE);
    }

    @Override public void onBackPressed() {
        if (preview != null) closePreview();
        else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        closePreview();
        io.shutdown();
        root.removeView(editor);
        editor.destroy();
        super.onDestroy();
    }
}
