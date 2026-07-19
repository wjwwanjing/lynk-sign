/**
 * 领克 APP 自动签到 - QuantumultX 精简版（完全本地、零外部依赖、无授权）
 *
 * 本版本已彻底移除原作者的 License 授权 / 反调试 / 反篡改逻辑，
 * 所有代码、密钥、签名算法都在你本地可控，不需要向任何人申请许可。
 *
 * ============================================================
 *  如何配置（二选一）
 * ============================================================
 * 方法一：直接改下面 CONFIG 区里的常量（把引号里的值换成你自己的）
 * 方法二：QX → 设置 → 其他设置 → 脚本 → 本脚本 → 配置（优先级更高）
 *
 *   配置项(方法二的 key)        说明
 *   -------------------------  ---------------------------------
 *   lynk_refresh_token        主账号 refreshToken（28 天有效，自动续期）
 *   lynk_device_id            设备 ID（抓包请求头 gl_dev_id）
 *   lynk_token_b             B 账号 refreshToken，逗号分隔多个（可选，用于三步自动分享）
 *   lynk_device_id_b          B 账号设备 ID，逗号分隔并与 Token 一一对应（可选）
 *   lynk_share_cid           分享文章 ID（可选，默认热门 ID）
 *   lynk_share_code          从真实 APP 分享动作捕获的 shareCode（风控失败时回退）
 *   lynk_share_app_version   分享风控头中的 App 版本（默认 4.2.4）
 *   lynk_share_delay         签到后等待再分享的秒数（默认 10）
 *   lynk_verify_delay        点击上报后等待奖励入账的秒数（默认 3）
 *   lynk_sign_path           签到端点（默认 /up/api/v1/user/sign）
 *   lynk_self_share          单步自助分享开关（"1"开/"0"关，默认开）：
 *                            没配小号时，用主账号自身调 shareReporting 上报，
 *                            让系统认为"已分享且有人点击"。实验性——是否真加分需真机验证。
 *
 * ============================================================
 *  QX 定时任务（长按底部风车 → 配置文件 → [task_local] 段）
 * ============================================================
 *   本地/离线：
 *     0 9 * * * lynk_qx.js, tag=领克签到, enabled=true
 *   远程（你自己的仓库，用 raw 原始地址，非 blob 网页地址）：
 *     0 9 * * * https://raw.githubusercontent.com/wjwwanjing/lynk-sign/main/lynk_qx.js, tag=领克签到, enabled=true
 *   （远程方式下 Token 请走 QX 偏好设置，不要写进 CONFIG 区）
 *
 * ============================================================
 *  抓包获取 refreshToken / device_id 的方法见 README.md
 * ============================================================
 */

// ===================== 配置 =====================
// 方法一：直接在这里填（留空则改走 QX 偏好设置里的 lynk_* key）
const CONFIG = {
  REFRESH_TOKEN: "",   // 主账号 refreshToken，形如 bearer<uuid>
  DEVICE_ID:     "",   // 设备 ID
  TOKEN_B:      "",   // B 账号 refreshToken，多个用逗号分隔；留空=不启用三步分享
  DEVICE_ID_B:  "",   // B 账号设备 ID，多个用逗号分隔；留空时回退到主账号设备 ID
  SHARE_CID:    "2072260486405246976", // 分享文章 ID
  SHARE_CODE:   "",   // 可手工填入/由 lynk_share_capture.js 自动保存
  SHARE_APP_VERSION: "4.2.4", // getShareCode 风控头中的 App 版本
  SHARE_DELAY:  "10", // 签到完成后等待再分享
  VERIFY_DELAY: "3",  // 点击回调后等待服务端记账
  SELF_SHARE:   "1",  // 单步自助分享开关："1"开/"0"关；没配小号时用主账号自身上报（实验性）
  SIGN_PATH:    "/up/api/v1/user/sign/upgrade",
};

// 方法二：QX 偏好设置读取（有值则覆盖上面的 CONFIG）
const REFRESH_TOKEN = $prefs.valueForKey("lynk_refresh_token") || CONFIG.REFRESH_TOKEN || "";
const DEVICE_ID     = $prefs.valueForKey("lynk_device_id")     || CONFIG.DEVICE_ID     || "";
const TOKEN_B_RAW   = $prefs.valueForKey("lynk_token_b")       || CONFIG.TOKEN_B      || "";
const DEVICE_ID_B_RAW = $prefs.valueForKey("lynk_device_id_b") || CONFIG.DEVICE_ID_B  || "";
const SHARE_CID     = $prefs.valueForKey("lynk_share_cid")     || CONFIG.SHARE_CID   || "2072260486405246976";
const SHARE_APP_VERSION = $prefs.valueForKey("lynk_share_app_version") || CONFIG.SHARE_APP_VERSION || "4.2.4";
const SHARE_DELAY   = nonNegativeInt($prefs.valueForKey("lynk_share_delay") || CONFIG.SHARE_DELAY, 10);
const VERIFY_DELAY  = nonNegativeInt($prefs.valueForKey("lynk_verify_delay") || CONFIG.VERIFY_DELAY, 3);
const SELF_SHARE    = String($prefs.valueForKey("lynk_self_share") || CONFIG.SELF_SHARE || "1");

// 单步自助分享是否开启
function selfShareEnabled() {
  var v = SELF_SHARE.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

// ===================== 常量（领克 APP 自带的网关公开参数，抓包即可见，非任何个人授权）=====================
const API_BASE   = "https://app-api-gw-toc.lynkco.com";
const OAUTH_BASE = "https://app-services.lynkco.com.cn";
const CA_KEY     = "204644386";
const CA_SECRET  = "QCl7udM3PB9cOIOwquwPglikFQnzJRsX";
// 4.2.4 真机签到 POST /user/sign/upgrade 使用的生产 Consumer。
const SIGN_CA_KEY = "203760416";
const SIGN_CA_SECRET = "IbyhE02AwkUzvupDon3xTZ3JIeddlppP";
// Base64(MD5("{}"))；签到请求正文固定为 {}，仅在网关返回 Invalid Signature 时诊断重试。
const EMPTY_JSON_MD5_BASE64 = "mZFLkyvTelC5g8XnyQrpOw==";
const APP_CODE   = "3fa3314998bd4195a9fe2df3e85e6a12";
const SIG_HDRS   = "X-Ca-Key,X-Ca-Timestamp,X-Ca-Nonce,X-Ca-Signature-Method";
const APP_VERSION      = "4.2.4";   // APP 版本号（与 doRefresh 一致）
const APP_VERSION_CODE = "40204067"; // APP build 号（来自 4.2.4 IPA）
const SHARE_H5_BASE = "https://h5.lynkco.com";
const SIGN_PATH_PREF = String($prefs.valueForKey("lynk_sign_path") || "");
const DEFAULT_SIGN_PATH = String(CONFIG.SIGN_PATH || "/up/api/v1/user/sign/upgrade");

// ===================== 纯 JS 加密实现（无外部依赖，已与 Node crypto 逐字节比对验证）=====================
// 阿里云 API 网关要求 HMAC-SHA256 签名。QX 的 JS 环境不保证有 $crypto，
// 这里用纯 JavaScript 从零实现 SHA-256 / HMAC-SHA256 / Base64，零依赖、完全可控。

function utf8Bytes(str) {
  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff) {
      var c2 = str.charCodeAt(++i);
      var cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f),
                 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return bytes;
}

