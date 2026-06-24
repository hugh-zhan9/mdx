# HTML 渲染测试

## 行内 HTML 标签测试

这是一些行内 HTML 标签：

- 快捷键：按 <kbd>Command</kbd> + <kbd>Z</kbd> 撤销
- 高亮：这是 <mark>重要内容</mark> 需要注意
- 化学式：水的化学式是 H<sub>2</sub>O
- 数学：勾股定理 a<sup>2</sup> + b<sup>2</sup> = c<sup>2</sup>
- 缩写：<abbr title="HyperText Markup Language">HTML</abbr> 是网页标记语言
- 引用：参考 <cite>《设计模式》</cite> 一书
- 变量：函数参数 <var>x</var> 和 <var>y</var>
- 示例输出：程序输出 <samp>Hello, World!</samp>
- 时间：会议时间 <time datetime="2026-06-22">2026年6月22日</time>
- 小号文本：这是正常文本，<small>这是小号文本</small>

## 块级 HTML 测试

### Details 折叠块

<details>
  <summary>点击展开详情</summary>
  <p>这是隐藏的详细内容。</p>
  <ul>
    <li>列表项 1</li>
    <li>列表项 2</li>
    <li>列表项 3</li>
  </ul>
</details>

### 嵌套的 Details

<details>
  <summary>外层折叠</summary>
  <p>外层内容</p>
  <details>
    <summary>内层折叠</summary>
    <p>内层内容</p>
  </details>
</details>

## 混合测试

在段落中使用 <mark>高亮</mark> 和 <kbd>Command</kbd>，然后是一个折叠块：

<details>
  <summary>更多信息</summary>
  <p>化学式 H<sub>2</sub>O 和数学公式 E = mc<sup>2</sup></p>
</details>

## 不支持的 HTML（应该显示为 source_fallback）

<div class="custom-block">
  <p>这是自定义的 div 块</p>
</div>
