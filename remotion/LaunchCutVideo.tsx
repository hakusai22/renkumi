import React, { type CSSProperties } from "react";
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  getAssetById,
  getCreativeSpec,
  getSceneStartFrame,
  type AssetBehavior,
  type SceneAnimation,
  type SceneLayout,
  type SceneSpec,
  type VideoSpec,
  type VisualTreatment,
} from "../lib/video-spec";

type LaunchCutVideoProps = {
  spec: VideoSpec;
};

const fontStack = "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif";

type VideoTheme = {
  isDark: boolean;
  background: string;
  text: string;
  muted: string;
  surface: string;
  surfaceStrong: string;
  border: string;
  shadow: string;
};

const hexToRgb = (hex: string) => {
  const normalized = hex.replace("#", "");
  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => char + char)
          .join("")
      : normalized.slice(0, 6);

  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
};

const colorWithAlpha = (hex: string, alpha: number) => {
  const { r, g, b } = hexToRgb(hex);

  return `rgba(${r},${g},${b},${alpha})`;
};

const colorLuminance = (hex: string) => {
  const { r, g, b } = hexToRgb(hex);
  const channels = [r, g, b].map((channel) => {
    const normalized = channel / 255;

    return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};

const getVideoTheme = (spec: VideoSpec): VideoTheme => {
  const isDark = colorLuminance(spec.brand.backgroundColor) < 0.35;

  return {
    isDark,
    background: spec.brand.backgroundColor,
    text: spec.brand.textColor,
    muted: isDark ? "rgba(255,255,255,0.72)" : "rgba(20,35,38,0.72)",
    surface: isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.82)",
    surfaceStrong: isDark ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.94)",
    border: isDark ? "rgba(255,255,255,0.14)" : "rgba(20,35,38,0.12)",
    shadow: isDark ? "0 34px 90px rgba(0,0,0,0.34)" : "0 34px 90px rgba(16,61,74,0.18)",
  };
};