function bytesToBase64(bytes) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var out = "";
  for (var i = 0; i < bytes.length; i += 3) {
    var b0 = bytes[i];
    var b1 = bytes[i + 1];
    var b2 = bytes[i + 2];
    out += chars[b0 >> 2];
    out += chars[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4)];
    out += (i + 1 < bytes.length) ? chars[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6)] : "=";
    out += (i + 2 < bytes.length) ? chars[b2 & 63] : "=";
  }
  return out;
}

var SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function rotr(n, x) { return (x >>> n) | (x << (32 - n)); }

function sha256(message) {
  var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
           0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

  var msg = message.slice();
  var bitLen = msg.length * 8;

  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0);
  var hi = Math.floor(bitLen / 0x100000000);
  var lo = bitLen >>> 0;
  msg.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff);
  msg.push((lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff);

  var w = new Array(64);
  for (var off = 0; off < msg.length; off += 64) {
    for (var t = 0; t < 16; t++) {
      w[t] = ((msg[off + t * 4] << 24) | (msg[off + t * 4 + 1] << 16) |
              (msg[off + t * 4 + 2] << 8) | (msg[off + t * 4 + 3])) >>> 0;
    }
    for (t = 16; t < 64; t++) {
      var s0 = rotr(7, w[t - 15]) ^ rotr(18, w[t - 15]) ^ (w[t - 15] >>> 3);
      var s1 = rotr(17, w[t - 2]) ^ rotr(19, w[t - 2]) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }

    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (t = 0; t < 64; t++) {
      var S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      var ch = (e & f) ^ ((~e) & g);
      var temp1 = (h + S1 + ch + SHA256_K[t] + w[t]) >>> 0;
      var S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }

  var out = [];
  for (var i = 0; i < 8; i++) {
    out.push((H[i] >>> 24) & 0xff, (H[i] >>> 16) & 0xff, (H[i] >>> 8) & 0xff, H[i] & 0xff);
  }
  return out;
}

function hmacSha256(keyBytes, msgBytes) {
  var blockSize = 64;
  if (keyBytes.length > blockSize) keyBytes = sha256(keyBytes);
  var key = keyBytes.slice();
  while (key.length < blockSize) key.push(0);

  var oKeyPad = [], iKeyPad = [];
  for (var i = 0; i < blockSize; i++) {
    oKeyPad.push(key[i] ^ 0x5c);
    iKeyPad.push(key[i] ^ 0x36);
  }
  var inner = sha256(iKeyPad.concat(msgBytes));
  return sha256(oKeyPad.concat(inner));
}

function hmacSha256Base64(secret, message) {
  return bytesToBase64(hmacSha256(utf8Bytes(secret), utf8Bytes(message)));
}

// ===================== 工具函数 =====================

function log(msg) { console.log("[Lynk] " + msg); }

// 补零（避免依赖 String.padStart，兼容更老的 QX 内核）
function pad2(n) { n = String(n); return n.length < 2 ? "0" + n : n; }

function nonNegativeInt(value, fallback) {
  var n = parseInt(value, 10);
  return isFinite(n) && n >= 0 ? n : fallback;
}

function waitSeconds(seconds) {
  var ms = nonNegativeInt(seconds, 0) * 1000;
  return ms > 0 ? new Promise(function (resolve) { setTimeout(resolve, ms); }) : Promise.resolve();
}

function responseMessage(resp) {
  if (!resp) return "无响应";
  var code = resp.code != null ? String(resp.code) : "?";
  var msg = resp.message || resp.msg || "";
  var http = resp._httpStatus != null ? String(resp._httpStatus) : "";
  return code + (msg ? " " + String(msg) : "") + (http && code === "?" ? " (HTTP " + http + ")" : "");
}

// 只输出业务状态和字段名，避免把 token、shareCode 等响应内容写进日志。
function safeResponseSummary(resp) {
  if (!resp) return "无响应";
  var parts = [];
  parts.push("code=" + (resp.code != null ? String(resp.code) : "?"));
  if (resp._httpStatus != null) parts.push("http=" + String(resp._httpStatus));
  var msg = resp.message || resp.msg;
  if (msg) parts.push("message=" + String(msg).slice(0, 100));
  if (resp.data && typeof resp.data === "object") {
    parts.push("dataKeys=" + Object.keys(resp.data).slice(0, 12).join(","));
  } else if (resp.data != null) {
    parts.push("dataType=" + typeof resp.data);
  }
  if (resp.raw != null) {
    var raw = String(resp.raw);
    parts.push("rawLength=" + raw.length);
    // 仅在错误响应很短时显示脱敏文本，便于区分 WAF 拒绝与“重复签到”。
    if (raw.length <= 160) {
      var preview = raw.replace(/[\r\n\t]+/g, " ")
        .replace(/bearer\s*[a-z0-9._-]+/gi, "bearer[已脱敏]")
        .replace(/[a-f0-9]{40,}/gi, "[长串已脱敏]")
        .trim();
      if (preview) parts.push("raw=" + preview);
    }
  }
  return parts.join(" ");
}

function localDateKey() {
  var now = new Date();
  return now.getFullYear() + "-" + pad2(now.getMonth() + 1) + "-" + pad2(now.getDate());
}

function rememberSignedToday() {
  $prefs.setValueForKey(localDateKey(), "lynk_last_sign_date");
}

function ts() { return String(Date.now()); }

function nonce() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  }).toUpperCase();
}

// 统一判断响应是否成功（兼容 "200" / "success" 两种返回）
function isOk(r) { return r && (String(r.code) === "200" || String(r.code) === "success"); }

// HMAC-SHA256 签名（阿里云 API 网关标准）
function hmacSign(method, path, params, caKey, caSecret, signatureOptions) {
  caKey = caKey || CA_KEY;
  caSecret = caSecret || CA_SECRET;
  signatureOptions = signatureOptions || {};
  var accept = signatureOptions.accept || "*/*";
  var contentType = signatureOptions.contentType || "application/json";
  var contentMd5 = String(signatureOptions.contentMd5 || "");
  var dateHeader = String(signatureOptions.dateHeader || "");
  var signatureHeaders = String(signatureOptions.signatureHeaders || SIG_HDRS);
  var t = ts();
  var n = nonce();

  var url = path;
  if (params && Object.keys(params).length > 0) {
    var sorted = Object.keys(params).sort().map(function (k) {
      return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
    }).join("&");
    if (sorted) url = path + "?" + sorted;
  }

  var signedValues = {
    "x-ca-key": caKey,
    "x-ca-timestamp": t,
    "x-ca-nonce": n,
    "x-ca-signature-method": "HmacSHA256",
    "x-ca-stage": "RELEASE",
    "accept": accept,
    "content-type": contentType,
  };
  var providedValues = signatureOptions.signedHeaderValues || {};
  Object.keys(providedValues).forEach(function (name) {
    signedValues[String(name).toLowerCase()] = String(providedValues[name]);
  });

  // X-Ca-Signature-Headers 可因 APP 模块不同而增减。签名串必须使用捕获到的
  // 名称、集合和对应值，不能继续固定为旧版四项。
  var signedNames = signatureHeaders.split(",").map(function (name) { return name.trim(); }).filter(Boolean);
  // 真实 APP profile 的列表就是其 SDK 生成签名时使用的顺序，必须原样保留。
  // 非 profile 请求继续沿用旧版已验证的默认顺序，避免影响其它业务接口。
  if (!signatureOptions.preserveSignatureHeaderOrder) {
    signedNames = ["X-Ca-Key", "X-Ca-Nonce", "X-Ca-Signature-Method", "X-Ca-Timestamp"];
  }
  var canonicalHeaders = signedNames.map(function (name) {
    var value = signedValues[name.toLowerCase()];
    if (value == null) throw new Error("无法重建签名头: " + name);
    return name + ":" + value;
  });

  var parts = [
    method.toUpperCase(),
    accept,
    contentMd5,
    contentType,
    dateHeader,
  ].concat(canonicalHeaders).concat([url]);
  var strToSign = parts.join("\n");
  var sig = hmacSha256Base64(caSecret, strToSign);

  var result = {
    "X-Ca-Key": caKey,
    "X-Ca-Timestamp": t,
    "X-Ca-Nonce": n,
    "X-Ca-Signature-Method": "HmacSHA256",
    "X-Ca-Signature-Headers": signatureHeaders,
    "X-Ca-Signature": sig,
    "Accept": accept,
  };
  if (contentMd5) result["Content-MD5"] = contentMd5;
  if (dateHeader) result.Date = dateHeader;
  return result;
}

