/**
 * 领克签到请求元数据捕获（Quantumult X response-body 重写脚本）
 *
 * 仅在领克 APP 手动签到时记录诊断所需的非敏感元数据：
 *   - 请求 host/path/method
 *   - X-Ca-Key、X-Ca-Signature-Headers
 *   - 是否携带 APPCODE（不保存 Authorization 的值）
 *   - App/设备头的字段名和响应状态
 *
 * 明确不保存 token、Authorization、X-Ca-Signature、nonce、timestamp 或请求正文值。
 */

(function () {
  try {
    var request = $request || {};
    var method = String(request.method || "GET").toUpperCase();
    var url = String(request.url || "");
    var pathMatch = url.match(/^https?:\/\/([^/]+)(\/[^?#]*)/i);
    var path = pathMatch ? pathMatch[2] : "";

    // 重写规则会同时命中签到状态查询；只保存真正的 POST /sign 请求。
    if (method !== "POST" || !/\/sign$/i.test(path)) {
      $done({});
      return;
    }

    var headers = request.headers || {};
    var lowerHeaders = {};
    Object.keys(headers).forEach(function (key) {
      lowerHeaders[String(key).toLowerCase()] = String(headers[key]);
    });
    var auth = lowerHeaders.authorization || "";
    var responseBody = ($response && $response.body) || "";
    var responseJson = null;
    try { responseJson = JSON.parse(responseBody); } catch (_) {}

    var meta = {
      capturedAt: new Date().toISOString(),
      host: pathMatch ? pathMatch[1] : "",
      path: path,
      method: method,
      xCaKey: lowerHeaders["x-ca-key"] || "",
      signatureHeaders: lowerHeaders["x-ca-signature-headers"] || "",
      hasAppCode: /^APPCODE\s+/i.test(auth),
      hasToken: !!lowerHeaders.token,
      contentType: lowerHeaders["content-type"] || "",
      appVersion: lowerHeaders.gl_app_version || lowerHeaders.appversioncode || "",
      deviceHeaderNames: Object.keys(lowerHeaders).filter(function (key) {
        return /device|gl_dev_|gl_app_|appversion|publicplatform|sweet_security/.test(key);
      }).sort(),
      responseStatus: ($response && ($response.status || $response.statusCode)) || "",
      responseCode: responseJson && responseJson.code != null ? String(responseJson.code) : "",
      responseMessage: responseJson && (responseJson.message || responseJson.msg) ?
        String(responseJson.message || responseJson.msg).slice(0, 100) : "",
    };

    $prefs.setValueForKey(JSON.stringify(meta), "lynk_sign_capture");
    $notify(
      "领克签到元数据已捕获",
      meta.method + " " + meta.path,
      "X-Ca-Key=" + (meta.xCaKey || "无") + " | APPCODE=" + (meta.hasAppCode ? "有" : "无")
    );
  } catch (_) {
    // 诊断脚本不能影响领克 APP 原始响应。
  }
  $done({});
})();
