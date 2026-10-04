/**
 * Resolves once the first-time tutorial is out of the way - shown and
 * closed, or not needed - so the step-setup screen and the "allow
 * notifications?" question never open on top of it. Its own module so the
 * game state and the tutorial do not import each other.
 */
let resolveClosed: () => void = () => undefined;
const closed = new Promise<void>((r) => {
  resolveClosed = r;
});
export const whenTutorialClosed = () => closed;
export const markTutorialClosed = () => resolveClosed();
