/**
 * 领克 4.2.4 签到请求结构捕获（Quantumult X）
 *
 * 只匹配 POST /up/api/v1/user/sign/upgrade，并保存重建签名所需的结构信息。
 * 不保存 token、Authorization、nonce、timestamp、Date 或 X-Ca-Signature 的值。
 */

(function () {
  try {
    var request = $request || {};
    var method = String(request.method || "").toUpperCase();
    var url = String(request.url || "");
    var match = url.match(/^https?:\/\/([^/?#]+)(\/[^?#]*)/i);
    var host = match ? String(match[1]).toLowerCase() : "";
    var path = match ? match[2] : "";
    if (method !== "POST" || path !== "/up/api/v1/user/sign/upgrade") {
      $done({});
      return;
    }

    var originalHeaders = request.headers || {};
    var lowerHeaders = {};
    Object.keys(originalHeaders).forEach(function (name) {
      lowerHeaders[String(name).toLowerCase()] = String(originalHeaders[name]);
    });

    var bodyText = request.body == null ? "" : String(request.body);
    var supportedBody = bodyText === "" || bodyText === "{}";
    var signatureHeaders = lowerHeaders["x-ca-signature-headers"] || "";
    var signedNames = signatureHeaders.split(",").map(function (name) {
      return name.trim();
    }).filter(Boolean);
    var dynamic = {
      "x-ca-key": true,
      "x-ca-nonce": true,
      "x-ca-timestamp": true,
      "x-ca-signature-method": true,
      "x-ca-signature": true,
      "x-ca-signature-headers": true,
      "token": true,
      "authorization": true,
      "date": true,
    };
    var signedValues = {};
    signedNames.forEach(function (name) {
      var lower = name.toLowerCase();
      if (!dynamic[lower] && lowerHeaders[lower] != null) signedValues[lower] = lowerHeaders[lower];
    });

    var passThroughNames = [
      "use_security", "risk_type", "x-ca-version", "x-ca-stage", "ca_version",
      "x-requiretoken", "publicplatform", "user-agent", "gl_dev_id",
      "gl_app_version", "gl_app_build", "appversioncode", "appversionname",
    ];
    var passThrough = {};
    passThroughNames.forEach(function (name) {
      if (lowerHeaders[name] != null) passThrough[name] = lowerHeaders[name];
    });

    var responseBody = ($response && $response.body) || "";
    var responseJson = null;
    try { responseJson = JSON.parse(responseBody); } catch (_) {}
    var responseData = responseJson && responseJson.data;
    var responseDataKeys = responseData && typeof responseData === "object" ? Object.keys(responseData) : [];
    var responseConfirmed = responseJson && String(responseJson.code) === "200" && responseData &&
      (responseData.todayFirstSign || responseDataKeys.some(function (name) {
        return /reward(?:Energy|Point|SignCard)Number/i.test(name);
      }));

    var profile = {
      version: 2,
      capturedAt: new Date().toISOString(),
      host: host,
      path: path,
      method: method,
      xCaKey: lowerHeaders["x-ca-key"] || "",
      signatureHeaders: signatureHeaders,
      signatureMethod: lowerHeaders["x-ca-signature-method"] || "HmacSHA256",
      accept: lowerHeaders.accept || "*/*",
      contentType: lowerHeaders["content-type"] || "application/json",
      contentMd5: lowerHeaders["content-md5"] || "",
      hasDate: !!lowerHeaders.date,
      hasAppCode: /^APPCODE\s+/i.test(lowerHeaders.authorization || ""),
      bodyText: supportedBody ? bodyText : "",
      supportedBody: supportedBody,
      signedValues: signedValues,
      passThrough: passThrough,
      responseCode: responseJson && responseJson.code != null ? String(responseJson.code) : "",
      responseDataKeys: responseDataKeys,
    };

    if (responseConfirmed) $prefs.setValueForKey(JSON.stringify(profile), "lynk_sign_profile_v2");
    $notify(
      responseConfirmed ? "领克签到结构已捕获" : "领克签到请求未采用",
      "X-Ca-Key=" + (profile.xCaKey || "无") + " | body=" + (bodyText === "" ? "空" : bodyText),
      "签名头=" + (signatureHeaders || "无") +
        " | Date=" + (profile.hasDate ? "有" : "无") +
        " | MD5=" + (profile.contentMd5 ? "有" : "无") +
        " | response=" + (profile.responseCode || "未知") +
        (responseConfirmed ? "" : " | 仅成功签到才保存")
    );
  } catch (_) {
    // 捕获失败不能影响 APP 原请求。
  }
  $done({});
})();
