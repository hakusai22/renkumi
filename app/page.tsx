import { VideoConsole } from "@/components/VideoConsole";
import { defaultVideoSpec } from "@/lib/video-spec";

export default function Home() {
  return <VideoConsole initialSpec={defaultVideoSpec} />;
}