// 带查询串的 GET（签名里把 query 一并签进去，与 QX 网关一致）
function buildUrlAndSign(method, path, params, caKey, caSecret, signatureOptions) {
  var qs = "";
  if (params && Object.keys(params).length > 0) {
    qs = Object.keys(params).sort().map(function (k) {
      return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
    }).join("&");
  }
  var signParams = qs ? params : null;
  var sig = hmacSign(method, path, signParams, caKey, caSecret, signatureOptions);
  var url = API_BASE + path + (qs ? "?" + qs : "");
  return { url: url, sig: sig };
}

// ===================== HTTP =====================

function httpGet(url, headers) {
  return new Promise(function (resolve) {
    $task.fetch({ url: url, method: "GET", headers: headers || {} })
      .then(function (resp) {
        try {
          var parsed = JSON.parse(resp.body);
          if (parsed && typeof parsed === "object") parsed._httpStatus = resp.statusCode;
          resolve(parsed);
        }
        catch (_) { resolve({ code: resp.statusCode, _httpStatus: resp.statusCode, raw: resp.body }); }
      }, function (err) {
        resolve({ code: "NET_ERR", message: String(err) });
      });
  });
}

function httpPost(url, headers, body) {
  return new Promise(function (resolve) {
    $task.fetch({ url: url, method: "POST", headers: headers || {}, body: JSON.stringify(body || {}) })
      .then(function (resp) {
        try {
          var parsed = JSON.parse(resp.body);
          if (parsed && typeof parsed === "object") parsed._httpStatus = resp.statusCode;
          resolve(parsed);
        }
        catch (_) { resolve({ code: resp.statusCode, _httpStatus: resp.statusCode, raw: resp.body }); }
      }, function (err) {
        resolve({ code: "NET_ERR", message: String(err) });
      });
  });
}

// ===================== Token 管理 =====================

function loadATCache() {
  try {
    var raw = $prefs.valueForKey("lynk_at_cache");
    if (!raw) return null;
    var c = JSON.parse(raw);
    if (!c.expire_at || Date.now() > c.expire_at - 120000) return null;
    return c.access_token;
  } catch (_) { return null; }
}

function saveATCache(token) {
  $prefs.setValueForKey(JSON.stringify({
    access_token: token,
    expire_at: Date.now() + 8 * 60 * 1000,
  }), "lynk_at_cache");
}

// refreshToken 换取 accessToken
function doRefresh(rt, did) {
  var params = {
    refreshToken: rt,
    deviceId: did,
    deviceType: "IOS",
    appVersion: APP_VERSION,
  };
  var qs = Object.keys(params).map(function (k) {
    return k + "=" + encodeURIComponent(params[k]);
  }).join("&");
  return httpGet(OAUTH_BASE + "/auth/login/refresh?" + qs, {
    "Authorization": "APPCODE " + APP_CODE,
    "accept": "application/json",
    "content-type": "application/json; charset=UTF-8",
    "publicplatform": "iOS",
    "user-agent": "CA_iOS_SDK_2.0",
    "token": "",
    "gl_dev_id": did,
    "appversioncode": APP_VERSION,
    "appversionname": APP_VERSION_CODE,
    "gl_app_version": APP_VERSION,
    "gl_app_build": APP_VERSION_CODE,
    "x-ca-version": "1",
  });
}

// 获取有效 accessToken：缓存 → refresh → 降级当 accessToken 用
async function getAccessToken() {
  var cached = loadATCache();
  if (cached) { log("accessToken: 缓存命中"); return { token: cached, source: "cache", newRT: null }; }

  var r = await doRefresh(REFRESH_TOKEN, DEVICE_ID);
  if (isOk(r)) {
    var dto = (r.data || {}).centerTokenDto || {};
    if (dto.token) {
      saveATCache(dto.token);
      log("accessToken: refresh 成功");
      return { token: dto.token, source: "refresh", newRT: dto.refreshToken || null };
    }
    log("accessToken: refresh 响应缺少 token");
  } else {
    log("accessToken: refresh 失败 " + responseMessage(r));
  }

  // 降级：直接试探它本身是不是有效 accessToken（例如用户误填了 accessToken）
  var test = await apiGet("/up/api/v1/userReward/getContinueDaysAndSignCard", REFRESH_TOKEN);
  if (isOk(test)) {
    saveATCache(REFRESH_TOKEN);
    log("accessToken: 降级为直接使用");
    return { token: REFRESH_TOKEN, source: "bare", newRT: null };
  }

  return { token: null, source: "failed", newRT: null, error: responseMessage(r) };
}

// ===================== 业务 API =====================

// 大部分业务请求（包括无 token 的访客回调）带 APPCODE。
// token 不参与网关签名；风险控制头也在签名后合并。
function businessHeaders(token) {
  var headers = {
    "Authorization": "APPCODE " + APP_CODE,
    "content-type": "application/json",
  };
  if (token) headers.token = token;
  return headers;
}

// extraHeaders 在签名之后合并（这些头不参与签名，如 risk_request_info）
function apiGet(path, token, params, extraHeaders) {
  var bs = buildUrlAndSign("GET", path, params);
  var headers = Object.assign({}, bs.sig, businessHeaders(token));
  if (extraHeaders) Object.assign(headers, extraHeaders);
  return httpGet(bs.url, headers);
}

// iOS 签到状态请求的捕获结果不带 APPCODE，保持 token + X-Ca 原始格式。
function apiGetTokenOnly(path, token, params, extraHeaders) {
  var bs = buildUrlAndSign("GET", path, params);
  var headers = Object.assign({}, bs.sig, {
    "content-type": "application/json",
    "token": token,
  });
  if (extraHeaders) Object.assign(headers, extraHeaders);
  return httpGet(bs.url, headers);
}

