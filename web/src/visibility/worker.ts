import { analyze } from "./engine";
import type { Scenario } from "./model";
self.onmessage = (event: MessageEvent<Scenario>) => {
  try { self.postMessage({ result: analyze(event.data) }); }
  catch (e) { self.postMessage({ error: (e as Error).message }); }
};
