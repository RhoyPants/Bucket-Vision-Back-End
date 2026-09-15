import { incidentWorkflowService } from "./incident-workflow.service";

export function startIncidentWorkflowWorker() {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();
  const tick = () => {
    running = (async () => {
      try { await incidentWorkflowService.processDue(); }
      catch (error) { console.error("Incident workflow worker failed", error); }
      if (!stopped) { timer = setTimeout(tick, 15000); timer.unref(); }
    })();
  };
  tick();
  return async () => { stopped = true; if (timer) clearTimeout(timer); await running; };
}
