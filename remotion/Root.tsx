import React from "react";
import { Composition } from "remotion";
import { defaultVideoSpec, getTotalDurationInFrames } from "../lib/video-spec";
import { LaunchCutVideo } from "./LaunchCutVideo";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="LaunchCutVideo"
      component={LaunchCutVideo}
      durationInFrames={getTotalDurationInFrames(defaultVideoSpec)}
      fps={defaultVideoSpec.output.fps}
      width={defaultVideoSpec.output.width}
      height={defaultVideoSpec.output.height}
      defaultProps={{
        spec: defaultVideoSpec,
      }}
      calculateMetadata={({ props }) => ({
        durationInFrames: getTotalDurationInFrames(props.spec),
        fps: props.spec.output.fps,
        width: props.spec.output.width,
        height: props.spec.output.height,
      })}
    />
  );
};