function apiPost(path, token, body, params, extraHeaders) {
  var bs = buildUrlAndSign("POST", path, params);
  var headers = Object.assign({}, bs.sig, businessHeaders(token));
  if (extraHeaders) Object.assign(headers, extraHeaders);
  return httpPost(bs.url, headers, body || {});
}

// 4.2.4 真机已确认签到动作是 POST /up/api/v1/user/sign/upgrade。
// 旧版调试过程中若把 /user/sign 写入偏好设置，也自动迁移到已确认的新端点。
function signPath() {
  if (SIGN_PATH_PREF === "/up/api/v1/user/sign") return DEFAULT_SIGN_PATH;
  return SIGN_PATH_PREF && SIGN_PATH_PREF.charAt(0) === "/" ? SIGN_PATH_PREF : DEFAULT_SIGN_PATH;
}

// 我们只掌握这两个 Consumer 的签名密钥；APP 若换了新 X-Ca-Key，无密钥无法重放。
function knownCaSecret(caKey) {
  if (String(caKey) === CA_KEY) return CA_SECRET;
  if (String(caKey) === SIGN_CA_KEY) return SIGN_CA_SECRET;
  return "";
}

function signatureHeaderNames(value) {
  return String(value || SIG_HDRS).split(",").map(function (s) { return s.trim().toLowerCase(); })
    .filter(Boolean);
}

function unsupportedSignatureHeaders(value) {
  var supported = {
    "x-ca-key": 1, "x-ca-timestamp": 1, "x-ca-nonce": 1,
    "x-ca-signature-method": 1, "x-ca-stage": 1, "x-ca-version": 1,
    "token": 1, "authorization": 1, "accept": 1, "content-type": 1,
    "publicplatform": 1, "gl_dev_id": 1, "gl_app_version": 1,
    "gl_app_build": 1, "appversioncode": 1, "appversionname": 1,
    "user-agent": 1, "use_security": 1, "risk_type": 1,
  };
  return signatureHeaderNames(value).filter(function (name) { return !supported[name]; });
}

// 读取 lynk_sign_capture.js 精确捕获的真实签到 POST。
// 只有响应确认带奖励字段(responseHasReward)、Key 密钥已知、签名头值可复现时才自动采用。
function capturedSignProfile() {
  var raw = $prefs.valueForKey("lynk_sign_capture") || "";
  if (!raw) return null;
  try {
    var m = JSON.parse(raw);
    if (m.captureType !== "sign-post" || String(m.method).toUpperCase() !== "POST") return null;
    if (!m.responseHasReward) return null; // 修复旧 bug：非奖励响应绝不当签到动作
    var hostLc = String(m.host || "").toLowerCase();
    if (hostLc !== "app-api-gw-toc.lynkco.com" && hostLc !== "app-gateway-common.lynkco.com") return null;
    if (String(m.path || "").charAt(0) !== "/") return null;
    var caSecret = knownCaSecret(m.xCaKey);
    var unknownHeaders = unsupportedSignatureHeaders(m.signatureHeaders);
    var hasUnknownBody = Array.isArray(m.requestBodyKeys) && m.requestBodyKeys.length > 0;
    var hasUnknownQuery = Array.isArray(m.queryKeys) && m.queryKeys.length > 0;
    var supported = !!caSecret && unknownHeaders.length === 0 && !m.hasCepAuthentication &&
      !hasUnknownBody && !hasUnknownQuery;
    return {
      supported: supported,
      unsupportedReason: !caSecret ? "捕获到未知 X-Ca-Key=" + (m.xCaKey || "无") + "（无签名密钥，无法重放）" :
        (unknownHeaders.length ? "存在无法重建的签名头: " + unknownHeaders.join(",") :
          (m.hasCepAuthentication ? "捕获请求使用 CEP 鉴权，无可安全重建的凭据" :
            (hasUnknownBody ? "签到正文包含未保存的字段值: " + m.requestBodyKeys.join(",") :
              (hasUnknownQuery ? "签到 URL 包含未保存的查询值: " + m.queryKeys.join(",") : "")))),
      baseUrl: "https://" + hostLc,
      path: String(m.path),
      caKey: String(m.xCaKey || CA_KEY),
      caSecret: caSecret,
      signatureHeaders: String(m.signatureHeaders || SIG_HDRS),
      hasAppCode: !!m.hasAppCode,
      useSecurity: !!m.useSecurity,
      hasRiskType: !!m.hasRiskType,
      xCaVersion: String(m.xCaVersion || ""),
      xCaStage: String(m.xCaStage || (signatureHeaderNames(m.signatureHeaders).indexOf("x-ca-stage") >= 0 ? "RELEASE" : "")),
      contentType: String(m.contentType || "application/json"),
      accept: String(m.accept || "*/*"),
      contentMd5: String(m.contentMd5 || ""),
      hasDateHeader: !!m.hasDateHeader,
      publicPlatform: String(m.publicPlatform || "iOS"),
      appVersion: String(m.appVersion || APP_VERSION),
      appBuild: String(m.appBuild || APP_VERSION_CODE),
      userAgent: m.hasUserAgent ? String(m.userAgent || "CA_iOS_SDK_2.0") : "",
      deviceHeaderNames: Array.isArray(m.deviceHeaderNames) ? m.deviceHeaderNames : [],
    };
  } catch (_) { return null; }
}

// 签到 POST：优先用捕获到的真实请求 profile；无捕获时使用 4.2.4 真机确认的
// /sign/upgrade + 203760416 + 无 APPCODE 组合。
function apiPostSign(token, body, caKey, caSecret, profile) {
  var base = API_BASE, path = signPath();
  var key = caKey || "";
  var secret = caSecret || "";
  var withAppCode = false;
  var requestHeaders = { "content-type": "application/json", "token": token };
  var signatureOptions = {};
  if (profile) {
    base = profile.baseUrl;
    path = profile.path;
    // 若外层未指定备用 Consumer，则用捕获到的 Key/密钥
    if (!key) { key = profile.caKey; secret = profile.caSecret; }
    withAppCode = profile.hasAppCode;
    requestHeaders["content-type"] = profile.contentType;
    requestHeaders.publicplatform = profile.publicPlatform;
    if (profile.xCaStage) requestHeaders["x-ca-stage"] = profile.xCaStage;
    if (profile.useSecurity) requestHeaders.use_security = "true";
    if (profile.hasRiskType) requestHeaders.risk_type = "1";
    if (profile.xCaVersion) requestHeaders["x-ca-version"] = profile.xCaVersion;
    if (profile.contentMd5) requestHeaders["Content-MD5"] = profile.contentMd5;
    if (profile.hasDateHeader) requestHeaders.Date = new Date().toUTCString();
    if (profile.userAgent) requestHeaders["user-agent"] = profile.userAgent;
    profile.deviceHeaderNames.forEach(function (name) {
      var lower = String(name).toLowerCase();
      if (lower === "gl_dev_id") requestHeaders[name] = DEVICE_ID;
      else if (lower === "gl_app_version" || lower === "appversioncode") requestHeaders[name] = profile.appVersion;
      else if (lower === "gl_app_build" || lower === "appversionname") requestHeaders[name] = profile.appBuild;
    });
    signatureOptions = {
      accept: profile.accept,
      contentType: profile.contentType,
      contentMd5: profile.contentMd5,
      dateHeader: requestHeaders.Date || "",
      signatureHeaders: profile.signatureHeaders,
      preserveSignatureHeaderOrder: true,
      signedHeaderValues: requestHeaders,
    };
  }
  if (!key) { key = SIGN_CA_KEY; secret = SIGN_CA_SECRET; }
  if (withAppCode) requestHeaders.Authorization = "APPCODE " + APP_CODE;
  signatureOptions.signedHeaderValues = requestHeaders;
  var sig = hmacSign("POST", path, null, key, secret, signatureOptions);
  var headers = Object.assign({}, requestHeaders, sig);
  return httpPost(base + path, headers, body || {});
}

