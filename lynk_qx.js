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
 *   lynk_share_cid           分享文章 ID（可选，默认热门 ID）
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
  SHARE_CID:    "2072260486405246976", // 分享文章 ID
  SELF_SHARE:   "1",  // 单步自助分享开关："1"开/"0"关；没配小号时用主账号自身上报（实验性）
};

// 方法二：QX 偏好设置读取（有值则覆盖上面的 CONFIG）
const REFRESH_TOKEN = $prefs.valueForKey("lynk_refresh_token") || CONFIG.REFRESH_TOKEN || "";
const DEVICE_ID     = $prefs.valueForKey("lynk_device_id")     || CONFIG.DEVICE_ID     || "";
const TOKEN_B_RAW   = $prefs.valueForKey("lynk_token_b")       || CONFIG.TOKEN_B      || "";
const SHARE_CID     = $prefs.valueForKey("lynk_share_cid")     || CONFIG.SHARE_CID   || "2072260486405246976";
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
const APP_CODE   = "3fa3314998bd4195a9fe2df3e85e6a12";
const SIG_HDRS   = "X-Ca-Key,X-Ca-Timestamp,X-Ca-Nonce,X-Ca-Signature-Method";
const APP_VERSION      = "4.2.0";   // APP 版本号（与 doRefresh 一致）
const APP_VERSION_CODE = "40200106"; // APP build 号（与 doRefresh 一致）

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
function hmacSign(method, path, params) {
  var t = ts();
  var n = nonce();

  var url = path;
  if (params && Object.keys(params).length > 0) {
    var sorted = Object.keys(params).sort().map(function (k) {
      return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
    }).join("&");
    if (sorted) url = path + "?" + sorted;
  }

  var parts = [
    method.toUpperCase(),
    "*/*",
    "",
    "application/json",
    "",
    "X-Ca-Key:" + CA_KEY,
    "X-Ca-Nonce:" + n,
    "X-Ca-Signature-Method:HmacSHA256",
    "X-Ca-Timestamp:" + t,
    url,
  ];
  var strToSign = parts.join("\n");
  var sig = hmacSha256Base64(CA_SECRET, strToSign);

  return {
    "X-Ca-Key": CA_KEY,
    "X-Ca-Timestamp": t,
    "X-Ca-Nonce": n,
    "X-Ca-Signature-Method": "HmacSHA256",
    "X-Ca-Signature-Headers": SIG_HDRS,
    "X-Ca-Signature": sig,
    "Accept": "*/*",
  };
}

// 带查询串的 GET（签名里把 query 一并签进去，与 QX 网关一致）
function buildUrlAndSign(method, path, params) {
  var qs = "";
  if (params && Object.keys(params).length > 0) {
    qs = Object.keys(params).sort().map(function (k) {
      return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
    }).join("&");
  }
  var signParams = qs ? params : null;
  var sig = hmacSign(method, path, signParams);
  var url = API_BASE + path + (qs ? "?" + qs : "");
  return { url: url, sig: sig };
}

// ===================== HTTP =====================

function httpGet(url, headers) {
  return new Promise(function (resolve) {
    $task.fetch({ url: url, method: "GET", headers: headers || {} })
      .then(function (resp) {
        try { resolve(JSON.parse(resp.body)); }
        catch (_) { resolve({ code: resp.statusCode, raw: resp.body }); }
      }, function (err) {
        resolve({ code: "NET_ERR", message: String(err) });
      });
  });
}

