import { parseCli, runCli, type CliArgs } from "../cli.js";
import { UserError } from "../errors.js";
import type { UseCaseId } from "../config.js";
import type { LadderStep } from "../eval/ladder.js";
import { loadQuestions, runEval } from "../eval/run.js";
import { presentResult } from "../present.js";
import type { UseCaseApp } from "./app.js";
import { createRuntime, QUERY_KEYS, type Runtime } from "./kit.js";

interface CommandBase {
  uc: UseCaseId;
  /** false = this use case never reranks (UC3) */
  useCaseRerank?: boolean;
}

export interface QueryCommand extends CommandBase {
  usage: string;
  /** build the use case's app (opens its index, wires its graph) */
  setup(rt: Runtime, cli: CliArgs): Promise<UseCaseApp>;
  /** override the rerank line (UC3 explains why it is always off) */
  rerankLabel?: (rt: Runtime, cli: CliArgs) => { label: string; note?: string };
}

/** `npm run <uc>:query -- "question" …`: one question through the use case's graph, printed for the CLI. */
export function runQueryCommand(cmd: QueryCommand): void {
  runCli(async () => {
    const cli = parseCli();
    const question = cli.positionals.join(" ").trim();
    if (!question) throw new UserError(cmd.usage);
    const rt = await createRuntime({ uc: cmd.uc, cli, useCaseRerank: cmd.useCaseRerank, require: QUERY_KEYS });
    const out = await (await cmd.setup(rt, cli)).ask(question);
    const fixed = cmd.rerankLabel?.(rt, cli);
    await presentResult(out.result, {
      debug: cli.debug,
      rerankLabel:
        fixed?.label ??
        (rt.rerank.enabled && !out.rerankUsed ? `Rerank: FAILED → fused order (requested ON, Voyage ${rt.rerankModel})` : rt.rerankLabel),
      rerankNote: fixed?.note,
      openImages: cli.open,
    });
  });
}

/** What a use case contributes to an eval run beyond the shared flow. */
export interface EvalSetup {
  app: UseCaseApp;
  ladder?: LadderStep[];
  scoreParents?: boolean;
  tag?: string;
  notes?: string[];
  /** fixed rerank label (UC3); default comes from the runtime */
  rerankLabel?: string;
}

export interface EvalCommand extends CommandBase {
  title: string;
  questionsFile: string;
  setup(rt: Runtime, cli: CliArgs): Promise<EvalSetup>;
}

/** `npm run <uc>:eval [-- --naive|--ladder|--rerank|--retrieval-only]`. */
export function runEvalCommand(cmd: EvalCommand): void {
  runCli(async () => {
    const cli = parseCli();
    const rt = await createRuntime({ uc: cmd.uc, cli, useCaseRerank: cmd.useCaseRerank, require: QUERY_KEYS });
    const setup = await cmd.setup(rt, cli);
    const file = await runEval({
      uc: cmd.uc,
      title: cmd.title,
      app: setup.app,
      questions: loadQuestions(cmd.questionsFile),
      rerankLabel: setup.rerankLabel ?? rt.rerankLabel,
      rerankOn: setup.rerankLabel ? false : rt.rerank.enabled,
      naive: cli.naive,
      ladder: cli.ladder ? setup.ladder : undefined,
      retrievalOnly: cli.retrievalOnly,
      scoreParents: setup.scoreParents,
      tag: setup.tag,
      notes: setup.notes,
    });
    console.log(`\nReport written: ${file}`);
  });
}
