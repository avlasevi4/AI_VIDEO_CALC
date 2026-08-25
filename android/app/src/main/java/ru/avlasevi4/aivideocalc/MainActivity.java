package ru.avlasevi4.aivideocalc;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.window.OnBackInvokedDispatcher;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.util.Collections;
import java.util.Set;

public class MainActivity extends Activity {
    private static final String APP_URL = "https://avlasevi4.github.io/AI_VIDEO_CALC/";
    private static final String APP_HOST = "avlasevi4.github.io";
    private static final int FILE_CHOOSER_REQUEST = 401;
    private static final Set<String> INTERNAL_HOSTS = Collections.singleton(APP_HOST);

    private WebView webView;
    private ProgressBar pageProgress;
    private View offlinePanel;
    private TextView connectionStatus;
    private ValueCallback<Uri[]> fileChooserCallback;
    private ConnectivityManager.NetworkCallback networkCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.web_view);
        pageProgress = findViewById(R.id.page_progress);
        offlinePanel = findViewById(R.id.offline_panel);
        connectionStatus = findViewById(R.id.connection_status);

        configureWebView();
        bindControls();
        registerBackHandler();
        observeConnectivity();

        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            loadApp(APP_URL);
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUserAgentString(settings.getUserAgentString() + " AIVideoCalcAndroid/1.0");
        settings.setSafeBrowsingEnabled(true);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);

        webView.setWebViewClient(new SecureWebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int progress) {
                pageProgress.setProgress(progress);
                pageProgress.setVisibility(progress < 100 ? View.VISIBLE : View.GONE);
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/json");
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (ActivityNotFoundException error) {
                    fileChooserCallback = null;
                    Toast.makeText(MainActivity.this, R.string.file_picker_unavailable, Toast.LENGTH_LONG).show();
                }
                return true;
            }
        });
    }

    private void bindControls() {
        findViewById(R.id.nav_calculator).setOnClickListener(view -> navigateTo("#calculatorDetails"));
        findViewById(R.id.nav_projects).setOnClickListener(view -> navigateTo("#projects"));
        findViewById(R.id.nav_refresh).setOnClickListener(view -> webView.reload());
        findViewById(R.id.nav_back).setOnClickListener(view -> handleBackNavigation());
        findViewById(R.id.toolbar_refresh).setOnClickListener(view -> webView.reload());
        findViewById(R.id.retry_button).setOnClickListener(view -> loadApp(APP_URL));
        findViewById(R.id.open_network_settings).setOnClickListener(view -> {
            try {
                startActivity(new Intent(Settings.ACTION_WIRELESS_SETTINGS));
            } catch (ActivityNotFoundException ignored) {
                startActivity(new Intent(Settings.ACTION_SETTINGS));
            }
        });
    }

    private void navigateTo(String anchor) {
        hideOffline();
        String current = webView.getUrl();
        if (current != null && current.startsWith(APP_URL)) {
            webView.evaluateJavascript("location.hash='" + anchor.substring(1) + "'", null);
        } else {
            loadApp(APP_URL + anchor);
        }
    }

    private void loadApp(String url) {
        if (!isOnline()) {
            showOffline();
            return;
        }
        hideOffline();
        webView.loadUrl(url);
    }

    private void registerBackHandler() {
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                    this::handleBackNavigation
            );
        }
    }

    private void handleBackNavigation() {
        if (webView.canGoBack()) webView.goBack();
        else finishAfterTransition();
    }

    private boolean isOnline() {
        ConnectivityManager manager = getSystemService(ConnectivityManager.class);
        Network network = manager.getActiveNetwork();
        NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
        return capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private void observeConnectivity() {
        ConnectivityManager manager = getSystemService(ConnectivityManager.class);
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                runOnUiThread(() -> {
                    connectionStatus.setText(R.string.status_online);
                    if (offlinePanel.getVisibility() == View.VISIBLE) loadApp(APP_URL);
                });
            }

            @Override
            public void onLost(Network network) {
                runOnUiThread(() -> connectionStatus.setText(R.string.status_offline));
            }
        };
        manager.registerDefaultNetworkCallback(networkCallback);
        connectionStatus.setText(isOnline() ? R.string.status_online : R.string.status_offline);
    }

    private void showOffline() {
        connectionStatus.setText(R.string.status_offline);
        offlinePanel.setVisibility(View.VISIBLE);
    }

    private void hideOffline() {
        offlinePanel.setVisibility(View.GONE);
    }

    private void openExternal(Uri uri) {
        if (!"https".equalsIgnoreCase(uri.getScheme())) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, R.string.browser_unavailable, Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST || fileChooserCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null && data.getData() != null) {
            result = new Uri[]{data.getData()};
        }
        fileChooserCallback.onReceiveValue(result);
        fileChooserCallback = null;
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @SuppressLint("GestureBackNavigation")
    @Override
    public void onBackPressed() {
        handleBackNavigation();
    }

    @Override
    protected void onDestroy() {
        ConnectivityManager manager = getSystemService(ConnectivityManager.class);
        if (networkCallback != null) manager.unregisterNetworkCallback(networkCallback);
        if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
        if (webView != null) {
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
        }
        super.onDestroy();
    }

    private final class SecureWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            boolean internal = "https".equalsIgnoreCase(uri.getScheme()) && INTERNAL_HOSTS.contains(uri.getHost());
            if (internal) return false;
            openExternal(uri);
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            hideOffline();
            connectionStatus.setText(R.string.status_loading);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            connectionStatus.setText(isOnline() ? R.string.status_synced : R.string.status_offline);
            view.evaluateJavascript("document.documentElement.classList.add('android-app')", null);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) showOffline();
        }

    }
}
