# dsh-fcp · 金融消保工作台

> 在 DSH（DeepSeek Harness）里搭建一个金融消费者权益保护工作台，帮助消保从业人员把「查政策、做审查、处投诉、搞宣教、管销售、写公文」集中到一处。

面向金融机构消费者权益保护岗位的 DeepSeek Harness 插件。安装后在 DSH 左侧栏提供独立工作台，内置六位消保专家、金融技能市场、IMA / Obsidian 知识库配置、思维方法卡片、模型设置与截图提问入口；专家按任务关键词自动调度，答案优先引用知识库并输出对齐监管口径的规范公文。

- 作者：**八大权益**
- 许可证：MIT
- 当前版本：**1.0.0**（首个公开发布版本）
- 仓库：https://github.com/openfcp/dsh-fcp

## 适用人群与场景

面向银行、保险、证券、支付等机构的消保条线从业人员，以及合规、客服、内控、审计中承担消保职责的岗位：

| 业务场景 | 工作台提供的能力 |
| --- | --- |
| 政策研究 | 监管新规精读、效力辨识、影响面分析、制度修订清单 |
| 消保审查 | 产品与服务、营销宣传材料、协议条款的合规审查与整改建议 |
| 投诉管理 | 投诉分办、答复口径、溯源分析与整改闭环 |
| 金融教育 | 宣教活动策划、文案撰写、素材制作与效果评估 |
| 销售管理 | 销售行为合规、适当性管理、信息披露与双录检查 |
| 综合管理 | 消保评价、迎检准备、年度报告与规范公文输出 |

## 功能

### 首页

- 品牌 logo + 「八大权益」+「消保工作台」蓝色徽章
- 六位内置专家胶囊：政策研究、消保审查、投诉管理、金融教育、综合管理、销售管理
- **默认不选专家**：直接输入任务，系统按关键词/业务环节自动调度；也可以手动点选一位专家
- DSH 风格输入框：模型选择、文件选择、技能选择、截图、发送
- 右上角 IMA / Obsidian / 设置图标（IMA、Obsidian 配置成功后显示彩色官方 logo）

### 专家

- 内置专家不可卸载
- 设置 → 专家配置 →「＋ 添加专家（.md）」上传 Markdown，生成自定义专家卡片，可卸载

### 技能

- 技能配置读取 GitHub `openfcp/awesome-financial-skills` 目录（与 `openfcp/dsh-financial-skills` 双源校验）
- 搜索、分类、全部/已安装筛选、详情（版本/许可/作者/标签/说明）
- 安装 / 卸载；系统技能标记不可删除
- 安装状态保存在本机，不依赖「金融技能」插件
- 已安装技能会出现在首页「＋ → 选择技能」二级菜单

> 说明：当前版本的“安装”记录技能状态并加入工作台选择列表；技能文件下发到本机 skills 目录仍在后续版本。

### 知识

- **IMA**：填写 API Key 与 Client ID 后保存，自动加载该账号真实知识库，可勾选、可刷新；固定阅读「国家法律知识库」「八大权益消保知识库」
- **Obsidian**：点击 Vault 路径选择文件夹，保存后作为只读知识源
- **上传知识库**：支持 `.md` / `.zip`，加入本地知识列表
- 三个区域独立保存

> 说明：当前版本完成配置、知识库列表与本地文件登记；检索与上下文注入仍在后续版本。

### 思维

- 一个思维方式一张卡片（名称、说明、版本、内置/自定义）
- 上传 `.md` 新增卡片，自定义卡片可删除
- 思维方法不手选，由系统按任务调配

### 模型

- 默认云端模型：DeepSeek Flash / DeepSeek V4 / DeepSeek Chat
- 「设为当前」记录当前选择，首页同步显示
- 「＋ 添加模型」支持自定义显示名称、Provider、模型 ID

> 说明：当前“当前使用”是工作台内的选择；真正切换会话模型仍在后续版本。

### 截图

- 输入框「＋」右侧剪刀：优先调用 macOS 原生框选截图，失败时退回浏览器截屏
- 截图自动复制到剪贴板并显示缩略图；也可 `Cmd+Shift+4` 后 `Cmd+V` 粘贴图片
- 原生框选需要在「系统设置 → 隐私与安全性 → 屏幕录制」中允许 DeepSeek Harness

### 设置

- 顶部横向 tab：专家配置 / 技能配置 / 知识配置 / 思维配置 / 模型设置 / 帮助
- 帮助页包含首次使用、各配置项、截图、常见问题

## 安装

从 [GitHub Releases](https://github.com/openfcp/dsh-fcp/releases) 下载 `dsh-fcp-1.0.0.zip` 解压，或直接克隆本仓库：

```sh
git clone https://github.com/openfcp/dsh-fcp.git
```

然后用 DSH 命令行安装本地目录：

```sh
DSH="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"

# 从本地目录安装
"$DSH" plugin --profile desktop add "file:/path/to/dsh-fcp"

# 更新
"$DSH" plugin --profile desktop remove dsh-fcp
"$DSH" plugin --profile desktop add "file:/path/to/dsh-fcp"
```

安装或更新 Host 后需**完全退出 DSH 再打开**；只改客户端时可在页面 `Cmd+R` 刷新。

## 目录结构

```
dsh-fcp/
├── package.json
├── cordis.patch.yml
├── README.md
├── LICENSE
├── CHANGELOG.md
└── lib/
    ├── index.js        Host：路由、会话绑定、专家注入
    ├── experts.js      六位专家与关键词路由
    ├── client.js       Web 客户端：首页、设置、技能、知识、截图
    ├── logo.png
    └── assets/         IMA / Obsidian 品牌图标
```

## 数据与隐私

- 插件配置（IMA Key、Obsidian 路径、模型、技能选择）保存在浏览器 `localStorage`
- 技能安装状态保存在 `~/.dsh/storages/fcp/skills-state.json`
- 技能目录请求发往 GitHub / jsDelivr；IMA 知识库列表请求发往 `ima.qq.com`
- 截图临时文件保存在系统临时目录
- 插件不上传会话内容，不包含任何账号凭据

## 开发自检

```sh
node --check lib/index.js
node --check lib/client.js
node --check lib/experts.js
```

## 版本历史

- **1.0.0**：首个公开发布版本，元数据、文档与隐私信息规范化，详见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

MIT © 2026 八大权益
