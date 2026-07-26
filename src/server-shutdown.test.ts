import assert from "node:assert/strict";
import { shutdownHttpServer } from "./server-shutdown.js";

let finishHttpClose: (() => void) | undefined;
let applicationCloseStarted = false;

const drainingHttpServer = {
  close(callback: (error?: Error) => void) {
    finishHttpClose = () => callback();
  },
};

const drainingShutdown = shutdownHttpServer(drainingHttpServer, async () => {
  applicationCloseStarted = true;
  assert.ok(finishHttpClose, "HTTP draining must start before application cleanup");
  finishHttpClose();
});

await Promise.resolve();
assert.equal(applicationCloseStarted, true);
await drainingShutdown;

let finishApplicationClose: (() => void) | undefined;
let shutdownResolved = false;

const immediatelyClosedHttpServer = {
  close(callback: (error?: Error) => void) {
    callback();
  },
};

const delayedShutdown = shutdownHttpServer(
  immediatelyClosedHttpServer,
  () =>
    new Promise<void>((resolve) => {
      finishApplicationClose = resolve;
    }),
);
void delayedShutdown.then(() => {
  shutdownResolved = true;
});

await Promise.resolve();
assert.equal(shutdownResolved, false);
finishApplicationClose?.();
await delayedShutdown;
assert.equal(shutdownResolved, true);

const httpCloseError = new Error("http close failed");
await assert.rejects(
  shutdownHttpServer(
    {
      close(callback: (error?: Error) => void) {
        callback(httpCloseError);
      },
    },
    async () => {},
  ),
  httpCloseError,
);
