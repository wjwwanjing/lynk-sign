/**
 * 领克 Token 自动提取（QX response-body 重写脚本）
 *
 * 作用：拦截领克「登录 / 刷新」接口的响应，自动把
 *   - refreshToken  -> 写入 QX 本地偏好 lynk_refresh_token
 *   - device_id     -> 写入 QX 本地偏好 lynk_device_id（取请求头 gl_dev_id）
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

  try {
    // 1) device_id 来自请求头 gl_dev_id（领克所有请求都带，不区分大小写取）
    var hdrs = ($request && $request.headers) || {};
    var dev = null;
    for (var k in hdrs) {
      if (k && String(k).toLowerCase() === "gl_dev_id") { dev = hdrs[k]; break; }
    }
    if (dev) {
      if (dev !== $prefs.valueForKey(DEVICE_KEY)) {
        $prefs.setValueForKey(dev, DEVICE_KEY);
      }
    }

    // 2) refreshToken 来自响应体 data.centerTokenDto.refreshToken
    var body = null;
    try { body = JSON.parse($response.body); } catch (e) { body = null; }

    if (body && body.data && body.data.centerTokenDto) {
      var rt = body.data.centerTokenDto.refreshToken;
      if (rt && rt !== $prefs.valueForKey(TOKEN_KEY)) {
        $prefs.setValueForKey(rt, TOKEN_KEY);

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
