import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Work that may finish after the answer went out (push notices, e-mails): inside a request
 * it runs through ctx.waitUntil, so the person does not wait for Google or the mail service;
 * elsewhere (crons, tests) it is awaited as before. Needs the "nodejs_als" compatibility flag.
 */
const later = new AsyncLocalStorage<(work: Promise<unknown>) => void>();

/** Runs `fn` with `waitUntil` as the place for work that may finish after the answer. */
export function withBackground<T>(waitUntil: (work: Promise<unknown>) => void, fn: () => T): T {
  return later.run(waitUntil, fn);
}

/** Runs `work` after the answer when inside a request, otherwise waits for it. Never throws. */
export async function afterResponse(label: string, work: () => Promise<unknown>): Promise<void> {
  const run = () => work().catch((err: Error) => console.error(label, err?.message ?? err));
  const waitUntil = later.getStore();
  if (waitUntil) waitUntil(run());
  else await run();
}
