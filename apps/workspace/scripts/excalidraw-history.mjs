// Excalidraw 0.18.0 moves ink on arrow keydown but never schedules its native
// history increment when the gesture ends. updateScene cannot repair this:
// it deliberately filters out uncommitted local edits. Keep this pinned source
// transform until an upstream release captures arrow gestures itself.
const VERSION = "0.18.0";
const KEYUP = '"onKeyUp",Fe(t=>{';
const NEXT_HANDLER = '}));C(this,"isToolSupported"';
const ARROW = 'an(t.key)&&(cn(this.scene.getSelectedElements(this.state).filter(he),this.scene.getNonDeletedElementsMap(),this.scene.getNonDeletedElements(),this.scene,sn(this.state),this.state.selectedLinearElement?.selectedPointsIndices??[],this.state.zoom),this.setState({suggestedBindings:[]}))';
const FIXED_ARROW = ARROW.replace(',this.setState({suggestedBindings:[]})', ',this.store.shouldCaptureIncrement(),this.setState({suggestedBindings:[]})');

export function patchExcalidrawArrowHistory(source, version) {
  if (version !== VERSION) throw new Error(`Review the Excalidraw arrow-history fix before building version ${version}; expected ${VERSION}.`);
  const starts = source.split(KEYUP).length - 1, matches = source.split(ARROW).length - 1;
  const start = source.indexOf(KEYUP), end = source.indexOf(NEXT_HANDLER, start), branch = source.indexOf(ARROW);
  if (starts !== 1 || matches !== 1 || end < start || branch < start || branch + ARROW.length > end) {
    throw new Error(`Excalidraw ${VERSION} arrow-history source changed: expected exactly one onKeyUp arrow branch (handlers=${starts}, branches=${matches}).`);
  }
  // Capture after binding edits and before setState commits the current scene.
  // This uses the editor's existing undo/redo stacks and leaves persistence alone.
  return source.replace(ARROW, FIXED_ARROW);
}
