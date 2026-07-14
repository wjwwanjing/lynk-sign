/**
 * 领克分享参数捕获（Quantumult X response-body 重写脚本）
 *
 * 在领克 APP 里手动点一次文章“分享”，本脚本会本地保存：
 *   - getShareCode 成功返回的 shareCode -> lynk_share_code
 *   - 真实 APP 请求中的非敏感风控头 -> lynk_share_headers
 *
 * 不保存 token、Authorization 或 X-Ca-Signature。所有数据仅写入 QX 本地偏好。
 */

(function () {
  var CODE_KEY = "lynk_share_code";
  var HEADERS_KEY = "lynk_share_headers";
  var VERSION_KEY = "lynk_share_app_version";
  var allowed = {
    "sweet_security_info": true,
    "publicplatform": true,
    "user-agent": true,
    "gl_dev_id": true,
    "gl_app_version": true,
    "gl_app_build": true,
    "appversioncode": true,
    "appversionname": true,
    "x-ca-version": true,
    "x-new-deviceid": true,
    "x-push-deviceid": true,
    "hardwaredeviceid": true,
    "deviceid": true,
    "geelydeviceid": true,
    "origin": true,
    "referer": true,
  };

  try {
    var requestHeaders = ($request && $request.headers) || {};
    var captured = {};
    var appVersion = null;
    Object.keys(requestHeaders).forEach(function (key) {
      var lower = String(key).toLowerCase();
      if (allowed[lower] && requestHeaders[key] != null) {
        captured[key] = String(requestHeaders[key]);
      }
      if ((lower === "gl_app_version" || lower === "appversioncode" || lower === "appversion") && requestHeaders[key]) {
        appVersion = String(requestHeaders[key]);
      }
    });

    if (Object.keys(captured).length > 0) {
      var serialized = JSON.stringify(captured);
      if (serialized !== $prefs.valueForKey(HEADERS_KEY)) {
        $prefs.setValueForKey(serialized, HEADERS_KEY);
      }
    }
    if (appVersion) $prefs.setValueForKey(appVersion, VERSION_KEY);

    var response = null;
    try { response = JSON.parse(($response && $response.body) || ""); } catch (_) {}
    var shareCode = response && response.data;
    if (shareCode && typeof shareCode === "object") shareCode = shareCode.shareCode || shareCode.code;
    if (response && (String(response.code) === "success" || String(response.code) === "200") && shareCode) {
      shareCode = String(shareCode).trim();
      if (shareCode && shareCode !== $prefs.valueForKey(CODE_KEY)) {
        $prefs.setValueForKey(shareCode, CODE_KEY);
        $notify("领克分享参数已保存", "", "shareCode 和真实 APP 风控头已写入 QX 本地");
      }
    }
  } catch (_) {
    // 捕获失败不能影响领克 APP 原始响应。
  }

  $done({});
})();
