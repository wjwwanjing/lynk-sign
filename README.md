# 领克 APP 自动签到 - QX 精简版

> iPhone QuantumultX 本地定时脚本，每天自动签到 + 查询账户信息 + 生成分享链接 + iOS 通知推送。

---

## 做了什么改动

相比原版 Python 脚本（青龙面板版），这个 QX 版本做了大幅精简：

| 删除 | 原因 |
|------|------|
| License / RSA 授权验证 | 不再需要找作者申请授权 |
| 反调试 / 反篡改检测 | QX 本地脚本无需这些保护 |
| 青龙面板相关逻辑 | QX 自带定时器和持久化存储 |
| B 账号自动分享刷积分（三步流程） | 保留原 Python 版 `lookup → check → report` 三步真实接口（已验证可加分，不依赖猜测的单步端点） |
| 7 种第三方推送渠道 | 直接用 QX 原生 iOS 通知 |

| 保留 | 说明 |
|------|------|
| 每日签到 | 核心功能 |
| Token 缓存 + 自动轮换 | refreshToken 28 天自动续期 |
| 账户信息查询 | 能量体 / 成长等级 / 任务进度 |
| 分享链接生成 | 可复制到微信发，别人点击你 +5 能量体 |
| HMAC-SHA256 签名 | 阿里云 API 网关要求 |
| 自动分享刷积分（三步版） | 用 `lookup → check → report` 三步真实接口，与原 Python 版一致 |

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

### 3. 配置脚本

**方法一：直接编辑脚本**

用文本编辑器打开 `lynk_qx.js`，修改顶部的配置区域：

```javascript
const REFRESH_TOKEN = $prefs.valueForKey("lynk_refresh_token") || "bearer你的refreshToken";
const DEVICE_ID     = $prefs.valueForKey("lynk_device_id")     || "你的device_id";
```

把你的值填到引号里（`||` 后面），保存。

**方法二：通过 QX 偏好设置**

QX → 设置 → 其他设置 → 脚本 → 找到 lynk_qx.js → 配置：

| 配置项 | 说明 |
|--------|------|
| `lynk_refresh_token` | refreshToken（`bearer<uuid>` 格式） |
| `lynk_device_id` | 设备 ID |
| `lynk_token_b` | B 账号 refreshToken，逗号分隔多个（可选，用于自动分享） |
| `lynk_share_cid` | 分享文章 ID（可选，默认 `2072260486405246976`） |

### 4. 添加到 QX 定时任务

打开 QX 配置文件（长按底部风车图标 → 配置文件），在 `[task_local]` 段添加：

```ini
[task_local]
0 9 * * * https://你的地址/lynk_qx.js, tag=领克签到, enabled=true
```

> 如果是本地脚本，把 URL 换成脚本的本地路径或 iCloud 路径。

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

本版本沿用原 Python 青龙版的 `lookup → check → report` 三步真实接口（与 APP 抓包看到的端点一致，已验证可加分），不再使用原 QX 精简版里"猜测"的单步 `shareReporting` 端点：

```
POST /app/v1/task/shareCodeToUserId       {shareCode: 主账号分享码}   # 1. 反查分享人
POST /app/v1/task/shareContentContectCheck {contentId, shareCode}     # 2. 后端前置校验
POST /app/v1/task/shareContentContectReporting {contentId, shareCode} # 3. 真正上报加分
```

直接让服务器认为该 B 账号已点击了你的分享链接，主账号获得 +5 能量体/人/天。

### 配置方法

在 QX 偏好设置中添加 `lynk_token_b`，填入 B 账号的 refreshToken（多个用英文逗号分隔）：

```
lynk_token_b = bearerB账号1的refreshToken,bearerB账号2的refreshToken
```

不填则不启用自动分享，脚本仍然会生成分享链接供你手动复制。

### 工作流程

1. 主账号获取 shareCode
2. 对每个 B 账号：refresh 拿 accessToken → 调 `shareReporting` 上报
3. B 账号的 refreshToken 也会自动续期保存
4. 通知里展示每个 B 账号的分享结果

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
  连续签到7天: 4 / 7 (1能量体)
  本月度签到25天: 7 / 25 (1补签卡)
  ---分享---
  https://h5.lynkco.com/...
  ---自动分享 (1/1)---
  B1: OK 成功
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

**脚本怎么调试？**
QX → 工具箱 → 脚本 → 选脚本 → 运行，底部可以看 console.log 输出。

**分享链接点不开？**
链接比较长，确保完整复制。部分微信版本可能需要长按链接才能打开。

---

## 文件说明

| 文件 | 说明 |
|------|------|
| `lynk_qx.js` | QX 定时脚本（当前使用） |
| `ql_lynk.py` | 原版 Python 脚本（青龙面板版，含 License 系统，供参考） |

---

## 安全提示

- 所有 Token 只存储在 QX 本地，不会上传到任何服务器
- 仅供个人学习研究使用，请遵守领克 APP 用户协议
- 抓包获取的 Token 请妥善保管，不要外泄
