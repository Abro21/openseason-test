import { cssVariables } from '@openseason/tokens';

/** Writes the design tokens as CSS variables, light by default and dark when the device asks for it. */
export function installTheme(doc: Document = document): void {
  if (doc.getElementById('os-tokens')) return;
  const style = doc.createElement('style');
  style.id = 'os-tokens';
  style.textContent = `:root {\n${cssVariables('light')}\n  color-scheme: light dark;\n}\n@media (prefers-color-scheme: dark) {\n  :root {\n${cssVariables('dark')}\n  }\n}`;
  doc.head.appendChild(style);
}
