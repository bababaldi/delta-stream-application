package team.deltastream.vgc;

import android.content.Context;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativePrint")
public class NativePrintPlugin extends Plugin {
    private WebView printView;

    @PluginMethod
    public void print(PluginCall call) {
        String html = call.getString("html");
        if (html == null || html.trim().isEmpty() || html.length() > 200000) {
            call.reject("Printable HTML must contain 1–200000 characters");
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (printView != null) {
                call.reject("A print job is already open");
                return;
            }
            PrintManager manager = (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
            if (manager == null) {
                call.reject("Printing is unavailable on this device");
                return;
            }
            printView = new WebView(getActivity());
            printView.getSettings().setJavaScriptEnabled(false);
            printView.getSettings().setAllowFileAccess(false);
            printView.getSettings().setAllowContentAccess(false);
            printView.getSettings().setBlockNetworkLoads(true);
            printView.setWebViewClient(new WebViewClient() {
                private boolean submitted;
                @Override
                public void onPageFinished(WebView view, String url) {
                    if (submitted) return;
                    submitted = true;
                    PrintDocumentAdapter delegate = view.createPrintDocumentAdapter("Delta Stream Team Sheet");
                    PrintDocumentAdapter adapter = new PrintDocumentAdapter() {
                        @Override
                        public void onStart() { delegate.onStart(); }
                        @Override
                        public void onLayout(PrintAttributes oldAttributes, PrintAttributes newAttributes,
                                CancellationSignal signal, LayoutResultCallback callback, Bundle extras) {
                            delegate.onLayout(oldAttributes, newAttributes, signal, callback, extras);
                        }
                        @Override
                        public void onWrite(PageRange[] pages, ParcelFileDescriptor destination,
                                CancellationSignal signal, WriteResultCallback callback) {
                            delegate.onWrite(pages, destination, signal, callback);
                        }
                        @Override
                        public void onFinish() {
                            try { delegate.onFinish(); } finally { releasePrintView(); }
                        }
                    };
                    try {
                        manager.print("Delta Stream Team Sheet", adapter, new PrintAttributes.Builder()
                                .setMediaSize(PrintAttributes.MediaSize.ISO_A4.asLandscape()).build());
                        call.resolve(new JSObject()); // Dialog opened, not a claim that a PDF was saved.
                    } catch (RuntimeException error) {
                        releasePrintView();
                        call.reject("Could not open the print dialog", error);
                    }
                }
            });
            printView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
        });
    }

    private void releasePrintView() {
        if (printView != null) {
            printView.destroy();
            printView = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        releasePrintView();
        super.handleOnDestroy();
    }
}
