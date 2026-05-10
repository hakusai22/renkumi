import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Renkumi | 产品介绍",
  description: "Renkumi（レンクミ）把产品描述、截图和 Remotion 合成为可复用的发布视频工作流。",
};

const heroHighlights = [
  {
    icon: "↯",
    title: "快速生成",
    copy: "几分钟生成专业视频",
    tone: "violet",
  },
  {
    icon: "▣",
    title: "智能分镜",
    copy: "AI 自动生成分镜脚本",
    tone: "mint",
  },
  {
    icon: "●",
    title: "高度可定制",
    copy: "随心编辑，完美呈现",
    tone: "amber",
  },
];

const capabilities = [
  {
    number: "01",
    icon: "↯",
    title: "AI 驱动，高效生成",
    copy: "AI 自动分析产品描述，智能生成分镜、文案与画面，几分钟即可获得专业视频。",
    tone: "violet",
  },
  {
    number: "02",
    icon: "▣",
    title: "可编辑的分镜与脚本",
    copy: "分镜、文案、画面均可自由编辑，满足多样化表达需求。",
    tone: "mint",
  },
  {
    number: "03",
    icon: "◔",
    title: "高度可定制化",
    copy: "支持品牌风格、配色、字体等自定义，做出专属于你的产品视频。",
    tone: "amber",
  },
  {
    number: "04",
    icon: "↗",
    title: "一键导出，多端适配",
    copy: "支持多种比例和清晰度导出，完美适配各大平台发布。",
    tone: "rose",
  },
];

const metrics = [
  {
    icon: "♟",
    value: "10K+",
    label: "创作者信任使用",
    tone: "violet",
  },
  {
    icon: "▶",
    value: "50K+",
    label: "视频成功生成",
    tone: "mint",
  },
  {
    icon: "◷",
    value: "80%",
    label: "节省制作时间",
    tone: "amber",
  },
  {
    icon: "♥",
    value: "98%",
    label: "用户满意度",
    tone: "rose",
  },
];

const testimonials = [
  {
    quote: "Renkumi 让我们的视频制作效率提升了 5 倍，产品发布再也不用等视频了！",
    name: "小雨",
    role: "产品经理 · 某 SaaS 公司",
    avatar: "雨",
  },
  {
    quote: "分镜和脚本可以自由编辑，AI 生成的效果也很专业，团队都很喜欢用。",
    name: "Jason",
    role: "市场总监 · 科技公司",
    avatar: "J",
  },
  {
    quote: "操作简单，功能强大，导出的视频质量很高，强烈推荐！",
    name: "Lily",
    role: "内容创作者",
    avatar: "L",
  },
];

const footerGroups = [
  {
    title: "产品",
    links: [
      { label: "工作流", href: "#workflow" },
      { label: "能力", href: "#capabilities" },
      { label: "开始生成", href: "/generate" },
    ],
  },
  {
    title: "资源",
    links: [
      { label: "帮助中心", href: "#capabilities" },
      { label: "教程", href: "#workflow" },
      { label: "更新日志", href: "#capabilities" },
    ],
  },
  {
    title: "公司",
    links: [
      { label: "关于我们", href: "#workflow" },
      { label: "隐私政策", href: "#capabilities" },
      { label: "服务条款", href: "#capabilities" },
    ],
  },
];

