/**
 * 领克签到请求元数据捕获（Quantumult X response-body 重写脚本）
 *
 * 在领克 APP 手动签到时记录诊断所需的非敏感元数据：
 *   - 请求 host/path/method
 *   - X-Ca-Key、X-Ca-Signature-Headers
 *   - 是否携带 APPCODE（不保存 Authorization 的值）
 *   - App/设备头的字段名、请求/响应 JSON 的字段名和响应状态
 *
 * 兼容新版 APP 将签到动作迁移到“不含 sign 的 URL”：重写规则会把
 * /up/api/vN/ 下的 POST 交给本脚本，本脚本仅保存字段名和安全头。
 *
 * 明确不保存 token、Authorization、X-Ca-Signature、nonce、timestamp、
 * 请求正文值、响应 data 值或设备标识值。
 */

(function () {
  try {
    var request = $request || {};
    var method = String(request.method || "GET").toUpperCase();
    var url = String(request.url || "");
    var pathMatch = url.match(/^https?:\/\/([^/]+)(\/[^?#]*)/i);
    var path = pathMatch ? pathMatch[2] : "";
    var query = "";
    var queryIndex = url.indexOf("?");
    if (queryIndex >= 0) query = url.slice(queryIndex + 1).split("#")[0];

    function uniqueSorted(items) {
      var seen = {};
      return items.filter(function (item) {
        item = String(item || "");
        if (!item || seen[item]) return false;
        seen[item] = true;
        return true;
      }).sort();
    }

    function jsonKeys(text) {
      if (!text) return [];
      try {
        var parsed = JSON.parse(text);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ?
          Object.keys(parsed).sort() : [];
      } catch (_) {
        return [];
      }
    }

    function queryKeys(text) {
      if (!text) return [];
      return uniqueSorted(text.split("&").map(function (part) {
        var key = part.split("=")[0] || "";
        try { return decodeURIComponent(key.replace(/\+/g, " ")); } catch (_) { return key; }
      }));
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

    var responseData = responseJson && responseJson.data;
    var responseDataKeys = responseData && typeof responseData === "object" && !Array.isArray(responseData) ?
      Object.keys(responseData).sort() : [];
    var responseText = String(responseJson && (responseJson.message || responseJson.msg || responseJson.code) || "");
    var looksLikeSignResponse = /签到|sign/i.test(responseText) || responseDataKeys.some(function (key) {
      return /reward(?:Energy|Point|SignCard)Number|signStatus|continueDays|continuousSignDays/i.test(key);
    });
    var exactSignPath = /\/sign(?:\/|$)/i.test(path);
    var isSignPost = method === "POST" && (exactSignPath || looksLikeSignResponse);
    var isCandidatePost = method === "POST" && /\/(?:up|app)\/api\/v\d+\/(?:user|userReward)(?:\/|$)/i.test(path);
    var isSignStatus = method === "GET" && (
      /\/user\/sign\/day\/info$/i.test(path) ||
      /\/userReward\/getContinueDaysAndSignCard$/i.test(path)
    );

    // 已签到时 APP 不会再发 POST；状态 GET 仍保存。新版未知路径先按候选 POST 保存。
    if (!isSignPost && !isCandidatePost && !isSignStatus) {
      $done({});
      return;
    }

    var captureType = isSignPost ? "sign-post" : (isSignStatus ? "sign-status" : "sign-candidate-post");
    var meta = {
      capturedAt: new Date().toISOString(),
      captureType: captureType,
      host: pathMatch ? pathMatch[1] : "",
      path: path,
      queryKeys: queryKeys(query),
      method: method,
      xCaKey: lowerHeaders["x-ca-key"] || "",
      signatureHeaders: lowerHeaders["x-ca-signature-headers"] || "",
      xCaVersion: lowerHeaders["x-ca-version"] || "",
      hasAppCode: /^APPCODE\s+/i.test(auth),
      hasCepAuthentication: /^AppId=/i.test(lowerHeaders.authentication || ""),
      hasTenantId: !!lowerHeaders.tenantid,
      useSecurity: String(lowerHeaders.use_security || "").toLowerCase() === "true",
      hasRiskType: !!lowerHeaders.risk_type,
      hasToken: !!lowerHeaders.token,
      contentType: lowerHeaders["content-type"] || "",
      accept: lowerHeaders.accept || "",
      publicPlatform: lowerHeaders.publicplatform || "",
      appVersion: lowerHeaders.gl_app_version || lowerHeaders.appversioncode || "",
      appBuild: lowerHeaders.gl_app_build || lowerHeaders.appversionname || "",
      hasUserAgent: !!lowerHeaders["user-agent"],
      requestBodyKeys: jsonKeys(request.body || ""),
      deviceHeaderNames: Object.keys(lowerHeaders).filter(function (key) {
        return /device|gl_dev_|gl_app_|appversion|publicplatform|sweet_security/.test(key);
      }).sort(),
      responseStatus: ($response && ($response.status || $response.statusCode)) || "",
      responseCode: responseJson && responseJson.code != null ? String(responseJson.code) : "",
      responseMessage: responseJson && (responseJson.message || responseJson.msg) ?
        String(responseJson.message || responseJson.msg).slice(0, 100) : "",
      responseDataKeys: responseDataKeys,
    };

    var storageKey = isSignPost ? "lynk_sign_capture" :
      (isSignStatus ? "lynk_sign_status_capture" : "lynk_sign_candidate_capture");
    $prefs.setValueForKey(JSON.stringify(meta), storageKey);
    $notify(
      isSignPost ? "领克签到请求已捕获" :
        (isSignStatus ? "领克签到状态元数据已捕获" : "领克签到候选 POST 已捕获"),
      meta.method + " " + meta.host + meta.path,
      "X-Ca-Key=" + (meta.xCaKey || "无") + " | APPCODE=" + (meta.hasAppCode ? "有" : "无") +
        " | CEP=" + (meta.hasCepAuthentication ? "有" : "无") +
        " | APP=" + (meta.appVersion || "未知") +
        " | HTTP=" + (meta.responseStatus || "未知")
    );
  } catch (_) {
    // 诊断脚本不能影响领克 APP 原始响应。
  }
  $done({});
})();