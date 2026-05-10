import { VideoConsole } from "@/components/VideoConsole";
import { defaultVideoSpec } from "@/lib/video-spec";

export default function GenerateStoryboardPage() {
  return <VideoConsole initialSpec={defaultVideoSpec} workflowRoute="storyboard" />;
}
