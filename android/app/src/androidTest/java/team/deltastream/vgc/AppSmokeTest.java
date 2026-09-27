package team.deltastream.vgc;

import static org.junit.Assert.*;

import android.Manifest;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.SystemClock;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class AppSmokeTest {
    private String evaluate(MainActivity activity, String script) throws Exception {
        AtomicReference<String> value = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
            activity.getBridge().getWebView().evaluateJavascript(script, result -> {
                value.set(result);
                done.countDown();
            })
        );
        assertTrue("WebView evaluation timed out", done.await(10, TimeUnit.SECONDS));
        return value.get();
    }

    private void awaitTrue(MainActivity activity, String script) throws Exception {
        long end = SystemClock.uptimeMillis() + 30000;
        while (SystemClock.uptimeMillis() < end) {
            if ("true".equals(evaluate(activity, script))) return;
            SystemClock.sleep(100);
        }
        fail("WebView condition did not become true: " + script);
    }

    @Test
    public void offlineManifestAndNativeBridgeAreUsable() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("team.deltastream.vgc", context.getPackageName());
        assertEquals(0, context.getApplicationInfo().flags & ApplicationInfo.FLAG_ALLOW_BACKUP);
        String[] permissions = context.getPackageManager().getPackageInfo(context.getPackageName(), PackageManager.GET_PERMISSIONS).requestedPermissions;
        assertFalse(permissions != null && Arrays.asList(permissions).contains(Manifest.permission.INTERNET));
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<MainActivity> reference = new AtomicReference<>();
            scenario.onActivity(activity -> {
                reference.set(activity);
                assertNotNull("NativePrint must be registered before the bridge is created", activity.getBridge().getPlugin("NativePrint"));
            });
            MainActivity activity = reference.get();
            awaitTrue(activity, "document.querySelectorAll('[data-tab]').length === 4");
            evaluate(activity, "document.querySelector('[data-tab=teams]').click()");
            awaitTrue(activity, "document.querySelector('#team-form textarea') !== null");
            evaluate(activity, "window.printRejected = false; window.Capacitor.nativePromise('NativePrint', 'print', {html: ''}).catch(() => window.printRejected = true)");
            awaitTrue(activity, "window.printRejected === true");
        }
    }
}
