import { VideoConsole } from "@/components/VideoConsole";
import { defaultVideoSpec } from "@/lib/video-spec";

export default function GenerateInputPage() {
  return <VideoConsole initialSpec={defaultVideoSpec} workflowRoute="input" />;
}
