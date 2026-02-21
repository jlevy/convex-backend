import {
  AbortController,
  AbortSignal,
} from "abortcontroller-polyfill/dist/abortcontroller";

export const setupAbortSignal = (global) => {
  // The abortcontroller-polyfill doesn't implement the newer static methods
  // on AbortSignal. Add them here so user code can use AbortSignal.timeout(),
  // AbortSignal.abort(), and AbortSignal.any().

  // AbortSignal.abort(reason?) - creates an already-aborted signal
  // https://dom.spec.whatwg.org/#dom-abortsignal-abort
  if (!AbortSignal.abort) {
    AbortSignal.abort = function (reason?: unknown): AbortSignal {
      const controller = new AbortController();
      controller.abort(
        reason ??
          new DOMException("The operation was aborted.", "AbortError"),
      );
      return controller.signal;
    };
  }

  // AbortSignal.timeout(milliseconds) - creates a signal that aborts after a delay
  // https://dom.spec.whatwg.org/#dom-abortsignal-timeout
  if (!AbortSignal.timeout) {
    AbortSignal.timeout = function (milliseconds: number): AbortSignal {
      const controller = new AbortController();
      setTimeout(() => {
        controller.abort(
          new DOMException(
            "The operation was aborted due to timeout",
            "TimeoutError",
          ),
        );
      }, milliseconds);
      return controller.signal;
    };
  }

  // AbortSignal.any(signals) - creates a signal that aborts when any input signal aborts
  // https://dom.spec.whatwg.org/#dom-abortsignal-any
  if (!AbortSignal.any) {
    AbortSignal.any = function (signals: AbortSignal[]): AbortSignal {
      const controller = new AbortController();
      for (const signal of signals) {
        if (signal.aborted) {
          controller.abort(signal.reason);
          return controller.signal;
        }
        signal.addEventListener("abort", () => {
          if (!controller.signal.aborted) {
            controller.abort(signal.reason);
          }
        });
      }
      return controller.signal;
    };
  }

  global.AbortController = AbortController;
  global.AbortSignal = AbortSignal;
};
