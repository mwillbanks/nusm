import { parentPort, workerData } from "node:worker_threads";

export const workerBundle = true;
if (workerData?.name) {
  const channel = new BroadcastChannel(workerData.name);
  channel.onmessage = ({ data }) => {
    if (data?.kind === "probe") {
      channel.postMessage({
        kind: "reply",
        value: data.value,
        worker: workerData.id,
      });
    }
  };
  parentPort?.postMessage({ kind: "ready", worker: workerData.id });
}
