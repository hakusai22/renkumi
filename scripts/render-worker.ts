import { createRenderTask, readRenderTask } from "../lib/render-store";
import { renderLaunchCutVideo } from "../lib/render-launchcut-video";

async function main() {
  const requestedId = process.argv[2];
  const task = requestedId && requestedId !== "sample" ? await readRenderTask(requestedId) : await createRenderTask();

  if (!task) {
    throw new Error(`Render task ${requestedId} was not found`);
  }

  console.log(`Rendering ${task.id}...`);
  const result = await renderLaunchCutVideo(task.id);
  console.log(`Rendered ${result.outputUrl}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
