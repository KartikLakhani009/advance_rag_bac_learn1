import { getEncoding, type Tiktoken } from "js-tiktoken";

let enc: Tiktoken | undefined;

/** cl100k approximates every model used here closely enough for chunk sizing and TPM budgeting. */
export function countTokens(text: string): number {
  enc ??= getEncoding("cl100k_base");
  return enc.encode(text, [], []).length;
}
