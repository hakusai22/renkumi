import { VideoConsole } from "@/components/VideoConsole";
import { defaultVideoSpec } from "@/lib/video-spec";

export default function GenerateAiPlanPage() {
  return <VideoConsole initialSpec={defaultVideoSpec} workflowRoute="ai-plan" />;
}
