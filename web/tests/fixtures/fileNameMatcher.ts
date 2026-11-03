/** A file name is rendered split (truncated base name + extension), so no
 * single text node holds it: this matches the innermost element that does. */
export function fileName(name: string) {
  return (_content: string, element: Element | null) =>
    element?.textContent === name && !Array.from(element.children).some((child) => child.textContent === name);
}