export default function ProductHomePage() {
  return (
    <main className="marketing-shell">
      <nav className="marketing-nav" aria-label="产品导航">
        <Link className="marketing-brand" href="/">
          <span className="marketing-mark">レン</span>
          <span>Renkumi</span>
        </Link>
        <div className="marketing-links">
          <a href="#workflow">工作流</a>
          <a href="#capabilities">能力</a>
          <Link href="/generate">开始生成</Link>
          <Link className="marketing-nav-cta" href="/studio">
            打开工作台
          </Link>
        </div>
      </nav>

      <section className="launch-hero" id="workflow">
        <div className="marketing-container launch-hero-grid">
          <div className="launch-hero-copy">
            <p className="launch-badge">
              <span>✦</span>
              AI 驱动的产品视频生成 · レンクミ
            </p>
            <h1>
              用 <span>Renkumi</span>
              <br />
              让产品被看见
            </h1>
            <p className="launch-brand-note">
              Renkumi comes from “Render” and “Kumu” — the Japanese verb for assembling and composing.
              <strong>组合镜头与动态。</strong>
            </p>
            <p className="launch-hero-lede">
              通过 AI 分镜、智能剪辑与自动化生成，快速将产品描述和截图转化为高质量发布视频，节省时间，提升影响力。
            </p>
            <div className="launch-actions">
              <Link className="launch-primary" href="/generate">
                开始生成视频
                <span aria-hidden="true">→</span>
              </Link>
              <Link className="launch-secondary" href="/studio">
                打开工作台
              </Link>
            </div>
            <div className="launch-highlight-row" aria-label="Renkumi 核心优势">
              {heroHighlights.map((item) => (
                <div className="launch-highlight" key={item.title}>
                  <span className={`launch-soft-icon tone-${item.tone}`} aria-hidden="true">
                    {item.icon}
                  </span>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.copy}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="launch-hero-art" aria-label="AI 视频预览示意图">
            <div className="launch-bg-arc launch-bg-arc-top" />
            <div className="launch-dot-grid" />
            <div className="launch-floating-card launch-ai-score">
              <strong>
                <span>✣</span>
                AI 分镜
              </strong>
              <i />
              <i />
              <i />
            </div>
            <div className="launch-video-frame">
              <video
                className="launch-video-media"
                src="/assets/renkumi-ai-storyboard.mp4"
                poster="/assets/renkumi-ai-storyboard-poster.png"
                controls
                muted
                playsInline
                preload="metadata"
                aria-label="Renkumi AI 分镜演示视频"
              />
            </div>
            <div className="launch-floating-card launch-audio-card">
              <strong>
                <span>✂</span>
                智能剪辑
              </strong>
              <div className="launch-waveform">
                {Array.from({ length: 24 }).map((_, index) => (
                  <span key={index} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="marketing-section" id="capabilities">
        <div className="marketing-section-heading centered">
          <h2>
            为什么选择 <span>Renkumi</span>?
          </h2>
          <p>专为产品团队打造的 AI 视频生成平台</p>
        </div>
        <div className="capability-grid">
          {capabilities.map((item) => (
            <article className="capability-card" key={item.number}>
              <div className="capability-card-top">
                <span className={`launch-soft-icon tone-${item.tone}`} aria-hidden="true">
                  {item.icon}
                </span>
                <span className={`capability-number tone-${item.tone}`}>{item.number}</span>
              </div>
              <h3>{item.title}</h3>
              <p>{item.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-container stats-band" aria-label="Renkumi 关键数据">
        {metrics.map((metric) => (
          <div className="stat-item" key={metric.label}>
            <span className={`launch-soft-icon tone-${metric.tone}`} aria-hidden="true">
              {metric.icon}
            </span>
            <div>
              <strong>{metric.value}</strong>
              <p>{metric.label}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="marketing-section testimonials-section">
        <div className="marketing-section-heading centered">
          <h2>
            用户都在<span>说</span>
          </h2>
          <p>来自全球产品团队的真实反馈</p>
        </div>
        <div className="testimonial-grid">
          {testimonials.map((testimonial) => (
            <article className="testimonial-card" key={testimonial.name}>
              <p className="quote-mark">“</p>
              <p>{testimonial.quote}</p>
              <div className="testimonial-footer">
                <span>{testimonial.avatar}</span>
                <div>
                  <strong>{testimonial.name}</strong>
                  <small>{testimonial.role}</small>
                </div>
                <div className="rating" aria-label="五星评价">
                  ★★★★★
                </div>
              </div>
            </article>
          ))}
        </div>
        <div className="carousel-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>

      <section className="marketing-container launch-cta">
        <div className="cta-preview" aria-hidden="true">
          <div className="cta-play-card">
            <span>▶</span>
          </div>
        </div>
        <div>
          <h2>立即体验 Renkumi</h2>
          <p>用 AI 让你的产品被更多人看见</p>
        </div>
        <div className="cta-actions">
          <Link className="launch-secondary light" href="/generate">
            开始生成视频
          </Link>
          <Link className="launch-outline" href="/studio">
            打开工作台
          </Link>
        </div>
      </section>

      <footer className="marketing-footer">
        <div className="marketing-container footer-grid">
          <div className="footer-brand">
            <Link className="marketing-brand" href="/">
              <span className="marketing-mark">レン</span>
              <span>Renkumi</span>
            </Link>
            <p>AI 驱动的产品视频生成平台，帮你快速将产品想法转化为高质量视频。</p>
          </div>
          {footerGroups.map((group) => (
            <div className="footer-link-group" key={group.title}>
              <strong>{group.title}</strong>
              {group.links.map((link) => (
                <Link href={link.href} key={link.label}>
                  {link.label}
                </Link>
              ))}
            </div>
          ))}
          <div className="footer-socials">
            <strong>关注我们</strong>
            <div>
              <a href="#workflow" aria-label="X">
                X
              </a>
              <a href="#workflow" aria-label="YouTube">
                ▶
              </a>
              <a href="#workflow" aria-label="Weibo">
                ◎
              </a>
            </div>
          </div>
        </div>
        <p className="footer-copyright">© 2024 Renkumi. All rights reserved.</p>
      </footer>
    </main>
  );
}
