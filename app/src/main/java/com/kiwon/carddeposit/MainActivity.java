package com.kiwon.carddeposit;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * 화면은 assets/index.html(WebView)이 그리고,
 * 이 액티비티는 문자함 읽기와 설정 저장만 담당합니다.
 */
public class MainActivity extends Activity {
    private static final int REQ_SMS = 1;
    private WebView web;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("carddeposit", MODE_PRIVATE);
        web = new WebView(this);
        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setTextZoom(100);
        web.setWebViewClient(new WebViewClient());
        web.addJavascriptInterface(new Bridge(), "Android");
        setContentView(web);
        web.loadUrl("file:///android_asset/index.html");
    }

    @Override
    protected void onResume() {
        super.onResume();
        // 앱으로 돌아올 때마다 새 문자를 다시 확인
        web.evaluateJavascript("window.onAppResume&&window.onAppResume()", null);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code == REQ_SMS) {
            boolean ok = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
            web.evaluateJavascript("window.onPermission&&window.onPermission(" + ok + ")", null);
        }
    }

    private static String digits(String s) {
        return s == null ? "" : s.replaceAll("[^0-9]", "");
    }

    private class Bridge {
        @JavascriptInterface
        public String load(String key) {
            return prefs.getString(key, "");
        }

        @JavascriptInterface
        public void save(String key, String value) {
            prefs.edit().putString(key, value).apply();
        }

        @JavascriptInterface
        public boolean hasPermission() {
            return checkSelfPermission(Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED;
        }

        @JavascriptInterface
        public void requestPermission() {
            runOnUiThread(() -> requestPermissions(new String[]{Manifest.permission.READ_SMS}, REQ_SMS));
        }

        @JavascriptInterface
        public void openAppSettings() {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        }

        /**
         * 최근 days일 동안 sender 번호에서 온 문자(SMS + 장문 MMS)를 JSON 배열로 돌려줍니다.
         * [{ "date": 밀리초, "body": "..." }, ...]  실패 시 {"error": "..."}
         */
        @JavascriptInterface
        public String readSms(String sender, int days) {
            try {
                String want = digits(sender);
                long since = System.currentTimeMillis() - days * 86400000L;
                JSONArray out = new JSONArray();
                ContentResolver cr = getContentResolver();

                // 1) 일반 SMS
                try (Cursor c = cr.query(Uri.parse("content://sms/inbox"),
                        new String[]{"address", "date", "body"},
                        "date>=?", new String[]{String.valueOf(since)}, "date ASC")) {
                    while (c != null && c.moveToNext()) {
                        String body = c.getString(2);
                        if (matches(want, c.getString(0), body)) add(out, c.getLong(1), body);
                    }
                }

                // 2) 장문 문자(LMS)는 MMS 저장소에 들어 있음. MMS의 date는 초 단위.
                try (Cursor c = cr.query(Uri.parse("content://mms/inbox"),
                        new String[]{"_id", "date"},
                        "date>=?", new String[]{String.valueOf(since / 1000)}, "date ASC")) {
                    while (c != null && c.moveToNext()) {
                        long id = c.getLong(0);
                        String body = mmsText(cr, id);
                        if (body.isEmpty()) continue;
                        if (matches(want, mmsFrom(cr, id), body)) add(out, c.getLong(1) * 1000L, body);
                    }
                }
                return out.toString();
            } catch (Exception e) {
                try {
                    return new JSONObject().put("error", String.valueOf(e)).toString();
                } catch (Exception e2) {
                    return "{\"error\":\"unknown\"}";
                }
            }
        }

        // 발신번호가 일치하거나(기본), 번호를 못 읽은 경우 본문이 리포트 형식이면 포함
        private boolean matches(String want, String address, String body) {
            String from = digits(address);
            if (!want.isEmpty() && !from.isEmpty() && (from.endsWith(want) || want.endsWith(from))) return true;
            return from.isEmpty() && body != null && body.contains("집계일");
        }

        private void add(JSONArray out, long date, String body) throws Exception {
            out.put(new JSONObject().put("date", date).put("body", body == null ? "" : body));
        }

        private String mmsFrom(ContentResolver cr, long id) {
            // type 137 = 보낸 사람
            try (Cursor c = cr.query(Uri.parse("content://mms/" + id + "/addr"),
                    new String[]{"address", "type"}, null, null, null)) {
                while (c != null && c.moveToNext()) {
                    if (c.getInt(1) == 137) return c.getString(0);
                }
            } catch (Exception ignored) {
            }
            return "";
        }

        private String mmsText(ContentResolver cr, long id) {
            StringBuilder sb = new StringBuilder();
            try (Cursor c = cr.query(Uri.parse("content://mms/part"),
                    new String[]{"_id", "ct", "_data", "text"},
                    "mid=?", new String[]{String.valueOf(id)}, null)) {
                while (c != null && c.moveToNext()) {
                    if (!"text/plain".equals(c.getString(1))) continue;
                    String text;
                    if (c.getString(2) != null) {
                        text = readPart(cr, c.getLong(0));
                    } else {
                        text = c.getString(3);
                    }
                    if (text != null) sb.append(text).append('\n');
                }
            } catch (Exception ignored) {
            }
            return sb.toString();
        }

        private String readPart(ContentResolver cr, long partId) {
            try (InputStream in = cr.openInputStream(Uri.parse("content://mms/part/" + partId))) {
                if (in == null) return "";
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                byte[] buf = new byte[4096];
                int n;
                while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
                return bo.toString("UTF-8");
            } catch (Exception e) {
                return "";
            }
        }
    }
}
