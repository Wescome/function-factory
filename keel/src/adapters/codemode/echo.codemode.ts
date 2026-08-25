// A trivial connector for the walking skeleton: echo.emit(x) returns x.
// Real connectors extend CodemodeConnector (constructor(ctx, env), name(), tools()).
import { CodemodeConnector } from "@cloudflare/codemode";

export class EchoConnector extends CodemodeConnector<unknown> {
  override name() { return "echo"; }
  override tools() {
    return {
      emit: {
        description: "Echo the argument back.",
        execute: (args: unknown) => args,
      },
    };
  }
}