export const LaunchCutVideo: React.FC<LaunchCutVideoProps> = ({ spec }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: spec.brand.backgroundColor, fontFamily: fontStack }}>
      <BackgroundSystem spec={spec} />
      {spec.scenes.map((scene, index) => {
        const from = getSceneStartFrame(spec, index);
        return (
          <Sequence key={scene.id} from={from} durationInFrames={scene.durationInSeconds * spec.output.fps}>
            <SceneView scene={scene} spec={spec} index={index} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const BackgroundSystem: React.FC<{ spec: VideoSpec }> = ({ spec }) => {
  const creative = getCreativeSpec(spec);
  const theme = getVideoTheme(spec);
  const base = spec.brand.backgroundColor;
  const contrast = theme.isDark ? "#0A0A0A" : "#FFFFFF";
  const softEnd = theme.isDark ? "#161616" : "#E8F3F1";
  const backgrounds: Record<string, string> = {
    grid: `radial-gradient(circle at 18% 20%, ${colorWithAlpha(spec.brand.secondaryColor, 0.24)} 0, transparent 28%), linear-gradient(135deg, ${base}, ${contrast} 72%, ${softEnd})`,
    soft: `radial-gradient(circle at 22% 28%, ${colorWithAlpha(spec.brand.secondaryColor, 0.28)} 0, transparent 30%), radial-gradient(circle at 82% 18%, ${colorWithAlpha(spec.brand.accentColor, 0.18)} 0, transparent 28%), linear-gradient(135deg, ${base}, ${contrast} 72%)`,
    spotlight: `radial-gradient(circle at 50% 42%, ${colorWithAlpha(spec.brand.accentColor, 0.22)} 0, ${base} 46%, ${contrast} 100%)`,
    bands: `linear-gradient(115deg, ${spec.brand.primaryColor} 0 24%, ${base} 24% 64%, ${spec.brand.secondaryColor}55 64% 100%)`,
    solid: `linear-gradient(135deg, ${base}, ${contrast})`,
  };

  return (
    <AbsoluteFill style={{ background: backgrounds[creative.backgroundPreset] ?? backgrounds.grid }}>
      {creative.backgroundPreset === "grid" ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              `linear-gradient(${theme.border} 1px, transparent 1px), linear-gradient(90deg, ${theme.border} 1px, transparent 1px)`,
            backgroundSize: "64px 64px",
            maskImage: "linear-gradient(120deg, black 0%, transparent 78%)",
          }}
        />
      ) : null}
      {creative.backgroundPreset === "bands" ? (
        <div
          style={{
            position: "absolute",
            inset: "120px -80px auto auto",
            width: 740,
            height: 740,
            borderRadius: "50%",
            border: `80px solid ${spec.brand.accentColor}33`,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

const SceneView: React.FC<{ scene: SceneSpec; spec: VideoSpec; index: number }> = ({ scene, spec, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const creative = getCreativeSpec(spec);
  const asset = getAssetById(spec, scene.assetId);
  const duration = scene.durationInSeconds * fps;
  const enter = spring({ frame, fps, config: { damping: 18, stiffness: creative.motionPreset === "kinetic" ? 170 : 120 } });
  const fade = interpolate(frame, [0, 16], [0, 1], { extrapolateRight: "clamp" });
  const exit = interpolate(frame, [duration - 18, duration], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const progress = interpolate(frame, [0, duration], [0, 1], { extrapolateRight: "clamp" });
  const layout = scene.layout ?? (scene.kind === "cta" ? "cta" : index === 0 ? "hero" : "split");
  const animation = scene.animation ?? (creative.motionPreset === "snappy" ? "slide" : "fade");
  const motion = getMotionStyle(animation, enter, progress);

  return (
    <AbsoluteFill
      style={{
        color: spec.brand.textColor,
        opacity: fade * exit,
        padding: "82px 108px",
        transform: transitionTransform(creative.transitionPreset, progress),
      }}
    >
      <TopBar spec={spec} sceneIndex={index} progress={progress} />
      <LayoutView
        scene={scene}
        spec={spec}
        layout={layout}
        motion={motion}
        assetSrc={asset?.src}
        assetAlt={asset?.alt ?? scene.title}
        progress={progress}
      />
      <Caption text={scene.narration ?? scene.subtitle} spec={spec} />
    </AbsoluteFill>
  );
};

const LayoutView: React.FC<{
  scene: SceneSpec;
  spec: VideoSpec;
  layout: SceneLayout;
  motion: CSSProperties;
  assetSrc?: string;
  assetAlt: string;
  progress: number;
}> = ({ scene, spec, layout, motion, assetSrc, assetAlt, progress }) => {
  const isCta = layout === "cta" || scene.kind === "cta";
  const visualTreatment = scene.visualTreatment ?? (layout === "cards" ? "plain" : "browser");
  const assetBehavior = scene.assetBehavior ?? (layout === "hero" ? "cover" : "contain");

  if (layout === "hero") {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100%", paddingTop: 40, textAlign: "center" }}>
        <div style={{ ...motion, maxWidth: 1180 }}>
          <ScenePill label={scene.kind} spec={spec} />
          <TitleBlock scene={scene} spec={spec} scale="large" align="center" />
          <VisualPanel
            src={assetSrc}
            alt={assetAlt}
            spec={spec}
            progress={progress}
            treatment={visualTreatment}
            behavior={assetBehavior}
            animation={scene.animation}
            height={360}
          />
        </div>
      </div>
    );
  }

  if (layout === "showcase") {
    return (
      <div style={{ display: "grid", gridTemplateRows: "auto 1fr", gap: 34, height: "100%", paddingTop: 82 }}>
        <div style={{ ...motion, maxWidth: 1280 }}>
          <ScenePill label={scene.kind} spec={spec} />
          <TitleBlock scene={scene} spec={spec} scale="medium" align="left" />
        </div>
        <VisualPanel
          src={assetSrc}
          alt={assetAlt}
          spec={spec}
          progress={progress}
          treatment={visualTreatment}
          behavior={assetBehavior}
          animation={scene.animation}
          height={560}
        />
      </div>
    );
  }

  if (layout === "cards" || layout === "metrics") {
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: layout === "metrics" ? "0.85fr 1.15fr" : "1fr 1fr",
          alignItems: "center",
          gap: 64,
          height: "100%",
          paddingTop: 66,
        }}
      >
        <div style={motion}>
          <ScenePill label={scene.kind} spec={spec} />
          <TitleBlock scene={scene} spec={spec} scale="medium" align="left" />
        </div>
        <MetricCards bullets={scene.bullets ?? []} scene={scene} spec={spec} progress={progress} />
      </div>
    );
  }

  if (layout === "quote") {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100%", paddingTop: 40 }}>
        <div style={{ ...motion, maxWidth: 1260, textAlign: "center" }}>
          <ScenePill label={scene.kind} spec={spec} />
          <div style={{ color: spec.brand.accentColor, fontSize: 86, fontWeight: 900, lineHeight: 1 }}>&ldquo;</div>
          <TitleBlock scene={scene} spec={spec} scale="large" align="center" />
          {scene.bullets ? <BulletList bullets={scene.bullets} spec={spec} align="center" /> : null}
        </div>
      </div>
    );
  }

  if (isCta) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100%", textAlign: "center" }}>
        <div style={{ ...motion, maxWidth: 1120 }}>
          <ScenePill label={scene.kind} spec={spec} />
          <TitleBlock scene={scene} spec={spec} scale="large" align="center" />
          <CtaBlock spec={spec} />
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: scene.emphasis === "asset" ? "0.82fr 1.18fr" : "0.95fr 1.05fr",
        alignItems: "center",
        gap: 72,
        height: "100%",
        paddingTop: 64,
      }}
    >
      <div style={motion}>
        <ScenePill label={scene.kind} spec={spec} />
        <TitleBlock scene={scene} spec={spec} scale="medium" align="left" />
        {scene.bullets ? <BulletList bullets={scene.bullets} spec={spec} align="left" /> : null}
      </div>
      <VisualPanel
        src={assetSrc}
        alt={assetAlt}
        spec={spec}
        progress={progress}
        treatment={visualTreatment}
        behavior={assetBehavior}
        animation={scene.animation}
        height={680}
      />
    </div>
  );
};

const getMotionStyle = (animation: SceneAnimation, enter: number, progress: number): CSSProperties => {
  if (animation === "slide") {
    return { transform: `translateX(${(1 - enter) * -72}px)`, opacity: enter };
  }

  if (animation === "zoom") {
    return { transform: `scale(${0.94 + enter * 0.06})`, opacity: enter };
  }

  if (animation === "parallax") {
    return { transform: `translateY(${(1 - enter) * 54 - progress * 10}px)`, opacity: enter };
  }

  if (animation === "stack") {
    return { transform: `translateY(${(1 - enter) * 42}px) rotate(${(1 - enter) * -1.4}deg)`, opacity: enter };
  }

  if (animation === "spotlight") {
    return { transform: `translateY(${(1 - enter) * 34}px)`, opacity: Math.min(1, enter + progress * 0.2) };
  }

  return { opacity: enter };
};

const transitionTransform = (transition: string, progress: number) => {
  if (transition === "push") {
    return `translateX(${(1 - progress) * 8}px)`;
  }

  if (transition === "scale") {
    return `scale(${0.992 + progress * 0.008})`;
  }

  if (transition === "wipe") {
    return `translateY(${Math.sin(progress * Math.PI) * -6}px)`;
  }

  return undefined;
};

const TitleBlock: React.FC<{
  scene: SceneSpec;
  spec: VideoSpec;
  scale: "large" | "medium";
  align: "left" | "center";
}> = ({ scene, spec, scale, align }) => {
  const theme = getVideoTheme(spec);

  return (
  <>
    <h1
      style={{
        fontSize: scale === "large" ? 104 : 74,
        lineHeight: 1.02,
        margin: "22px 0 26px",
        letterSpacing: 0,
        fontWeight: 840,
        color: theme.text,
      }}
    >
      {scene.title}
    </h1>
    <p
      style={{
        fontSize: scale === "large" ? 38 : 32,
        lineHeight: 1.32,
        margin: 0,
        color: theme.muted,
        maxWidth: align === "center" ? 980 : 760,
        marginLeft: align === "center" ? "auto" : 0,
        marginRight: align === "center" ? "auto" : 0,
      }}
    >
      {scene.subtitle}
    </p>
  </>
  );
};

const TopBar: React.FC<{ spec: VideoSpec; sceneIndex: number; progress: number }> = ({
  spec,
  sceneIndex,
  progress,
}) => {
  const theme = getVideoTheme(spec);

  return (
    <div
      style={{
        position: "absolute",
        top: 52,
        left: 108,
        right: 108,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontSize: 24,
        fontWeight: 700,
        color: theme.text,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <Logo spec={spec} size={54} />
        <span>{spec.brand.name}</span>
        {spec.creative?.design ? (
          <span style={{ color: theme.muted, fontSize: 18, fontWeight: 650 }}>{spec.creative.design.name}</span>
        ) : null}
      </div>
      <div style={{ width: 360, height: 8, borderRadius: 999, background: theme.border }}>
        <div
          style={{
            width: `${Math.max(8, progress * 100)}%`,
            height: "100%",
            borderRadius: 999,
            background: sceneIndex % 2 === 0 ? spec.brand.accentColor : spec.brand.secondaryColor,
          }}
        />
      </div>
    </div>
  );
};

const Logo: React.FC<{ spec: VideoSpec; size: number }> = ({ spec, size }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: 16,
      display: "grid",
      placeItems: "center",
      background: spec.brand.primaryColor,
      color: "white",
      fontSize: size * 0.52,
      fontWeight: 900,
      boxShadow: "0 18px 36px rgba(16,61,74,0.18)",
      overflow: "hidden",
    }}
  >
    {spec.brand.logoSrc ? (
      <Img
        src={staticFile(spec.brand.logoSrc.slice(1))}
        alt=""
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
        }}
      />
    ) : (
      spec.brand.logoText
    )}
  </div>
);

