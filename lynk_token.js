/**
 * 领克 Token 自动提取（QX response-body 重写脚本）
 *
 * 作用：拦截领克「登录 / 刷新」接口的响应，自动把
 *   - refreshToken  -> 写入 QX 本地偏好 lynk_refresh_token
 *   - device_id     -> 写入 QX 本地偏好 lynk_device_id（请求头 gl_dev_id 或 URL deviceId）
 *   - appVersion    -> 写入 QX 本地偏好 lynk_share_app_version
 * 配合 lynk_qx.js 使用，无需手动抓包翻 JSON。
 *
 * 用法：在 QX 配置文件 [rewrite_local] 段加一行：
 *   ^https?://app-services\.lynkco\.com\.cn/.*login url script-response-body lynk_token.js
 * 然后打开领克 APP 重新登录一次即可自动保存。
 *
 * 零外部依赖：只用 QX 原生 $request / $response / $prefs / $notify / $done。
 */

(function () {
  var TOKEN_KEY = "lynk_refresh_token";
  var DEVICE_KEY = "lynk_device_id";
  var VERSION_KEY = "lynk_share_app_version";

  try {
    // 1) device_id 来自请求头 gl_dev_id（领克所有请求都带，不区分大小写取）
    var hdrs = ($request && $request.headers) || {};
    var dev = null;
    var appVersion = null;
    for (var k in hdrs) {
      if (k && String(k).toLowerCase() === "gl_dev_id") { dev = hdrs[k]; break; }
    }
    for (var vk in hdrs) {
      var lowerKey = vk ? String(vk).toLowerCase() : "";
      if (lowerKey === "gl_app_version" || lowerKey === "appversioncode") {
        appVersion = hdrs[vk];
        break;
      }
    }
    // 某些版本登录请求不带 gl_dev_id，但会把 deviceId 放在 URL 查询串。
    var requestUrl = ($request && $request.url) || "";
    if (!dev) {
      var deviceMatch = requestUrl.match(/[?&]deviceId=([^&]+)/i);
      if (deviceMatch) {
        try { dev = decodeURIComponent(deviceMatch[1]); }
        catch (_) { dev = deviceMatch[1]; }
      }
    }
    var versionMatch = requestUrl.match(/[?&]appVersion=([^&]+)/i);
    if (versionMatch) {
      try { appVersion = decodeURIComponent(versionMatch[1]); }
      catch (_) { appVersion = versionMatch[1]; }
    }
    if (dev) {
      if (dev !== $prefs.valueForKey(DEVICE_KEY)) {
        $prefs.setValueForKey(dev, DEVICE_KEY);
      }
    }
    if (appVersion && appVersion !== $prefs.valueForKey(VERSION_KEY)) {
      $prefs.setValueForKey(String(appVersion), VERSION_KEY);
    }

    // 2) refreshToken 来自响应体 data.centerTokenDto.refreshToken
    var body = null;
    try { body = JSON.parse($response.body); } catch (e) { body = null; }

    if (body && body.data && body.data.centerTokenDto) {
      var rt = body.data.centerTokenDto.refreshToken;
      if (rt && rt !== $prefs.valueForKey(TOKEN_KEY)) {
        $prefs.setValueForKey(rt, TOKEN_KEY);
        // 登录切换账号后旧 accessToken 仍可能有 8 分钟缓存，必须立即清掉。
        $prefs.setValueForKey("", "lynk_at_cache");

        // 仅在「真正登录」(mobileCodeLogin) 时弹通知；
        // 日常 refresh 静默续期，避免每天打扰。
        var url = ($request && $request.url) || "";
        if (url.indexOf("mobileCodeLogin") !== -1) {
          $notify("领克Token已自动保存", "", "refreshToken / device_id 已自动写入本地");
        }
      }
    }
  } catch (e) {
    // 任何意外都不影响原响应
  }

  // 返回空对象 = 不修改响应，只做"存偏好"的副作用
  $done({});
})();