function httpPost(url, headers, body) {
  return new Promise(function (resolve) {
    $task.fetch({ url: url, method: "POST", headers: headers || {}, body: JSON.stringify(body || {}) })
      .then(function (resp) {
        try { resolve(JSON.parse(resp.body)); }
        catch (_) { resolve({ code: resp.statusCode, raw: resp.body }); }
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
    saveATCache(dto.token);
    log("accessToken: refresh 成功");
    return { token: dto.token, source: "refresh", newRT: dto.refreshToken || null };
  }

  // 降级：直接试探它本身是不是有效 accessToken（例如用户误填了 accessToken）
  var test = await apiGet("/up/api/v1/userReward/getContinueDaysAndSignCard", REFRESH_TOKEN);
  if (isOk(test)) {
    saveATCache(REFRESH_TOKEN);
    log("accessToken: 降级为直接使用");
    return { token: REFRESH_TOKEN, source: "bare", newRT: null };
  }

  return { token: null, source: "failed", newRT: null };
}

// ===================== 业务 API =====================

// extraHeaders 在签名之后合并（这些头不参与签名，与官方一致，如风险控制头 risk_request_info）
function apiGet(path, token, params, extraHeaders) {
  var bs = buildUrlAndSign("GET", path, params);
  var headers = Object.assign({}, bs.sig, { "token": token, "content-type": "application/json" });
  if (extraHeaders) Object.assign(headers, extraHeaders);
  return httpGet(bs.url, headers);
}

function apiPost(path, token, body, params, extraHeaders) {
  var bs = buildUrlAndSign("POST", path, params);
  var headers = Object.assign({}, bs.sig, { "token": token, "content-type": "application/json" });
  if (extraHeaders) Object.assign(headers, extraHeaders);
  return httpPost(bs.url, headers, body || {});
}

// 不带 token 的 POST（用于 shareReporting：模拟访客点击分享链接，服务器视为"被他人阅读"）
// 签名不含 token，所以签名仍然有效
function apiPostNoToken(path, body, params) {
  var bs = buildUrlAndSign("POST", path, params);
  var headers = Object.assign({}, bs.sig, { "content-type": "application/json" });
  return httpPost(bs.url, headers, body || {});
}

// —— 自动分享三步（与已验证的 Python 青龙版逻辑一致）——
// 1) lookup：反查分享人 userId
function shareLookup(token, shareCode) {
  return apiPost("/app/v1/task/shareCodeToUserId", token, { shareCode: shareCode });
}
// 2) check：后端前置校验（contentId + shareCode）
function shareCheck(token, contentId, shareCode) {
  return apiPost("/app/v1/task/shareContentContectCheck", token, { contentId: contentId, shareCode: shareCode });
}
// 3) report：真正加分（contentId + shareCode）
function shareReport(token, contentId, shareCode) {
  return apiPost("/app/v1/task/shareContentContectReporting", token, { contentId: contentId, shareCode: shareCode });
}

// —— 自助分享任务（迁移自 xbgo/lynkco-daily 的实测有效逻辑，单账号即可加分）——
// 核心链路：取社区文章 → getShareCode(带风险头) → reporting?type=99(带token="我分享了") → shareReporting(不带token="被人点击了")
// 关键：shareReporting 不带 token，服务器视为访客点击分享链接，给分享者加"被阅读"分。

// 构造文章分享 H5 链接（与官方 build_article_share_url 一致）
function buildArticleShareUrl(articleId) {
  var route = "lynkco://wx/?routeUrl=/pages/exploration/article/index.js?id=" + articleId;
  return "https://app.lynkco.com/app-h5/dist/web/pages/exploration/article/index.html?id=" +
    articleId + "&isShare=" + encodeURIComponent(route);
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
    "appVersion": appVersion || "4.2.3",
    "risk_request_info": JSON.stringify(riskInfo),
  };
}

// APP 特征头（让业务 API 请求看起来像官方 APP 发的，绕过 getShareCode 的风控拦截）
// 这些头在 doRefresh 里就有，业务 API 之前没带 → 风控返回 share.need.validate.check
function buildAppHeaders() {
  return {
    "Authorization": "APPCODE " + APP_CODE,
    "publicplatform": "iOS",
    "user-agent": "CA_iOS_SDK_2.0",
    "gl_dev_id": DEVICE_ID || "",
    "appversioncode": APP_VERSION,
    "appversionname": APP_VERSION_CODE,
    "gl_app_version": APP_VERSION,
    "gl_app_build": APP_VERSION_CODE,
    "x-ca-version": "1",
  };
}

// 判定分享类响应是否算完成（成功 / 今日已完成 均视为 OK）
function shareDone(resp) {
  if (isOk(resp)) return true;
  var m = resp && resp.message ? String(resp.message) : "";
  return m.indexOf("已分享") >= 0 || m.indexOf("已完成") >= 0 || m.indexOf("已领取") >= 0 ||
         m.indexOf("今日已") >= 0 || m.indexOf("已结束") >= 0;
}

// 执行一次自助分享任务，返回 { ok, msg, businessNo }
async function doShareTask(token) {
  // 1. 确定要分享的文章 businessNo：优先取最新社区文章，失败回退到配置 SHARE_CID
  var businessNo = null;
  try {
    var sq = await apiPost("/app/explore/home-page/square/index2", token, {});
    if (isOk(sq)) businessNo = findFirstArticleId(sq.data);
  } catch (_) {}
  if (!businessNo) businessNo = SHARE_CID;
  if (!businessNo) { log("自助分享: 无可分享文章"); return { ok: false, msg: "无可分享文章" }; }
  log("自助分享文章 businessNo=" + businessNo);

  var shareUrl = buildArticleShareUrl(businessNo);
  var eventData = { firstClassification: "文章", secondClassification: "" };

  // 2. 取 shareCode：合并 APP 特征头 + 风险头（风控需要"看起来像 APP 发的请求"）
  //    如果风控返回 share.need.validate.check，等几秒重试一次（风控有时是短窗口限流）
  var shareCode = null;
  var scResp = null;
  var appHeaders = buildAppHeaders();
  var riskHeaders = buildRiskHeaders(shareUrl, APP_VERSION);
  var allHeaders = Object.assign({}, appHeaders, riskHeaders);  // 风险头覆盖同名字段

  for (var attempt = 1; attempt <= 2; attempt++) {
    try {
      scResp = await apiGet("/app/v1/task/getShareCode", token, null, allHeaders);
      log("getShareCode 尝试" + attempt + ": code=" + String(scResp.code) + " shareCode=" + (scResp.data ? String(scResp.data).substring(0, 16) + "..." : "null"));
      if (isOk(scResp) && scResp.data) {
        shareCode = String(scResp.data);
        break;
      }
      // 风控限流：等 3 秒重试
      if (scResp && (String(scResp.code) === "share.need.validate.check" || String(scResp.message || "").indexOf("验证") >= 0)) {
        if (attempt === 1) {
          log("getShareCode 风控拦截，3秒后重试");
          await new Promise(function (r) { setTimeout(r, 3000); });
          continue;
        }
      }
      break;  // 其他错误不重试
    } catch (e) {
      log("getShareCode 异常: " + e);
      break;
    }
  }

  // 3. 主上报 reporting?type=99（带 token = "我分享了这个内容"）
  var rep = await apiPost("/app/v1/task/reporting", token, { businessNo: businessNo, eventData: eventData }, { type: "99" });
  log("reporting?type=99: code=" + String(rep.code) + " msg=" + String(rep.message || ""));

  // 4. shareReporting?shareCode（不带 token = 模拟访客点击/阅读分享链接）
  //    服务器看到无 token 请求，判定为"他人点击了你的分享"，给分享者加"被阅读"分
  var clickOk = false;
  if (shareCode) {
    var scRep = await apiPostNoToken("/app/v1/task/shareReporting",
      { businessNo: businessNo, eventData: eventData }, { shareCode: shareCode });
    log("shareReporting(无token): code=" + String(scRep.code) + " msg=" + String(scRep.message || ""));
    clickOk = shareDone(scRep);
  } else {
    log("shareReporting 跳过: 无 shareCode（getShareCode 被风控拦截）");
  }

  // 结果判定
  var ok = shareDone(rep);
  var msg;
  if (ok && clickOk) msg = "成功+被点击";
  else if (ok && !clickOk) msg = "成功(被点击未确认)";
  else msg = (rep.message || String(rep.code));
  return { ok: ok, msg: msg, businessNo: businessNo, shareCode: shareCode ? "有" : "无", clickOk: clickOk };
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
    $notify("领克签到", "Token 获取失败", "refresh_token 可能已过期，请重新抓包");
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
  var isSigned = data.signStatus === 1 || data.signStatus === true ||
                 data.signStatus === "1" || data.signStatus === "signed";
  var streak = data.continuousSignDays || data.serialDays || data.continueDays || 0;
  var signCard = data.signCardNumber || 0;

  // 3. 执行签到
  var signResult, reward = "";
  if (isSigned) {
    signResult = "已签到"; reward = "无新增"; log("今日已签到");
  } else {
    var sr = await apiPost("/up/api/v1/user/sign", token, {});
    if (isOk(sr)) {
      signResult = "签到成功";
      var d = sr.data || {};
      var parts = [];
      if (d.rewardEnergyNumber) parts.push("+" + d.rewardEnergyNumber + " 能量体");
      if (d.rewardPointNumber) parts.push("+" + d.rewardPointNumber + " Co积分");
      if (d.rewardSignCardNumber) parts.push("+" + d.rewardSignCardNumber + " 补签卡");
      reward = parts.length > 0 ? parts.join(", ") : "无奖励";
      log("签到成功: " + reward);
    } else {
      signResult = "签到失败"; reward = sr.message || "未知错误";
      log("签到失败: " + reward);
    }
  }

  // 4. 账户信息 + 任务 + 分享码（并行）
  var energyP  = apiGet("/app/energy/myEnergy", token);
  var growthP  = apiGet("/app/energy/my/growth", token);
  var tasksP   = apiGet("/up/api/v1/userReward/getTaskList", token);
  var shareP   = apiGet("/app/v1/task/getShareCode", token);
  var results  = await Promise.all([energyP, growthP, tasksP, shareP]);
  var energyResp = results[0], growthResp = results[1], tasksResp = results[2], shareResp = results[3];

  var energyPoint = "-", energyTotal = "-";
  if (isOk(energyResp)) {
    var ed = energyResp.data || {};
    energyPoint = ed.point != null ? String(ed.point) : "-";
    energyTotal = ed.incomePoint != null ? String(ed.incomePoint) : "-";
  }

  var growthName = "-", growthValue = "-";
  if (isOk(growthResp)) {
    var lv = ((growthResp.data || {}).accountLevelVo) || {};
    growthName = lv.name || "-";
    growthValue = lv.growth != null ? String(lv.growth) : "-";
  }

  var taskLines = [];
  if (isOk(tasksResp)) {
    (tasksResp.data || []).forEach(function (t) {
      var name = t.taskName || "?";
      var proc = t.taskProcess != null ? String(t.taskProcess) : "?";
      var rw = (t.rewardContent || []).join(", ") || "无";
      var m = name.match(/(\d+)天/);
      var disp = m ? String(Number(m[1]) - Number(proc)) + " / " + m[1] : proc;
      taskLines.push(name + ": " + disp + " (" + rw + ")");
    });
  }

  var shareCode = null;
  if (shareResp.code === "success") {
    var scData = shareResp.data;
    if (typeof scData === "string" && /^[A-Fa-f0-9]{32,}$/.test(scData)) shareCode = scData;
  }

  // 5. 自动分享刷积分（B 账号走 lookup → check → report 三步）
  var shareResults = [];
  var tokenBList = TOKEN_B_RAW.split(",").map(function (s) { return s.trim(); }).filter(Boolean);

  if (tokenBList.length > 0 && shareCode) {
    log("开始自动分享: " + tokenBList.length + " 个 B 账号");
    for (var i = 0; i < tokenBList.length; i++) {
      var bRT = tokenBList[i];
      var label = "B" + (i + 1);

      var bResp = await doRefresh(bRT, DEVICE_ID);
      if (!isOk(bResp)) {
        log(label + ": refresh 失败 (" + (bResp.message || bResp.code) + ")");
        shareResults.push({ idx: i + 1, ok: false, msg: "refresh 失败" });
        continue;
      }
      var bAT = ((bResp.data || {}).centerTokenDto || {}).token;
      if (!bAT) {
        log(label + ": 未获取到 accessToken");
        shareResults.push({ idx: i + 1, ok: false, msg: "无 accessToken" });
        continue;
      }
      // B 账号 refreshToken 轮换保存
      var bNewRT = ((bResp.data || {}).centerTokenDto || {}).refreshToken;
      if (bNewRT && bNewRT !== bRT) {
        tokenBList[i] = bNewRT;
        $prefs.setValueForKey(tokenBList.join(","), "lynk_token_b");
        log(label + ": refreshToken 已自动更新");
      }

      // 三步分享
      await shareLookup(bAT, shareCode);
      await shareCheck(bAT, SHARE_CID, shareCode);
      var srResp = await shareReport(bAT, SHARE_CID, shareCode);
      var code = String(srResp.code);
      var msg = srResp.message || "";

      if (code === "200" || code === "success") {
        log(label + ": 分享上报成功");
        shareResults.push({ idx: i + 1, ok: true, msg: "成功" });
      } else if (msg.indexOf("已分享") >= 0 || msg.indexOf("已领取") >= 0 ||
                 msg.indexOf("今日已") >= 0 || msg.indexOf("已结束") >= 0) {
        log(label + ": 今日已分享 (" + msg + ")");
        shareResults.push({ idx: i + 1, ok: true, msg: "今日已分享" });
      } else {
        log(label + ": 分享上报失败 (" + code + " " + msg + ")");
        shareResults.push({ idx: i + 1, ok: false, msg: msg || code });
      }
    }
  } else if (tokenBList.length > 0 && !shareCode) {
    log("跳过自动分享: 未获取到 shareCode");
  }

  // 5b. 自助分享任务（无需小号）：迁移自 xbgo/lynkco-daily 的实测有效链路。
  //     仅当没配 B 账号、开关开启时执行；无需预置 shareCode（内部自动取文章+取码）。
  var selfShareResult = null;
  if (tokenBList.length === 0 && selfShareEnabled()) {
    log("尝试自助分享任务 (无需小号)");
    var ssr = await doShareTask(token);
    selfShareResult = { ok: ssr.ok, msg: ssr.msg };
    log("自助分享任务结果: " + (ssr.ok ? "OK" : "FAIL") + " " + ssr.msg);
  }

  // 6. 构造通知
  var now = new Date();
  var timeStr = now.getFullYear() + "-" + pad2(now.getMonth() + 1) + "-" + pad2(now.getDate()) + " " +
                pad2(now.getHours()) + ":" + pad2(now.getMinutes()) + ":" + pad2(now.getSeconds());

  var lines = [];
  lines.push(signResult + " | " + reward);
  lines.push("连续签到: " + streak + "天 | 补签卡: " + signCard + "张");
  lines.push("能量体: " + energyPoint + " | 累计: " + energyTotal);
  lines.push("等级: " + growthName + " | 成长值: " + growthValue);
  if (taskLines.length > 0) {
    lines.push("---任务进度---");
    taskLines.forEach(function (l) { lines.push(l); });
  }
  if (shareCode) {
    var isShareRaw = "lynkco://wx/?routeUrl=/pages/exploration/article/index.js?id=" + SHARE_CID;
    var isShareEnc = encodeURIComponent(isShareRaw);
    var shareUrl = "https://app.lynkco.com/app-h5/dist/web/pages/exploration/article/index.html?id=" +
      SHARE_CID + "&isShare=" + isShareEnc + "&shareCode=" + shareCode;
    lines.push("---分享---");
    lines.push(shareUrl);
  }
  if (shareResults.length > 0) {
    var okCount = shareResults.filter(function (r) { return r.ok; }).length;
    lines.push("---自动分享 (" + okCount + "/" + shareResults.length + ")---");
    shareResults.forEach(function (r) {
      lines.push("B" + r.idx + ": " + (r.ok ? "OK" : "FAIL") + " " + r.msg);
    });
  }
  if (selfShareResult) {
    lines.push("---自助分享(单步)---");
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