const ScenePill: React.FC<{ label: SceneSpec["kind"]; spec: VideoSpec }> = ({ label, spec }) => {
  const labels: Record<SceneSpec["kind"], string> = {
    brand: "Product story",
    problem: "Current bottleneck",
    feature: "System capability",
    proof: "Reusable output",
    cta: "Launch faster",
  };

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 44,
        padding: "0 18px",
        borderRadius: 999,
        background: `${spec.brand.secondaryColor}66`,
        color: spec.brand.primaryColor,
        fontSize: 20,
        fontWeight: 800,
        textTransform: "uppercase",
      }}
    >
      {labels[label]}
    </div>
  );
};

const BulletList: React.FC<{ bullets: string[]; spec: VideoSpec; align: "left" | "center" }> = ({
  bullets,
  spec,
  align,
}) => {
  const theme = getVideoTheme(spec);

  return (
    <div
      style={{
        display: "flex",
        gap: 18,
        flexWrap: "wrap",
        marginTop: 42,
        justifyContent: align === "center" ? "center" : "flex-start",
      }}
    >
      {bullets.map((bullet) => (
        <div
          key={bullet}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "15px 18px",
            borderRadius: 8,
            background: theme.surface,
            border: `1px solid ${theme.border}`,
            boxShadow: theme.shadow,
            color: theme.text,
            fontSize: 23,
            fontWeight: 740,
          }}
        >
          <span style={{ width: 12, height: 12, borderRadius: 99, background: spec.brand.accentColor }} />
          {bullet}
        </div>
      ))}
    </div>
  );
};

