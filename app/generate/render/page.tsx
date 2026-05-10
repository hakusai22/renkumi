import { VideoConsole } from "@/components/VideoConsole";
import { defaultVideoSpec } from "@/lib/video-spec";

export default function GenerateRenderPage() {
  return <VideoConsole initialSpec={defaultVideoSpec} workflowRoute="render" />;
}
