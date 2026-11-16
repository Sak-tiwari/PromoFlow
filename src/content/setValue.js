/** Sets a value the way React/Vue-controlled inputs expect (native setter + input/change events). */
export function setNativeValue(input, value) {
  const win = input.ownerDocument.defaultView;
  const desc =
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value') ||
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value');
  input.focus?.();
  desc.set.call(input, value);
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  input.dispatchEvent(new win.Event('change', { bubbles: true }));
}
