import React from "react";
import { Composition } from "remotion";
import { EcobatVideo } from "./EcobatVideo";

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="EcobatVideo"
        component={EcobatVideo}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
