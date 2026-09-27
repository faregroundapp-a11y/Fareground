/**
 * "Something about step counting just changed" - a permission granted, Apple
 * Health connected, Health Connect installed. The step setup screen says so,
 * and the step sync (hooks/useStepSync.ts) re-checks and syncs straight away
 * instead of waiting for its next minute. Plain listeners: nothing to install.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export function onStepSetupChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function notifyStepSetupChanged(): void {
  for (const fn of listeners) fn();
}