const MetricCards: React.FC<{ bullets: string[]; scene: SceneSpec; spec: VideoSpec; progress: number }> = ({
  bullets,
  scene,
  spec,
  progress,
}) => {
  const items = bullets.length ? bullets : [scene.title, spec.brand.cta, spec.brand.tagline].slice(0, 3);
  const theme = getVideoTheme(spec);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 22 }}>
      {items.map((item, index) => (
        <div
          key={`${item}-${index}`}
          style={{
            minHeight: index === 0 ? 260 : 190,
            gridColumn: index === 0 ? "span 2" : "span 1",
            padding: 30,
            borderRadius: 8,
            background: index === 0 ? spec.brand.primaryColor : theme.surface,
            color: index === 0 ? spec.brand.textColor : theme.text,
            border: `1px solid ${theme.border}`,
            boxShadow: theme.shadow,
            transform: `translateY(${Math.sin((progress + index * 0.12) * Math.PI) * -10}px)`,
          }}
        >
          <div style={{ fontSize: index === 0 ? 74 : 42, fontWeight: 900, lineHeight: 1 }}>{index + 1}</div>
          <div style={{ marginTop: 24, fontSize: index === 0 ? 42 : 30, fontWeight: 820 }}>{item}</div>
        </div>
      ))}
    </div>
  );
};

