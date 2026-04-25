import { connectAndSubscribe } from "./waclaw-client";
import { forwardAudioEvent } from "./forwarder";
import { log } from "./logger";

const WACLAW_URL = process.env.WACLAW_URL ?? "http://localhost:3100";
const WACLAW_PUBLIC_URL = process.env.WACLAW_PUBLIC_URL ?? WACLAW_URL;
const WACLAW_API_KEY = process.env.WACLAW_API_KEY ?? "";

async function main() {
  log.info("daemon starting", { waclaw_url: WACLAW_URL });

  await connectAndSubscribe({
    waclawUrl: WACLAW_URL,
    waclawPublicUrl: WACLAW_PUBLIC_URL,
    apiKey: WACLAW_API_KEY,
    onAudioMessage: async (event) => {
      try {
        const result = await forwardAudioEvent(event);
        log.info("forwarded", { msg: event.message_id, status: result.status });
      } catch (err) {
        log.error("forward failed permanently", {
          msg: event.message_id,
          err: String(err),
        });
      }
    },
    onError: (err) => log.error("waclaw subscription error", { err: String(err) }),
  });
}

process.on("SIGTERM", () => {
  log.info("SIGTERM received, shutting down");
  process.exit(0);
});
process.on("SIGINT", () => {
  log.info("SIGINT received, shutting down");
  process.exit(0);
});

main().catch((err) => {
  log.error("fatal", { err: String(err) });
  process.exit(1);
});
