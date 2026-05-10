import { createRenderTask, readRenderTask } from "../lib/render-store";
import { renderRenkumiHyperframesVideo } from "../lib/render-hyperframes-video";
import { renderRenkumiVideo } from "../lib/render-renkumi-video";

async function main() {
  const requestedId = process.argv[2];
  const requestedEngine = process.argv[3] === "hyperframes" ? "hyperframes" : "remotion";
  const task =
    requestedId && requestedId !== "sample"
      ? await readRenderTask(requestedId)
      : await createRenderTask(undefined, requestedEngine);

  if (!task) {
    throw new Error(`Render task ${requestedId} was not found`);
  }

  const engine = task.engine ?? "remotion";
  console.log(`Rendering ${task.id} with ${engine}...`);
  const result =
    engine === "hyperframes" ? await renderRenkumiHyperframesVideo(task.id) : await renderRenkumiVideo(task.id);
  console.log(`Rendered ${result.outputUrl}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
