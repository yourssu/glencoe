import { AsyncLocalStorage } from "node:async_hooks";

export interface InvocationContext {
  agentCallId: number;
  parentInvocationId: number;
}

export const invocationStorage = new AsyncLocalStorage<InvocationContext>();

export function getCurrentContext(): InvocationContext | undefined {
  return invocationStorage.getStore();
}