// 不带 token，但仍带 APPCODE（与 H5 页面和 xbgo 参考实现一致）。
function apiPostNoToken(path, body, params, extraHeaders) {
  var bs = buildUrlAndSign("POST", path, params);
  var headers = Object.assign({}, bs.sig, businessHeaders(null));
  if (extraHeaders) Object.assign(headers, extraHeaders);
  return httpPost(bs.url, headers, body || {});
}

// —— B 账号点击三步（来自 spritekite 参考仓库）——
function shareLookup(token, shareCode) {
  return apiPost("/app/v1/task/shareCodeToUserId", token, { shareCode: shareCode });
}
function shareCheck(token, contentId, shareCode) {
  return apiPost("/app/v1/task/shareContentContectCheck", token, { contentId: contentId, shareCode: shareCode });
}
function shareReport(token, contentId, shareCode) {
  return apiPost("/app/v1/task/shareContentContectReporting", token, { contentId: contentId, shareCode: shareCode });
}

// 构造文章分享 H5 链接。两个参考仓库均使用 h5.lynkco.com。
function buildArticleShareUrl(articleId, shareCode) {
  var route = "lynkco://wx/?routeUrl=/pages/exploration/article/index.js?id=" + articleId;
  var url = SHARE_H5_BASE + "/app-h5/dist/web/pages/exploration/article/index.html?id=" +
    encodeURIComponent(articleId) + "&isShare=" + encodeURIComponent(route);
  if (shareCode) url += "&shareCode=" + encodeURIComponent(shareCode);
  return url;
}

// 从社区信息流响应里递归找出第一篇文章的 articleId（作为 businessNo）
function findFirstArticleId(node) {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (var i = 0; i < node.length; i++) {
      var r = findFirstArticleId(node[i]);
      if (r) return r;
    }
    return null;
  }
  if (typeof node === "object") {
    if (node.articleId) {
      var ct = String(node.contentType || "");
      var ctc = String(node.contentTypeCode || "");
      if (ct === "文章" || ctc === "article" || !ctc) return String(node.articleId);
    }
    for (var k in node) {
      if (Object.prototype.hasOwnProperty.call(node, k)) {
        var rr = findFirstArticleId(node[k]);
        if (rr) return rr;
      }
    }
  }
  return null;
}

// 风险控制头（getShareCode 需要，官方 risk_request_info）
function buildRiskHeaders(shareUrl, appVersion) {
  var now = new Date();
  var openTs = now.getFullYear() + "-" + pad2(now.getMonth() + 1) + "-" + pad2(now.getDate()) + " " +
               pad2(now.getHours()) + ":" + pad2(now.getMinutes()) + ":" + pad2(now.getSeconds());
  var riskInfo = {
    openTimeStamp: openTs,
    shareContentType: 1,          // 1=文章
    shareContentURL: shareUrl,
  };
  return {
    "use_security": "true",
    "risk_type": "1",
    "appVersion": appVersion || SHARE_APP_VERSION,
    "risk_request_info": JSON.stringify(riskInfo),
  };
}

function cachedShareCode() {
  var value = $prefs.valueForKey("lynk_share_code") || CONFIG.SHARE_CODE || "";
  value = String(value).trim();
  return value && value !== "null" && value !== "undefined" ? value : null;
}

// 真实 APP 的 getShareCode 请求可能带设备风控指纹（例如 sweet_security_info）。
// lynk_share_capture.js 只保存允许列表中的非 Token、非签名头，这里再次过滤后重放。
function loadCapturedShareHeaders() {
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
    var raw = $prefs.valueForKey("lynk_share_headers");
    var parsed = raw ? JSON.parse(raw) : {};
    var safe = {};
    Object.keys(parsed || {}).forEach(function (key) {
      if (allowed[String(key).toLowerCase()] && parsed[key] != null) safe[key] = String(parsed[key]);
    });
    return safe;
  } catch (_) {
    return {};
  }
}

function extractShareCode(resp) {
  if (!isOk(resp)) return null;
  var value = resp.data;
  if (value && typeof value === "object") value = value.shareCode || value.code;
  if (value == null) return null;
  value = String(value).trim();
  return value && value !== "null" && value !== "undefined" ? value : null;
}

function alreadyDone(resp) {
  var m = resp && (resp.message || resp.msg) ? String(resp.message || resp.msg) : "";
  return m.indexOf("已分享") >= 0 || m.indexOf("已完成") >= 0 || m.indexOf("已领取") >= 0 ||
         m.indexOf("今日已") >= 0 || m.indexOf("已结束") >= 0;
}

// 不同 APP/网关版本使用过多种“今日已签”字段，集中兼容，避免重复散落判断。
function signedStatus(data) {
  data = data || {};
  var candidates = [
    data.signStatus,
    data.todaySigned,
    data.isSigned,
    data.isSign,
    data.isTodaySign,
    data.todayIsSigned,
    data.signToday,
    data.signedToday,
    data.hasSignedToday,
    data.signInStatus,
    data.signFlag,
    data.signState,
    data.whetherSign,
    data.todaySignStatus,
    data.status,
  ];
  for (var i = 0; i < candidates.length; i++) {
    if (candidates[i] == null) continue;
    var raw = candidates[i];
    var value = String(raw).trim().toLowerCase();
    if (raw === 1 || raw === true || value === "1" || value === "true" ||
        value === "signed" || value === "already" || value === "done") return true;
  }
  return false;
}

function signedStatusFromDayInfo(resp) {
  if (!isOk(resp)) return false;
  var data = resp.data;
  if (data === true || data === 1 || data === "1" || String(data).toLowerCase() === "signed") return true;
  if (!data || typeof data !== "object") return false;
  if (signedStatus(data)) return true;
  // 部分版本把当天状态再包一层；只检查语义明确的当前状态容器，避免把历史日期误判为今天。
  var current = data.today || data.currentDay || data.dayInfo || data.signInfo || data.todayInfo;
  return !!(current && typeof current === "object" && signedStatus(current));
}

function alreadySignedResponse(resp) {
  if (!resp) return false;
  var code = resp.code != null ? String(resp.code) : "";
  var msg = resp.message || resp.msg || "";
  var raw = resp.raw != null ? String(resp.raw) : "";
  var text = (code + " " + msg + " " + raw).toLowerCase();
  return String(msg).indexOf("已签到") >= 0 || String(msg).indexOf("今日已签") >= 0 ||
         String(msg).indexOf("重复签到") >= 0 || raw.indexOf("已签到") >= 0 ||
         raw.indexOf("今日已签") >= 0 || raw.indexOf("重复签到") >= 0 ||
         /already.*sign|sign.*already|repeat.*sign/.test(text);
}

