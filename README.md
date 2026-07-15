# 领克 APP 自动签到 - QX

> iPhone QuantumultX 本地定时脚本，每天自动签到 + 查询账户信息 + 生成分享链接 + iOS 通知推送。

---

## 功能特性

纯本地运行、零外部代码依赖，所有逻辑都在你自己的 QX 里执行：

| 功能 | 说明 |
|------|------|
| 每日自动签到 | 核心功能，由 QX 自带定时器触发 |
| Token 缓存 + 自动轮换 | refreshToken 28 天自动续期，无需反复抓包 |
| 账户信息查询 | 能量体 / 成长等级 / 任务进度 |
| 分享链接生成 | 可复制到微信发，别人点击你 +5 能量体 |
| 自动分享与奖励核验 | 配小号走三步接口；无小号走 `reporting + shareReporting`；最后比较主账号分享前后的能量余额 |
| HMAC-SHA256 签名 | 纯 JS 实现，满足阿里云 API 网关要求 |
| iOS 原生通知 | 结果直接推到通知栏，不依赖任何第三方推送渠道 |

---

## 快速开始

### 1. 安装 QuantumultX

App Store 购买并安装 [QuantumultX](https://apps.apple.com/app/quantumult-x/id1443988620)。

### 2. 抓包获取 Token

需要从领克 APP 抓两个值：**refreshToken** 和 **device_id**。

**具体操作：**

1. 在 QX 里开启 MITM（中间人）抓包
2. 安装并信任 CA 证书（QX → 其他设置 → MITM → 生成证书 → 安装 → 到系统设置里信任）
3. **先开抓包，再登录领克 APP**（refreshToken 只在登录响应里返回一次）
4. 登录成功后停止抓包

**找 refreshToken：**

在抓包记录里搜索 `mobileCodeLogin`，找到登录响应：

```json
{
  "code": "success",
  "data": {
    "centerTokenDto": {
      "token": "bearer<这是accessToken，10分钟有效，不要用>",
      "refreshToken": "bearer<这个就是要的，28天有效>",
      "refreshExpireAt": 1780000000000,
      "expireAt": 1780000000000
    }
  }
}
```

> 注意：`token` 和 `refreshToken` 长得一模一样，别搞混了。`refreshToken` 那个才是我们要的。

**找 device_id：**

随便找一个 `app-api-gw-toc.lynkco.com` 的请求，看请求头里的 `gl_dev_id` 字段，或者从登录 URL 的 `deviceId` 参数里拿。

### 2.5 自动获取 Token（推荐，免手动抓包）★

不想每次手动找 `refreshToken` / `device_id`？用 QX 的「重写规则」让脚本在登录时**自动拦截并保存** refreshToken、设备 ID 和实际 App 版本，配置一次永久免维护（之后每次刷新也会静默续期）。

**前提（一次性手动，绕不过）**：QX 已装好并信任 MITM CA 证书（设置 → 其他设置 → MITM → 生成证书 → 安装 → 到系统设置里信任）。这是 iOS 系统限制，任何自动化都无法免除。

**推荐做法：订阅远程重写模块（一行搞定，免手动写规则）**

打开 QX 配置文件（长按底部风车 → 配置文件），在 `[rewrite_remote]` 段加入一行，直接订阅仓库里的远程重写链接：

```ini
[rewrite_remote]
https://raw.githubusercontent.com/wjwwanjing/lynk-sign/main/lynk_rewrite.conf, tag=领克Token自动提取, update-interval=172800, opt-parser=false, enabled=true
```

这个远程模块（`lynk_rewrite.conf`）里已经写好了拦截规则和 `hostname`，QX 会自动拉取并合并 MITM 域名，你**不用再手动加 `[rewrite_local]` 规则、也不用手动配 hostname**。

> `update-interval=172800` 表示每 2 天自动检查一次远程更新；改了远程规则后也可在 QX「重写」页面下拉手动刷新。

**接下来**：

1. 确保 QX「重写」总开关已打开（底部风车 → 重写）。
2. 打开领克 APP **重新登录一次**（退出账号再登，或杀进程重登），拦截器会自动把 `refreshToken` 和 `device_id` 写入本地偏好，并弹一条「领克Token已自动保存」通知。之后每天自动签到时也会静默续期。

> 想手动写规则也行：在 `[rewrite_local]` 段加
> `^https?://app-services\.lynkco\.com\.cn/.*login url script-response-body https://raw.githubusercontent.com/wjwwanjing/lynk-sign/main/lynk_token.js`
> 并在 `[mitm]` 段的 `hostname` 里补上 `app-services.lynkco.com.cn`（脚本在本地则把末尾 URL 换成 `lynk_token.js` 文件名）。

> 自动获取后，下面「方法二：QX 偏好设置」里的 `lynk_refresh_token` / `lynk_device_id` **不用再手动填**；想临时覆盖仍可手动填（优先级更高）。`lynk_token_b`（B 账号）仍需手动填。

### 3. 配置脚本

**方法一：直接编辑脚本**

用文本编辑器打开 `lynk_qx.js`，修改顶部的配置区域：

```javascript
const CONFIG = {
  REFRESH_TOKEN: "bearer你的refreshToken",
  DEVICE_ID: "你的device_id",
  // 其余配置保持默认即可
};
```

把你的值填到引号里（`||` 后面），保存。

**方法二：通过 QX 偏好设置**

QX → 设置 → 其他设置 → 脚本 → 找到 lynk_qx.js → 配置：

| 配置项 | 说明 |
|--------|------|
| `lynk_refresh_token` | refreshToken（`bearer<uuid>` 格式） |
| `lynk_device_id` | 设备 ID |
| `lynk_token_b` | B 账号 refreshToken，逗号分隔多个（可选，用于三步分享） |
| `lynk_device_id_b` | B 账号设备 ID，逗号分隔并与 B Token 一一对应；留空时使用主账号设备 ID |
| `lynk_share_cid` | 分享文章 ID（可选，默认 `2072260486405246976`） |
| `lynk_share_app_version` | `getShareCode` 风控头中的 App 版本，默认 `4.2.3`；若抓包值不同可覆盖 |
| `lynk_share_delay` | 签到后等待再分享的秒数，默认 `60`（与 `xbgo/lynkco-daily` 一致） |
| `lynk_verify_delay` | 点击回调后等待服务端记账的秒数，默认 `3` |
| `lynk_sign_path` | 签到端点覆盖，默认 `/up/api/v1/user/sign` |
| `lynk_self_share` | 单步自助分享开关（`"1"`开/`"0"`关，默认开，无小号时用主账号自身上报，实验性） |

### 4. 添加到 QX 定时任务

打开 QX 配置文件（长按底部风车图标 → 配置文件），在 `[task_local]` 段添加：

```ini
[task_local]
0 9 * * * https://raw.githubusercontent.com/wjwwanjing/lynk-sign/main/lynk_qx.js, tag=领克签到, enabled=true
```

> 使用你自己的 GitHub 仓库的 **raw 原始文件地址**（注意不是 `github.com/.../blob/...` 网页地址，那个 QX 无法执行）。
> 想完全离线 / 不依赖网络时，把地址换成本地路径或 iCloud 路径即可，例如：`0 9 * * * lynk_qx.js, tag=领克签到, enabled=true`。
> ⚠️ 用远程地址时，**Token 一定要走 QX 偏好设置（方法二），千万别写进脚本顶部的 CONFIG 区**——否则脚本提交到公开仓库会泄露你的 refreshToken。

### 5. 手动测试

QX → 工具箱 → 脚本 → 找到「领克签到」→ 点运行，看通知和日志是否正常。

---

## Token 自动续期

脚本会自动管理 Token，不需要手动维护：

- **accessToken**（约 10 分钟有效）：每次运行时自动用 refreshToken 换取，缓存在 QX 本地，8 分钟内复用
- **refreshToken**（28 天有效）：每次 refresh 会返回新的 refreshToken，脚本自动保存

只要脚本每天正常运行，refreshToken 会一直自动续期，不需要重新抓包。

> 如果停用了 28 天以上没跑，refreshToken 会过期，需要重新抓包获取。

---

## 自动分享刷积分（可选）

脚本支持两种分享方式，**根据你有没有配小号自动选择**：

### 方式 A：三步分享（配了小号时使用）

使用 `lookup → check → report` 三步接口（来自 `spritekite/lynk_auto_sign-20260709`）：

```
POST /app/v1/task/shareCodeToUserId       {shareCode: 主账号分享码}   # 1. 反查分享人
POST /app/v1/task/shareContentContectCheck {contentId, shareCode}     # 2. 后端前置校验
POST /app/v1/task/shareContentContectReporting {contentId, shareCode} # 3. 真正上报加分
```

用小号（B 账号）提交主账号分享码。新版脚本会读取**主账号**上报前后的能量余额；只有余额增加才显示“奖励已到账”，避免把单纯的接口 `success` 误报成奖励成功。

**配置**：在 QX 偏好设置中添加 `lynk_token_b`，填入 B 账号的 refreshToken（多个用英文逗号分隔）：

```
lynk_token_b = bearerB账号1的refreshToken,bearerB账号2的refreshToken
```

**工作流程**：
1. 主账号获取 shareCode
2. 对每个 B 账号：refresh 拿 accessToken → `lookup → check → report` 三步上报
3. B 账号的 refreshToken 也会自动续期保存
4. 等待 `lynk_verify_delay` 秒后查询主账号余额并计算差值
5. 通知里展示每个 B 账号的分享结果（`---自动分享 (n/N)---`）

### 方式 B：自助分享任务（不配小号，迁移自 xbgo/lynkco-daily）

**没配 `lynk_token_b` 时**，脚本会用**主账号自身**完成整套分享任务上报——**无需任何小号**。这套链路迁移自 [xbgo/lynkco-daily](https://github.com/xbgo/lynkco-daily) 的实测有效实现。

**关键原理**：分享加分分两部分——"我分享了内容" + "有人点击阅读了我的分享"。脚本通过以下方式同时完成这两步：
- `reporting?type=99` **带 token** = 上报"我分享了这个内容"
- `shareReporting?shareCode=...` **不带 token、但带 `Authorization: APPCODE ...`** = 按 H5 访客方式回调分享浏览

完整链路：

```
POST /app/explore/home-page/square/index2                      # 1. 拉社区信息流，取最新文章 articleId 作为 businessNo
GET  /app/v1/task/getShareCode        (带风险控制头)             # 2. 取 shareCode
POST /app/v1/task/reporting?type=99  {businessNo, eventData}    # 3. ★主上报（带 token = "我分享了"）
POST /app/v1/task/shareReporting?shareCode=<code> {businessNo, eventData}  # 4. 模拟被点击（不带 token = "有人阅读了"）
```

- **businessNo** 来源：优先从社区信息流 `square/index2` 取第一篇真实文章 ID；取不到才回退到配置的 `lynk_share_cid`。用真实文章而非固定 ID，更贴近官方 APP 行为。
- **shareReporting 不带 token，但不能省略 APPCODE**：`xbgo/lynkco-daily` 的请求构造器即使在 `token_required=False` 时仍保留 `Authorization: APPCODE ...`。旧 QX 版把这两个头一起删掉，是点击回调不能正常记账的主要问题。
- **请求头与参考实现一致**：大部分业务请求带 `Authorization: APPCODE ...`；签到 `/up/api/v1/user/sign` 按 spritekite 实现只带 `token + X-Ca-*`（附带 APPCODE 会返回 `403 Unauthorized Consumer`）；`getShareCode` 额外带 `use_security: true` / `risk_type: 1` / `appVersion` / `risk_request_info`（含 `openTimeStamp`、`shareContentType=1`、`shareContentURL`）。风险头在签名后合并，不参与网关签名。
- **重试机制**：若 `getShareCode` 返回风控拦截（`share.need.validate.check`），等 3 秒重试 1 次（风控有短窗口限流）
- **文章与分享码保持一致**：社区文章、风险头里的 H5 URL、`businessNo`、最终通知链接使用同一个文章 ID；不会再出现“最新文章取码、固定文章上报”的混用。
- **成功判定**：接口成功只代表“上报已受理”。脚本会在分享动作前重取余额基线，并在点击回调后再次查询主账号 `/app/energy/myEnergy`；差值大于 0 才显示“奖励已到账”，避免把延迟到账的签到奖励误算成分享奖励。
- **分享等待**：默认在签到后等 60 秒再执行分享，与参考实现一致；测试时可临时把 `lynk_share_delay` 设为 `0`。
- 开关：`lynk_self_share`，默认 `"1"`（开启）；设 `"0"` 关闭。
- 通知里以 `---自助分享---` 展示最终结果。
- 运行日志（QX 脚本日志）会打印每步的 `code` 和 `msg`，方便定位。

> ⚠️ **说明**：领克后端的每日上限、风控和奖励规则可能变化。`OK 奖励已到账 +N` 表示脚本已观察到主账号余额增加；“上报成功但余额未变化”不能视为拿到奖励，可按日志中的具体失败阶段继续排查。

> 两种方式互斥：**配了小号走 A，没配小号走 B**。都不想用就把 `lynk_self_share` 设 `"0"`，脚本仍会生成分享链接供你手动复制发人点击。

---

## 通知效果

签到成功后，iOS 通知栏会显示：

```
标题:    领克签到成功
副标题:  2026-07-09 09:00:15 | +3 能量体
内容:
  签到成功 | +3 能量体
  连续签到: 52天 | 补签卡: 0张
  能量体: 1888 | 累计: 5101
  等级: 二级 | 成长值: 1683
  ---任务进度---
  连续签到7天: 已签 4 / 7 (1能量体)
  本月度签到25天: 已签 7 / 25 (1补签卡)
  ---分享---
  https://h5.lynkco.com/...
  ---自动分享 (1/1)---
  B1: OK 主账号奖励已到账 +5
```

分享链接可以直接复制发到微信，别人点击后你 +5 能量体。

---

## 常见问题

**refreshToken 过期了怎么办？**
28 天有效，脚本会自动续期。如果停用超过 28 天没跑，需要重新抓包。

**accessToken 和 refreshToken 怎么区分？**
都长 `bearer<UUID>` 那样。看响应里的字段名：`token` 是 accessToken（10 分钟），`refreshToken` 才是 28 天的那个。

**签到失败？**
1. 先看日志（QX → 工具箱 → 脚本 → 日志）
2. 最常见原因是 refreshToken 过期，重新抓包
3. 如果提示"已签到"说明之前已经签过了，正常
4. 如果执行签到提示 `403 Unauthorized Consumer`，先不要套用 Android 的 `app-services + CEP` 请求格式；该格式在当前 iOS/QX 实测为网络异常。更新重写模块后，在下一次尚未签到时先用领克 APP 手动签到，捕获真实 POST 到 `lynk_sign_capture`。已经签到时只能捕获 `/user/sign/day/info` 或 `getContinueDaysAndSignCard` 状态 GET；`userSignTip/getTipConfig` 等提示配置接口会被忽略。捕获内容不会保存 Token、签名或请求正文值。

**脚本怎么调试？**
QX → 工具箱 → 脚本 → 选脚本 → 运行，底部可以看 console.log 输出。

**分享链接点不开？**
链接比较长，确保完整复制。部分微信版本可能需要长按链接才能打开。

**分享接口显示 success，但为什么没有奖励？**

`success` 只表示服务端接受请求，不表示奖励一定入账。看通知和日志中的余额差值：

- `奖励已到账 +N`：已确认余额增加
- `两步/三步上报成功，但能量余额未变化`：请求成功但没有新奖励，常见于今日已领取、风控或后端规则变化
- `getShareCode ...`：取分享码失败，重点检查 `risk_request_info`、设备 ID 和 App 版本
- `点击回调失败 ...`：重点检查匿名回调是否带 APPCODE、是否不带 token

---

## 文件说明

| 文件 | 说明 |
|------|------|
| `lynk_qx.js` | QX 定时脚本（当前使用） |
| `lynk_token.js` | QX 重写脚本，自动拦截登录/刷新响应并保存 Token（免手动抓包） |
| `lynk_rewrite.conf` | QX 远程重写模块，供 `[rewrite_remote]` 一行订阅（含拦截规则 + hostname） |

---

## 安全提示

- 所有 Token 只存储在 QX 本地，不会上传到任何服务器
- 仅供个人学习研究使用，请遵守领克 APP 用户协议
- 抓包获取的 Token 请妥善保管，不要外泄
- 使用 GitHub 远程地址时，脚本每次运行从你的仓库拉最新版；Token 仍只存 QX 本地（走偏好设置），不会进仓库。仓库若设为 public，请勿在脚本 CONFIG 区写入任何 Token
