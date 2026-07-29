---
name: playwright-visual-qc
description: 在真实 Bash、现有 Playwright 和用户授权输出目录可用时，对生成的 HTML 做受控多视口视觉与基础无障碍检查；没有实际运行时如实报告未验证。
---

# Playwright Visual QC

## 前置条件
只有同时满足以下条件才执行：
- 用户要求或同意生成/检查 HTML，且给出允许写入的输出目录；
- 当前 turn 真实提供 Bash；
- 当前环境可使用已安装的 Playwright；
- 待检查对象是用户授权目录中的 HTML 或受控本地预览。

不要使用 BrowserResearch 打开 localhost、私网或 file: URL。不要改动用户无关文件、安装新依赖、关闭安全限制或启动长期后台服务。

## 默认检查
渲染至少三个视口：
- Desktop：1440 × 1024；
- Tablet：768 × 1024；
- Mobile：390 × 844。

每个视口检查：
- 横向滚动、裁切、重叠和不可见主操作；
- 信息层级、CTA、订单/关键摘要和可扫描性；
- 文本可读性、对比、点击区域和状态是否只依赖颜色；
- 键盘 Tab 焦点是否可见；
- 默认、hover、focus、disabled、loading、empty、error、success 是否已有证据或被明确列为未验证；
- 视觉语言是否自洽，是否出现无理由的卡片堆砌、伪仪表盘、过度渐变或装饰性元素。

## 交付
只有命令和截图实际成功时，才报告：
- 使用的 Playwright 命令或脚本；
- 每个视口；
- 截图的完整路径；
- 发现的问题、修复内容和剩余风险；
- `PASS` 或 `NEEDS_WORK`。

如果无法运行 Playwright，仍可做静态审查，但必须清楚写为“未执行浏览器验证”，不能伪造截图或通过结论。