function unauthorizedConsumer(resp) {
  if (!resp) return false;
  var text = String(resp.message || resp.msg || "") + " " + String(resp.raw || "");
  return text.toLowerCase().indexOf("unauthorized consumer") >= 0;
}

function invalidSignature(resp) {
  if (!resp) return false;
  var text = String(resp.message || resp.msg || "") + " " + String(resp.raw || "");
  return text.toLowerCase().indexOf("invalid signature") >= 0;
}

// 判定接口是否接受了上报；这不等价于奖励已经到账。
function shareDone(resp) {
  return isOk(resp) || alreadyDone(resp);
}

// /app/energy/myEnergy.data.point 在 4.2.4 APP 中展示为 Co积分，
// 分享任务奖励的“能量体”实际对应 /app/energy/my/growth.data.accountLevelVo.growth。
function rewardEnergyFrom(resp) {
  if (!isOk(resp)) return null;
  var value = (((resp.data || {}).accountLevelVo) || {}).growth;
  if (value == null || value === "") return null;
  var n = Number(value);
  return isFinite(n) ? n : null;
}

async function readRewardEnergy(token) {
  var resp = await apiGet("/app/energy/my/growth", token);
  return { response: resp, point: rewardEnergyFrom(resp) };
}

async function verifyReward(token, before) {
  await waitSeconds(VERIFY_DELAY);
  var result = await readRewardEnergy(token);
  var delta = before != null && result.point != null ? result.point - before : null;
  return { before: before, after: result.point, delta: delta, response: result.response };
}

// 统一获取“文章 ID + 与该文章 URL 对应的 shareCode”。之前主流程裸调 getShareCode，
// B 账号模式会被 share.need.validate.check 风控拦截，且链接文章与自助上报文章可能不一致。
async function getShareContext(token) {
  var businessNo = null;
  try {
    var sq = await apiPost("/app/explore/home-page/square/index2", token, {});
    if (isOk(sq)) businessNo = findFirstArticleId(sq.data);
    else log("社区文章获取失败: " + responseMessage(sq));
  } catch (e) {
    log("社区文章获取异常: " + e);
  }
  if (!businessNo) businessNo = SHARE_CID;
  if (!businessNo) return { ok: false, msg: "无可分享文章", businessNo: null, shareCode: null, shareUrl: null };

  var shareUrl = buildArticleShareUrl(businessNo);
  var shareCode = null;
  var scResp = null;
  var capturedHeaders = loadCapturedShareHeaders();
  var riskHeaders = buildRiskHeaders(shareUrl, SHARE_APP_VERSION);
  var requestHeaders = Object.assign({}, capturedHeaders, riskHeaders);
  var capturedHeaderCount = Object.keys(capturedHeaders).length;
  if (capturedHeaderCount > 0) log("getShareCode: 重放 " + capturedHeaderCount + " 个真实 APP 风控头");

  scResp = await apiGet("/app/v1/task/getShareCode", token, null, requestHeaders);
  shareCode = extractShareCode(scResp);
  log("getShareCode: " + responseMessage(scResp) +
      (shareCode ? "，已取到 shareCode" : "，无 shareCode"));

  var usedCachedCode = false;
  if (shareCode) {
    $prefs.setValueForKey(shareCode, "lynk_share_code");
  } else {
    shareCode = cachedShareCode();
    usedCachedCode = !!shareCode;
    if (usedCachedCode) log("getShareCode 被风控拦截，回退使用已捕获的 shareCode");
  }

  return {
    ok: !!shareCode,
    msg: usedCachedCode ? "实时取码被风控拦截，已使用捕获缓存" :
         (shareCode ? "已获取分享码" : "getShareCode: " + responseMessage(scResp)),
    businessNo: String(businessNo),
    shareCode: shareCode,
    shareUrl: buildArticleShareUrl(businessNo, shareCode),
    response: scResp,
    usedCachedCode: usedCachedCode,
  };
}

function sharePayload(businessNo) {
  return {
    businessNo: String(businessNo),
    eventData: { firstClassification: "文章", secondClassification: "" },
  };
}

// xbgo 链路：带 token 上报“我分享了”，再由无 token（但有 APPCODE）的 H5 回调上报浏览。
async function doSelfShareTask(token, context, energyBefore) {
  var payload = sharePayload(context.businessNo);
  var rep = await apiPost("/app/v1/task/reporting", token, payload, { type: "99" });
  log("reporting?type=99: " + responseMessage(rep));

  var clickResp = null;
  if (context.shareCode) {
    clickResp = await apiPostNoToken("/app/v1/task/shareReporting", payload, { shareCode: context.shareCode });
    log("shareReporting(无token): " + responseMessage(clickResp));
  } else {
    log("shareReporting 跳过: 无 shareCode");
  }

  var verify = await verifyReward(token, energyBefore);
  var rewarded = verify.delta != null && verify.delta > 0;
  var reported = shareDone(rep);
  var clicked = shareDone(clickResp);
  var completed = alreadyDone(rep) || alreadyDone(clickResp);
  var msg = "";
  if (rewarded) msg = "奖励已到账 +" + verify.delta;
  else if (completed) msg = "今日已完成，未产生新增奖励";
  else if (reported && clicked) msg = "两步上报成功，但能量余额未变化";
  else if (!reported) msg = "分享上报失败: " + responseMessage(rep);
  else msg = "点击回调失败: " + responseMessage(clickResp);

  return {
    ok: rewarded || completed,
    rewarded: rewarded,
    reported: reported,
    clicked: clicked,
    completed: completed,
    msg: msg,
    verify: verify,
    reportResponse: rep,
    clickResponse: clickResp,
  };
}

async function getSecondaryAccessToken(rt, deviceId) {
  var refreshed = await doRefresh(rt, deviceId || DEVICE_ID);
  if (isOk(refreshed)) {
    var dto = (refreshed.data || {}).centerTokenDto || {};
    if (dto.token) return { token: dto.token, newRT: dto.refreshToken || null, source: "refresh" };
  }

  // 兼容用户填入短效 accessToken 的情况。
  var probe = await apiGet("/up/api/v1/userReward/getContinueDaysAndSignCard", rt);
  if (isOk(probe)) return { token: rt, newRT: null, source: "bare" };
  return { token: null, newRT: null, source: "failed", error: responseMessage(refreshed) };
}

async function doSecondaryShareTask(clickToken, mainToken, context, energyBefore) {
  var lookup = await shareLookup(clickToken, context.shareCode);
  var check = await shareCheck(clickToken, context.businessNo, context.shareCode);
  var report = await shareReport(clickToken, context.businessNo, context.shareCode);
  log("B账号 lookup: " + responseMessage(lookup));
  log("B账号 check: " + responseMessage(check));
  log("B账号 report: " + responseMessage(report));

  var verify = await verifyReward(mainToken, energyBefore);
  var rewarded = verify.delta != null && verify.delta > 0;
  var completed = alreadyDone(report);
  var accepted = shareDone(report);
  var msg;
  if (rewarded) msg = "主账号奖励已到账 +" + verify.delta;
  else if (completed) msg = "今日已完成，未产生新增奖励";
  else if (!shareDone(lookup)) msg = "lookup失败: " + responseMessage(lookup);
  else if (!shareDone(check)) msg = "check失败: " + responseMessage(check);
  else if (!accepted) msg = "report失败: " + responseMessage(report);
  else msg = "三步上报成功，但主账号能量余额未变化";

  return {
    ok: rewarded || completed,
    rewarded: rewarded,
    completed: completed,
    accepted: accepted,
    msg: msg,
    verify: verify,
    lookup: lookup,
    check: check,
    report: report,
  };
}