const VisualPanel: React.FC<{
  src?: string;
  alt: string;
  spec: VideoSpec;
  progress: number;
  treatment: VisualTreatment;
  behavior: AssetBehavior;
  animation?: SceneAnimation;
  height: number;
}> = ({ src, alt, spec, progress, treatment, behavior, animation, height }) => {
  const theme = getVideoTheme(spec);
  const float = Math.sin(progress * Math.PI * 2) * (animation === "parallax" ? 14 : 8);
  const rotate = treatment === "floating" ? 1.4 : treatment === "stack" ? -1.2 : 0;
  const remotionSrc = src?.startsWith("/") ? staticFile(src.slice(1)) : src;
  const frameRadius = treatment === "device" ? 42 : 8;
  const objectFit = behavior === "cover" || behavior === "pan" || behavior === "zoom" ? "cover" : "contain";
  const imageScale = behavior === "zoom" ? 1.04 + progress * 0.08 : behavior === "pan" ? 1.08 : 1;
  const imageTranslate = behavior === "pan" ? `translateX(${(progress - 0.5) * -34}px)` : "translateX(0)";

  return (
    <div style={{ position: "relative", minHeight: height }}>
      {treatment === "stack" ? (
        <>
          <div style={stackCardStyle(spec, -28, 26, -3)} />
          <div style={stackCardStyle(spec, -14, 13, -1.6)} />
        </>
      ) : null}
      <div
        style={{
          position: "relative",
          height,
          borderRadius: frameRadius,
          padding: treatment === "plain" ? 0 : 28,
          transform: `translateY(${float}px) rotate(${rotate}deg)`,
          background: treatment === "spotlight" ? colorWithAlpha(spec.brand.accentColor, 0.12) : theme.surfaceStrong,
          boxShadow: theme.shadow,
          overflow: "hidden",
          border: treatment === "device" ? `16px solid ${theme.text}` : `1px solid ${theme.border}`,
        }}
      >
        {treatment === "browser" ? (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 76,
              background: spec.brand.primaryColor,
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "0 28px",
            }}
          >
            {[spec.brand.accentColor, spec.brand.secondaryColor, "#DCEBE8"].map((color) => (
              <span key={color} style={{ width: 18, height: 18, borderRadius: 99, background: color }} />
            ))}
          </div>
        ) : null}
        <div
          style={{
            height: "100%",
            paddingTop: treatment === "browser" ? 78 : 0,
            borderRadius: treatment === "device" ? 24 : 8,
            overflow: "hidden",
            background: theme.isDark ? "#101010" : "#F9FBFA",
          }}
        >
          {remotionSrc ? (
            <Img
              src={remotionSrc}
              alt={alt}
              style={{
                width: "100%",
                height: "100%",
                objectFit,
                display: "block",
                transform: `${imageTranslate} scale(${imageScale})`,
              }}
            />
          ) : (
            <div style={{ display: "grid", placeItems: "center", height: "100%", color: theme.muted, fontSize: 36 }}>
              {alt}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const stackCardStyle = (spec: VideoSpec, top: number, left: number, rotate: number): CSSProperties => ({
  position: "absolute",
  inset: `${top}px ${left}px auto ${left}px`,
  height: "100%",
  borderRadius: 8,
  background: colorWithAlpha(spec.brand.accentColor, 0.16),
  transform: `rotate(${rotate}deg)`,
  boxShadow: getVideoTheme(spec).shadow,
});

const Caption: React.FC<{ text: string; spec: VideoSpec }> = ({ text, spec }) => {
  const theme = getVideoTheme(spec);

  return (
    <div
      style={{
        position: "absolute",
        left: 108,
        right: 108,
        bottom: 54,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          maxWidth: 1120,
          padding: "18px 30px",
          borderRadius: 8,
          background: theme.isDark ? "rgba(255,255,255,0.12)" : "rgba(20,35,38,0.84)",
          color: theme.isDark ? theme.text : "white",
          border: `1px solid ${theme.border}`,
          fontSize: 27,
          lineHeight: 1.28,
          textAlign: "center",
          boxShadow: theme.shadow,
        }}
      >
        <span style={{ color: spec.brand.secondaryColor, fontWeight: 800 }}>{spec.brand.name}</span>
        {" · "}
        {text}
      </div>
    </div>
  );
};

const CtaBlock: React.FC<{ spec: VideoSpec }> = ({ spec }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 24,
      marginTop: 48,
      padding: "20px 28px",
      borderRadius: 8,
      background: spec.brand.primaryColor,
      color: "white",
      fontSize: 30,
      fontWeight: 840,
      boxShadow: "0 24px 56px rgba(16,61,74,0.24)",
    }}
  >
    <Logo spec={spec} size={48} />
    {spec.brand.cta}
  </div>
);
