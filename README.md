# 单词软件

一个能**装到手机桌面**的单词学习工具。纯前端，不需要注册、不需要服务器，打开就能背，断网也能背。

**在线使用**：https://yejingaaa.github.io/danci/

---

## 为什么做这个

市面上的背单词 App，大多要先下载、要注册、要登录、要看广告。我想要的只是一个打开就能背、能离线、数据存在自己手机里的东西。

找了一圈没有合适的，就自己做了。

---

## 功能

| 功能 | 说明 |
|---|---|
| 单词学习 | 卡片式学习，基于 **SM-2 间隔重复算法**安排每个词的复习时机 |
| 拼写练习 | 根据中文提示拼出单词，答错即时反馈，不泄露答案 |
| 多套词库 | 小学 / 初中 / 高中 / CET-4 / CET-6，按需选择 |
| 学习统计 | 学习进度、每日打卡、正确率等数据汇总 |
| 离线可用 | Service Worker 缓存，断网后照常使用 |
| 装到桌面 | PWA 方式添加到手机主屏，体验接近原生 App |
| 安卓安装包 | 已用 Capacitor 打包成 APK，可直接安装到安卓手机 |

---

## 怎么用

**在线（推荐）**

直接打开 https://yejingaaa.github.io/danci/

**本地运行**

```bash
git clone https://github.com/yejingaaa/danci.git
cd danci
npx serve .
```

然后用浏览器打开终端里提示的地址。

> 根目录的 `index.html` 是一个跳转页，会自动进入 `word_app_web/`。
> 真正的前端代码在 `word_app_web/` 下。

**装到手机**

- 安卓：用 Chrome / Edge 打开在线地址 → 菜单 → 「添加到主屏幕」
- 也可以直接安装打包好的 APK（在 Releases 或本地 `word_app_web/单词软件.apk`）

---

## 目录结构

```
danci/
├── index.html              # 入口跳转页
└── word_app_web/           # 应用主体
    ├── index.html          # 应用界面
    ├── css/style.css       # 样式
    ├── js/
    │   ├── app.js          # 入口与页面路由
    │   ├── study.js        # 学习流程
    │   ├── algorithm.js    # SM-2 间隔重复算法
    │   ├── db.js           # IndexedDB 数据存取
    │   ├── stats.js        # 学习统计
    │   ├── profile.js      # 个人设置
    │   └── words.js        # 词库加载
    ├── wordbooks/          # 词库（JSON）
    ├── sw.js               # Service Worker（离线缓存）
    ├── manifest.json       # PWA 配置
    └── android/            # Capacitor 安卓工程
```

---

## 技术栈

- **原生 HTML / CSS / JavaScript**，无框架、无构建步骤
- **IndexedDB** 存储学习记录，数据全部留在本地
- **SM-2 算法** 计算复习间隔
- **PWA**（Service Worker + Web App Manifest）提供离线与安装能力
- **Capacitor** 将同一套代码打包为安卓应用

---

## 开发方式

非技术背景，借助 AI 编程工具完成开发：我负责定义需求、判断功能是否可用、描述问题与迭代方向，AI 负责生成代码。

从 2026-06-10 的初版，到 06-19 的可用版本，累计 **33 次提交**，从网页版一路做到可离线、可安装的 PWA。
