declare module "@agentup/aisdk-message-converter" {
  import type { UIMessage } from "ai";
  import type { ThreadMessage } from "@assistant-ui/core";

  export const AISDKMessageConverter: {
    toThreadMessages: (
      messages: UIMessage[],
      isRunning?: boolean,
    ) => ThreadMessage[];
  };
}
