import { parseArgs } from "node:util";
import { UserError } from "./errors.js";

export interface CliArgs {
  positionals: string[];
  debug: boolean;
  naive: boolean;
  rerank: boolean | undefined;
  open: boolean;
  ladder: boolean;
  /** score retrieval only: no answer generation, so no Groq tokens are spent */
  retrievalOnly: boolean;
}

/** --rerank / --no-rerank override the environment default for one run. */
export function parseCli(argv = process.argv.slice(2)): CliArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      debug: { type: "boolean", default: false },
      naive: { type: "boolean", default: false },
      rerank: { type: "boolean", default: false },
      "no-rerank": { type: "boolean", default: false },
      open: { type: "boolean", default: false },
      ladder: { type: "boolean", default: false },
      "retrieval-only": { type: "boolean", default: false },
    },
  });
  if (values.rerank && values["no-rerank"]) throw new UserError("Use either --rerank or --no-rerank, not both.");
  return {
    positionals,
    debug: values.debug!,
    naive: values.naive!,
    rerank: values.rerank ? true : values["no-rerank"] ? false : undefined,
    open: values.open!,
    ladder: values.ladder!,
    retrievalOnly: values["retrieval-only"]!,
  };
}

/**
 * Entry point wrapper for every npm script: expected failures (`UserError`) print their message only,
 * anything else prints the stack; either way the process exits non-zero.
 */
export function runCli(main: () => Promise<void>): void {
  main().catch((err: unknown) => {
    console.error(err instanceof UserError ? err.message : err);
    process.exit(1);
  });
}
