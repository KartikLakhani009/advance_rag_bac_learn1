/** An expected, user-fixable failure (bad config, Chroma not running, missing index): print the message, no stack. */
export class UserError extends Error {
  override name = "UserError";
}

export const CHROMA_DOWN_MESSAGE = "Chroma is not running. Start it in another terminal with: npm run chroma";

export class ChromaDownError extends UserError {
  constructor() {
    super(CHROMA_DOWN_MESSAGE);
  }
}