// ===================== 主流程 =====================

async function main() {
  log("=== 领克签到开始 ===");

  if (!REFRESH_TOKEN) {
    $notify("领克签到", "配置缺失", "请在 QX 设置中配置 lynk_refresh_token");
    return;
  }
  if (!DEVICE_ID) {
    $notify("领克签到", "配置缺失", "请在 QX 设置中配置 lynk_device_id");
    return;
  }

  // 1. 获取 accessToken
  var atResult = await getAccessToken();
  if (!atResult.token) {
    $notify("领克签到", "Token 获取失败", atResult.error || "refresh_token 可能已过期，请重新抓包");
    return;
  }
  var token = atResult.token;

  // 主账号 refreshToken 轮换保存
  if (atResult.newRT && atResult.newRT !== REFRESH_TOKEN) {
    $prefs.setValueForKey(atResult.newRT, "lynk_refresh_token");
    log("refreshToken 已自动更新");
  }

  // 2. 查询签到状态
  var signInfo = await apiGet("/up/api/v1/userReward/getContinueDaysAndSignCard", token);
  if (!isOk(signInfo)) {
    $notify("领克签到", "查询签到状态失败", JSON.stringify(signInfo).slice(0, 100));
    log("查询签到状态失败: " + JSON.stringify(signInfo));
    return;
  }
  var data = signInfo.data || {};
  var dayInfo = await apiGetTokenOnly("/up/api/v1/user/sign/day/info", token);
  log("签到日状态: " + safeResponseSummary(dayInfo));
  var signedDate = $prefs.valueForKey("lynk_last_sign_date") || "";
  var signedFromCache = signedDate === localDateKey();
  var signedFromDayInfo = signedStatusFromDayInfo(dayInfo);
  var isSigned = signedStatus(data) || signedFromDayInfo || signedFromCache;
  var streak = data.continuousSignDays || data.serialDays || data.continueDays || 0;
  var signCard = data.signCardNumber || 0;

  // 3. 执行签到
  var signResult, reward = "";
  if (isSigned) {
    signResult = "已签到"; reward = "无新增";
    if (!signedFromCache) rememberSignedToday();
    log("今日已签到" + (signedFromDayInfo ? " (day/info确认)" : (signedFromCache ? " (本地成功记录)" : "")));
  } else {
    var capProfile = capturedSignProfile();
    if (capProfile && capProfile.supported) {
      log("签到: 使用真实 APP 捕获 host=" + capProfile.baseUrl.replace(/^https?:\/\//, "") +
        " path=" + capProfile.path + " X-Ca-Key=" + capProfile.caKey +
        (capProfile.hasAppCode ? " +APPCODE" : "，不带 APPCODE") +
        "，签名头=" + capProfile.signatureHeaders);
      log("签到签名元数据: Accept=" + capProfile.accept + " Content-Type=" + capProfile.contentType +
        " X-Ca-Version=" + (capProfile.xCaVersion || "无") +
        " Content-MD5=" + (capProfile.contentMd5 ? "有" : "无") +
        " Date=" + (capProfile.hasDateHeader ? "有" : "无"));
    } else {
      if (capProfile && !capProfile.supported) {
        log("签到: 捕获配置未采用（" + capProfile.unsupportedReason + "），回退默认端点");
      }
      capProfile = null;
      log("签到: POST " + signPath() + "，X-Ca-Key=" + SIGN_CA_KEY + " + token，不带 APPCODE");
    }
    var sr = await apiPostSign(token, {}, null, null, capProfile);
    // CAClient 可能为 JSON POST 自动加入 Content-MD5；旧捕获未记录该标准头。
    // 只在明确 Invalid Signature 时用 {} 的标准 Base64-MD5 诊断重试一次。
    if (capProfile && invalidSignature(sr) && !capProfile.contentMd5) {
      log("签到: 签名被拒绝，追加 Content-MD5 后重试一次");
      var md5Profile = Object.assign({}, capProfile, { contentMd5: EMPTY_JSON_MD5_BASE64 });
      sr = await apiPostSign(token, {}, null, null, md5Profile);
      log("签到 Content-MD5 重试: " + safeResponseSummary(sr));
    }
    if (isOk(sr)) {
      signResult = "签到成功";
      rememberSignedToday();
      var d = sr.data || {};
      var parts = [];
      if (d.rewardEnergyNumber) parts.push("+" + d.rewardEnergyNumber + " 能量体");
      if (d.rewardPointNumber) parts.push("+" + d.rewardPointNumber + " Co积分");
      if (d.rewardSignCardNumber) parts.push("+" + d.rewardSignCardNumber + " 补签卡");
      reward = parts.length > 0 ? parts.join(", ") : "无奖励";
      log("签到成功: " + reward);
    } else if (alreadySignedResponse(sr)) {
      signResult = "已签到"; reward = "无新增";
      rememberSignedToday();
      log("今日已签到: " + responseMessage(sr));
    } else {
      // 某些版本会返回 HTTP 200 + 非标准业务体；用当天状态复查最终结果，
      // 但绝不只因 HTTP 200 就宣告签到成功。
      await waitSeconds(1);
      var signRecheck = await apiGet("/up/api/v1/userReward/getContinueDaysAndSignCard", token);
      if (isOk(signRecheck) && signedStatus(signRecheck.data || {})) {
        signResult = "签到成功"; reward = "复查确认已签到";
        rememberSignedToday();
        log("签到接口返回非标准响应，但复查已签到: " + safeResponseSummary(sr));
      } else {
        signResult = "签到失败";
        reward = unauthorizedConsumer(sr) ?
          "签到网关凭据无权限: Unauthorized Consumer" :
          (sr.message || sr.msg || ("接口返回异常: " + safeResponseSummary(sr)));
        log("签到失败: " + reward + "；状态复查=" + safeResponseSummary(signRecheck));
        if (unauthorizedConsumer(sr)) {
          log("签到诊断: 当前请求仍被 Consumer 权限拒绝；请核对日志中的实际 path、Key 和签名头是否来自最新捕获。");
        }
      }
    }
  }

  // 4. 账户信息 + 任务（并行）
  var energyP  = apiGet("/app/energy/myEnergy", token);
  var growthP  = apiGet("/app/energy/my/growth", token);
  var tasksP   = apiGet("/up/api/v1/userReward/getTaskList", token);
  var results  = await Promise.all([energyP, growthP, tasksP]);
  var energyResp = results[0], growthResp = results[1], tasksResp = results[2];

  var coPoint = "-", coTotal = "-";
  if (isOk(energyResp)) {
    var ed = energyResp.data || {};
    coPoint = ed.point != null ? String(ed.point) : "-";
    coTotal = ed.incomePoint != null ? String(ed.incomePoint) : "-";
  }

  var growthName = "-", rewardEnergy = "-";
  var energyBeforeShare = rewardEnergyFrom(growthResp);
  if (isOk(growthResp)) {
    var lv = ((growthResp.data || {}).accountLevelVo) || {};
    growthName = lv.name || "-";
    rewardEnergy = lv.growth != null ? String(lv.growth) : "-";
  }

  var taskLines = [];
  if (isOk(tasksResp)) {
    (tasksResp.data || []).forEach(function (t) {
      var name = t.taskName || "?";
      var proc = t.taskProcess != null ? String(t.taskProcess) : "?";
      var rw = (t.rewardContent || []).join(", ") || "无";
      var m = name.match(/(\d+)天/);
      var total = m ? Number(m[1]) : null;
      var remaining = Number(proc);
      var completed = total != null && isFinite(remaining) ? Math.max(0, total - remaining) : null;
      var disp = m && completed != null ? "已签 " + completed + " / " + total : proc;
      taskLines.push(name + ": " + disp + " (" + rw + ")");
    });
  }

  // 5. 获取统一的分享上下文。自动分享时按参考实现先等待，给签到和任务状态留出同步时间。
  var shareResults = [];
  var selfShareResult = null;
  var tokenBList = TOKEN_B_RAW.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  var deviceBList = DEVICE_ID_B_RAW.split(",").map(function (s) { return s.trim(); });
  var autoShareRequested = tokenBList.length > 0 || selfShareEnabled();
  if (autoShareRequested && SHARE_DELAY > 0) {
    log("签到后等待 " + SHARE_DELAY + " 秒再执行分享");
    await waitSeconds(SHARE_DELAY);
  }
  var shareEnergyBaseline = { response: growthResp, point: energyBeforeShare };
  if (autoShareRequested) {
    // 等待结束后重取一次基线，避免把延迟到账的签到奖励误算成分享奖励。
    shareEnergyBaseline = await readRewardEnergy(token);
    if (shareEnergyBaseline.point != null) energyBeforeShare = shareEnergyBaseline.point;
  }
  var shareContext = await getShareContext(token);
  var shareCode = shareContext.shareCode;
  log("分享文章 businessNo=" + String(shareContext.businessNo || "-") + "，" + shareContext.msg);

  // 5a. B 账号走 lookup → check → report，并核验主账号奖励变化。
  var energyCursor = energyBeforeShare;
  var finalEnergyResp = shareEnergyBaseline.response || growthResp;
  if (energyCursor == null) {
    var energyProbe = await readRewardEnergy(token);
    energyCursor = energyProbe.point;
    finalEnergyResp = energyProbe.response;
  }
  if (tokenBList.length > 0 && shareContext.businessNo && shareCode) {
    log("开始自动分享: " + tokenBList.length + " 个 B 账号");
    for (var i = 0; i < tokenBList.length; i++) {
      var bRT = tokenBList[i];
      var label = "B" + (i + 1);
      var bAuth = await getSecondaryAccessToken(bRT, deviceBList[i] || DEVICE_ID);
      if (!bAuth.token) {
        log(label + ": Token 获取失败 (" + (bAuth.error || bAuth.source) + ")");
        shareResults.push({ idx: i + 1, ok: false, msg: "Token获取失败: " + (bAuth.error || bAuth.source) });
        continue;
      }
      if (bAuth.newRT && bAuth.newRT !== bRT) {
        tokenBList[i] = bAuth.newRT;
        $prefs.setValueForKey(tokenBList.join(","), "lynk_token_b");
        log(label + ": refreshToken 已自动更新");
      }

      var bResult = await doSecondaryShareTask(bAuth.token, token, shareContext, energyCursor);
      bResult.idx = i + 1;
      shareResults.push(bResult);
      if (bResult.verify.after != null) energyCursor = bResult.verify.after;
      finalEnergyResp = bResult.verify.response;
      log(label + ": " + (bResult.ok ? "OK " : "FAIL ") + bResult.msg);
    }
  } else if (tokenBList.length > 0 && !shareCode) {
    shareResults.push({ idx: 1, ok: false, msg: "未获取到 shareCode: " + shareContext.msg });
    log("跳过 B 账号自动分享: " + shareContext.msg);
  }

  // 5b. 无小号时执行 xbgo 的 reporting + shareReporting 链路。
  if (tokenBList.length === 0 && selfShareEnabled() && shareContext.businessNo) {
    log("尝试自助分享任务 (无需小号)");
    selfShareResult = await doSelfShareTask(token, shareContext, energyCursor);
    if (selfShareResult.verify.after != null) energyCursor = selfShareResult.verify.after;
    finalEnergyResp = selfShareResult.verify.response;
    log("自助分享任务结果: " + (selfShareResult.ok ? "OK " : "FAIL ") + selfShareResult.msg);
  } else if (tokenBList.length === 0 && selfShareEnabled() && !shareContext.businessNo) {
    selfShareResult = { ok: false, msg: shareContext.msg };
  }

  // 通知显示分享后的最终余额，避免仍显示分享前数值。
  if (energyCursor != null) {
    rewardEnergy = String(energyCursor);
  }

  // 6. 构造通知
  var now = new Date();
  var timeStr = now.getFullYear() + "-" + pad2(now.getMonth() + 1) + "-" + pad2(now.getDate()) + " " +
                pad2(now.getHours()) + ":" + pad2(now.getMinutes()) + ":" + pad2(now.getSeconds());

  var lines = [];
  lines.push(signResult + " | " + reward);
  lines.push("连续签到: " + streak + "天 | 补签卡: " + signCard + "张");
  lines.push("Co积分: " + coPoint + " | 累计积分: " + coTotal);
  lines.push("能量体: " + rewardEnergy + " | 等级: " + growthName);
  if (taskLines.length > 0) {
    lines.push("---任务进度---");
    taskLines.forEach(function (l) { lines.push(l); });
  }
  if (shareContext.shareUrl && shareCode) {
    lines.push("---分享---");
    lines.push(shareContext.shareUrl);
  } else if (!shareCode) {
    lines.push("---分享码---");
    lines.push("FAIL " + shareContext.msg);
  }
  if (shareResults.length > 0) {
    var okCount = shareResults.filter(function (r) { return r.ok; }).length;
    lines.push("---自动分享 (" + okCount + "/" + shareResults.length + ")---");
    shareResults.forEach(function (r) {
      lines.push("B" + r.idx + ": " + (r.ok ? "OK" : "FAIL") + " " + r.msg);
    });
  }
  if (selfShareResult) {
    lines.push("---自助分享---");
    lines.push((selfShareResult.ok ? "OK" : "FAIL") + " " + selfShareResult.msg);
  }

  var title = signResult.indexOf("成功") >= 0 ? "领克签到成功" : "领克签到 (" + signResult + ")";
  var subtitle = timeStr + " | " + reward;
  var body = lines.join("\n");

  $notify(title, subtitle, body);
  log(body);
  log("=== 完成 ===");
}

// 顶层包裹：无论成功/异常都确保 $done() 被调用一次，避免 QX 超时强杀
var _doneCalled = false;
function safeDone() { if (!_doneCalled) { _doneCalled = true; $done(); } }

(async function () {
  try {
    await main();
  } catch (e) {
    var msg = (e && e.stack) ? e.stack : String(e);
    log("未捕获异常: " + msg);
    try { $notify("领克签到", "脚本异常", msg.slice(0, 200)); } catch (_) {}
  } finally {
    safeDone();
  }
})();
