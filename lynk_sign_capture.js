/**
 * 领克签到请求捕获（Quantumult X response-body 重写脚本）
 *
 * 目的：在领克 APP 手动点一次签到时，精确识别「真正执行签到的那条 POST」，
 * 记录复现签到所需的非敏感元数据（host / path / X-Ca-Key / 是否带 APPCODE 等），
 * 供 lynk_qx.js 自动套用。
 *
 * ⚠️ 关键判定（修复旧版误抓 /sign/info 状态探测的 bug）：
 *   只有当响应里带「签到奖励字段」(rewardEnergyNumber / rewardPointNumber /
 *   rewardSignCardNumber) 或明确的「签到成功」文案时，才认定为真实签到动作。
 *   纯状态查询 (/info、/day/info、getContinueDaysAndSignCard) 不含奖励字段，
 *   因此不会再被误当成签到 POST。
 *
 * 覆盖两个生产网关：app-api-gw-toc.lynkco.com 与 app-gateway-common.lynkco.com。
 *
 * 明确不保存 token、Authorization 值、X-Ca-Signature、nonce、timestamp、
 * 请求正文值、响应 data 值或设备标识值。
 */

(function () {
  try {
    var request = $request || {};
    var method = String(request.method || "GET").toUpperCase();
    var url = String(request.url || "");
    var pathMatch = url.match(/^https?:\/\/([^/]+)(\/[^?#]*)/i);
    var host = pathMatch ? pathMatch[1] : "";
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

    // —— 精确判定真实签到动作 ——
    // 1) 响应带奖励字段 = 真的领到了签到奖励（状态查询绝不会有这些字段）
    var responseHasReward = responseDataKeys.some(function (key) {
      return /reward(?:Energy|Point|SignCard)Number/i.test(key);
    });
    // 2) 或响应明确说“签到成功/签到完成”
    var responseSaysSigned = /签到成功|签到完成|sign\s*success|checkin\s*success/i.test(responseText);
    // 明确的只读端点：即使响应偶然含 sign 字样也不当作签到动作
    var lowerPath = path.toLowerCase();
    var isReadEndpoint =
      /\/(?:info|status|detail|list|query|day|summary|record|calendar|config|page|home)(?:\/|$)/.test(lowerPath) ||
      /getcontinuedays|getsigncard|getsigninfo|day\/info|sign\/info|sign\/status/.test(lowerPath);

    var isSignAction = method === "POST" && !isReadEndpoint && (responseHasReward || responseSaysSigned);

    // 诊断用：user/userReward 下的其它 POST（未确认为签到动作）也单独存一份，便于排查，但不会被自动套用。
    var isCandidatePost = method === "POST" &&
      /\/(?:up|app)\/api\/v\d+\/(?:user|userReward)(?:\/|$)/i.test(path);
    // 状态 GET 也留一份用于对照
    var isSignStatus = method === "GET" && (
      /\/user\/sign\/day\/info$/i.test(path) ||
      /\/userReward\/getContinueDaysAndSignCard$/i.test(path)
    );

    if (!isSignAction && !isCandidatePost && !isSignStatus) {
      $done({});
      return;
    }

    var captureType = isSignAction ? "sign-post" :
      (isSignStatus ? "sign-status" : "sign-candidate-post");
    var meta = {
      capturedAt: new Date().toISOString(),
      captureType: captureType,
      host: host,
      path: path,
      queryKeys: queryKeys(query),
      method: method,
      xCaKey: lowerHeaders["x-ca-key"] || "",
      signatureHeaders: lowerHeaders["x-ca-signature-headers"] || "",
      xCaVersion: lowerHeaders["x-ca-version"] || "",
      xCaStage: lowerHeaders["x-ca-stage"] || "",
      hasAppCode: /^APPCODE\s+/i.test(auth),
      hasCepAuthentication: /^AppId=/i.test(lowerHeaders.authentication || ""),
      hasTenantId: !!lowerHeaders.tenantid,
      useSecurity: String(lowerHeaders.use_security || "").toLowerCase() === "true",
      hasRiskType: !!lowerHeaders.risk_type,
      hasToken: !!lowerHeaders.token,
      contentType: lowerHeaders["content-type"] || "",
      accept: lowerHeaders.accept || "",
      contentMd5: lowerHeaders["content-md5"] || "",
      hasDateHeader: !!lowerHeaders.date,
      requestBodyLength: String(request.body || "").length,
      publicPlatform: lowerHeaders.publicplatform || "",
      appVersion: lowerHeaders.gl_app_version || lowerHeaders.appversioncode || "",
      appBuild: lowerHeaders.gl_app_build || lowerHeaders.appversionname || "",
      hasUserAgent: !!lowerHeaders["user-agent"],
      userAgent: lowerHeaders["user-agent"] || "",
      responseHasReward: responseHasReward,
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

    var storageKey = isSignAction ? "lynk_sign_capture" :
      (isSignStatus ? "lynk_sign_status_capture" : "lynk_sign_candidate_capture");
    $prefs.setValueForKey(JSON.stringify(meta), storageKey);
    $notify(
      isSignAction ? "领克真实签到请求已捕获 ✓" :
        (isSignStatus ? "领克签到状态元数据已捕获" : "领克签到候选 POST 已捕获"),
      meta.method + " " + meta.host + meta.path,
      "X-Ca-Key=" + (meta.xCaKey || "无") + " | APPCODE=" + (meta.hasAppCode ? "有" : "无") +
        " | 奖励字段=" + (responseHasReward ? "有" : "无") +
        " | APP=" + (meta.appVersion || "未知") +
        " | HTTP=" + (meta.responseStatus || "未知")
    );
  } catch (_) {
    // 诊断脚本不能影响领克 APP 原始响应。
  }
  $done({});
})();
